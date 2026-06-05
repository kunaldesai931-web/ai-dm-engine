# Shadowrun Guided Character Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks 1–6 + 8 are subagent-driven with two-stage review. Task 7 (dm flow) is authored by the main agent + reviewer. Step 8 includes an interactive play-test. Steps use checkbox (`- [ ]`).

**Goal:** Let the GM build a Shadowrun runner with the player via simplified point-buy, with three mechanically-real archetypes (samurai/cyberware, magician/engine-owned-Drain, adept/powers); the engine assembles + validates a `ShadowrunActor`.

**Architecture:** Original data files under `engine/data/shadowrun/`; a **pure** `assembleRunner(input, data)` in `engine/src/shadowrun/chargen.ts` (data passed in, not loaded — avoids the bundle vs source `import.meta.url` path mismatch); small extensions to `actor.ts` (schema) and `combat.ts` (`initiative` reads `initiativeDice`); `sr metatypes` / `sr create-runner` CLI + a `sr cast --spell` retrofit so Drain is data-owned.

**Tech Stack:** TypeScript engine, Zod, Node test runner, esbuild bundle.

**Branch:** `git checkout main && git pull && git checkout -b feat/sr-chargen` before Task 1.

---

## File Map

| File | Responsibility |
|---|---|
| `engine/data/shadowrun/metatypes.json` | 5 metatypes: mods, bought-ranges, edgeBase, armorInnate |
| `engine/data/shadowrun/spells.json` | spell name → flat Drain + category (engine-owned Drain) |
| `engine/data/shadowrun/powers.json` | adept powers: name, cost, modifiers |
| `engine/data/shadowrun/augmentations.json` | cyberware: name, modifiers |
| `engine/src/shadowrun/chargen.ts` | NEW — `assembleRunner(input, data)`, helpers, `BUDGETS` |
| `engine/src/shadowrun/actor.ts` | EXTEND — `magicType`, `powers?`, `augmentations?`, `initiativeDice?` |
| `engine/src/shadowrun/combat.ts` | EXTEND — `initiative()` adds `initiativeDice` |
| `engine/src/cli.ts` | `sr metatypes`, `sr create-runner`, `sr cast --spell` |
| `engine/test/sr-chargen.test.ts`, `sr-chargen-magic.test.ts` | golden tests |
| `.claude/skills/dm/SKILL.md` | "Build a Runner" flow |

---

## Task 1: Data files

**Files:** the four JSON under `engine/data/shadowrun/`.

- [ ] **Step 1: `metatypes.json`** (`ranges` overrides default [1,6] for the *bought* value of listed attributes):
```json
[
  { "id": "human", "name": "Human", "mods": {}, "ranges": {}, "edgeBase": 3, "armorInnate": 0 },
  { "id": "elf", "name": "Elf", "mods": { "agility": 1, "charisma": 2 }, "ranges": {}, "edgeBase": 2, "armorInnate": 0 },
  { "id": "dwarf", "name": "Dwarf", "mods": { "body": 1, "strength": 2, "willpower": 1 }, "ranges": { "reaction": [1, 5] }, "edgeBase": 2, "armorInnate": 0 },
  { "id": "ork", "name": "Ork", "mods": { "body": 3, "strength": 2 }, "ranges": { "logic": [1, 5], "charisma": [1, 5] }, "edgeBase": 2, "armorInnate": 0 },
  { "id": "troll", "name": "Troll", "mods": { "body": 4, "strength": 3 }, "ranges": { "agility": [1, 5], "logic": [1, 5], "charisma": [1, 4] }, "edgeBase": 1, "armorInnate": 1 }
]
```

- [ ] **Step 2: `spells.json`** (our own flat Drain Values):
```json
[
  { "name": "Manabolt", "drain": 3, "category": "mana", "combat": true },
  { "name": "Stunbolt", "drain": 3, "category": "mana", "combat": true },
  { "name": "Powerbolt", "drain": 3, "category": "physical", "combat": true },
  { "name": "Fireball", "drain": 5, "category": "physical", "combat": true },
  { "name": "Heal", "drain": 4, "category": "mana" },
  { "name": "Armor", "drain": 4, "category": "physical" },
  { "name": "Increase Reflexes", "drain": 5, "category": "physical" },
  { "name": "Invisibility", "drain": 5, "category": "mana" }
]
```

