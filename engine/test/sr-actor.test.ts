import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShadowrunActor, physicalMonitorMax, stunMonitorMax } from '../src/shadowrun/actor.js';
import { EngineError } from '../src/core/errors.js';

function validRunner(): any {
  return {
    name: 'Razor', sr: true,
    attributes: { body: 5, agility: 6, reaction: 5, strength: 4, willpower: 4, logic: 3, intuition: 4, charisma: 3, edge: 3, magic: 0 },
    skills: { firearms: 6, athletics: 4 },
    monitors: { physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } },
    edgeCurrent: 3, armor: 9,
  };
}

test('monitor maxes follow the formula', () => {
  assert.equal(physicalMonitorMax(5), 11); // 8 + ceil(5/2)=3
  assert.equal(stunMonitorMax(4), 10);     // 8 + ceil(4/2)=2
  assert.equal(physicalMonitorMax(6), 11); // 8 + 3
});

test('parseShadowrunActor accepts a valid runner', () => {
  const a = parseShadowrunActor(validRunner());
  assert.equal(a.name, 'Razor');
  assert.equal(a.attributes.agility, 6);
});

test('parseShadowrunActor rejects a non-sr object', () => {
  const bad = validRunner(); delete bad.sr;
  assert.throws(() => parseShadowrunActor(bad), EngineError);
});

test('parseShadowrunActor rejects missing attributes', () => {
  const bad = validRunner(); delete bad.attributes.body;
  assert.throws(() => parseShadowrunActor(bad), EngineError);
});

test('parseShadowrunActor accepts an awakened mage with spells', () => {
  const m = validRunner();
  m.attributes.magic = 5; m.tradition = 'hermetic';
  m.spells = [{ name: 'Manabolt', drain: 3 }];
  const a = parseShadowrunActor(m);
  assert.equal(a.tradition, 'hermetic');
  assert.equal(a.spells![0].drain, 3);
});
