import { EngineError } from '../core/errors.js';
import type { Roller } from '../core/rng.js';
import type { TCombatUnit, TRosterMember, TWarbandCampaignState } from './schema.js';
import type { InjuryEntry } from './progression.js';

// Max Chebyshev distance a unit may move in a single move action. Tunable.
export const MOVE_RANGE = 3;

export interface EnemySpawn {
  id: string;
  typeId: string;
  name: string;
  stats: {
    melee: number;
    ranged: number;
    defense: number;
    resolve: number;
    initiative: number;
    maxHp: number;
  };
  morale: number;
  weaponCategory: 'blunt' | 'cutting' | 'piercing';
  named: boolean;
}

export function isPlayerUnit(unit: TCombatUnit): boolean {
  return unit.role !== 'enemy';
}

export function startBattle(
  state: TWarbandCampaignState,
  enemies: EnemySpawn[],
  roller: Roller,
): TWarbandCampaignState {
  if (state.activeBattle) {
    throw new EngineError('battle already in progress');
  }

  const units: Record<string, TCombatUnit> = {};

  // Collect alive player roster members
  const playerMembers: Array<{ id: string; member: TRosterMember }> = [];
  if (!state.protagonist.death) {
    playerMembers.push({ id: state.protagonist.id, member: state.protagonist });
  }
  for (const [id, companion] of Object.entries(state.companions)) {
    if (!companion.death) playerMembers.push({ id, member: companion });
  }
  for (const [id, hireling] of Object.entries(state.hirelings)) {
    if (!hireling.death) playerMembers.push({ id, member: hireling });
  }

  // Guard against empty battles
  if (playerMembers.length === 0) throw new EngineError('battle requires at least one alive player unit');
  if (enemies.length === 0) throw new EngineError('battle requires at least one enemy');

  // Place player units on left cols (0-1)
  for (let i = 0; i < playerMembers.length; i++) {
    const { id, member } = playerMembers[i];
    const col = i % 2;
    const row = Math.min(Math.floor(i / 2) * 2, 7);
    units[id] = {
      memberId: id,
      name: member.name,
      role: member.role,
      stats: { ...member.stats },
      currentHp: member.stats.hp,
      morale: member.morale,
      position: { col, row },
      status: 'active',
      hasActed: false,
      hasMoved: false,
    };
  }

  // Place enemy units on right cols (3-4)
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    const col = 3 + (i % 2);
    const row = Math.min(i * 2, 7);
    units[enemy.id] = {
      memberId: enemy.id,
      name: enemy.name,
      role: 'enemy',
      stats: { ...enemy.stats, hp: enemy.stats.maxHp },
      currentHp: enemy.stats.maxHp,
      morale: enemy.morale,
      position: { col, row },
      status: 'active',
      hasActed: false,
      hasMoved: false,
    };
  }

  // Validate grid bounds
  for (const [uid, u] of Object.entries(units)) {
    if (u.position.col < 0 || u.position.col > 4) throw new EngineError(`unit "${uid}" placed out of bounds col ${u.position.col}`);
    if (u.position.row < 0 || u.position.row > 7) throw new EngineError(`unit "${uid}" placed out of bounds row ${u.position.row}`);
  }

  // Roll initiative and sort descending
  const initiatives: Array<{ id: string; score: number }> = Object.keys(units).map((id) => ({
    id,
    score: units[id].stats.initiative + roller.die(6),
  }));
  initiatives.sort((a, b) => b.score - a.score);
  const turnOrder = initiatives.map((x) => x.id);

  // Build 5x8 grid (grid[row][col])
  const grid: Array<Array<'open' | 'blocked' | 'occupied'>> = Array.from({ length: 8 }, () =>
    Array.from({ length: 5 }, () => 'open' as const),
  );
  for (const unit of Object.values(units)) {
    grid[unit.position.row][unit.position.col] = 'occupied';
  }

  const battleId = `battle-${state.meta.campaign}-day${state.meta.day}`;

  return {
    ...state,
    activeBattle: {
      battleId,
      units,
      turnOrder,
      currentTurnIndex: 0,
      grid,
    },
  };
}

export function getBattleOutcome(
  state: TWarbandCampaignState,
): 'ongoing' | 'player_win' | 'player_loss' {
  const battle = state.activeBattle;
  if (!battle) return 'ongoing';

  const allUnits = Object.values(battle.units);
  const playerUnits = allUnits.filter(isPlayerUnit);
  const enemyUnits = allUnits.filter((u) => !isPlayerUnit(u));

  // Protagonist dead → immediate loss
  const protagonist = battle.units[state.protagonist.id];
  if (protagonist && (protagonist.status === 'dead')) {
    return 'player_loss';
  }

  // A 'down' unit is out of the fight (consistent with ai.ts isTargetable):
  // it cannot act or be targeted, so it no longer counts toward its side.
  const isOut = (u: (typeof allUnits)[number]) =>
    u.status === 'dead' || u.status === 'routing' || u.status === 'down';

  const allPlayerOut = playerUnits.every(isOut);
  if (allPlayerOut) return 'player_loss';

  const allEnemyOut = enemyUnits.every(isOut);
  if (allEnemyOut) return 'player_win';

  return 'ongoing';
}

