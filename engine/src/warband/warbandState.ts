import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from '../core/errors.js';
import { loadJson, saveJson } from '../core/stateIO.js';
import { appendLog } from '../core/log.js';
import { parseWarbandCampaignState, type TWarbandCampaignState } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const WARBAND_DIR = path.join(REPO_ROOT, 'engine', 'state', 'warband');

export interface WarbandCampaign { name: string; dir: string; }

export function resolveWarbandCampaign(name?: string): WarbandCampaign {
  if (name) {
    const dir = path.join(WARBAND_DIR, name);
    if (!fs.existsSync(path.join(dir, 'state.json'))) {
      throw new EngineError(`no warband campaign "${name}" at ${dir}`);
    }
    return { name, dir };
  }
  const entries = fs.existsSync(WARBAND_DIR)
    ? fs.readdirSync(WARBAND_DIR).filter((d) =>
        fs.existsSync(path.join(WARBAND_DIR, d, 'state.json'))
      )
    : [];
  if (entries.length === 1) return { name: entries[0], dir: path.join(WARBAND_DIR, entries[0]) };
  if (entries.length === 0) throw new EngineError('no warband campaigns found; create one with: warband campaign create <name> --background <id>');
  throw new EngineError(`multiple warband campaigns (${entries.join(', ')}); pass --campaign <name>`);
}

export function loadWarbandState(campaign: WarbandCampaign): TWarbandCampaignState {
  return loadJson(path.join(campaign.dir, 'state.json'), parseWarbandCampaignState);
}

export function saveWarbandState(campaign: WarbandCampaign, state: TWarbandCampaignState): void {
  saveJson(path.join(campaign.dir, 'state.json'), state, parseWarbandCampaignState);
}

export function logWarbandEvent(campaign: WarbandCampaign, event: Record<string, unknown>): void {
  appendLog(path.join(campaign.dir, 'log.jsonl'), event);
}

export function createWarbandCampaign(name: string, initialState: TWarbandCampaignState): WarbandCampaign {
  const dir = path.join(WARBAND_DIR, name);
  if (fs.existsSync(path.join(dir, 'state.json'))) {
    throw new EngineError(`warband campaign "${name}" already exists`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const campaign: WarbandCampaign = { name, dir };
  saveWarbandState(campaign, initialState);
  return campaign;
}
