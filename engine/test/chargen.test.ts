import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCharacter } from '../src/chargen.js';
import { EngineError } from '../src/core/errors.js';
import { getSpell } from '../src/srd.js';

const FIGHTER = {
  id: 'hero', name: 'Bruna', race: 'dwarf', subrace: 'hill-dwarf', cls: 'fighter', background: 'acolyte',
  abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
  skills: ['athletics', 'perception'],
};

test('assembleCharacter applies racial+subrace bonuses', () => {
  const c = assembleCharacter(FIGHTER);
  assert.equal(c.abilities.con, 16); // 14 + 2 (dwarf)
  assert.equal(c.abilities.wis, 13); // 12 + 1 (hill-dwarf)
  assert.equal(c.abilities.str, 15); // unchanged
});

test('assembleCharacter computes level-1 derived numbers', () => {
  const c = assembleCharacter(FIGHTER);
  assert.equal(c.level, 1);
  assert.equal(c.profBonus, 2);
  assert.equal(c.hp.max, 13);   // d10 max (10) + con mod (+3)
  assert.equal(c.hp.current, 13);
  assert.deepEqual([...c.saves].sort(), ['con', 'str']);
  assert.equal(c.speed, 25);
  assert.equal(c.hitDice.max, 1);
});

test('assembleCharacter records chosen + background skills as proficient', () => {
  const c = assembleCharacter(FIGHTER);
  assert.equal(c.skills.athletics, 'proficient');
  assert.equal(c.skills.perception, 'proficient');
  // acolyte's granted skills are also present
  const bg = ['insight', 'religion'];
  for (const s of bg) assert.equal(c.skills[s], 'proficient');
});

test('assembleCharacter rejects a skill outside the class list', () => {
  assert.throws(() => assembleCharacter({ ...FIGHTER, skills: ['arcana', 'stealth'] }), EngineError);
});

test('assembleCharacter rejects too many class skills', () => {
  assert.throws(() => assembleCharacter({ ...FIGHTER, skills: ['athletics', 'perception', 'survival'] }), EngineError);
});

test('assembleCharacter rejects unknown race/class', () => {
  assert.throws(() => assembleCharacter({ ...FIGHTER, race: 'goblinoid' }), EngineError);
  assert.throws(() => assembleCharacter({ ...FIGHTER, cls: 'bard-of-doom' }), EngineError);
});

const WIZARD = {
  id: 'mage', name: 'Iola', race: 'elf', subrace: 'high-elf', cls: 'wizard', background: 'acolyte',
  abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  skills: ['arcana', 'investigation'],
  cantrips: ['fire-bolt', 'mage-hand', 'light'],
  spells: ['magic-missile', 'shield'],
};

test('a wizard gets level-1 slots and cantrips from Levels data', () => {
  const c = assembleCharacter(WIZARD);
  assert.equal(c.spellSlots['1'].max, 2);
  assert.equal(c.knownSpells.length, 5); // 3 cantrips + 2 spells
  assert.equal(c.castingAbility, 'int');
});

test('a non-caster has no spell slots', () => {
  const c = assembleCharacter(FIGHTER);
  assert.ok(!c.spellSlots || Object.keys(c.spellSlots).length === 0);
});

test('rejects a spell that is not a real SRD spell', () => {
  assert.throws(() => assembleCharacter({ ...WIZARD, spells: ['ultra-death-ray'] }), EngineError);
});

test('rejects more cantrips than the class knows at level 1', () => {
  assert.throws(() => assembleCharacter({ ...WIZARD, cantrips: ['fire-bolt', 'mage-hand', 'light', 'prestidigitation'] }), EngineError);
});