export function endBattle(state: TWarbandCampaignState): TWarbandCampaignState {
  const battle = state.activeBattle;
  if (!battle) return state;

  // Write back hp for player units
  const updateMember = (member: TRosterMember): TRosterMember => {
    const unit = battle.units[member.id];
    if (!unit) return member;
    return { ...member, stats: { ...member.stats, hp: unit.currentHp } };
  };

  const updatedCompanions: Record<string, TRosterMember> = {};
  for (const [id, companion] of Object.entries(state.companions)) {
    updatedCompanions[id] = updateMember(companion);
  }

  const updatedHirelings: Record<string, TRosterMember> = {};
  for (const [id, hireling] of Object.entries(state.hirelings)) {
    updatedHirelings[id] = updateMember(hireling);
  }

  const { activeBattle: _dropped, ...rest } = state;
  return {
    ...rest,
    protagonist: updateMember(state.protagonist),
    companions: updatedCompanions,
    hirelings: updatedHirelings,
  };
}

export function moveUnit(
  state: TWarbandCampaignState,
  unitId: string,
  col: number,
  row: number,
): TWarbandCampaignState {
  if (!state.activeBattle) throw new EngineError('no active battle');
  if (col < 0 || col > 4) throw new EngineError(`col ${col} out of bounds (0-4)`);
  if (row < 0 || row > 7) throw new EngineError(`row ${row} out of bounds (0-7)`);

  const unit = state.activeBattle.units[unitId];
  if (!unit) throw new EngineError(`unit "${unitId}" not found`);
  if (unit.status !== 'active') throw new EngineError(`unit "${unitId}" cannot move (status: ${unit.status})`);

  const tile = state.activeBattle.grid[row][col];
  if (tile === 'occupied') throw new EngineError(`tile (${col},${row}) is occupied`);
  if (tile === 'blocked') throw new EngineError(`tile (${col},${row}) is blocked`);

  const newGrid = state.activeBattle.grid.map((r) => [...r]) as Array<Array<'open' | 'blocked' | 'occupied'>>;
  newGrid[unit.position.row][unit.position.col] = 'open';
  newGrid[row][col] = 'occupied';

  return {
    ...state,
    activeBattle: {
      ...state.activeBattle,
      grid: newGrid,
      units: {
        ...state.activeBattle.units,
        [unitId]: { ...unit, position: { col, row }, hasMoved: true },
      },
    },
  };
}

// Range-checked move for player-controlled units. Enforces MOVE_RANGE (Chebyshev)
// from the unit's current position, then delegates to the pure moveUnit. Enemy AI
// uses moveUnit directly (it only ever steps one tile).
export function playerMoveUnit(
  state: TWarbandCampaignState,
  unitId: string,
  col: number,
  row: number,
): TWarbandCampaignState {
  if (!state.activeBattle) throw new EngineError('no active battle');
  const unit = state.activeBattle.units[unitId];
  if (!unit) throw new EngineError(`unit "${unitId}" not found`);
  const d = Math.max(Math.abs(unit.position.col - col), Math.abs(unit.position.row - row));
  if (d > MOVE_RANGE) {
    throw new EngineError(`${unitId} can move at most ${MOVE_RANGE} tiles (tried ${d})`);
  }
  return moveUnit(state, unitId, col, row);
}

export function endTurn(state: TWarbandCampaignState): TWarbandCampaignState {
  if (!state.activeBattle) throw new EngineError('no active battle');
  const { turnOrder, currentTurnIndex, units } = state.activeBattle;
  const nextIndex = (currentTurnIndex + 1) % turnOrder.length;
  const nextUnitId = turnOrder[nextIndex];

  return {
    ...state,
    activeBattle: {
      ...state.activeBattle,
      currentTurnIndex: nextIndex,
      units: {
        ...units,
        [nextUnitId]: { ...units[nextUnitId], hasActed: false, hasMoved: false },
      },
    },
  };
}

export interface AttackResult {
  outcome: 'hit' | 'crit' | 'miss' | 'stumble';
  roll: number;
  damage: number;
  injuryTriggered: InjuryEntry | null;
  moraleEvents: Array<{ unitId: string; moraleHit: number }>;
  narrative: string;
}

type InjuryTables = Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]>;

