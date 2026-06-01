import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick } from './resolve';
import { parseRealm } from './schema';
import type { RealmEvent } from './events';

function validRealm(over: any = {}): any {
  return parseRealm({
    meta: { realm: 'Duchy of Vael', ruler: 'Aldric', turn: 0,
            calendar: { unit: 'season', value: 'Summer 1387' } },
    rng: { seed: 'vael-1387', cursor: 0 },
    resources: { treasury: 100, food: { stock: 80, production: 30, consumption: 26 }, manpower: 150 },
    clocks: { stability: 1, unrest: 2, prosperity: 0 },
    policies: { tax: 'normal' },
    holdings: [{ id: 'market', tier: 1 }],
    army: { strength: 0 },
    pending: [],
    event: null,
    ...over,
  });
}

const QUIET: RealmEvent[] = [{ id: 'quiet', title: 'Quiet', weight: 1, kind: 'auto', effects: {} }];
const BOON: RealmEvent[] = [{ id: 'boon', title: 'Boon', weight: 1, kind: 'auto',
  effects: { clocks: { unrest: 1 }, resources: { treasury: 5 } } }];
const CATACLYSM: RealmEvent[] = [{ id: 'cataclysm', title: 'Doom', weight: 1, kind: 'auto',
  effects: { clocks: { unrest: 20, stability: -20 } } }];
const OFFER: RealmEvent[] = [{ id: 'offer', title: 'Offer', weight: 1, kind: 'choice',
  options: [{ id: 'take', label: 'Take', effects: { resources: { treasury: 1000 } } },
            { id: 'pass', label: 'Pass', effects: {} }] }];

test('tick advances the turn counter by one', () => {
  const { realm } = tick(validRealm({ meta: { realm: 'V', turn: 3, calendar: { unit: 'season', value: 'Summer 1387' } } }), { eventTable: QUIET });
  assert.equal(realm.meta.turn, 4);
});

test('tick advances the rng cursor forward (never rewinds)', () => {
  const before = validRealm();
  const { realm } = tick(before, { eventTable: QUIET });
  assert.ok(realm.rng.cursor > before.rng.cursor, `${realm.rng.cursor} > ${before.rng.cursor}`);
});

test('tick does not mutate the input realm', () => {
  const before = validRealm();
  const snapshot = structuredClone(before);
  tick(before, { eventTable: BOON });
  assert.deepEqual(before, snapshot);
});

test('tick is deterministic for the same input and event table', () => {
  const a = tick(validRealm(), { eventTable: BOON });
  const b = tick(validRealm(), { eventTable: BOON });
  assert.equal(a.realm.resources.treasury, b.realm.resources.treasury);
  assert.equal(a.realm.rng.cursor, b.realm.rng.cursor);
  assert.deepEqual(a.realm.clocks, b.realm.clocks);
});

test('INVARIANT: treasury is never negative after a tick', () => {
  // tiny treasury, expensive army → guaranteed deficit
  const r = validRealm({ resources: { treasury: 3, food: { stock: 80, production: 30, consumption: 26 }, manpower: 200 },
                         army: { strength: 50 } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.resources.treasury >= 0, `treasury ${realm.resources.treasury} >= 0`);
});

test('INVARIANT: all clocks stay in range after a tick, and the clamp is surfaced', () => {
  const { realm, report } = tick(validRealm({ clocks: { stability: 0, unrest: 0, prosperity: 0 } }), { eventTable: CATACLYSM });
  assert.ok(realm.clocks.unrest <= 10, `unrest ${realm.clocks.unrest} <= 10`);
  assert.ok(realm.clocks.stability >= -5, `stability ${realm.clocks.stability} >= -5`);
  assert.ok(report.clamps.length > 0, 'clamp surfaced in report');
  // the persisted state must satisfy the schema (final guard)
  assert.doesNotThrow(() => parseRealm(realm));
});

test('an auto event applies its effects during the tick', () => {
  const { realm, report } = tick(validRealm(), { eventTable: BOON });
  assert.equal(report.event.id, 'boon');
  assert.equal(report.event.applied, true);
});

test('a choice event is stored on realm.event and NOT auto-applied', () => {
  const { realm, report } = tick(validRealm({ resources: { treasury: 100, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } }), { eventTable: OFFER });
  assert.equal(report.event.id, 'offer');
  assert.equal(report.event.applied, false);
  assert.equal(realm.event.id, 'offer');           // awaiting `realm choose`
  assert.ok(realm.resources.treasury < 1000);       // the +1000 option was NOT applied
});

test('a queued build completes: holding added, pending cleared', () => {
  const r = validRealm({ holdings: [], pending: [{ kind: 'build', id: 'granary' }] });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.holdings.some((h: any) => h.id === 'granary'), 'granary built');
  assert.deepEqual(realm.pending, []);
});

test('an income shortfall drives unrest higher than a balanced realm', () => {
  const balanced = tick(validRealm(), { eventTable: QUIET }).realm;
  const broke = tick(validRealm({ resources: { treasury: 0, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 }, army: { strength: 50 } }), { eventTable: QUIET }).realm;
  assert.ok(broke.clocks.unrest > balanced.clocks.unrest, `broke ${broke.clocks.unrest} > balanced ${balanced.clocks.unrest}`);
});

// --- feedback loops (balance pass): clocks must regress, not ratchet ---

test('FEEDBACK: unrest decays when the realm is calm and well-run', () => {
  const r = validRealm({ clocks: { stability: 0, unrest: 5, prosperity: 0 }, policies: { tax: 'low' } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.clocks.unrest < 5, `unrest ${realm.clocks.unrest} cooled from 5`);
});

test('FEEDBACK: sustained high unrest erodes stability', () => {
  const r = validRealm({ clocks: { stability: 0, unrest: 8, prosperity: 0 } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.clocks.stability < 0, `stability ${realm.clocks.stability} eroded by unrest`);
});

test('FEEDBACK: a content, prosperous realm consolidates stability', () => {
  const r = validRealm({ clocks: { stability: 0, unrest: 0, prosperity: 3 }, policies: { tax: 'low' } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.clocks.stability > 0, `stability ${realm.clocks.stability} consolidated`);
});

test('FEEDBACK: prosperity erodes when the realm lives beyond its means', () => {
  const r = validRealm({ clocks: { stability: 0, unrest: 0, prosperity: 3 },
    resources: { treasury: 100, food: { stock: 80, production: 10, consumption: 30 }, manpower: 0 } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.clocks.prosperity < 3, `prosperity ${realm.clocks.prosperity} faded`);
});

test('FEEDBACK: building grows food consumption (the realm gains population)', () => {
  const r = validRealm({ holdings: [], pending: [{ kind: 'build', id: 'granary' }],
    resources: { treasury: 100, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.resources.food.consumption > 26, `consumption ${realm.resources.food.consumption} grew past 26`);
});
