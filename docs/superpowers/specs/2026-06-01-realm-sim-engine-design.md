# Realm Simulation Engine — Design (v1)

Status: approved design, ready for implementation planning.
Date: 2026-06-01
Repo: `ai-dm-engine`

## 0. Thesis

A second deterministic engine, parallel to the RPG engine, that runs **abstract
economic / kingdom simulation** for our RPGs. Same honesty contract as the RPG
engine: **code owns every number and every state change; the LLM only narrates.**

It must work **two ways**:

- **Alongside the RPG engine** — a realm sits inside a campaign; its state is a
  sibling file, and a thin bridge feeds narration-ready summaries to the GM.
- **Standalone** — a pure simulation game with no `state.json`, just a realm dir.

v1 scope: **core + economy.** Army collapses to a single `strength` number;
full warfare and the reverse (RPG → sim) bridge are v2.

## 1. Locked design decisions

| Decision | Choice | Why |
|---|---|---|
| Fidelity | **Abstract / clocks** | A handful of aggregate numbers + dice + modifiers. Narratable, code-owned, fast to deepen later without re-architecting. |
| Coupling | **Separate `realm.json` + bridge** | Own RNG cursor; standalone = realm dir with no RPG state. Bridge keeps both engines independent. |
| MVP | **Core + economy** | Tick loop + RNG + resource model + events + decisions. Army = single `strength` stub. Proves the spine end-to-end. |
| Turn loop | **Standing policy + 1–2 queued edicts → `realm tick`** | Concrete, narratable; all mutation in one auditable resolution step. |
| Packaging | **Approach C — shared core, minimal refactor** | Lift only shared primitives into `core/`; RPG modules stay put. No duplication, both engines stay small and standalone-runnable. |

## 2. Repo layout (Approach C — shared core, minimal refactor)

Only the genuinely-shared primitives move into `core/`. The RPG engine's CLI and
behavior are unchanged, so `CLAUDE.md`'s `npx tsx src/cli.ts …` keeps working.

```
engine/
  src/
    core/                  # NEW — shared, engine-agnostic
      rng.ts               # moved from src/rng.ts (seed+cursor, forward-only)
      dice.ts              # moved from src/dice.ts
      errors.ts            # moved from src/errors.ts
      stateIO.ts           # NEW — generic load / atomic-save / patch / validate<S>
      log.ts               # NEW — generic append-only jsonl audit writer
    (existing RPG modules stay put: character, combat, rules, session,
     chronicle, srd, state, types, cli.ts — only their imports change)
    realm/                 # NEW — the sim engine
      schema.ts            # zod realm-state contract + invariants
      economy.ts           # income / upkeep / food  (pure)
      events.ts            # weighted event tables
      resolve.ts           # tick resolution orchestrator (pure → new state)
      bridge.ts            # digest emitter for the RPG engine
      cli.ts               # `realm …` subcommands
  package.json             # + "realm": "tsx src/realm/cli.ts"
```

The refactor is mechanical (move 3 files, add 2, rewrite imports),
behavior-preserving, and gated by `npm run typecheck` before anything new is
built on top. The new generic `stateIO.ts` / `log.ts` are extracted from the
patterns currently in the RPG engine's `state.ts`; the RPG `state.ts` is then
re-expressed in terms of them (verified by typecheck), so both engines share one
atomic-write + audit-log implementation.

## 3. `realm.json` data model (abstract / clocks)

Lives at `campaigns/<name>/realm.json` with its own RNG cursor — fully replayable
like the RPG state. Standalone games place it in any dir via `--in <dir>`.

```jsonc
{
  "meta": { "realm": "Duchy of Vael", "ruler": "...", "turn": 3,
            "calendar": { "unit": "season", "value": "Summer 1387" } },
  "rng": { "seed": "vael-1387", "cursor": 412 },     // forward-only, auditable
  "resources": {
    "treasury": 120,                                  // gold stock (can't go negative)
    "food":     { "stock": 80, "production": 30, "consumption": 26 },
    "manpower": 150                                   // army pool (v2 mostly)
  },
  "clocks": {                                         // the abstract heart, all clamped
    "stability":  1,   // [-5,+5]
    "unrest":     2,   // [0,10]
    "prosperity": 0    // [-5,+5]
  },
  "policies": { "tax": "normal" },                    // low | normal | high (standing)
  "holdings": [ { "id": "market", "tier": 1 },        // built structures → modifiers
                { "id": "granary", "tier": 1 } ],
  "army":     { "strength": 0 },                      // single stub number in v1
  "pending":  [ { "kind": "build", "id": "barracks" } ], // queued this turn, resolved on tick
  "event":    null                                    // active event awaiting a choice, or null
}
```

Every write is zod-validated + invariant-checked before the atomic save, same as
the RPG engine. Derived numbers (net income, food surplus) are **computed, never
stored twice** — the existing engine's anti-drift rule.

## 4. Turn loop & command surface

