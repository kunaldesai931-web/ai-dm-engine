import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHireling } from './generator.js';
import { makeRoller } from '../core/rng.js';

const BACKGROUNDS = [
  {
    id: 'sellsword',
    name: 'Sellsword',
    description: 'A mercenary.',
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, maxHp: 14 },
    startingTrait: 'hardened',
    startingGear: ['shortsword', 'shield', 'leather-armor'],
    perkPool: ['shield-wall', 'counter-attack'],
  },
];

const TRAITS = ['hardened', 'eagle-eyed', 'disciplined', 'greedy', 'brave', 'skittish'];

test('generateHireling returns a valid hireling shape', () => {
  const roll = makeRoller({ seed: 'test-seed', cursor: 0 });
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.role, 'hireling');
  assert.ok(h.id.length > 0);
  assert.ok(h.name.length > 0);
  assert.equal(h.backgroundId, 'sellsword');
  assert.ok(h.wages > 0);
});

test('generateHireling sets hp equal to maxHp', () => {
  const roll = makeRoller({ seed: 'seed2', cursor: 0 });
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.stats.hp, h.stats.maxHp);
});

test('generateHireling has exactly one visible trait', () => {
  const roll = makeRoller({ seed: 'seed3', cursor: 0 });
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.traits.length, 1);
});

test('generateHireling has a hiddenTrait', () => {
  const roll = makeRoller({ seed: 'seed4', cursor: 0 });
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.ok(typeof h.hiddenTrait === 'string');
  assert.ok(h.hiddenTrait.length > 0);
});

test('generateHireling stats have +/- 1 variance from background base', () => {
  const roll = makeRoller({ seed: 'seed5', cursor: 0 });
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  const base = BACKGROUNDS[0].stats;
  assert.ok(Math.abs(h.stats.melee - base.melee) <= 1);
  assert.ok(Math.abs(h.stats.ranged - base.ranged) <= 1);
  assert.ok(Math.abs(h.stats.defense - base.defense) <= 1);
});
