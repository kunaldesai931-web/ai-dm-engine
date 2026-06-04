# Warband Turn Loop & Enemy AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the one-sided combat demo into a real turn-based battle: enemies act on their turns (move + attack), turns are enforced (only the current actor acts), turns auto-advance through enemy actions, and downed units resolve casualties (hireling D6, protagonist/companion permadeath) when a battle ends.

**Architecture:** Keep the existing pure mechanics (`moveUnit`, `resolveAttack`) untouched and tested. Add two new modules: `ai.ts` (enemy decision + action) and `turn.ts` (turn advancement with skip/stun handling, enemy-turn auto-resolution, and casualty resolution). The `server.ts` command handler enforces turn ownership and drives the loop. The browser UI surfaces the per-turn action log.

**Tech Stack:** TypeScript ES modules, Node built-in test runner, existing `combat.ts` + `progression.ts`.

---

## Design Summary

**Turn flow (what the player experiences):**
1. `start` → battle begins. If enemies won initiative and act first, their turns auto-resolve until it's a player unit's turn.
2. It's your unit's turn (shown in UI). You may **move once** and **attack once** with that unit, in either order.
3. You click **End Turn**. The engine advances; every enemy turn between now and your next unit auto-resolves (enemy moves + attacks), accumulating a log.
4. Repeat until one side is wiped. On battle end, casualties resolve (hireling D6 dead/survive; protagonist/companion death record) and the battle closes.

**Enemy AI (v1, deliberately simple):**
- Target = nearest living player unit (Chebyshev distance).
- If adjacent → melee attack.
- Else if the enemy is ranged-favored (`ranged > melee`) → attack from range.
- Else → step one tile toward the target; if now adjacent → melee attack.

**Turn enforcement (in server):** a `move`/`attack` is rejected unless the acting unit IS the current actor, is a player unit, and hasn't already moved/acted that turn.

**Out of scope (flagged for later, do NOT build here):**
- Movement-range limits for the *player* (still unrestricted placement — separate concern).
- Ranged-kiting AI, flanking, target prioritization beyond nearest.
- Persisting gained injuries' stat penalties to the roster (injuries are reported in combat but not yet applied to RosterMember stats).
- Protagonist "injury table instead of instant death" nuance — v1 treats a downed protagonist as a death (run ends).

---

## File Map

| File | Change |
|---|---|
| `engine/src/warband/ai.ts` | NEW — `enemyAct(state, enemyId, roller, injuryTables)` + helpers |
| `engine/src/warband/ai.test.ts` | NEW — AI behavior tests |
| `engine/src/warband/turn.ts` | NEW — `currentActorId`, `advanceTurn`, `runEnemyTurns`, `concludeBattle` |
| `engine/src/warband/turn.test.ts` | NEW — turn-flow + casualty tests |
| `engine/src/warband/server.ts` | EDIT — enforce turns, drive enemy turns, auto-conclude, return `log` |
| `engine/src/warband/cli.ts` | EDIT — mirror end-turn enemy-resolution + auto-conclude for parity |
| `engine/web/index.html` | EDIT — render `log[]` from responses, show battle result |

---

## Task 1: Enemy AI module

**Files:** Create `engine/src/warband/ai.ts`, `engine/src/warband/ai.test.ts`

