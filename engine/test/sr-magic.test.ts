import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSpell } from '../src/shadowrun/magic.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}

test('cast hits scale with the casting pool; drain resisted reduces DV', () => {
  // casting pool 8 (script 3 hits), then drain resist pool 6 (script 2 hits)
  const r = castSpell(fakeRoller([5, 6, 5, 2, 2, 2, 2, 2,  6, 6, 2, 2, 2, 2]), { force: 4, magic: 6, castingPool: 8, drainValue: 3, drainResistPool: 6 });
  assert.equal(r.castHits, 3);
  assert.equal(r.drainResistHits, 2);
  assert.equal(r.drainTaken, 1);       // max(0, 3 - 2)
  assert.equal(r.drainType, 'stun');   // force 4 <= magic 6, not overcast
});

test('overcasting (force > magic) makes drain physical', () => {
  const r = castSpell(fakeRoller([5, 2, 2,  2, 2, 2, 2]), { force: 8, magic: 6, castingPool: 3, drainValue: 5, drainResistPool: 4 });
  assert.equal(r.drainType, 'physical');
  assert.equal(r.drainTaken, 5);       // 0 resist hits
});

test('drain fully resisted is zero', () => {
  const r = castSpell(fakeRoller([5, 5,  6, 6, 6, 6]), { force: 3, magic: 6, castingPool: 2, drainValue: 2, drainResistPool: 4 });
  assert.equal(r.drainTaken, 0);
});
