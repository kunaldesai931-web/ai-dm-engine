# Warband Overworld & Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn isolated battles into a campaign loop: travel a region, take combat contracts, fight using the existing battle system, get paid, pay weekly wages, and race a crisis clock to a final confrontation — all playable from the browser.

**Architecture:** Static world data in `engine/data/world.json`. Mutable campaign state gains an optional `overworld` block. A new pure `overworld.ts` module implements travel, contract generation/resolution, wages, and crisis progression. Contract/encounter/crisis battles reuse the existing `startBattle` + turn loop; an `activeBattle.context` tag lets the server credit rewards when the battle concludes. The browser UI shows an overworld view when no battle is active, and the existing battle grid when one is.

**Tech Stack:** TypeScript ES modules, Zod 4, Node test runner, existing combat/turn modules, vanilla-JS browser UI.

**Decisions locked (from design discussion):** browser overworld view; crisis = scaffolding (clock + intel + final-battle unlock); combat contract types only (bounty/raid/defense).

---

## Data vs State

**Static DATA** — `engine/data/world.json` (read-only definitions): regions → locations → adjacency/travel-days, danger levels, contract flavor.

**Mutable STATE** — new optional `overworld` block on `WarbandCampaignState`: current location, provisions, available contracts, active contract, crisis progress, last payday. `meta.day` and `meta.gold` already exist.

---

## Starter world (`engine/data/world.json`)

```json
{
  "regions": [
    {
      "id": "border-marches",
      "name": "The Border Marches",
      "danger": 2,
      "locations": [
        { "id": "ironhold", "name": "Ironhold", "type": "town", "start": true },
        { "id": "redford", "name": "Redford", "type": "town" },
        { "id": "stonewatch", "name": "Stonewatch", "type": "town" },
        { "id": "old-mill", "name": "The Old Mill", "type": "landmark" }
      ],
      "routes": [
        { "from": "ironhold", "to": "redford", "days": 2 },
        { "from": "ironhold", "to": "stonewatch", "days": 3 },
        { "from": "redford", "to": "old-mill", "days": 1 },
        { "from": "stonewatch", "to": "old-mill", "days": 2 }
      ]
    }
  ],
  "crisis": {
    "name": "The Ironblood Warlord unites the border clans",
    "clockSegments": 8,
    "intelNeeded": 5,
    "finalLocationId": "old-mill",
    "finalEnemySpec": "warlord:bandit-leader,guard1:raider,guard2:raider"
  },
  "contractTemplates": [
    { "type": "bounty", "title": "Bounty: {loc} raiders", "enemyPool": ["bandit", "raider"], "size": 2, "gold": 40, "intel": 1 },
    { "type": "raid", "title": "Raid the camp near {loc}", "enemyPool": ["raider", "archer", "brute"], "size": 3, "gold": 70, "intel": 2 },
    { "type": "defense", "title": "Defend {loc} from a war band", "enemyPool": ["bandit", "bandit", "archer"], "size": 3, "gold": 60, "intel": 1 }
  ]
}
```

Routes are bidirectional (treat `{from,to}` as undirected when computing neighbors).

---

## File Map

| File | Change |
|---|---|
| `engine/data/world.json` | NEW — region, locations, routes, crisis, contract templates |
| `engine/src/warband/schema.ts` | EDIT — add `Contract`, `Crisis`, `Overworld` schemas; `overworld?` on state; `context?` on activeBattle |
| `engine/src/warband/overworld.ts` | NEW — init, contracts, travel, wages, crisis, contract resolution |
| `engine/src/warband/overworld.test.ts` | NEW — overworld engine tests |
| `engine/src/warband/cli.ts` | EDIT — overworld subcommands + init on campaign create |
| `engine/src/warband/server.ts` | EDIT — overworld commands + reward-on-conclude wiring |
| `engine/web/index.html` | EDIT — overworld view (map, contracts, travel, crisis) when no battle |

---

## Task 1: World data file

**Files:** Create `engine/data/world.json`

- [ ] **Step 1** — Create `engine/data/world.json` with the exact content from the "Starter world" section above.
- [ ] **Step 2** — Sanity check it parses: `cd engine && node -e "JSON.parse(require('fs').readFileSync('data/world.json','utf8')); console.log('ok')"`
- [ ] **Step 3** — Commit: `git add engine/data/world.json && git commit -m "feat(warband): starter world data — Border Marches region + crisis"`

