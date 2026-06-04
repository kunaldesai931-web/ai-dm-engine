import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');

test('the-hollow-road declares an active rulesetId', () => {
  const out = execFileSync('node', [BUNDLE, 'state', 'get', '--path', 'meta.rulesetId', '--campaign', 'the-hollow-road'], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.value, '5e');
});
