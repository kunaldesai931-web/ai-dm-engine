// Canonical state: load, validate, atomic save, append-only event log.
// One state.json per campaign is the single source of truth.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from './dice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const CAMPAIGNS_DIR = path.join(REPO_ROOT, 'campaigns');

// Resolve which campaign to operate on: explicit name, else the sole campaign.
export function resolveCampaign(name) {
  if (name) {
    const dir = path.join(CAMPAIGNS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'state.json'))) {
      throw new EngineError(`no campaign "${name}" at ${dir}`);
    }
    return { name, dir };
  }
  const entries = fs.existsSync(CAMPAIGNS_DIR)
    ? fs.readdirSync(CAMPAIGNS_DIR).filter((d) => fs.existsSync(path.join(CAMPAIGNS_DIR, d, 'state.json')))
    : [];
  if (entries.length === 1) return { name: entries[0], dir: path.join(CAMPAIGNS_DIR, entries[0]) };
  if (entries.length === 0) throw new EngineError('no campaigns found; create one under campaigns/');
  throw new EngineError(`multiple campaigns (${entries.join(', ')}); pass --campaign <name>`);
}

export function loadState(campaign) {
  const raw = fs.readFileSync(path.join(campaign.dir, 'state.json'), 'utf8');
  const state = JSON.parse(raw);
  validateState(state);
  return state;
}

// Atomic write: temp file -> fsync -> rename. A crash can never leave a half-written save.
export function saveState(campaign, state) {
  validateState(state);
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

// Append-only event log: every roll and every state change is recorded with the
// rng cursor range it consumed, so the campaign is fully auditable.
export function logEvent(campaign, event) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(path.join(campaign.dir, 'log.jsonl'), line);
}

// Deep-merge a delta into state (arrays replace, objects merge, primitives overwrite),
// matching the delta semantics from the original engine. Validated before it lands.
export function applyDelta(state, delta) {
  function merge(target, src) {
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

// --- Validation: schema shape + rule invariants. Illegal states are rejected. ---
export function validateState(state) {
  req(state && typeof state === 'object', 'state must be an object');
  req(state.meta && state.meta.campaign, 'meta.campaign required');
  req(state.rng && typeof state.rng.seed === 'string' && Number.isInteger(state.rng.cursor),
    'rng.seed (string) and rng.cursor (int) required');
  req(state.rng.cursor >= 0, 'rng.cursor must be >= 0');
  for (const [id, c] of Object.entries({ ...(state.pcs || {}), ...(state.npcs || {}) })) {
    if (!c.hp) continue;
    const { current, max, temp } = c.hp;
    if (max != null) {
      req(Number.isFinite(max) && max >= 0, `${id}: hp.max must be >= 0`);
      if (current != null) req(current >= 0 && current <= max, `${id}: hp.current ${current} out of [0, ${max}]`);
    }
    if (temp != null) req(temp >= 0, `${id}: hp.temp must be >= 0`);
    for (const [lvl, slot] of Object.entries(c.spellSlots || {})) {
      req(slot.used >= 0 && slot.used <= slot.max, `${id}: spell slot L${lvl} used ${slot.used} out of [0, ${slot.max}]`);
    }
  }
  return state;
}

function req(cond, msg) {
  if (!cond) throw new EngineError(`invalid state: ${msg}`);
}
