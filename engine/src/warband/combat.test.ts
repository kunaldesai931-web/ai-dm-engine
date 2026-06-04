import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, getBattleOutcome, endBattle, moveUnit, endTurn, resolveAttack, type AttackResult } from './combat.js';
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

test('moveUnit updates unit position and grid', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const protagonistPos = battle.activeBattle!.units['protagonist'].position;
  // Move protagonist to a known open tile (col 2, row 5 — middle of grid, should be open)
  const moved = moveUnit(battle, 'protagonist', 2, 5);
  assert.equal(moved.activeBattle!.units['protagonist'].position.col, 2);
  assert.equal(moved.activeBattle!.units['protagonist'].position.row, 5);
  assert.equal(moved.activeBattle!.grid[protagonistPos.row][protagonistPos.col], 'open');
  assert.equal(moved.activeBattle!.grid[5][2], 'occupied');
});

test('moveUnit throws on out-of-bounds col', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  assert.throws(() => moveUnit(battle, 'protagonist', 5, 0), EngineError);
});

test('moveUnit throws on out-of-bounds row', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  assert.throws(() => moveUnit(battle, 'protagonist', 0, 8), EngineError);
});

test('moveUnit sets hasMoved flag', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const moved = moveUnit(battle, 'protagonist', 2, 5);
  assert.equal(moved.activeBattle!.units['protagonist'].hasMoved, true);
});

test('moveUnit does not mutate input state', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const origPos = { ...battle.activeBattle!.units['protagonist'].position };
  moveUnit(battle, 'protagonist', 2, 5);
  assert.equal(battle.activeBattle!.units['protagonist'].position.col, origPos.col);
});

test('endTurn advances currentTurnIndex', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  assert.equal(battle.activeBattle!.currentTurnIndex, 0);
  const next = endTurn(battle);
  assert.equal(next.activeBattle!.currentTurnIndex, 1);
});

test('endTurn wraps around at end of turn order', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const next = endTurn(endTurn(battle));
  assert.equal(next.activeBattle!.currentTurnIndex, 0);
});

test('endTurn resets hasActed and hasMoved for the incoming unit', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  // Manually mark current unit as acted/moved
  const currentId = battle.activeBattle!.turnOrder[0];
  battle.activeBattle!.units[currentId].hasActed = true;
  battle.activeBattle!.units[currentId].hasMoved = true;
  const next = endTurn(battle);
  const nextId = next.activeBattle!.turnOrder[next.activeBattle!.currentTurnIndex];
  assert.equal(next.activeBattle!.units[nextId].hasMoved, false);
  assert.equal(next.activeBattle!.units[nextId].hasActed, false);
});

import type { InjuryEntry } from './progression.js';

const INJURIES: Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]> = {
  blunt: [{ id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative', amount: -1 }],
  cutting: [{ id: 'sword-arm-cut', name: 'Sword Arm Cut', stat: 'melee', amount: -1 }],
  piercing: [{ id: 'gut-wound', name: 'Gut Wound', stat: 'resolve', amount: -1 }],
};

test('resolveAttack returns a valid outcome', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const roller2 = makeRoller(battle.rng);
  const result = resolveAttack(battle, 'protagonist', 'bandit-1', roller2, INJURIES);
  assert.ok(['hit', 'miss', 'crit', 'stumble'].includes(result.outcome));
});

test('resolveAttack does not mutate input state', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const hpBefore = battle.activeBattle!.units['bandit-1'].currentHp;
  const roller2 = makeRoller(battle.rng);
  resolveAttack(battle, 'protagonist', 'bandit-1', roller2, INJURIES);
  assert.equal(battle.activeBattle!.units['bandit-1'].currentHp, hpBefore);
});

test('resolveAttack marks attacker as hasActed', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const roller2 = makeRoller(battle.rng);
  const result = resolveAttack(battle, 'protagonist', 'bandit-1', roller2, INJURIES);
  assert.equal(result.state.activeBattle!.units['protagonist'].hasActed, true);
});

test('resolveAttack returns state with battle still active', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const roller2 = makeRoller(battle.rng);
  const result = resolveAttack(battle, 'protagonist', 'bandit-1', roller2, INJURIES);
  assert.ok(result.state.activeBattle);
});

test('resolveAttack throws on non-existent attacker', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const roller2 = makeRoller(battle.rng);
  assert.throws(() => resolveAttack(battle, 'ghost', 'bandit-1', roller2, INJURIES), EngineError);
});

test('resolveAttack throws on non-existent target', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const roller2 = makeRoller(battle.rng);
  assert.throws(() => resolveAttack(battle, 'protagonist', 'ghost', roller2, INJURIES), EngineError);
});

import { playerMoveUnit, MOVE_RANGE } from './combat.js';

test('MOVE_RANGE is a positive integer', () => {
  assert.ok(Number.isInteger(MOVE_RANGE) && MOVE_RANGE > 0);
});

test('playerMoveUnit allows a move within range', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  // protagonist starts near (0,0); move within MOVE_RANGE (use distance 1)
  const start = battle.activeBattle!.units['protagonist'].position;
  const target = { col: Math.min(start.col + 1, 4), row: start.row };
  const moved = playerMoveUnit(battle, 'protagonist', target.col, target.row);
  assert.equal(moved.activeBattle!.units['protagonist'].position.col, target.col);
  assert.equal(moved.activeBattle!.units['protagonist'].position.row, target.row);
});

test('playerMoveUnit rejects a move beyond range', () => {
  const state = baseState();
  const roller = makeRoller(state.rng);
  const battle = startBattle(state, ENEMIES, roller);
  const start = battle.activeBattle!.units['protagonist'].position;
  // a tile guaranteed > MOVE_RANGE away in row (board is 8 tall)
  const farRow = start.row <= 3 ? 7 : 0;
  const farDist = Math.abs(farRow - start.row);
  if (farDist > MOVE_RANGE) {
    assert.throws(() => playerMoveUnit(battle, 'protagonist', start.col, farRow), EngineError);
  }
});
