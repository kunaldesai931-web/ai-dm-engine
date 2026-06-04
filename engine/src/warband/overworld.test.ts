import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initOverworld, neighbors, travel, takeContract, resolveContractWin, payWages,
  type WorldData,
} from './overworld.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';

const WORLD: WorldData = {
  regions: [{
    id: 'r', name: 'Region', danger: 2,
    locations: [
      { id: 'ironhold', name: 'Ironhold', type: 'town', start: true },
      { id: 'redford', name: 'Redford', type: 'town' },
      { id: 'old-mill', name: 'Old Mill', type: 'landmark' },
    ],
    routes: [
      { from: 'ironhold', to: 'redford', days: 2 },
      { from: 'redford', to: 'old-mill', days: 1 },
    ],
  }],
  crisis: { name: 'Warlord', clockSegments: 8, intelNeeded: 5, finalLocationId: 'old-mill', finalEnemySpec: 'w:bandit-leader' },
  contractTemplates: [
    { type: 'bounty', title: 'Bounty: {loc}', enemyPool: ['bandit'], size: 1, gold: 40, intel: 1 },
  ],
};

function baseState(): TWarbandCampaignState {
  const mk = (id: string, role: 'protagonist' | 'hireling', wage: number): TRosterMember => ({
    id, name: id, role, backgroundId: 'sellsword', level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: wage, morale: 10,
  });
  return {
    meta: { campaign: 't', day: 1, gold: 100 },
    rng: { seed: 'ow-seed', cursor: 0 },
    protagonist: mk('protagonist', 'protagonist', 0),
    companions: {},
    hirelings: { h1: mk('h1', 'hireling', 5) },
  };
}

test('initOverworld sets the start location and seeds contracts + crisis', () => {
  const s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  assert.equal(s.overworld!.currentLocation, 'ironhold');
  assert.ok(s.overworld!.provisions > 0);
  assert.equal(s.overworld!.crisis.name, 'Warlord');
  assert.equal(s.overworld!.crisis.clockSegments, 8);
  assert.ok(Array.isArray(s.overworld!.contracts));
});

test('neighbors returns reachable locations with day costs (undirected)', () => {
  const ns = neighbors(WORLD, 'redford');
  const ids = ns.map((n) => n.id).sort();
  assert.deepEqual(ids, ['ironhold', 'old-mill']);
  assert.equal(ns.find((n) => n.id === 'ironhold')!.days, 2);
});

test('travel advances the day by the route cost and moves location', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  const day0 = s.meta.day;
  const r = travel(s, WORLD, 'redford', makeRoller(s.rng));
  assert.equal(r.state.overworld!.currentLocation, 'redford');
  assert.equal(r.state.meta.day, day0 + 2);
});

test('travel to a non-neighbor throws', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  assert.throws(() => travel(s, WORLD, 'old-mill', makeRoller(s.rng))); // not adjacent to ironhold
});

test('travel deducts provisions', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  const before = s.overworld!.provisions;
  const r = travel(s, WORLD, 'redford', makeRoller(s.rng));
  assert.ok(r.state.overworld!.provisions < before);
});

test('takeContract sets the active contract', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  // inject a known contract
  s.overworld!.contracts = [{ id: 'c1', type: 'bounty', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 40, intelReward: 1, expiresDay: 99 }];
  const r = takeContract(s, 'c1');
  assert.equal(r.overworld!.activeContractId, 'c1');
});

test('resolveContractWin pays gold, adds intel, clears active contract', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.overworld!.contracts = [{ id: 'c1', type: 'bounty', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 40, intelReward: 2, expiresDay: 99 }];
  s.overworld!.activeContractId = 'c1';
  const goldBefore = s.meta.gold;
  const r = resolveContractWin(s);
  assert.equal(r.meta.gold, goldBefore + 40);
  assert.equal(r.overworld!.crisis.intel, 2);
  assert.equal(r.overworld!.activeContractId, null);
  assert.equal(r.overworld!.contracts.find((c) => c.id === 'c1'), undefined); // consumed
});

test('resolveContractWin unlocks the crisis when intel threshold reached', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.overworld!.crisis.intel = 4; s.overworld!.crisis.intelNeeded = 5;
  s.overworld!.contracts = [{ id: 'c1', type: 'raid', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 10, intelReward: 2, expiresDay: 99 }];
  s.overworld!.activeContractId = 'c1';
  const r = resolveContractWin(s);
  assert.ok(r.overworld!.crisis.intel >= 5);
  assert.equal(r.overworld!.crisis.unlocked, true);
});

test('payWages deducts hireling wages weekly and skips when not due', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.meta.day = 8; s.overworld!.lastPaydayDay = 1; // 7 days elapsed → due
  const goldBefore = s.meta.gold;
  const r = payWages(s);
  assert.equal(r.state.meta.gold, goldBefore - 5); // one hireling, wage 5
  assert.equal(r.paid, true);
  // not due now
  const r2 = payWages(r.state);
  assert.equal(r2.paid, false);
});

test('payWages causes desertion when gold cannot cover wages', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.meta.day = 8; s.overworld!.lastPaydayDay = 1; s.meta.gold = 2; // can't afford wage 5
  const r = payWages(s);
  assert.equal(Object.keys(r.state.hirelings).length, 0); // deserted
  assert.ok(r.deserted.includes('h1'));
});
