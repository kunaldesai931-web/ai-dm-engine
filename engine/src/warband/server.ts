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
  moveUnit,
  resolveAttack,
  endTurn,
  getBattleOutcome,
  endBattle,
  type EnemySpawn,
} from './combat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, '..', '..', 'web');
const DATA_DIR = path.resolve(HERE, '..', '..', 'data');
const PORT = Number(process.env.WARBAND_PORT) || 4500;

function loadData<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
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
      if (!spec) throw new EngineError('enemies spec required, e.g. "b1:bandit,b2:archer"');
      const defs = loadData<Array<Record<string, any>>>('enemies.json');
      const spawns: EnemySpawn[] = spec.split(',').map((tok) => {
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
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawns, roller);
      narrative = 'Battle begins.';
      break;
    }
    case 'move': {
      state = moveUnit(state, String(args.unitId), Number(args.col), Number(args.row));
      narrative = `${args.unitId} moves to (${args.col},${args.row}).`;
      break;
    }
    case 'attack': {
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      const r = resolveAttack(state, String(args.attackerId), String(args.targetId), roller, injuries);
      state = r.state;
      narrative = r.narrative;
      extra = {
        outcome: r.outcome,
        roll: r.roll,
        damage: r.damage,
        injury: r.injuryTriggered,
        moraleEvents: r.moraleEvents,
        battleOutcome: getBattleOutcome(state),
      };
      break;
    }
    case 'end-turn': {
      state = endTurn(state);
      const nextId = state.activeBattle!.turnOrder[state.activeBattle!.currentTurnIndex];
      narrative = `Turn passes to ${nextId}.`;
      extra = { nextTurn: nextId };
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