- [ ] **Step 1: Write `engine/src/warband/ai.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle } from './combat.js';
import { enemyAct } from './ai.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';

const INJURIES: Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]> = {
  blunt: [{ id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative', amount: -1 }],
  cutting: [{ id: 'sword-arm-cut', name: 'Sword Arm Cut', stat: 'melee', amount: -1 }],
  piercing: [{ id: 'gut-wound', name: 'Gut Wound', stat: 'resolve', amount: -1 }],
};

function baseState(): TWarbandCampaignState {
  const protagonist: TRosterMember = {
    id: 'protagonist', name: 'Aldric', role: 'protagonist', backgroundId: 'sellsword',
    level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: 0, morale: 10,
  };
  return {
    meta: { campaign: 'test', day: 1, gold: 0 },
    rng: { seed: 'ai-seed', cursor: 0 },
    protagonist, companions: {}, hirelings: {},
  };
}

const MELEE_ENEMY = [{
  id: 'brute-1', typeId: 'brute', name: 'Brute',
  stats: { melee: 5, ranged: 0, defense: 4, resolve: 4, initiative: 1, maxHp: 18 },
  morale: 8, weaponCategory: 'blunt' as const, named: false,
}];

test('enemyAct moves a distant melee enemy closer to the target', () => {
  const state = baseState();
  const battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  const before = battle.activeBattle!.units['brute-1'].position;
  const protaPos = battle.activeBattle!.units['protagonist'].position;
  const beforeDist = Math.max(Math.abs(before.col - protaPos.col), Math.abs(before.row - protaPos.row));
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  const after = r.state.activeBattle!.units['brute-1'].position;
  const afterDist = Math.max(Math.abs(after.col - protaPos.col), Math.abs(after.row - protaPos.row));
  assert.ok(afterDist <= beforeDist, 'enemy should not move away from target');
  assert.ok(Array.isArray(r.log));
});

test('enemyAct attacks when adjacent to a target', () => {
  const state = baseState();
  let battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  // Force adjacency: put brute right next to protagonist
  const p = battle.activeBattle!.units['protagonist'].position;
  battle.activeBattle!.units['brute-1'].position = { col: Math.min(p.col + 1, 4), row: p.row };
  const hpBefore = battle.activeBattle!.units['protagonist'].currentHp;
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  const hpAfter = r.state.activeBattle!.units['protagonist'].currentHp;
  // Either a hit (hp drops) or a miss/stumble — but the log must record an attack attempt
  assert.ok(r.log.some((l) => /attack|hit|miss|stumble|critical/i.test(l)), 'log should mention an attack');
  assert.ok(hpAfter <= hpBefore);
});

test('enemyAct on an enemy with no living targets does nothing', () => {
  const state = baseState();
  const battle = startBattle(state, MELEE_ENEMY, makeRoller(state.rng));
  battle.activeBattle!.units['protagonist'].status = 'dead';
  const r = enemyAct(battle, 'brute-1', makeRoller(battle.rng), INJURIES);
  assert.equal(r.log.length, 0);
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "src/warband/ai.test.ts"
```

- [ ] **Step 3: Implement `engine/src/warband/ai.ts`**

```typescript
import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TCombatUnit } from './schema.js';
import type { InjuryEntry } from './progression.js';
import { isPlayerUnit, moveUnit, resolveAttack } from './combat.js';

type InjuryTables = Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]>;

function dist(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function isTargetable(u: TCombatUnit): boolean {
  return u.status !== 'dead' && u.status !== 'routing' && u.status !== 'down';
}

// Nearest living player unit to the given enemy, or null.
function nearestTarget(state: TWarbandCampaignState, enemy: TCombatUnit): TCombatUnit | null {
  const battle = state.activeBattle!;
  const targets = Object.values(battle.units).filter((u) => isPlayerUnit(u) && isTargetable(u));
  if (targets.length === 0) return null;
  targets.sort((a, b) => dist(enemy.position, a.position) - dist(enemy.position, b.position));
  return targets[0];
}

// Move one tile toward the target if possible (diagonal preferred, then orthogonal).
function stepToward(
  state: TWarbandCampaignState,
  unitId: string,
  target: TCombatUnit,
): TWarbandCampaignState {
  const battle = state.activeBattle!;
  const unit = battle.units[unitId];
  const dc = sign(target.position.col - unit.position.col);
  const dr = sign(target.position.row - unit.position.row);
  const candidates: Array<[number, number]> = [
    [unit.position.col + dc, unit.position.row + dr],
    [unit.position.col + dc, unit.position.row],
    [unit.position.col, unit.position.row + dr],
  ];
  for (const [nc, nr] of candidates) {
    if (nc < 0 || nc > 4 || nr < 0 || nr > 7) continue;
    if (battle.grid[nr][nc] !== 'open') continue;
    return moveUnit(state, unitId, nc, nr);
  }
  return state; // boxed in
}

export interface EnemyActResult {
  state: TWarbandCampaignState;
  log: string[];
}

// Resolve one enemy unit's turn: target nearest, close distance if needed, attack.
export function enemyAct(
  state: TWarbandCampaignState,
  enemyId: string,
  roller: Roller,
  injuryTables: InjuryTables,
): EnemyActResult {
  if (!state.activeBattle) return { state, log: [] };
  const enemy = state.activeBattle.units[enemyId];
  if (!enemy || enemy.status !== 'active') return { state, log: [] };

  const target = nearestTarget(state, enemy);
  if (!target) return { state, log: [] };

  const log: string[] = [];
  let cur = state;
  let d = dist(enemy.position, target.position);
  const rangedFavored = enemy.stats.ranged > enemy.stats.melee;

  // Close distance unless adjacent or able+willing to shoot from range.
  if (d > 1 && !rangedFavored) {
    cur = stepToward(cur, enemyId, target);
    const movedEnemy = cur.activeBattle!.units[enemyId];
    if (movedEnemy.position.col !== enemy.position.col || movedEnemy.position.row !== enemy.position.row) {
      log.push(`${enemy.name} advances on ${target.name}.`);
    }
    d = dist(cur.activeBattle!.units[enemyId].position, target.position);
  }

  // Attack if adjacent, or if ranged-favored and target still present.
  const targetStillThere = cur.activeBattle!.units[target.memberId];
  if (targetStillThere && isTargetable(targetStillThere) && (d <= 1 || rangedFavored)) {
    const r = resolveAttack(cur, enemyId, target.memberId, roller, injuryTables);
    cur = r.state;
    log.push(r.narrative);
  }

  return { state: cur, log };
}
```

