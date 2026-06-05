import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const C = 'cg-new-test';
const dir = path.join(REPO_ROOT, 'campaigns', C);
after(() => rmSync(dir, { recursive: true, force: true }));

test('campaign new scaffolds a valid, session-startable campaign', () => {
  const created = JSON.parse(execFileSync('node', [BUNDLE, 'campaign', 'new', '--name', C, '--seed', 'fixed'], { encoding: 'utf8' }));
  assert.equal(created.op, 'campaign.new');
  assert.ok(existsSync(path.join(dir, 'state.json')));
  // session start must run on the fresh campaign
  const ss = JSON.parse(execFileSync('node', [BUNDLE, 'session', 'start', '--campaign', C], { encoding: 'utf8' }));
  assert.equal(ss.op, 'session.start');
});

test('campaign new refuses to overwrite an existing campaign', () => {
  assert.throws(() => execFileSync('node', [BUNDLE, 'campaign', 'new', '--name', C, '--seed', 'fixed'], { encoding: 'utf8' }));
});
