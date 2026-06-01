// Pure economic functions: income/upkeep and food. No dice, no I/O — fully
// deterministic and unit-testable. resolve.ts composes these into a tick and
// feeds their shortfalls into the clocks step. All tunable numbers are named
// constants here so the model can deepen without re-architecting.
import type { TRealm, TTaxLevel } from './schema';

export const BASE_INCOME = 20;
export const UPKEEP_BASE = 10;
export const HOLDING_UPKEEP_PER_TIER = 2;
export const ARMY_UPKEEP_PER_STRENGTH = 1;

// Per-turn yields a built holding contributes, scaled by tier. Gold yields flow
// into income each tick; food/manpower yields are applied once when the holding
// is built (see resolve.ts) so stored production stays the single source.
export const HOLDING_YIELDS: Record<string, { gold?: number; food?: number; manpower?: number }> = {
  market: { gold: 10 },
  mine: { gold: 15 },
  granary: { food: 8 },
  farm: { food: 12 },
  barracks: { manpower: 5 },
};

// Tax policy scales taxable income. High tax also drives unrest, applied in the
// clocks step (resolve.ts), not here.
export const TAX_INCOME_MULT: Record<TTaxLevel, number> = { low: 0.75, normal: 1, high: 1.5 };

export interface IncomeBreakdown {
  base: number;
  holdings: number;     // Σ gold yields × tier
  taxModifier: number;  // delta from tax policy on (base + holdings)
  gross: number;        // base + holdings + taxModifier
  upkeep: number;
  net: number;          // gross − upkeep (may be negative)
}

export function computeIncome(realm: Pick<TRealm, 'policies' | 'holdings' | 'army'>): IncomeBreakdown {
  const base = BASE_INCOME;
  const holdings = realm.holdings.reduce(
    (sum, h) => sum + (HOLDING_YIELDS[h.id]?.gold ?? 0) * h.tier,
    0,
  );
  const taxable = base + holdings;
  const mult = TAX_INCOME_MULT[realm.policies.tax];
  const gross = Math.round(taxable * mult);
  const taxModifier = gross - taxable;
  const upkeep =
    UPKEEP_BASE +
    realm.holdings.reduce((sum, h) => sum + HOLDING_UPKEEP_PER_TIER * h.tier, 0) +
    realm.army.strength * ARMY_UPKEEP_PER_STRENGTH;
  const net = gross - upkeep;
  return { base, holdings, taxModifier, gross, upkeep, net };
}

export interface IncomeApplication {
  treasury: number;   // new treasury, floored at 0
  shortfall: number;  // unfunded gap (≥ 0) that must cascade into unrest/stability
}

// Treasury never goes negative: it floors at 0 and the unfunded gap is returned
// for the clocks step to convert into unrest/stability pressure (honesty invariant).
export function applyIncome(treasury: number, net: number): IncomeApplication {
  const after = treasury + net;
  if (after < 0) return { treasury: 0, shortfall: -after };
  return { treasury: after, shortfall: 0 };
}

export interface FoodResult {
  production: number;
  consumption: number;
  surplus: number;   // production − consumption (may be negative)
  stock: number;     // new stock, floored at 0
  shortage: number;  // unmet consumption after stock depleted (≥ 0)
}

// Food can't be hidden: consumption is always applied. Surplus banks into stock;
// a shortfall depletes stock to 0 and surfaces the shortage for the clocks step.
export function resolveFood(food: { stock: number; production: number; consumption: number }): FoodResult {
  const surplus = food.production - food.consumption;
  const after = food.stock + surplus;
  if (after < 0) return { production: food.production, consumption: food.consumption, surplus, stock: 0, shortage: -after };
  return { production: food.production, consumption: food.consumption, surplus, stock: after, shortage: 0 };
}
