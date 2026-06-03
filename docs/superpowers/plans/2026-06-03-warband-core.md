# Warband Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the warband core layer — schema, roster management, progression, injuries, hireling generation, and CLI commands — playable end-to-end via `npm run warband`.

**Architecture:** New `engine/src/warband/` module alongside the existing D&D engine. Shares `core/` utilities (dice, stateIO, rng) and follows identical patterns: Zod schemas, atomic JSON state, CLI prints JSON. All content (backgrounds, injuries, perks) defined in `engine/data/` JSON files read at startup.

**Tech Stack:** TypeScript (ES modules), Zod 4, Node.js built-in test runner (`node:test`), tsx

---

## File Map

| File | Responsibility |
|---|---|
| `engine/data/backgrounds.json` | Background definitions: starting stats, traits, gear, perk pool |
| `engine/data/injuries.json` | Injury table per weapon category: name + stat penalty |
| `engine/data/perks.json` | Perk definitions: id, name, description, effect tag |
| `engine/src/warband/schema.ts` | Zod schemas: RosterMember, CombatUnit, WarbandCampaignState |
| `engine/src/warband/warbandState.ts` | State persistence: load, save, create, resolve campaign |
| `engine/src/warband/progression.ts` | XP gain, level-up, injury application, hireling down-resolution |
| `engine/src/warband/generator.ts` | Procedural hireling generation from backgrounds + rng |
| `engine/src/warband/cli.ts` | CLI entry point: campaign create, roster, progress commands |
| `engine/src/warband/schema.test.ts` | Schema validation tests |
| `engine/src/warband/progression.test.ts` | Progression + injury logic tests |
| `engine/src/warband/generator.test.ts` | Generator output shape tests |

---

## Task 1: Data files

**Files:**
- Create: `engine/data/backgrounds.json`
- Create: `engine/data/injuries.json`
- Create: `engine/data/perks.json`

- [ ] **Step 1: Create `engine/data/backgrounds.json`**

```json
[
  {
    "id": "sellsword",
    "name": "Sellsword",
    "description": "A mercenary who fights for coin. Knows steel.",
    "stats": { "melee": 4, "ranged": 1, "defense": 3, "resolve": 2, "initiative": 3, "maxHp": 14 },
    "startingTrait": "hardened",
    "startingGear": ["shortsword", "shield", "leather-armor"],
    "perkPool": ["shield-wall", "counter-attack", "iron-will", "quick-hands"]
  },
  {
    "id": "hunter",
    "name": "Hunter",
    "description": "Grew up in the wilds. Patient and precise.",
    "stats": { "melee": 2, "ranged": 5, "defense": 2, "resolve": 3, "initiative": 5, "maxHp": 11 },
    "startingTrait": "eagle-eyed",
    "startingGear": ["hunting-bow", "quiver", "padded-armor"],
    "perkPool": ["steady-aim", "quick-shot", "tracker", "nimble"]
  },
  {
    "id": "hedge-knight",
    "name": "Hedge Knight",
    "description": "Trained for war but without a lord. Pride intact.",
    "stats": { "melee": 3, "ranged": 1, "defense": 5, "resolve": 4, "initiative": 2, "maxHp": 16 },
    "startingTrait": "disciplined",
    "startingGear": ["longsword", "kite-shield", "chainmail"],
    "perkPool": ["shield-wall", "fortify", "rallying-cry", "iron-will"]
  },
  {
    "id": "deserter",
    "name": "Deserter",
    "description": "Walked away from a war. Has seen things. Resolute.",
    "stats": { "melee": 3, "ranged": 3, "defense": 3, "resolve": 5, "initiative": 3, "maxHp": 12 },
    "startingTrait": "battle-hardened",
    "startingGear": ["spear", "leather-armor", "provisions"],
    "perkPool": ["iron-will", "counter-attack", "steady-aim", "rallying-cry"]
  }
]
```

- [ ] **Step 2: Create `engine/data/injuries.json`**

```json
{
  "blunt": [
    { "id": "cracked-rib", "name": "Cracked Rib", "stat": "initiative", "amount": -1 },
    { "id": "broken-arm", "name": "Broken Arm", "stat": "melee", "amount": -1 },
    { "id": "concussion", "name": "Concussion", "stat": "resolve", "amount": -2 }
  ],
  "cutting": [
    { "id": "sword-arm-cut", "name": "Sword Arm Cut", "stat": "melee", "amount": -1 },
    { "id": "hamstrung", "name": "Hamstrung", "stat": "initiative", "amount": -1 },
    { "id": "slashed-side", "name": "Slashed Side", "stat": "defense", "amount": -1 }
  ],
  "piercing": [
    { "id": "gut-wound", "name": "Gut Wound", "stat": "resolve", "amount": -1 },
    { "id": "pierced-lung", "name": "Pierced Lung", "stat": "initiative", "amount": -1 },
    { "id": "eye-wound", "name": "Eye Wound", "stat": "ranged", "amount": -2 }
  ]
}
```

