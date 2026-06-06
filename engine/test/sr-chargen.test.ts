import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRunner, BUDGETS } from '../src/shadowrun/chargen.js';
import { parseShadowrunActor } from '../src/shadowrun/actor.js';
import { EngineError } from '../src/core/errors.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun');
const load = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const data = () => ({ metatypes: load('metatypes.json'), spells: load('spells.json'), powers: load('powers.json'), augmentations: load('augmentations.json') });

// bought attrs spend sum(v-1) = 3+4+3+2+2+1+2+1 = 18 <= 20
function samuraiInput(over: any = {}): any {
  return {
    name: 'Knox', metatype: 'ork',
    attributes: { body: 4, agility: 5, reaction: 4, strength: 3, willpower: 3, logic: 2, intuition: 3, charisma: 2 },
    skills: { firearms: 6, 'close-combat': 4, stealth: 3 },
    magicType: 'mundane', armor: 9,
    augmentations: ['wired-reflexes-1', 'muscle-replacement-2'],
    ...over,
  };
}

test('metatype modifiers + augmentations produce final attributes', () => {
  const a = assembleRunner(samuraiInput(), data());
  // ork mods: body +3, strength +2; muscle-replacement-2: agility +2, strength +2; wired-reflexes-1: reaction +1
  assert.equal(a.attributes.body, 7);       // 4 + 3
  assert.equal(a.attributes.strength, 7);   // 3 + 2 (ork) + 2 (muscle)
  assert.equal(a.attributes.agility, 7);    // 5 + 2 (muscle)
  assert.equal(a.attributes.reaction, 5);   // 4 + 1 (wired)
  assert.equal(a.initiativeDice, 1);        // wired-reflexes-1
  assert.equal(a.attributes.magic, 0);      // mundane
});

test('condition monitors computed from FINAL body/willpower', () => {
  const a = assembleRunner(samuraiInput(), data());
  assert.equal(a.monitors.physical.max, 8 + Math.ceil(7 / 2)); // final body 7 -> 12
  assert.equal(a.monitors.stun.max, 8 + Math.ceil(3 / 2));     // willpower 3 -> 10
});

test('armor = chosen + innate + augmentation mods', () => {
  // troll (armorInnate 1) + bone-lacing (+1); fixture attrs are within troll ranges
  const a = assembleRunner(samuraiInput({ metatype: 'troll', armor: 6, augmentations: ['bone-lacing'] }), data());
  assert.equal(a.armor, 6 + 1 + 1);
});

test('the assembled runner is a valid ShadowrunActor', () => {
  parseShadowrunActor(assembleRunner(samuraiInput(), data()));
});

test('rejects spending more than the attribute budget', () => {
  const bad = samuraiInput({ attributes: { body: 6, agility: 6, reaction: 6, strength: 6, willpower: 6, logic: 5, intuition: 6, charisma: 5 } });
  assert.throws(() => assembleRunner(bad, data()), EngineError); // sum within ork ranges but > 20 points
});

test('rejects a bought attribute outside the metatype range', () => {
  // ork charisma bought max is 5
  assert.throws(() => assembleRunner(samuraiInput({ attributes: { ...samuraiInput().attributes, charisma: 6 } }), data()), EngineError);
});

test('rejects spending more than the skill budget', () => {
  assert.throws(() => assembleRunner(samuraiInput({ skills: { firearms: 6, a: 6, b: 6, c: 6, d: 6 } }), data()), EngineError);
});

test('rejects an unknown augmentation / metatype', () => {
  assert.throws(() => assembleRunner(samuraiInput({ augmentations: ['nope'] }), data()), EngineError);
  assert.throws(() => assembleRunner(samuraiInput({ metatype: 'goblin' }), data()), EngineError);
});

test('mundane with magic/spells/powers is rejected', () => {
  assert.throws(() => assembleRunner(samuraiInput({ magic: 3 }), data()), EngineError);
  assert.throws(() => assembleRunner(samuraiInput({ spells: ['Manabolt'] }), data()), EngineError);
});
