# Realm Army & Warfare (v2 increment 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a defensive warfare loop to the realm sim engine — a scaling invasion threat and a strength×quality army that must repel it — to break the v1 solved-late-game stalemate.

**Architecture:** Purely additive to the existing `realm/` engine. New pure module `realm/war.ts` (threat growth, invasion announcement, battle math, recruit cost) is composed by `resolve.ts` as a new tick step. Schema gains `army.quality`, `threat`, `war`. CLI gains `recruit`/`drill`. Everything still mutates inside one auditable `tick`; the LLM only narrates the code-owned numbers.

**Tech Stack:** TypeScript, zod, tsx, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-01-realm-warfare-v2-design.md`

**Working directory for all commands:** `engine/`
**Test runner:** `npx node --import tsx --test "<path>"`
**Typecheck:** `npx tsc --noEmit`

---

## Task 1: Extend the schema (army.quality, threat, war)

**Files:**
- Modify: `engine/src/realm/schema.ts`
- Test: `engine/src/realm/schema.test.ts` (existing — append)

- [ ] **Step 1: Write the failing tests** — append to `engine/src/realm/schema.test.ts`:

```typescript
test('parseRealm defaults army.quality to 1.0, threat to 0, war to null', () => {
  const r = parseRealm(validRealm());
  assert.equal(r.army.quality, 1.0);
  assert.equal(r.threat, 0);
  assert.equal(r.war, null);
});

test('parseRealm rejects army quality below 0.5 or above 2.0', () => {
  const lo = validRealm(); lo.army = { strength: 10, quality: 0.4 };
  const hi = validRealm(); hi.army = { strength: 10, quality: 2.1 };
  assert.throws(() => parseRealm(lo), EngineError);
  assert.throws(() => parseRealm(hi), EngineError);
});

test('parseRealm rejects negative threat and negative army strength', () => {
  const t = validRealm(); t.threat = -1;
  const s = validRealm(); s.army = { strength: -5, quality: 1.0 };
  assert.throws(() => parseRealm(t), EngineError);
  assert.throws(() => parseRealm(s), EngineError);
});