- [ ] **Step 3: Create `engine/data/perks.json`**

```json
[
  { "id": "shield-wall", "name": "Shield Wall", "description": "+2 Defense when adjacent to an ally." },
  { "id": "counter-attack", "name": "Counter-Attack", "description": "On a miss by 5+, attacker takes 1d4 damage." },
  { "id": "iron-will", "name": "Iron Will", "description": "+2 Resolve for all morale checks." },
  { "id": "quick-hands", "name": "Quick Hands", "description": "Swap weapons without spending an action." },
  { "id": "steady-aim", "name": "Steady Aim", "description": "+2 Ranged when you did not move this turn." },
  { "id": "quick-shot", "name": "Quick Shot", "description": "Ranged attack costs half movement." },
  { "id": "tracker", "name": "Tracker", "description": "Encounter chance halved when you lead travel." },
  { "id": "nimble", "name": "Nimble", "description": "+1 Speed." },
  { "id": "fortify", "name": "Fortify", "description": "+3 Defense on your turn if you do not move." },
  { "id": "rallying-cry", "name": "Rallying Cry", "description": "Once per battle: allies within 2 tiles gain +2 Resolve until end of round." }
]
```

- [ ] **Step 4: Commit**

```bash
git add engine/data/
git commit -m "feat(warband): add data files — backgrounds, injuries, perks"
```

---

## Task 2: Schema

**Files:**
- Create: `engine/src/warband/schema.ts`
- Create: `engine/src/warband/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `engine/src/warband/schema.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterMember, parseWarbandCampaignState } from './schema.js';
import { EngineError } from '../core/errors.js';

function validMember(): any {
  return {
    id: 'p1',
    name: 'Aldric',
    role: 'protagonist',
    backgroundId: 'sellsword',
    level: 1,
    xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: ['hardened'],
    perks: [],
    injuries: [],
    gear: ['shortsword', 'shield', 'leather-armor'],
    wages: 0,
    morale: 10,
  };
}

function validState(): any {
  return {
    meta: { campaign: 'iron-road', day: 1, gold: 50 },
    rng: { seed: 'abc', cursor: 0 },
    protagonist: validMember(),
    companions: {},
    hirelings: {},
  };
}

test('parseRosterMember accepts a valid protagonist', () => {
  const m = parseRosterMember(validMember());
  assert.equal(m.name, 'Aldric');
  assert.equal(m.role, 'protagonist');
});

test('parseRosterMember rejects unknown role', () => {
  const bad = validMember();
  bad.role = 'wizard';
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember rejects negative hp', () => {
  const bad = validMember();
  bad.stats.hp = -1;
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember rejects hp exceeding maxHp', () => {
  const bad = validMember();
  bad.stats.hp = 20;
  bad.stats.maxHp = 14;
  assert.throws(() => parseRosterMember(bad), EngineError);
});

test('parseRosterMember accepts a death record', () => {
  const m = validMember();
  m.death = { cause: 'Bandit arrow', battleId: 'b1', dayOfCampaign: 3, location: 'Border Marches' };
  const parsed = parseRosterMember(m);
  assert.equal(parsed.death?.cause, 'Bandit arrow');
});

test('parseWarbandCampaignState accepts valid state', () => {
  const s = parseWarbandCampaignState(validState());
  assert.equal(s.meta.campaign, 'iron-road');
  assert.equal(s.meta.gold, 50);
});

test('parseWarbandCampaignState rejects negative gold', () => {
  const bad = validState();
  bad.meta.gold = -1;
  assert.throws(() => parseWarbandCampaignState(bad), EngineError);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd engine && node --import tsx --test "src/warband/schema.test.ts"
```

Expected: error — module not found or parse functions undefined.

- [ ] **Step 3: Implement `engine/src/warband/schema.ts`**

```typescript
import { z } from 'zod';
import { EngineError } from '../core/errors.js';

const Stats = z.object({
  melee: z.number().int().min(0),
  ranged: z.number().int().min(0),
  defense: z.number().int().min(0),
  resolve: z.number().int().min(0),
  initiative: z.number().int().min(0),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
});

const Injury = z.object({
  id: z.string(),
  name: z.string(),
  stat: z.enum(['melee', 'ranged', 'defense', 'resolve', 'initiative']),
  amount: z.number().int(),
});

const Death = z.object({
  cause: z.string(),
  battleId: z.string(),
  dayOfCampaign: z.number().int().min(0),
  location: z.string(),
});

const CompanionArc = z.object({
  questId: z.string(),
  stage: z.number().int().min(0),
  completed: z.boolean(),
});

export const RosterMember = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'companion', 'hireling']),
  backgroundId: z.string(),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  stats: Stats,
  traits: z.array(z.string()),
  perks: z.array(z.string()),
  injuries: z.array(Injury),
  gear: z.array(z.string()),
  wages: z.number().int().min(0),
  hiddenTrait: z.string().optional(),
  death: Death.optional(),
  arc: CompanionArc.optional(),
  morale: z.number().int().min(0).max(10),
}).superRefine((m, ctx) => {
  if (m.stats.hp > m.stats.maxHp) {
    ctx.addIssue({ code: 'custom', message: `${m.id}: hp ${m.stats.hp} exceeds maxHp ${m.stats.maxHp}` });
  }
});

