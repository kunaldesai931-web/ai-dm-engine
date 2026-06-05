# Ruleset: Shadowrun (Anarchy-light core + SR5-grounded magic)

The engine owns every die. This file tells the GM *when* and *how* to ask the engine. It is an original mechanics summary — no copyrighted spell lists, gear tables, or setting text. Spell *effects* are narrated by the GM; the engine does the Force/hits/Drain math.

Cyberpunk-fantasy: the players are **shadowrunners** — deniable freelancers pulling jobs in a world of megacorps, chrome, and magic. Keep it gritty, fast, and morally grey.

## The dice pool (every test)

A test rolls a pool of **d6**. Pool = **Attribute + Skill** (+ situational dice). Each die showing **5 or 6 is a hit**.

- **Glitch:** if **half or more** of the pool comes up **1** → a glitch. Something goes wrong even on a success (gun jams, alarm trips, a complication).
- **Critical glitch:** a glitch **with zero hits** → real trouble.
- **Threshold:** simple tests beat a threshold (Easy 1, Average 2, Hard 4, Extreme 6). Net hits = hits − threshold.
- **Opposed:** roll both pools; the actor with more hits wins; net hits = winner − loser.

Engine: `sr pool --dice N [--threshold N]`, or `sr test --actor ID --attr AGILITY --skill firearms [--threshold N]` to build the pool from the actor.

**Only call for a pool when failure is interesting and success is uncertain.** Otherwise narrate. Glitches are narrative gold — use them.

## Attributes & skills

Attributes: **Body, Agility, Reaction, Strength, Willpower, Logic, Intuition, Charisma**, plus **Edge** (luck) and **Magic** (0 for mundanes). Typical human range 1–6; augmented runners go higher. Skills are rated 1–6+. Common skills: firearms, close-combat, athletics, stealth, perception, con, hacking, spellcasting, etc.

## No HP — condition monitors

Two damage tracks of boxes:
- **Physical** = `8 + ceil(Body/2)` boxes.
- **Stun** = `8 + ceil(Willpower/2)` boxes.

Stun is fatigue, bruises, the soft stuff; Physical is bleeding-out wounds. Fill the **Stun** track → unconscious. Fill the **Physical** track → down/dying; overflow past it by more than your **Body** → dead. **Stun overflow rolls into Physical** 1:1.

Engine: `sr damage --actor ID --amount N --type physical|stun` fills a monitor and reports status (`ok | wounded | unconscious | down | dead`).

## Combat (Anarchy-light)

1. **Initiative:** `sr init --actor ID` → score (Reaction + Intuition) + hits. Order high-to-low. (No SR5 multi-pass dance.)
2. **Attack:** opposed pool — attacker's (skill + attribute) vs defender's dodge (Reaction + Intuition). Use `sr test` for each side, compare hits. **Net hits add to the weapon's damage value.**
3. **Soak:** the target resists with **Body + armor**: `sr soak --actor ID --damage N [--ap N]` (armor piercing reduces armor). Each soak hit removes one box of incoming damage → net damage.
4. **Apply:** `sr damage` the net damage to the right track.

Narrate the chrome, the muzzle flash, the spray of synth-blood. The engine tells you how many boxes; you tell the story.

## Edge

Edge is the runner's luck. Spend a point to (GM's call): add dice and reroll, push through a glitch, act first, or refuse to die. Track `edgeCurrent` on the actor; decrement when spent (`state patch` or narrate + adjust). Keep it precious.

## Magic — the cast → Drain loop (SR5-grounded)

Magic is power that **bites back**. To cast:
1. The mage picks a **Force** (raw power; higher = stronger, riskier). Casting at Force **above your Magic** is **overcasting**.
2. **Spellcasting test:** Magic + Spellcasting pool → **hits = the spell's effect** (damage dealt, successes to beat a defense — you narrate what the hits *do*).
3. **Drain:** every spell has a **Drain Value (DV)**. Resist it with **Willpower + Logic** (hermetic) or **Willpower + Charisma** (shamanic). Unresisted Drain = `max(0, DV − resist hits)`.
4. **The cost:** Drain fills the **Stun** monitor — **unless you overcast (Force > Magic), in which case it's Physical**. Push too hard and the magic puts *you* on the floor.

Engine: `sr cast --actor ID --force N --dv N [--pool N] [--resist N]`. It rolls both tests, applies the Drain to the right monitor, and returns `castHits` (the effect), `drainTaken`, `drainType`, and the updated monitors. Narrate the spell from the hits; respect the Drain the engine assigns.

*(v1 magic = spellcasting + Drain. Spirit summoning, counterspelling, and sustained-spell penalties are narrated for now.)*

## Subsystems run narratively (v1)

The **Matrix** (hacking) and **rigging** (drones/vehicles) are adjudicated narratively with ordinary pool tests (`sr test` against a threshold you set) — no separate mini-game yet. **Cyberware** is flavor + bonuses you fold into pools; Essence is narrated.

## The iron rule

Never state a hit, a glitch, a soak result, a point of Drain, or a condition-monitor box the engine didn't return. You decide *what* happens and *when* a test matters; the engine decides the numbers.
