# Realm Simulation Engine — Army & Warfare (v2, increment 1)

Status: approved design, ready for implementation planning.
Date: 2026-06-01
Repo: `ai-dm-engine`
Builds on: `docs/superpowers/specs/2026-06-01-realm-sim-engine-design.md` (v1)

## 0. Thesis

v1 delivered a deterministic economic realm engine, but a well-run realm reaches a
**solved late-game utopia** — once stable, contented, and rich, nothing threatens
it. v2 adds the missing scaling threat: a **defensive warfare loop**. An external
invasion pressure rises over time and *with the realm's own prosperity and size*,
so success makes the realm a juicier target. The player funds a standing army to
survive it — real guns-vs-butter tension, with the army idle in peacetime being a
genuine cost.

Same honesty contract as v1: **the code owns every number and every state change;
the LLM only narrates.** Same engine, same `realm.json`, same tick. v2 is purely
additive: it extends the data model, adds one tick step, and adds three commands.

Scope of this increment: **defensive invasions + a strength×quality army.** The
reverse bridge (RPG drives sim ticks; sim crises → RPG threads) and any offensive
campaigns remain deferred to a later increment.

## 1. Locked design decisions

| Decision | Choice | Why |
|---|---|---|
| Threat model | **Defensive scaling invasions** | Directly fixes the solved late-game; code-owned; no second realm to simulate. |
| Army fidelity | **Strength × quality** (two abstract dimensions) | A real choice — cheap large levy vs expensive elite — without unit-type bookkeeping. Consistent with the abstract-clocks ethos. |
| Invasion timing | **Telegraphed (2-turn warning)** | The warning is the decision point: scramble to muster, or trust the standing army. A standing army is cheaper than panic-mobilizing. |
| Battle resolution | **Deterministic d20 vs d20, force-modified** | Auditable, replayable (forward-only cursor), narratable as a single decisive clash. |
| Mutation discipline | **recruit / drill queue into `pending[]`** | Preserves v1's invariant: all number changes happen inside one auditable `tick`. |
| Packaging | **Additive; new `realm/war.ts`** | War logic is a pure module composed by `resolve.ts`, like `economy.ts` / `events.ts`. RPG engine untouched. |

## 2. Data model additions (`realm.json`)

```jsonc
{
  // ... all v1 fields unchanged ...
  "army":   { "strength": 0, "quality": 1.0 },   // strength ≥ 0; quality clamped [0.5, 2.0]
  "threat":  0,                                   // invasion pressure ≥ 0, rises each tick
  "war":     null                                 // or { invader, force, strikesIn }
}
```

- `army.quality` is an effectiveness multiplier, default `1.0`, clamped to `[0.5, 2.0]`.
- `threat` is a hidden-pressure accumulator (≥ 0), surfaced in the digest as a descriptor.
- `war` is the active/incoming invasion, or `null`:
  ```jsonc
  "war": { "invader": "the Ashmark horde", "force": 42, "strikesIn": 2 }
  ```
  `strikesIn` counts down each tick; the battle resolves on the tick it reaches 0.

All additions are zod-validated and invariant-checked on every write, same as v1.
The fields are optional in the schema with sensible defaults so existing v1
`realm.json` files load unchanged (default army stub, `threat: 0`, `war: null`).

## 3. Threat & invasion mechanics

Pure functions in `realm/war.ts`; named constants so the model tunes in one place.

**Threat growth** (each tick, when no war is active):
```
threat += THREAT_BASE_GROWTH
        + floor(max(0, prosperity) * THREAT_PROSPERITY_FACTOR)
        + floor(holdings.length * THREAT_HOLDINGS_FACTOR)
```
A rich, sprawling realm draws more attention — the late-game counter-pressure.

**Invasion announcement** (when `threat ≥ INVASION_THRESHOLD` and `war == null`):
- `force = round(threat * INVASION_FORCE_FACTOR)` — bigger when ignored longer.
- `war = { invader, force, strikesIn: INVASION_WARNING_TURNS }` (2).
- `threat` resets to 0 (the pressure discharges into the invasion).
- `invader` name is selected deterministically by turn index into a small flavor
  list — **cosmetic, consumes no die** (so the battle stays the only war RNG draw).

**Countdown & strike:** if `war != null`, decrement `strikesIn`. When it reaches 0,
resolve the battle this tick (§4). While a war is incoming, `threat` does not grow.

## 4. Battle resolution (deterministic, auditable)

`resolveBattle(realm, roller)` — pure, consumes exactly two dice (cursor +2):

```
effective    = army.strength * army.quality
yourScore     = effective + roller.die(20)
invaderScore  = war.force  + roller.die(20)
win           = yourScore >= invaderScore
```

**On win (repelled):**
- casualties: `strength -= round(strength * WIN_CASUALTY_FRAC)` (~0.2)
- veterancy: `quality += VETERANCY_GAIN` (~0.1), clamped ≤ 2.0
- morale: `stability += 1`
- `war = null`

**On loss (sacked):**
- casualties: `strength -= round(strength * LOSS_CASUALTY_FRAC)` (~0.6)
- looted: `treasury -= round(treasury * SACK_TREASURY_FRAC)` (~0.4), floored at 0
- razed: the lowest-tier holding is down-tiered (tier−1; removed at tier 0;
  tie-break: the last such holding in the `holdings` list)
