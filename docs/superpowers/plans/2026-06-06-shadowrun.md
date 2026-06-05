# Shadowrun Ruleset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks 1–7 + 9 are subagent-driven with two-stage review. Task 8 (ruleset + dm section) is authored by the main agent + reviewer. Task 10 is an interactive play-test. Steps use checkbox (`- [ ]`).

**Goal:** Add Shadowrun as a second playable ruleset — an Anarchy-light dice-pool core plus an SR5-grounded magic module — exercising the pluggable seam, with the engine owning every hit, glitch, and point of Drain.

**Architecture:** A new `engine/src/shadowrun/` module (parallel to `warband/`) with pure functions, wired into the main `cli.ts` as `sr`-namespaced commands. The D&D `check/attack/cast` commands are untouched. Built in two phases: core resolution, then magic.

**Tech Stack:** TypeScript engine, Zod, Node test runner, esbuild bundle, the seeded `makeRoller`.

**Branch:** `git checkout main && git pull && git checkout -b feat/shadowrun` before Task 1.

**Confidence-flagged constants** (verify vs. books; isolated as named consts so a fix is one line): glitch threshold = `ceil(dice/2)` ones; Physical max = `8 + ceil(Body/2)`; Stun max = `8 + ceil(Willpower/2)`; overcast (Force > Magic) → Drain is Physical; Stun overflow → Physical 1:1.

---

## File Map

| File | Responsibility |
|---|---|
| `engine/src/shadowrun/dice.ts` | `rollPool` — the dice-pool primitive |
| `engine/src/shadowrun/actor.ts` | Shadowrun actor zod shape, `parseShadowrunActor`, `physicalMonitorMax`/`stunMonitorMax` |
| `engine/src/shadowrun/combat.ts` | `soak`, `applyDamage`, `initiative` |
| `engine/src/shadowrun/magic.ts` | `castSpell` (Phase B) |
| `engine/src/shadowrun/index.ts` | re-exports |
| `engine/src/cli.ts` | `sr pool|test|soak|damage|init|new-runner|cast` cases + `'sr'` compound key + USAGE |
| `engine/data/shadowrun/pregens/street-sam.json`, `mage.json` | pregens |
| `engine/test/sr-dice.test.ts`, `sr-actor.test.ts`, `sr-combat.test.ts`, `sr-magic.test.ts`, `sr-pregen.test.ts` | golden tests |
| `rulesets/shadowrun.md` | GM reference (original) |
| `.claude/skills/dm/SKILL.md` | + Shadowrun section |

**Testing note — deterministic without RNG luck:** tests use a **scripted fake roller** (implements the `Roller` interface, returns a fixed `die()` sequence) so pool logic is pinned exactly. Helper used across tests:
```typescript
import type { Roller } from '../src/core/rng.js';
function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}
```

---

## Phase A — Core resolution

### Task 1: Dice-pool primitive

**Files:** `engine/src/shadowrun/dice.ts`, `engine/test/sr-dice.test.ts`

- [ ] **Step 1: Write `engine/test/sr-dice.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollPool } from '../src/shadowrun/dice.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}

test('counts 5s and 6s as hits', () => {
  const r = rollPool(fakeRoller([5, 6, 4, 2, 6]), 5);
  assert.equal(r.hits, 3);
  assert.equal(r.glitch, false);
});

test('glitch when half-or-more dice are 1s', () => {
  // 5 dice, ceil(5/2)=3 ones needed
  const r = rollPool(fakeRoller([1, 1, 1, 6, 4]), 5);
  assert.equal(r.ones, 3);
  assert.equal(r.glitch, true);
  assert.equal(r.critGlitch, false); // there was a hit
});

test('critical glitch = glitch with zero hits', () => {
  const r = rollPool(fakeRoller([1, 1, 1, 2, 4]), 5);
  assert.equal(r.glitch, true);
  assert.equal(r.hits, 0);
  assert.equal(r.critGlitch, true);
});

test('threshold sets success and net hits', () => {
  const r = rollPool(fakeRoller([5, 6, 6, 2]), 4, 2);
  assert.equal(r.hits, 3);
  assert.equal(r.success, true);
  assert.equal(r.net, 1);
});

test('no threshold leaves success/net null', () => {
  const r = rollPool(fakeRoller([5, 2]), 2);
  assert.equal(r.success, null);
  assert.equal(r.net, null);
});

test('empty pool never glitches', () => {
  const r = rollPool(fakeRoller([]), 0);
  assert.equal(r.hits, 0);
  assert.equal(r.glitch, false);
});
```