---

## Task 2: Schema extensions

**Files:** `engine/src/warband/schema.ts`, `engine/src/warband/schema.test.ts`

- [ ] **Step 1: Add failing tests** to the bottom of `schema.test.ts`:

```typescript
import { parseWarbandCampaignState as parseWB } from './schema.js';

function stateWithOverworld(): any {
  return {
    meta: { campaign: 'ow', day: 1, gold: 100 },
    rng: { seed: 's', cursor: 0 },
    protagonist: {
      id: 'protagonist', name: 'A', role: 'protagonist', backgroundId: 'sellsword',
      level: 1, xp: 0,
      stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
      traits: [], perks: [], injuries: [], gear: [], wages: 0, morale: 10,
    },
    companions: {}, hirelings: {},
    overworld: {
      currentLocation: 'ironhold', provisions: 20,
      contracts: [
        { id: 'c1', type: 'bounty', title: 'Bounty', locationId: 'redford', enemySpec: 'b1:bandit', goldReward: 40, intelReward: 1, expiresDay: 10 },
      ],
      activeContractId: null,
      crisis: { name: 'Warlord', clockFilled: 0, clockSegments: 8, intel: 0, intelNeeded: 5, unlocked: false, resolved: false, finalLocationId: 'old-mill' },
      lastPaydayDay: 0,
    },
  };
}

test('parseWarbandCampaignState accepts an overworld block', () => {
  const s = parseWB(stateWithOverworld());
  assert.equal(s.overworld!.currentLocation, 'ironhold');
  assert.equal(s.overworld!.contracts.length, 1);
});

test('parseWarbandCampaignState still accepts state without overworld (backward compat)', () => {
  const s = stateWithOverworld(); delete s.overworld;
  const parsed = parseWB(s);
  assert.equal(parsed.overworld, undefined);
});

test('parseWarbandCampaignState rejects a contract with negative gold reward', () => {
  const s = stateWithOverworld(); s.overworld.contracts[0].goldReward = -1;
  assert.throws(() => parseWB(s), EngineError);
});
```

- [ ] **Step 2** — Run, confirm fail.

- [ ] **Step 3: Implement schema** in `schema.ts`. Add these schemas (before `WarbandCampaignState`):

```typescript
const Contract = z.object({
  id: z.string(),
  type: z.enum(['bounty', 'raid', 'defense']),
  title: z.string(),
  locationId: z.string(),
  enemySpec: z.string(),
  goldReward: z.number().int().min(0),
  intelReward: z.number().int().min(0),
  expiresDay: z.number().int().min(1),
});

const Crisis = z.object({
  name: z.string(),
  clockFilled: z.number().int().min(0),
  clockSegments: z.number().int().min(1),
  intel: z.number().int().min(0),
  intelNeeded: z.number().int().min(1),
  unlocked: z.boolean(),
  resolved: z.boolean(),
  finalLocationId: z.string(),
});

const Overworld = z.object({
  currentLocation: z.string(),
  provisions: z.number().int().min(0),
  contracts: z.array(Contract),
  activeContractId: z.string().nullable(),
  crisis: Crisis,
  lastPaydayDay: z.number().int().min(0),
});
```

Add `overworld: Overworld.optional(),` to the `WarbandCampaignState` object.

Add an optional `context` to the `activeBattle` sub-schema (find the `activeBattle: z.object({...}).optional()` in WarbandCampaignState):
```typescript
    context: z.object({
      kind: z.enum(['skirmish', 'contract', 'encounter', 'crisis']),
      contractId: z.string().optional(),
    }).optional(),
```

Export the inferred types:
```typescript
export type TContract = z.infer<typeof Contract>;
export type TOverworld = z.infer<typeof Overworld>;
```

- [ ] **Step 4** — Run schema tests (all pass) + full suite (`npm test`). The `context` field is optional so existing battles are unaffected.

- [ ] **Step 5** — Commit: `git add engine/src/warband/schema.ts engine/src/warband/schema.test.ts && git commit -m "feat(warband): schema — overworld, contracts, crisis, battle context"`

---

## Task 3: Overworld engine

**Files:** `engine/src/warband/overworld.ts`, `engine/src/warband/overworld.test.ts`

This is the heart. Implement pure functions. Read the test scenarios — they pin behavior.