- [ ] **Step 3: `powers.json`** (cost = power points; modifiers applied at build):
```json
[
  { "name": "improved-reflexes-1", "cost": 1.5, "modifiers": { "reaction": 1, "initiativeDice": 1 } },
  { "name": "improved-reflexes-2", "cost": 2.5, "modifiers": { "reaction": 2, "initiativeDice": 2 } },
  { "name": "critical-strike", "cost": 0.5, "modifiers": { "unarmedDamage": 1 } },
  { "name": "killing-hands", "cost": 0.5, "modifiers": {} },
  { "name": "mystic-armor-1", "cost": 0.5, "modifiers": { "armor": 1 } },
  { "name": "improved-ability-firearms", "cost": 1, "modifiers": {} },
  { "name": "enhanced-perception", "cost": 0.5, "modifiers": {} }
]
```

- [ ] **Step 4: `augmentations.json`**:
```json
[
  { "name": "wired-reflexes-1", "modifiers": { "reaction": 1, "initiativeDice": 1 } },
  { "name": "wired-reflexes-2", "modifiers": { "reaction": 2, "initiativeDice": 2 } },
  { "name": "muscle-replacement-2", "modifiers": { "agility": 2, "strength": 2 } },
  { "name": "bone-lacing", "modifiers": { "body": 1, "armor": 1 } },
  { "name": "dermal-plating-2", "modifiers": { "armor": 2, "body": 1 } },
  { "name": "cybereyes", "modifiers": {} }
]
```

- [ ] **Step 5: Validate JSON parses** and commit:
```bash
cd engine && for f in metatypes spells powers augmentations; do node -e "JSON.parse(require('fs').readFileSync('data/shadowrun/$f.json','utf8'));console.log('$f ok')"; done
git add engine/data/shadowrun/*.json
git commit -m "feat(sr-chargen): original metatype/spell/power/augmentation data"
```

---

## Task 2: Actor schema additions

**Files:** `engine/src/shadowrun/actor.ts`, `engine/test/sr-actor.test.ts` (append)

- [ ] **Step 1: Append a test** to `engine/test/sr-actor.test.ts`:
```typescript
test('parseShadowrunActor accepts the new chargen fields', () => {
  const a = validRunner();
  a.magicType = 'adept'; a.attributes.magic = 5;
  a.powers = ['improved-reflexes-1']; a.augmentations = []; a.initiativeDice = 1;
  const parsed = parseShadowrunActor(a);
  assert.equal(parsed.magicType, 'adept');
  assert.equal(parsed.initiativeDice, 1);
  assert.deepEqual(parsed.powers, ['improved-reflexes-1']);
});

test('parseShadowrunActor still accepts an actor without the new fields', () => {
  const a = parseShadowrunActor(validRunner());   // no magicType/powers/etc
  assert.equal(a.magicType, undefined);
});
```

- [ ] **Step 2: Run, confirm the first fails** (unknown keys are stripped/allowed? zod `.object` strips unknown keys by default, so `magicType` would be dropped → `parsed.magicType` undefined → assertion fails).

- [ ] **Step 3: Add the optional fields** to `ShadowrunActor` in `actor.ts`:
```typescript
  magicType: z.enum(['mundane', 'magician', 'adept']).optional(),
  powers: z.array(z.string()).optional(),
  augmentations: z.array(z.string()).optional(),
  initiativeDice: z.number().int().min(0).optional(),
```
(Insert alongside the existing `tradition`/`spells` lines.)

- [ ] **Step 4: Run — both pass.** Build + full suite. Commit:
```bash
git add engine/src/shadowrun/actor.ts engine/test/sr-actor.test.ts
git commit -m "feat(sr-chargen): actor schema — magicType, powers, augmentations, initiativeDice"
```

---

## Task 3: `assembleRunner` core (metatype, attributes, skills, edge, augmentations → samurai)

**Files:** `engine/src/shadowrun/chargen.ts`, `engine/test/sr-chargen.test.ts`

- [ ] **Step 1: Write `engine/test/sr-chargen.test.ts`** (loads the REAL data files and passes them in):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRunner, BUDGETS } from '../src/shadowrun/chargen.js';
import { parseShadowrunActor } from '../src/shadowrun/actor.js';
import { EngineError } from '../src/core/errors.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun');
const load = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const data = () => ({ metatypes: load('metatypes.json'), spells: load('spells.json'), powers: load('powers.json'), augmentations: load('augmentations.json') });

