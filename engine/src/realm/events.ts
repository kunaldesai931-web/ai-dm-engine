// Weighted event tables + an auditable weighted draw. The draw consumes exactly
// one die from the shared forward-only roller, so the whole event history is
// replayable. Effects are additive deltas; resolve.ts applies/clamps them.
import type { Roller } from '../core/rng';

export interface EventEffects {
  clocks?: { stability?: number; unrest?: number; prosperity?: number };
  resources?: { treasury?: number; manpower?: number; food?: { stock?: number } };
}

export interface EventOption {
  id: string;
  label: string;
  effects: EventEffects;
}

export interface RealmEvent {
  id: string;
  title: string;
  weight: number;
  kind: 'auto' | 'choice';
  effects?: EventEffects;     // auto: applied immediately on tick
  options?: EventOption[];    // choice: stored on realm.event, applied by `realm choose`
}

// The v1 event table. Weights are relative; the draw is a uniform pick over the
// summed weight. Auto events resolve on the tick; choice events pause for input.
export const EVENT_TABLE: RealmEvent[] = [
  { id: 'quiet-season', title: 'A quiet season', weight: 4, kind: 'auto',
    effects: { clocks: { unrest: -1 } } }, // calm seasons cool tempers
  { id: 'good-harvest', title: 'A bountiful harvest', weight: 2, kind: 'auto',
    effects: { clocks: { prosperity: 1 }, resources: { food: { stock: 15 } } } },
  { id: 'bandit-raid', title: 'Bandits raid the roads', weight: 2, kind: 'auto',
    effects: { clocks: { unrest: 1 }, resources: { treasury: -10 } } },
  { id: 'unrest-stirring', title: 'Discontent stirs in the markets', weight: 2, kind: 'auto',
    effects: { clocks: { unrest: 1 } } },
  { id: 'merchant-offer', title: 'A merchant guild offers a deal', weight: 1, kind: 'choice',
    options: [
      { id: 'accept', label: 'Accept the gold and the strings attached',
        effects: { resources: { treasury: 25 }, clocks: { unrest: 1 } } },
      { id: 'decline', label: 'Decline; keep the crown unbeholden',
        effects: { clocks: { stability: 1 } } },
    ] },
];

// Uniform weighted pick consuming one die. die(W) returns 1..W; we walk the
// cumulative bands so entry i owns [Σw<i + 1, Σw≤i].
export function drawEvent(roller: Roller, table: RealmEvent[] = EVENT_TABLE): RealmEvent {
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  const roll = roller.die(total);
  let cumulative = 0;
  for (const e of table) {
    cumulative += e.weight;
    if (roll <= cumulative) return e;
  }
  return table[table.length - 1]; // unreachable for positive weights; defensive
}

// Additive application of an effects delta onto a realm. Returns a new object;
// does not clamp (resolve.ts clamps clocks in its dedicated step) and does not
// mutate the input.
export function applyEventEffects<R extends { clocks: any; resources: any }>(realm: R, effects: EventEffects): R {
  const next: any = {
    ...realm,
    clocks: { ...realm.clocks },
    resources: { ...realm.resources, food: realm.resources?.food ? { ...realm.resources.food } : undefined },
  };
  if (effects.clocks) {
    for (const k of ['stability', 'unrest', 'prosperity'] as const) {
      if (effects.clocks[k] != null) next.clocks[k] = (next.clocks[k] ?? 0) + effects.clocks[k]!;
    }
  }
  if (effects.resources) {
    if (effects.resources.treasury != null) next.resources.treasury = (next.resources.treasury ?? 0) + effects.resources.treasury;
    if (effects.resources.manpower != null) next.resources.manpower = (next.resources.manpower ?? 0) + effects.resources.manpower;
    if (effects.resources.food?.stock != null) {
      next.resources.food = { ...next.resources.food, stock: (next.resources.food?.stock ?? 0) + effects.resources.food.stock };
    }
  }
  return next;
}