- [ ] **Step 1: Write `overworld.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initOverworld, neighbors, travel, takeContract, resolveContractWin, payWages,
  craftStartingState, type WorldData,
} from './overworld.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';

const WORLD: WorldData = {
  regions: [{
    id: 'r', name: 'Region', danger: 2,
    locations: [
      { id: 'ironhold', name: 'Ironhold', type: 'town', start: true },
      { id: 'redford', name: 'Redford', type: 'town' },
      { id: 'old-mill', name: 'Old Mill', type: 'landmark' },
    ],
    routes: [
      { from: 'ironhold', to: 'redford', days: 2 },
      { from: 'redford', to: 'old-mill', days: 1 },
    ],
  }],
  crisis: { name: 'Warlord', clockSegments: 8, intelNeeded: 5, finalLocationId: 'old-mill', finalEnemySpec: 'w:bandit-leader' },
  contractTemplates: [
    { type: 'bounty', title: 'Bounty: {loc}', enemyPool: ['bandit'], size: 1, gold: 40, intel: 1 },
  ],
};

function baseState(): TWarbandCampaignState {
  const mk = (id: string, role: 'protagonist' | 'hireling', wage: number): TRosterMember => ({
    id, name: id, role, backgroundId: 'sellsword', level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: wage, morale: 10,
  });
  return {
    meta: { campaign: 't', day: 1, gold: 100 },
    rng: { seed: 'ow-seed', cursor: 0 },
    protagonist: mk('protagonist', 'protagonist', 0),
    companions: {},
    hirelings: { h1: mk('h1', 'hireling', 5) },
  };
}

test('initOverworld sets the start location and seeds contracts + crisis', () => {
  const s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  assert.equal(s.overworld!.currentLocation, 'ironhold');
  assert.ok(s.overworld!.provisions > 0);
  assert.equal(s.overworld!.crisis.name, 'Warlord');
  assert.equal(s.overworld!.crisis.clockSegments, 8);
  assert.ok(Array.isArray(s.overworld!.contracts));
});

test('neighbors returns reachable locations with day costs (undirected)', () => {
  const ns = neighbors(WORLD, 'redford');
  const ids = ns.map((n) => n.id).sort();
  assert.deepEqual(ids, ['ironhold', 'old-mill']);
  assert.equal(ns.find((n) => n.id === 'ironhold')!.days, 2);
});

test('travel advances the day by the route cost and moves location', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  const day0 = s.meta.day;
  const r = travel(s, WORLD, 'redford', makeRoller(s.rng));
  assert.equal(r.state.overworld!.currentLocation, 'redford');
  assert.equal(r.state.meta.day, day0 + 2);
});

test('travel to a non-neighbor throws', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  assert.throws(() => travel(s, WORLD, 'old-mill', makeRoller(s.rng))); // not adjacent to ironhold
});

test('travel deducts provisions', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  const before = s.overworld!.provisions;
  const r = travel(s, WORLD, 'redford', makeRoller(s.rng));
  assert.ok(r.state.overworld!.provisions < before);
});

test('takeContract sets the active contract', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  // inject a known contract
  s.overworld!.contracts = [{ id: 'c1', type: 'bounty', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 40, intelReward: 1, expiresDay: 99 }];
  const r = takeContract(s, 'c1');
  assert.equal(r.overworld!.activeContractId, 'c1');
});

test('resolveContractWin pays gold, adds intel, clears active contract', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.overworld!.contracts = [{ id: 'c1', type: 'bounty', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 40, intelReward: 2, expiresDay: 99 }];
  s.overworld!.activeContractId = 'c1';
  const goldBefore = s.meta.gold;
  const r = resolveContractWin(s);
  assert.equal(r.meta.gold, goldBefore + 40);
  assert.equal(r.overworld!.crisis.intel, 2);
  assert.equal(r.overworld!.activeContractId, null);
  assert.equal(r.overworld!.contracts.find((c) => c.id === 'c1'), undefined); // consumed
});

test('resolveContractWin unlocks the crisis when intel threshold reached', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.overworld!.crisis.intel = 4; s.overworld!.crisis.intelNeeded = 5;
  s.overworld!.contracts = [{ id: 'c1', type: 'raid', title: 'T', locationId: 'ironhold', enemySpec: 'b:bandit', goldReward: 10, intelReward: 2, expiresDay: 99 }];
  s.overworld!.activeContractId = 'c1';
  const r = resolveContractWin(s);
  assert.ok(r.overworld!.crisis.intel >= 5);
  assert.equal(r.overworld!.crisis.unlocked, true);
});

test('payWages deducts hireling wages weekly and skips when not due', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.meta.day = 8; s.overworld!.lastPaydayDay = 1; // 7 days elapsed → due
  const goldBefore = s.meta.gold;
  const r = payWages(s);
  assert.equal(r.state.meta.gold, goldBefore - 5); // one hireling, wage 5
  assert.equal(r.paid, true);
  // not due now
  const r2 = payWages(r.state);
  assert.equal(r2.paid, false);
});

test('payWages causes desertion when gold cannot cover wages', () => {
  let s = initOverworld(baseState(), WORLD, makeRoller(baseState().rng));
  s.meta.day = 8; s.overworld!.lastPaydayDay = 1; s.meta.gold = 2; // can't afford wage 5
  const r = payWages(s);
  assert.equal(Object.keys(r.state.hirelings).length, 0); // deserted
  assert.ok(r.deserted.includes('h1'));
});
```