- [ ] **Step 2: Run, confirm fail** (`cd engine && node --import tsx --test "test/sr-dice.test.ts"`).

- [ ] **Step 3: Implement `engine/src/shadowrun/dice.ts`**

```typescript
import { EngineError } from '../core/errors.js';
import type { Roller } from '../core/rng.js';

export interface PoolResult {
  dice: number[]; hits: number; ones: number;
  glitch: boolean; critGlitch: boolean;
  net: number | null; success: boolean | null;
}

export function rollPool(roller: Roller, dice: number, threshold?: number): PoolResult {
  if (!Number.isInteger(dice) || dice < 0) throw new EngineError(`pool dice must be a non-negative integer, got ${dice}`);
  const rolled: number[] = [];
  for (let i = 0; i < dice; i++) rolled.push(roller.die(6));
  const hits = rolled.filter((d) => d >= 5).length;
  const ones = rolled.filter((d) => d === 1).length;
  const glitch = dice > 0 && ones >= Math.ceil(dice / 2);
  const critGlitch = glitch && hits === 0;
  let net: number | null = null;
  let success: boolean | null = null;
  if (threshold !== undefined) { net = hits - threshold; success = hits >= threshold; }
  return { dice: rolled, hits, ones, glitch, critGlitch, net, success };
}
```

- [ ] **Step 4: Run — 6/6 pass.** Commit:
```bash
git add engine/src/shadowrun/dice.ts engine/test/sr-dice.test.ts
git commit -m "feat(shadowrun): dice-pool primitive — hits, glitch, critical glitch, net"
```

---

### Task 2: Actor shape + condition monitors

**Files:** `engine/src/shadowrun/actor.ts`, `engine/test/sr-actor.test.ts`

- [ ] **Step 1: Write `engine/test/sr-actor.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShadowrunActor, physicalMonitorMax, stunMonitorMax } from '../src/shadowrun/actor.js';
import { EngineError } from '../src/core/errors.js';

function validRunner(): any {
  return {
    name: 'Razor', sr: true,
    attributes: { body: 5, agility: 6, reaction: 5, strength: 4, willpower: 4, logic: 3, intuition: 4, charisma: 3, edge: 3, magic: 0 },
    skills: { firearms: 6, athletics: 4 },
    monitors: { physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } },
    edgeCurrent: 3, armor: 9,
  };
}

test('monitor maxes follow the formula', () => {
  assert.equal(physicalMonitorMax(5), 11); // 8 + ceil(5/2)=3
  assert.equal(stunMonitorMax(4), 10);     // 8 + ceil(4/2)=2
  assert.equal(physicalMonitorMax(6), 11); // 8 + 3
});

test('parseShadowrunActor accepts a valid runner', () => {
  const a = parseShadowrunActor(validRunner());
  assert.equal(a.name, 'Razor');
  assert.equal(a.attributes.agility, 6);
});

test('parseShadowrunActor rejects a non-sr object', () => {
  const bad = validRunner(); delete bad.sr;
  assert.throws(() => parseShadowrunActor(bad), EngineError);
});

test('parseShadowrunActor rejects missing attributes', () => {
  const bad = validRunner(); delete bad.attributes.body;
  assert.throws(() => parseShadowrunActor(bad), EngineError);
});

test('parseShadowrunActor accepts an awakened mage with spells', () => {
  const m = validRunner();
  m.attributes.magic = 5; m.tradition = 'hermetic';
  m.spells = [{ name: 'Manabolt', drain: 3 }];
  const a = parseShadowrunActor(m);
  assert.equal(a.tradition, 'hermetic');
  assert.equal(a.spells![0].drain, 3);
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `engine/src/shadowrun/actor.ts`**

```typescript
import { z } from 'zod';
import { EngineError } from '../core/errors.js';

