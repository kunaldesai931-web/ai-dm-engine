# AI DM Engine — Rebuild Design (code-native)

Status: draft for review. **No engine code is written yet** — this is the spec we
agree on before building.

## 0. Goal & one-line thesis

A solo-GM tabletop engine where **deterministic code owns every number and every
state change, and the LLM only narrates and calls tools.** You play *inside a
Claude Code session*; git is the save system.

This replaces the chat + Google-Drive setup, whose discipline (canon-patch,
no-fudge, dice-reveal) is excellent but **unenforced** — the model both rolls the
dice and writes the state, so "No Fudging" is a request, not a guarantee.

## 1. Where everything lives

| Thing | Location |
|---|---|
| Code | this repo, branch `claude/dnd-code-exploration-JBT42` |
| Engine runtime | a TypeScript CLI run in-session via Bash (no server, no hosting) |
| Saves / state | files in `campaigns/<name>/`, versioned by git = save history + rewind |
| Old app | moved to `legacy/` (kept for reference, not part of the rebuild) |
| Optional | mirror canonical state to Google Drive for chat-project interop |

**Play surface decision:** play happens inside Claude Code. The "tools" are CLI
subcommands the assistant invokes; each prints structured JSON the assistant
narrates from. No MCP server, no standalone web app (those stay possible later but
are out of scope).

## 2. Repository layout (target)

```
ai-dm-engine/
  legacy/                     # old backend/ + frontend/, archived
  engine/
    src/
      schema/                 # zod schemas + inferred TS types (the contract)
      rng.ts                  # seedable, persisted RNG (reproducible rolls)
      dice.ts                 # dice-notation parser + roller
      rules/                  # 5e SRD mechanics: checks, saves, attacks, damage, rest
      state/                  # load, atomic-save, patch + validate, event log
      combat/                 # initiative + combat registry
      chronicle/              # region living-summaries (compression)
      tools/                  # one module per CLI subcommand
      cli.ts                  # dispatch
    package.json
    tsconfig.json
  campaigns/
    argent-legacy/
      state.json              # CANONICAL single source of truth
      modules/<region>.json   # hub-and-spoke region data
      chronicle/<region>.md   # regenerated living summaries
      log.jsonl               # append-only event log (every roll + patch)
  srd/                        # CC-BY-4.0 SRD content (spells, conditions, items)
  docs/REBUILD_DESIGN.md      # this file
  CLAUDE.md                   # the in-session play protocol (the contract)
```

## 3. State schema (single canonical `state.json`)

One file is the source of truth. No duplicated HP across documents (the current
Drive setup stores HP in both the master block and a separate ledger — that drift
class disappears). Derived views are computed, never stored twice.

```jsonc
{
  "meta": {
    "campaign": "Argent Legacy",
    "system": "dnd5e", "edition": "5.1-SRD",
    "tone": "...", "canonVersion": "1.0",
    "currentRegion": "forest-of-allanar",
    "worldTime": "Morning after the Old Watchtower",
    "sessionNumber": 4
  },
  "rng": { "seed": "argent-legacy-2026", "cursor": 1934 }, // persisted → rolls replayable + auditable
  "houseRules": { "noFudging": true, "diceReveal": true, "enemyHpVisible": true,
                  "pcRollsOwn": true, "aiRollsWorld": true },
  "pcs": { "maximus": CharacterSheet },
  "npcs": { "sybilla": CharacterSheet, "kiri": CharacterSheet },
  "party": { "gold": 35, "inventory": [Item], "reputation": { "<faction>": "..." } },
  "quests": { "<id>": { "status": "ongoing|done|failed", "objective": "...", "clue": "...", "stake": "..." } },
  "factions": { "<id>": { "attitude": "...", "clock": 0, "notes": "..." } },
  "threads": { "<id>": { "intro": "...", "clues": ["..."], "hidden": "...", "urgency": "low|med|high" } }
}
```

`CharacterSheet`:

```jsonc
{
  "name": "Maximus", "class": "Warlock", "level": 3,
  "abilities": { "str": 10, "dex": 12, "con": 14, "int": 10, "wis": 14, "cha": 17 },
  "profBonus": 2,
  "ac": 13, "speed": 30, "initiativeMod": 1,
  "hp": { "current": 19, "max": 19, "temp": 0 },
  "saves": ["wis", "cha"],          // proficient saves
  "skills": { "persuasion": "prof", "arcana": "expertise" },
  "spellSlots": { "2": { "max": 2, "used": 0 } },
  "knownSpells": ["eldritch-blast", "hex"],
  "features": ["pact-of-the-legacy"],
  "conditions": [],
  "effects": [ { "name": "mage-armor", "modifies": {"ac": 3}, "expires": "8h" } ], // auto-revert on removal
  "inventory": [ { "id": "potion-healing", "qty": 1 }, { "id": "obsidian-shard", "qty": 1 } ]
}
```

