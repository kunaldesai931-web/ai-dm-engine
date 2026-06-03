# Warband Campaign System — Design Spec
*2026-06-03*

## Overview

A Battle Brothers-style campaign system built on the existing ai-dm-engine. Protagonist-led, permadeath, mixing RPG progression with strategy-layer simulation (factions, trade, war). Browser frontend renders combat grid and world map; CLI engine owns all state and resolution.

---

## Architecture

### Module structure

```
engine/src/
  warband/
    schema.ts         — RosterMember, CombatUnit, CampaignState types
    combat.ts         — grid combat resolution (turn order, attack, morale)
    campaign.ts       — overworld travel, contracts, wages, crisis arc
    progression.ts    — XP, leveling, injuries, trait assignment
    trade.ts          — belief-range market pricing, buy/sell resolution
    factions.ts       — reputation, faction events, inter-faction politics
    generator.ts      — procedural hireling/contract/enemy camp generation
    cli.ts            — warband CLI commands
  data/
    backgrounds.json  — protagonist + hireling background definitions
    enemies.json      — enemy type definitions (stats, traits, loot)
    injuries.json     — injury table (weapon category → stat penalty)
    perks.json        — perk tree definitions per background
    contracts.json    — contract type templates
  realm/              — unchanged, drives world simulation
  core/               — unchanged, shared utilities (dice, stateIO, rng)

frontend/src/
  components/
    BattleGrid.tsx    — 5×8 square grid combat map
    WorldMap.tsx      — region map with faction territory, travel, contracts
    Roster.tsx        — protagonist + companions + hirelings panel
    MarketPanel.tsx   — town market with prices, buy/sell
```

State saved to `engine/state/warband/<campaign-id>.json`.

### Key architectural split (from OpenXcom/Wesnoth research)

`RosterMember` — persistent campaign entity. Tracks career stats, injuries, death record, XP, traits, gear, wages. Never deleted on death — a `death` record is attached.

`CombatUnit` — transient battle entity. Snapshot of a RosterMember for the duration of one battle. Holds position, current HP, status effects, turn state. Discarded after battle; results written back to RosterMember.

---

## Character System

### Protagonist

Created at campaign start. Player picks a **background** (defined in `backgrounds.json`) which grants:
- Starting stat spread (Melee, Ranged, Defense, Resolve, Initiative, HP)
- One starting trait
- Starting gear loadout
- Perk pool (which perks are available at level-up)

Stats: `melee | ranged | defense | resolve | initiative | hp | maxHp`

No D&D classes. Skills unlock through leveling, tied to background perk pool.

### Named companions (max 4)

Met in the world through events and quests. Each has:
- A personal arc (a quest chain, tracked in campaign state)
- Permadeath ends their arc permanently and attaches a death record
- No wages — but have personal needs (arc progress, morale events)
- Full injury table on reaching 0 HP (same as protagonist)

### Hirelings

Procedurally generated. Have:
- A background (from `backgrounds.json`)
- Two traits — one visible at hire, one hidden (revealed after first battle)
- A wage (gold/week)
- **On reaching 0 HP**: D6 roll — 1-2 = dead (death record attached), 3-6 = recovers. No injury table. Simple bookkeeping.

### Permadeath record

```typescript
interface Death {
  cause: string        // e.g. "Killed by Bandit Leader"
  battleId: string
  dayOfCampaign: number
  location: string
}
```

Protagonist death ends the run. A legacy screen is shown summarising the campaign: days survived, contracts completed, companions lost, crisis progress.

---

## Combat System

### Grid

5 columns × 8 rows square grid. Each tile: `open | blocked | occupied`.

Rendered in `BattleGrid.tsx`. CLI engine owns all state; browser polls and renders. Player sends commands via existing API pattern.

### Turn order

Initiative stat + d6 roll at battle start. Fixed order for the battle duration.

### Turn structure

Each turn: **move** (up to Speed tiles) + **one action**:
- `attack <target>` — melee or ranged
- `ability <name> <target>` — use a perk ability
- `item <name>` — use an item
- `disengage` — move away without opportunity attack

### Attack resolution

```
attacker rolls d20 + Melee (or Ranged)
vs defender Defense score

hit     → roll damage die + stat modifier
crit    → max damage + roll on injury table
miss    → normal
miss by 5+ → attacker loses next action (stumble)
```

### Injury system (two-tier)

**Protagonist + named companions** — injury triggered when:
- Incoming damage ≥ 50% of max HP in one hit, OR
- HP drops to 0

Injury type determined by weapon category (defined in `injuries.json`):
- **Blunt** → movement/initiative penalties (e.g. "Cracked Rib": -1 Initiative)
- **Cutting** → offense penalties (e.g. "Sword Arm Cut": -1 Melee)
- **Piercing** → vision/resolve penalties (e.g. "Gut Wound": -1 Resolve)

Permanent injuries persist across all future battles.

