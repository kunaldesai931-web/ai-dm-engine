// The `realm tick` resolution pipeline — the engine moment. A pure function
// (realm) → (new realm, report): clone in, advance the forward-only RNG cursor,
// run the deterministic 7 steps, enforce every invariant, hand back a report the
// CLI persists/logs/narrates. No I/O here; resolve owns the numbers, not the LLM.
import { makeRoller } from '../core/rng';
import { computeIncome, applyIncome, resolveFood, HOLDING_YIELDS, type IncomeBreakdown, type FoodResult } from './economy';
import { drawEvent, applyEventEffects, EVENT_TABLE, type RealmEvent } from './events';
import type { TRealm } from './schema';

// Derived clock pressures — named so the model can be tuned in one place.
const TAX_UNREST_HIGH = 1;             // high tax breeds resentment
const SHORTFALL_UNREST_DIVISOR = 10;   // +1 unrest per 10 gold of unfunded upkeep
const SHORTFALL_STABILITY_AT = 30;     // a large shortfall also cracks stability
const SHORTAGE_UNREST_DIVISOR = 8;     // +1 unrest per 8 food of shortage
const SHORTAGE_STABILITY_AT = 20;      // a famine cracks stability
const SURPLUS_PROSPERITY_AT = 20;      // a fat surplus nudges prosperity up

const CLOCK_RANGE = {
  stability: [-5, 5],
  unrest: [0, 10],
  prosperity: [-5, 5],
} as const;

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export interface TickOptions {
  eventTable?: RealmEvent[];
}

export interface TickReport {
  turn: number;
  calendar: string;
  income: IncomeBreakdown & { shortfall: number };
  food: FoodResult;
  event: { id: string; title: string; kind: 'auto' | 'choice'; applied: boolean };
  builds: string[];
  clockDelta: { stability: number; unrest: number; prosperity: number };
  clamps: string[];
}

function advanceCalendar(cal: { unit: string; value: string }): { unit: string; value: string } {
  if (cal.unit !== 'season') return cal;
  const m = cal.value.match(/^([A-Za-z]+)\s+(\d+)$/);
  if (!m) return cal;
  const idx = SEASONS.indexOf(m[1] as (typeof SEASONS)[number]);
  if (idx === -1) return cal;
  let year = parseInt(m[2], 10);
  const nextIdx = (idx + 1) % 4;
  if (nextIdx === 0) year += 1; // wrapping past Winter advances the year
  return { unit: 'season', value: `${SEASONS[nextIdx]} ${year}` };
}

function clamp(value: number, [lo, hi]: readonly [number, number]): number {
  return Math.max(lo, Math.min(hi, value));
}

// Clamp all three clocks to their ranges, surfacing every clamp. Shared by the
// tick pipeline and the `realm choose` command so the invariant lives in one place.
export function clampClocks(clocks: { stability: number; unrest: number; prosperity: number }): {
  clocks: { stability: number; unrest: number; prosperity: number };
  clamps: string[];
} {
  const out = { ...clocks };
  const clamps: string[] = [];
  for (const k of ['stability', 'unrest', 'prosperity'] as const) {
    const clamped = clamp(out[k], CLOCK_RANGE[k]);
    if (clamped !== out[k]) clamps.push(`${k} ${out[k]}→${clamped}`);
    out[k] = clamped;
  }
  return { clocks: out, clamps };
}

export function tick(input: TRealm, opts: TickOptions = {}): { realm: TRealm; report: TickReport } {
  const realm: any = structuredClone(input);
  const roller = makeRoller(realm.rng); // mutates realm.rng.cursor forward
  const table = opts.eventTable ?? EVENT_TABLE;
  const before = { ...realm.clocks };

  // 1. Advance turn + calendar.
  realm.meta.turn += 1;
  realm.meta.calendar = advanceCalendar(realm.meta.calendar);

  // 2. Income → treasury (floored at 0; unfunded gap captured for the clocks step).
  const incomeBreakdown = computeIncome(realm);
  const incomeApplied = applyIncome(realm.resources.treasury, incomeBreakdown.net);
  realm.resources.treasury = incomeApplied.treasury;
  const shortfall = incomeApplied.shortfall;
  const income = { ...incomeBreakdown, shortfall };

  // 3. Food → stock (floored at 0; shortage captured).
  const food = resolveFood(realm.resources.food);
  realm.resources.food = { ...realm.resources.food, stock: food.stock };

  // 4. Event draw — auto-apply effects, or pause for a choice.
  const drawn = drawEvent(roller, table);
  let applied = false;
  if (drawn.kind === 'auto') {
    const next = applyEventEffects(realm, drawn.effects ?? {});
    realm.clocks = next.clocks;
    realm.resources = next.resources;
    realm.event = null;
    applied = true;
  } else {
    realm.event = { id: drawn.id, title: drawn.title, options: drawn.options };
  }

  // 5. Resolve pending[] — builds complete; edicts apply effects. (No dice in v1.)
  const builds: string[] = [];
  for (const item of realm.pending as any[]) {
    if (item.kind === 'build') {
      const existing = realm.holdings.find((h: any) => h.id === item.id);
      if (existing) existing.tier += 1;
      else realm.holdings.push({ id: item.id, tier: 1 });
      const tier = existing ? existing.tier : 1;
      // One-time application of non-gold yields into stored production / manpower.
      const yields = HOLDING_YIELDS[item.id];
      if (yields?.food) realm.resources.food.production += yields.food * tier;
      if (yields?.manpower) realm.resources.manpower += yields.manpower * tier;
      builds.push(item.id);
    } else if (item.kind === 'edict' && item.effects) {
      const next = applyEventEffects(realm, item.effects);
      realm.clocks = next.clocks;
      realm.resources = next.resources;
    }
  }
  realm.pending = [];

  // 6. Clocks — derived pressure, then clamp (surfacing the clamp).
  if (realm.policies.tax === 'high') realm.clocks.unrest += TAX_UNREST_HIGH;
  if (shortfall > 0) {
    realm.clocks.unrest += Math.ceil(shortfall / SHORTFALL_UNREST_DIVISOR);
    if (shortfall >= SHORTFALL_STABILITY_AT) realm.clocks.stability -= 1;
  }
  if (food.shortage > 0) {
    realm.clocks.unrest += Math.ceil(food.shortage / SHORTAGE_UNREST_DIVISOR);
    if (food.shortage >= SHORTAGE_STABILITY_AT) realm.clocks.stability -= 1;
  } else if (food.surplus >= SURPLUS_PROSPERITY_AT) {
    realm.clocks.prosperity += 1;
  }

  const { clocks: clampedClocks, clamps } = clampClocks(realm.clocks);
  realm.clocks = clampedClocks;

  const report: TickReport = {
    turn: realm.meta.turn,
    calendar: realm.meta.calendar.value,
    income,
    food,
    event: { id: drawn.id, title: drawn.title, kind: drawn.kind, applied },
    builds,
    clockDelta: {
      stability: realm.clocks.stability - before.stability,
      unrest: realm.clocks.unrest - before.unrest,
      prosperity: realm.clocks.prosperity - before.prosperity,
    },
    clamps,
  };

  return { realm: realm as TRealm, report };
}
