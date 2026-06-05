import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollPool } from '../src/shadowrun/dice.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}

test('counts 5s and 6s as hits', () => {
  const r = rollPool(fakeRoller([5, 6, 4, 2, 6]), 5);
  assert.equal(r.hits, 3);
  assert.equal(r.glitch, false);
});

test('glitch when half-or-more dice are 1s', () => {
  // 5 dice, ceil(5/2)=3 ones needed
  const r = rollPool(fakeRoller([1, 1, 1, 6, 4]), 5);
  assert.equal(r.ones, 3);
  assert.equal(r.glitch, true);
  assert.equal(r.critGlitch, false); // there was a hit
});

test('critical glitch = glitch with zero hits', () => {
  const r = rollPool(fakeRoller([1, 1, 1, 2, 4]), 5);
  assert.equal(r.glitch, true);
  assert.equal(r.hits, 0);
  assert.equal(r.critGlitch, true);
});

test('threshold sets success and net hits', () => {
  const r = rollPool(fakeRoller([5, 6, 6, 2]), 4, 2);
  assert.equal(r.hits, 3);
  assert.equal(r.success, true);
  assert.equal(r.net, 1);
});

test('no threshold leaves success/net null', () => {
  const r = rollPool(fakeRoller([5, 2]), 2);
  assert.equal(r.success, null);
  assert.equal(r.net, null);
});

test('empty pool never glitches', () => {
  const r = rollPool(fakeRoller([]), 0);
  assert.equal(r.hits, 0);
  assert.equal(r.glitch, false);
});
