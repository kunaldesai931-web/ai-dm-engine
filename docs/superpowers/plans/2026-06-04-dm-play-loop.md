# DM Play Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the buildable tasks (1, 2, 4). Task 3 (the DM harness skill) is authored by the main agent with review. Task 5 is an interactive play-test with the user. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Claude a great live 5e Dungeon Master backed by the existing engine — fast enough to feel smooth — by adding a fast-start engine build, a ruleset seam, and a DM harness skill, then proving it in a live play-test.

**Architecture:** Approach A (skill-centric). The engine already exposes a complete 5e CLI toolset and persistent campaign data with NPC persona/memory files. We (1) bundle the engine for sub-second startup, (2) add a thin ruleset seam, (3) author a DM harness skill that orchestrates narration + engine calls + memory, and (4) verify by play.

**Tech Stack:** TypeScript engine (existing), esbuild (new, for fast CLI bundle), Node test runner, Markdown (the harness skill + ruleset reference).

---

## File Map

| File | Responsibility |
|---|---|
| `engine/package.json` | add `esbuild` devDep + `build` script |
| `engine/dist/cli.mjs` | built artifact — fast-start bundled engine CLI (gitignored) |
| `engine/.gitignore` | ignore `dist/` |
| `engine/test/build-smoke.test.ts` | golden smoke: bundled CLI runs key commands, returns valid JSON, finds campaigns |
| `rulesets/5e.md` | 5e adjudication reference the harness consults (DCs, advantage, conditions, death saves, rests) |
| `.claude/skills/dm/SKILL.md` | the DM harness — instructions for Claude (lifecycle, narration, intent→command map, memory discipline, smoothness rules) |
| `campaigns/the-hollow-road/state.json` | set `meta.rulesetId = "5e"` |
| `engine/README-dm.md` | one-page operator note: build once, how the harness calls the engine |

---

## Task 1: Fast-start engine build (smoothness)

**Files:** `engine/package.json`, `engine/.gitignore`, `engine/test/build-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test** `engine/test/build-smoke.test.ts`

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');

function run(args: string[]): any {
  const out = execFileSync('node', [BUNDLE, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('bundle exists (run `npm run build` first)', () => {
  assert.ok(existsSync(BUNDLE), `missing ${BUNDLE} — run: npm run build`);
});

test('bundled CLI rolls dice and returns valid JSON', () => {
  const r = run(['roll', '1d20']);
  assert.equal(r.op, 'roll');
  assert.ok(typeof r.total === 'number' && r.total >= 1 && r.total <= 20);
});

test('bundled CLI does an SRD lookup (no campaign needed)', () => {
  const r = run(['srd', 'condition', 'prone']);
  assert.equal(r.op, 'srd');
  assert.ok(r.result, 'expected an SRD result for "prone"');
});

test('bundled CLI lists campaigns (path resolution survives bundling)', () => {
  const r = run(['campaign', 'list']);
  assert.equal(r.op, 'campaign.list');
  assert.ok(Array.isArray(r.campaigns));
  assert.ok(r.campaigns.includes('the-hollow-road'), 'should find the-hollow-road campaign dir');
});
```

