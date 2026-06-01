import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from './bridge';

function realmWith(over: any = {}): any {
  return {
    meta: { realm: 'Duchy of Vael', turn: 3 },
    resources: { treasury: 120, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 },
    clocks: { stability: 1, unrest: 2, prosperity: 0 },
    ...over,
  };
}

test('buildDigest carries the realm name and turn', () => {
  const d = buildDigest(realmWith());
  assert.equal(d.realm, 'Duchy of Vael');
  assert.equal(d.turn, 3);
});

test('treasuryTier rises with treasury and is a word, not a number', () => {
  const empty = buildDigest(realmWith({ resources: { treasury: 0, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } })).treasuryTier;
  const flush = buildDigest(realmWith({ resources: { treasury: 500, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } })).treasuryTier;
  assert.equal(typeof empty, 'string');
  assert.notEqual(empty, flush);
  assert.match(empty, /[a-z]/i);
  assert.doesNotMatch(empty, /\d/); // descriptor, not a raw number
});

test('unrest descriptor spans calm (low) to revolt (high)', () => {
  const calm = buildDigest(realmWith({ clocks: { stability: 1, unrest: 0, prosperity: 0 } })).unrest;
  const revolt = buildDigest(realmWith({ clocks: { stability: 1, unrest: 10, prosperity: 0 } })).unrest;
  assert.notEqual(calm, revolt);
  assert.doesNotMatch(revolt, /\d/);
});

test('stability descriptor changes with the clock', () => {
  const low = buildDigest(realmWith({ clocks: { stability: -5, unrest: 2, prosperity: 0 } })).stability;
  const high = buildDigest(realmWith({ clocks: { stability: 5, unrest: 2, prosperity: 0 } })).stability;
  assert.notEqual(low, high);
});

test('an empty treasury surfaces as a crisis', () => {
  const d = buildDigest(realmWith({ resources: { treasury: 0, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } }));
  assert.ok(d.crises.some((c) => /treasur/i.test(c)), `crises ${JSON.stringify(d.crises)}`);
});

test('a food deficit surfaces as a grain/food crisis', () => {
  const d = buildDigest(realmWith({ resources: { treasury: 120, food: { stock: 0, production: 10, consumption: 40 }, manpower: 0 } }));
  assert.ok(d.crises.some((c) => /grain|food|hunger|famine/i.test(c)), `crises ${JSON.stringify(d.crises)}`);
});

test('a healthy realm has no crises', () => {
  const d = buildDigest(realmWith());
  assert.deepEqual(d.crises, []);
});

test('sinceLastDigest passes through verbatim', () => {
  const d = buildDigest(realmWith(), ['raised taxes', 'market built']);
  assert.deepEqual(d.sinceLastDigest, ['raised taxes', 'market built']);
});
