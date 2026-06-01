// The `realm tick` resolution pipeline — the engine moment. A pure function
// (realm) → (new realm, report): clone in, advance the forward-only RNG cursor,
// run the deterministic 7 steps, enforce every invariant, hand back a report the
// CLI persists/logs/narrates. No I/O here; resolve owns the numbers, not the LLM.
import { makeRoller } from '../core/rng';
import { computeIncome, applyIncome, resolveFood, HOLDING_YIELDS, type IncomeBreakdown, type FoodResult } from './economy';
import { drawEvent, applyEventEffects, EVENT_TABLE, type RealmEvent } from './events';
import type { TRealm } from './schema';

// Derived clock pressures — named so the model can be tuned in one place. The
// clocks must REGRESS, not ratchet: every pusher has a counter-pull so a well-run
// realm cools and a mismanaged one heats up, instead of saturating and sticking.
//
// Unrest — pushers:
const TAX_UNREST_HIGH = 1;             // high tax breeds resentment
const SHORTFALL_UNREST_DIVISOR = 10;   // +1 unrest per 10 gold of unfunded upkeep
const SHORTAGE_UNREST_DIVISOR = 8;     // +1 unrest per 8 food of shortage
// Unrest — relievers (the missing feedback):
const TAX_UNREST_LOW_RELIEF = 1;       // a light hand on the purse calms the realm
const PROSPERITY_RELIEF_AT = 3;        // a thriving populace (prosperity ≥ this) cools by 1
const CALM_COOLDOWN = 1;               // tempers cool when there's no deficit/famine/high tax
//
// Stability — coupled to unrest so a maxed unrest clock has real teeth, and so a
// content realm can recover (the clock was inert before):
const SHORTFALL_STABILITY_AT = 30;     // a large shortfall cracks stability
const SHORTAGE_STABILITY_AT = 20;      // a famine cracks stability
const UNREST_EROSION_AT = 7;           // sustained high unrest erodes the throne
const CONTENT_UNREST_MAX = 2;          // a calm (unrest ≤ this) ...
const CONTENT_PROSPERITY_MIN = 2;      // ... and prosperous realm consolidates stability
//
// Prosperity — surplus grows it; living beyond your means erodes it (no more
// sticking at the cap forever):
const SURPLUS_PROSPERITY_AT = 20;      // a fat food surplus nudges prosperity up
//
// Population — every built holding grows food consumption, so a sprawling realm
// can't bank an infinite surplus (the economic counter-pull on growth):
const POP_CONSUMPTION_PER_HOLDING = 3;

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
      // The realm gains population: more mouths to feed each turn. This is the
      // counter-pull that stops a big realm banking an infinite food surplus.
      realm.resources.food.consumption += POP_CONSUMPTION_PER_HOLDING;
      builds.push(item.id);
    } else if (item.kind === 'edict' && item.effects) {
      const next = applyEventEffects(realm, item.effects);
      realm.clocks = next.clocks;
      realm.resources = next.resources;
    }
  }
  realm.pending = [];

  // 6. Clocks — derived pressure with counter-pulls, then clamp (surfacing it).
  const tax = realm.policies.tax;

  // 6a. Unrest — pushers then relievers, so the clock cools when well-run.
  if (tax === 'high') realm.clocks.unrest += TAX_UNREST_HIGH;
  if (shortfall > 0) realm.clocks.unrest += Math.ceil(shortfall / SHORTFALL_UNREST_DIVISOR);
  if (food.shortage > 0) realm.clocks.unrest += Math.ceil(food.shortage / SHORTAGE_UNREST_DIVISOR);
  const calm = shortfall === 0 && food.shortage === 0;
  if (tax === 'low') realm.clocks.unrest -= TAX_UNREST_LOW_RELIEF;
  if (realm.clocks.prosperity >= PROSPERITY_RELIEF_AT) realm.clocks.unrest -= 1;
  if (calm && tax !== 'high') realm.clocks.unrest -= CALM_COOLDOWN;

  // 6b. Stability — shocks crack it; sustained unrest erodes it; a content,
  // prosperous realm consolidates. (Evaluated against this turn's unrest.)
  if (shortfall >= SHORTFALL_STABILITY_AT) realm.clocks.stability -= 1;
  if (food.shortage >= SHORTAGE_STABILITY_AT) realm.clocks.stability -= 1;
  if (realm.clocks.unrest >= UNREST_EROSION_AT) realm.clocks.stability -= 1;
  else if (realm.clocks.unrest <= CONTENT_UNREST_MAX && realm.clocks.prosperity >= CONTENT_PROSPERITY_MIN) {
    realm.clocks.stability += 1;
  }

  // 6c. Prosperity — a fat surplus grows it; living beyond your means erodes it.
  if (food.surplus >= SURPLUS_PROSPERITY_AT) realm.clocks.prosperity += 1;
  else if (food.surplus <= 0 && realm.clocks.prosperity > 0) realm.clocks.prosperity -= 1;

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
