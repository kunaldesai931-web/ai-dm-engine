import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TCombatUnit, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';
import { isPlayerUnit, getBattleOutcome, endBattle } from './combat.js';
import { resolveHirelingDown, type DeathRecord } from './progression.js';
import { enemyAct } from './ai.js';

type InjuryTables = Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]>;

export function currentActorId(state: TWarbandCampaignState): string {
  const b = state.activeBattle;
  if (!b) throw new Error('no active battle');
  return b.turnOrder[b.currentTurnIndex];
}

function canAct(u: TCombatUnit): boolean {
  return u.status === 'active';
}

// Advance to the next unit that can act. Skips dead/routing/down units; a stunned
// unit's turn is consumed (cleared back to active) and skipped. Resets the landed
// unit's per-turn flags. Loops at most turnOrder.length times.
export function advanceTurn(state: TWarbandCampaignState): TWarbandCampaignState {
  const battle = state.activeBattle;
  if (!battle) throw new Error('no active battle');

  const n = battle.turnOrder.length;
  const units = { ...battle.units };
  let idx = battle.currentTurnIndex;

  for (let steps = 0; steps < n; steps++) {
    idx = (idx + 1) % n;
    const id = battle.turnOrder[idx];
    const u = units[id];
    if (!u) continue;
    if (u.status === 'stunned') {
      // consume the stun; this unit loses its turn
      units[id] = { ...u, status: 'active', hasActed: false, hasMoved: false };
      continue;
    }
    if (canAct(u)) {
      units[id] = { ...u, hasActed: false, hasMoved: false };
      return {
        ...state,
        activeBattle: { ...battle, currentTurnIndex: idx, units },
      };
    }
    // dead / routing / down → skip
  }

  // No actionable unit found (battle effectively over); still apply any stun clears.
  return { ...state, activeBattle: { ...battle, currentTurnIndex: idx, units } };
}

export interface RunEnemyResult {
  state: TWarbandCampaignState;
  log: string[];
}

// While the current actor is an enemy and the battle is ongoing, resolve enemy
// turns. Stops on a player actor or when the battle is decided.
export function runEnemyTurns(
  state: TWarbandCampaignState,
  roller: Roller,
  injuryTables: InjuryTables,
): RunEnemyResult {
  let cur = state;
  const log: string[] = [];
  // Safety bound: never loop more than (units * 4) times.
  const maxIters = cur.activeBattle ? Object.keys(cur.activeBattle.units).length * 4 + 4 : 0;

  for (let i = 0; i < maxIters; i++) {
    if (!cur.activeBattle) break;
    if (getBattleOutcome(cur) !== 'ongoing') break;
    const actorId = currentActorId(cur);
    const actor = cur.activeBattle.units[actorId];
    if (!actor || isPlayerUnit(actor)) break; // player's turn → stop

    const r = enemyAct(cur, actorId, roller, injuryTables);
    cur = r.state;
    log.push(...r.log);
    if (getBattleOutcome(cur) !== 'ongoing') break;
    cur = advanceTurn(cur);
  }

  return { state: cur, log };
}

export interface Casualty {
  id: string;
  name: string;
  result: 'dead' | 'survived';
}

export interface ConcludeContext {
  battleId: string;
  dayOfCampaign: number;
  location: string;
}

// Resolve downed player units, then close the battle. Hirelings roll D6
// (1-2 dead, else survive at full hp). Protagonist/companions that are down
// get a death record (permadeath / arc end).
export function concludeBattle(
  state: TWarbandCampaignState,
  roller: Roller,
  ctx: ConcludeContext,
): { state: TWarbandCampaignState; casualties: Casualty[] } {
  const battle = state.activeBattle;
  if (!battle) return { state, casualties: [] };

  // Identify downed player units BEFORE we drop the battle.
  const downed: Array<{ id: string; role: TCombatUnit['role'] }> = [];
  for (const u of Object.values(battle.units)) {
    if (!isPlayerUnit(u)) continue;
    if (u.status === 'down' || u.status === 'dead' || u.currentHp <= 0) {
      downed.push({ id: u.memberId, role: u.role });
    }
  }

  let next = endBattle(state); // writes hp back, drops activeBattle
  const casualties: Casualty[] = [];

  const death = (name: string): DeathRecord => ({
    cause: `Fell at ${ctx.location}`,
    battleId: ctx.battleId,
    dayOfCampaign: ctx.dayOfCampaign,
    location: ctx.location,
  });

  for (const { id, role } of downed) {
    if (role === 'hireling') {
      const member = next.hirelings[id];
      if (!member) continue;
      const resolved: TRosterMember = resolveHirelingDown(member, roller.die(6), death(member.name));
      next = { ...next, hirelings: { ...next.hirelings, [id]: resolved } };
      casualties.push({ id, name: member.name, result: resolved.death ? 'dead' : 'survived' });
    } else if (role === 'companion') {
      const member = next.companions[id];
      if (!member) continue;
      const dead: TRosterMember = { ...member, stats: { ...member.stats, hp: 0 }, death: death(member.name) };
      next = { ...next, companions: { ...next.companions, [id]: dead } };
      casualties.push({ id, name: member.name, result: 'dead' });
    } else {
      const member = next.protagonist;
      const dead: TRosterMember = { ...member, stats: { ...member.stats, hp: 0 }, death: death(member.name) };
      next = { ...next, protagonist: dead };
      casualties.push({ id, name: member.name, result: 'dead' });
    }
  }

  return { state: next, casualties };
}
