// Canonical state: load, validate, atomic save, append-only event log.
// One state.json per campaign is the single source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from './core/errors';
import { loadJson, saveJson, applyDelta as applyDeltaGeneric } from './core/stateIO';
import { appendLog } from './core/log';
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

// RPG state persistence, expressed in terms of the generic core/ primitives so
// both engines share one atomic-write + audit-log implementation.
export function loadState(campaign: Campaign): TState {
  return loadJson(path.join(campaign.dir, 'state.json'), parseState);
}

export function saveState(campaign: Campaign, state: TState): void {
  saveJson(path.join(campaign.dir, 'state.json'), state, parseState);
}

export function logEvent(campaign: Campaign, event: Record<string, unknown>): void {
  appendLog(path.join(campaign.dir, 'log.jsonl'), event);
}

// Re-export the generic delta merge so existing importers (cli.ts) are unchanged.
export const applyDelta = applyDeltaGeneric;