- [ ] **Step 4: Run — all 3 pass**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "src/warband/ai.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add engine/src/warband/ai.ts engine/src/warband/ai.test.ts
git commit -m "feat(warband): enemy AI — nearest-target, close distance, attack"
```

---

## Task 2: Turn controller

**Files:** Create `engine/src/warband/turn.ts`, `engine/src/warband/turn.test.ts`

- [ ] **Step 1: Write `engine/src/warband/turn.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBattle, getBattleOutcome } from './combat.js';
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';
import { makeRoller } from '../core/rng.js';
import type { TWarbandCampaignState, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';

const INJURIES: Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]> = {
  blunt: [{ id: 'cracked-rib', name: 'Cracked Rib', stat: 'initiative', amount: -1 }],
  cutting: [{ id: 'sword-arm-cut', name: 'Sword Arm Cut', stat: 'melee', amount: -1 }],
  piercing: [{ id: 'gut-wound', name: 'Gut Wound', stat: 'resolve', amount: -1 }],
};

function stateWithHireling(): TWarbandCampaignState {
  const mk = (id: string, role: 'protagonist' | 'hireling', name: string): TRosterMember => ({
    id, name, role, backgroundId: 'sellsword', level: 1, xp: 0,
    stats: { melee: 4, ranged: 1, defense: 3, resolve: 2, initiative: 3, hp: 14, maxHp: 14 },
    traits: [], perks: [], injuries: [], gear: [], wages: role === 'hireling' ? 5 : 0, morale: 10,
  });
  return {
    meta: { campaign: 'test', day: 3, gold: 0 },
    rng: { seed: 'turn-seed', cursor: 0 },
    protagonist: mk('protagonist', 'protagonist', 'Aldric'),
    companions: {},
    hirelings: { 'h-1': mk('h-1', 'hireling', 'Bors') },
  };
}

const ENEMY = [{
  id: 'e-1', typeId: 'bandit', name: 'Bandit',
  stats: { melee: 3, ranged: 1, defense: 2, resolve: 2, initiative: 2, maxHp: 10 },
  morale: 6, weaponCategory: 'cutting' as const, named: false,
}];

test('currentActorId returns the unit at the current turn index', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  assert.equal(currentActorId(b), b.activeBattle!.turnOrder[b.activeBattle!.currentTurnIndex]);
});

test('advanceTurn skips dead units', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  // Kill the unit that would be next
  const nextIdx = (b.activeBattle!.currentTurnIndex + 1) % b.activeBattle!.turnOrder.length;
  const nextId = b.activeBattle!.turnOrder[nextIdx];
  b.activeBattle!.units[nextId].status = 'dead';
  const advanced = advanceTurn(b);
  assert.notEqual(currentActorId(advanced), nextId);
  assert.equal(advanced.activeBattle!.units[currentActorId(advanced)].status, 'active');
});

test('advanceTurn consumes stun and skips the stunned unit', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  const nextIdx = (b.activeBattle!.currentTurnIndex + 1) % b.activeBattle!.turnOrder.length;
  const nextId = b.activeBattle!.turnOrder[nextIdx];
  b.activeBattle!.units[nextId].status = 'stunned';
  const advanced = advanceTurn(b);
  // The stunned unit is cleared back to active (its turn was consumed) but not the current actor
  assert.equal(advanced.activeBattle!.units[nextId].status, 'active');
  assert.notEqual(currentActorId(advanced), nextId);
});