- [ ] **Step 2** — Run, confirm fail.

- [ ] **Step 3: Implement `overworld.ts`.** Required exports + behavior:

```typescript
import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TContract, TOverworld } from './schema.js';
import { EngineError } from '../core/errors.js';

export interface WorldLocation { id: string; name: string; type: 'town' | 'landmark'; start?: boolean; }
export interface WorldRoute { from: string; to: string; days: number; }
export interface WorldRegion { id: string; name: string; danger: number; locations: WorldLocation[]; routes: WorldRoute[]; }
export interface ContractTemplate { type: 'bounty' | 'raid' | 'defense'; title: string; enemyPool: string[]; size: number; gold: number; intel: number; }
export interface WorldData {
  regions: WorldRegion[];
  crisis: { name: string; clockSegments: number; intelNeeded: number; finalLocationId: string; finalEnemySpec: string };
  contractTemplates: ContractTemplate[];
}
```

Functions:
- `allLocations(world)` / `findLocation(world, id)` — helpers across regions.
- `neighbors(world, locationId): Array<{id, name, days}>` — undirected: a route matches if `from===id` or `to===id`; return the other endpoint + days. Dedup.
- `startLocation(world)` — the location with `start: true` (fallback: first location).
- `craftStartingState(...)` — (optional helper) not required if initOverworld covers it.
- `initOverworld(state, world, roller): state` — sets `overworld` block: currentLocation = startLocation, provisions = 20, contracts = `generateContracts(world, startLoc, roller, day)`, activeContractId null, crisis from world.crisis (clockFilled 0, intel 0, unlocked false, resolved false), lastPaydayDay = state.meta.day.
- `generateContracts(world, locationId, roller, day): TContract[]` — for each template, produce a contract: pick a destination location (a neighbor or the location itself), build enemySpec by sampling `size` types from `enemyPool` as `e1:type,e2:type,...`, id unique (`ct-${day}-${i}-${roller.die(9999)}`), title with `{loc}` replaced, expiresDay = day + 10. Return ~3 contracts.
- `travel(state, world, destId, roller): { state, encounter: boolean }` — validate destId is a neighbor of currentLocation (else EngineError). Compute days from the route. New day = meta.day + days. Deduct provisions by `days` (floor at 0). Advance crisis clock: `clockFilled = min(clockSegments, clockFilled + Math.floor(days/2) )` (roughly: time pressure). Set currentLocation = destId. Roll random encounter: chance = region.danger * 10% per trip (e.g. `roller.die(100) <= region.danger*10`). Return encounter flag (the SERVER decides to start a battle; overworld.ts does not call startBattle to avoid a cycle). Also regenerate contracts at the new town if it's a town with none for this location.
- `takeContract(state, contractId): state` — set activeContractId (validate the contract exists). Throw if not found.
- `resolveContractWin(state): state` — look up activeContractId; add goldReward to meta.gold; add intelReward to crisis.intel; remove the contract from contracts; clear activeContractId; if `crisis.intel >= crisis.intelNeeded` set `crisis.unlocked = true`. (No-op safely if no active contract.)
- `resolveContractLoss(state): state` — clear activeContractId (contract failed; keep it simple — no gold penalty in v1, or a small rep placeholder). Keep the contract removed or expired. v1: just clear active, leave contract available.
- `payWages(state): { state, paid: boolean, deserted: string[] }` — if `meta.day - overworld.lastPaydayDay < 7` return `{state, paid:false, deserted:[]}`. Else compute total hireling wages. If gold >= total: deduct, set lastPaydayDay = meta.day, return paid:true. If gold < total: hirelings desert (remove all hirelings that can't be paid — simplest: remove ALL hirelings), set lastPaydayDay = meta.day, return paid:true with deserted ids. (v1 simple: can't make payroll → all hirelings leave.)
- `advanceCrisisClock(state, amount): state` — clamp at clockSegments.
- `craftFinalBattleSpec(world): string` — return `world.crisis.finalEnemySpec`.

