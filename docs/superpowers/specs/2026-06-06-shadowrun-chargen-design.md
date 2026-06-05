# Shadowrun Guided Character Builder — Design Spec
*2026-06-06*

## Overview

A "build your own runner" flow for the Shadowrun ruleset — the analog of the D&D guided chargen (SP2), adapted to Shadowrun. **Hybrid model:** Claude-as-GM guides the conversation; a new engine command (`sr create-runner`) **assembles and validates** a `ShadowrunActor` from the choices, owning every derived number. Builds on the shadowrun module merged in SP3 (`parseShadowrunActor`, condition-monitor formulas, `sr new-runner` pregens).

**Build method (locked):** simplified **point-buy** — budgets for attributes / skills / magic / resources. The *shape and terminology* echo SR5's official point-buy alternative (the Karma-build / Sum-to-Ten system in *Run Faster*) so a Shadowrun player recognizes it; the **point costs are our own** (the specific costs are the copyrightable expression — we dodge the priority grid for the same reason).

**Three archetypes must be mechanically real** (this drove three design fixes during review):
- **Street samurai** — mundane + **cyberware augmentations** that grant static modifiers (wired reflexes → +Reaction and initiative dice; muscle replacement → +Agility/Strength). Without real modifiers a samurai is just "high Agility + Firearms" — the archetype must exist mechanically.
- **Mage** — Awakened **magician**: Magic + tradition + spells, with **Drain owned by the engine/data**, never player-supplied.
- **Adept** — Awakened **adept**: Magic rating → **power points → adept powers** (no spells, no tradition). An adept is *not* a magician; the Awakened branch is three-way.