function samuraiInput(over: any = {}): any {
  return {
    name: 'Knox', metatype: 'ork',
    attributes: { body: 5, agility: 6, reaction: 4, strength: 4, willpower: 4, logic: 3, intuition: 4, charisma: 2 },
    skills: { firearms: 6, 'close-combat': 4, stealth: 3 },
    magicType: 'mundane', armor: 9,
    augmentations: ['wired-reflexes-1', 'muscle-replacement-2'],
    ...over,
  };
}

test('metatype modifiers + augmentations produce final attributes', () => {
  const a = assembleRunner(samuraiInput(), data());
  // ork mods: body +3, strength +2; aug muscle-replacement-2: agility +2, strength +2; wired-1: reaction +1
  assert.equal(a.attributes.body, 8);       // 5 + 3
  assert.equal(a.attributes.strength, 8);   // 4 + 2 (ork) + 2 (muscle)
  assert.equal(a.attributes.agility, 8);    // 6 + 2 (muscle)
  assert.equal(a.attributes.reaction, 5);   // 4 + 1 (wired)
  assert.equal(a.initiativeDice, 1);        // wired-reflexes-1
  assert.equal(a.attributes.magic, 0);      // mundane
});

test('condition monitors computed from FINAL body/willpower', () => {
  const a = assembleRunner(samuraiInput(), data());
  assert.equal(a.monitors.physical.max, 8 + Math.ceil(8 / 2)); // body 8 -> 12
  assert.equal(a.monitors.stun.max, 8 + Math.ceil(4 / 2));     // willpower 4 -> 10
});

test('armor = chosen + innate + augmentation mods', () => {
  // troll (armorInnate 1) + bone-lacing (+1)
  const a = assembleRunner(samuraiInput({ metatype: 'troll', armor: 6, augmentations: ['bone-lacing'] }), data());
  assert.equal(a.armor, 6 + 1 + 1);
});

test('the assembled runner is a valid ShadowrunActor', () => {
  const a = assembleRunner(samuraiInput(), data());
  parseShadowrunActor(a); // throws if invalid
});

test('rejects spending more than the attribute budget', () => {
  const bad = samuraiInput({ attributes: { body: 6, agility: 6, reaction: 6, strength: 6, willpower: 6, logic: 6, intuition: 6, charisma: 6 } });
  assert.throws(() => assembleRunner(bad, data()), EngineError); // sum(6-1)*8 = 40 > 20
});

test('rejects a bought attribute outside the metatype range', () => {
  // ork charisma bought max is 5
  assert.throws(() => assembleRunner(samuraiInput({ attributes: { ...samuraiInput().attributes, charisma: 6 } }), data()), EngineError);
});

test('rejects spending more than the skill budget', () => {
  assert.throws(() => assembleRunner(samuraiInput({ skills: { firearms: 6, a: 6, b: 6, c: 6, d: 6 } }), data()), EngineError);
});

test('rejects an unknown augmentation / metatype', () => {
  assert.throws(() => assembleRunner(samuraiInput({ augmentations: ['nope'] }), data()), EngineError);
  assert.throws(() => assembleRunner(samuraiInput({ metatype: 'goblin' }), data()), EngineError);
});