Every write is **validated against this schema (zod) + rule invariants** before it
touches disk. Illegal transitions are rejected, not clamped silently where a clamp
would hide a bug (HP clamps to `[0,max]`; spending a slot you don't have errors).

## 4. Tool surface (CLI subcommands)

Each command: load state → perform deterministic op (advance + persist RNG cursor)
→ validate → **atomic write** (temp → fsync → rename) + append to `log.jsonl` →
print JSON result. The assistant narrates *from the printed result* and never
emits a number a tool didn't return.

**Dice & checks** (real RNG, results include component dice for the dice-reveal rule):
```
engine roll <notation>                         # "3d6+2" -> {dice:[..], total}
engine check  --actor X --skill stealth --dc 15 [--adv|--dis]
engine save   --actor X --ability dex --dc 15 [--adv|--dis]
engine attack --attacker X --target Y --weapon radiant-rapier [--adv|--dis]
engine damage --target Y (--amount N | --roll 2d6) [--type radiant]
engine heal   --target Y --amount N
engine cast   --actor X --spell hex [--slot 2] [--targets Y,Z]
engine rest   --actor X --type short|long       # rejects long rest at 0 HP
```

**State & resources:**
```
engine state get [--path pcs.maximus.hp]
engine state patch --file patch.json            # validated delta, atomic, logged
engine modify --actor X --resource gold|xp --delta N   # xp crossing threshold => level-up flag
engine inventory add|remove --actor X --item Z [--qty N]
```

**Combat** (registry carries HP across attacks in a round; buffs auto-revert):
```
engine combat start --participants maximus,sybilla,blight-wolf-1,blight-wolf-2
engine combat next | engine combat end
```

**Campaign & session:**
```
engine campaign new|load|list <name>
engine region enter <id> | engine region leave   # archive/restore region context
engine session start    # prints 3-line re-entry brief from state + chronicle
engine session end      # loot/XP tally + state delta (shown before commit)
engine chronicle regen --region <id>             # regenerate (not append) living summary
```

## 5. The turn protocol (CLAUDE.md contract)

Phased resolution — mechanics settle before narration:

1. **Resolve.** On a player action needing any randomness or state change, the
   assistant calls the relevant `engine` command(s). All rolls + mutations happen here.
2. **Read.** It reads the JSON results.
3. **Narrate.** It describes the outcome and surfaces the dice (the result already
   carries the components, satisfying `diceReveal`).

Session start/end map to `engine session start` / `engine session end`. A git
commit per session (optionally per turn) is a save point; `git revert`/checkout is
the rewind.

## 6. What we're borrowing, and from where

| Idea | Source | Why |
|---|---|---|
| Engine-as-tools; AI reads rolls, never generates them | Project Infinity | makes `noFudging` true by construction |
| State authority with validation/clamping; reject illegal states | Project Infinity | no silent corruption |
| Phased "resolve then narrate" turn | Project Infinity | mechanics never trail the story |
| Combat registry (HP across attacks, buff auto-revert) | Project Infinity | combat-state correctness |
| Hub-and-spoke region modules w/ isolated context | NeverEndingQuest | infinite campaigns, clean separation |
| Living summaries regenerated each visit + context injection | NeverEndingQuest | clean re-entry after long gaps |
| Atomic write w/ backup; validate-before-apply | NeverEndingQuest | no half-written saves |
| CC-licensed SRD content | NeverEndingQuest | legally usable 5e rules |
| Canon-patch / no-fudge / dice-reveal discipline | **your existing chat setup** | already best-in-class; we enforce it in code |

**Our addition — auditable RNG:** seed + cursor are persisted in state, so the
entire roll history of a campaign is reproducible and *verifiable* (you can prove no
roll was secretly re-rolled). Stronger than any of the reference projects.

Deliberately deferred: TTS/voice + generative art (gpt-dungeon-master's roadmap),
and any database/accounts/web UI (GameMasterAI). Not needed for solo, code-native play.

## 7. Migration of the live campaign

`engine campaign import` reads the existing Argent Legacy Google Drive docs
(`00_CANONICAL_MASTER_STATE_BLOCK`, `05_MECHANICAL_LEDGER`, etc.) into one
`state.json`, flagging the many `TBD` fields (AC, ability scores, spell slots,
saves) for a one-time character-completion pass. The Drive naming drift
(`RPG_State_*.md` convention vs. the real numbered-docs folder) is retired — the
repo becomes canonical.

## 8. Open decisions for you

1. **Stack:** Node + TypeScript + zod (reuses the repo's existing JS toolchain).
   OK, or prefer Python (matches every reference project)?
2. **SRD scope:** bake in full SRD 5.1 spell/condition data up front, or start with
   only what Argent Legacy needs and grow it?
3. **Commit cadence:** auto-commit every turn (fine-grained rewind, noisier history)
   vs. once per session (clean history, coarser rewind)?
4. **Drive mirror:** keep writing canonical state back to Drive for chat interop, or
   go repo-only and treat chat as deprecated?
```