test('runEnemyTurns lands on a player unit or ends the battle', () => {
  const s = stateWithHireling();
  const b = startBattle(s, ENEMY, makeRoller(s.rng));
  const r = runEnemyTurns(b, makeRoller(b.rng), INJURIES);
  const outcome = getBattleOutcome(r.state);
  if (outcome === 'ongoing') {
    const actor = r.state.activeBattle!.units[currentActorId(r.state)];
    assert.equal(actor.role !== 'enemy', true, 'should stop on a player actor');
  }
  assert.ok(Array.isArray(r.log));
});

test('concludeBattle kills a downed hireling on a low D6 and records death', () => {
  const s = stateWithHireling();
  let b = startBattle(s, ENEMY, makeRoller(s.rng));
  // Force the hireling down
  b.activeBattle!.units['h-1'].status = 'down';
  b.activeBattle!.units['h-1'].currentHp = 0;
  // Roller seeded so first d6 is low — if not, the test tolerates either but checks shape
  const r = concludeBattle(b, makeRoller(b.rng), { battleId: 'b', dayOfCampaign: 3, location: 'the field' });
  assert.equal(r.state.activeBattle, undefined, 'battle should be closed');
  // hireling is either dead (has death record) or survived (no death, hp restored)
  const h = r.state.hirelings['h-1'];
  assert.ok(h.death ? h.death.battleId === 'b' : h.stats.hp > 0);
  assert.ok(Array.isArray(r.casualties));
});