test('mundane with magic/spells/powers is rejected', () => {
  assert.throws(() => assembleRunner(samuraiInput({ magic: 3 }), data()), EngineError);
  assert.throws(() => assembleRunner(samuraiInput({ spells: ['Manabolt'] }), data()), EngineError);
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement `engine/src/shadowrun/chargen.ts`** (core; magician/adept branches added in Task 4 — for now `magician`/`adept` magicType throws "not yet"):
```typescript
import { EngineError } from '../core/errors.js';
import { physicalMonitorMax, stunMonitorMax, type TShadowrunActor } from './actor.js';

export const BUDGETS = { ATTRIBUTE_POINTS: 20, SKILL_POINTS: 24, MAX_SKILL: 6, EDGE_ALLOWANCE: 2, MAGIC_MAX: 6, ARMOR_MAX: 12 };

const ATTR_KEYS = ['body', 'agility', 'reaction', 'strength', 'willpower', 'logic', 'intuition', 'charisma'] as const;
type AttrKey = (typeof ATTR_KEYS)[number];

export interface Metatype { id: string; name: string; mods: Record<string, number>; ranges: Record<string, [number, number]>; edgeBase: number; armorInnate: number; }
export interface SpellDef { name: string; drain: number; category: string; combat?: boolean; }
export interface PowerDef { name: string; cost: number; modifiers: Record<string, number>; }
export interface AugDef { name: string; modifiers: Record<string, number>; }
export interface SrChargenData { metatypes: Metatype[]; spells: SpellDef[]; powers: PowerDef[]; augmentations: AugDef[]; }

export interface RunnerInput {
  name: string; metatype: string;
  attributes: Record<AttrKey, number>;     // BOUGHT 1..6 (range per metatype)
  skills: Record<string, number>;
  edge?: number; armor?: number;
  magicType?: 'mundane' | 'magician' | 'adept';
  magic?: number; tradition?: 'hermetic' | 'shamanic';
  spells?: string[]; powers?: string[]; augmentations?: string[];
}

function applyMods(acc: { attrs: Record<string, number>; armor: number; initiativeDice: number }, mods: Record<string, number>) {
  for (const [k, v] of Object.entries(mods)) {
    if ((ATTR_KEYS as readonly string[]).includes(k)) acc.attrs[k] += v;
    else if (k === 'armor') acc.armor += v;
    else if (k === 'initiativeDice') acc.initiativeDice += v;
    // unknown keys (e.g. unarmedDamage) are narrated, not applied
  }
}

export function assembleRunner(input: RunnerInput, data: SrChargenData): TShadowrunActor {
  const meta = data.metatypes.find((m) => m.id === input.metatype);
  if (!meta) throw new EngineError(`unknown metatype "${input.metatype}"`);

  // attributes: validate bought ranges + budget
  let spent = 0;
  for (const k of ATTR_KEYS) {
    const v = input.attributes[k];
    const [lo, hi] = meta.ranges[k] ?? [1, 6];
    if (v < lo || v > hi) throw new EngineError(`${meta.name} ${k} must be ${lo}–${hi}, got ${v}`);
    spent += v - 1;
  }
  if (spent > BUDGETS.ATTRIBUTE_POINTS) throw new EngineError(`attribute points over budget: ${spent} > ${BUDGETS.ATTRIBUTE_POINTS}`);

  // skills
  let skillSpent = 0;
  for (const [name, r] of Object.entries(input.skills)) {
    if (r > BUDGETS.MAX_SKILL) throw new EngineError(`skill "${name}" rating ${r} exceeds ${BUDGETS.MAX_SKILL}`);
    skillSpent += r;
  }
  if (skillSpent > BUDGETS.SKILL_POINTS) throw new EngineError(`skill points over budget: ${skillSpent} > ${BUDGETS.SKILL_POINTS}`);

  const magicType = input.magicType ?? 'mundane';

  // collect modifier sources (augmentations now; powers in Task 4)
  const modSources: Array<Record<string, number>> = [];
  for (const augName of input.augmentations ?? []) {
    const aug = data.augmentations.find((x) => x.name === augName);
    if (!aug) throw new EngineError(`unknown augmentation "${augName}"`);
    modSources.push(aug.modifiers);
  }

  // magic validation (core handles mundane; Task 4 fills magician/adept)
  let magic = 0;
  let spellEntries: Array<{ name: string; drain: number }> | undefined;
  let powerNames: string[] | undefined;
  if (magicType === 'mundane') {
    if (input.magic || input.spells?.length || input.powers?.length || input.tradition) {
      throw new EngineError('mundane runners cannot have magic, spells, powers, or a tradition');
    }
  } else {
    throw new EngineError(`magicType "${magicType}" not implemented yet`); // Task 4
  }

  // edge
  const edge = input.edge ?? meta.edgeBase;
  if (edge < 1 || edge > meta.edgeBase + BUDGETS.EDGE_ALLOWANCE) throw new EngineError(`edge must be ${1}–${meta.edgeBase + BUDGETS.EDGE_ALLOWANCE}`);

  // armor
  if ((input.armor ?? 0) > BUDGETS.ARMOR_MAX) throw new EngineError(`armor exceeds ${BUDGETS.ARMOR_MAX}`);

  // build final attributes = bought + metatype mods + modifier sources
  const acc = {
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, input.attributes[k]])) as Record<string, number>,
    armor: (input.armor ?? 0) + meta.armorInnate,
    initiativeDice: 0,
  };
  applyMods(acc, meta.mods);
  for (const mods of modSources) applyMods(acc, mods);

  const finalAttrs: any = { ...acc.attrs, edge, magic };
  const runner: TShadowrunActor = {
    name: input.name, sr: true,
    attributes: finalAttrs,
    skills: input.skills,
    monitors: {
      physical: { max: physicalMonitorMax(finalAttrs.body), damage: 0 },
      stun: { max: stunMonitorMax(finalAttrs.willpower), damage: 0 },
    },
    edgeCurrent: edge, armor: acc.armor,
    magicType,
    ...(acc.initiativeDice > 0 ? { initiativeDice: acc.initiativeDice } : {}),
    ...(input.augmentations?.length ? { augmentations: input.augmentations } : {}),
    ...(spellEntries ? { spells: spellEntries, tradition: input.tradition } : {}),
    ...(powerNames ? { powers: powerNames } : {}),
  } as TShadowrunActor;
  return runner;
}
```

- [ ] **Step 4: Run the core tests — all pass.** (The mundane/samurai tests pass; magician/adept tests come in Task 4.) Build + full suite. Commit:
```bash
git add engine/src/shadowrun/chargen.ts engine/test/sr-chargen.test.ts
git commit -m "feat(sr-chargen): assembleRunner core — metatype, budgets, augmentations (samurai)"
```

---

## Task 4: Magician + adept branches

**Files:** `engine/src/shadowrun/chargen.ts`, `engine/test/sr-chargen-magic.test.ts`

- [ ] **Step 1: Write `engine/test/sr-chargen-magic.test.ts`** (reuse the data loader pattern):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRunner } from '../src/shadowrun/chargen.js';
import { EngineError } from '../src/core/errors.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun');
const load = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const data = () => ({ metatypes: load('metatypes.json'), spells: load('spells.json'), powers: load('powers.json'), augmentations: load('augmentations.json') });

