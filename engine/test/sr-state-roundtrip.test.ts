import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseState } from '../src/types.js';

function stateWithRunner(): any {
  return {
    meta: { campaign: 'sr', rulesetId: 'shadowrun' },
    rng: { seed: 's', cursor: 0 },
    pcs: {
      knox: {
        name: 'Knox', sr: true,
        attributes: { body: 6, agility: 6, reaction: 5, strength: 5, willpower: 4, logic: 3, intuition: 4, charisma: 2, edge: 4, magic: 0 },
        skills: { firearms: 6, athletics: 4 },           // NUMERIC skills
        monitors: { physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } },
        edgeCurrent: 4, armor: 12,
      },
    },
    npcs: {}, factions: {}, clocks: {},
  };
}

test('a Shadowrun actor with numeric skills round-trips through parseState', () => {
  const s = parseState(stateWithRunner());
  assert.equal((s.pcs as any).knox.skills.firearms, 6);
  assert.equal((s.pcs as any).knox.sr, true);
});

test('a 5e character with string skills still parses', () => {
  const s5 = stateWithRunner();
  s5.pcs.knox.skills = { athletics: 'proficient' };
  const s = parseState(s5);
  assert.equal((s.pcs as any).knox.skills.athletics, 'proficient');
});
