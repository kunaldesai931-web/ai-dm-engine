// Canonical state: load, validate, atomic save, append-only event log.
// One state.json per campaign is the single source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from './errors';
import { parseState, type TState } from './types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const CAMPAIGNS_DIR = path.join(REPO_ROOT, 'campaigns');

export interface Campaign { name: string; dir: string; }

export function resolveCampaign(name?: string): Campaign {
  if (name) {
    const dir = path.join(CAMPAIGNS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'state.json'))) throw new EngineError(`no campaign "${name}" at ${dir}`);
    return { name, dir };
  }
  const entries = fs.existsSync(CAMPAIGNS_DIR)
    ? fs.readdirSync(CAMPAIGNS_DIR).filter((d) => fs.existsSync(path.join(CAMPAIGNS_DIR, d, 'state.json')))
    : [];
  if (entries.length === 1) return { name: entries[0], dir: path.join(CAMPAIGNS_DIR, entries[0]) };
  if (entries.length === 0) throw new EngineError('no campaigns found; create one under campaigns/');
  throw new EngineError(`multiple campaigns (${entries.join(', ')}); pass --campaign <name>`);
}

export function loadState(campaign: Campaign): TState {
  return parseState(JSON.parse(fs.readFileSync(path.join(campaign.dir, 'state.json'), 'utf8')));
}

// Atomic write: temp file -> fsync -> rename. A crash can never leave a half-written save.
export function saveState(campaign: Campaign, state: TState): void {
  parseState(state); // re-validate before it lands
  const target = path.join(campaign.dir, 'state.json');
  const tmp = `${target}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(state, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

// Append-only audit log: every roll and change, with the rng cursor range consumed.
export function logEvent(campaign: Campaign, event: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(path.join(campaign.dir, 'log.jsonl'), line);
}

// Deep-merge a delta into state (arrays replace, objects merge, primitives overwrite).
export function applyDelta(state: any, delta: any): any {
  function merge(target: any, src: any): any {
    if (typeof src !== 'object' || src === null) return src;
    if (Array.isArray(src)) return src.slice();
    for (const key of Object.keys(src)) {
      const val = src[key];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        merge(target[key], val);
      } else {
        target[key] = Array.isArray(val) ? val.slice() : val;
      }
    }
    return target;
  }
  return merge(state, delta);
}