function base(over: any = {}): any {
  return {
    name: 'Wisp', metatype: 'human',
    attributes: { body: 3, agility: 3, reaction: 4, strength: 2, willpower: 5, logic: 5, intuition: 4, charisma: 3 },
    skills: { spellcasting: 6, perception: 3 }, ...over,
  };
}

test('magician spells get engine-owned Drain from data (player cannot set it)', () => {
  const a = assembleRunner(base({ magicType: 'magician', magic: 6, tradition: 'hermetic', spells: ['Manabolt', 'Stunbolt'] }), data());
  assert.equal(a.attributes.magic, 6);
  assert.equal(a.spells!.find((s) => s.name === 'Manabolt')!.drain, 3); // from spells.json, not input
  assert.equal(a.tradition, 'hermetic');
});

test('magician spell count cannot exceed Magic', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 1, tradition: 'hermetic', spells: ['Manabolt', 'Stunbolt'] }), data()), EngineError);
});

test('magician with an unknown spell is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 4, tradition: 'hermetic', spells: ['DeathRay'] }), data()), EngineError);
});

test('magician without a tradition is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'magician', magic: 4, spells: ['Manabolt'] }), data()), EngineError);
});

test('adept spends power points (= Magic) on powers and gets their modifiers', () => {
  const a = assembleRunner(base({ magicType: 'adept', magic: 5, powers: ['improved-reflexes-2', 'critical-strike'] }), data());
  // improved-reflexes-2: reaction +2, initiativeDice +2
  assert.equal(a.attributes.reaction, 6);   // 4 + 2
  assert.equal(a.initiativeDice, 2);
  assert.deepEqual(a.powers, ['improved-reflexes-2', 'critical-strike']);
  assert.equal(a.spells, undefined);
});

test('adept over power-point budget is rejected', () => {
  // improved-reflexes-2 (2.5) + improved-reflexes-1 (1.5) = 4 > magic 3
  assert.throws(() => assembleRunner(base({ magicType: 'adept', magic: 3, powers: ['improved-reflexes-2', 'improved-reflexes-1'] }), data()), EngineError);
});

