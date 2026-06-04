#!/usr/bin/env node
// Warband CLI. Pattern: resolve campaign -> load state -> run op ->
// (if mutated) save + log -> print JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from '../core/errors.js';
import { makeRoller } from '../core/rng.js';
import {
  resolveWarbandCampaign,
  loadWarbandState,
  saveWarbandState,
  createWarbandCampaign,
  logWarbandEvent,
  WARBAND_DIR,
} from './warbandState.js';
import { parseWarbandCampaignState } from './schema.js';
import { generateHireling } from './generator.js';
import { gainXp, levelUp, xpToNextLevel } from './progression.js';
import {
  startBattle,
  playerMoveUnit,
  resolveAttack,
  getBattleOutcome,
  endBattle,
  type EnemySpawn,
} from './combat.js';
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, '..', '..', '..', 'engine', 'data');

interface Parsed { positional: string[]; flags: Record<string, string | true>; }
function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { flags[body] = next; i++; }
        else { flags[body] = true; }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function str(v: string | true | undefined): string | undefined {
  return v === true || v == null ? undefined : v;
}

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function loadData<T>(filename: string): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8')) as T;
  } catch {
    throw new EngineError(`failed to load data file: ${filename}`);
  }
}

type Background = {
  id: string; name: string; description: string;
  stats: { melee: number; ranged: number; defense: number; resolve: number; initiative: number; maxHp: number; };
  startingTrait: string; startingGear: string[]; perkPool: string[];
};

type PerkDef = { id: string; name: string; description: string; };

function makeProtagonist(name: string, bg: Background): import('./schema.js').TRosterMember {
  return {
    id: 'protagonist',
    name,
    role: 'protagonist',
    backgroundId: bg.id,
    level: 1,
    xp: 0,
    stats: {
      melee: bg.stats.melee,
      ranged: bg.stats.ranged,
      defense: bg.stats.defense,
      resolve: bg.stats.resolve,
      initiative: bg.stats.initiative,
      hp: bg.stats.maxHp,
      maxHp: bg.stats.maxHp,
    },
    traits: [bg.startingTrait],
    perks: [],
    injuries: [],
    gear: [...bg.startingGear],
    wages: 0,
    morale: 7,
  };
}

function findMember(state: import('./schema.js').TWarbandCampaignState, id: string) {
  if (id === 'protagonist') return state.protagonist;
  if (state.companions[id]) return state.companions[id];
  if (state.hirelings[id]) return state.hirelings[id];
  throw new EngineError(`no roster member with id "${id}"`);
}

function updateMember(
  state: import('./schema.js').TWarbandCampaignState,
  id: string,
  member: import('./schema.js').TRosterMember,
): import('./schema.js').TWarbandCampaignState {
  if (id === 'protagonist') return { ...state, protagonist: member };
  if (state.companions[id]) return { ...state, companions: { ...state.companions, [id]: member } };
  if (state.hirelings[id]) return { ...state, hirelings: { ...state.hirelings, [id]: member } };
  throw new EngineError(`no roster member with id "${id}"`);
}

