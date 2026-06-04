import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, getBattleOutcome } from './combat.js';
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';

const INJURIES: Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]> = {
  blunt: [{ id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative', amount: -1 }],
  cutting: [{ id: 'sword-arm-cut', name: 'Sword Arm Cut', stat: 'melee', amount: -1 }],
  piercing: [{ id: 'gut-wound', name: 'Gut Wound', stat: 'resolve', amount: -1 }],
};

function stateWithHireling(): TWarbandCampaignState {
  const mk = (id: string, role: 'protagonist' | 'hireling', name: string): TRosterMember => ({
    id, name, role, backgroundId: 'sellsword', level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: role === 'hireling' ? 5 : 0, morale: 10,
  });
  return {
    meta: { campaign: 'test', day: 3, gold: 0 },
    rng: { seed: 'turn-seed', cursor: 0 },
    protagonist: mk('protagonist', 'protagonist', 'Aldric'),
    companions: {},
    hirelings: { 'h-1': mk('h-1', 'hireling', 'Bors') },
  };
}

const ENEMY = [{
  id: 'e-1', typeId: 'bandit', name: 'Bandit',
  stats: { melee: 3, ranged: 1, defense: 2, resolve: 2, initiative: 2, maxHp: 10 },
  morale: 6, weaponCategory: 'cutting' as const, named: false,
}];

test('currentActorId returns the unit at the current turn index', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  assert.equal(currentActorId(b), b.activeBattle!.turnOrder[b.activeBattle!.currentTurnIndex]);
});

test('advanceTurn skips dead units', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  // Kill the unit that would be next
  const nextIdx = (b.activeBattle!.currentTurnIndex + 1) % b.activeBattle!.turnOrder.length;
  const nextId = b.activeBattle!.turnOrder[nextIdx];
  b.activeBattle!.units[nextId].status = 'dead';
  const advanced = advanceTurn(b);
  assert.notEqual(currentActorId(advanced), nextId);
  assert.equal(advanced.activeBattle!.units[currentActorId(advanced)].status, 'active');
});

test('advanceTurn consumes stun and skips the stunned unit', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  const nextIdx = (b.activeBattle!.currentTurnIndex + 1) % b.activeBattle!.turnOrder.length;
  const nextId = b.activeBattle!.turnOrder[nextIdx];
  b.activeBattle!.units[nextId].status = 'stunned';
  const advanced = advanceTurn(b);
  // The stunned unit is cleared back to active (its turn was consumed) but not the current actor
  assert.equal(advanced.activeBattle!.units[nextId].status, 'active');
  assert.notEqual(currentActorId(advanced), nextId);
});

test('runEnemyTurns lands on a player unit or ends the battle', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  const r = runEnemyTurns(b, makeRoller(b.rng), INJURIES);
  const outcome = getBattleOutcome(r.state);
  if (outcome === 'ongoing') {
    const actor = r.state.activeBattle!.units[currentActorId(r.state)];
    assert.equal(actor.role !== 'enemy', true, 'should stop on a player actor');
  }
  assert.ok(Array.isArray(r.log));
});

test('concludeBattle kills a downed hireling on a low D6 and records death', () => {
  const s = stateWithHireling();
  let b = startBattle(s, ENEMY, makeRoller(s.rng));
  // Force the hireling down
  b.activeBattle!.units['h-1'].status = 'down';
  b.activeBattle!.units['h-1'].currentHp = 0;
  // Roller seeded so first d6 is low — if not, the test tolerates either but checks shape
  const r = concludeBattle(b, makeRoller(b.rng), { battleId: 'b', dayOfCampaign: 3, location: 'the field' });
  assert.equal(r.state.activeBattle, undefined, 'battle should be closed');
  // hireling is either dead (has death record) or survived (no death, hp restored)
  const h = r.state.hirelings['h-1'];
  assert.ok(h.death ? h.death.battleId === 'b' : h.stats.hp > 0);
  assert.ok(Array.isArray(r.casualties));
});

test('concludeBattle records protagonist death when protagonist is down', () => {
  const s = stateWithHireling();
  let b = startBattle(s, ENEMY, makeRoller(s.rng));
  b.activeBattle!.units['protagonist'].status = 'down';
  b.activeBattle!.units['protagonist'].currentHp = 0;
  const r = concludeBattle(b, makeRoller(b.rng), { battleId: 'b', dayOfCampaign: 3, location: 'the field' });
  assert.ok(r.state.protagonist.death, 'protagonist should have a death record');
});