A turn: *set policy (optional) → queue 1–2 actions → `realm tick` resolves
everything → read digest → narrate.*

```
realm init   --name "Duchy of Vael" --seed vael-1387 [--in <dir>]
realm status [--path resources.treasury]          # read-only, like `state get`
realm policy --tax low|normal|high                # standing, changeable
realm build  <structure>                          # queue → pending[]
realm edict  <type> [--gold N]                    # queue a discrete action
realm tick                                         # RESOLVE the turn (the engine moment)
realm choose --option A                            # answer an active event
realm patch  --set clocks.unrest=3                 # narrative-only change, validated+logged
realm bridge digest [--since <turn>]               # compact summary for the RPG GM
realm log read
```

`build` / `edict` only **queue** into `pending[]`; nothing mutates until `tick`.
All number changes happen inside one auditable resolution step.

## 5. `realm tick` — deterministic resolution pipeline

Each step is a pure `(state, rng) → state` function in `economy.ts` /
`events.ts` / `resolve.ts`, so it is unit-testable and replayable:

1. **Advance** turn counter + calendar.
2. **Income** = base + Σ holding yields + policy modifier − upkeep. Apply to
   treasury. Shortfall does **not** go negative — treasury floors at 0 and the
   unfunded gap drives an unrest (and, if large, stability) penalty, surfaced
   in the digest (honesty invariant). No separate debt resource in v1.
3. **Food** = production − consumption → surplus raises a clock, shortage raises
   unrest and can drop stability. Stored explicitly.
4. **Event** — draw one from a weighted table (auditable dice). Either
   auto-applies effects or sets `event` for the player to `choose`.
5. **Resolve `pending[]`** — builds complete (some with a dice check → cost
   overrun / delay, revealed); edicts apply effects.
6. **Clocks** — apply derived pressure (high tax → +unrest, prosperity drift),
   then **clamp to range, surfacing the clamp** rather than hiding it.
7. **Persist** — zod-validate → atomic write → append to `realm.log.jsonl` →
   print the JSON digest.

Dice use the shared `core/rng` + `core/dice`: realm "checks" are
`d20 + clock/holding modifier vs DC`; event tables are `2d6` / weighted draws.
The cursor only moves forward → provable that no roll was re-rolled.

## 6. The bridge (thin in v1, defined now)

`realm bridge digest` prints a compact, narration-ready summary the RPG GM weaves
in:

```jsonc
{ "realm": "Duchy of Vael", "turn": 3,
  "treasuryTier": "comfortable", "stability": "steady", "unrest": "murmurs",
  "crises": ["grain shortage in the eastern holdings"],
  "sinceLastDigest": ["raised taxes", "market built", "bandit raid repelled"] }
```

Descriptors (not raw numbers) so the GM narrates texture, not a spreadsheet.

- **v1:** one-directional (sim → RPG, read-only).
- **v2 (deferred):** reverse direction — RPG advances `tick` when narrative time
  passes; sim crises become RPG threads. The digest shape is fixed now so v2 does
  not churn it.

## 7. Invariants (engine-enforced, non-bypassable)

- Treasury never negative — it floors at 0 and the unfunded gap drives an
  unrest/stability penalty, surfaced.
- Clocks clamp to their ranges; the clamp is reported, not silent.
- Food shortage can't be hidden; consumption is always computed.
- RNG cursor strictly forward.
- Every write zod-validated; illegal transitions rejected, not silently fixed.

## 8. Testing

- **Unit** — pure resolution functions (`computeIncome`, `resolveFood`,
  `applyEvent`, `tick`) with a fixed seed → asserted outputs.
- **Golden replay** — a scripted command sequence + fixed seed → known end
  `realm.json` (mirrors the RPG engine's auditability; proves determinism).
- `npm run typecheck` gates the refactor and every change.

## 9. Explicitly deferred (not in v1)

- Army subsystem beyond a single `strength` number (recruit / pay / move /
  battle resolution) → v2.
- Reverse bridge (RPG drives sim ticks; sim crises → RPG threads) → v2.
- Higher fidelity (provinces, pops, markets, goods, trade routes) → only if a
  future game needs it; the abstract clocks are designed to deepen in place.

## 10. Build order (for the implementation plan)

1. Refactor: extract `core/` (`rng`, `dice`, `errors`, new `stateIO`, `log`);
   rewrite RPG imports; `typecheck` green.
2. `realm/schema.ts` — zod contract + invariants + `parseRealm`.
3. `realm/economy.ts` — pure income / upkeep / food functions + unit tests.
4. `realm/events.ts` — weighted event tables + dice draw.
5. `realm/resolve.ts` — the `tick` pipeline composing the above.
6. `realm/cli.ts` — `init / status / policy / build / edict / tick / choose /
   patch / log` subcommands; `package.json` script.
7. `realm/bridge.ts` — `digest` command.
8. Golden-replay test; docs (a short `realm` section / play protocol).
</content>
</invoke>