**IP note.** All bundled data (metatypes, spells' Drain values, powers, augmentations) is **original** — our own selection and numbers, expressed as game-mechanical facts (modifiers, flat Drain values). No reproduction of Catalyst's stat blocks, spell descriptions, priority/Karma cost tables, or setting text.

---

## Architecture

A new `engine/src/shadowrun/chargen.ts` (`assembleRunner` + data readers + budget constants), small original JSON data files under `engine/data/shadowrun/`, and `sr metatypes` / `sr create-runner` CLI commands. One minimal extension to existing SP3 code: `initiative()` reads an `initiativeDice` bonus so reflex augments/powers matter. The `ShadowrunActor` schema (`actor.ts`) gains a few optional fields. A retrofit tightens `sr cast` to look up Drain from the actor's spell (data-owned).

```
engine/data/shadowrun/
  metatypes.json       — human/elf/dwarf/ork/troll: attribute modifiers, natural min/max, edge base, innate armor
  spells.json          — { name, drain, category: 'mana'|'physical', combat?: true }   (our flat Drain values)
  powers.json          — adept powers: { name, cost, modifiers, note }                  (cost in power points)
  augmentations.json   — cyberware: { name, modifiers, note }                           (no Essence economy v1)
engine/src/shadowrun/
  chargen.ts           — NEW: assembleRunner(input) + readers (getMetatype/getSpell/getPower/getAugmentation) + BUDGET constants
  actor.ts             — EXTEND: magicType, tradition?, spells?, powers?, augmentations?, initiativeDice?
  combat.ts            — EXTEND: initiative() adds actor.initiativeDice to the rolled pool
engine/src/cli.ts      — sr metatypes, sr create-runner; sr cast gains --spell <name> (data-owned Drain)
rulesets/shadowrun.md  — note the build budgets + the three archetypes
.claude/skills/dm/SKILL.md — "Build a Runner" flow in the Shadowrun section
```

---

## Data (original, IP-clean)

### Metatypes (`metatypes.json`)
Five core metatypes. Each: `mods` (attribute deltas), `ranges` (natural min/max per attribute that the *bought* attributes must respect — augmentations may exceed), `edgeBase`, `armorInnate`. Representative (our values):
- **human** — no mods; ranges 1–6 all; edgeBase 3.
- **elf** — Agility +1, Charisma +2; Charisma max 8, Agility max 7; edgeBase 2.
- **dwarf** — Body +1, Strength +2, Willpower +1; Reaction max 5; edgeBase 2.
- **ork** — Body +3, Strength +2; Logic/Charisma max 5; edgeBase 2.
- **troll** — Body +4, Strength +3; Agility max 5, Logic max 5, Charisma max 4; edgeBase 1; `armorInnate` 1 (dermal).

### Spells (`spells.json`) — **engine-owned Drain**
Each spell: `{ name, drain (flat Drain Value), category: 'mana'|'physical', combat?: bool }`. Our own selection + flat DVs (e.g. Manabolt 3 / Stunbolt 3 / Powerbolt 3 / Heal 4 / Armor 4 / Invisibility 5 / Increase Reflexes 5 / Fireball 5). The player chooses spells **by name**; the engine fills each spell's Drain from this file. This is the fix to player-supplied Drain — Drain is data-owned at creation and in play.

### Adept powers (`powers.json`)
Each: `{ name, cost (power points), modifiers, note }`. e.g. `improved-reflexes-1` {cost 1.5, modifiers: { reaction: +1, initiativeDice: +1 }}; `improved-reflexes-2` {cost 2.5, modifiers: { reaction: +2, initiativeDice: +2 }}; `critical-strike` {cost 0.5, modifiers: { unarmedDamage: +1 }}; `mystic-armor-1` {cost 0.5, modifiers: { armor: +1 }}; `improved-ability-firearms` {cost 1, modifiers: { }, note: "+2 dice with Firearms" — narrated}. **Power points = the adept's Magic rating;** total `cost` of chosen powers ≤ Magic.

### Augmentations (`augmentations.json`)
Each: `{ name, modifiers, note }`. e.g. `wired-reflexes-1` { reaction: +1, initiativeDice: +1 }; `wired-reflexes-2` { reaction: +2, initiativeDice: +2 }; `muscle-replacement-2` { agility: +2, strength: +2 }; `bone-lacing` { body: +1, armor: +1 }; `dermal-plating-2` { armor: +2, body: +1 }. **No Essence economy in v1** — augmentations are a flat modifier list (the samurai's defining mechanical edge). Guidance (not enforced): the Awakened normally avoid heavy chrome.

---

## Budgets (named constants — tunable, our own)

```
ATTRIBUTE_POINTS = 20     // raise the 8 physical/mental attributes above a base of 1
SKILL_POINTS     = 24     // distributed across skills; each skill <= 6 at creation
EDGE_ALLOWANCE   = 2      // raise Edge above the metatype base (final Edge <= 7)
MAGIC_MAX        = 6      // magician/adept Magic rating range 1..6
ARMOR_MAX        = 12     // chosen armor rating cap (specific gear narrated)
```
These echo the *structure* of the official point-buy (attributes / skills / magic / resources allocations) with our own numbers.

---

## `sr create-runner` (assemble + validate)

```
sr create-runner --campaign C --id pc-1 --name "…" --metatype ork \
  --body N --agility N --reaction N --strength N --willpower N --logic N --intuition N --charisma N \
  --skills firearms:6,close-combat:4,intimidation:3 \
  [--edge N] [--armor N] \
  [--magic-type mundane|magician|adept] \
  [--magic N] \
  [--tradition hermetic|shamanic --spells Manabolt,Stunbolt] \      # magician only
  [--powers improved-reflexes-1,critical-strike] \                  # adept only
  [--augmentations wired-reflexes-1,muscle-replacement-2]
```

Assembly + validation (throws `EngineError` on any violation):
1. Validate metatype exists; load it.
2. **Attributes:** the `--body…--charisma` are the **bought** values; `sum(bought - 1) ≤ ATTRIBUTE_POINTS`; each bought attribute within the metatype's natural range. Then apply metatype `mods` + augmentation/power attribute modifiers → **final** attributes.
3. **Skills:** parse `name:rating`; `sum(ratings) ≤ SKILL_POINTS`; each rating ≤ 6.
4. **Edge:** `edge ≤ metatype.edgeBase + EDGE_ALLOWANCE` and ≤ 7; default = edgeBase.
5. **Magic:**
   - `mundane` → magic 0; reject any `--magic`, `--spells`, `--powers`, `--tradition`.
   - `magician` → magic 1..6; `--tradition` required; spells chosen by name (each must exist in spells.json); **spell count ≤ magic**; the actor's `spells` are stored as `{ name, drain }` with **drain read from spells.json** (not from input).
   - `adept` → magic 1..6; powers chosen by name (each in powers.json); **sum(power.cost) ≤ magic** (power points); reject spells/tradition.
6. **Augmentations:** each must exist in augmentations.json; apply their modifiers (attributes, `armor`, `initiativeDice`). (Available to any archetype in v1; no Essence/Magic-loss enforced.)
7. **Derived:** condition monitors via the existing formulas from **final** Body/Willpower; `armor` = chosen + innate + augmentation/power armor mods; `initiativeDice` = sum of initiative-dice modifiers; `magic` set per archetype.
8. Write the validated `ShadowrunActor` to `pcs.<id>` (refuse overwrite). `parseShadowrunActor` must accept the result.

`sr metatypes` returns the five metatypes (mods, ranges, edge base) so the GM can surface options.

### Actor schema additions (`actor.ts`)
Add optional: `magicType: 'mundane'|'magician'|'adept'`, `powers?: string[]`, `augmentations?: string[]`, `initiativeDice?: number`. (`tradition`/`spells` already exist.) All optional → existing pregens/actors still parse.

### `initiative()` extension (`combat.ts`)
Pool rolled = `reaction + intuition + (actor.initiativeDice ?? 0)`; score = `reaction + intuition`; total = score + hits. Extra initiative dice → more hits → faster — so reflex augments/powers matter. (Existing tests unaffected: default `initiativeDice` absent = 0.)

### `sr cast` retrofit (data-owned Drain)
Add `--spell <name>`: looks up the spell on the actor (whose Drain came from spells.json at creation) and uses its Drain. `--dv N` remains as an explicit override for ad-hoc spells. Removes player-set Drain from normal play.

---

## The guided flow (dm skill — "Build a Runner")

Parallel to the D&D session-zero, narrated not spreadsheet-y:
**metatype** (`sr metatypes`) → **attributes** (spend the 20; GM tracks the budget) → **skills** (spend the 24) → **archetype:** *street samurai* (pick augmentations), *mage* (tradition + spells by name — engine owns Drain), or *adept* (Magic → spend power points on powers); mundane is also fine → **Edge** (base + allowance) → **gear/armor tier** (armor number; gear narrated) → **name & concept** → one `sr create-runner` call → read back the assembled runner, confirm the numbers, into the opening scene.

---

## Testing & Acceptance

**Engine golden tests (`engine/test/sr-chargen.test.ts`):**
- An **Ork samurai**: bought attributes + ork mods → correct finals; with `wired-reflexes-1` → Reaction +1 and `initiativeDice` 1; monitors from final Body; Edge within base+allowance.
- A **mage**: spells chosen by name get **engine-filled Drain** (player can't set it); spell count > Magic throws; spell name not in spells.json throws; mundane-with-spells throws.
- An **adept**: powers with total cost ≤ Magic assemble (initiativeDice from improved-reflexes); powers over power-point budget throw; adept-with-spells throws.
- Budget violations throw: attribute points > 20; a bought attribute outside metatype range; skill points > 24; Edge over base+allowance.
- `sr metatypes` returns 5; `parseShadowrunActor` accepts every assembled runner.
- `initiative()` with `initiativeDice` rolls a larger pool (more potential hits) than without.
- `sr cast --spell <name>` uses the data-owned Drain (no `--dv` needed).

**Live play-test:** build one of each archetype with the GM, confirm the engine-assembled numbers (samurai's reflexes, mage's engine-owned Drain, adept's powers), drop into a scene.

---

## Out of Scope (v1)

Mystic adepts; technomancers/Resonance; the Essence economy (augmentations are flat modifiers, no Magic loss enforced); qualities (edges/flaws), contacts, lifestyle, nuyen gear shopping (armor is a number; gear narrated); the full priority/Karma cost economies. Five core metatypes only.

---

## Open Questions / Risks

- **Augmented vs natural attribute caps:** v1 validates *bought* attributes within the metatype's natural range and lets augmentations/mods exceed it (stored as the final value). A separate augmented-max cap is deferred.
- **Tunable numbers:** all budgets and the bundled data values (metatype mods, spell Drains, power costs, augmentation modifiers) are our own first-pass picks, isolated as constants/JSON — adjust freely after play; correcting any is a one-line/one-row change.
- **Cyberware on the Awakened:** v1 permits it without enforcing Magic loss; the dm flow steers mages/adepts away from chrome by guidance, not rule.
