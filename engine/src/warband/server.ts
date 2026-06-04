#!/usr/bin/env node
// Self-contained warband game server. Serves the browser UI (engine/web) and a
// small JSON API over the same combat functions the CLI uses. One process is the
// whole stack: `npm run warband-serve` then open the printed URL.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from '../core/errors.js';
import { makeRoller } from '../core/rng.js';
import {
  resolveWarbandCampaign,
  loadWarbandState,
  saveWarbandState,
  logWarbandEvent,
  WARBAND_DIR,
} from './warbandState.js';
import {
  startBattle,
  playerMoveUnit,
  resolveAttack,
  getBattleOutcome,
  endBattle,
  type EnemySpawn,
} from './combat.js';
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';
import * as overworld from './overworld.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, '..', '..', 'web');
const DATA_DIR = path.resolve(HERE, '..', '..', 'data');
const PORT = Number(process.env.WARBAND_PORT) || 4500;

function loadData<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
}

const WORLD = loadData<overworld.WorldData>('world.json');

// Parse an "id:typeId,..." enemy spec into EnemySpawn[]. Loads enemies.json.
function spawnsFromSpec(spec: string): EnemySpawn[] {
  if (!spec) throw new EngineError('enemies spec required, e.g. "b1:bandit,b2:archer"');
  const defs = loadData<Array<Record<string, any>>>('enemies.json');
  return spec.split(',').map((tok) => {
    const parts = tok.trim().split(':');
    if (parts.length !== 2) throw new EngineError(`bad enemy token "${tok.trim()}" — expected id:typeId`);
    const [id, typeId] = parts;
    const def = defs.find((d) => d.id === typeId);
    if (!def) throw new EngineError(`unknown enemy type "${typeId}". Available: ${defs.map((d) => d.id).join(', ')}`);
    return {
      id,
      typeId,
      name: def.name,
      stats: def.stats,
      morale: def.morale,
      weaponCategory: def.weaponCategory,
      named: def.named ?? false,
    };
  });
}

// After any action, if the battle is decided, resolve casualties and close it.
// Returns the post-state plus any casualty/outcome info to surface to the client.
function maybeConclude(
  state: import('./schema.js').TWarbandCampaignState,
  roller: import('../core/rng.js').Roller,
): { state: import('./schema.js').TWarbandCampaignState; finished: boolean; outcome?: string; casualties?: unknown[] } {
  if (!state.activeBattle) return { state, finished: false };
  const outcome = getBattleOutcome(state);
  if (outcome === 'ongoing') return { state, finished: false };
  const ctx = {
    battleId: state.activeBattle.battleId,
    dayOfCampaign: state.meta.day,
    location: 'the field',
  };
  const r = concludeBattle(state, roller, ctx);
  return { state: r.state, finished: true, outcome, casualties: r.casualties };
}

// Conclude a battle and, if it carried an overworld context tag, credit the
// reward. The context must be read BEFORE concludeBattle (which drops
// activeBattle). Used by contract/crisis/encounter battles and by the normal
// attack/end-turn paths so a contract battle finished by an ordinary attack
// still pays out.
function concludeWithRewards(
  state: import('./schema.js').TWarbandCampaignState,
  roller: import('../core/rng.js').Roller,
): {
  state: import('./schema.js').TWarbandCampaignState;
  finished: boolean;
  outcome?: string;
  casualties?: unknown[];
  contractResolved?: 'win' | 'loss';
  campaignWon?: boolean;
} {
  const ctx = state.activeBattle?.context; // capture BEFORE conclude
  const conc = maybeConclude(state, roller);
  let next = conc.state;
  let reward: { contractResolved?: 'win' | 'loss'; campaignWon?: boolean } = {};
  if (conc.finished && ctx) {
    if (ctx.kind === 'contract') {
      if (conc.outcome === 'player_win') {
        next = overworld.resolveContractWin(next);
        reward = { contractResolved: 'win' };
      } else {
        next = overworld.resolveContractLoss(next);
        reward = { contractResolved: 'loss' };
      }
    } else if (ctx.kind === 'crisis' && conc.outcome === 'player_win') {
      next = {
        ...next,
        overworld: next.overworld
          ? { ...next.overworld, crisis: { ...next.overworld.crisis, resolved: true } }
          : next.overworld,
      };
      reward = { campaignWon: true };
    }
  }
  return { state: next, finished: conc.finished, outcome: conc.outcome, casualties: conc.casualties, ...reward };
}

function listCampaigns(): string[] {
  if (!fs.existsSync(WARBAND_DIR)) return [];
  return fs
    .readdirSync(WARBAND_DIR)
    .filter((d) => fs.existsSync(path.join(WARBAND_DIR, d, 'state.json')));
}

