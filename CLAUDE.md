# AI DM Engine — play protocol (read this before running a session)

This repo is a tabletop engine you run **inside a Claude Code session**. You are the
narrator and adjudicator. The `engine` CLI owns every die and every state change.

## The one rule

**Never state a number the engine didn't give you.** No imagined rolls, no eyeballed
HP, no "you take about 8 damage." If an outcome depends on chance or changes state,
call the engine and narrate from its JSON. This is what makes `noFudging` real
instead of aspirational.

If a check needs a stat the sheet doesn't have, the engine errors on purpose
(e.g. "DEX is not set"). Don't work around it — surface it and offer to fill the
sheet. Honest gaps beat invented numbers.

## Turn protocol (phased: resolve → read → narrate)

1. **Resolve.** For any action involving chance or state, call the relevant
   `engine` command(s). All randomness and mutation happen here.
2. **Read.** Read the returned JSON (it includes the component dice).
3. **Narrate.** Describe the outcome and reveal the dice (`diceReveal` is on).

Per the house rules in state: the player rolls their own PC actions; you roll
NPCs/world. Enemy HP is visible once combat starts.

## Session rituals

- **Start:** run `engine session start` and read the 3-line re-entry brief aloud
  (where we are, what's at stake, whose turn). Assume the player has forgotten the
  campaign — lead with this, every time. Never reconstruct state from memory; the
  state file is ground truth.
- **End:** run `engine session end`, show the summary, then **commit the campaign
  dir to git** — that commit is the save point. `git revert`/checkout is the rewind.

## Running the engine

From `engine/`: `npx tsx src/cli.ts <command> [flags]` (or `npm run engine -- <command>`).
TypeScript runs directly via `tsx` — no build step. `npm run typecheck` validates types.
With one campaign it's auto-selected; otherwise pass `--campaign <name>`.

```
session start | session end
roll <NdM+K>
check  --actor ID (--skill S | --ability A) [--dc N] [--adv|--dis]
save   --actor ID --ability A [--dc N] [--adv|--dis]
attack --attacker ID --target ID (--ability A --proficient | --bonus N) --damage NdM+K [--type T] [--adv|--dis]
damage --target ID (--amount N | --roll NdM+K) [--type T] [--crit]
heal   --target ID --amount N
cast   --actor ID --spell S [--slot N]          # SRD spells carry their own level (cantrip = no slot)
rest   --actor ID --type short|long
modify --resource gold --delta N | modify --actor ID --resource xp --delta N
inventory add|remove --actor ID --item ID [--qty N]
state get [--path a.b.c]
state patch [--file patch.json] [--set a.b=val ...]   # validated + atomic
combat start --participants id1,id2,... | combat next | combat end
monster add --from <srd-monster> [--as ID]      # spawn an SRD monster into npcs
srd spell|weapon|condition|monster <name>        # read-only SRD lookup
region enter <id> | region leave
campaign list | campaign load
```

Narrative-only changes (a quest clue advances, an NPC attitude shifts) go through
`state patch` so the canonical file stays the single source of truth.

## What lives where

- `campaigns/<name>/state.json` — canonical state, the only source of truth.
- `campaigns/<name>/log.jsonl` — append-only audit log (every roll + change, with
  the RNG cursor range it consumed). The campaign is fully replayable/verifiable.
- `engine/src/` — the deterministic core. See `docs/REBUILD_DESIGN.md` for the design.
- `legacy/` — the previous OpenAI-backed web app, archived, not part of play.

## Honesty invariants the engine enforces (don't try to bypass)

- HP clamps to `[0, max]`; reaching 0 sets `unconscious`.
- Long rest is refused at 0 HP; spell slots can't be over-spent; gold can't go negative.
- Attacks require the target's AC; checks require the relevant ability score.
- The RNG cursor only ever moves forward — proof no roll was secretly redone.
