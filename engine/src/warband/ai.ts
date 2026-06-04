import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TCombatUnit } from './schema.js';
import type { InjuryEntry } from './progression.js';
import { isPlayerUnit, moveUnit, resolveAttack } from './combat.js';

type InjuryTables = Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]>;

function dist(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function isTargetable(u: TCombatUnit): boolean {
  return u.status !== 'dead' && u.status !== 'routing' && u.status !== 'down';
}

// Nearest living player unit to the given enemy, or null.
function nearestTarget(state: TWarbandCampaignState, enemy: TCombatUnit): TCombatUnit | null {
  const battle = state.activeBattle!;
  const targets = Object.values(battle.units).filter((u) => isPlayerUnit(u) && isTargetable(u));
  if (targets.length === 0) return null;
  targets.sort((a, b) => dist(enemy.position, a.position) - dist(enemy.position, b.position));
  return targets[0];
}

// Move one tile toward the target if possible (diagonal preferred, then orthogonal).
function stepToward(
  state: TWarbandCampaignState,
  unitId: string,
  target: TCombatUnit,
): TWarbandCampaignState {
  const battle = state.activeBattle!;
  const unit = battle.units[unitId];
  const dc = sign(target.position.col - unit.position.col);
  const dr = sign(target.position.row - unit.position.row);
  const candidates: Array<[number, number]> = [
    [unit.position.col + dc, unit.position.row + dr],
    [unit.position.col + dc, unit.position.row],
    [unit.position.col, unit.position.row + dr],
  ];
  for (const [nc, nr] of candidates) {
    if (nc < 0 || nc > 4 || nr < 0 || nr > 7) continue;
    if (battle.grid[nr][nc] !== 'open') continue;
    return moveUnit(state, unitId, nc, nr);
  }
  return state; // boxed in
}

export interface EnemyActResult {
  state: TWarbandCampaignState;
  log: string[];
}

// Resolve one enemy unit's turn: target nearest, close distance if needed, attack.
export function enemyAct(
  state: TWarbandCampaignState,
  enemyId: string,
  roller: Roller,
  injuryTables: InjuryTables,
): EnemyActResult {
  if (!state.activeBattle) return { state, log: [] };
  const enemy = state.activeBattle.units[enemyId];
  if (!enemy || enemy.status !== 'active') return { state, log: [] };

  const target = nearestTarget(state, enemy);
  if (!target) return { state, log: [] };

  const log: string[] = [];
  let cur = state;
  let d = dist(enemy.position, target.position);
  const rangedFavored = enemy.stats.ranged > enemy.stats.melee;

  // Close distance unless adjacent or able+willing to shoot from range.
  if (d > 1 && !rangedFavored) {
    cur = stepToward(cur, enemyId, target);
    const movedEnemy = cur.activeBattle!.units[enemyId];
    if (movedEnemy.position.col !== enemy.position.col || movedEnemy.position.row !== enemy.position.row) {
      log.push(`${enemy.name} advances on ${target.name}.`);
    }
    d = dist(cur.activeBattle!.units[enemyId].position, target.position);
  }

  // Attack if adjacent, or if ranged-favored and target still present.
  const targetStillThere = cur.activeBattle!.units[target.memberId];
  if (targetStillThere && isTargetable(targetStillThere) && (d <= 1 || rangedFavored)) {
    const r = resolveAttack(cur, enemyId, target.memberId, roller, injuryTables);
    cur = r.state;
    log.push(r.narrative);
  }

  return { state: cur, log };
}
