import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCharacter } from '../src/chargen.js';
import { EngineError } from '../src/core/errors.js';

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