function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];

  if (!cmd || cmd === 'help') {
    return out({ usage: [
      'warband campaign create <name> --background <id> [--name <n>]',
      '       campaign list',
      '       roster list | roster hire --background <id> | roster fire <id> | roster show <id>',
      '       progress xp <id> <amount> | progress levelup <id> --perk <id>',
      '       combat start --enemies "id:type,..."   Start a battle',
      '       combat status                          Show battle state',
      '       combat move <unitId> <col> <row>       Move a unit',
      '       combat attack <attackerId> <targetId>  Resolve an attack',
      '       combat end-turn                        End current unit\'s turn',
      '       combat flee                            Retreat from battle',
      '       combat end                             End a won/lost battle',
    ].join('\n') });
  }

  // No-campaign commands
  if (cmd === 'campaign' && sub === 'list') {
    const entries = fs.existsSync(WARBAND_DIR)
      ? fs.readdirSync(WARBAND_DIR).filter((d) => fs.existsSync(path.join(WARBAND_DIR, d, 'state.json')))
      : [];
    return out({ op: 'campaign.list', campaigns: entries });
  }

  if (cmd === 'campaign' && sub === 'create') {
    const campaignName = positional[2];
    if (!campaignName) throw new EngineError('usage: warband campaign create <name> --background <id>');
    const bgId = str(flags.background);
    if (!bgId) throw new EngineError('--background <id> required');
    const backgrounds = loadData<Background[]>('backgrounds.json');
    const bg = backgrounds.find((b) => b.id === bgId);
    if (!bg) throw new EngineError(`unknown background "${bgId}"; available: ${backgrounds.map((b) => b.id).join(', ')}`);
    const protagonistName = str(flags.name) ?? 'Unnamed';
    const protagonist = makeProtagonist(protagonistName, bg);
    const seed = `${campaignName}-${Date.now()}`;
    const initialState = parseWarbandCampaignState({
      meta: { campaign: campaignName, day: 1, gold: 100 },
      rng: { seed, cursor: 0 },
      protagonist,
      companions: {},
      hirelings: {},
      activeQuests: [],
    });
    const campaign = createWarbandCampaign(campaignName, initialState);
    logWarbandEvent(campaign, { event: 'campaign.create', campaign: campaignName, protagonist: protagonistName, background: bgId });
    return out({ op: 'campaign.create', campaign: campaignName, protagonist: initialState.protagonist, rng: initialState.rng });
  }

  // Commands that need existing campaign
  const campaign = resolveWarbandCampaign(str(flags.campaign));
  let state = loadWarbandState(campaign);
  let result: any, mutated = false;

  const key = `${cmd} ${sub}`;

  switch (key) {
    case 'roster list': {
      const roster = [
        state.protagonist,
        ...Object.values(state.companions).filter((companion) => !companion.death),
        ...Object.values(state.hirelings).filter((hireling) => !hireling.death),
      ].map((m) => ({ id: m.id, name: m.name, role: m.role, level: m.level, xp: m.xp, backgroundId: m.backgroundId, dead: !!m.death }));
      result = { op: 'roster.list', roster };
      break;
    }

    case 'roster hire': {
      const bgId = str(flags.background);
      const backgrounds = loadData<Background[]>('backgrounds.json');
      const filteredBgs = bgId ? backgrounds.filter((b) => b.id === bgId) : backgrounds;
      if (bgId && filteredBgs.length === 0) throw new EngineError(`unknown background "${bgId}"`);
      // collect all known traits from backgrounds
      const traits = [...new Set(backgrounds.map((b) => b.startingTrait))];
      const roller = makeRoller(state.rng);
      const hireling = generateHireling(roller, filteredBgs, traits);
      state = { ...state, hirelings: { ...state.hirelings, [hireling.id]: hireling } };
      result = { op: 'roster.hire', hireling, rng: roller.consumed() };
      mutated = true;
      break;
    }

    case 'roster fire': {
      const id = positional[2];
      if (!id) throw new EngineError('usage: warband roster fire <id>');
      if (id === 'protagonist') throw new EngineError('cannot fire the protagonist');
      if (!state.hirelings[id] && !state.companions[id]) throw new EngineError(`no member with id "${id}"`);
      const newHirelings = { ...state.hirelings };
      const newCompanions = { ...state.companions };
      delete newHirelings[id];
      delete newCompanions[id];
      state = { ...state, hirelings: newHirelings, companions: newCompanions };
      result = { op: 'roster.fire', id };
      mutated = true;
      break;
    }

    case 'roster show': {
      const id = positional[2];
      if (!id) throw new EngineError('usage: warband roster show <id>');
      const member = findMember(state, id);
      result = { op: 'roster.show', member };
      break;
    }

    case 'progress xp': {
      const id = positional[2];
      const amountStr = positional[3];
      if (!id || !amountStr) throw new EngineError('usage: warband progress xp <id> <amount>');
      const amount = parseInt(amountStr, 10);
      if (isNaN(amount) || amount < 0) throw new EngineError(`invalid amount "${amountStr}"`);
      const member = findMember(state, id);
      const updated = gainXp(member, amount);
      const threshold = xpToNextLevel(updated.level);
      state = updateMember(state, id, updated);
      result = { op: 'progress.xp', id, xp: updated.xp, level: updated.level, xpNeeded: threshold, readyToLevel: updated.xp >= threshold };
      mutated = true;
      break;
    }

    case 'progress levelup': {
      const id = positional[2];
      const perkId = str(flags.perk);
      if (!id) throw new EngineError('usage: warband progress levelup <id> --perk <id>');
      if (!perkId) throw new EngineError('--perk <id> required');
      const perks = loadData<PerkDef[]>('perks.json');
      if (!perks.find((p) => p.id === perkId)) throw new EngineError(`unknown perk "${perkId}"; available: ${perks.map((p) => p.id).join(', ')}`);
      const member = findMember(state, id);
      const threshold = xpToNextLevel(member.level);
      if (member.xp < threshold) throw new EngineError(`${id} needs ${threshold} xp to level up (has ${member.xp})`);
      const updated = levelUp(member, perkId);
      state = updateMember(state, id, updated);
      result = { op: 'progress.levelup', id, level: updated.level, xp: updated.xp, perks: updated.perks };
      mutated = true;
      break;
    }

    case 'combat start': {
      const enemiesArg = str(flags.enemies);
      if (!enemiesArg) throw new EngineError('--enemies "id:type,id:type" required');
      const enemyDefs = loadData<any[]>('enemies.json');
      const spawns: EnemySpawn[] = enemiesArg.split(',').map((token) => {
        const parts = token.trim().split(':');
        if (parts.length !== 2) throw new EngineError(`bad enemy token "${token.trim()}" — expected format: id:typeId`);
        const [id, typeId] = parts;
        const def = enemyDefs.find((d: any) => d.id === typeId);
        if (!def) throw new EngineError(`unknown enemy type "${typeId}". Available: ${enemyDefs.map((d: any) => d.id).join(', ')}`);
        return { id, typeId, name: def.name, stats: def.stats, morale: def.morale, weaponCategory: def.weaponCategory, named: def.named ?? false };
      });
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawns, roller);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      mutated = true;
      result = {
        op: 'combat.start',
        battleId: state.activeBattle!.battleId,
        turnOrder: state.activeBattle!.turnOrder,
        units: Object.values(state.activeBattle!.units).map((u) => ({
          id: u.memberId, name: u.name, role: u.role, hp: u.currentHp, maxHp: u.stats.maxHp, position: u.position, status: u.status,
        })),
        log: enemyRun.log,
        currentTurn: state.activeBattle ? currentActorId(state) : null,
      };
      break;
    }

    case 'combat status': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const { turnOrder, currentTurnIndex } = state.activeBattle;
      if (currentTurnIndex >= turnOrder.length) throw new EngineError('invalid battle state: turn index out of range');
      const currentId = turnOrder[currentTurnIndex];
      result = {
        op: 'combat.status',
        battleId: state.activeBattle.battleId,
        currentTurn: currentId,
        turnIndex: state.activeBattle.currentTurnIndex,
        outcome: getBattleOutcome(state),
        units: Object.entries(state.activeBattle.units).map(([id, u]) => ({
          id, name: u.name, role: u.role, hp: u.currentHp, maxHp: u.stats.maxHp, morale: u.morale, position: u.position, status: u.status, hasActed: u.hasActed, hasMoved: u.hasMoved,
        })),
        grid: state.activeBattle.grid,
      };
      break;
    }

    case 'combat move': {
      const unitId = positional[2];
      const col = parseInt(positional[3] ?? '', 10);
      const row = parseInt(positional[4] ?? '', 10);
      if (!unitId || isNaN(col) || isNaN(row)) throw new EngineError('usage: warband combat move <unitId> <col> <row>');
      if (!state.activeBattle) throw new EngineError('no active battle');
      const actor = currentActorId(state);
      if (unitId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${unitId}'s`);
      state = playerMoveUnit(state, unitId, col, row);
      mutated = true;
      result = { op: 'combat.move', unitId, position: { col, row } };
      break;
    }

    case 'combat attack': {
      const attackerId = positional[2];
      const targetId = positional[3];
      if (!attackerId || !targetId) throw new EngineError('usage: warband combat attack <attackerId> <targetId>');
      if (!state.activeBattle) throw new EngineError('no active battle');
      const actor = currentActorId(state);
      if (attackerId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${attackerId}'s`);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      const attackResult = resolveAttack(state, attackerId, targetId, roller, injuries);
      state = attackResult.state;
      mutated = true;
      result = {
        op: 'combat.attack',
        outcome: attackResult.outcome,
        roll: attackResult.roll,
        damage: attackResult.damage,
        injury: attackResult.injuryTriggered,
        moraleEvents: attackResult.moraleEvents,
        narrative: attackResult.narrative,
        targetHp: state.activeBattle?.units[targetId]?.currentHp ?? null,
        targetStatus: state.activeBattle?.units[targetId]?.status ?? null,
        battleOutcome: getBattleOutcome(state),
      };
      if (state.activeBattle && getBattleOutcome(state) !== 'ongoing') {
        const oc = getBattleOutcome(state);
        const c = concludeBattle(state, makeRoller(state.rng), { battleId: state.activeBattle.battleId, dayOfCampaign: state.meta.day, location: 'the field' });
        state = c.state;
        result = { ...result, finished: true, battleOutcome: oc, casualties: c.casualties };
      }
      break;
    }

    case 'combat end-turn': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      state = advanceTurn(state);
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      let finished = false; let outcome; let casualties;
      if (state.activeBattle && getBattleOutcome(state) !== 'ongoing') {
        outcome = getBattleOutcome(state);
        const c = concludeBattle(state, roller, { battleId: state.activeBattle.battleId, dayOfCampaign: state.meta.day, location: 'the field' });
        state = c.state; finished = true; casualties = c.casualties;
      }
      mutated = true;
      result = { op: 'combat.end-turn', log: enemyRun.log, finished, outcome, casualties, currentTurn: state.activeBattle ? currentActorId(state) : null };
      break;
    }

    case 'combat flee': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      state = endBattle(state);
      mutated = true;
      result = { op: 'combat.flee', message: 'Retreated from battle. HP carried over.' };
      break;
    }

    case 'combat end': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const outcome = getBattleOutcome(state);
      if (outcome === 'ongoing') throw new EngineError('battle is still ongoing — use combat flee to retreat');
      state = endBattle(state);
      mutated = true;
      result = { op: 'combat.end', outcome };
      break;
    }

    default:
      throw new EngineError(`unknown command "${cmd} ${sub ?? ''}".`);
  }

  if (mutated) {
    saveWarbandState(campaign, state);
    logWarbandEvent(campaign, { event: result.op, detail: result });
  }
  out({ campaign: campaign.name, ...result });
}

try { main(); }
catch (err: any) {
  const msg = err instanceof EngineError ? err.message : String(err?.stack || err);
  process.stderr.write(JSON.stringify({ error: msg }, null, 2) + '\n');
  process.exit(1);
}
