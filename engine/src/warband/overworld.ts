// Overworld engine: pure functions for travel, contract generation/resolution,
// wages, and crisis progression. No input mutation — every function returns new
// state. Invalid input raises EngineError. The server/CLI wire battles; this
// module never calls startBattle (avoids a module cycle).

import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TContract, TOverworld } from './schema.js';
import { EngineError } from '../core/errors.js';

export interface WorldLocation { id: string; name: string; type: 'town' | 'landmark'; start?: boolean; }
export interface WorldRoute { from: string; to: string; days: number; }
export interface WorldRegion { id: string; name: string; danger: number; locations: WorldLocation[]; routes: WorldRoute[]; }
export interface ContractTemplate { type: 'bounty' | 'raid' | 'defense'; title: string; enemyPool: string[]; size: number; gold: number; intel: number; }
export interface WorldData {
  regions: WorldRegion[];
  crisis: { name: string; clockSegments: number; intelNeeded: number; finalLocationId: string; finalEnemySpec: string };
  contractTemplates: ContractTemplate[];
}

const PROVISIONS_START = 20;

// ---- location helpers ----

export function allLocations(world: WorldData): WorldLocation[] {
  return world.regions.flatMap((r) => r.locations);
}

export function findLocation(world: WorldData, id: string): WorldLocation | undefined {
  return allLocations(world).find((l) => l.id === id);
}

// Region containing a given location id.
function regionOfLocation(world: WorldData, id: string): WorldRegion | undefined {
  return world.regions.find((r) => r.locations.some((l) => l.id === id));
}

export function startLocation(world: WorldData): WorldLocation {
  const start = allLocations(world).find((l) => l.start);
  if (start) return start;
  const first = allLocations(world)[0];
  if (!first) throw new EngineError('world has no locations');
  return first;
}

// Undirected neighbors: a route matches if from===id OR to===id; return the
// other endpoint + days. Deduped by neighbor id (first route wins).
export function neighbors(world: WorldData, locationId: string): Array<{ id: string; name: string; days: number }> {
  const out: Array<{ id: string; name: string; days: number }> = [];
  const seen = new Set<string>();
  for (const region of world.regions) {
    for (const route of region.routes) {
      let otherId: string | undefined;
      if (route.from === locationId) otherId = route.to;
      else if (route.to === locationId) otherId = route.from;
      if (otherId === undefined || seen.has(otherId)) continue;
      const loc = findLocation(world, otherId);
      if (!loc) continue;
      seen.add(otherId);
      out.push({ id: loc.id, name: loc.name, days: route.days });
    }
  }
  return out;
}

// ---- contract generation ----

export function generateContracts(world: WorldData, locationId: string, roller: Roller, day: number): TContract[] {
  const ns = neighbors(world, locationId);
  return world.contractTemplates.map((tmpl, i) => {
    // destination: a neighbor of locationId, or the location itself if none.
    let dest: WorldLocation;
    if (ns.length > 0) {
      const pick = ns[roller.die(ns.length) - 1]!;
      dest = findLocation(world, pick.id) ?? { id: pick.id, name: pick.name, type: 'town' };
    } else {
      dest = findLocation(world, locationId) ?? { id: locationId, name: locationId, type: 'town' };
    }
    // enemySpec: sample `size` types from enemyPool as e1:type,e2:type,...
    const parts: string[] = [];
    for (let e = 0; e < tmpl.size; e++) {
      const type = tmpl.enemyPool[roller.die(tmpl.enemyPool.length) - 1]!;
      parts.push(`e${e + 1}:${type}`);
    }
    const id = `ct-${day}-${i}-${roller.die(9999)}`;
    return {
      id,
      type: tmpl.type,
      title: tmpl.title.replace('{loc}', dest.name),
      locationId: dest.id,
      enemySpec: parts.join(','),
      goldReward: tmpl.gold,
      intelReward: tmpl.intel,
      expiresDay: day + 10,
    };
  });
}

// ---- init ----

export function initOverworld(state: TWarbandCampaignState, world: WorldData, roller: Roller): TWarbandCampaignState {
  const start = startLocation(world);
  const day = state.meta.day;
  const overworld: TOverworld = {
    currentLocation: start.id,
    provisions: PROVISIONS_START,
    contracts: generateContracts(world, start.id, roller, day),
    activeContractId: null,
    crisis: {
      name: world.crisis.name,
      clockFilled: 0,
      clockSegments: world.crisis.clockSegments,
      intel: 0,
      intelNeeded: world.crisis.intelNeeded,
      unlocked: false,
      resolved: false,
      finalLocationId: world.crisis.finalLocationId,
    },
    lastPaydayDay: day,
  };
  return { ...state, overworld };
}

// ---- travel ----

