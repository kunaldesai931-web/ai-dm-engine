# Realm Simulation Engine — play protocol

A deterministic economic/kingdom engine parallel to the RPG engine. **Same
honesty contract: the code owns every number and state change; the narrator only
reads the JSON the engine prints.** Never invent a treasury figure, a clock value,
or an event outcome the engine did not return.

Design spec: `docs/superpowers/specs/2026-06-01-realm-sim-engine-design.md`.

## Running

```
npm run realm -- <command> [--in <dir>] [flags]
```

`--in <dir>` is the directory holding `realm.json` (and `realm.log.jsonl`).
Standalone games use any dir; a realm inside a campaign uses `campaigns/<name>/`.

## The turn loop

A turn is: **set policy (optional) → queue 1–2 actions → `tick` → read digest → narrate.**

```
realm init   --name "Duchy of Vael" --seed <seed> [--ruler "..."] [--calendar "Spring 1387"] --in <dir>
realm status [--path resources.treasury]      # read-only
realm policy --tax low|normal|high            # standing tax policy
realm build  <structure>                      # queue a build into pending[]
realm edict  <type> [--gold N] [--unrest N]   # queue a discrete action
realm tick                                    # RESOLVE the turn — the engine moment
realm choose --option <id>                    # answer an active event
realm patch  [--set clocks.unrest=3 ...]      # narrative-only change, validated + logged
realm bridge digest                           # narration-ready summary for the GM
realm log read
```

`build` / `edict` only **queue** into `pending[]`. Nothing mutates until `tick`:
all number changes happen inside one auditable resolution step.

## What `tick` does (deterministic, in order)

1. Advance turn + calendar (season cycle).
2. **Income** = base + Σ holding gold yields + tax modifier − upkeep. Treasury
   **floors at 0**; any unfunded gap drives unrest (and, if large, stability).
3. **Food** = production − consumption. Surplus banks into stock; a shortage
   floors stock at 0 and drives unrest/stability. Consumption is never hidden.
4. **Event** — one weighted draw (one die, forward-only cursor). Auto events apply
   immediately; choice events pause on `realm.event` until `realm choose`.
5. **Pending** — builds complete (holding added; food/manpower yields applied
   once); edicts apply their effects.
6. **Clocks** — derived pressure applied, then clamped to range. Every clamp is
   surfaced in the report, never silent.
7. **Persist** — zod-validate → atomic write → append to `realm.log.jsonl` →
   print the report + digest.

## Reading the digest

`bridge digest` emits **descriptors, not raw numbers** — narrate texture, not a
spreadsheet:

```jsonc
{ "realm": "Duchy of Vael", "turn": 3,
  "treasuryTier": "comfortable", "stability": "steady", "unrest": "murmurs",
  "crises": ["grain shortage across the holdings"], "sinceLastDigest": [] }
```

## Invariants (engine-enforced, non-bypassable)

- Treasury never negative — floors at 0, the gap surfaces as unrest/stability.
- Clocks clamp to range (`stability` ±5, `unrest` 0–10, `prosperity` ±5); the
  clamp is reported.
- Food shortage can't be hidden; consumption is always computed.
- RNG cursor strictly forward — the whole event history is replayable.
- Every write is zod-validated; illegal states are rejected, not silently fixed.

## Tests

```
npm test                 # unit + golden-replay (node:test via tsx)
npm run typecheck
```

The golden-replay test proves determinism: a fixed seed + scripted commands reach
an identical `realm.json` every run.

## Warfare (v2)

An invasion `threat` rises every peacetime tick — faster as the realm grows richer
and larger. When it crosses a threshold, an invasion is **announced** with a 2-turn
warning; you can `recruit` and `drill` to prepare. When the countdown strikes, the
engine resolves one deterministic battle: `army.strength x army.quality + d20` vs
`invader.force + d20`. Win and you repel them (light casualties, veterancy). Lose and
the realm is sacked — looted treasury, a razed holding, a spike in unrest, a drop in
stability. A standing army costs upkeep every turn (more for higher quality), so peace
is not free: it is the price of not being sacked.

    realm recruit --strength N   # muster (manpower + gold), resolved on tick
    realm drill                  # train (gold -> +quality), resolved on tick

Recruiting consumes manpower; a barracks holding produces it. The digest surfaces war
as a descriptor — "peace holds", "distant war-drums", "<invader> is massing on the
border", "the realm is under siege".

## Deferred to v2

Army beyond a single `strength` number; the reverse bridge (RPG drives sim ticks,
sim crises become RPG threads); higher fidelity (provinces, pops, trade). The
abstract clocks are designed to deepen in place.