const Attr = z.number().int().min(0);
const Attributes = z.object({
  body: Attr, agility: Attr, reaction: Attr, strength: Attr,
  willpower: Attr, logic: Attr, intuition: Attr, charisma: Attr,
  edge: Attr, magic: Attr,
});
const Monitor = z.object({ max: z.number().int().min(1), damage: z.number().int().min(0) });

export const ShadowrunActor = z.object({
  name: z.string(),
  sr: z.literal(true),
  attributes: Attributes,
  skills: z.record(z.string(), z.number().int().min(0)),
  monitors: z.object({ physical: Monitor, stun: Monitor }),
  edgeCurrent: z.number().int().min(0),
  armor: z.number().int().min(0),
  tradition: z.enum(['hermetic', 'shamanic']).optional(),
  spells: z.array(z.object({ name: z.string(), drain: z.number().int() })).optional(),
});
export type TShadowrunActor = z.infer<typeof ShadowrunActor>;

export function physicalMonitorMax(body: number): number { return 8 + Math.ceil(body / 2); }
export function stunMonitorMax(willpower: number): number { return 8 + Math.ceil(willpower / 2); }

export function parseShadowrunActor(obj: unknown): TShadowrunActor {
  const r = ShadowrunActor.safeParse(obj);
  if (!r.success) throw new EngineError(`invalid Shadowrun actor: ${r.error.issues.map((i) => i.message || i.code).join('; ')}`);
  return r.data;
}
```

- [ ] **Step 4: Run — pass.** Commit:
```bash
git add engine/src/shadowrun/actor.ts engine/test/sr-actor.test.ts
git commit -m "feat(shadowrun): actor shape, parse, condition-monitor maxes"
```

---

### Task 3: Soak, damage, initiative

**Files:** `engine/src/shadowrun/combat.ts`, `engine/test/sr-combat.test.ts`

- [ ] **Step 1: Write `engine/test/sr-combat.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soak, applyDamage, initiative } from '../src/shadowrun/combat.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}
function runner(over: any = {}): any {
  return {
    name: 'R', sr: true,
    attributes: { body: 5, agility: 4, reaction: 4, strength: 4, willpower: 4, logic: 3, intuition: 4, charisma: 3, edge: 3, magic: 0 },
    skills: {}, monitors: { physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } },
    edgeCurrent: 3, armor: 6, ...over,
  };
}

test('soak rolls Body + (armor - AP) and reduces damage by hits', () => {
  // body 5 + (armor 6 - ap 2) = 8 dice; script 3 hits
  const a = runner();
  const r = soak(a, fakeRoller([5, 6, 5, 2, 2, 2, 2, 2]), 8, 2);
  assert.equal(r.hits, 3);
  assert.equal(r.netDamage, 5); // 8 - 3
});

test('applyDamage fills the physical monitor and reports status', () => {
  const a = runner();
  const res = applyDamage(a.monitors, 5, 'physical', a.attributes.body);
  assert.equal(res.monitors.physical.damage, 5);
  assert.equal(res.status, 'wounded');
});

test('physical filled past max is down; past max+body is dead', () => {
  const a = runner();
  const down = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 11, 'physical', 5);
  assert.equal(down.status, 'down');
  const dead = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 17, 'physical', 5);
  assert.equal(dead.status, 'dead'); // 17 > 11 + 5
});

test('stun overflow rolls into physical 1:1', () => {
  const res = applyDamage({ physical: { max: 11, damage: 0 }, stun: { max: 10, damage: 0 } }, 13, 'stun', 5);
  assert.equal(res.monitors.stun.damage, 10);      // capped
  assert.equal(res.monitors.physical.damage, 3);   // 13 - 10 overflow
});

