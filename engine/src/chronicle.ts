// Chronicle: bounded narrative memory held in state.json. Claude appends a one-line
// summary per turn; every ~8 turns it compresses the buffer into a single logged
// summary. Engine owns the mutation so chronicle inherits atomic-save + audit log +
// the git-commit save-point ritual (state.json is the single source of truth).
import { EngineError } from './errors';
import type { TState } from './types';

interface Chron { buffer: { t: string; text: string }[]; log: { t: string; summary: string }[]; }

// state is a looseObject; chronicle may be absent on older saves. Normalise in place.
function ensure(state: TState): Chron {
  const s = state as any;
  if (!s.chronicle || typeof s.chronicle !== 'object') s.chronicle = {};
  if (!Array.isArray(s.chronicle.buffer)) s.chronicle.buffer = [];
  if (!Array.isArray(s.chronicle.log)) s.chronicle.log = [];
  return s.chronicle as Chron;
}

export function append(state: TState, a: { text?: string }) {
  if (!a.text) throw new EngineError('chronicle append needs --text "<one-line turn summary>"');
  const ch = ensure(state);
  const entry = { t: new Date().toISOString(), text: a.text };
  ch.buffer.push(entry);
  return { op: 'chronicle.append', buffered: ch.buffer.length, entry };
}

// Read-only: returns the buffered turns for Claude to summarise. Does NOT clear —
// clearing happens in `commit`, so a crash between the two never loses turns.
export function compress(state: TState) {
  const ch = ensure(state);
  return {
    op: 'chronicle.compress',
    pending: ch.buffer.length,
    buffer: ch.buffer.map((e) => `${e.t} | ${e.text}`),
    note: ch.buffer.length === 0
      ? 'buffer empty — nothing to compress'
      : 'summarise these lines in <=200 words (preserve PC decisions, NPC names, locations, mechanical outcomes, open threads), then call: chronicle commit --summary "<text>"',
  };
}

export function commit(state: TState, a: { summary?: string }) {
  if (!a.summary) throw new EngineError('chronicle commit needs --summary "<compressed summary>"');
  const ch = ensure(state);
  const entry = { t: new Date().toISOString(), summary: a.summary };
  ch.log.push(entry);
  const cleared = ch.buffer.length;
  ch.buffer = [];
  return { op: 'chronicle.commit', entry, clearedFromBuffer: cleared, totalEntries: ch.log.length };
}

// Read-only: the compressed history. This is what a fresh session reads instead of
// replaying raw turns — keeps per-session context bounded.
export function read(state: TState) {
  const ch = ensure(state);
  return { op: 'chronicle.read', entries: ch.log, pendingInBuffer: ch.buffer.length };
}
