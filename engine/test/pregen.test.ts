import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Character } from '../src/types.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pregens');

test('every pregen is a schema-valid Character with HP and a class', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const obj = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
    const parsed = Character.parse(obj); // throws if invalid
    assert.ok(parsed.hp && (parsed.hp as any).max > 0, `${f} needs hp.max`);
    assert.ok(parsed.class, `${f} needs class`);
  }
});