function chebyshevDistance(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function pickRandom<T>(arr: T[], roller: Roller): T {
  if (arr.length === 0) throw new EngineError('pickRandom: empty array');
  return arr[roller.die(arr.length) - 1];
}

export function resolveAttack(
  state: TWarbandCampaignState,
  attackerId: string,
  targetId: string,
  roller: Roller,
  injuryTables: InjuryTables,
): AttackResult & { state: TWarbandCampaignState } {
  if (!state.activeBattle) throw new EngineError('no active battle');

  const attacker = state.activeBattle.units[attackerId];
  const target = state.activeBattle.units[targetId];
  if (!attacker) throw new EngineError(`attacker "${attackerId}" not found`);
  if (!target) throw new EngineError(`target "${targetId}" not found`);
  if (attacker.status !== 'active') throw new EngineError(`attacker "${attackerId}" cannot act (status: ${attacker.status})`);
  if (target.status === 'dead' || target.status === 'routing') {
    throw new EngineError(`target "${targetId}" is already ${target.status}`);
  }

  const dist = chebyshevDistance(attacker.position, target.position);
  const attackStat = dist <= 1 ? attacker.stats.melee : attacker.stats.ranged;

  const d20 = roller.die(20);
  const attackRoll = d20 + attackStat;
  const isCrit = d20 === 20;
  const isHit = isCrit || attackRoll >= target.stats.defense;
  const isMissByFive = !isHit && (target.stats.defense - attackRoll) >= 5;

  const weaponCategory: 'blunt' | 'cutting' | 'piercing' = 'cutting';

  let damage = 0;
  let injuryTriggered: InjuryEntry | null = null;
  let newUnits = { ...state.activeBattle.units };
  const moraleEvents: Array<{ unitId: string; moraleHit: number }> = [];
  let narrative = '';
  let outcome: AttackResult['outcome'];

  if (!isHit && isMissByFive) {
    outcome = 'stumble';
    narrative = `${attacker.name} stumbles and loses their next action.`;
    newUnits = { ...newUnits, [attackerId]: { ...attacker, hasActed: true, status: 'stunned' as const } };
  } else if (!isHit) {
    outcome = 'miss';
    narrative = `${attacker.name} misses ${target.name} (rolled ${attackRoll} vs defense ${target.stats.defense}).`;
    newUnits = { ...newUnits, [attackerId]: { ...attacker, hasActed: true } };
  } else {
    outcome = isCrit ? 'crit' : 'hit';
    const damageRoll = isCrit ? 6 : roller.die(6);
    damage = Math.max(1, damageRoll + Math.floor(attackStat / 2));

    let newHp = Math.max(0, target.currentHp - damage);
    let newStatus = target.status;

    const injuryThreshold = Math.floor(target.stats.maxHp / 2);
    if (damage >= injuryThreshold || newHp === 0 || isCrit) {
      const table = injuryTables[weaponCategory];
      if (table && table.length > 0) {
        injuryTriggered = pickRandom(table, roller);
      }
    }

    if (newHp === 0) newStatus = 'down';

    newUnits = {
      ...newUnits,
      [attackerId]: { ...attacker, hasActed: true },
      [targetId]: { ...target, currentHp: newHp, status: newStatus },
    };

    if (newStatus === 'down' || newStatus === 'dead') {
      const targetFactionIsPlayer = isPlayerUnit(target);
      for (const [uid, u] of Object.entries(newUnits)) {
        if (uid === targetId) continue;
        if (isPlayerUnit(u) !== targetFactionIsPlayer) continue;
        if (u.status === 'dead' || u.status === 'routing') continue;
        if (chebyshevDistance(u.position, target.position) > 3) continue;

        const moraleRoll = roller.die(6);
        const moraleHit = Math.max(0, moraleRoll - Math.floor(u.stats.resolve / 2));
        if (moraleHit > 0) {
          const newMorale = Math.max(0, u.morale - moraleHit);
          const newUnitStatus = newMorale === 0 ? 'routing' as const : u.status;
          newUnits = { ...newUnits, [uid]: { ...u, morale: newMorale, status: newUnitStatus } };
          moraleEvents.push({ unitId: uid, moraleHit });
        }
      }
    }

    narrative = isCrit
      ? `${attacker.name} lands a critical hit on ${target.name} for ${damage} damage!`
      : `${attacker.name} hits ${target.name} for ${damage} damage.`;
    if (injuryTriggered) narrative += ` ${target.name} suffers ${injuryTriggered.name}!`;
    if (newStatus === 'down') narrative += ` ${target.name} goes down!`;
  }

  return {
    outcome,
    roll: attackRoll,
    damage,
    injuryTriggered,
    moraleEvents,
    narrative,
    state: { ...state, activeBattle: { ...state.activeBattle, units: newUnits } },
  };
}
