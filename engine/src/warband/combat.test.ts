import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, getBattleOutcome, endBattle } from './combat.js';
import { makeRoller } from '../core/rng.js';
import { EngineError } from '../core/errors.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';

function baseState(): TWarbandCampaignState {
  const protagonist: TRosterMember = {
    id: 'protagonist',
    name: 'Aldric',
    role: 'protagonist',
    backgroundId: 'sellsword',
    level: 1,
    xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: ['hardened'],
    perks: [],
    injuries: [],
    gear: ['shortsword'],
    wages: 0,
    morale: 10,
  };
  return {
    meta: { campaign: 'test', day: 1, gold: 100 },
    rng: { seed: 'test-seed', cursor: 0 },
    protagonist,
    companions: {},
    hirelings: {},
  };
}

const ENEMIES = [
  {
    id: 'bandit-1',
    typeId: 'bandit',
    name: 'Bandit',
    stats: { melee: 3, ranged: 1, defense: 2, resolve: 2, initiative: 2, maxHp: 10 },
    morale: 6,
    weaponCategory: 'cutting' as const,
    named: false,
  },
];

test('startBattle creates activeBattle with correct unit count', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const result = startBattle(state, ENEMIES, roller);
  assert.ok(result.activeBattle);
  const units = Object.values(result.activeBattle.units);
  assert.equal(units.length, 2);
});

test('startBattle sets turnOrder with all unit ids', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const result = startBattle(state, ENEMIES, roller);
  assert.equal(result.activeBattle!.turnOrder.length, 2);
});

test('startBattle initializes 5x8 grid', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const result = startBattle(state, ENEMIES, roller);
  const grid = result.activeBattle!.grid;
  assert.equal(grid.length, 8);
  assert.equal(grid[0].length, 5);
});

test('startBattle places player units on left cols (0-1)', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const result = startBattle(state, ENEMIES, roller);
  const protagonistUnit = result.activeBattle!.units['protagonist'];
  assert.ok(protagonistUnit.position.col <= 1);
});

test('startBattle places enemy units on right cols (3-4)', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const result = startBattle(state, ENEMIES, roller);
  const enemyUnit = result.activeBattle!.units['bandit-1'];
  assert.ok(enemyUnit.position.col >= 3);
});

test('getBattleOutcome returns ongoing when both sides have active units', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battleState = startBattle(state, ENEMIES, roller);
  assert.equal(getBattleOutcome(battleState), 'ongoing');
});

test('getBattleOutcome returns player_win when all enemies dead', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battleState = startBattle(state, ENEMIES, roller);
  battleState.activeBattle!.units['bandit-1'].status = 'dead';
  assert.equal(getBattleOutcome(battleState), 'player_win');
});

test('getBattleOutcome returns player_loss when protagonist dead', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battleState = startBattle(state, ENEMIES, roller);
  battleState.activeBattle!.units['protagonist'].status = 'dead';
  assert.equal(getBattleOutcome(battleState), 'player_loss');
});