test('initiative = reaction + intuition + hits', () => {
  const a = runner(); // reaction 4 + intuition 4 = 8 base
  const r = initiative(a, fakeRoller([5, 6, 2, 2, 2, 2, 2, 2])); // R+I=8 dice, 2 hits
  assert.equal(r.score, 8);
  assert.equal(r.hits, 2);
  assert.equal(r.total, 10);
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `engine/src/shadowrun/combat.ts`**

```typescript
import { rollPool } from './dice.js';
import type { Roller } from '../core/rng.js';
import type { TShadowrunActor } from './actor.js';

type Monitor = { max: number; damage: number };
type Monitors = { physical: Monitor; stun: Monitor };
export type SrStatus = 'ok' | 'wounded' | 'unconscious' | 'down' | 'dead';

export function soak(actor: TShadowrunActor, roller: Roller, damage: number, ap = 0): { hits: number; netDamage: number } {
  const pool = actor.attributes.body + Math.max(0, actor.armor - ap);
  const r = rollPool(roller, pool);
  return { hits: r.hits, netDamage: Math.max(0, damage - r.hits) };
}

// Pure: returns NEW monitors + status. Stun overflow spills into physical 1:1.
export function applyDamage(monitors: Monitors, amount: number, type: 'physical' | 'stun', body: number): { monitors: Monitors; status: SrStatus } {
  const m: Monitors = {
    physical: { ...monitors.physical },
    stun: { ...monitors.stun },
  };
  if (type === 'stun') {
    const total = m.stun.damage + amount;
    if (total > m.stun.max) {
      m.stun.damage = m.stun.max;
      m.physical.damage += total - m.stun.max;
    } else {
      m.stun.damage = total;
    }
  } else {
    m.physical.damage += amount;
  }
  let status: SrStatus = 'ok';
  if (m.physical.damage > m.physical.max + body) status = 'dead';
  else if (m.physical.damage >= m.physical.max) status = 'down';
  else if (m.stun.damage >= m.stun.max) status = 'unconscious';
  else if (m.physical.damage > 0 || m.stun.damage > 0) status = 'wounded';
  return { monitors: m, status };
}

export function initiative(actor: TShadowrunActor, roller: Roller): { score: number; hits: number; total: number } {
  const score = actor.attributes.reaction + actor.attributes.intuition;
  const r = rollPool(roller, score);
  return { score, hits: r.hits, total: score + r.hits };
}
```

- [ ] **Step 4: Run — pass.** Commit:
```bash
git add engine/src/shadowrun/combat.ts engine/test/sr-combat.test.ts
git commit -m "feat(shadowrun): soak, condition-monitor damage/overflow, initiative"
```

---

### Task 4: CLI wiring (core commands)

**Files:** `engine/src/shadowrun/index.ts`, `engine/src/cli.ts`

- [ ] **Step 1: Create `engine/src/shadowrun/index.ts`**
```typescript
export * from './dice.js';
export * from './actor.js';
export * from './combat.js';
```

- [ ] **Step 2: Add the import + the `'sr'` compound key in `engine/src/cli.ts`.**
- Add near the other imports: `import * as sr from './shadowrun';`
- Find the line computing `key` (the `['state','combat',…,'character'].includes(cmd)` list) and add `'sr'` to that array, so `sr pool` etc. become switch keys.

- [ ] **Step 3: Add the core `sr` cases** in the switch (these need state; they belong in the load→op→save path, NOT an early-return). Use `makeRoller(state.rng)` for rolls, set `mutated = true` whenever the roller is used (RNG cursor advances) or state changes.

```typescript
case 'sr pool': {
  const dice = num(flags.dice);
  if (dice === undefined) throw new EngineError('sr pool --dice N [--threshold N]');
  const roller = makeRoller(state.rng);
  const r = sr.rollPool(roller, dice, num(flags.threshold));
  result = { op: 'sr.pool', ...r, rng: roller.consumed() };
  mutated = true; break;
}
case 'sr test': {
  const id = str(flags.actor); const attr = str(flags.attr); const skill = str(flags.skill);
  if (!id || !attr) throw new EngineError('sr test --actor ID --attr A [--skill S] [--threshold N]');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  const pool = (a.attributes as any)[attr] + (skill ? (a.skills[skill] ?? 0) : 0);
  const roller = makeRoller(state.rng);
  const r = sr.rollPool(roller, pool, num(flags.threshold));
  result = { op: 'sr.test', actor: id, attr, skill: skill ?? null, pool, ...r, rng: roller.consumed() };
  mutated = true; break;
}
case 'sr soak': {
  const id = str(flags.actor); const damage = num(flags.damage);
  if (!id || damage === undefined) throw new EngineError('sr soak --actor ID --damage N [--ap N]');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  const roller = makeRoller(state.rng);
  const r = sr.soak(a, roller, damage, num(flags.ap) ?? 0);
  result = { op: 'sr.soak', actor: id, ...r, rng: roller.consumed() };
  mutated = true; break;
}
case 'sr damage': {
  const id = str(flags.actor); const amount = num(flags.amount); const type = str(flags.type);
  if (!id || amount === undefined || (type !== 'physical' && type !== 'stun')) throw new EngineError('sr damage --actor ID --amount N --type physical|stun');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  const res = sr.applyDamage(a.monitors, amount, type, a.attributes.body);
  (state as any).pcs[id].monitors = res.monitors;
  result = { op: 'sr.damage', actor: id, monitors: res.monitors, status: res.status };
  mutated = true; break;
}
case 'sr init': {
  const id = str(flags.actor);
  if (!id) throw new EngineError('sr init --actor ID');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  const roller = makeRoller(state.rng);
  const r = sr.initiative(a, roller);
  result = { op: 'sr.init', actor: id, ...r, rng: roller.consumed() };
  mutated = true; break;
}
```

- [ ] **Step 4: Add USAGE lines** for `sr pool|test|soak|damage|init`.

- [ ] **Step 5: Build + bundle smoke.** `cd engine && npm run build`. Then a quick manual check against a throwaway campaign with a hand-written SR actor:
```bash
node dist/cli.mjs campaign new --name sr-smoke --seed s >/dev/null
# inject a runner via state patch:
node dist/cli.mjs state patch --campaign sr-smoke --set pcs.razor.name=Razor --set pcs.razor.sr=true \
  --set pcs.razor.attributes.body=5 --set pcs.razor.attributes.agility=4 --set pcs.razor.attributes.reaction=4 \
  --set pcs.razor.attributes.strength=4 --set pcs.razor.attributes.willpower=4 --set pcs.razor.attributes.logic=3 \
  --set pcs.razor.attributes.intuition=4 --set pcs.razor.attributes.charisma=3 --set pcs.razor.attributes.edge=3 \
  --set pcs.razor.attributes.magic=0 --set pcs.razor.armor=6 --set pcs.razor.edgeCurrent=3 \
  --set pcs.razor.monitors.physical.max=11 --set pcs.razor.monitors.physical.damage=0 \
  --set pcs.razor.monitors.stun.max=10 --set pcs.razor.monitors.stun.damage=0 >/dev/null
# NOTE: state patch --set coerces strings; if booleans/numbers don't coerce, hand-edit campaigns/sr-smoke/state.json instead.
node dist/cli.mjs sr pool --dice 8 --threshold 2 --campaign sr-smoke
node dist/cli.mjs sr test --actor razor --attr agility --skill firearms --campaign sr-smoke
node dist/cli.mjs sr damage --actor razor --amount 4 --type stun --campaign sr-smoke
rm -rf campaigns/sr-smoke
```
Confirm each prints sensible JSON (hits, monitors update). If `state patch --set` can't write the nested actor cleanly, just hand-write the JSON file for the smoke check. The real coverage is the unit tests + Task 5 pregens.

- [ ] **Step 6: Full suite** (`npm test`). Commit:
```bash
git add engine/src/shadowrun/index.ts engine/src/cli.ts
git commit -m "feat(shadowrun): CLI — sr pool|test|soak|damage|init"
```

---

### Task 5: Pregens + `sr new-runner`

**Files:** `engine/data/shadowrun/pregens/street-sam.json`, `mage.json`, `engine/src/cli.ts`, `engine/test/sr-pregen.test.ts`

- [ ] **Step 1: Author the two pregens** as valid `ShadowrunActor` JSON (monitors precomputed via the formula).

`engine/data/shadowrun/pregens/street-sam.json`:
```json
{
  "name": "Knox", "sr": true,
  "attributes": { "body": 6, "agility": 6, "reaction": 5, "strength": 5, "willpower": 4, "logic": 3, "intuition": 4, "charisma": 2, "edge": 4, "magic": 0 },
  "skills": { "firearms": 6, "athletics": 4, "close-combat": 5, "stealth": 4, "perception": 3 },
  "monitors": { "physical": { "max": 11, "damage": 0 }, "stun": { "max": 10, "damage": 0 } },
  "edgeCurrent": 4, "armor": 12
}
```
(Body 6 → physical 8+3=11; Willpower 4 → stun 8+2=10.)

`engine/data/shadowrun/pregens/mage.json`:
```json
{
  "name": "Wisp", "sr": true,
  "attributes": { "body": 3, "agility": 3, "reaction": 4, "strength": 2, "willpower": 5, "logic": 5, "intuition": 4, "charisma": 4, "edge": 3, "magic": 6 },
  "skills": { "spellcasting": 6, "perception": 3, "stealth": 3, "con": 4 },
  "monitors": { "physical": { "max": 10, "damage": 0 }, "stun": { "max": 11, "damage": 0 } },
  "edgeCurrent": 3, "armor": 7,
  "tradition": "hermetic",
  "spells": [{ "name": "Manabolt", "drain": 3 }, { "name": "Stunbolt", "drain": 3 }, { "name": "Heal", "drain": 4 }, { "name": "Invisibility", "drain": 5 }]
}
```
(Body 3 → physical 8+2=10; Willpower 5 → stun 8+3=11.)

- [ ] **Step 2: Write `engine/test/sr-pregen.test.ts`**
```typescript
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
```

- [ ] **Step 3: Add `sr new-runner`** to `cli.ts`. Define `SR_PREGENS_DIR` near `PREGENS_DIR`:
```typescript
const SR_PREGENS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun', 'pregens');
```
Case:
```typescript
case 'sr new-runner': {
  const id = str(flags.id); const from = str(flags.from);
  if (!id || !from) throw new EngineError('sr new-runner --id ID --from street-sam|mage');
  if ((state as any).pcs?.[id]) throw new EngineError(`pc "${id}" already exists`);
  const file = path.join(SR_PREGENS_DIR, `${from}.json`);
  if (!fs.existsSync(file)) throw new EngineError(`unknown SR pregen "${from}"`);
  const actor = sr.parseShadowrunActor(JSON.parse(fs.readFileSync(file, 'utf8')));
  const name = str(flags.name); if (name) (actor as any).name = name;
  (state as any).pcs = (state as any).pcs || {};
  (state as any).pcs[id] = actor;
  result = { op: 'sr.new-runner', id, actor };
  mutated = true; break;
}
```
Add USAGE. (`SR_PREGENS_DIR` resolves to `engine/data/shadowrun/pregens` under both `src/` and `dist/`.)

- [ ] **Step 4: Build + run pregen test + full suite.** Commit:
```bash
git add engine/data/shadowrun/pregens/ engine/src/cli.ts engine/test/sr-pregen.test.ts
git commit -m "feat(shadowrun): pregens (street sam, mage) + sr new-runner"
```

---

## Phase B — Magic module

### Task 6: `castSpell` (Force / hits / Drain / overcast)

**Files:** `engine/src/shadowrun/magic.ts`, `engine/src/shadowrun/index.ts`, `engine/test/sr-magic.test.ts`

- [ ] **Step 1: Write `engine/test/sr-magic.test.ts`**
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSpell } from '../src/shadowrun/magic.js';
import type { Roller } from '../src/core/rng.js';

function fakeRoller(seq: number[]): Roller {
  let i = 0;
  return { die: () => seq[i++], consumed: () => ({ from: 0, to: i }) };
}

test('cast hits scale with the casting pool; drain resisted reduces DV', () => {
  // casting pool 8 (script 3 hits), then drain resist pool 6 (script 2 hits)
  const r = castSpell(fakeRoller([5, 6, 5, 2, 2, 2, 2, 2,  6, 6, 2, 2, 2, 2]), { force: 4, magic: 6, castingPool: 8, drainValue: 3, drainResistPool: 6 });
  assert.equal(r.castHits, 3);
  assert.equal(r.drainResistHits, 2);
  assert.equal(r.drainTaken, 1);       // max(0, 3 - 2)
  assert.equal(r.drainType, 'stun');   // force 4 <= magic 6, not overcast
});

test('overcasting (force > magic) makes drain physical', () => {
  const r = castSpell(fakeRoller([5, 2, 2,  2, 2, 2, 2]), { force: 8, magic: 6, castingPool: 3, drainValue: 5, drainResistPool: 4 });
  assert.equal(r.drainType, 'physical');
  assert.equal(r.drainTaken, 5);       // 0 resist hits
});

test('drain fully resisted is zero', () => {
  const r = castSpell(fakeRoller([5, 5,  6, 6, 6, 6]), { force: 3, magic: 6, castingPool: 2, drainValue: 2, drainResistPool: 4 });
  assert.equal(r.drainTaken, 0);
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `engine/src/shadowrun/magic.ts`**
```typescript
import { rollPool } from './dice.js';
import type { Roller } from '../core/rng.js';

export interface CastInput {
  force: number; magic: number;
  castingPool: number; drainValue: number; drainResistPool: number;
}
export interface CastResult {
  castHits: number; castGlitch: boolean;
  drainResistHits: number; drainTaken: number;
  drainType: 'stun' | 'physical'; overcast: boolean;
}

export function castSpell(roller: Roller, input: CastInput): CastResult {
  const cast = rollPool(roller, input.castingPool);
  const resist = rollPool(roller, input.drainResistPool);
  const drainTaken = Math.max(0, input.drainValue - resist.hits);
  const overcast = input.force > input.magic;
  return {
    castHits: cast.hits, castGlitch: cast.glitch,
    drainResistHits: resist.hits, drainTaken,
    drainType: overcast ? 'physical' : 'stun', overcast,
  };
}
```
Add `export * from './magic.js';` to `engine/src/shadowrun/index.ts`.

- [ ] **Step 4: Run — pass.** Commit:
```bash
git add engine/src/shadowrun/magic.ts engine/src/shadowrun/index.ts engine/test/sr-magic.test.ts
git commit -m "feat(shadowrun): castSpell — Force, hits, Drain resolution, overcast"
```

---

### Task 7: `sr cast` CLI wiring

**Files:** `engine/src/cli.ts`

- [ ] **Step 1: Add the `sr cast` case.** It rolls the cast + drain, then applies Drain to the actor's monitor and saves. Casting pool defaults to `magic + skills.spellcasting`; drain-resist pool defaults to `willpower + (logic if hermetic else charisma)`.
```typescript
case 'sr cast': {
  const id = str(flags.actor); const force = num(flags.force); const dv = num(flags.dv);
  if (!id || force === undefined || dv === undefined) throw new EngineError('sr cast --actor ID --force N --dv N [--pool N] [--resist N]');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  const castingPool = num(flags.pool) ?? (a.attributes.magic + (a.skills['spellcasting'] ?? 0));
  const resistPool = num(flags.resist) ?? (a.attributes.willpower + (a.tradition === 'shamanic' ? a.attributes.charisma : a.attributes.logic));
  const roller = makeRoller(state.rng);
  const cast = sr.castSpell(roller, { force, magic: a.attributes.magic, castingPool, drainValue: dv, drainResistPool: resistPool });
  const dmg = sr.applyDamage(a.monitors, cast.drainTaken, cast.drainType, a.attributes.body);
  (state as any).pcs[id].monitors = dmg.monitors;
  result = { op: 'sr.cast', actor: id, force, ...cast, monitors: dmg.monitors, status: dmg.status, rng: roller.consumed() };
  mutated = true; break;
}
```
Add USAGE for `sr cast`.

- [ ] **Step 2: Build + smoke** (new-runner a mage, cast a spell, see Drain land):
```bash
cd engine && npm run build
node dist/cli.mjs campaign new --name sr-magic --seed m >/dev/null
node dist/cli.mjs sr new-runner --id wisp --from mage --campaign sr-magic >/dev/null
node dist/cli.mjs sr cast --actor wisp --force 5 --dv 3 --campaign sr-magic
node dist/cli.mjs sr cast --actor wisp --force 9 --dv 6 --campaign sr-magic   # overcast → physical drain
rm -rf campaigns/sr-magic
```
Confirm the first is Stun drain and the overcast one is Physical, monitors update.

- [ ] **Step 3: Full suite.** Commit:
```bash
git add engine/src/cli.ts
git commit -m "feat(shadowrun): sr cast — apply spell Drain to the caster's monitor"
```

---

## Task 8: GM layer — ruleset reference + dm section *(authored by main agent + reviewer)*

**Files:** `rulesets/shadowrun.md`, `.claude/skills/dm/SKILL.md`

- [ ] **Step 1: Author `rulesets/shadowrun.md`** — original concise reference (no copyrighted content): the dice-pool rule, hit/glitch/critical-glitch table, condition monitors + the two damage tracks, soak, initiative, the cast→Drain loop (Force, hits, Drain, overcast→Physical), and *when* to call for a pool (only when failure is interesting). State the iron rule: engine owns every hit, glitch, and Drain.
- [ ] **Step 2: Add a "Shadowrun (when meta.rulesetId === 'shadowrun')" section** to `.claude/skills/dm/SKILL.md`, parallel to the 5e adjudication: intent → `sr` command map (test → `sr test`/`sr pool`; firefight → opposed pools + `sr soak` + `sr damage`; spell → `sr cast`; initiative → `sr init`; new character → `campaign new` + `sr new-runner`). Note the dice-pool feel (hits not totals; glitches), and that Drain is real.
- [ ] **Step 3: Reviewer subagent** checks both against the spec (mechanics correct, commands match what was built, no copyrighted content, iron rule present). Fix gaps.
- [ ] **Step 4: Commit:**
```bash
git add rulesets/shadowrun.md .claude/skills/dm/SKILL.md
git commit -m "feat(shadowrun): GM ruleset reference + dm skill Shadowrun section"
```

---

## Task 9: Integration + play-test

- [ ] **Step 1:** `cd engine && npm run build && npm test` — all pass (existing + new sr-dice/actor/combat/magic/pregen tests). Report count.
- [ ] **Step 2:** `npm run typecheck` — only the known pre-existing `warband/combat.ts` TS2367 is acceptable; fix any NEW errors in the shadowrun module/cli.
- [ ] **Step 3: Live play-test (interactive, with the user):** `campaign new` a Shadowrun run, `sr new-runner` the street sam and mage, then as GM run (1) a skill test (with a glitch possible), (2) a short firefight (opposed pool → `sr soak` → `sr damage`), and (3) a `sr cast` that takes Drain — confirming the engine owns the numbers and it feels like Shadowrun.
- [ ] **Step 4:** Clean any scratch campaigns; `git push -u origin feat/shadowrun`.

---

## Self-Review

**Spec coverage:**
- ✓ Dice-pool primitive (hits/glitch/crit/net) — Task 1
- ✓ Shadowrun actor shape + condition-monitor maxes — Task 2
- ✓ Soak, damage/overflow, initiative — Task 3
- ✓ `sr` CLI commands (pool/test/soak/damage/init) wired, D&D commands untouched — Task 4
- ✓ Pregens (street sam + mage) + `sr new-runner` — Task 5
- ✓ Magic module: Force/hits/Drain/overcast — Task 6; `sr cast` applies Drain — Task 7
- ✓ `rulesets/shadowrun.md` + dm Shadowrun section (original, IP-clean) — Task 8
- ✓ Golden tests via scripted fake roller (deterministic) — every code task
- ✓ Out of scope respected: no Matrix/rigging/summoning/Limits/Essence/full chargen

**Confidence constants isolated:** glitch threshold (`ceil(dice/2)`), monitor maxes (`physicalMonitorMax`/`stunMonitorMax`), overcast→Physical (in `castSpell`), stun-overflow→physical (in `applyDamage`) — each a single named place to correct after book-checking.

**Placeholder scan:** none. The smoke-test steps note a fallback (hand-write JSON if `state patch --set` won't coerce) — that's an instruction, not a placeholder.

**Type consistency:** `rollPool(roller, dice, threshold?) → PoolResult` used by combat + magic; `TShadowrunActor`/`parseShadowrunActor` consumed by combat, cli, pregens; `applyDamage(monitors, amount, type, body)` signature identical in Task 3, 4, 7; `castSpell(roller, CastInput) → CastResult` in Task 6/7. `'sr'` added to the cli compound-key list so `sr <sub>` dispatches.
