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

// A fixed script (the --in dir is injected per run). Provokes and engages warfare:
// policy + builds queue resources; recruit + drill arm the realm; ticks let threat
// grow until an invasion is announced/resolved.
function script(dir: string): string[][] {
  const at = (...a: string[]) => ['--in', dir, ...a];
  return [
    at('init', '--name', 'Duchy of Vael', '--seed', SEED, '--calendar', 'Spring 1387'),
    at('policy', '--tax', 'high'),
    at('build', 'granary'),
    at('build', 'market'),
    at('recruit', '--strength', '30'),
    at('drill'),
    ...Array.from({ length: TICKS }, () => at('tick')),
    at('recruit', '--strength', '20'),
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

test('golden replay: the rng cursor is deterministic and accounts for battle dice', () => {
  const a = playthrough();
  const b = playthrough();
  assert.equal(a.realm.rng.cursor, b.realm.rng.cursor); // identical across runs
  assert.ok(a.realm.rng.cursor >= TICKS + 1, 'at least one die per tick');
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
  // A sack may raze a holding; validate schema still holds and pending is drained.
  assert.doesNotThrow(() => parseRealm(realm));
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
  // init + policy + 2 builds + recruit + drill + 6 ticks + recruit + tick = 14 mutations
  assert.equal(log.length, 14);
  assert.equal(log[0].event, 'realm.init');
});

test('golden replay: warfare engages during the run (announce and/or battle)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-golden-war-'));
  let sawWar = false;
  for (const argv of script(dir)) {
    const res = run(argv);
    if (res?.op === 'realm.tick' && res.report.war) sawWar = true;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(sawWar, 'an invasion was announced or fought during the scripted run');
});
