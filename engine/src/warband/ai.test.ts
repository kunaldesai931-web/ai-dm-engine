import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle } from './combat.js';
import { enemyAct } from './ai.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';

const INJURIES: Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]> = {
  blunt: [{ id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative', amount: -1 }],
  cutting: [{ id: 'sword-arm-cut', name: 'Sword Arm Cut', stat: 'melee', amount: -1 }],
  piercing: [{ id: 'gut-wound', name: 'Gut Wound', stat: 'resolve', amount: -1 }],
};

function baseState(): TWarbandCampaignState {
  const protagonist: TRosterMember = {
    id: 'protagonist', name: 'Aldric', role: 'protagonist', backgroundId: 'sellsword',
    level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: 0, morale: 10,
  };
  return {
    meta: { campaign: 'test', day: 1, gold: 0 },
    rng: { seed: 'ai-seed', cursor: 0 },
    protagonist, companions: {}, hirelings: {},
  };
}

const MELEE_ENEMY = [{
  id: 'brute-1', typeId: 'brute', name: 'Brute',
  stats: { melee: 5, ranged: 0, defense: 4, resolve: 4, initiative: 1, maxHp: 18 },
  morale: 8, weaponCategory: 'blunt' as const, named: false,
}];

test('enemyAct moves a distant melee enemy closer to the target', () => {
  const state = baseState();
  const battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  const before = battle.activeBattle!.units['brute-1'].position;
  const protaPos = battle.activeBattle!.units['protagonist'].position;
  const beforeDist = Math.max(Math.abs(before.col - protaPos.col), Math.abs(before.row - protaPos.row));
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  const after = r.state.activeBattle!.units['brute-1'].position;
  const afterDist = Math.max(Math.abs(after.col - protaPos.col), Math.abs(after.row - protaPos.row));
  assert.ok(afterDist <= beforeDist, 'enemy should not move away from target');
  assert.ok(Array.isArray(r.log));
});

test('enemyAct attacks when adjacent to a target', () => {
  const state = baseState();
  let battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  // Force adjacency: put brute right next to protagonist
  const p = battle.activeBattle!.units['protagonist'].position;
  battle.activeBattle!.units['brute-1'].position = { col: Math.min(p.col + 1, 4), row: p.row };
  const hpBefore = battle.activeBattle!.units['protagonist'].currentHp;
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  const hpAfter = r.state.activeBattle!.units['protagonist'].currentHp;
  // Either a hit (hp drops) or a miss/stumble — but the log must record an attack attempt
  assert.ok(r.log.some((l) => /attack|hit|miss|stumble|critical/i.test(l)), 'log should mention an attack');
  assert.ok(hpAfter <= hpBefore);
});

test('enemyAct on an enemy with no living targets does nothing', () => {
  const state = baseState();
  const battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  battle.activeBattle!.units['protagonist'].status = 'dead';
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  assert.equal(r.log.length, 0);
});
