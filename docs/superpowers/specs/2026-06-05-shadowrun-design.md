# Shadowrun Ruleset — Design Spec
*2026-06-05*

## Overview

Sub-project #3 of the AI-DM TTRPG re-center: add **Shadowrun** as a second playable rule system, exercising the pluggable ruleset seam (`meta.rulesetId` + `rulesets/<id>.md`) built in SP1. Claude is the live GM.

**Scope (locked):** an **Anarchy-light resolution skeleton** + the **streamlined core** (dice pools, glitches, condition monitors, Edge, attributes/skills), with **one deep subsystem: magic, grounded in SR5** (Force, the Spellcasting test, and Drain). The Matrix and rigging are narrated, not modelled. Built in two phases: **(A) core resolution**, then **(B) the magic module**.

**IP note.** Game *mechanics* (dice-pool math, attribute names, the cast→Drain loop) are not copyrightable and are implemented here. This project does **not** reproduce Catalyst Game Labs' copyrighted content — no official spell lists, gear tables, or setting text. `rulesets/shadowrun.md` is an original, concise mechanics summary. Spell *effects* are narrated by the GM; the engine only does the Force/hits/Drain math from values the GM supplies.

**Confidence flag.** The *shape* of these mechanics is high-confidence. The exact constants (condition-monitor box counts, the overcast→Physical-Drain trigger, soak interactions) are **medium-confidence, edition-blurred**; the spec states each as "the rule we implement," to be sanity-checked against the books. They are isolated as named constants/formulas so they're trivial to correct.

---

## Architecture

A new `engine/src/shadowrun/` module (parallel to `engine/src/warband/`), with `sr`-namespaced CLI commands wired into the main `cli.ts` (so the single engine bundle the `dm` skill calls gains them). The existing D&D `check/attack/save/cast` commands are **untouched** — Shadowrun never overloads them. Which command set the GM uses is driven by the campaign's `meta.rulesetId`.

```
engine/src/shadowrun/
  dice.ts     — rollPool(): the dice-pool primitive (hits/glitch/net)
  actor.ts    — Shadowrun actor shape + parseShadowrunActor; condition-monitor maxes
  combat.ts   — soak, applyDamage to monitors, overflow, initiative
  magic.ts    — castSpell(): Force → Spellcasting hits → Drain resolution  (Phase B)
  index.ts    — re-exports
engine/data/shadowrun/pregens/
  street-sam.json, mage.json
rulesets/shadowrun.md           — GM adjudication reference (original)
.claude/skills/dm/SKILL.md      — + Shadowrun adjudication section
```

CLI additions (in main `cli.ts`, calling the module): `sr pool`, `sr test`, `sr soak`, `sr damage`, `sr init`, `sr new-runner` (Phase A); `sr cast` (Phase B).

---

## The dice-pool primitive (the heart)

`rollPool(roller, dice, threshold?) → { dice: number[], hits, ones, glitch, critGlitch, net, success }`

The rule we implement:
- Roll `dice` d6 via the campaign's seeded roller (auditable, logged — same as `roll`).
- **Hit** = a die showing **5 or 6**. `hits` = count.
- **Glitch** = the number of **1s** is **≥ ceil(dice / 2)** (half or more of the pool came up 1).
- **Critical glitch** = glitch **and** `hits === 0`.
- If `threshold` given: `success = hits >= threshold`; `net = hits - threshold`. Opposed tests are resolved by the caller comparing two pools' hits (`net = attackerHits - defenderHits`).

CLI: `sr pool --campaign C --dice N [--threshold N]` → the result object. This consumes campaign RNG like `roll`, so it needs `--campaign`.

---

## Shadowrun actor shape

Stored under `state.pcs.<id>` (state is a loose object, so it coexists with the seam). `parseShadowrunActor` validates:

```
{
  name: string,
  sr: true,                         // tag marking this as a Shadowrun actor
  attributes: {                     // 1–6 typical, up to ~9 augmented
    body, agility, reaction, strength,
    willpower, logic, intuition, charisma,
    edge, magic                     // magic 0 for mundanes
  },
  skills: { [skill: string]: number },        // rating
  monitors: {
    physical: { max: number, damage: number },
    stun:     { max: number, damage: number }
  },
  edgeCurrent: number,
  armor: number,                    // single armor rating (Anarchy-light)
  // Awakened only:
  tradition?: 'hermetic' | 'shamanic',
  spells?: Array<{ name: string, drain: number }>   // drain = the spell's base Drain Value
}
```

**Condition-monitor maxes (the rule we implement):**
- Physical max = `8 + ceil(body / 2)`
- Stun max = `8 + ceil(willpower / 2)`
A helper computes these from attributes so pregens/`sr new-runner` are always consistent.

---

## Combat & damage (Anarchy-light)