- [ ] **Step 2: Run — verify it fails** (`npm run build` doesn't exist / no bundle yet)

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "test/build-smoke.test.ts"
```
Expected: failures (bundle missing).

- [ ] **Step 3: Add esbuild + build script to `engine/package.json`**

Add to `devDependencies`: `"esbuild": "^0.24.0"`. Add to `scripts`:
```json
"build": "esbuild src/cli.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/cli.mjs"
```
`--packages=external` keeps `node_modules` deps (zod) external so they resolve at runtime; the bundle inlines our own `./...` source, which removes the extensionless-import problem.

- [ ] **Step 4: Install + build**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && npm install && npm run build
```
Expected: `dist/cli.mjs` created.

- [ ] **Step 5: Create `engine/.gitignore`**

```
dist/
```

- [ ] **Step 6: Run the smoke test — all pass**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node --import tsx --test "test/build-smoke.test.ts"
```
Expected: 4 pass. (If `campaign list` fails to find `the-hollow-road`, the bundle's `import.meta.url` path resolution broke — fix by setting esbuild `--define` or keeping state.ts path logic relative to cwd; do NOT proceed until this passes.)

- [ ] **Step 7: Measure startup (smoothness budget)**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine
node -e "const t=Date.now(); require('child_process').execFileSync('node',['dist/cli.mjs','roll','1d20']); console.log('bundle start ms:', Date.now()-t)"
```
Expected: well under 1000ms (target ~100–300ms). Record the number in the commit message.

- [ ] **Step 8: Commit**

```bash
git add engine/package.json engine/package-lock.json engine/.gitignore engine/test/build-smoke.test.ts
git commit -m "feat(engine): esbuild fast-start bundle for sub-second CLI calls (DM smoothness)"
```

---

## Task 2: Ruleset seam

**Files:** `rulesets/5e.md`, `campaigns/the-hollow-road/state.json`, `engine/test/ruleset.test.ts`

The seam is convention, not new engine code: `state.meta.rulesetId` names the active system; the harness consults `rulesets/<rulesetId>.md`. `meta` is a loose object, so no schema change is required — but we add a test pinning the convention and a default.

- [ ] **Step 1: Write the failing test** `engine/test/ruleset.test.ts`

```typescript
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
```

- [ ] **Step 2: Run — fails** (rulesetId not set yet).

- [ ] **Step 3: Set `meta.rulesetId` on the-hollow-road**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && node dist/cli.mjs state patch --set meta.rulesetId=5e --campaign the-hollow-road
```
(If `state patch --set` cannot write a string, edit `campaigns/the-hollow-road/state.json` directly to add `"rulesetId": "5e"` inside `meta`.)

- [ ] **Step 4: Create `rulesets/5e.md`** — a concise adjudication reference (the harness reads this). Include: ability/skill list, the standard DC ladder (Very Easy 5 → Nearly Impossible 30), when to call for a check vs. auto-succeed, advantage/disadvantage triggers, the core conditions and their effects, death saves, short/long rest effects, and the iron rule that the engine owns all dice. Keep it to ~1 page, declarative. Example opening:

```markdown
# Ruleset: D&D 5e (SRD)

The engine owns every die. This file tells the DM *when* and *how* to ask the engine.

## Ability checks
Abilities: STR DEX CON INT WIS CHA. Common skills: athletics, acrobatics, stealth,
perception, investigation, insight, persuasion, deception, intimidation, arcana...

## DC ladder
| Difficulty | DC |
|---|---|
| Trivial (no roll) | — |
| Easy | 10 |
| Medium | 15 |
| Hard | 20 |
| Very hard | 25 |
| Nearly impossible | 30 |

Call for a check only when failure is interesting AND success is uncertain. Otherwise narrate.

## Advantage / disadvantage
Grant advantage for clever positioning, help, or the right tool; disadvantage for
poor conditions, range, or impairment. Pass `--adv` / `--dis` to the engine.

## Conditions
prone, grappled, restrained, poisoned, frightened, stunned, prone, blinded... (use `srd condition <name>` for exact effects).

## Combat
Use the engine combat tracker: `combat start`, `combat next`, `attack`, `damage`, `combat status`. Never hand-wave HP.

## Rests
short rest: spend Hit Dice (`rest --type short --hitDice N`). long rest: full reset (`rest --type long`).
```

- [ ] **Step 5: Run the ruleset test — passes.**

- [ ] **Step 6: Commit**

```bash
git add rulesets/5e.md campaigns/the-hollow-road/state.json engine/test/ruleset.test.ts
git commit -m "feat(dm): ruleset seam — 5e adjudication reference + meta.rulesetId"
```

---

## Task 3: DM harness skill *(authored by main agent + review)*

**Files:** `.claude/skills/dm/SKILL.md`, `engine/README-dm.md`

This is the heart of the deliverable and governs how Claude behaves as DM. It is **not** subagent-mechanical — the main agent authors it; a reviewer subagent checks it for completeness/contradictions against the spec.

- [ ] **Step 1: Author `.claude/skills/dm/SKILL.md`.** Required sections:
  - **Frontmatter** `name: dm`, `description:` "Use when running or resuming a tabletop RPG session as Dungeon Master for this project's campaigns."
  - **Engine command** — always call the bundled CLI for speed: `node engine/dist/cli.mjs <cmd> --campaign <name> [flags]` (absolute path). If `dist/cli.mjs` is missing, run `npm --prefix engine run build` once.
  - **Session lifecycle:** START/RESUME → `session start`, `chronicle read`, read present NPCs' `campaigns/<c>/npcs/<id>.persona.md` + `.memory.log`, `clock status`; produce a "Previously…" recap (resume) or frame the opening (new). END → `chronicle commit --summary`.
  - **The iron rule:** never state a die result, HP number, or check outcome the engine didn't return. Trivial actions are narrated with no roll.
  - **Intent → command cheat-sheet** (map player intents to exact engine commands): ability/skill check → `check --actor … --skill … --dc … [--adv|--dis]`; saving throw → `save`; attack → `attack`; raw dice → `roll`; damage/heal → `damage`/`heal`; spell → `cast`; rest → `rest`; spawn a foe → `combat spawn` / `monster add`; run a fight → `combat start` → `attack`/`damage`/`combat next` → `combat end`; new NPC → `npc add`; reputation → `faction rep`; tension → `clock add/tick`; rules lookup → `srd`.
  - **Ruleset consultation:** read `rulesets/<state.meta.rulesetId>.md` (default `5e`) for DCs/conditions/advantage guidance.
  - **Memory discipline:** after meaningful beats, `chronicle append --text`; when an NPC reacts/learns something, append a line to that NPC's `memory.log`; tick clocks on triggers.
  - **Smoothness rules (explicit):** (a) trivial action = pure narration, **zero** engine calls; (b) at most **one** engine call per player action in the common case; (c) in combat, resolve a full enemy turn's mechanics in as few calls as possible and batch narration; (d) load campaign context **once** at session start and keep it in working memory — write deltas at beats, don't re-read everything each turn; (e) prefer the bundled `dist/cli.mjs` (never `tsx`) so calls are sub-second.
  - **Voice:** vivid but succinct; end turns on a clear decision point; honor player agency.
- [ ] **Step 2: Author `engine/README-dm.md`** — operator note: "Run `npm --prefix engine run build` once; the DM skill calls `node engine/dist/cli.mjs`. Campaigns live in `campaigns/`. Play by invoking the `dm` skill."
- [ ] **Step 3: Spec-compliance review (reviewer subagent).** Dispatch a reviewer to check `SKILL.md` against `docs/superpowers/specs/2026-06-04-dm-play-loop-design.md`: are lifecycle, iron-rule, intent→command map, memory discipline, ruleset seam, and all five smoothness rules present and non-contradictory? Fix gaps.
- [ ] **Step 4: Commit**

```bash
git add .claude/skills/dm/SKILL.md engine/README-dm.md
git commit -m "feat(dm): DM harness skill — lifecycle, adjudication, memory, smoothness"
```

---

## Task 4: Reconnection smoke (end-to-end engine sanity)

**Files:** `engine/test/dm-commands-smoke.test.ts`

Confirm the specific commands the harness relies on actually work via the bundle against a throwaway campaign (so we don't mutate the-hollow-road).

- [ ] **Step 1: Write the test** `engine/test/dm-commands-smoke.test.ts`

```typescript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ENGINE_DIR, 'dist', 'cli.mjs');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const C = 'dm-smoke';
const run = (args: string[]) => JSON.parse(execFileSync('node', [BUNDLE, ...args, '--campaign', C], { encoding: 'utf8' }));