// Thin HTTP-facing dispatcher over the combat functions. Mirrors the CLI's combat
// subcommands but takes structured args instead of argv.
function runCommand(campaignName: string, command: string, args: Record<string, unknown>) {
  const campaign = resolveWarbandCampaign(campaignName);
  let state = loadWarbandState(campaign);
  let narrative = '';
  let extra: Record<string, unknown> = {};

  switch (command) {
    case 'start': {
      const spec = String(args.enemies ?? '');
      const spawns = spawnsFromSpec(spec);
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawns, roller);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      const conc = maybeConclude(state, roller);
      state = conc.state;
      narrative = 'Battle begins.';
      extra = { log: enemyRun.log, currentTurn: state.activeBattle ? currentActorId(state) : null, ...(conc.finished ? { finished: true, outcome: conc.outcome, casualties: conc.casualties } : {}) };
      break;
    }
    case 'move': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const unitId = String(args.unitId);
      const actor = currentActorId(state);
      if (unitId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${unitId}'s`);
      const u = state.activeBattle.units[unitId];
      if (!u || u.role === 'enemy') throw new EngineError('you can only move your own units');
      if (u.hasMoved) throw new EngineError(`${unitId} has already moved this turn`);
      state = playerMoveUnit(state, unitId, Number(args.col), Number(args.row));
      narrative = `${unitId} moves to (${args.col},${args.row}).`;
      extra = { currentTurn: currentActorId(state) };
      break;
    }
    case 'attack': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const attackerId = String(args.attackerId);
      const actor = currentActorId(state);
      if (attackerId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${attackerId}'s`);
      const a = state.activeBattle.units[attackerId];
      if (!a || a.role === 'enemy') throw new EngineError('you can only attack with your own units');
      if (a.hasActed) throw new EngineError(`${attackerId} has already acted this turn`);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      const r = resolveAttack(state, attackerId, String(args.targetId), roller, injuries);
      state = r.state;
      narrative = r.narrative;
      const conc = concludeWithRewards(state, roller);
      state = conc.state;
      extra = {
        outcome: r.outcome, roll: r.roll, damage: r.damage, injury: r.injuryTriggered, moraleEvents: r.moraleEvents,
        ...(conc.finished
          ? {
              finished: true,
              battleOutcome: conc.outcome,
              casualties: conc.casualties,
              ...(conc.contractResolved ? { contractResolved: conc.contractResolved } : {}),
              ...(conc.campaignWon ? { campaignWon: true } : {}),
            }
          : { battleOutcome: 'ongoing', currentTurn: currentActorId(state) }),
      };
      break;
    }
    case 'end-turn': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      state = advanceTurn(state);
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      const conc = concludeWithRewards(state, roller);
      state = conc.state;
      narrative = state.activeBattle ? `Turn passes to ${currentActorId(state)}.` : 'The battle is over.';
      extra = {
        log: enemyRun.log,
        ...(conc.finished
          ? {
              finished: true,
              outcome: conc.outcome,
              casualties: conc.casualties,
              ...(conc.contractResolved ? { contractResolved: conc.contractResolved } : {}),
              ...(conc.campaignWon ? { campaignWon: true } : {}),
            }
          : { currentTurn: state.activeBattle ? currentActorId(state) : null }),
      };
      break;
    }
    case 'flee': {
      state = endBattle(state);
      narrative = 'You retreat from battle. HP carried over.';
      break;
    }
    case 'end': {
      const outcome = getBattleOutcome(state);
      if (outcome === 'ongoing') throw new EngineError('battle still ongoing — flee to retreat');
      state = endBattle(state);
      narrative = outcome === 'player_win' ? 'Victory!' : 'Defeat.';
      extra = { outcome };
      break;
    }
    case 'ow-status': {
      narrative = 'Overworld status.';
      extra = {
        op: 'ow-status',
        overworld: state.overworld,
        neighbors: state.overworld ? overworld.neighbors(WORLD, state.overworld.currentLocation) : [],
      };
      break;
    }
    case 'travel': {
      const roller = makeRoller(state.rng);
      const r = overworld.travel(state, WORLD, String(args.to), roller);
      state = r.state;
      const wages = overworld.payWages(state);
      state = wages.state;
      narrative = `Traveled to ${state.overworld!.currentLocation}.`;
      let battleExtra: Record<string, unknown> = {};
      if (r.encounter) {
        const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
        const spawns = spawnsFromSpec('e1:bandit,e2:bandit');
        state = startBattle(state, spawns, roller);
        state = { ...state, activeBattle: { ...state.activeBattle!, context: { kind: 'encounter' } } };
        const er = runEnemyTurns(state, roller, injuries);
        state = er.state;
        const conc = concludeWithRewards(state, roller);
        state = conc.state;
        narrative = `Ambushed en route to ${r.state.overworld!.currentLocation}!`;
        battleExtra = {
          log: er.log,
          currentTurn: state.activeBattle ? currentActorId(state) : null,
          ...(conc.finished ? { finished: true, outcome: conc.outcome, casualties: conc.casualties } : {}),
        };
      }
      extra = {
        op: 'travel',
        overworld: state.overworld,
        encounter: r.encounter,
        wagesPaid: wages.paid,
        deserted: wages.deserted,
        ...battleExtra,
      };
      break;
    }
    case 'take-contract': {
      state = overworld.takeContract(state, String(args.contractId));
      narrative = `Took contract ${args.contractId}.`;
      extra = { op: 'take-contract', overworld: state.overworld };
      break;
    }
    case 'start-contract': {
      const ow = state.overworld;
      if (!ow?.activeContractId) throw new EngineError('no active contract');
      const contract = ow.contracts.find((c) => c.id === ow.activeContractId);
      if (!contract) throw new EngineError(`active contract ${ow.activeContractId} not found`);
      if (ow.currentLocation !== contract.locationId) {
        throw new EngineError(`travel to ${contract.locationId} first`);
      }
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawnsFromSpec(contract.enemySpec), roller);
      state = { ...state, activeBattle: { ...state.activeBattle!, context: { kind: 'contract', contractId: contract.id } } };
      const er = runEnemyTurns(state, roller, injuries);
      state = er.state;
      const conc = concludeWithRewards(state, roller);
      state = conc.state;
      narrative = `Contract battle begins: ${contract.title}.`;
      extra = {
        op: 'start-contract',
        log: er.log,
        currentTurn: state.activeBattle ? currentActorId(state) : null,
        ...(conc.finished
          ? {
              finished: true,
              outcome: conc.outcome,
              casualties: conc.casualties,
              ...(conc.contractResolved ? { contractResolved: conc.contractResolved } : {}),
            }
          : {}),
      };
      break;
    }
    case 'start-crisis': {
      const ow = state.overworld;
      if (!ow?.crisis.unlocked || ow.crisis.resolved) throw new EngineError('crisis not available');
      if (ow.currentLocation !== ow.crisis.finalLocationId) {
        throw new EngineError(`travel to ${ow.crisis.finalLocationId} first`);
      }
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawnsFromSpec(WORLD.crisis.finalEnemySpec), roller);
      state = { ...state, activeBattle: { ...state.activeBattle!, context: { kind: 'crisis' } } };
      const er = runEnemyTurns(state, roller, injuries);
      state = er.state;
      const conc = concludeWithRewards(state, roller);
      state = conc.state;
      narrative = `The final confrontation begins: ${ow.crisis.name}.`;
      extra = {
        op: 'start-crisis',
        log: er.log,
        currentTurn: state.activeBattle ? currentActorId(state) : null,
        ...(conc.finished
          ? {
              finished: true,
              outcome: conc.outcome,
              casualties: conc.casualties,
              ...(conc.campaignWon ? { campaignWon: true } : {}),
            }
          : {}),
      };
      break;
    }
    case 'pay-wages': {
      const r = overworld.payWages(state);
      state = r.state;
      narrative = r.paid ? 'Wages paid.' : 'Wages not due yet.';
      extra = { op: 'pay-wages', paid: r.paid, deserted: r.deserted, gold: state.meta.gold };
      break;
    }
    default:
      throw new EngineError(`unknown command "${command}"`);
  }

  saveWarbandState(campaign, state);
  logWarbandEvent(campaign, { command, ts: new Date().toISOString() });
  return { ok: true, narrative, ...extra, state };
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.join(WEB_DIR, rel);
  // Any unknown non-API path falls back to index.html (single-page app).
  const target = full.startsWith(WEB_DIR) && fs.existsSync(full) && fs.statSync(full).isFile()
    ? full
    : path.join(WEB_DIR, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('UI not found — expected engine/web/index.html');
    return;
  }
  const ext = path.extname(target);
  const mime =
    ext === '.html' ? 'text/html'
    : ext === '.js' ? 'text/javascript'
    : ext === '.css' ? 'text/css'
    : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(fs.readFileSync(target));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/warband/campaigns') {
      return sendJson(res, 200, { campaigns: listCampaigns() });
    }

    if (req.method === 'GET' && url.pathname === '/api/warband/world') {
      return sendJson(res, 200, WORLD);
    }

    if (req.method === 'GET' && url.pathname === '/api/warband/state') {
      const requested = url.searchParams.get('campaign') ?? undefined;
      const campaigns = listCampaigns();
      const chosen = requested ?? campaigns[0];
      if (!chosen) return sendJson(res, 200, { activeBattle: null, meta: null });
      const file = path.join(WARBAND_DIR, chosen, 'state.json');
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: `campaign "${chosen}" not found` });
      return sendJson(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }

    if (req.method === 'POST' && url.pathname === '/api/warband/command') {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      const { campaign, command, args } = parsed;
      if (!campaign || !command) return sendJson(res, 400, { error: 'campaign and command required' });
      const result = runCommand(String(campaign), String(command), args ?? {});
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET') return serveStatic(url.pathname, res);

    return sendJson(res, 405, { error: `method ${req.method} not allowed` });
  } catch (err) {
    const msg = err instanceof EngineError ? err.message : err instanceof Error ? err.message : String(err);
    return sendJson(res, 400, { error: msg });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Another warband-serve is probably running.\n` +
        `Open http://localhost:${PORT} (it may already be up), or start on another port:\n` +
        `  WARBAND_PORT=4600 npm run warband-serve   (PowerShell: $env:WARBAND_PORT=4600; npm run warband-serve)`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(
    JSON.stringify({ op: 'warband.serve', url: `http://localhost:${PORT}`, campaigns: listCampaigns() }, null, 2)
  );
});
