import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRunner } from '../src/shadowrun/chargen.js';
import { EngineError } from '../src/core/errors.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun');
const load = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const data = () => ({ metatypes: load('metatypes.json'), spells: load('spells.json'), powers: load('powers.json'), augmentations: load('augmentations.json') });

function base(over: any = {}): any {
  return {
    name: 'Wisp', metatype: 'human',
    attributes: { body: 3, agility: 3, reaction: 4, strength: 2, willpower: 5, logic: 4, intuition: 4, charisma: 3 },
    skills: { spellcasting: 6, perception: 3 }, ...over,
  };
}

test('magician spells get engine-owned Drain from data (player cannot set it)', () => {
  const a = assembleRunner(base({ magicType: 'magician', magic: 6, tradition: 'hermetic', spells: ['Manabolt', 'Stunbolt'] }), data());
  assert.equal(a.attributes.magic, 6);
  assert.equal(a.spells!.find((s) => s.name === 'Manabolt')!.drain, 3); // from spells.json, not input
  assert.equal(a.tradition, 'hermetic');
});

test('magician spell count cannot exceed Magic', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 1, tradition: 'hermetic', spells: ['Manabolt', 'Stunbolt'] }), data()), EngineError);
});

test('magician with an unknown spell is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 4, tradition: 'hermetic', spells: ['DeathRay'] }), data()), EngineError);
});

test('magician without a tradition is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 4, spells: ['Manabolt'] }), data()), EngineError);
});

test('adept spends power points (= Magic) on powers and gets their modifiers', () => {
  const a = assembleRunner(base({ magicType: 'adept', magic: 5, powers: ['improved-reflexes-2', 'critical-strike'] }), data());
  // improved-reflexes-2: reaction +2, initiativeDice +2
  assert.equal(a.attributes.reaction, 6);   // 4 + 2
  assert.equal(a.initiativeDice, 2);
  assert.deepEqual(a.powers, ['improved-reflexes-2', 'critical-strike']);
  assert.equal(a.spells, undefined);
});

test('adept over power-point budget is rejected', () => {
  // improved-reflexes-2 (2.5) + improved-reflexes-1 (1.5) = 4 > magic 3
  assert.throws(() => assembleRunner(base({ magicType: 'adept', magic: 3, powers: ['improved-reflexes-2', 'improved-reflexes-1'] }), data()), EngineError);
});

test('adept with spells is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'adept', magic: 5, spells: ['Manabolt'] }), data()), EngineError);
});
