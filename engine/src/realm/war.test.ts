import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growThreat, announceInvasion, resolveBattle, INVASION_THRESHOLD, INVASION_WARNING_TURNS } from './war';
import { makeRoller, type Roller } from '../core/rng';

test('growThreat rises by the base amount in a poor, small realm', () => {
  const next = growThreat(0, /*prosperity*/ 0, /*holdings*/ 0);
  assert.ok(next > 0, `threat grew to ${next}`);
});

test('growThreat rises faster in a prosperous, sprawling realm', () => {
  const poor = growThreat(10, 0, 0);
  const rich = growThreat(10, 5, 8);
  assert.ok(rich > poor, `rich ${rich} > poor ${poor}`);
});

test('announceInvasion scales force with the threat that summoned it', () => {
  const small = announceInvasion(INVASION_THRESHOLD, 1);
  const big = announceInvasion(INVASION_THRESHOLD * 3, 1);
  assert.ok(big.force > small.force, `big ${big.force} > small ${small.force}`);
  assert.equal(small.strikesIn, INVASION_WARNING_TURNS);
});

test('announceInvasion picks a non-empty invader name deterministically by turn', () => {
  const a = announceInvasion(20, 7).invader;
  const b = announceInvasion(20, 7).invader;
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

// A roller stub returning fixed die values in sequence (then repeating the last).
function fixedRoller(values: number[]): Roller {
  let i = 0;
  return { die: () => values[Math.min(i++, values.length - 1)], consumed: () => ({ from: 0, to: i }) };
}

test('resolveBattle: a vastly superior army wins regardless of the dice', () => {
  const o = resolveBattle(100, 1.0, 5, fixedRoller([1, 20])); // worst roll for us, best for them
  assert.equal(o.win, true);
  assert.equal(o.effective, 100);
});

test('resolveBattle: a tiny army loses regardless of the dice', () => {
  const o = resolveBattle(1, 1.0, 100, fixedRoller([20, 1])); // best for us, worst for them
  assert.equal(o.win, false);
});

test('resolveBattle: quality multiplies effective force', () => {
  const o = resolveBattle(10, 2.0, 0, fixedRoller([10, 10]));
  assert.equal(o.effective, 20);
});

test('resolveBattle consumes exactly two dice', () => {
  const roller = makeRoller({ seed: 'war', cursor: 0 });
  resolveBattle(10, 1.0, 10, roller);
  assert.deepEqual(roller.consumed(), { from: 0, to: 2 });
});

test('resolveBattle is deterministic for a fixed seed and cursor', () => {
  const a = resolveBattle(10, 1.0, 10, makeRoller({ seed: 'war', cursor: 3 }));
  const b = resolveBattle(10, 1.0, 10, makeRoller({ seed: 'war', cursor: 3 }));
  assert.deepEqual(a, b);
});
