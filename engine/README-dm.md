# Playing with the AI Dungeon Master

The main way to play is a **live session with Claude as your DM**, backed by this engine for honest dice, 5e rules, and a persistent world with memory.

## One-time setup

Build the fast-start engine bundle (sub-second CLI calls — keeps play smooth):

```
npm --prefix engine install
npm --prefix engine run build      # produces engine/dist/cli.mjs
```

Re-run `npm --prefix engine run build` after changing engine source.

## How to play

Invoke the **`dm`** skill (`.claude/skills/dm/SKILL.md`). Claude will:
- load the campaign (state + chronicle + the NPCs' persona/memory files),
- narrate, voice NPCs, and adjudicate,
- call `node engine/dist/cli.mjs …` for every die, check, and saved change — never fabricating numbers,
- keep the world persistent (chronicle + per-NPC memory).

Campaigns live in `campaigns/<name>/`. Resume `the-hollow-road`, or start a new one.

## How it's wired

- **Engine = honest dice + rules + state.** `engine/dist/cli.mjs <cmd> --campaign <name>` (full command list: `node engine/dist/cli.mjs help`).
- **Ruleset seam:** `state.meta.rulesetId` (default `5e`) selects which `rulesets/<id>.md` the DM consults. Add a system later by adding a `rulesets/<id>.md`.
- **No browser UI needed** — the live-DM model is played in chat (including from mobile via Claude Code remote control).
- Warband tactical/strategy systems live under `engine/src/warband/` as optional add-ons for later.
