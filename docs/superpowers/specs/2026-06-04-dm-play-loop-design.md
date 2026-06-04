# DM Play Loop — Design Spec
*2026-06-04*

## Overview

Re-center the project on its actual differentiator: **a traditional TTRPG run by Claude as a live Dungeon Master**, backed by the deterministic engine for honest dice, 5e rules, and a persistent world with memory. The warband simulation we built becomes an optional add-on layer (later sub-projects), not the main loop.

This sub-project (#1 of 4) delivers the core: **start, run, and resume an excellent 5e session with Claude as DM**, using the existing engine as the DM's toolset. Approach A (skill-centric harness over the existing engine) — chosen for fastest path to fun, maximal reuse, and letting real play reveal what to harden.

**Play model:** the player converses with Claude (in Claude Code / the Claude app / mobile via remote control). Claude narrates, voices NPCs, and adjudicates, calling the engine under the hood. There is **no browser game UI** in this sub-project — the live-DM model doesn't need one.

**Hard constraint (from the user):** gameplay must feel **smooth, not slow**. See "Performance & Smoothness" — it's a first-class requirement with concrete tactics and acceptance checks.

---

## Decomposition (context)

The full re-centering = four sub-projects. This spec is #1.

1. **The DM Play Loop** ← this spec
2. Character & campaign creation (guided 5e chargen, opening scene)
3. Pluggable rule systems (formalize the seam; add a 2nd system)
4. Warband add-ons as DM tools (tactical grid drop-in, downtime roster/strategy/factions/trade)

The system-pluggability **seam** is baked into #1 as a design principle; a full second ruleset is deferred to #3 (YAGNI).

---

## Components

### DM Harness (the deliverable)
A project skill in the repo (e.g. `.claude/skills/dm/` or a repo-level skill), built from `anthropic-skills:rpg-session-runner` + the old Desktop `DM_PROTOCOL` as source material. It is **instructions for Claude, not app code.** It encodes:
- **Session lifecycle:** start, resume (recap), end (commit).
- **Narration contract:** scene-framing style, NPC voicing from persona+memory, pacing.
- **Adjudication rules:** when to roll vs narrate directly; how to call the engine; the iron rule — *never invent a number the engine didn't return.*
- **Memory discipline:** what gets written to chronicle vs NPC memory logs, and when.

### Engine (exists — the DM's toolset)
The `engine` CLI already provides, deterministically: dice/checks, 5e combat (initiative/AC/HP/conditions/monsters/SRD lookups), inventory, factions+reputation, regions, ticking clocks, a chronicle, and an NPC registry. The engine **owns every number and all persistence.** This sub-project reconnects/verifies it; it does not rebuild it.

### Campaign data (existing pattern)
Per campaign under `campaigns/<name>/`:
- `state.json` — PCs, NPCs, factions, clocks, region, meta (canonical, schema-validated).
- `log.jsonl` — append-only event log.
- `npcs/<id>.persona.md` — character voice/personality (the charm).
- `npcs/<id>.memory.log` — what that NPC remembers (append-only).

### Ruleset seam (pluggability for later)
A `rulesets/5e.md` adjudication reference the harness consults for system-specific decisions (typical DCs, advantage/disadvantage, conditions, death saves, rest rules). The harness asks "what does the active ruleset say" through this one layer. Adding Pathfinder later = add `rulesets/pathfinder.md` (+ any engine ruleset module) without touching harness logic. The campaign records its active ruleset id in `state.meta`.

---

## The Play Loop (data flow)

1. **Start / resume.** Harness loads context **once**: engine `session start`, `chronicle read`, the active region/clocks, and the persona+memory of NPCs present in the scene. Claude produces a "Previously…" recap (resume) or frames the opening (new).
2. **Narrate & prompt.** Claude describes the scene, voices present NPCs from their files, presents the situation. Player declares an action in free text.
3. **Adjudicate.**
   - *Trivial / no real stakes* → narrate the outcome directly, **zero engine calls.**
   - *Real stakes* → one engine call for the roll (ability/skill check vs a ruleset DC, attack, save). Combat → the engine's initiative/turn tracker.
   - Claude narrates the *result* the engine returned; it never fabricates the number.
4. **Persist.** Consequences via engine `state patch`; meaningful beats via `chronicle append`; an NPC's reaction appended to its `memory.log`; clocks tick on their triggers.
5. **Commit.** At session end, `chronicle commit` a summary; compress memory logs if large.

---

## Performance & Smoothness (first-class requirement)

The latency risk is **per-turn engine overhead**, dominated by (a) cold process start and (b) too many calls per action. Tactics:

1. **Warm/fast engine startup.** Cold `tsx` startup (~1–2s/call) is the biggest tax. Mitigation, in priority order:
   - **Precompile the engine to plain JS** (`dist/`) and invoke `node dist/cli.js` (~100–200ms start). (An earlier precompile attempt was deferred over ESM `.js`-extension config — this sub-project resolves that as part of the work, or falls back to option below.)
   - **Fallback:** a single long-running engine process the harness talks to, so calls hit a warm process instead of spawning per call.
   - Target: a typical engine call returns in **well under a second**, not several.
2. **Minimize calls per turn.** Trivial actions = pure narration, **zero** engine calls. Cap the common case at **one** engine call per player action.
3. **Batch combat.** Resolve a full enemy turn / a round's bookkeeping in **one** engine invocation, not many small ones.
4. **Load context once.** Read state/chronicle/personas at session start, hold them in working context, write **deltas** at beats — do not re-read everything each turn.
5. **Latency budget:** narration is Claude's generation time (inherent, fine); the *mechanical* overhead a turn adds should be ≤ ~1s in the common case. This is an explicit acceptance check below.

---

## Testing & Acceptance

- **Engine (deterministic):** already unit-tested; keep/add golden tests for any new glue (e.g. the precompiled-CLI entry, the ruleset indirection).
- **The DM experience is play-tested, not unit-tested.** Acceptance = a short live session (Claude + player) on `the-hollow-road` (resume) and a fresh start, demonstrating:
  1. **Correct recap** assembled from chronicle + state (no invented history).
  2. **Every roll comes from the engine** — no fabricated numbers; verifiable against `log.jsonl`.
  3. **NPC consistency** — present NPCs match their persona + memory.
  4. **A combat encounter resolves through the engine** (initiative → turns → resolution).
  5. **Smoothness:** the common player action adds ≤ ~1s of mechanical overhead; combat rounds don't stall on many sequential cold calls. (Measured against the warm/precompiled engine.)

---

## Out of Scope (this sub-project)

- Guided character creation (SP2).
- A second rule system / full pluggability framework (SP3 — only the *seam* is built now).
- Warband add-ons: tactical grid, roster, factions, trade as DM tools (SP4).
- Any browser/app UI — the live-DM model is played in chat / on mobile.

---

## Open Questions / Risks

- **Precompile vs warm-process** for engine speed: decide during planning based on how cleanly the ESM/`.js`-extension precompile resolves. Either satisfies the latency budget; precompile is simpler operationally.
- **NPC memory growth:** memory logs are append-only; compression cadence (per session-commit) must keep session-start loads fast.