export function travel(
  state: TWarbandCampaignState,
  world: WorldData,
  destId: string,
  roller: Roller,
): { state: TWarbandCampaignState; encounter: boolean } {
  const ow = state.overworld;
  if (!ow) throw new EngineError('no overworld block on state');
  const ns = neighbors(world, ow.currentLocation);
  const route = ns.find((n) => n.id === destId);
  if (!route) throw new EngineError(`${destId} is not reachable from ${ow.currentLocation}`);

  const days = route.days;
  const newDay = state.meta.day + days;
  const provisions = Math.max(0, ow.provisions - days);
  const clockFilled = Math.min(
    ow.crisis.clockSegments,
    ow.crisis.clockFilled + Math.floor(days / 2),
  );

  const region = regionOfLocation(world, destId);
  const danger = region ? region.danger : 0;
  const encounter = roller.die(100) <= danger * 10;

  const destLoc = findLocation(world, destId);
  let contracts = ow.contracts;
  // Regenerate contracts at the destination if it's a town with none for this location.
  if (destLoc && destLoc.type === 'town' && !contracts.some((c) => c.locationId === destId)) {
    contracts = generateContracts(world, destId, roller, newDay);
  }

  const nextOw: TOverworld = {
    ...ow,
    currentLocation: destId,
    provisions,
    contracts,
    crisis: { ...ow.crisis, clockFilled },
  };
  return {
    state: { ...state, meta: { ...state.meta, day: newDay }, overworld: nextOw },
    encounter,
  };
}

// ---- contracts ----

export function takeContract(state: TWarbandCampaignState, contractId: string): TWarbandCampaignState {
  const ow = state.overworld;
  if (!ow) throw new EngineError('no overworld block on state');
  if (!ow.contracts.some((c) => c.id === contractId)) {
    throw new EngineError(`contract not found: ${contractId}`);
  }
  return { ...state, overworld: { ...ow, activeContractId: contractId } };
}

export function resolveContractWin(state: TWarbandCampaignState): TWarbandCampaignState {
  const ow = state.overworld;
  if (!ow || !ow.activeContractId) return state;
  const contract = ow.contracts.find((c) => c.id === ow.activeContractId);
  if (!contract) {
    // active contract no longer present — just clear it.
    return { ...state, overworld: { ...ow, activeContractId: null } };
  }
  const intel = ow.crisis.intel + contract.intelReward;
  const unlocked = ow.crisis.unlocked || intel >= ow.crisis.intelNeeded;
  const nextOw: TOverworld = {
    ...ow,
    contracts: ow.contracts.filter((c) => c.id !== contract.id),
    activeContractId: null,
    crisis: { ...ow.crisis, intel, unlocked },
  };
  return {
    ...state,
    meta: { ...state.meta, gold: state.meta.gold + contract.goldReward },
    overworld: nextOw,
  };
}

export function resolveContractLoss(state: TWarbandCampaignState): TWarbandCampaignState {
  const ow = state.overworld;
  if (!ow || !ow.activeContractId) return state;
  // v1: no penalty. Clear active; leave the contract available.
  return { ...state, overworld: { ...ow, activeContractId: null } };
}

// ---- wages ----

export function payWages(state: TWarbandCampaignState): { state: TWarbandCampaignState; paid: boolean; deserted: string[] } {
  const ow = state.overworld;
  if (!ow) throw new EngineError('no overworld block on state');
  if (state.meta.day - ow.lastPaydayDay < 7) {
    return { state, paid: false, deserted: [] };
  }
  const hirelingIds = Object.keys(state.hirelings);
  const total = hirelingIds.reduce((sum, id) => sum + state.hirelings[id]!.wages, 0);

  if (state.meta.gold >= total) {
    const nextState: TWarbandCampaignState = {
      ...state,
      meta: { ...state.meta, gold: state.meta.gold - total },
      overworld: { ...ow, lastPaydayDay: state.meta.day },
    };
    return { state: nextState, paid: true, deserted: [] };
  }

  // Can't make payroll → all hirelings desert.
  const nextState: TWarbandCampaignState = {
    ...state,
    hirelings: {},
    overworld: { ...ow, lastPaydayDay: state.meta.day },
  };
  return { state: nextState, paid: true, deserted: hirelingIds };
}

// ---- crisis ----

export function advanceCrisisClock(state: TWarbandCampaignState, amount: number): TWarbandCampaignState {
  const ow = state.overworld;
  if (!ow) throw new EngineError('no overworld block on state');
  const clockFilled = Math.min(ow.crisis.clockSegments, ow.crisis.clockFilled + amount);
  return { ...state, overworld: { ...ow, crisis: { ...ow.crisis, clockFilled } } };
}

export function craftFinalBattleSpec(world: WorldData): string {
  return world.crisis.finalEnemySpec;
}