export const CombatUnit = z.object({
  memberId: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'companion', 'hireling', 'enemy']),
  stats: Stats,
  currentHp: z.number().int().min(0),
  morale: z.number().int().min(0).max(10),
  position: z.object({ col: z.number().int().min(0), row: z.number().int().min(0) }),
  status: z.enum(['active', 'stunned', 'routing', 'down', 'dead']),
  hasActed: z.boolean(),
  hasMoved: z.boolean(),
});

export const WarbandCampaignState = z.object({
  meta: z.object({
    campaign: z.string(),
    day: z.number().int().min(1),
    gold: z.number().int().min(0),
  }),
  rng: z.object({ seed: z.string(), cursor: z.number().int().min(0) }),
  protagonist: RosterMember,
  companions: z.record(z.string(), RosterMember),
  hirelings: z.record(z.string(), RosterMember),
  activeBattle: z.object({
    battleId: z.string(),
    units: z.record(z.string(), CombatUnit),
    turnOrder: z.array(z.string()),
    currentTurnIndex: z.number().int().min(0),
    grid: z.array(z.array(z.enum(['open', 'blocked', 'occupied']))),
  }).optional(),
}).superRefine((s, ctx) => {
  if (s.meta.gold < 0) {
    ctx.addIssue({ code: 'custom', message: 'gold cannot be negative' });
  }
});

export type TRosterMember = z.infer<typeof RosterMember>;
export type TCombatUnit = z.infer<typeof CombatUnit>;
export type TWarbandCampaignState = z.infer<typeof WarbandCampaignState>;

function wrapParse<T>(schema: z.ZodType<T>, obj: unknown, label: string): T {
  const r = schema.safeParse(obj);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message || i.code).join('; ');
    throw new EngineError(`invalid ${label}: ${msg}`);
  }
  return r.data;
}

export function parseRosterMember(obj: unknown): TRosterMember {
  return wrapParse(RosterMember, obj, 'RosterMember');
}

