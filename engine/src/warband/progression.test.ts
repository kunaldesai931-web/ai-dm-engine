import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gainXp,
  levelUp,
  applyInjury,
  resolveHirelingDown,
  xpToNextLevel,
} from './progression.js';
import type { TRosterMember } from './schema.js';

function baseMember(overrides: Partial<TRosterMember> = {}): TRosterMember {
  return {
    id: 'm1',
    name: 'Test',
    role: 'hireling',
    backgroundId: 'sellsword',
    level: 1,
    xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [],
    perks: [],
    injuries: [],
    gear: [],
    wages: 5,
    morale: 10,
    ...overrides,
  };
}

test('gainXp increases xp', () => {
  const m = gainXp(baseMember(), 50);
  assert.equal(m.xp, 50);
});

test('gainXp does not mutate input', () => {
  const original = baseMember();
  gainXp(original, 50);
  assert.equal(original.xp, 0);
});

test('levelUp increases level and adds perk', () => {
  const m = baseMember({ xp: xpToNextLevel(1) });
  const leveled = levelUp(m, 'counter-attack');
  assert.equal(leveled.level, 2);
  assert.ok(leveled.perks.includes('counter-attack'));
});

test('levelUp resets xp to remainder', () => {
  const threshold = xpToNextLevel(1);
  const m = baseMember({ xp: threshold + 10 });
  const leveled = levelUp(m, 'iron-will');
  assert.equal(leveled.xp, 10);
});

test('applyInjury adds injury and applies stat penalty', () => {
  const injury = { id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative' as const, amount: -1 };
  const m = applyInjury(baseMember(), injury);
  assert.equal(m.injuries.length, 1);
  assert.equal(m.stats.initiative, 2); // was 3, -1
});

test('applyInjury does not reduce a stat below 0', () => {
  const injury = { id: 'concussion', name: 'Concussion', stat: 'resolve' as const, amount: -5 };
  const m = applyInjury(baseMember(), injury);
  assert.equal(m.stats.resolve, 0);
});

test('resolveHirelingDown returns dead on roll 1', () => {
  const death = { cause: 'Arrow', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 1, death);
  assert.ok(result.death);
  assert.equal(result.death.cause, 'Arrow');
});

test('resolveHirelingDown returns recovers on roll 3', () => {
  const death = { cause: 'Arrow', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 3, death);
  assert.equal(result.death, undefined);
  assert.equal(result.stats.hp, result.stats.maxHp);
});

test('resolveHirelingDown returns dead on roll 2', () => {
  const death = { cause: 'Sword', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 2, death);
  assert.ok(result.death);
});