// NOTE: a campaign is created by writing a minimal state.json; if the engine has a
// `campaign new` path use it, else create campaigns/dm-smoke/state.json in before().
before(() => {
  const fs = require('node:fs');
  const dir = path.join(REPO_ROOT, 'campaigns', C);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    meta: { campaign: C, rulesetId: '5e' },
    rng: { seed: 'dm-smoke', cursor: 0 },
    pcs: { 'pc-1': { id: 'pc-1', name: 'Tess', abilities: { dex: 14 }, hp: { current: 10, max: 10 } } },
    npcs: {}, factions: {}, clocks: {},
  }));
});
after(() => { rmSync(path.join(REPO_ROOT, 'campaigns', C), { recursive: true, force: true }); });

test('check runs and returns a pass/fail outcome', () => {
  const r = run(['check', '--actor', 'pc-1', '--ability', 'dex', '--dc', '10']);
  assert.ok('op' in r);
});
test('session start works', () => { assert.ok('op' in run(['session', 'start'])); });
test('chronicle read works', () => { assert.ok('op' in run(['chronicle', 'read'])); });
test('combat start + status works', () => {
  run(['combat', 'spawn', '--id', 'gob', '--name', 'Goblin', '--hp', '7', '--ac', '13']);
  const r = run(['combat', 'start', '--participants', 'pc-1,gob']);
  assert.ok('op' in r);
});
```

Adjust the minimal state shape to satisfy the engine's `parseState` if it rejects it (read `engine/src/types.ts` for required fields and add them). The goal: prove the harness's core commands run via the bundle.

- [ ] **Step 2: Run — make the commands pass.** If `parseState` rejects the minimal state, expand it minimally until valid. Do not weaken the schema.
- [ ] **Step 3: Run full suite + the new tests**

```bash
cd C:/Users/admin/Documents/GitHub/ai-dm-engine/engine && npm test
```
Expected: all pass (existing 155 + new smoke/ruleset tests).

- [ ] **Step 4: Commit**

```bash
git add engine/test/dm-commands-smoke.test.ts
git commit -m "test(dm): end-to-end smoke for the DM harness's engine commands"
```

---

## Task 5: Live play-test *(interactive acceptance — with the user)*

Not a subagent task. The main agent runs a short live session with the user; this is the acceptance gate from the spec.

- [ ] **Step 1: Resume `the-hollow-road`.** Invoke the `dm` skill. Confirm: a correct "Previously…" recap assembled from chronicle + state (no invented history); present NPCs (Sera/Holt/etc.) voiced consistent with their persona+memory files.
- [ ] **Step 2: A skill check with stakes.** Player attempts something uncertain; DM calls `check` via the bundle; narrates the engine's result (verify the roll appears in `campaigns/the-hollow-road/log.jsonl`).
- [ ] **Step 3: A combat encounter.** Start a fight; resolve ≥2 rounds through the engine (initiative → attacks → HP). Confirm no fabricated numbers.
- [ ] **Step 4: Smoothness check.** Confirm the common action adds ≤ ~1s of mechanical overhead and combat doesn't stall on slow calls. If it drags, revisit Task 1 (bundle) before declaring done.
- [ ] **Step 5: Fresh start.** Begin a brand-new campaign opening scene (chargen is SP2, so use a quick pre-made PC) to confirm the new-session path frames a scene cleanly.
- [ ] **Step 6: Commit any chronicle/state changes** the play-test produced, and note acceptance in the commit message.

---

## Self-Review

**Spec coverage:**
- ✓ DM harness skill (lifecycle, narration, iron-rule, memory) — Task 3
- ✓ Engine = toolset, owns dice/state — reused; verified Tasks 1/4
- ✓ Campaign data + NPC persona/memory — used by harness (Task 3), exercised in play-test (Task 5)
- ✓ Ruleset seam (`rulesets/5e.md` + `meta.rulesetId`) — Task 2
- ✓ **Performance & smoothness** (precompiled fast-start bundle, one-call-per-turn, batch combat, load-once) — Task 1 (bundle) + Task 3 (the rules) + Task 5 step 4 (measured acceptance)
- ✓ Testing/acceptance: golden engine smoke (Tasks 1/4) + live play-test (Task 5)
- ✓ Out of scope respected: no chargen, no 2nd ruleset, no warband, no browser UI

**Placeholder scan:** none. The `rulesets/5e.md` content is exemplified, not "TBD" — the engineer fills the declarative reference following the shown structure.

**Type/contract consistency:** all tests invoke the same bundle path `engine/dist/cli.mjs`; ruleset id key is `meta.rulesetId` everywhere; commands match the engine's real USAGE (verified against cli.ts).

**Risk flagged:** esbuild bundling + `import.meta.url` path resolution — Task 1 Step 6 is a hard gate that must pass before proceeding (campaign discovery proves paths survived bundling).