At 0 HP, roll on the full injury table — result may be: knocked out (misses next battle), maimed (permanent stat penalty), or dead. Protagonist and named companions are never instantly killed at 0 HP.

**Hirelings** — at 0 HP: D6 roll, 1-2 = dead, 3-6 = recovers. No injury detail.

### Morale

Each combatant has a Resolve score. Morale events:
- At 50% casualties, living enemies roll Resolve or rout
- **Morale cascade**: when a unit is eliminated, it deals `d6` morale damage to each ally within 3 tiles, reduced by their Resolve. Allies dropping to 0 morale rout immediately.
- Named enemies never rout
- Hirelings can rout if morale breaks

---

## Overworld & Campaign Loop

### World structure

3–5 named **regions** (fixed per run). Each region:
- 2–4 towns (fixed locations, named, faction-aligned)
- 1–2 landmarks (dungeon, ruin, shrine — fixed)
- Procedurally placed contract locations and enemy camps each run

### Travel

`travel <location>` command. Each leg:
- Costs days (advances ticking clocks)
- Random encounter chance (scales with region danger)
- Provisions consumed per day × roster size

### Campaign loop

```
town → browse contracts → hire/fire roster → travel → encounter/battle
     → return → pay wages → level up → town
```

### Wages

Hirelings cost gold/week. On weekly payday:
- Can't pay → hireling deserts or turns hostile (based on their traits)
- Named companions don't require wages but track morale separately

### Contracts

Generated per town, based on faction alignment. Types: escort, bounty, raid, defense, investigation. Each has:
- Gold reward + reputation reward (with issuing faction)
- Failure penalty (reputation loss, sometimes gold penalty)
- Time limit (advances clock pressure)

### Crisis arc

Each run generates one main threat at campaign start (e.g. "The Ironblood Warlord is uniting the border clans"). Completing contracts builds:
- **Intel** (clues toward the crisis)
- **Reputation** (needed to access the final confrontation)

Completing the arc = win condition. World continues after — open-ended play resumes.

### Ticking clocks

Reuse existing `realm/` clock system. Example clocks:
- Crisis advancement (advances on time passing + failed contracts)
- Faction war escalation
- Seasonal resource scarcity

---

## Trade & Factions

### Factions

4–5 named factions, each region-aligned. Each faction tracks:
- `reputation` score with the player (-100 to +100)
- `disposition` toward other factions (ally/neutral/hostile) — driven by realm simulation
- Unique contract types
- Rep perks: better prices (≥50), rare gear access (≥75), safe passage (≥25), embargo (≤-50), enforcers sent (≤-75)

Reputation changes from: contracts completed/failed, killing faction members, helping their enemies, story choices.

### Trade

Each town has a market. Goods: weapons, armor, provisions, tools, luxury items.

**Belief-range pricing** (from bazaarBot research): each town maintains a `(estimatedPrice, certainty)` pair per commodity. Prices drift based on realm economy events — war drives up weapons, plague drives up medicine, trade routes affect luxury items. No global price table; prices emerge from distributed town-level estimates.

Player commands: `trade buy <item> <qty>`, `trade sell <item> <qty>`.

Carrying capacity = roster size × 10 units + pack animal bonus (purchasable).

**Faction × trade**: high Merchant Guild rep → buy prices -10%. Border Lords allied → no regional tariff. Hostile faction → embargo (their towns won't trade).

---

## Data-Driven Content

All unit backgrounds, enemy types, injuries, perks, and contract templates defined in JSON files under `engine/data/`. The engine reads these at startup — no hardcoded stat defaults. This makes campaigns extensible without code changes.

Example background entry (`backgrounds.json`):
```json
{
  "id": "sellsword",
  "name": "Sellsword",
  "stats": { "melee": 4, "ranged": 1, "defense": 3, "resolve": 2, "initiative": 3, "hp": 14 },
  "startingTrait": "hardened",
  "startingGear": ["shortsword", "shield", "leather-armor"],
  "perkPool": ["shield-wall", "counter-attack", "iron-will", "quick-hands"]
}
```

---

## Sub-project Build Order

The system builds in 4 independently playable sub-projects:

| # | Sub-project | Deliverable |
|---|---|---|
| 1 | **Warband core** | Schema, protagonist/companion/hireling, progression, injuries. Playable via CLI. |
| 2 | **Tactical combat** | Grid engine + BattleGrid.tsx in browser. Combat loop playable end-to-end. |
| 3 | **Overworld & contracts** | Travel, contract generation, campaign loop, crisis arc, wages. Full campaign loop. |
| 4 | **Trade & factions** | Market pricing, reputation system, faction events. Economy layer complete. |

Each sub-project ships working before the next begins.

---

## Open Questions (from research)

- Perk tree: branching with mutually exclusive choices, or flat pool per background?
- Fog of war on combat grid: yes/no?
- Overworld: turn-based (move one leg per "day") or real-time with pause?
- MekHQ-style turnover/retention for hirelings (probability function over morale/pay) — or keep simple desertion?
