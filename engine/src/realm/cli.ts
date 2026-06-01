#!/usr/bin/env node
// Realm sim CLI. Each subcommand: resolve realm dir -> load realm.json -> run op ->
// (if it changed anything) atomic-save + log -> return JSON. Same honesty contract
// as the RPG engine: the code owns every number; the narrator only reads the JSON.
//
// Standalone: `realm init --in <dir> ...` then operate on <dir>/realm.json.
// `run(argv)` is exported so tests (and the RPG engine) can drive it in-process.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../core/errors';
import { loadJson, saveJson, applyDelta } from '../core/stateIO';
import { appendLog } from '../core/log';
import { parseRealm, TAX_LEVELS, type TRealm } from './schema';
import { applyEventEffects } from './events';
import { tick, clampClocks } from './resolve';
import { buildDigest } from './bridge';

interface Parsed { positional: string[]; flags: Record<string, string | true>; sets: string[]; }
function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const sets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      let key: string, val: string | true;
      if (eq >= 0) { key = body.slice(0, eq); val = body.slice(eq + 1); }
      else {
        key = body;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { val = next; i++; } else val = true;
      }
      if (key === 'set') sets.push(val as string); else flags[key] = val;
    } else positional.push(a);
  }
  return { positional, flags, sets };
}

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: string | true | undefined): number | undefined => (typeof v === 'string' ? Number(v) : undefined);