All functions PURE (return new state, no mutation). Validate with EngineError on bad input (unknown location, non-neighbor travel, missing contract).

- [ ] **Step 4** — Run overworld tests (all pass) + full suite.

- [ ] **Step 5** — Commit: `git add engine/src/warband/overworld.ts engine/src/warband/overworld.test.ts && git commit -m "feat(warband): overworld engine — travel, contracts, wages, crisis"`

---

## Task 4: Server wiring — overworld commands + reward-on-conclude

**Files:** `engine/src/warband/server.ts`

Read server.ts. It loads `world.json` via `loadData`, and `runCommand` handles battle commands. Add overworld command handling and contract-reward wiring.

- [ ] **Step 1** — Imports: `import * as overworld from './overworld.js';` and the contract-resolution functions. Load world once: `const WORLD = loadData<overworld.WorldData>('world.json');` near DATA_DIR (or load per-call inside the cases).

- [ ] **Step 2** — Add a GET endpoint `GET /api/warband/world` returning the static world data (the UI needs locations/routes to render the map).

- [ ] **Step 3** — Add these `runCommand` cases (player not in battle):
  - `ow-status` → return `{ op, overworld: state.overworld, neighbors: overworld.neighbors(WORLD, state.overworld.currentLocation) }`.
  - `travel` (args: `{ to }`) → `const r = overworld.travel(state, WORLD, String(args.to), roller); state = r.state;` then if `r.encounter`, start a battle: generate a small enemy band by region danger (e.g. `"e1:bandit,e2:bandit"`), `state = startBattle(state, spawns, roller)` with `activeBattle.context = { kind: 'encounter' }`, run leading enemy turns. Also run `payWages` after travel and include the result in the response. Return overworld + encounter flag + log.
  - `take-contract` (args `{ contractId }`) → `state = overworld.takeContract(state, ...)`. Return overworld.
  - `start-contract` → require an active contract AND that `currentLocation === contract.locationId`. Build spawns from the contract's `enemySpec` (reuse the enemy-spec parsing already in the `start` case — factor it into a helper `spawnsFromSpec(spec)`), `state = startBattle(...)`, set `activeBattle.context = { kind: 'contract', contractId }`, run leading enemy turns + maybeConclude. Return.
  - `start-crisis` → require `crisis.unlocked && !crisis.resolved` and `currentLocation === crisis.finalLocationId`. Start battle from `world.crisis.finalEnemySpec`, context `{ kind: 'crisis' }`.
  - `pay-wages` → `const r = overworld.payWages(state); state = r.state;` return paid/deserted.

- [ ] **Step 4** — **Reward-on-conclude:** update `maybeConclude` (or the attack/end-turn cases) so that when a battle finishes, the `activeBattle.context` is read BEFORE concluding, and after conclude:
  - context.kind === 'contract' && outcome === 'player_win' → `state = overworld.resolveContractWin(state)` (credit gold/intel). On loss → `overworld.resolveContractLoss(state)`.
  - context.kind === 'crisis' && win → mark `state.overworld.crisis.resolved = true` (campaign won!). 
  - Include the reward info / `campaignWon: true` in the response `extra`.
  Implementation note: capture `const ctx = state.activeBattle?.context;` before `concludeBattle`, then branch after. Make sure `startBattle` is given the context — since `startBattle` doesn't set context, set it immediately after: `state = { ...state, activeBattle: { ...state.activeBattle!, context: {...} } }`.

- [ ] **Step 5** — Smoke test on PORT 4507: create a campaign (overworld auto-inits — see Task 5), `ow-status`, `take-contract`, `start-contract`, play the battle to a win, confirm gold increased and intel advanced. Kill server, delete throwaway campaign.

- [ ] **Step 6** — `npm test` (all pass), commit: `git add engine/src/warband/server.ts && git commit -m "feat(warband): server overworld commands + contract/crisis reward wiring"`

