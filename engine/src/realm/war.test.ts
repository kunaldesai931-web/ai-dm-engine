import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growThreat, announceInvasion, INVASION_THRESHOLD, INVASION_WARNING_TURNS } from './war';

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