test('adept with spells is rejected', () => {
  assert.throws(() => assembleRunner(base({ magicType: 'adept', magic: 5, spells: ['Manabolt'] }), data()), EngineError);
});
```

- [ ] **Step 2: Run, confirm fail** (currently magician/adept throw "not implemented yet").

- [ ] **Step 3: Replace the magic block** in `chargen.ts` (the `else { throw ... }`) with the real branches:
```typescript
  } else if (magicType === 'magician') {
    magic = input.magic ?? 0;
    if (magic < 1 || magic > BUDGETS.MAGIC_MAX) throw new EngineError(`magician Magic must be 1–${BUDGETS.MAGIC_MAX}`);
    if (!input.tradition) throw new EngineError('a magician needs a tradition (hermetic|shamanic)');
    if (input.powers?.length) throw new EngineError('magicians use spells, not powers');
    const names = input.spells ?? [];
    if (names.length > magic) throw new EngineError(`a magician knows at most Magic (${magic}) spells, got ${names.length}`);
    spellEntries = names.map((n) => {
      const sp = data.spells.find((s) => s.name.toLowerCase() === n.toLowerCase());
      if (!sp) throw new EngineError(`unknown spell "${n}"`);
      return { name: sp.name, drain: sp.drain };   // engine-owned drain
    });
  } else if (magicType === 'adept') {
    magic = input.magic ?? 0;
    if (magic < 1 || magic > BUDGETS.MAGIC_MAX) throw new EngineError(`adept Magic must be 1–${BUDGETS.MAGIC_MAX}`);
    if (input.spells?.length || input.tradition) throw new EngineError('adepts use powers, not spells/tradition');
    powerNames = input.powers ?? [];
    let cost = 0;
    for (const pn of powerNames) {
      const p = data.powers.find((x) => x.name === pn);
      if (!p) throw new EngineError(`unknown power "${pn}"`);
      cost += p.cost;
      modSources.push(p.modifiers);   // applied with augmentations below
    }
    if (cost > magic) throw new EngineError(`adept power points over budget: ${cost} > ${magic}`);
  } else {
    throw new EngineError(`unknown magicType "${magicType}"`);
  }
