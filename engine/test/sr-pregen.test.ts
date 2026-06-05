import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShadowrunActor, physicalMonitorMax, stunMonitorMax } from '../src/shadowrun/actor.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun', 'pregens');

test('every SR pregen is a valid runner with formula-correct monitors', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const a = parseShadowrunActor(JSON.parse(readFileSync(path.join(DIR, f), 'utf8')));
    assert.equal(a.monitors.physical.max, physicalMonitorMax(a.attributes.body), `${f} physical max`);
    assert.equal(a.monitors.stun.max, stunMonitorMax(a.attributes.willpower), `${f} stun max`);
  }
});

test('the mage pregen is awakened with spells', () => {
  const a = parseShadowrunActor(JSON.parse(readFileSync(path.join(DIR, 'mage.json'), 'utf8')));
  assert.ok(a.attributes.magic > 0);
  assert.ok((a.spells?.length ?? 0) > 0);
});