function setNested(target: any, dottedPath: string, value: unknown) {
  const keys = dottedPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
const getNested = (obj: any, p: string) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function realmPaths(flags: Record<string, string | true>) {
  const dir = path.resolve(str(flags.in) ?? process.cwd());
  return { dir, file: path.join(dir, 'realm.json'), log: path.join(dir, 'realm.log.jsonl') };
}

function loadRealm(file: string): TRealm {
  if (!fs.existsSync(file)) throw new EngineError(`no realm at ${file}; run "realm init --in <dir>" first`);
  return loadJson(file, parseRealm);
}

function defaultRealm(name: string, seed: string, opts: { ruler?: string; calendar?: string }): unknown {
  return {
    meta: { realm: name, ruler: opts.ruler ?? '', turn: 0,
            calendar: { unit: 'season', value: opts.calendar ?? 'Spring 1' } },
    rng: { seed, cursor: 0 },
    resources: { treasury: 100, food: { stock: 50, production: 20, consumption: 18 }, manpower: 0 },
    clocks: { stability: 0, unrest: 0, prosperity: 0 },
    policies: { tax: 'normal' },
    holdings: [],
    army: { strength: 0 },
    pending: [],
    event: null,
  };
}

// Run one realm command. Returns the result object; performs file I/O against the
// resolved realm dir. Throws EngineError on bad input.
export function run(argv: string[]): any {
  const { positional, flags, sets } = parseArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];
  if (!cmd || cmd === 'help') return { usage: USAGE };

  const { dir, file, log } = realmPaths(flags);

  // init is special: it creates the file.
  if (cmd === 'init') {
    const name = str(flags.name);
    const seed = str(flags.seed);
    if (!name) throw new EngineError('realm init requires --name');
    if (!seed) throw new EngineError('realm init requires --seed');
    if (fs.existsSync(file)) throw new EngineError(`realm already exists at ${file}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const realm = parseRealm(defaultRealm(name, seed, { ruler: str(flags.ruler), calendar: str(flags.calendar) }));
    saveJson(file, realm, parseRealm);
    appendLog(log, { event: 'realm.init', realm: name, seed });
    return { op: 'realm.init', realm: name, seed, file };
  }

  const key = sub && ['bridge', 'log'].includes(cmd) ? `${cmd} ${sub}` : cmd;
  const realm: any = loadRealm(file);
  let result: any;
  let mutated = false;

  switch (key) {
    case 'status':
      result = { op: 'realm.status', path: str(flags.path) ?? null,
                 value: flags.path ? getNested(realm, str(flags.path)!) : realm };
      break;

    case 'policy': {
      const tax = str(flags.tax);
      if (!tax) throw new EngineError('realm policy requires --tax low|normal|high');
      if (!(TAX_LEVELS as readonly string[]).includes(tax)) throw new EngineError(`unknown tax "${tax}"; use ${TAX_LEVELS.join('|')}`);
      realm.policies.tax = tax;
      result = { op: 'realm.policy', tax };
      mutated = true; break;
    }

    case 'build': {
      const structure = positional[1] ?? str(flags.structure);
      if (!structure) throw new EngineError('realm build requires a structure, e.g. "realm build granary"');
      realm.pending.push({ kind: 'build', id: structure });
      result = { op: 'realm.build', queued: structure, pending: realm.pending };
      mutated = true; break;
    }

    case 'edict': {
      const type = positional[1] ?? str(flags.type);
      if (!type) throw new EngineError('realm edict requires a type, e.g. "realm edict levy --gold 30"');
      const effects: any = {};
      const gold = num(flags.gold);
      const unrest = num(flags.unrest);
      if (gold != null) effects.resources = { treasury: gold };
      if (unrest != null) effects.clocks = { ...(effects.clocks ?? {}), unrest };
      realm.pending.push({ kind: 'edict', type, effects });
      result = { op: 'realm.edict', queued: type, effects, pending: realm.pending };
      mutated = true; break;
    }

    case 'tick': {
      const { realm: next, report } = tick(realm);
      saveJson(file, next, parseRealm);
      appendLog(log, { event: 'realm.tick', report });
      return { op: 'realm.tick', report, digest: buildDigest(next) };
    }

    case 'choose': {
      const optionId = str(flags.option);
      if (!realm.event) throw new EngineError('no active event to choose');
      if (!optionId) throw new EngineError('realm choose requires --option <id>');
      const opt = (realm.event.options ?? []).find((o: any) => o.id === optionId);
      if (!opt) {
        const choices = (realm.event.options ?? []).map((o: any) => o.id).join(', ');
        throw new EngineError(`no option "${optionId}" for event "${realm.event.id}"; choices: ${choices}`);
      }
      const applied = applyEventEffects(realm, opt.effects);
      realm.clocks = applied.clocks;
      realm.resources = applied.resources;
      const { clocks, clamps } = clampClocks(realm.clocks);
      realm.clocks = clocks;
      realm.event = null;
      result = { op: 'realm.choose', event: opt.id, option: optionId, clamps };
      mutated = true; break;
    }

    case 'patch': {
      let delta: any = {};
      if (flags.file) delta = JSON.parse(fs.readFileSync(path.resolve(str(flags.file)!), 'utf8'));
      for (const s of sets) {
        const eq = s.indexOf('='); if (eq < 0) throw new EngineError(`--set needs key=value, got "${s}"`);
        let v: any = s.slice(eq + 1); try { v = JSON.parse(v); } catch { /* keep string */ }
        setNested(delta, s.slice(0, eq), v);
      }
      applyDelta(realm, delta);
      parseRealm(realm); // reject illegal merged state before it lands
      result = { op: 'realm.patch', delta };
      mutated = true; break;
    }

    case 'bridge digest': {
      // v1 thin bridge: sinceLastDigest is reserved (the digest shape is fixed for v2).
      result = { op: 'realm.bridge.digest', digest: buildDigest(realm) };
      break;
    }

    case 'log read': {
      const lines = fs.existsSync(log)
        ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      result = { op: 'realm.log.read', entries: lines };
      break;
    }

    default:
      throw new EngineError(`unknown command "${argv.join(' ')}"\n${USAGE}`);
  }

  if (mutated) {
    saveJson(file, realm, parseRealm);
    appendLog(log, { event: result.op, detail: result });
  }
  return result;
}

const USAGE = `realm <command> [--in <dir>] [flags]
  init   --name "Duchy of Vael" --seed <seed> [--ruler "..."] [--calendar "Spring 1387"] [--in <dir>]
  status [--path resources.treasury]
  policy --tax low|normal|high
  build  <structure>                       # queue a build into pending[]
  edict  <type> [--gold N] [--unrest N]     # queue a discrete action
  tick                                      # RESOLVE the turn (the engine moment)
  choose --option <id>                      # answer an active event
  patch  [--file patch.json] [--set a.b=val ...]
  bridge digest                             # narration-ready summary for the RPG GM
  log read`;

function out(obj: unknown) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

// CLI entrypoint. Skipped when imported (e.g. by the golden-replay test).
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try { out(run(process.argv.slice(2))); }
  catch (err: any) {
    const msg = err instanceof EngineError ? err.message : String(err?.stack || err);
    process.stderr.write(JSON.stringify({ error: msg }, null, 2) + '\n');
    process.exit(1);
  }
}