```
(Note: `modSources` is declared before the magic block in Task 3, so pushing power modifiers there means they're applied in the same `applyMods` loop. Confirm ordering — the magic block must run BEFORE the `applyMods` loop. In the Task 3 code the augmentation loop and magic block both precede the build; keep the power-mod push inside the magic block, before the build.)

- [ ] **Step 4: Run both chargen test files — all pass.** Build + full suite. Commit:
```bash
git add engine/src/shadowrun/chargen.ts engine/test/sr-chargen-magic.test.ts
git commit -m "feat(sr-chargen): magician (engine-owned drain) + adept (power points) branches"
```

---

## Task 5: `initiative()` reads `initiativeDice`

**Files:** `engine/src/shadowrun/combat.ts`, `engine/test/sr-combat.test.ts` (append)

- [ ] **Step 1: Append a test** to `engine/test/sr-combat.test.ts`:
```typescript
test('initiativeDice adds dice to the initiative pool', () => {
  const a = runner({ initiativeDice: 2 }); // reaction 4 + intuition 4 = score 8, +2 dice rolled
  // script 10 dice: first 8 are the base pool, +2 from initiativeDice; give 3 hits total
  const r = initiative(a, fakeRoller([5, 6, 5, 2, 2, 2, 2, 2, 2, 2]));
  assert.equal(r.score, 8);
  assert.equal(r.hits, 3);
  assert.equal(r.total, 11);
});
```

- [ ] **Step 2: Run, confirm fail** (current `initiative` rolls only `score` dice → reads 8 dice, not 10; hits differ).

- [ ] **Step 3: Update `initiative()`** in `combat.ts`:
```typescript
export function initiative(actor: TShadowrunActor, roller: Roller): { score: number; hits: number; total: number } {
  const score = actor.attributes.reaction + actor.attributes.intuition;
  const pool = score + (actor.initiativeDice ?? 0);
  const r = rollPool(roller, pool);
  return { score, hits: r.hits, total: score + r.hits };
}
```

- [ ] **Step 4: Run all sr-combat tests — pass** (the existing initiative test has no `initiativeDice` → pool = score, unchanged). Build + full suite. Commit:
```bash
git add engine/src/shadowrun/combat.ts engine/test/sr-combat.test.ts
git commit -m "feat(sr-chargen): initiative pool grows with initiativeDice (wired/improved reflexes)"
```

---

## Task 6: CLI — `sr metatypes`, `sr create-runner`, `sr cast --spell`

**Files:** `engine/src/cli.ts`

- [ ] **Step 1: Add `SR_DATA_DIR` + a loader** near `SR_PREGENS_DIR` (1-level resolution works for src and bundle):
```typescript
const SR_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'shadowrun');
function loadSrData() {
  const j = (f: string) => JSON.parse(fs.readFileSync(path.join(SR_DATA_DIR, f), 'utf8'));
  return { metatypes: j('metatypes.json'), spells: j('spells.json'), powers: j('powers.json'), augmentations: j('augmentations.json') };
}
```
Import the chargen fn: add `assembleRunner` to the `import * as sr from './shadowrun'` surface (ensure `chargen.ts` is re-exported from `engine/src/shadowrun/index.ts` — add `export * from './chargen.js';`).

- [ ] **Step 2: Add `sr metatypes`** (read-only; needs no campaign mutation but does need state load like other sr cmds — keep it in the switch, no mutation):
```typescript
case 'sr metatypes': {
  result = { op: 'sr.metatypes', metatypes: loadSrData().metatypes };
  break;
}
```

- [ ] **Step 3: Add `sr create-runner`.** Parse flags into a `RunnerInput`. Attributes come from `--body…--charisma`; skills/spells/powers/augmentations are comma lists; skills are `name:rating`:
```typescript
case 'sr create-runner': {
  const id = str(flags.id); if (!id) throw new EngineError('sr create-runner --id ID required');
  if ((state as any).pcs?.[id]) throw new EngineError(`pc "${id}" already exists`);
  const attrs: any = {};
  for (const k of ['body','agility','reaction','strength','willpower','logic','intuition','charisma']) {
    const v = num(flags[k]); if (v === undefined) throw new EngineError(`--${k} N required`); attrs[k] = v;
  }
  const skills: Record<string, number> = {};
  for (const tok of (str(flags.skills) ?? '').split(',').filter(Boolean)) {
    const [name, r] = tok.split(':'); if (!name || r === undefined) throw new EngineError(`bad skill "${tok}" — use name:rating`);
    skills[name.trim()] = Number(r);
  }
  const list = (f: any) => (str(f) ? str(f)!.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const input = {
    name: str(flags.name) || id, metatype: str(flags.metatype)!,
    attributes: attrs, skills,
    edge: num(flags.edge), armor: num(flags.armor),
    magicType: (str(flags['magic-type']) as any) || 'mundane',
    magic: num(flags.magic), tradition: str(flags.tradition) as any,
    spells: list(flags.spells), powers: list(flags.powers), augmentations: list(flags.augmentations),
  };
  const runner = sr.assembleRunner(input, loadSrData());
  (state as any).pcs = (state as any).pcs || {};
  (state as any).pcs[id] = runner;
  result = { op: 'sr.create-runner', id, runner };
  mutated = true; break;
}
```
Add USAGE lines for `sr metatypes` and the full `sr create-runner`.

- [ ] **Step 4: Retrofit `sr cast`** so `--spell <name>` supplies the Drain from the actor (data-owned), `--dv` becomes an optional override:
```typescript
case 'sr cast': {
  const id = str(flags.actor); const force = num(flags.force);
  if (!id || force === undefined) throw new EngineError('sr cast --actor ID --force N (--spell NAME | --dv N) [--pool N] [--resist N]');
  const a = sr.parseShadowrunActor((state as any).pcs?.[id]);
  let dv = num(flags.dv);
  const spellName = str(flags.spell);
  if (dv === undefined && spellName) {
    const sp = (a.spells ?? []).find((s) => s.name.toLowerCase() === spellName.toLowerCase());
    if (!sp) throw new EngineError(`${a.name} doesn't know "${spellName}"`);
    dv = sp.drain;
  }
  if (dv === undefined) throw new EngineError('provide --spell <known spell> or --dv N');
  const castingPool = num(flags.pool) ?? (a.attributes.magic + (a.skills['spellcasting'] ?? 0));
  const resistPool = num(flags.resist) ?? (a.attributes.willpower + (a.tradition === 'shamanic' ? a.attributes.charisma : a.attributes.logic));
  const roller = makeRoller(state.rng);
  const cast = sr.castSpell(roller, { force, magic: a.attributes.magic, castingPool, drainValue: dv, drainResistPool: resistPool });
  const dmg = sr.applyDamage(a.monitors, cast.drainTaken, cast.drainType, a.attributes.body);
  (state as any).pcs[id].monitors = dmg.monitors;
  result = { op: 'sr.cast', actor: id, spell: spellName ?? null, force, ...cast, monitors: dmg.monitors, status: dmg.status, rng: roller.consumed() };
  mutated = true; break;
}
```
Update the `sr cast` USAGE line accordingly.

- [ ] **Step 5: Build + smoke:**
```bash
cd engine && npm run build
node dist/cli.mjs campaign new --name sr-cg --seed c >/dev/null
node dist/cli.mjs sr metatypes --campaign sr-cg | head -5
# adept
node dist/cli.mjs sr create-runner --campaign sr-cg --id adept --name Echo --metatype elf \
  --body 3 --agility 5 --reaction 4 --strength 3 --willpower 4 --logic 3 --intuition 4 --charisma 3 \
  --skills close-combat:6,athletics:4 --magic-type adept --magic 5 --powers improved-reflexes-2,critical-strike
# mage + cast by spell name
node dist/cli.mjs sr create-runner --campaign sr-cg --id mage --name Wisp --metatype human \
  --body 3 --agility 3 --reaction 4 --strength 2 --willpower 5 --logic 5 --intuition 4 --charisma 3 \
  --skills spellcasting:6,perception:3 --magic-type magician --magic 6 --tradition hermetic --spells Manabolt,Stunbolt
node dist/cli.mjs sr cast --actor mage --force 5 --spell Manabolt --campaign sr-cg
rm -rf campaigns/sr-cg
```
Confirm: metatypes list; adept's reaction/initiativeDice reflect the powers; mage's `sr cast --spell Manabolt` uses Drain 3 from data (no `--dv`). Remove the throwaway campaign.

- [ ] **Step 6: Full suite + typecheck** (only known warband TS2367). Commit:
```bash
git add engine/src/shadowrun/index.ts engine/src/cli.ts
git commit -m "feat(sr-chargen): CLI — sr metatypes, sr create-runner, sr cast --spell (data-owned drain)"
```

---

## Task 7: dm skill — "Build a Runner" *(authored by main agent + reviewer)*

**Files:** `.claude/skills/dm/SKILL.md`

- [ ] **Step 1: Add a "Build a Runner" subsection** to the Shadowrun section: metatype (`sr metatypes`) → attributes (spend 20, GM tracks) → skills (spend 24) → **archetype**: samurai (`--augmentations`), mage (`--magic-type magician --tradition … --spells <names>` — engine owns Drain), adept (`--magic-type adept --powers <names>`, power points = Magic), or mundane → Edge (base + allowance) → armor tier → name → one `sr create-runner` call → read back, into the scene. Note: spells are chosen **by name** (engine fills Drain); the three archetypes are mechanically distinct.
- [ ] **Step 2: Reviewer subagent** checks against this plan + the chargen spec (three archetypes present, engine-owned Drain emphasized, commands match cli.ts, budgets surfaced). Fix gaps.
- [ ] **Step 3: Commit:**
```bash
git add .claude/skills/dm/SKILL.md
git commit -m "feat(sr-chargen): dm skill Build a Runner flow"
```

---

## Task 8: Integration + play-test

- [ ] **Step 1:** `cd engine && npm run build && npm test` — all pass (existing + sr-chargen + sr-chargen-magic + new actor/combat tests). Report count.
- [ ] **Step 2:** `npm run typecheck` — only the known warband TS2367.
- [ ] **Step 3: Live play-test (with the user):** build one of each archetype (samurai with wired reflexes, mage casting a named spell so Drain is data-owned, adept with improved reflexes) and drop into a scene; confirm the engine-assembled numbers.
- [ ] **Step 4:** Clean scratch campaigns; `git push -u origin feat/sr-chargen`.

---

## Self-Review

**Spec coverage:**
- ✓ Simplified point-buy budgets (attributes/skills/edge/magic/armor) — Task 3 `BUDGETS` + validation
- ✓ Five metatypes with mods + bought-ranges + edgeBase + innate armor — Task 1/3
- ✓ Three mechanically-real archetypes: samurai (augmentations + initiativeDice — Task 3/5), magician (engine-owned Drain from spells.json — Task 4), adept (power points → powers — Task 4)
- ✓ Engine-owned Drain at creation AND in play (`sr cast --spell`) — Task 4 + Task 6
- ✓ Edge allowance — Task 3
- ✓ Karma-build/Sum-to-Ten *shape* (budget allocations) with our own numbers — Task 1/3
- ✓ `sr metatypes` + `sr create-runner` — Task 6; dm flow — Task 7
- ✓ Pure `assembleRunner(input, data)` (data passed in — avoids bundle path mismatch) — Task 3
- ✓ Out of scope respected: no mystic adept/technomancer/Essence/qualities/contacts/gear-shop/priority costs

**Placeholder scan:** none. The Task 3 `magician`/`adept` "not implemented yet" throw is a deliberate, tested intermediate state replaced in Task 4 (TDD seam), not a shipped placeholder.

**Type consistency:** `assembleRunner(RunnerInput, SrChargenData) → TShadowrunActor` stable across Tasks 3/4/6; `applyMods` shared by augmentations + powers; `initiativeDice` written by Task 3/4, read by Task 5; `ShadowrunActor` fields added in Task 2 are exactly those `assembleRunner` emits; `sr cast --spell` reads `spells[].drain` filled by Task 4. `'sr'` already in the cli compound-key list (from SP3).
