# Character Creation (Chargen) — Design Spec
*2026-06-05*

## Overview

Sub-project #2 of the AI-DM TTRPG re-center. A guided, conversational flow where Claude-as-DM walks the player through building a **full-SRD D&D 5e** character and drops it into a fresh campaign — so the player starts their own story instead of inheriting Aldric.

**Architecture decision (locked):** *hybrid* — the DM runs the conversation and supplies the creative choices (race/class/background/abilities/skills); a new engine `character create` command assembles a **correct, validated** character, computing every derived number (proficiency bonus, HP, AC, saves, skills, spell slots). The DM owns the choices; the engine owns the numbers — the same contract as the rest of the system.

**Content scope (locked):** full SRD. No data authoring required — the SRD 5.1 dataset is already vendored at `srd/2014-en/` (Classes, Races, Subraces, Backgrounds, Levels, Features, Traits, Skills, Proficiencies, Equipment, Spells). The work is *readers over existing data*, not content creation.

---

## Components

### 1. SRD readers (`engine/src/srd.ts` — extend)
Add readers over the already-vendored JSON:
- `getClass(q)` → hit die, saving-throw proficiencies, class skill list + count to choose, starting-equipment options, spellcasting info (ability, whether it casts).
- `getRace(q)` (+ subrace) → ability-score increases, speed, size, granted proficiencies/traits, languages.
- `getBackground(q)` → granted skill + tool proficiencies, starting equipment, a feature name.
- `getLevel(classIndex, level)` → proficiency bonus, features gained, and spellcasting progression (cantrips known, spell slots per level).

Expose in the CLI `lookup`: `srd class|race|background <name>` (alongside the existing `spell|weapon|condition|monster`).

### 2. `character create` command (new — the hybrid core)
`engine/src/rules.ts` (or a new `engine/src/chargen.ts`) implements assembly; `cli.ts` wires the command.

Signature:
```
character create --campaign <c> --id <slug> --name "<name>" \
  --race <srd-race> [--subrace <srd-subrace>] --class <srd-class> --background <srd-bg> \
  --str N --dex N --con N --int N --wis N --cha N \
  --skills skill1,skill2 [--armor <srd-armor>] [--cantrips a,b] [--spells c,d]
```

The provided `--str…--cha` are the **base** scores (pre-racial); the engine:
1. Validates race/class/background/subrace exist (via SRD readers) — else `EngineError`.
2. Applies racial (+ subrace) ability increases → final abilities.
3. Sets `level: 1`, `profBonus` from Levels data (=2 at L1).
4. **HP** = class hit die (max) + CON modifier.
5. `saves` = class saving-throw proficiencies.
6. `skills` = chosen `--skills` **validated** against (class skill options ∪ background-granted); rejects choices outside the allowed set or exceeding the class's pick count. Background skills auto-included.
7. `speed`, `size`, languages, racial traits → from race.
8. `ac` from `--armor` (SRD armor) + DEX (capped per armor type); default unarmored = 10 + DEX mod.
9. `hitDice` = `{ used: 0, max: 1 }` with the class die noted.
10. For casters: set `spellSlots` and cantrips/known spells from Levels data; validate `--cantrips`/`--spells` exist in SRD and are legal for the class/level; reject otherwise.
11. `features` = level-1 class features + background feature names.
12. Writes the assembled `Character` to `state.pcs.<id>`; refuses to overwrite an existing id.

Output: the complete character JSON (so the DM can read it back and narrate the result).

### 3. `campaign new` command (new — scaffold)
There is no new-campaign command today (only `campaign list|load`). Add:
```
campaign new --name <slug> [--ruleset 5e] [--seed <string>]
```
Creates `campaigns/<slug>/` with a valid `state.json` (`meta` incl. `campaign`, `rulesetId` default `5e`; `rng` with seed+cursor 0; empty `pcs`/`npcs`/`factions`/`clocks`) and an empty `log.jsonl`. Refuses if the campaign already exists. This gives a new hero somewhere to land.

### 4. Pre-made quick-start PCs (`engine/data/pregens/`)
2–3 ready PCs as JSON (e.g. a Fighter and a Wizard) for the "play now" path. Each is a complete `Character` object; the quick-start flow copies one into the new campaign via a thin `character create --from-pregen <id>` path (or direct state write). Pregens are generated/validated by the same assembly logic so they can't drift from the rules.

### 5. Guided chargen flow (skill)
Extend the `dm` skill (a "New Game / Session Zero" section) with two on-ramps:
- **Quick-start:** offer the pregens → `campaign new` → drop the chosen pregen in → open the scene. ~30 seconds.
- **Full build:** DM walks race → class → background → **ability scores** (player picks the method: roll `4d6 drop lowest` via the engine `roll` for honest dice, standard array `[15,14,13,12,10,8]`, or point-buy) → skill choices (from the class's allowed list, surfaced via `srd class`) → spells if a caster → name + one line of concept. Resolve the whole build in a single `character create` call. Narrated like session zero, not a form.

Both paths end by handing the new PC into the fresh campaign's opening scene (per the existing DM play loop).

---

## Data Flow

```
Player: "new game"
  → DM offers quick-start vs full build
  → [full] DM gathers choices conversationally; rolls abilities via engine `roll` if chosen
  → engine `campaign new --name <c>`
  → engine `character create --campaign <c> … ` (assembles + validates; engine owns numbers)
  → DM reads back the result, narrates the character, opens the first scene (DM play loop)
```

The engine is called via the fast bundle (`node engine/dist/cli.mjs …`) per the smoothness rules already established.

---

## Testing & Acceptance

**Engine (deterministic, TDD — golden tests):**
- `srd class fighter` / `srd race hill-dwarf` / `srd background soldier` return correct, real data (hit die d10; dwarf +2 CON, 25 speed; soldier grants athletics+intimidation).
- `character create` golden cases:
  - Hill Dwarf Fighter, base abilities given → final abilities include racial +2 CON (+1 WIS subrace), `profBonus 2`, HP = 10 + final-CON mod, saves = STR+CON, chosen skills validated, speed 25.
  - A Wizard → INT-based, gets level-1 spell slots + cantrips from Levels data; an illegal cantrip is rejected.
  - Illegal builds throw `EngineError`: unknown race/class, a skill outside the class+background set, too many skills, overwriting an existing PC id.
- `campaign new` scaffolds a state that `parseState` accepts and `session start` runs on; refuses duplicates.
- Each pregen JSON loads as a valid `Character` and matches what `character create` would assemble for the same inputs.

**The flow (play-tested):** build a character live (both quick-start and a full build), confirm it lands valid and playable, then open a scene with it through the DM play loop.

---

## Out of Scope (v1)

- Multiclassing, feats (the SRD `Feats.json` exists but feats are deferred).
- Subclass features beyond level 1 (most SRD subclasses begin at L3).
- Leveling *content* / class-feature progression (the `levelup` command already handles stat bumps).
- Any browser/app UI — chargen is conversational, like the rest of the live-DM model.

---

## Open Questions / Risks

- **SRD data shape variance:** the vendored JSON nests choices (e.g. class `proficiency_choices`, starting equipment options) in structures that need careful parsing. The readers must tolerate the real shapes — golden tests pin this against actual files, not assumptions.
- **Caster level-1 setup** is the most intricate path (slots + cantrips + known/prepared distinction). If a clean implementation slips, ship martial classes first and add caster assembly as a fast follow within this sub-project — but full SRD is the target.