- `unrest += SACK_UNREST` (~3), `stability -= SACK_STABILITY` (~2), `prosperity -= 1`
- `war = null`

Every figure is code-owned and returned in a `BattleReport` (effective force, both
rolls, win/loss, casualties, each consequence). The narrator reads it; it invents
nothing. Clock changes flow through the existing clamp step (§5), so the sack can
push unrest/stability past their bounds and be clamped-with-surfacing like any other
pressure.

## 5. Tick pipeline (one new step)

The v1 pipeline gains **step 6 (War)**, between events and clocks:

1. Advance turn + calendar.
2. Income → treasury.
3. Food → stock.
4. Event draw → auto-apply / pause for choice.
5. Resolve `pending[]` — builds, edicts, **recruit, drill**.
6. **War (NEW)** — grow threat; if a war is incoming, count down and resolve the
   battle if it strikes; else announce an invasion if the threshold is crossed.
   Battle consequences mutate resources/clocks here.
7. Clocks — derived pressure (incl. this turn's war fallout), then clamp (surfaced).
8. Persist — zod-validate → atomic write → append log → print report + digest.

Army upkeep (in `economy.ts`) now scales with effectiveness:
`upkeep += round(strength * quality * ARMY_UPKEEP_PER_EFFECTIVE)` — so an elite army
carries an ongoing bill, making `drill` a real trade-off, not a free win.

`pending` handlers:
- `{ kind: 'recruit', strength: N }` — costs `N * RECRUIT_MANPOWER_COST` manpower and
  `N * RECRUIT_GOLD_COST` gold; adds `N` to `army.strength`. Insufficient
  manpower/gold recruits what can be afforded and surfaces the shortfall (no debt).
- `{ kind: 'drill' }` — costs `DRILL_GOLD_COST` gold; raises `army.quality` by
  `DRILL_QUALITY_GAIN`, clamped ≤ 2.0.

## 6. Command surface (additions)

```
realm recruit --strength N    # queue: muster N strength (manpower + gold, paid on tick)
realm drill                   # queue: train the army (gold -> +quality, paid on tick)
realm status                  # now also shows army { strength, quality }, threat, war
```

`build` / `edict` / `tick` / `choose` / `patch` / `bridge` / `log` are unchanged.

## 7. Bridge digest (additions)

The digest gains a war descriptor for the GM to weave in:

```jsonc
{ "realm": "Duchy of Vael", "turn": 12,
  "treasuryTier": "comfortable", "stability": "shaky", "unrest": "restless",
  "war": "a horde is massing on the border",   // | "the realm is under siege" | "peace holds"
  "crises": ["the eastern holding was sacked"],
  "sinceLastDigest": ["repelled the Ashmark raid"] }
```

`war` is a descriptor derived from `threat` tier and `war` state — never a raw number.

## 8. Invariants (additions to v1's set)

- Army strength never negative; quality clamped to `[0.5, 2.0]`.
- Treasury still never negative — a sack floors it at 0, never below.
- Battle consumes exactly two RNG dice; cursor strictly forward (battles replay).
- `threat ≥ 0`; an announced invasion discharges it to 0 (no double-spend).
- Every war mutation is code-owned and surfaced in the report; nothing silent.

## 9. Testing

- **Unit** — pure `war.ts` functions with a fixed seed/roller: `growThreat`,
  `maybeAnnounceInvasion` (fires at threshold, scales force, resets threat),
  `resolveBattle` (win/loss branches, casualty math, consumes 2 dice), and the
  `recruit`/`drill` pending handlers (afford / can't-afford).
- **Integration (resolve)** — a tick with an incoming war strikes on schedule;
  invariants hold after a sack (treasury ≥ 0, clocks clamped); threat grows faster
  in a prosperous realm than a poor one.
- **Golden replay** — extend the scripted sequence to provoke and survive (and lose)
  an invasion; a fixed seed reaches an identical end `realm.json` every run.
- **Balance shakedown** — a long seeded playthrough inspected for: does threat force
  army investment? does an undefended rich realm get sacked? does warfare break the
  late-game stalemate? Tune the §3–§5 constants from the observed curves.
- `npm run typecheck` gates every change.

## 10. Explicitly deferred (not in this increment)

- Offensive campaigns (muster + march at chosen objectives, take territory/loot).
- The reverse bridge (RPG drives sim ticks; sim crises → RPG threads).
- Typed units / rock-paper-scissors composition.
- Multi-front or simultaneous wars (one `war` at a time in this increment).

## 11. Build order (for the implementation plan)

1. `realm/schema.ts` — add `army.quality`, `threat`, `war`; defaults keep v1 files valid.
2. `realm/war.ts` — pure `growThreat`, `maybeAnnounceInvasion`, `resolveBattle`,
   recruit/drill cost helpers + unit tests.
3. `realm/economy.ts` — army upkeep scales with `strength × quality`.
4. `realm/resolve.ts` — integrate the War step; handle `recruit`/`drill` pending.
5. `realm/cli.ts` — `recruit` / `drill` commands; `status` surfaces army/threat/war.
6. `realm/bridge.ts` — `war` descriptor in the digest.
7. Golden-replay extension + balance shakedown + docs (`docs/realm-play.md` war section).
