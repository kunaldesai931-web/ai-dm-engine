import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawEvent, applyEventEffects, EVENT_TABLE, type RealmEvent } from './events';
import { makeRoller, type Roller } from '../core/rng';

// A roller stub that always returns a fixed die value — lets us test the
// weighted-selection logic deterministically, independent of the RNG hash.
function fixedRoller(value: number): Roller {
  return { die: () => value, consumed: () => ({ from: 0, to: 1 }) };
}

const TABLE: RealmEvent[] = [
  { id: 'a', title: 'A', weight: 1, kind: 'auto', effects: {} },
  { id: 'b', title: 'B', weight: 2, kind: 'auto', effects: {} },
  { id: 'c', title: 'C', weight: 1, kind: 'auto', effects: {} },
];

test('drawEvent picks the entry whose cumulative-weight band holds the roll', () => {
  assert.equal(drawEvent(fixedRoller(1), TABLE).id, 'a'); // band [1,1]
  assert.equal(drawEvent(fixedRoller(2), TABLE).id, 'b'); // band [2,3]
  assert.equal(drawEvent(fixedRoller(3), TABLE).id, 'b');
  assert.equal(drawEvent(fixedRoller(4), TABLE).id, 'c'); // band [4,4]
});

test('drawEvent consumes exactly one die from the roller', () => {
  const roller = makeRoller({ seed: 'vael', cursor: 0 });
  drawEvent(roller, TABLE);
  assert.deepEqual(roller.consumed(), { from: 0, to: 1 });
});

test('drawEvent is deterministic for a fixed seed and cursor', () => {
  const a = drawEvent(makeRoller({ seed: 'vael', cursor: 7 }), TABLE).id;
  const b = drawEvent(makeRoller({ seed: 'vael', cursor: 7 }), TABLE).id;
  assert.equal(a, b);
});

test('drawEvent defaults to the built-in EVENT_TABLE', () => {
  const e = drawEvent(makeRoller({ seed: 'vael', cursor: 0 }));
  assert.ok(EVENT_TABLE.some((x) => x.id === e.id));
});

test('every built-in event has a positive weight and a known kind', () => {
  for (const e of EVENT_TABLE) {
    assert.ok(e.weight > 0, `${e.id} weight > 0`);
    assert.ok(e.kind === 'auto' || e.kind === 'choice', `${e.id} kind`);
    if (e.kind === 'choice') assert.ok((e.options?.length ?? 0) >= 2, `${e.id} has options`);
  }
});

// --- applyEventEffects (additive; clamping happens later in resolve) ---

test('applyEventEffects adds clock and resource deltas without mutating the input', () => {
  const realm: any = {
    clocks: { stability: 1, unrest: 2, prosperity: 0 },
    resources: { treasury: 100, manpower: 50, food: { stock: 80, production: 30, consumption: 26 } },
  };
  const next = applyEventEffects(realm, {
    clocks: { unrest: 1, prosperity: -1 },
    resources: { treasury: -10, food: { stock: 15 } },
  });
  assert.equal(next.clocks.unrest, 3);
  assert.equal(next.clocks.prosperity, -1);
  assert.equal(next.resources.treasury, 90);
  assert.equal(next.resources.food.stock, 95);
  // input untouched
  assert.equal(realm.clocks.unrest, 2);
  assert.equal(realm.resources.treasury, 100);
});

test('applyEventEffects may push a clock past its range (resolve clamps later)', () => {
  const realm: any = { clocks: { stability: 5, unrest: 0, prosperity: 0 }, resources: {} };
  const next = applyEventEffects(realm, { clocks: { stability: 3 } });
  assert.equal(next.clocks.stability, 8); // raw add; not clamped here
});
