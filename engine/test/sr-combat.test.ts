import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soak, applyDamage, initiative } from '../src/shadowrun/combat.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}
function runner(over: any = {}): any {
  return {
    name: 'R', sr: true,
    attributes: { body: 5, agility: 4, reaction: 4, strength: 4, willpower: 4, logic: 3, intuition: 4, charisma: 3, edge: 3, magic: 0 },
    skills: {}, monitors: { physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } },
    edgeCurrent: 3, armor: 6, ...over,
  };
}

test('soak rolls Body + (armor - AP) and reduces damage by hits', () => {
  // body 5 + (armor 6 - ap 2) = 8 dice; script 3 hits
  const a = runner();
  const r = soak(a, fakeRoller([5, 6, 5, 2, 2, 2, 2, 2]), 8, 2);
  assert.equal(r.hits, 3);
  assert.equal(r.netDamage, 5); // 8 - 3
});

test('applyDamage fills the physical monitor and reports status', () => {
  const a = runner();
  const res = applyDamage(a.monitors, 5, 'physical', a.attributes.body);
  assert.equal(res.monitors.physical.damage, 5);
  assert.equal(res.status, 'wounded');
});

test('physical filled past max is down; past max+body is dead', () => {
  const a = runner();
  const down = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 11, 'physical', 5);
  assert.equal(down.status, 'down');
  const dead = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 17, 'physical', 5);
  assert.equal(dead.status, 'dead'); // 17 > 11 + 5
});

test('stun overflow rolls into physical 1:1', () => {
  const res = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 13, 'stun', 5);
  assert.equal(res.monitors.stun.damage, 10);      // capped
  assert.equal(res.monitors.physical.damage, 3);   // 13 - 10 overflow
});

test('initiative = reaction + intuition + hits', () => {
  const a = runner(); // reaction 4 + intuition 4 = 8 base
  const r = initiative(a, fakeRoller([5, 6, 2, 2, 2, 2, 2, 2])); // R+I=8 dice, 2 hits
  assert.equal(r.score, 8);
  assert.equal(r.hits, 2);
  assert.equal(r.total, 10);
});