- **Attack:** opposed pools — attacker's (skill + attribute) vs defender's dodge (Reaction + Intuition). The GM supplies both pools (or uses `sr test`); **net hits** add to the weapon's base damage value.
- **Soak:** `sr soak --actor ID --damage N [--ap N]` rolls a resist pool = `Body + max(0, armor - ap)`; each hit removes 1 box of incoming damage → returns **net damage**.
- **Apply:** `sr damage --actor ID --amount N --type physical|stun` fills that condition monitor. **Overflow** past the Physical max (beyond `body` extra boxes) = dying/dead; filling the Stun monitor = unconscious. Stun that overflows rolls over into Physical (the rule we implement). Returns the new monitor state + status (`ok|stunned|down|dying`).
- **Initiative:** `sr init --actor ID` = `reaction + intuition` (score) + hits from a Reaction+Intuition pool, used to order combatants. (Anarchy skips SR5's multiple initiative passes.)

---

## The magic module (Phase B — SR5-grounded)

The iconic, dangerous loop. `sr cast --actor ID --force N --dv N [--pool N]`:
1. **Force** `N` chosen by the caster (the GM may cap it; overcasting = Force > Magic).
2. **Spellcasting test:** roll `--pool` (= Magic + Spellcasting; defaults to the actor's `magic + skills.spellcasting` if omitted). `hits` = the spell's effect magnitude (damage, net successes — the GM narrates what the hits *do*).
3. **Drain:** Drain Value `--dv` (the spell's base Drain, supplied by the GM since spell lists aren't bundled). Resist with a pool = `Willpower + (Logic if hermetic | Charisma if shamanic)`. `net DV = max(0, dv - drainHits)`.
4. **Apply Drain:** net DV fills the **Stun** monitor — **unless overcasting (Force > the caster's Magic)**, in which case it's **Physical** (the rule we implement). Returns `{ castHits, drainResistHits, drainTaken, drainType, monitors }`.

This delivers Shadowrun's signature tension: more Force = more power, but Drain bites — and overcasting can put *you* on the floor.

*Deferred (fast-follow):* spirit summoning, counterspelling, sustaining penalties, spell defense.

---

## The GM layer

- **`rulesets/shadowrun.md`** — my original concise reference: dice-pool rules, the glitch table, condition monitors, soak, the cast→Drain loop, and *when* to call for a pool (only when failure is interesting). Plus the iron rule: the engine owns every hit, glitch, and point of Drain.
- **`dm` skill — Shadowrun section** (parallel to the 5e one): intent → `sr` command map (skill test → `sr test`/`sr pool`; firefight → opposed pools + `sr soak`/`sr damage`; spell → `sr cast`; initiative → `sr init`). Selected when `meta.rulesetId === 'shadowrun'`.
- **Two pregens** — a **street samurai** (chrome + guns, Magic 0) and a **mage** (so the magic module is exercised immediately). `sr new-runner --campaign C --id ID --from street-sam|mage` drops one into a fresh campaign (parallel to D&D `--from-pregen`, but SR-shaped). Pregens carry pre-computed condition monitors validated by `parseShadowrunActor`.

---

## Testing & Acceptance

**Engine (deterministic golden tests, via the seeded roller):**
- `rollPool`: a fixed seed yields a known hit count; a constructed all-1s pool flags `glitch`; all-1s with 0 hits flags `critGlitch`; threshold → correct `net`/`success`.
- Condition-monitor maxes: Body 5 → Physical max 11; Willpower 4 → Stun max 10 (per the formula).
- `soak`: damage 8, Body 5 + armor 6 vs AP 2 → resist pool 9, net damage = 8 − hits.
- `applyDamage`: filling/overflow transitions (`ok → stunned → down → dying`); Stun overflow rolls into Physical.
- `parseShadowrunActor`: accepts a valid runner, rejects malformed (missing attributes/monitors); both pregens parse and their monitor maxes match the formula.
- **Magic:** `castSpell` returns Force-scaled hits; Drain resisted reduces DV; overcast (Force > Magic) makes Drain Physical; the right monitor is filled.

**Live play-test (GM, with the user):** spin up a Shadowrun campaign from a pregen, run (1) a skill test with a glitch possible, (2) a short firefight (opposed pool → soak → monitor), and (3) a spell cast that takes Drain — confirming the engine owns the numbers and it *feels* like Shadowrun.

---

## Out of Scope (v1)

- Matrix/decking and rigging as subsystems (narrated).
- Spirit summoning, counterspelling, sustained-spell penalties (magic v1 = spellcasting + Drain).
- Full Shadowrun character creation / priority / Karma (v1 ships pregens; a guided SR build is a later sub-project).
- Cyberware/bioware Essence economy (narrated).
- SR5 multiple initiative passes, Limits.

---

## Build Phases

- **Phase A — Core resolution:** `dice.ts` (rollPool) + `actor.ts` (shape, parse, monitor maxes) + `combat.ts` (soak/damage/init) + `sr pool|test|soak|damage|init|new-runner` + `rulesets/shadowrun.md` + dm Shadowrun section + the two pregens. Playable: skill tests + firefights as GM.
- **Phase B — Magic module:** `magic.ts` (castSpell: Force/hits/Drain/overcast) + `sr cast` + magic guidance in the ruleset & dm section. The mage pregen comes alive.

---

## Open Questions / Risks

- **Constant verification:** the medium-confidence numbers (monitor formulas, overcast→Physical trigger, glitch threshold = half the pool) are stated as named constants/formulas — verify against the rulebooks during implementation; correcting one is a one-line change.
- **Two actor shapes in one engine:** D&D `Character` and Shadowrun actors both live under `pcs.<id>`. The `sr` commands validate with `parseShadowrunActor` and ignore D&D fields; the D&D commands are never invoked in a Shadowrun campaign (the GM is rulesetId-aware). No schema conflict because `state` is a loose object — but tests must confirm a Shadowrun actor round-trips through `parseState` untouched.
