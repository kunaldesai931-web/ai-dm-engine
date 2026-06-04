import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterMember, parseWarbandCampaignState } from './schema.js';
import { EngineError } from '../core/errors.js';

function validMember(): any {
  return {
    id: 'p1',
    name: 'Aldric',
    role: 'protagonist',
    backgroundId: 'sellsword',
    level: 1,
    xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: ['hardened'],
    perks: [],
    injuries: [],
    gear: ['shortsword', 'shield', 'leather-armor'],
    wages: 0,
    morale: 10,
  };
}

function validState(): any {
  return {
    meta: { campaign: 'iron-road', day: 1, gold: 50 },
    rng: { seed: 'abc', cursor: 0 },
    protagonist: validMember(),
    companions: {},
    hirelings: {},
  };
}

test('parseRosterMember accepts a valid protagonist', () => {
  const m = parseRosterMember(validMember());
  assert.equal(m.name, 'Aldric');
  assert.equal(m.role, 'protagonist');
});

test('parseRosterMember rejects unknown role', () => {
  const bad = validMember();
  bad.role = 'wizard';
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember rejects negative hp', () => {
  const bad = validMember();
  bad.stats.hp = -1;
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember rejects hp exceeding maxHp', () => {
  const bad = validMember();
  bad.stats.hp = 20;
  bad.stats.maxHp = 14;
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember accepts a death record', () => {
  const m = validMember();
  m.death = { cause: 'Bandit arrow', battleId: 'b1', dayOfCampaign: 3, location: 'Border Marches' };
  const parsed = parseRosterMember(m);
  assert.equal(parsed.death?.cause, 'Bandit arrow');
});

test('parseWarbandCampaignState accepts valid state', () => {
  const s = parseWarbandCampaignState(validState());
  assert.equal(s.meta.campaign, 'iron-road');
  assert.equal(s.meta.gold, 50);
});

test('parseWarbandCampaignState rejects negative gold', () => {
  const bad = validState();
  bad.meta.gold = -1;
  assert.throws(() => parseWarbandCampaignState(bad), EngineError);
});

function stateWithOverworld(): any {
  return {
    meta: { campaign: 'ow', day: 1, gold: 100 },
    rng: { seed: 's', cursor: 0 },
    protagonist: {
      id: 'protagonist', name: 'A', role: 'protagonist', backgroundId: 'sellsword',
      level: 1, xp: 0,
      stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
      traits: [], perks: [], injuries: [], gear: [], wages: 0, morale: 10,
    },
    companions: {}, hirelings: {},
    overworld: {
      currentLocation: 'ironhold', provisions: 20,
      contracts: [
        { id: 'c1', type: 'bounty', title: 'Bounty', locationId: 'redford', enemySpec: 'b1:bandit', goldReward: 40, intelReward: 1, expiresDay: 10 },
      ],
      activeContractId: null,
      crisis: { name: 'Warlord', clockFilled: 0, clockSegments: 8, intel: 0, intelNeeded: 5, unlocked: false, resolved: false, finalLocationId: 'old-mill' },
      lastPaydayDay: 0,
    },
  };
}

test('parseWarbandCampaignState accepts an overworld block', () => {
  const s = parseWarbandCampaignState(stateWithOverworld());
  assert.equal(s.overworld!.currentLocation, 'ironhold');
  assert.equal(s.overworld!.contracts.length, 1);
});

test('parseWarbandCampaignState still accepts state without overworld (backward compat)', () => {
  const s = stateWithOverworld(); delete s.overworld;
  const parsed = parseWarbandCampaignState(s);
  assert.equal(parsed.overworld, undefined);
});

test('parseWarbandCampaignState rejects a contract with negative gold reward', () => {
  const s = stateWithOverworld(); s.overworld.contracts[0].goldReward = -1;
  assert.throws(() => parseWarbandCampaignState(s), EngineError);
});
