import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClass, getRace, getSubrace, getBackground, getLevel } from '../src/srd.js';

test('getClass(fighter) returns hit die, saves, skill choice', () => {
  const c = getClass('fighter')!;
  assert.equal(c.hitDie, 10);
  assert.deepEqual([...c.saves].sort(), ['con', 'str']);
  assert.equal(c.skillChoices.choose, 2);
  assert.ok(c.skillChoices.from.includes('athletics'));
  assert.equal(c.casts, false);
});

test('getClass(wizard) is a caster keyed to int', () => {
  const c = getClass('wizard')!;
  assert.equal(c.hitDie, 6);
  assert.equal(c.casts, true);
  assert.equal(c.castingAbility, 'int');
});

test('getRace(dwarf) has +2 con and speed 25', () => {
  const r = getRace('dwarf')!;
  assert.equal(r.speed, 25);
  assert.equal(r.abilityBonuses.find((b) => b.ability === 'con')!.bonus, 2);
});

test('getSubrace(hill-dwarf) grants +1 wis', () => {
  const s = getSubrace('hill-dwarf')!;
  assert.equal(s.abilityBonuses.find((b) => b.ability === 'wis')!.bonus, 1);
});

test('getBackground(acolyte) grants skill proficiencies', () => {
  const b = getBackground('acolyte')!;
  assert.ok(b.skills.length >= 1);
});

test('getLevel(fighter,1) prof bonus 2; wizard,1 has spell slots', () => {
  assert.equal(getLevel('fighter', 1)!.profBonus, 2);
  const w = getLevel('wizard', 1)!;
  assert.equal(w.profBonus, 2);
  assert.equal(w.spellcasting!.cantripsKnown, 3);
  assert.equal(w.spellcasting!.slots[1], 2); // 2 first-level slots
});
