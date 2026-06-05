import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');

// Throwaway campaign for the mutating `roll` test, so the suite never dirties a
// real playable save. Created/destroyed around the run (see dm-commands-smoke.test.ts).
const ROLL_CAMPAIGN = 'test-build-smoke-roll';
const ROLL_DIR = path.join(REPO_ROOT, 'campaigns', ROLL_CAMPAIGN);

function run(args: string[]): any {
  const out = execFileSync('node', [BUNDLE, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

before(() => {
  mkdirSync(ROLL_DIR, { recursive: true });
  // Minimal fixture satisfying parseState (engine/src/types.ts).
  writeFileSync(path.join(ROLL_DIR, 'state.json'), JSON.stringify({
    meta: { campaign: ROLL_CAMPAIGN, rulesetId: '5e' },
    rng: { seed: 'build-smoke-roll', cursor: 0 },
    pcs: {}, npcs: {}, factions: {}, clocks: {},
  }, null, 2));
});
after(() => { rmSync(ROLL_DIR, { recursive: true, force: true }); });

test('bundle exists (run `npm run build` first)', () => {
  assert.ok(existsSync(BUNDLE), `missing ${BUNDLE} — run: npm run build`);
});

test('bundled CLI rolls dice and returns valid JSON', () => {
  // `roll` consumes the campaign's RNG state (mutates state.json + log.jsonl), so it
  // runs against a throwaway campaign — never a real save.
  // With multiple campaigns present, auto-resolve can't pick one — pass it explicitly.
  const r = run(['roll', '1d20', '--campaign', ROLL_CAMPAIGN]);
  assert.equal(r.op, 'roll');
  assert.ok(typeof r.total === 'number' && r.total >= 1 && r.total <= 20);
});

test('bundled CLI does an SRD lookup (no campaign needed)', () => {
  const r = run(['srd', 'condition', 'prone']);
  assert.equal(r.op, 'srd');
  assert.ok(r.result, 'expected an SRD result for "prone"');
});

test('bundled CLI lists campaigns (path resolution survives bundling)', () => {
  const r = run(['campaign', 'list']);
  assert.equal(r.op, 'campaign.list');
  assert.ok(Array.isArray(r.campaigns));
  assert.ok(r.campaigns.includes('the-hollow-road'), 'should find the-hollow-road campaign dir');
});
