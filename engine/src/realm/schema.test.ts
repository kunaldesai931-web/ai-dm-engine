import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRealm } from './schema';
import { EngineError } from '../core/errors';

// A minimal, valid realm state. Tests mutate clones of this to probe invariants.
function validRealm(): any {
  return {
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
  };
}

test('parseRealm accepts a minimal valid realm', () => {
  const r = parseRealm(validRealm());
  assert.equal(r.meta.realm, 'Duchy of Vael');
  assert.equal(r.resources.treasury, 100);
  assert.equal(r.clocks.unrest, 2);
});

test('parseRealm rejects negative treasury', () => {
  const bad = validRealm();
  bad.resources.treasury = -5;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects unrest above its [0,10] range', () => {
  const bad = validRealm();
  bad.clocks.unrest = 11;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects unrest below 0', () => {
  const bad = validRealm();
  bad.clocks.unrest = -1;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects stability outside [-5,5]', () => {
  const bad = validRealm();
  bad.clocks.stability = 6;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects prosperity outside [-5,5]', () => {
  const bad = validRealm();
  bad.clocks.prosperity = -6;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects a negative rng cursor', () => {
  const bad = validRealm();
  bad.rng.cursor = -1;
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm rejects an unknown tax policy', () => {
  const bad = validRealm();
  bad.policies.tax = 'confiscatory';
  assert.throws(() => parseRealm(bad), EngineError);
});

test('parseRealm defaults holdings and pending to empty arrays', () => {
  const base = validRealm();
  delete base.holdings;
  delete base.pending;
  const r = parseRealm(base);
  assert.deepEqual(r.holdings, []);
  assert.deepEqual(r.pending, []);
});

test('parseRealm defaults tax to normal when policies omitted', () => {
  const base = validRealm();
  delete base.policies;
  const r = parseRealm(base);
  assert.equal(r.policies.tax, 'normal');
});