export function parseWarbandCampaignState(obj: unknown): TWarbandCampaignState {
  return wrapParse(WarbandCampaignState, obj, 'WarbandCampaignState');
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd engine && node --import tsx --test "src/warband/schema.test.ts"
```

Expected: `✓ 7 tests passed`

- [ ] **Step 5: Commit**

```bash
git add engine/src/warband/schema.ts engine/src/warband/schema.test.ts
git commit -m "feat(warband): schema — RosterMember, CombatUnit, WarbandCampaignState"
```

---

## Task 3: State persistence

**Files:**
- Create: `engine/src/warband/warbandState.ts`

- [ ] **Step 1: Implement `engine/src/warband/warbandState.ts`**

(No separate test file — follows same pattern as `state.ts` which is integration-tested via CLI. The round-trip is validated by the schema on load.)

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from '../core/errors.js';
import { loadJson, saveJson } from '../core/stateIO.js';
import { appendLog } from '../core/log.js';
import { parseWarbandCampaignState, type TWarbandCampaignState } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const WARBAND_DIR = path.join(REPO_ROOT, 'engine', 'state', 'warband');

export interface WarbandCampaign { name: string; dir: string; }

export function resolveWarbandCampaign(name?: string): WarbandCampaign {
  if (name) {
    const dir = path.join(WARBAND_DIR, name);
    if (!fs.existsSync(path.join(dir, 'state.json'))) {
      throw new EngineError(`no warband campaign "${name}" at ${dir}`);
    }
    return { name, dir };
  }
  const entries = fs.existsSync(WARBAND_DIR)
    ? fs.readdirSync(WARBAND_DIR).filter((d) =>
        fs.existsSync(path.join(WARBAND_DIR, d, 'state.json'))
      )
    : [];
  if (entries.length === 1) return { name: entries[0], dir: path.join(WARBAND_DIR, entries[0]) };
  if (entries.length === 0) throw new EngineError('no warband campaigns found; create one with: warband campaign create <name> --background <id>');
  throw new EngineError(`multiple warband campaigns (${entries.join(', ')}); pass --campaign <name>`);
}

export function loadWarbandState(campaign: WarbandCampaign): TWarbandCampaignState {
  return loadJson(path.join(campaign.dir, 'state.json'), parseWarbandCampaignState);
}

export function saveWarbandState(campaign: WarbandCampaign, state: TWarbandCampaignState): void {
  saveJson(path.join(campaign.dir, 'state.json'), state, parseWarbandCampaignState);
}

export function logWarbandEvent(campaign: WarbandCampaign, event: Record<string, unknown>): void {
  appendLog(path.join(campaign.dir, 'log.jsonl'), event);
}

export function createWarbandCampaign(name: string, initialState: TWarbandCampaignState): WarbandCampaign {
  const dir = path.join(WARBAND_DIR, name);
  if (fs.existsSync(path.join(dir, 'state.json'))) {
    throw new EngineError(`warband campaign "${name}" already exists`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const campaign: WarbandCampaign = { name, dir };
  saveWarbandState(campaign, initialState);
  return campaign;
}
```

- [ ] **Step 2: Commit**

```bash
git add engine/src/warband/warbandState.ts
git commit -m "feat(warband): state persistence — load, save, create, resolve"
```

---

## Task 4: Progression

**Files:**
- Create: `engine/src/warband/progression.ts`
- Create: `engine/src/warband/progression.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `engine/src/warband/progression.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gainXp,
  levelUp,
  applyInjury,
  resolveHirelingDown,
  xpToNextLevel,
} from './progression.js';
import type { TRosterMember } from './schema.js';

function baseMember(overrides: Partial<TRosterMember> = {}): TRosterMember {
  return {
    id: 'm1',
    name: 'Test',
    role: 'hireling',
    backgroundId: 'sellsword',
    level: 1,
    xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [],
    perks: [],
    injuries: [],
    gear: [],
    wages: 5,
    morale: 10,
    ...overrides,
  };
}

test('gainXp increases xp', () => {
  const m = gainXp(baseMember(), 50);
  assert.equal(m.xp, 50);
});

test('gainXp does not mutate input', () => {
  const original = baseMember();
  gainXp(original, 50);
  assert.equal(original.xp, 0);
});

test('levelUp increases level and adds perk', () => {
  const m = baseMember({ xp: xpToNextLevel(1) });
  const leveled = levelUp(m, 'counter-attack');
  assert.equal(leveled.level, 2);
  assert.ok(leveled.perks.includes('counter-attack'));
});

test('levelUp resets xp to remainder', () => {
  const threshold = xpToNextLevel(1);
  const m = baseMember({ xp: threshold + 10 });
  const leveled = levelUp(m, 'iron-will');
  assert.equal(leveled.xp, 10);
});