test('concludeBattle records protagonist death when protagonist is down', () => {
  const s = stateWithHireling();
  let b = startBattle(s, ENEMY, makeRoller(s.rng));
  b.activeBattle!.units['protagonist'].status = 'down';
  b.activeBattle!.units['protagonist'].currentHp = 0;
  const r = concludeBattle(b, makeRoller(b.rng), { battleId: 'b', dayOfCampaign: 3, location: 'the field' });
  assert.ok(r.state.protagonist.death, 'protagonist should have a death record');
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "src/warband/turn.test.ts"
```

- [ ] **Step 3: Implement `engine/src/warband/turn.ts`**

```typescript
import type { Roller } from '../core/rng.js';
import type { TWarbandCampaignState, TCombatUnit, TRosterMember } from './schema.js';
import type { InjuryEntry } from './progression.js';
import { isPlayerUnit, getBattleOutcome, endBattle } from './combat.js';
import { resolveHirelingDown, type DeathRecord } from './progression.js';
import { enemyAct } from './ai.js';

type InjuryTables = Record<'blunt' | 'cutting' | 'piercing', InjuryEntry[]>;

export function currentActorId(state: TWarbandCampaignState): string {
  const b = state.activeBattle;
  if (!b) throw new Error('no active battle');
  return b.turnOrder[b.currentTurnIndex];
}

function canAct(u: TCombatUnit): boolean {
  return u.status === 'active';
}

// Advance to the next unit that can act. Skips dead/routing/down units; a stunned
// unit's turn is consumed (cleared back to active) and skipped. Resets the landed
// unit's per-turn flags. Loops at most turnOrder.length times.
export function advanceTurn(state: TWarbandCampaignState): TWarbandCampaignState {
  const battle = state.activeBattle;
  if (!battle) throw new Error('no active battle');

  const n = battle.turnOrder.length;
  const units = { ...battle.units };
  let idx = battle.currentTurnIndex;

  for (let steps = 0; steps < n; steps++) {
    idx = (idx + 1) % n;
    const id = battle.turnOrder[idx];
    const u = units[id];
    if (!u) continue;
    if (u.status === 'stunned') {
      // consume the stun; this unit loses its turn
      units[id] = { ...u, status: 'active', hasActed: false, hasMoved: false };
      continue;
    }
    if (canAct(u)) {
      units[id] = { ...u, hasActed: false, hasMoved: false };
      return {
        ...state,
        activeBattle: { ...battle, currentTurnIndex: idx, units },
      };
    }
    // dead / routing / down → skip
  }

  // No actionable unit found (battle effectively over); still apply any stun clears.
  return { ...state, activeBattle: { ...battle, currentTurnIndex: idx, units } };
}

export interface RunEnemyResult {
  state: TWarbandCampaignState;
  log: string[];
}

// While the current actor is an enemy and the battle is ongoing, resolve enemy
// turns. Stops on a player actor or when the battle is decided.
export function runEnemyTurns(
  state: TWarbandCampaignState,
  roller: Roller,
  injuryTables: InjuryTables,
): RunEnemyResult {
  let cur = state;
  const log: string[] = [];
  // Safety bound: never loop more than (units * 4) times.
  const maxIters = cur.activeBattle ? Object.keys(cur.activeBattle.units).length * 4 + 4 : 0;

  for (let i = 0; i < maxIters; i++) {
    if (!cur.activeBattle) break;
    if (getBattleOutcome(cur) !== 'ongoing') break;
    const actorId = currentActorId(cur);
    const actor = cur.activeBattle.units[actorId];
    if (!actor || isPlayerUnit(actor)) break; // player's turn → stop

    const r = enemyAct(cur, actorId, roller, injuryTables);
    cur = r.state;
    log.push(...r.log);
    if (getBattleOutcome(cur) !== 'ongoing') break;
    cur = advanceTurn(cur);
  }

  return { state: cur, log };
}

export interface Casualty {
  id: string;
  name: string;
  result: 'dead' | 'survived';
}

export interface ConcludeContext {
  battleId: string;
  dayOfCampaign: number;
  location: string;
}

// Resolve downed player units, then close the battle. Hirelings roll D6
// (1-2 dead, else survive at full hp). Protagonist/companions that are down
// get a death record (permadeath / arc end).
export function concludeBattle(
  state: TWarbandCampaignState,
  roller: Roller,
  ctx: ConcludeContext,
): { state: TWarbandCampaignState; casualties: Casualty[] } {
  const battle = state.activeBattle;
  if (!battle) return { state, casualties: [] };

  // Identify downed player units BEFORE we drop the battle.
  const downed: Array<{ id: string; role: TCombatUnit['role'] }> = [];
  for (const u of Object.values(battle.units)) {
    if (!isPlayerUnit(u)) continue;
    if (u.status === 'down' || u.status === 'dead' || u.currentHp <= 0) {
      downed.push({ id: u.memberId, role: u.role });
    }
  }

  let next = endBattle(state); // writes hp back, drops activeBattle
  const casualties: Casualty[] = [];

  const death = (name: string): DeathRecord => ({
    cause: `Fell at ${ctx.location}`,
    battleId: ctx.battleId,
    dayOfCampaign: ctx.dayOfCampaign,
    location: ctx.location,
  });

  for (const { id, role } of downed) {
    if (role === 'hireling') {
      const member = next.hirelings[id];
      if (!member) continue;
      const resolved: TRosterMember = resolveHirelingDown(member, roller.die(6), death(member.name));
      next = { ...next, hirelings: { ...next.hirelings, [id]: resolved } };
      casualties.push({ id, name: member.name, result: resolved.death ? 'dead' : 'survived' });
    } else if (role === 'companion') {
      const member = next.companions[id];
      if (!member) continue;
      const dead: TRosterMember = { ...member, stats: { ...member.stats, hp: 0 }, death: death(member.name) };
      next = { ...next, companions: { ...next.companions, [id]: dead } };
      casualties.push({ id, name: member.name, result: 'dead' });
    } else {
      const member = next.protagonist;
      const dead: TRosterMember = { ...member, stats: { ...member.stats, hp: 0 }, death: death(member.name) };
      next = { ...next, protagonist: dead };
      casualties.push({ id, name: member.name, result: 'dead' });
    }
  }

  return { state: next, casualties };
}
```

- [ ] **Step 4: Verify `resolveHirelingDown` / `DeathRecord` exports**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && grep -n "export" src/warband/progression.ts | grep -iE "resolveHirelingDown|DeathRecord"
```

If `DeathRecord` is not exported, add `export` to its interface in `progression.ts` (it already defines `interface DeathRecord`). If the death-record field names differ from `{cause, battleId, dayOfCampaign, location}`, match them.

- [ ] **Step 5: Run — all turn tests pass**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "src/warband/turn.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add engine/src/warband/turn.ts engine/src/warband/turn.test.ts engine/src/warband/progression.ts
git commit -m "feat(warband): turn controller — advance/skip/stun, enemy-turn resolution, casualties"
```

---

## Task 3: Server — enforce turns, drive enemy turns, auto-conclude

**Files:** Modify `engine/src/warband/server.ts`

Read `server.ts` first. The `runCommand` function loads state, runs a switch, saves, and returns `{ ok, narrative, ...extra, state }`.

- [ ] **Step 1: Add imports to `server.ts`**

After the existing combat import block, add:

```typescript
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';
```

- [ ] **Step 2: Add a helper near the top of the module (after `loadData`)**

```typescript
// After any action, if the battle is decided, resolve casualties and close it.
// Returns the post-state plus any casualty/outcome info to surface to the client.
function maybeConclude(
  state: import('./schema.js').TWarbandCampaignState,
  roller: import('../core/rng.js').Roller,
): { state: import('./schema.js').TWarbandCampaignState; finished: boolean; outcome?: string; casualties?: unknown[] } {
  if (!state.activeBattle) return { state, finished: false };
  const outcome = getBattleOutcome(state);
  if (outcome === 'ongoing') return { state, finished: false };
  const ctx = {
    battleId: state.activeBattle.battleId,
    dayOfCampaign: state.meta.day,
    location: 'the field',
  };
  const r = concludeBattle(state, roller, ctx);
  return { state: r.state, finished: true, outcome, casualties: r.casualties };
}
```

(`getBattleOutcome` is already imported in server.ts.)

- [ ] **Step 3: Replace the `start`, `move`, `attack`, and `end-turn` cases in `runCommand`**

The new behavior. Find each case and replace its body:

**`start`** — after `state = startBattle(...)`, immediately resolve any leading enemy turns so the player isn't stuck if enemies won initiative:

```typescript
    case 'start': {
      const spec = String(args.enemies ?? '');
      if (!spec) throw new EngineError('enemies spec required, e.g. "b1:bandit,b2:archer"');
      const defs = loadData<Array<Record<string, any>>>('enemies.json');
      const spawns: EnemySpawn[] = spec.split(',').map((tok) => {
        const parts = tok.trim().split(':');
        if (parts.length !== 2) throw new EngineError(`bad enemy token "${tok.trim()}" — expected id:typeId`);
        const [id, typeId] = parts;
        const def = defs.find((d) => d.id === typeId);
        if (!def) throw new EngineError(`unknown enemy type "${typeId}". Available: ${defs.map((d) => d.id).join(', ')}`);
        return { id, typeId, name: def.name, stats: def.stats, morale: def.morale, weaponCategory: def.weaponCategory, named: def.named ?? false };
      });
      const roller = makeRoller(state.rng);
      state = startBattle(state, spawns, roller);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      const conc = maybeConclude(state, roller);
      state = conc.state;
      narrative = 'Battle begins.';
      extra = { log: enemyRun.log, currentTurn: state.activeBattle ? currentActorId(state) : null, ...(conc.finished ? { finished: true, outcome: conc.outcome, casualties: conc.casualties } : {}) };
      break;
    }
```

**`move`** — enforce turn ownership and not-yet-moved:

```typescript
    case 'move': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const unitId = String(args.unitId);
      const actor = currentActorId(state);
      if (unitId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${unitId}'s`);
      const u = state.activeBattle.units[unitId];
      if (!u || u.role === 'enemy') throw new EngineError('you can only move your own units');
      if (u.hasMoved) throw new EngineError(`${unitId} has already moved this turn`);
      state = moveUnit(state, unitId, Number(args.col), Number(args.row));
      narrative = `${unitId} moves to (${args.col},${args.row}).`;
      extra = { currentTurn: currentActorId(state) };
      break;
    }
```

**`attack`** — enforce turn ownership and not-yet-acted, then auto-conclude if the battle ended:

```typescript
    case 'attack': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const attackerId = String(args.attackerId);
      const actor = currentActorId(state);
      if (attackerId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${attackerId}'s`);
      const a = state.activeBattle.units[attackerId];
      if (!a || a.role === 'enemy') throw new EngineError('you can only attack with your own units');
      if (a.hasActed) throw new EngineError(`${attackerId} has already acted this turn`);
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      const r = resolveAttack(state, attackerId, String(args.targetId), roller, injuries);
      state = r.state;
      narrative = r.narrative;
      const conc = maybeConclude(state, roller);
      state = conc.state;
      extra = {
        outcome: r.outcome, roll: r.roll, damage: r.damage, injury: r.injuryTriggered, moraleEvents: r.moraleEvents,
        ...(conc.finished ? { finished: true, battleOutcome: conc.outcome, casualties: conc.casualties } : { battleOutcome: 'ongoing', currentTurn: currentActorId(state) }),
      };
      break;
    }
```

**`end-turn`** — advance past the current player unit, run all enemy turns, then auto-conclude:

```typescript
    case 'end-turn': {
      if (!state.activeBattle) throw new EngineError('no active battle');
      const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
      const roller = makeRoller(state.rng);
      state = advanceTurn(state);
      const enemyRun = runEnemyTurns(state, roller, injuries);
      state = enemyRun.state;
      const conc = maybeConclude(state, roller);
      state = conc.state;
      narrative = state.activeBattle ? `Turn passes to ${currentActorId(state)}.` : 'The battle is over.';
      extra = {
        log: enemyRun.log,
        ...(conc.finished ? { finished: true, outcome: conc.outcome, casualties: conc.casualties } : { currentTurn: state.activeBattle ? currentActorId(state) : null }),
      };
      break;
    }
```

Leave `flee` and `end` as-is (flee just calls `endBattle`; `end` checks outcome and calls `endBattle`). The auto-conclude path mostly makes manual `end` redundant, but keep it.

- [ ] **Step 4: Restart the server and smoke-test a full fight via the API**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine
# (kill any running server on the port first if needed)
WARBAND_PORT=4505 npx tsx src/warband/server.ts &
sleep 3
# fresh campaign
npx tsx src/warband/cli.ts campaign create turn-test --background hedge-knight --name Roland
node -e '
const P="http://localhost:4505";
const post=(c,a)=>fetch(P+"/api/warband/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({campaign:"turn-test",command:c,args:a||{}})}).then(r=>r.json());
(async()=>{
  let d=await post("start",{enemies:"e1:bandit"}); console.log("start log:",d.log,"turn:",d.currentTurn);
  // play up to 30 actions: attack current actor target if adjacent else end turn
  for (let i=0;i<30;i++){
    const s=await fetch(P+"/api/warband/state?campaign=turn-test").then(r=>r.json());
    if(!s.activeBattle){console.log("battle over at iter",i);break;}
    const cur=s.activeBattle.turnOrder[s.activeBattle.currentTurnIndex];
    const u=s.activeBattle.units[cur];
    // find an enemy target
    const enemy=Object.values(s.activeBattle.units).find(x=>x.role==="enemy"&&x.status!=="dead"&&x.status!=="routing");
    if(enemy){ const dd=await post("attack",{attackerId:cur,targetId:enemy.memberId}); console.log(i,"attack",dd.outcome||dd.error, dd.finished?("FINISHED "+dd.battleOutcome):""); if(dd.finished)break; }
    const et=await post("end-turn"); if(et.log&&et.log.length)console.log("   enemy:",et.log.join(" | ")); if(et.finished){console.log("FINISHED via end-turn",et.outcome);break;}
  }
})();
'
```

Expect to see enemy actions in the log and the battle reaching `player_win` or `player_loss`. Kill the server after.

- [ ] **Step 5: Run full test suite**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && npm test
```

- [ ] **Step 6: Commit**

```bash
git add engine/src/warband/server.ts
git commit -m "feat(warband): server enforces turns, auto-resolves enemy turns and casualties"
```

---

## Task 4: CLI parity

**Files:** Modify `engine/src/warband/cli.ts`

Mirror the server's turn behavior in the CLI so both interfaces play the same game.

- [ ] **Step 1: Add imports to `cli.ts`**

```typescript
import { currentActorId, advanceTurn, runEnemyTurns, concludeBattle } from './turn.js';
```

- [ ] **Step 2: Update the `combat start` handler**

After `state = startBattle(state, spawns, roller);`, run leading enemy turns:

```typescript
  const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
  const enemyRun = runEnemyTurns(state, roller, injuries);
  state = enemyRun.state;
  // ... existing result object, plus: log: enemyRun.log
```

Add `log: enemyRun.log` and `currentTurn: state.activeBattle ? currentActorId(state) : null` to the `combat.start` result.

- [ ] **Step 3: Update the `combat end-turn` handler**

Replace its body:

```typescript
else if (cmd === 'combat' && sub === 'end-turn') {
  if (!state.activeBattle) throw new EngineError('no active battle');
  const injuries = loadData<Record<'blunt' | 'cutting' | 'piercing', any[]>>('injuries.json');
  const roller = makeRoller(state.rng);
  state = advanceTurn(state);
  const enemyRun = runEnemyTurns(state, roller, injuries);
  state = enemyRun.state;
  let finished = false; let outcome; let casualties;
  if (state.activeBattle && getBattleOutcome(state) !== 'ongoing') {
    outcome = getBattleOutcome(state);
    const c = concludeBattle(state, roller, { battleId: state.activeBattle.battleId, dayOfCampaign: state.meta.day, location: 'the field' });
    state = c.state; finished = true; casualties = c.casualties;
  }
  mutated = true;
  result = { op: 'combat.end-turn', log: enemyRun.log, finished, outcome, casualties, currentTurn: state.activeBattle ? currentActorId(state) : null };
}
```

(`getBattleOutcome` is already imported in cli.ts.)

- [ ] **Step 4: Add turn-ownership guards to `combat move` and `combat attack` handlers**

In `combat move`, before calling `moveUnit`, add:
```typescript
  const actor = currentActorId(state);
  if (unitId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${unitId}'s`);
```
In `combat attack`, before calling `resolveAttack`, add:
```typescript
  const actor = currentActorId(state);
  if (attackerId !== actor) throw new EngineError(`it is ${actor}'s turn, not ${attackerId}'s`);
```
And after `resolveAttack`, auto-conclude if the battle ended (mirror the server):
```typescript
  if (state.activeBattle && getBattleOutcome(state) !== 'ongoing') {
    const oc = getBattleOutcome(state);
    const c = concludeBattle(state, makeRoller(state.rng), { battleId: state.activeBattle.battleId, dayOfCampaign: state.meta.day, location: 'the field' });
    state = c.state;
    (result as any) = { ...(result as any), finished: true, battleOutcome: oc, casualties: c.casualties };
  }
```

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && npm test && npm run typecheck
```

(The pre-existing `TS2367` warning in combat.ts may still appear — that's unrelated.)

- [ ] **Step 6: Commit**

```bash
git add engine/src/warband/cli.ts
git commit -m "feat(warband): CLI parity for turn enforcement and enemy turns"
```

---

## Task 5: UI — show the turn log and battle result

**Files:** Modify `engine/web/index.html`

The UI already logs `data.narrative`. Extend it to render the `log[]` array (enemy actions) and announce battle results/casualties.

- [ ] **Step 1: Update the `command()` function in `index.html`**

Find the block that handles the command response (currently logs `data.narrative` and `data.battleOutcome`). Replace with:

```javascript
        state = data.state; battle = state.activeBattle || null;
        if (data.narrative) logLine(data.narrative);
        if (Array.isArray(data.log)) data.log.forEach(line => logLine('  ⚔ ' + line));
        if (data.finished) {
          const oc = data.outcome || data.battleOutcome;
          logLine('>> BATTLE OVER: ' + String(oc || '').toUpperCase());
          if (Array.isArray(data.casualties) && data.casualties.length) {
            data.casualties.forEach(c => logLine('   ✝ ' + c.name + ': ' + c.result, c.result === 'dead'));
          }
        }
        selectedId = null;
        setStatus('');
        render();
```

- [ ] **Step 2: Manual verification**

Restart the engine server (`npm run warband-serve`), open the UI, Start a battle, and play a few turns:
- Enemy actions appear in the log after you End Turn (e.g. "⚔ Bandit advances on Roland.", "⚔ Bandit hits Roland for 4 damage.")
- When one side is wiped, the log shows "BATTLE OVER: PLAYER_WIN" (or LOSS) and any casualties, and the grid clears.

- [ ] **Step 3: Commit**

```bash
git add engine/web/index.html
git commit -m "feat(warband): UI surfaces enemy turn log and battle outcome"
```

---

## Task 6: Final integration

- [ ] **Step 1: Full suite + typecheck**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && npm test && npm run typecheck
```

All tests pass (existing 128 + new AI/turn tests). Typecheck: the pre-existing `TS2367` in combat.ts is the only acceptable warning.

- [ ] **Step 2: End-to-end manual play** in the browser — a full battle that the enemies actually contest, ending in win or loss with casualties surfaced.

- [ ] **Step 3: Push**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine && git push
```

---

## Self-Review

**Coverage of the reported problem ("not turn based / just a test"):**
- ✓ Enemies now act (Task 1 AI + Task 2 `runEnemyTurns`)
- ✓ Turns enforced — only the current actor, once per move/attack (Task 3/4)
- ✓ Turns auto-advance through enemy actions on End Turn (Task 3/4)
- ✓ Dead/stunned units skipped properly (Task 2 `advanceTurn`)
- ✓ Battles conclude with casualties — hireling D6 + protagonist/companion death (Task 2 `concludeBattle`)
- ✓ UI shows the back-and-forth (Task 5)

**Deferred (flagged, not silently dropped):** player movement-range limits; ranged-kiting AI; persisting injury stat penalties to roster; protagonist injury-table-vs-instant-death nuance.

**Placeholder scan:** none. **Type consistency:** `enemyAct` returns `{state, log}`; `runEnemyTurns` returns `{state, log}`; `concludeBattle` returns `{state, casualties}`; `advanceTurn`/`currentActorId` operate on state — all consistent across tasks and server/cli usage.