---

## Task 5: CLI — overworld commands + init on campaign create

**Files:** `engine/src/warband/cli.ts`

- [ ] **Step 1** — On `campaign create`, after building the initial state, initialize the overworld: load `world.json`, call `overworld.initOverworld(state, world, roller)` before saving. So every new campaign starts in the world. (Import `* as overworld from './overworld.js'`.)

- [ ] **Step 2** — Add CLI subcommands mirroring the server: `overworld status`, `overworld travel <to>`, `overworld contracts` (list), `overworld take <contractId>`, `overworld start-contract`, `overworld pay-wages`. Each loads world.json, runs the overworld fn, saves, prints JSON. For `start-contract`/encounters that begin a battle, reuse the combat flow (startBattle + runEnemyTurns).

- [ ] **Step 3** — `npm test && npm run typecheck` (only the known TS2367 acceptable). Commit: `git add engine/src/warband/cli.ts && git commit -m "feat(warband): CLI overworld commands + init on campaign create"`

---

## Task 6: Browser overworld view

**Files:** `engine/web/index.html`

When there is no `activeBattle`, render an overworld panel instead of "No active battle". When a battle is active, the existing grid shows (unchanged).

- [ ] **Step 1** — On load, also `fetch('/api/warband/world')` and keep it. Add an `overworld` render path:
  - **Header strip:** current location name, Day N, Gold, Provisions, Crisis: intel X/Y, clock F/S, plus "⚠ FINAL BATTLE AVAILABLE" when `crisis.unlocked`.
  - **Travel:** list `neighbors` (from world routes) as buttons "Travel to {name} ({days}d)" → POST `travel`.
  - **Contracts board:** list `overworld.contracts` with title, location, reward (gold + intel), and a **Take** button (POST `take-contract`). If a contract is active and you're at its location, show a **Start Contract** button (POST `start-contract`).
  - **Wages:** a **Pay Wages** button (POST `pay-wages`) showing result.
  - **Crisis:** when unlocked and at the final location, a **Confront the Warlord** button (POST `start-crisis`).
- [ ] **Step 2** — Extend the `command()` handler to surface overworld responses (gold/intel changes, desertions, "campaign won"). After any command, re-render: if `state.activeBattle` → battle grid; else → overworld panel.
- [ ] **Step 3** — Manual check in browser: create campaign → see overworld → take a bounty → travel to its location → Start Contract → win the battle → gold/intel go up → back to overworld. (No automated test for HTML; verify by playing.)
- [ ] **Step 4** — Commit: `git add engine/web/index.html && git commit -m "feat(warband): browser overworld view — travel, contracts, crisis"`

---

## Task 7: Final integration

- [ ] **Step 1** — `cd engine && npm test && npm run typecheck` — all pass; only the known TS2367.
- [ ] **Step 2** — Full manual playthrough in the browser: take contracts, fight, earn intel, hit the threshold, unlock + win (or lose) the crisis battle. Confirm wages deduct and unpaid hirelings desert.
- [ ] **Step 3** — `git push`.

---

## Self-Review

**Coverage of Sub-project 3 scope:**
- ✓ Hybrid overworld: fixed region/locations (world.json) + procedurally generated contracts (generateContracts)
- ✓ Travel: day cost, provisions, random encounters → battle
- ✓ Campaign loop: town → contract → travel → battle → reward → wages
- ✓ Combat contracts (bounty/raid/defense) hook into the existing battle system
- ✓ Crisis scaffolding: clock + intel + unlock + final battle → win condition
- ✓ Wages: weekly payday, desertion on non-payment
- ✓ Browser overworld view (locked decision)

**Deferred (flagged):** factions & trade (Sub-project 4); escort/investigation non-combat contracts; multiple regions; provisions-starvation consequences; richer crisis narrative.

**Integration risk to watch:** the `activeBattle.context` tag must be set right after `startBattle` for contract/encounter/crisis battles, and read BEFORE `concludeBattle` drops the battle, so rewards credit correctly. Tasks 4 calls this out explicitly.

**Type consistency:** `WorldData`/`WorldRegion`/`WorldRoute`/`ContractTemplate` defined in overworld.ts; `TContract`/`TOverworld` inferred in schema.ts; server/cli import `* as overworld`. `resolveContractWin`/`payWages`/`travel` return shapes pinned by the tests in Task 3.