test('applyInjury adds injury and applies stat penalty', () => {
  const injury = { id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative' as const, amount: -1 };
  const m = applyInjury(baseMember(), injury);
  assert.equal(m.injuries.length, 1);
  assert.equal(m.stats.initiative, 2); // was 3, -1
});

test('applyInjury does not reduce a stat below 0', () => {
  const injury = { id: 'concussion', name: 'Concussion', stat: 'resolve' as const, amount: -5 };
  const m = applyInjury(baseMember(), injury);
  assert.equal(m.stats.resolve, 0);
});

test('resolveHirelingDown returns dead on roll 1', () => {
  const death = { cause: 'Arrow', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 1, death);
  assert.ok(result.death);
  assert.equal(result.death.cause, 'Arrow');
});

test('resolveHirelingDown returns recovers on roll 3', () => {
  const death = { cause: 'Arrow', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 3, death);
  assert.equal(result.death, undefined);
  assert.equal(result.stats.hp, result.stats.maxHp);
});

test('resolveHirelingDown returns dead on roll 2', () => {
  const death = { cause: 'Sword', battleId: 'b1', dayOfCampaign: 5, location: 'Border' };
  const result = resolveHirelingDown(baseMember(), 2, death);
  assert.ok(result.death);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd engine && node --import tsx --test "src/warband/progression.test.ts"
```

Expected: error — module not found.

- [ ] **Step 3: Implement `engine/src/warband/progression.ts`**

```typescript
import type { TRosterMember } from './schema.js';

// XP threshold per level: 100 × level
export function xpToNextLevel(level: number): number {
  return level * 100;
}

export function gainXp(member: TRosterMember, amount: number): TRosterMember {
  return { ...member, xp: member.xp + amount };
}

export function levelUp(member: TRosterMember, perkId: string): TRosterMember {
  const threshold = xpToNextLevel(member.level);
  const remainder = member.xp - threshold;
  return {
    ...member,
    level: member.level + 1,
    xp: Math.max(0, remainder),
    perks: [...member.perks, perkId],
  };
}

export interface InjuryEntry {
  id: string;
  name: string;
  stat: 'melee' | 'ranged' | 'defense' | 'resolve' | 'initiative';
  amount: number;
}

export function applyInjury(member: TRosterMember, injury: InjuryEntry): TRosterMember {
  const newStats = { ...member.stats };
  const current = newStats[injury.stat as keyof typeof newStats] as number;
  (newStats as any)[injury.stat] = Math.max(0, current + injury.amount);
  return {
    ...member,
    stats: newStats,
    injuries: [...member.injuries, { id: injury.id, name: injury.name, stat: injury.stat, amount: injury.amount }],
  };
}

export interface DeathRecord {
  cause: string;
  battleId: string;
  dayOfCampaign: number;
  location: string;
}

// Hireling down resolution: roll 1-2 = dead, 3-6 = recovers at full HP.
export function resolveHirelingDown(member: TRosterMember, roll: number, deathRecord: DeathRecord): TRosterMember {
  if (roll <= 2) {
    return { ...member, death: deathRecord };
  }
  return { ...member, stats: { ...member.stats, hp: member.stats.maxHp } };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd engine && node --import tsx --test "src/warband/progression.test.ts"
```

Expected: `✓ 9 tests passed`

- [ ] **Step 5: Commit**

```bash
git add engine/src/warband/progression.ts engine/src/warband/progression.test.ts
git commit -m "feat(warband): progression — xp, level-up, injuries, hireling down-resolution"
```

---

## Task 5: Generator

**Files:**
- Create: `engine/src/warband/generator.ts`
- Create: `engine/src/warband/generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `engine/src/warband/generator.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHireling } from './generator.js';
import { makeRoller } from '../core/rng.js';

const BACKGROUNDS = [
  {
    id: 'sellsword',
    name: 'Sellsword',
    description: 'A mercenary.',
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, maxHp: 14 },
    startingTrait: 'hardened',
    startingGear: ['shortsword', 'shield', 'leather-armor'],
    perkPool: ['shield-wall', 'counter-attack'],
  },
];

const TRAITS = ['hardened', 'eagle-eyed', 'disciplined', 'greedy', 'brave', 'skittish'];

test('generateHireling returns a valid hireling shape', () => {
  const roll = makeRoller('test-seed');
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.role, 'hireling');
  assert.ok(h.id.length > 0);
  assert.ok(h.name.length > 0);
  assert.equal(h.backgroundId, 'sellsword');
  assert.ok(h.wages > 0);
});

test('generateHireling sets hp equal to maxHp', () => {
  const roll = makeRoller('seed2');
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.stats.hp, h.stats.maxHp);
});

test('generateHireling has exactly one visible trait', () => {
  const roll = makeRoller('seed3');
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.equal(h.traits.length, 1);
});

test('generateHireling has a hiddenTrait', () => {
  const roll = makeRoller('seed4');
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  assert.ok(typeof h.hiddenTrait === 'string');
  assert.ok(h.hiddenTrait.length > 0);
});

test('generateHireling stats have +/- 1 variance from background base', () => {
  const roll = makeRoller('seed5');
  const h = generateHireling(roll, BACKGROUNDS, TRAITS);
  const base = BACKGROUNDS[0].stats;
  assert.ok(Math.abs(h.stats.melee - base.melee) <= 1);
  assert.ok(Math.abs(h.stats.ranged - base.ranged) <= 1);
  assert.ok(Math.abs(h.stats.defense - base.defense) <= 1);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd engine && node --import tsx --test "src/warband/generator.test.ts"
```

Expected: error — module not found.

- [ ] **Step 3: Check `makeRoller` signature**

```bash
cd engine && grep -n 'makeRoller\|export' src/core/rng.ts | head -20
```

Use the roller function signature you see. It returns a function `roll(sides: number): number`.

- [ ] **Step 4: Implement `engine/src/warband/generator.ts`**

```typescript
import type { TRosterMember } from './schema.js';

interface BackgroundDef {
  id: string;
  name: string;
  description: string;
  stats: { melee: number; ranged: number; defense: number; resolve: number; initiative: number; maxHp: number };
  startingTrait: string;
  startingGear: string[];
  perkPool: string[];
}

type Roller = (sides: number) => number;

const HIRELING_NAMES = [
  'Bors', 'Crom', 'Durst', 'Edric', 'Finn', 'Garn', 'Hadwin', 'Idris',
  'Jorik', 'Keld', 'Lothar', 'Mord', 'Nils', 'Oswin', 'Petr', 'Raulf',
  'Sigrid', 'Tova', 'Ulf', 'Vara', 'Wulf', 'Xara', 'Yrsa', 'Zela',
];

let _hirelingCounter = 0;

function nextId(): string {
  return `h${Date.now()}-${++_hirelingCounter}`;
}

// Apply +/-1 variance to each stat (clamped to min 1)
function varyStats(
  base: BackgroundDef['stats'],
  roll: Roller
): { melee: number; ranged: number; defense: number; resolve: number; initiative: number; hp: number; maxHp: number } {
  const vary = (v: number) => Math.max(1, v + (roll(3) - 2)); // d3-2 = -1/0/+1
  const maxHp = Math.max(1, base.maxHp + (roll(3) - 2));
  return {
    melee: vary(base.melee),
    ranged: vary(base.ranged),
    defense: vary(base.defense),
    resolve: vary(base.resolve),
    initiative: vary(base.initiative),
    hp: maxHp,
    maxHp,
  };
}

export function generateHireling(roll: Roller, backgrounds: BackgroundDef[], traits: string[]): TRosterMember {
  const bg = backgrounds[roll(backgrounds.length) - 1];
  const name = HIRELING_NAMES[roll(HIRELING_NAMES.length) - 1];

  // Pick two distinct traits (one visible, one hidden)
  const t1idx = roll(traits.length) - 1;
  let t2idx = roll(traits.length) - 1;
  if (t2idx === t1idx) t2idx = (t2idx + 1) % traits.length;

  const wages = 3 + roll(4); // 4-7 gold/week

  return {
    id: nextId(),
    name,
    role: 'hireling',
    backgroundId: bg.id,
    level: 1,
    xp: 0,
    stats: varyStats(bg.stats, roll),
    traits: [traits[t1idx]],
    perks: [],
    injuries: [],
    gear: [...bg.startingGear],
    wages,
    hiddenTrait: traits[t2idx],
    morale: 10,
  };
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd engine && node --import tsx --test "src/warband/generator.test.ts"
```

Expected: `✓ 5 tests passed`

- [ ] **Step 6: Commit**

```bash
git add engine/src/warband/generator.ts engine/src/warband/generator.test.ts
git commit -m "feat(warband): generator — procedural hireling generation"
```

---

## Task 6: CLI

**Files:**
- Create: `engine/src/warband/cli.ts`
- Modify: `engine/package.json`

- [ ] **Step 1: Read existing `engine/src/core/rng.ts` to get `makeRoller` export name**

```bash
grep -n 'export function\|export const' engine/src/core/rng.ts
```

- [ ] **Step 2: Implement `engine/src/warband/cli.ts`**

```typescript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from '../core/errors.js';
import { makeRoller } from '../core/rng.js';
import {
  resolveWarbandCampaign,
  loadWarbandState,
  saveWarbandState,
  createWarbandCampaign,
  logWarbandEvent,
  WARBAND_DIR,
} from './warbandState.js';
import { parseWarbandCampaignState, type TRosterMember } from './schema.js';
import { gainXp, levelUp, xpToNextLevel } from './progression.js';
import { generateHireling } from './generator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, '..', '..', '..', 'engine', 'data');

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as T;
}

const USAGE = `
warband — Battle Brothers-style campaign CLI

Commands:
  campaign create <name> --background <id>   Start a new campaign
  campaign list                              List campaigns
  roster list                                Show full roster
  roster hire --background <id>              Hire a new hireling
  roster fire <id>                           Dismiss a hireling
  roster show <id>                           Show member details
  progress xp <id> <amount>                  Award XP to a member
  progress levelup <id> --perk <id>          Level up a member with chosen perk

Flags:
  --campaign <name>   Target campaign (optional if only one exists)
`.trim();

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

function out(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [cmd, sub, arg1, arg2] = positional;

if (!cmd || cmd === 'help') {
  out({ usage: USAGE });
  process.exit(0);
}

// campaign list — no state needed
if (cmd === 'campaign' && sub === 'list') {
  const list = fs.existsSync(WARBAND_DIR)
    ? fs.readdirSync(WARBAND_DIR).filter((d) =>
        fs.existsSync(path.join(WARBAND_DIR, d, 'state.json'))
      )
    : [];
  out({ op: 'campaign.list', campaigns: list });
  process.exit(0);
}

// campaign create
if (cmd === 'campaign' && sub === 'create') {
  const name = arg1;
  if (!name) throw new EngineError('usage: warband campaign create <name> --background <id>');
  const backgroundId = str(flags.background);
  if (!backgroundId) throw new EngineError('--background <id> required');

  const backgrounds = loadJson<any[]>('backgrounds.json');
  const bg = backgrounds.find((b: any) => b.id === backgroundId);
  if (!bg) throw new EngineError(`unknown background "${backgroundId}". Available: ${backgrounds.map((b: any) => b.id).join(', ')}`);

  const seed = `${name}-${Date.now()}`;
  const protagonist: TRosterMember = {
    id: 'protagonist',
    name: str(flags.name) || 'The Protagonist',
    role: 'protagonist',
    backgroundId: bg.id,
    level: 1,
    xp: 0,
    stats: { ...bg.stats, hp: bg.stats.maxHp },
    traits: [bg.startingTrait],
    perks: [],
    injuries: [],
    gear: [...bg.startingGear],
    wages: 0,
    morale: 10,
  };

  const initialState = parseWarbandCampaignState({
    meta: { campaign: name, day: 1, gold: 100 },
    rng: { seed, cursor: 0 },
    protagonist,
    companions: {},
    hirelings: {},
  });

  createWarbandCampaign(name, initialState);
  out({ op: 'campaign.create', campaign: name, protagonist });
  process.exit(0);
}

const campaign = resolveWarbandCampaign(str(flags.campaign));
const state = loadWarbandState(campaign);

let result: unknown;
let mutated = false;

if (cmd === 'roster' && sub === 'list') {
  const hirelings = Object.values(state.hirelings).filter((h) => !h.death);
  const companions = Object.values(state.companions).filter((c) => !c.death);
  result = {
    op: 'roster.list',
    protagonist: state.protagonist,
    companions,
    hirelings,
    gold: state.meta.gold,
    day: state.meta.day,
  };
}

else if (cmd === 'roster' && sub === 'hire') {
  const backgroundId = str(flags.background);
  if (!backgroundId) throw new EngineError('--background <id> required');
  const backgrounds = loadJson<any[]>('backgrounds.json');
  const bg = backgrounds.find((b: any) => b.id === backgroundId);
  if (!bg) throw new EngineError(`unknown background "${backgroundId}"`);

  const traits = ['hardened', 'eagle-eyed', 'disciplined', 'greedy', 'brave', 'skittish', 'loyal', 'cowardly'];
  const roll = makeRoller(state.rng.seed, state.rng.cursor);
  const hireling = generateHireling(roll as any, [bg], traits);

  state.hirelings[hireling.id] = hireling;
  mutated = true;
  result = { op: 'roster.hire', hireling };
}

else if (cmd === 'roster' && sub === 'fire') {
  const id = arg1;
  if (!id) throw new EngineError('usage: warband roster fire <id>');
  if (!state.hirelings[id]) throw new EngineError(`hireling "${id}" not found`);
  const fired = state.hirelings[id];
  delete state.hirelings[id];
  mutated = true;
  result = { op: 'roster.fire', dismissed: fired.name };
}

else if (cmd === 'roster' && sub === 'show') {
  const id = arg1;
  if (!id) throw new EngineError('usage: warband roster show <id>');
  const member =
    id === 'protagonist'
      ? state.protagonist
      : state.companions[id] ?? state.hirelings[id];
  if (!member) throw new EngineError(`member "${id}" not found`);
  result = { op: 'roster.show', member };
}

else if (cmd === 'progress' && sub === 'xp') {
  const id = arg1;
  const amount = parseInt(arg2 ?? '', 10);
  if (!id || isNaN(amount)) throw new EngineError('usage: warband progress xp <id> <amount>');

  const updateMember = (m: TRosterMember): TRosterMember => {
    const updated = gainXp(m, amount);
    const readyToLevel = updated.xp >= xpToNextLevel(updated.level);
    return updated;
  };

  if (id === 'protagonist') {
    state.protagonist = updateMember(state.protagonist);
  } else if (state.companions[id]) {
    state.companions[id] = updateMember(state.companions[id]);
  } else if (state.hirelings[id]) {
    state.hirelings[id] = updateMember(state.hirelings[id]);
  } else {
    throw new EngineError(`member "${id}" not found`);
  }

  const member = id === 'protagonist' ? state.protagonist : (state.companions[id] ?? state.hirelings[id]);
  const readyToLevel = member.xp >= xpToNextLevel(member.level);
  mutated = true;
  result = { op: 'progress.xp', id, xp: member.xp, level: member.level, readyToLevel, xpNeeded: xpToNextLevel(member.level) };
}

else if (cmd === 'progress' && sub === 'levelup') {
  const id = arg1;
  const perkId = str(flags.perk);
  if (!id || !perkId) throw new EngineError('usage: warband progress levelup <id> --perk <id>');

  const perks = loadJson<any[]>('perks.json');
  if (!perks.find((p: any) => p.id === perkId)) throw new EngineError(`unknown perk "${perkId}"`);

  const doLevelUp = (m: TRosterMember): TRosterMember => {
    if (m.xp < xpToNextLevel(m.level)) throw new EngineError(`${m.name} does not have enough XP to level up`);
    return levelUp(m, perkId);
  };

  if (id === 'protagonist') {
    state.protagonist = doLevelUp(state.protagonist);
  } else if (state.companions[id]) {
    state.companions[id] = doLevelUp(state.companions[id]);
  } else if (state.hirelings[id]) {
    state.hirelings[id] = doLevelUp(state.hirelings[id]);
  } else {
    throw new EngineError(`member "${id}" not found`);
  }

  const member = id === 'protagonist' ? state.protagonist : (state.companions[id] ?? state.hirelings[id]);
  mutated = true;
  result = { op: 'progress.levelup', id, level: member.level, perks: member.perks, xp: member.xp };
}

else {
  out({ error: `unknown command: ${cmd} ${sub ?? ''}`, usage: USAGE });
  process.exit(1);
}

if (mutated) {
  saveWarbandState(campaign, state);
  logWarbandEvent(campaign, { op: (result as any).op, ts: new Date().toISOString() });
}

out(result);
```

- [ ] **Step 3: Add `warband` script to `engine/package.json`**

Open `engine/package.json`. Add one line to the `"scripts"` block:

```json
"warband": "./node_modules/.bin/tsx src/warband/cli.ts",
```

The scripts block should look like:
```json
"scripts": {
  "engine": "./node_modules/.bin/tsx src/cli.ts",
  "realm": "./node_modules/.bin/tsx src/realm/cli.ts",
  "warband": "./node_modules/.bin/tsx src/warband/cli.ts",
  "typecheck": "tsc --noEmit",
  "test": "node --import tsx --test \"src/**/*.test.ts\""
},
```

- [ ] **Step 4: Smoke test the CLI end-to-end**

```bash
cd engine

# Create a campaign
npm run warband -- campaign create iron-road --background sellsword --name Aldric
# Expected: { op: 'campaign.create', campaign: 'iron-road', protagonist: { ... } }

# List campaigns
npm run warband -- campaign list
# Expected: { op: 'campaign.list', campaigns: ['iron-road'] }

# List roster
npm run warband -- roster list
# Expected: protagonist listed, empty companions/hirelings

# Hire a hireling
npm run warband -- roster hire --background hunter
# Expected: { op: 'roster.hire', hireling: { role: 'hireling', ... } }

# Award XP to protagonist
npm run warband -- progress xp protagonist 50
# Expected: { op: 'progress.xp', xp: 50, readyToLevel: false }

# Award enough XP to level up
npm run warband -- progress xp protagonist 60
# Expected: { op: 'progress.xp', xp: 110, readyToLevel: true }

# Level up protagonist
npm run warband -- progress levelup protagonist --perk counter-attack
# Expected: { op: 'progress.levelup', level: 2, perks: ['counter-attack'] }
```

- [ ] **Step 5: Run full test suite — verify nothing broken**

```bash
cd engine && npm test
```

Expected: all existing tests plus new warband tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd engine && npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add engine/src/warband/cli.ts engine/package.json
git commit -m "feat(warband): CLI — campaign, roster, progress commands"
```

---

## Task 7: Final integration commit

- [ ] **Step 1: Run full suite one last time**

```bash
cd engine && npm test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 2: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- ✓ RosterMember schema with stats, injuries, death record, traits, perks
- ✓ CombatUnit schema (transient snapshot)
- ✓ Permadeath as structured death record (not deletion)
- ✓ Two-tier injury: full table for protagonist/companions, D6 probabilistic for hirelings
- ✓ Protagonist + companion + hireling roles
- ✓ XP and level-up
- ✓ Data-driven backgrounds, injuries, perks in JSON
- ✓ Procedural hireling generation with variance and hidden trait
- ✓ CLI commands for campaign, roster, progress

**Not in this sub-project (deferred to sub-project 2+):**
- Combat grid engine
- Morale cascade
- Overworld travel
- Trade/factions

**Placeholder scan:** No TBDs. All code blocks complete. ✓

**Type consistency:** `TRosterMember` defined in schema.ts, imported in progression.ts, generator.ts, cli.ts. `InjuryEntry` in progression.ts matches `Injury` schema fields. `DeathRecord` in progression.ts matches `Death` schema shape. ✓
