import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');

function run(args: string[]): any {
  const out = execFileSync('node', [BUNDLE, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('bundle exists (run `npm run build` first)', () => {
  assert.ok(existsSync(BUNDLE), `missing ${BUNDLE} — run: npm run build`);
});

test('bundled CLI rolls dice and returns valid JSON', () => {
  // `roll` consumes the campaign's RNG state, so it needs a campaign.
  // With multiple campaigns present, auto-resolve can't pick one — pass it explicitly.
  const r = run(['roll', '1d20', '--campaign', 'the-hollow-road']);
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
