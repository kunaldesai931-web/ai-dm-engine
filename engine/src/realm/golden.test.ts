// Golden-replay: a scripted command sequence + fixed seed must reach the same end
// realm.json every time. Mirrors the RPG engine's auditability and proves the whole
// tick spine is deterministic end-to-end (CLI → resolve → persist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './cli';
import { parseRealm } from './schema';

const SEED = 'vael-golden-1387';
const TICKS = 6;

// A fixed script (the --in dir is injected per run). Mixes policy, queued builds,
// and repeated ticks so income, food, events, and pending all exercise.
function script(dir: string): string[][] {
  const at = (...a: string[]) => ['--in', dir, ...a];
  return [
    at('init', '--name', 'Duchy of Vael', '--seed', SEED, '--calendar', 'Spring 1387'),
    at('policy', '--tax', 'high'),
    at('build', 'granary'),
    at('build', 'market'),
    ...Array.from({ length: TICKS }, () => at('tick')),
    at('edict', 'levy', '--gold', '40'),
    at('tick'),
  ];
}

function playthrough(): { realm: any; drawnEvents: string[]; log: any[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-golden-'));
  const drawnEvents: string[] = [];
  for (const argv of script(dir)) {
    const res = run(argv);
    if (res?.op === 'realm.tick') drawnEvents.push(res.report.event.id);
  }
  const realm = JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8'));
  const log = fs.readFileSync(path.join(dir, 'realm.log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.rmSync(dir, { recursive: true, force: true });
  return { realm, drawnEvents, log };
}

test('golden replay: two runs of the same script reach an identical realm.json', () => {
  const a = playthrough();
  const b = playthrough();
  assert.deepEqual(a.realm, b.realm);
});

test('golden replay: the drawn-event sequence is identical across runs', () => {
  const a = playthrough();
  const b = playthrough();
  assert.deepEqual(a.drawnEvents, b.drawnEvents);
  assert.equal(a.drawnEvents.length, TICKS + 1); // every tick draws exactly one event
});

test('golden replay: the rng cursor equals the number of ticks (one die per tick)', () => {
  const { realm } = playthrough();
  assert.equal(realm.rng.cursor, TICKS + 1); // 7 ticks total in the script
});

test('golden replay: the end state satisfies the schema and every invariant', () => {
  const { realm } = playthrough();
  assert.doesNotThrow(() => parseRealm(realm));
  assert.equal(realm.meta.turn, TICKS + 1);
  assert.ok(realm.resources.treasury >= 0, 'treasury never negative');
  assert.ok(realm.clocks.unrest >= 0 && realm.clocks.unrest <= 10, 'unrest in range');
  assert.ok(realm.clocks.stability >= -5 && realm.clocks.stability <= 5, 'stability in range');
  assert.ok(realm.clocks.prosperity >= -5 && realm.clocks.prosperity <= 5, 'prosperity in range');
});

test('golden replay: queued builds completed and pending drained', () => {
  const { realm } = playthrough();
  assert.ok(realm.holdings.some((h: any) => h.id === 'granary'), 'granary built');
  assert.ok(realm.holdings.some((h: any) => h.id === 'market'), 'market built');
  assert.deepEqual(realm.pending, []);
});

test('golden replay: the calendar advanced by the season cycle', () => {
  const { realm } = playthrough();
  // 7 ticks from Spring 1387: Spring→Summer→Autumn→Winter→Spring(1388)→Summer→Autumn→Winter
  assert.match(realm.meta.calendar.value, /^(Spring|Summer|Autumn|Winter) \d+$/);
  assert.notEqual(realm.meta.calendar.value, 'Spring 1387');
});

test('golden replay: every mutating command appended a log entry', () => {
  const { log } = playthrough();
  // init + policy + 2 builds + 6 ticks + edict + 1 tick = 12 mutations
  assert.equal(log.length, 12);
  assert.equal(log[0].event, 'realm.init');
});