test('parseRealm accepts an active war block', () => {
  const w = validRealm(); w.war = { invader: 'the Ashmark horde', force: 40, strikesIn: 2 };
  const r = parseRealm(w);
  assert.equal(r.war.force, 40);
  assert.equal(r.war.strikesIn, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/schema.test.ts"`
Expected: FAIL — the 4 new tests fail (quality/threat/war undefined or not validated). Existing tests still pass.

- [ ] **Step 3: Add the schema fields** — in `engine/src/realm/schema.ts`, add quality range constants near `TAX_LEVELS`:

```typescript
export const ARMY_QUALITY_MIN = 0.5;
export const ARMY_QUALITY_MAX = 2.0;
```

Add `Army` and `War` schemas before the `Realm` definition:

```typescript
export const Army = z.looseObject({
  strength: z.number().min(0).default(0),
  quality: z.number().min(ARMY_QUALITY_MIN).max(ARMY_QUALITY_MAX).default(1.0),
});

export const War = z.looseObject({
  invader: z.string(),
  force: z.number().min(0),
  strikesIn: z.number().int().min(0),
});
```

In the `Realm` object, replace the existing `army` line and add `threat` + `war`:

```typescript
  army: Army.default({ strength: 0, quality: 1.0 }),
  threat: z.number().min(0).default(0),
  war: War.nullable().default(null),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --import tsx --test "src/realm/schema.test.ts"`
Expected: PASS — all schema tests green (old + new).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/schema.ts src/realm/schema.test.ts
git commit -m "feat(realm): schema for army quality, threat, and war"
```

---

## Task 2: war.ts — threat growth + invasion announcement

**Files:**
- Create: `engine/src/realm/war.ts`
- Test: `engine/src/realm/war.test.ts`

- [ ] **Step 1: Write the failing tests** — create `engine/src/realm/war.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growThreat, announceInvasion, INVASION_THRESHOLD, INVASION_WARNING_TURNS } from './war';

test('growThreat rises by the base amount in a poor, small realm', () => {
  const next = growThreat(0, /*prosperity*/ 0, /*holdings*/ 0);
  assert.ok(next > 0, `threat grew to ${next}`);
});

test('growThreat rises faster in a prosperous, sprawling realm', () => {
  const poor = growThreat(10, 0, 0);
  const rich = growThreat(10, 5, 8);
  assert.ok(rich > poor, `rich ${rich} > poor ${poor}`);
});

test('announceInvasion scales force with the threat that summoned it', () => {
  const small = announceInvasion(INVASION_THRESHOLD, 1);
  const big = announceInvasion(INVASION_THRESHOLD * 3, 1);
  assert.ok(big.force > small.force, `big ${big.force} > small ${small.force}`);
  assert.equal(small.strikesIn, INVASION_WARNING_TURNS);
});

test('announceInvasion picks a non-empty invader name deterministically by turn', () => {
  const a = announceInvasion(20, 7).invader;
  const b = announceInvasion(20, 7).invader;
  assert.equal(a, b);
  assert.ok(a.length > 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: FAIL — `Cannot find module './war'`.

- [ ] **Step 3: Create `engine/src/realm/war.ts`** with the threat/invasion functions:

```typescript
// Warfare: pure threat growth, invasion announcement, battle math, and recruit
// cost. No I/O, no dice except the battle resolver. resolve.ts composes these.
import type { Roller } from '../core/rng';

// --- Threat & invasions ---
export const THREAT_BASE_GROWTH = 2;
export const THREAT_PROSPERITY_FACTOR = 1;   // floor(prosperity * this)
export const THREAT_HOLDINGS_FACTOR = 0.5;   // floor(holdings.length * this)
export const INVASION_THRESHOLD = 12;        // threat at/above this summons an invasion
export const INVASION_FORCE_FACTOR = 1.5;    // force = round(threat * this)
export const INVASION_WARNING_TURNS = 2;     // telegraph: turns before the strike

const INVADERS = [
  'the Ashmark horde', 'the Iron Reavers', 'the Saltmarsh raiders',
  'the Gray Company', 'the Broken Banner',
];

export interface War { invader: string; force: number; strikesIn: number; }

// Threat climbs each peacetime tick; a rich, sprawling realm draws more attention.
export function growThreat(threat: number, prosperity: number, holdingsCount: number): number {
  return threat
    + THREAT_BASE_GROWTH
    + Math.floor(Math.max(0, prosperity) * THREAT_PROSPERITY_FACTOR)
    + Math.floor(holdingsCount * THREAT_HOLDINGS_FACTOR);
}

// Build the incoming invasion. Caller checks threat >= INVASION_THRESHOLD and
// resets threat to 0 afterward. Invader name is cosmetic and consumes no die.
export function announceInvasion(threat: number, turn: number): War {
  return {
    invader: INVADERS[((turn % INVADERS.length) + INVADERS.length) % INVADERS.length],
    force: Math.round(threat * INVASION_FORCE_FACTOR),
    strikesIn: INVASION_WARNING_TURNS,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/war.ts src/realm/war.test.ts
git commit -m "feat(realm): threat growth and invasion announcement"
```

---

## Task 3: war.ts — battle resolution

**Files:**
- Modify: `engine/src/realm/war.ts`
- Test: `engine/src/realm/war.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `engine/src/realm/war.test.ts`:

```typescript
import { resolveBattle } from './war';
import { makeRoller, type Roller } from '../core/rng';

// A roller stub returning fixed die values in sequence (then repeating the last).
function fixedRoller(values: number[]): Roller {
  let i = 0;
  return { die: () => values[Math.min(i++, values.length - 1)], consumed: () => ({ from: 0, to: i }) };
}

test('resolveBattle: a vastly superior army wins regardless of the dice', () => {
  const o = resolveBattle(100, 1.0, 5, fixedRoller([1, 20])); // worst roll for us, best for them
  assert.equal(o.win, true);
  assert.equal(o.effective, 100);
});

test('resolveBattle: a tiny army loses regardless of the dice', () => {
  const o = resolveBattle(1, 1.0, 100, fixedRoller([20, 1])); // best for us, worst for them
  assert.equal(o.win, false);
});

test('resolveBattle: quality multiplies effective force', () => {
  const o = resolveBattle(10, 2.0, 0, fixedRoller([10, 10]));
  assert.equal(o.effective, 20);
});

test('resolveBattle consumes exactly two dice', () => {
  const roller = makeRoller({ seed: 'war', cursor: 0 });
  resolveBattle(10, 1.0, 10, roller);
  assert.deepEqual(roller.consumed(), { from: 0, to: 2 });
});

test('resolveBattle is deterministic for a fixed seed and cursor', () => {
  const a = resolveBattle(10, 1.0, 10, makeRoller({ seed: 'war', cursor: 3 }));
  const b = resolveBattle(10, 1.0, 10, makeRoller({ seed: 'war', cursor: 3 }));
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: FAIL — `resolveBattle` is not exported.

- [ ] **Step 3: Add `resolveBattle` to `engine/src/realm/war.ts`** (append after `announceInvasion`):

```typescript
export interface BattleOutcome {
  effective: number;    // strength × quality
  force: number;        // the invader's force
  yourRoll: number;     // d20
  invaderRoll: number;  // d20
  yourScore: number;    // effective + yourRoll
  invaderScore: number; // force + invaderRoll
  win: boolean;
}

// One decisive clash. Consumes exactly two dice (yours, then the invader's) so the
// battle is replayable on a forward-only cursor. Pure: returns the outcome; the
// caller (resolve.ts) applies casualties and consequences.
export function resolveBattle(strength: number, quality: number, force: number, roller: Roller): BattleOutcome {
  const effective = strength * quality;
  const yourRoll = roller.die(20);
  const invaderRoll = roller.die(20);
  const yourScore = effective + yourRoll;
  const invaderScore = force + invaderRoll;
  return { effective, force, yourRoll, invaderRoll, yourScore, invaderScore, win: yourScore >= invaderScore };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: PASS — all war tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/war.ts src/realm/war.test.ts
git commit -m "feat(realm): deterministic battle resolution"
```

---

## Task 4: war.ts — recruit cost helper

**Files:**
- Modify: `engine/src/realm/war.ts`
- Test: `engine/src/realm/war.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `engine/src/realm/war.test.ts`:

```typescript
import { computeRecruit, RECRUIT_MANPOWER_COST, RECRUIT_GOLD_COST } from './war';

test('computeRecruit: full request when affordable', () => {
  const r = computeRecruit(10, /*manpower*/ 100, /*gold*/ 100, /*requested*/ 5);
  assert.equal(r.recruited, 5);
  assert.equal(r.manpowerSpent, 5 * RECRUIT_MANPOWER_COST);
  assert.equal(r.goldSpent, 5 * RECRUIT_GOLD_COST);
  assert.equal(r.shortfall, 0);
});

test('computeRecruit: capped by the scarcer of gold and manpower, with shortfall', () => {
  // gold only affords 2 recruits (2 each), manpower affords plenty
  const r = computeRecruit(0, 100, 2 * RECRUIT_GOLD_COST, 5);
  assert.equal(r.recruited, 2);
  assert.equal(r.shortfall, 3);
  assert.ok(r.goldSpent <= 2 * RECRUIT_GOLD_COST);
});

test('computeRecruit: nothing affordable recruits zero', () => {
  const r = computeRecruit(0, 0, 0, 4);
  assert.equal(r.recruited, 0);
  assert.equal(r.shortfall, 4);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: FAIL — `computeRecruit` not exported.

- [ ] **Step 3: Add recruit/drill cost constants and `computeRecruit`** to `engine/src/realm/war.ts`:

```typescript
// --- Recruitment & training costs ---
export const RECRUIT_MANPOWER_COST = 1;  // manpower per point of strength
export const RECRUIT_GOLD_COST = 2;      // gold per point of strength
export const DRILL_GOLD_COST = 30;       // gold to drill the army once
export const DRILL_QUALITY_GAIN = 0.2;   // quality raised per drill

export interface RecruitResult {
  recruited: number;     // strength actually added
  manpowerSpent: number;
  goldSpent: number;
  shortfall: number;     // requested − recruited (unfunded, no debt)
}

// Muster what the treasury and manpower can afford, up to the request. No debt:
// the shortfall is surfaced, not borrowed.
export function computeRecruit(_currentStrength: number, manpower: number, gold: number, requested: number): RecruitResult {
  const byManpower = Math.floor(manpower / RECRUIT_MANPOWER_COST);
  const byGold = Math.floor(gold / RECRUIT_GOLD_COST);
  const recruited = Math.max(0, Math.min(requested, byManpower, byGold));
  return {
    recruited,
    manpowerSpent: recruited * RECRUIT_MANPOWER_COST,
    goldSpent: recruited * RECRUIT_GOLD_COST,
    shortfall: requested - recruited,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --import tsx --test "src/realm/war.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/war.ts src/realm/war.test.ts
git commit -m "feat(realm): recruit cost helper"
```

---

## Task 5: economy.ts — army upkeep scales with quality

**Files:**
- Modify: `engine/src/realm/economy.ts`
- Test: `engine/src/realm/economy.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `engine/src/realm/economy.test.ts`:

```typescript
test('computeIncome: a higher-quality army costs more upkeep at equal strength', () => {
  const levy  = computeIncome({ policies: { tax: 'normal' }, holdings: [], army: { strength: 20, quality: 1.0 } });
  const elite = computeIncome({ policies: { tax: 'normal' }, holdings: [], army: { strength: 20, quality: 2.0 } });
  assert.ok(elite.upkeep > levy.upkeep, `elite ${elite.upkeep} > levy ${levy.upkeep}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --import tsx --test "src/realm/economy.test.ts"`
Expected: FAIL — current upkeep ignores quality, so the two are equal.

- [ ] **Step 3: Update upkeep in `engine/src/realm/economy.ts`.** Replace the `ARMY_UPKEEP_PER_STRENGTH` constant:

```typescript
export const ARMY_UPKEEP_PER_EFFECTIVE = 1; // upkeep per point of strength × quality
```

In `computeIncome`, replace the `upkeep` calculation's army term. The full `upkeep` assignment becomes:

```typescript
  const quality = (realm.army as any).quality ?? 1;
  const upkeep =
    UPKEEP_BASE +
    realm.holdings.reduce((sum, h) => sum + HOLDING_UPKEEP_PER_TIER * h.tier, 0) +
    Math.round(realm.army.strength * quality * ARMY_UPKEEP_PER_EFFECTIVE);
```

(The `?? 1` guard keeps raw, unparsed test objects without a `quality` field working.)

- [ ] **Step 4: Run the full economy + resolve suites to verify pass and no regressions**

Run: `npx node --import tsx --test "src/realm/economy.test.ts" "src/realm/resolve.test.ts"`
Expected: PASS — new test green; the existing `a standing army raises upkeep` test still passes (quality defaults to 1).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/economy.ts src/realm/economy.test.ts
git commit -m "feat(realm): army upkeep scales with strength x quality"
```

---

## Task 6: resolve.ts — War step + recruit/drill pending handlers

**Files:**
- Modify: `engine/src/realm/resolve.ts`
- Test: `engine/src/realm/resolve.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `engine/src/realm/resolve.test.ts`:

```typescript
import { INVASION_THRESHOLD } from './war';

test('WAR: a recruit order musters strength on the tick, spending gold and manpower', () => {
  const r = validRealm({ resources: { treasury: 100, food: { stock: 80, production: 30, consumption: 26 }, manpower: 100 },
    army: { strength: 0, quality: 1.0 }, pending: [{ kind: 'recruit', strength: 10 }] });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.equal(realm.army.strength, 10);
  assert.ok(realm.resources.manpower < 100 && realm.resources.treasury < 100);
});

test('WAR: a drill order raises quality, capped at 2.0', () => {
  const r = validRealm({ army: { strength: 10, quality: 1.9 }, pending: [{ kind: 'drill' }, { kind: 'drill' }] });
  const { realm } = tick(r, { eventTable: QUIET });
  assert.ok(realm.army.quality > 1.9);
  assert.ok(realm.army.quality <= 2.0);
});

test('WAR: threat grows in peacetime and an invasion is announced at the threshold', () => {
  const r = validRealm({ threat: INVASION_THRESHOLD });
  const { realm, report } = tick(r, { eventTable: QUIET });
  assert.ok(realm.war, 'invasion announced');
  assert.equal(realm.threat, 0, 'threat discharged');
  assert.ok(realm.war.force > 0);
});

test('WAR: an incoming invasion counts down and strikes when it reaches zero', () => {
  const r = validRealm({ war: { invader: 'the Ashmark horde', force: 5, strikesIn: 1 },
    army: { strength: 100, quality: 1.0 } });
  const { realm, report } = tick(r, { eventTable: QUIET });
  assert.equal(realm.war, null, 'war resolved');
  assert.equal(report.war.event, 'battle');
  assert.equal(report.war.outcome, 'won'); // 100 effective vs force 5
});

test('WAR INVARIANT: losing a battle never drops treasury below zero', () => {
  const r = validRealm({ war: { invader: 'doom', force: 999, strikesIn: 1 },
    army: { strength: 0, quality: 1.0 },
    resources: { treasury: 10, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 } });
  const { realm, report } = tick(r, { eventTable: QUIET });
  assert.equal(report.war.outcome, 'lost');
  assert.ok(realm.resources.treasury >= 0, `treasury ${realm.resources.treasury}`);
  assert.ok(realm.clocks.unrest <= 10 && realm.clocks.stability >= -5, 'clocks clamped after the sack');
  assert.doesNotThrow(() => parseRealm(realm));
});

test('WAR: a battle tick consumes three dice (one event draw + two battle dice)', () => {
  const before = validRealm({ war: { invader: 'doom', force: 5, strikesIn: 1 }, army: { strength: 50, quality: 1.0 } });
  const { realm } = tick(before, { eventTable: QUIET });
  assert.equal(realm.rng.cursor - before.rng.cursor, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/resolve.test.ts"`
Expected: FAIL — the 6 new `WAR` tests fail (no war step yet; `report.war` undefined). Existing resolve tests still pass.

- [ ] **Step 3: Wire warfare into `engine/src/realm/resolve.ts`.**

(a) Add imports at the top (extend the existing `./war`-less import list):

```typescript
import {
  growThreat, announceInvasion, resolveBattle, computeRecruit,
  INVASION_THRESHOLD, DRILL_GOLD_COST, DRILL_QUALITY_GAIN,
} from './war';
import { ARMY_QUALITY_MAX } from './schema';
```

(b) Add the sack/consequence constants near the other resolve constants:

```typescript
// War consequences (tunable in the balance shakedown).
const WIN_CASUALTY_FRAC = 0.2;
const LOSS_CASUALTY_FRAC = 0.6;
const VETERANCY_GAIN = 0.1;
const SACK_TREASURY_FRAC = 0.4;
const SACK_UNREST = 3;
const SACK_STABILITY = 2;
```

(c) Extend the `TickReport` interface with threat + war:

```typescript
  threat: number;
  war:
    | null
    | { event: 'announced'; invader: string; force: number; strikesIn: number }
    | { event: 'battle'; invader: string; outcome: 'won' | 'lost'; effective: number; force: number;
        yourRoll: number; invaderRoll: number; casualties: number; treasuryLost: number; holdingRazed: string | null };
```

(d) Add a module-level battle-consequence helper (after `clampClocks`, before `tick`). This mutates the realm clone and returns the report fragment:

```typescript
type WarReport = TickReport['war'];

function applyBattle(realm: any, roller: any): WarReport {
  const out = resolveBattle(realm.army.strength, realm.army.quality, realm.war.force, roller);
  const invader = realm.war.invader;
  if (out.win) {
    const casualties = Math.round(realm.army.strength * WIN_CASUALTY_FRAC);
    realm.army.strength = Math.max(0, realm.army.strength - casualties);
    realm.army.quality = Math.min(ARMY_QUALITY_MAX, realm.army.quality + VETERANCY_GAIN);
    realm.clocks.stability += 1;
    realm.war = null;
    return { event: 'battle', invader, outcome: 'won', effective: out.effective, force: out.force,
      yourRoll: out.yourRoll, invaderRoll: out.invaderRoll, casualties, treasuryLost: 0, holdingRazed: null };
  }
  const casualties = Math.round(realm.army.strength * LOSS_CASUALTY_FRAC);
  realm.army.strength = Math.max(0, realm.army.strength - casualties);
  const treasuryLost = Math.round(realm.resources.treasury * SACK_TREASURY_FRAC);
  realm.resources.treasury = Math.max(0, realm.resources.treasury - treasuryLost);
  // Raze the lowest-tier holding (tie-break: last such in the list).
  let holdingRazed: string | null = null;
  if (realm.holdings.length > 0) {
    let idx = 0;
    for (let i = 0; i < realm.holdings.length; i++) if (realm.holdings[i].tier <= realm.holdings[idx].tier) idx = i;
    const h = realm.holdings[idx];
    holdingRazed = h.id;
    if (h.tier > 1) h.tier -= 1; else realm.holdings.splice(idx, 1);
  }
  realm.clocks.unrest += SACK_UNREST;
  realm.clocks.stability -= SACK_STABILITY;
  realm.clocks.prosperity -= 1;
  realm.war = null;
  return { event: 'battle', invader, outcome: 'lost', effective: out.effective, force: out.force,
    yourRoll: out.yourRoll, invaderRoll: out.invaderRoll, casualties, treasuryLost, holdingRazed };
}
```

(e) In the pending loop (step 5), add `recruit` and `drill` handlers alongside `build`/`edict`:

```typescript
    } else if (item.kind === 'recruit') {
      const rc = computeRecruit(realm.army.strength, realm.resources.manpower, realm.resources.treasury, item.strength);
      realm.army.strength += rc.recruited;
      realm.resources.manpower -= rc.manpowerSpent;
      realm.resources.treasury -= rc.goldSpent;
    } else if (item.kind === 'drill') {
      if (realm.resources.treasury >= DRILL_GOLD_COST) {
        realm.resources.treasury -= DRILL_GOLD_COST;
        realm.army.quality = Math.min(ARMY_QUALITY_MAX, realm.army.quality + DRILL_QUALITY_GAIN);
      }
    }
```

(f) Insert the **War step** immediately after the pending loop / `realm.pending = []` and **before** the clocks step (step 6 in v1 becomes step 7). Add:

```typescript
  // 6. War — count down an incoming invasion and resolve it, or grow threat and
  // announce a new invasion. Battle consequences feed the clocks step below.
  let warReport: WarReport = null;
  if (realm.war) {
    realm.war.strikesIn -= 1;
    if (realm.war.strikesIn <= 0) {
      warReport = applyBattle(realm, roller);
    }
  } else {
    realm.threat = growThreat(realm.threat, realm.clocks.prosperity, realm.holdings.length);
    if (realm.threat >= INVASION_THRESHOLD) {
      realm.war = announceInvasion(realm.threat, realm.meta.turn);
      realm.threat = 0;
      warReport = { event: 'announced', invader: realm.war.invader, force: realm.war.force, strikesIn: realm.war.strikesIn };
    }
  }
```

(g) In the `report` object literal at the end, add the two new fields:

```typescript
    threat: realm.threat,
    war: warReport,
```

- [ ] **Step 4: Run the full realm suite to verify pass and no regressions**

Run: `npx node --import tsx --test "src/realm/*.test.ts"`
Expected: PASS — all `WAR` tests green; all existing schema/economy/events/resolve/bridge/golden tests still pass (single-tick existing tests grow threat to a small value but never cross the threshold, so behavior is unchanged).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/resolve.ts src/realm/resolve.test.ts
git commit -m "feat(realm): war tick step, battle consequences, recruit/drill"
```

---

## Task 7: CLI commands (recruit, drill) and bridge war descriptor

**Files:**
- Modify: `engine/src/realm/cli.ts`
- Modify: `engine/src/realm/bridge.ts`
- Test: `engine/src/realm/bridge.test.ts` (append)

- [ ] **Step 1: Write the failing bridge tests** — append to `engine/src/realm/bridge.test.ts`:

```typescript
test('digest reports peace when there is no war and low threat', () => {
  const d = buildDigest(realmWith({ threat: 0, war: null }));
  assert.equal(typeof d.war, 'string');
  assert.match(d.war, /peace/i);
  assert.doesNotMatch(d.war, /\d/);
});

test('digest reports an incoming invasion as a war descriptor and a crisis', () => {
  const d = buildDigest(realmWith({ threat: 0, war: { invader: 'the Ashmark horde', force: 40, strikesIn: 2 } }));
  assert.match(d.war, /massing|border|horde|invasion/i);
  assert.ok(d.crises.some((c) => /invasion|war|horde/i.test(c)), `crises ${JSON.stringify(d.crises)}`);
});
```

- [ ] **Step 2: Run the bridge tests to verify they fail**

Run: `npx node --import tsx --test "src/realm/bridge.test.ts"`
Expected: FAIL — `d.war` is undefined (no `war` field on the digest yet).

- [ ] **Step 3: Add the war descriptor to `engine/src/realm/bridge.ts`.**

(a) Import the threshold:

```typescript
import { INVASION_THRESHOLD } from './war';
```

(b) Add `war: string;` to the `RealmDigest` interface.

(c) Add a `warWord` helper (after `crisesFrom`):

```typescript
function warWord(realm: any): string {
  if (realm.war) {
    return realm.war.strikesIn > 0
      ? `${realm.war.invader} is massing on the border`
      : 'the realm is under siege';
  }
  if ((realm.threat ?? 0) >= INVASION_THRESHOLD / 2) return 'distant war-drums';
  return 'peace holds';
}
```

(d) In `crisesFrom`, add an invasion crisis (guard for the optional field):

```typescript
  if (realm.war) crises.push(`${realm.war.invader} threatens the realm`);
```

(e) In `buildDigest`'s returned object, add `war: warWord(realm),`.

- [ ] **Step 4: Run the bridge tests to verify they pass**

Run: `npx node --import tsx --test "src/realm/bridge.test.ts"`
Expected: PASS — new tests green; existing bridge tests still pass (a realm with no `war`/`threat` yields `'peace holds'` and no extra crisis).

- [ ] **Step 5: Add the `recruit` and `drill` CLI commands to `engine/src/realm/cli.ts`.**

In the `switch (key)` block (alongside `build`/`edict`), add:

```typescript
    case 'recruit': {
      const n = num(flags.strength);
      if (n == null || n <= 0) throw new EngineError('realm recruit requires --strength N (positive)');
      realm.pending.push({ kind: 'recruit', strength: n });
      result = { op: 'realm.recruit', queued: n, pending: realm.pending };
      mutated = true; break;
    }
    case 'drill': {
      realm.pending.push({ kind: 'drill' });
      result = { op: 'realm.drill', pending: realm.pending };
      mutated = true; break;
    }
```

Update the `USAGE` string to document the two commands (insert after the `edict` line):

```typescript
  recruit --strength N                      # queue: muster N strength (manpower + gold)
  drill                                     # queue: train the army (gold -> +quality)
```

- [ ] **Step 6: Smoke-test the CLI end-to-end**

```bash
TMP=$(mktemp -d)
npx tsx src/realm/cli.ts init --in "$TMP" --name "Vael" --seed v1
npx tsx src/realm/cli.ts recruit --in "$TMP" --strength 10
npx tsx src/realm/cli.ts drill --in "$TMP"
npx tsx src/realm/cli.ts tick --in "$TMP"
npx tsx src/realm/cli.ts status --in "$TMP" --path army
```
Expected: the final `status` prints `army` with `strength: 10` (recruited on the tick, given the default treasury/manpower afford it) and `quality > 1.0`.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/realm/cli.ts src/realm/bridge.ts src/realm/bridge.test.ts
git commit -m "feat(realm): recruit/drill CLI commands and war digest"
```

---

## Task 8: Golden-replay extension + balance shakedown + docs

**Files:**
- Modify: `engine/src/realm/golden.test.ts`
- Modify: `engine/docs/realm-play.md`

- [ ] **Step 1: Update the golden-replay test for warfare** — in `engine/src/realm/golden.test.ts`:

(a) Extend the `script` to provoke and fight a war. Replace the script body's build/tick section so the realm recruits and drills, then runs enough ticks to trigger and resolve an invasion:

```typescript
  return [
    at('init', '--name', 'Duchy of Vael', '--seed', SEED, '--calendar', 'Spring 1387'),
    at('policy', '--tax', 'high'),
    at('build', 'granary'),
    at('build', 'market'),
    at('recruit', '--strength', '30'),
    at('drill'),
    ...Array.from({ length: TICKS }, () => at('tick')),
    at('recruit', '--strength', '20'),
    at('tick'),
  ];
```

(b) The existing `cursor equals the number of ticks` test is no longer valid (battle ticks consume extra dice). Replace that test with a battle-aware determinism check:

```typescript
test('golden replay: the rng cursor is deterministic and accounts for battle dice', () => {
  const a = playthrough();
  const b = playthrough();
  assert.equal(a.realm.rng.cursor, b.realm.rng.cursor); // identical across runs
  assert.ok(a.realm.rng.cursor >= TICKS + 1, 'at least one die per tick');
});
```

(c) Add a test asserting a war actually occurred during the run (otherwise the warfare path is untested by the golden replay):

```typescript
test('golden replay: warfare engages during the run (announce and/or battle)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-golden-war-'));
  let sawWar = false;
  for (const argv of script(dir)) {
    const res = run(argv);
    if (res?.op === 'realm.tick' && res.report.war) sawWar = true;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(sawWar, 'an invasion was announced or fought during the scripted run');
});
```

(d) The `every mutating command appended a log entry` test asserts `log.length`. The new script has 8 setup/queue commands + (TICKS) ticks + recruit + tick = update the expected count. With `TICKS = 6`: init, policy, 2 builds, recruit, drill, 6 ticks, recruit, tick = **13**. Update:

```typescript
  assert.equal(log.length, 13);
```

- [ ] **Step 2: Run the golden suite to verify it passes**

Run: `npx node --import tsx --test "src/realm/golden.test.ts"`
Expected: PASS — determinism holds, a war is observed, invariants hold.

- [ ] **Step 3: Run the FULL test suite + typecheck**

Run: `npx tsc --noEmit && npx node --import tsx --test "src/**/*.test.ts"`
Expected: PASS — all tests green (v1 + v2).

- [ ] **Step 4: Balance shakedown** — create `engine/._wartest.mjs` (temporary), run it, inspect the trajectory, then delete it:

```javascript
import { run } from './src/realm/cli.ts';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-war-'));
const at = (...a) => ['--in', dir, ...a];
const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'realm.json'), 'utf8'));
run(at('init', '--name', 'Vael', '--seed', 'war-shakedown', '--calendar', 'Spring 1387'));
run(at('build', 'farm')); run(at('build', 'market')); run(at('recruit', '--strength', '25')); run(at('drill'));
console.log('t  treas man  S  U  P  thr army  q   war');
for (let t = 1; t <= 30; t++) {
  if (t === 12) run(at('recruit', '--strength', '20')); // reinforce mid-game
  const res = run(at('tick'));
  const r0 = read(); if (r0.event) { const o = r0.event.options?.[0]?.id; if (o) run(at('choose', '--option', o)); }
  const r = read(); const w = res.report.war;
  const wd = !w ? '' : w.event === 'announced' ? `! ${w.invader} (${w.force}) in ${w.strikesIn}` : `>> ${w.outcome.toUpperCase()} vs ${w.force}`;
  console.log(String(t).padStart(2), String(r.resources.treasury).padStart(5), String(r.resources.manpower).padStart(4),
    String(r.clocks.stability).padStart(2), String(r.clocks.unrest).padStart(2), String(r.clocks.prosperity).padStart(2),
    String(r.threat).padStart(3), String(r.army.strength).padStart(4), r.army.quality.toFixed(1), wd);
}
fs.rmSync(dir, { recursive: true, force: true });
```

Run: `npx tsx ._wartest.mjs` then `rm ._wartest.mjs`

Inspect for: (1) does threat climb and trigger invasions? (2) does an undefended/under-strength realm get sacked (treasury/holding/clocks hit)? (3) does maintaining an army repel invasions? (4) does warfare disrupt the v1 late-game stalemate? If the curves are degenerate (e.g., invasions never come, or are always unwinnable, or always trivial), tune the constants in `war.ts` (§3/§4 of the spec) and `resolve.ts` (sack fractions) and re-run. Constants are the only thing that changes — mechanics are locked by the tests.

- [ ] **Step 5: Update the play protocol docs** — in `engine/docs/realm-play.md`, add a "Warfare" subsection after the turn-loop section:

```markdown
## Warfare (v2)

An invasion `threat` rises every peacetime tick — faster as the realm grows richer
and larger. When it crosses a threshold, an invasion is **announced** with a 2-turn
warning; you can `recruit` and `drill` to prepare. When the countdown strikes, the
engine resolves one deterministic battle: `army.strength × army.quality + d20` vs
`invader.force + d20`. Win and you repel them (light casualties, veterancy). Lose and
the realm is sacked — looted treasury, a razed holding, a spike in unrest, a drop in
stability. A standing army costs upkeep every turn (more for higher quality), so peace
is not free: it is the price of not being sacked.

    realm recruit --strength N   # muster (manpower + gold), resolved on tick
    realm drill                  # train (gold -> +quality), resolved on tick

The digest surfaces war as a descriptor — "peace holds", "distant war-drums",
"<invader> is massing on the border", "the realm is under siege".
```

- [ ] **Step 6: Final typecheck, full suite, and commit**

```bash
npx tsc --noEmit
npx node --import tsx --test "src/**/*.test.ts"
git add src/realm/golden.test.ts docs/realm-play.md
git commit -m "test(realm): golden-replay war arc; docs: warfare protocol"
```

---

## Done criteria

- All v1 + v2 tests pass under `npx node --import tsx --test "src/**/*.test.ts"`.
- `npx tsc --noEmit` is clean.
- The balance shakedown shows warfare creating real guns-vs-butter tension (invasions arrive, an unprepared realm suffers, a prepared one survives) — disrupting the v1 late-game stalemate.
- `realm.json` from v1 still loads (defaults fill `army.quality`, `threat`, `war`).
