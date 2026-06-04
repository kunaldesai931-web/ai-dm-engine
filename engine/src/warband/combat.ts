import { EngineError } from '../core/errors.js';
import type { Roller } from '../core/rng.js';
import type { TCombatUnit, TRosterMember, TWarbandCampaignState } from './schema.js';

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

  const allPlayerOut = playerUnits.every(
    (u) => u.status === 'dead' || u.status === 'routing',
  );
  if (allPlayerOut) return 'player_loss';

  const allEnemyOut = enemyUnits.every(
    (u) => u.status === 'dead' || u.status === 'routing',
  );
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
