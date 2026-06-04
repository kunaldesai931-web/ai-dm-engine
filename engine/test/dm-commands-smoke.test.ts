import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const C = 'dm-smoke';
const run = (args: string[]) => JSON.parse(execFileSync('node', [BUNDLE, ...args, '--campaign', C], { encoding: 'utf8' }));

before(() => {
  const dir = path.join(REPO_ROOT, 'campaigns', C);
  mkdirSync(dir, { recursive: true });
  // Fixture must satisfy parseState (engine/src/types.ts): meta.campaign, rng.{seed,cursor},
  // and each pc/npc is a Character requiring `name`.
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    meta: { campaign: C, rulesetId: '5e' },
    rng: { seed: 'dm-smoke', cursor: 0 },
    pcs: { 'pc-1': { id: 'pc-1', name: 'Tess', abilities: { dex: 14 }, hp: { current: 10, max: 10 } } },
    npcs: {}, factions: {}, clocks: {},
  }, null, 2));
});
after(() => { rmSync(path.join(REPO_ROOT, 'campaigns', C), { recursive: true, force: true }); });

test('check runs and returns an outcome', () => {
  const r = run(['check', '--actor', 'pc-1', '--ability', 'dex', '--dc', '10']);
  assert.ok('op' in r);
});
test('session start works', () => { assert.ok('op' in run(['session', 'start'])); });
test('chronicle read works', () => { assert.ok('op' in run(['chronicle', 'read'])); });
test('combat start + status works', () => {
  run(['combat', 'spawn', '--id', 'gob', '--name', 'Goblin', '--hp', '7', '--ac', '13']);
  const r = run(['combat', 'start', '--participants', 'pc-1,gob']);
  assert.ok('op' in r);
});
