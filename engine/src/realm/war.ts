// Warfare: pure threat growth, invasion announcement, battle math, and recruit
// cost. No I/O, no dice except the battle resolver. resolve.ts composes these.
import type { Roller } from '../core/rng';

// --- Threat & invasions ---
export const THREAT_BASE_GROWTH = 2;
export const THREAT_PROSPERITY_FACTOR = 1;   // floor(prosperity * this)
export const THREAT_HOLDINGS_FACTOR = 0.5;   // floor(holdings.length * this)
export const INVASION_THRESHOLD = 12;        // threat at/above this summons an invasion
export const INVASION_FORCE_FACTOR = 1.5;    // force = round(threat * this)
export const INVASION_WARNING_TURNS = 2;     // telegraph: turns before the strike

const INVADERS = [
  'the Ashmark horde', 'the Iron Reavers', 'the Saltmarsh raiders',
  'the Gray Company', 'the Broken Banner',
];

export interface War { invader: string; force: number; strikesIn: number; }

// Threat climbs each peacetime tick; a rich, sprawling realm draws more attention.
export function growThreat(threat: number, prosperity: number, holdingsCount: number): number {
  return threat
    + THREAT_BASE_GROWTH
    + Math.floor(Math.max(0, prosperity) * THREAT_PROSPERITY_FACTOR)
    + Math.floor(holdingsCount * THREAT_HOLDINGS_FACTOR);
}

// Build the incoming invasion. Caller checks threat >= INVASION_THRESHOLD and
// resets threat to 0 afterward. Invader name is cosmetic and consumes no die.
export function announceInvasion(threat: number, turn: number): War {
  return {
    invader: INVADERS[((turn % INVADERS.length) + INVADERS.length) % INVADERS.length],
    force: Math.round(threat * INVASION_FORCE_FACTOR),
    strikesIn: INVASION_WARNING_TURNS,
  };
}

export interface BattleOutcome {
  effective: number;    // strength × quality
  force: number;        // the invader's force
  yourRoll: number;     // d20
  invaderRoll: number;  // d20
  yourScore: number;    // effective + yourRoll
  invaderScore: number; // force + invaderRoll
  win: boolean;
}

// --- Recruitment & training costs ---
export const RECRUIT_MANPOWER_COST = 1;  // manpower per point of strength
export const RECRUIT_GOLD_COST = 2;      // gold per point of strength
export const DRILL_GOLD_COST = 30;       // gold to drill the army once
export const DRILL_QUALITY_GAIN = 0.2;   // quality raised per drill

export interface RecruitResult {
  recruited: number;     // strength actually added
  manpowerSpent: number;
  goldSpent: number;
  shortfall: number;     // requested − recruited (unfunded, no debt)
}

// Muster what the treasury and manpower can afford, up to the request. No debt:
// the shortfall is surfaced, not borrowed.
export function computeRecruit(_currentStrength: number, manpower: number, gold: number, requested: number): RecruitResult {
  const byManpower = Math.floor(manpower / RECRUIT_MANPOWER_COST);
  const byGold = Math.floor(gold / RECRUIT_GOLD_COST);
  const recruited = Math.max(0, Math.min(requested, byManpower, byGold));
  return {
    recruited,
    manpowerSpent: recruited * RECRUIT_MANPOWER_COST,
    goldSpent: recruited * RECRUIT_GOLD_COST,
    shortfall: requested - recruited,
  };
}

// One decisive clash. Consumes exactly two dice (yours, then the invader's) so the
// battle is replayable on a forward-only cursor. Pure: returns the outcome; the
// caller (resolve.ts) applies casualties and consequences.
export function resolveBattle(strength: number, quality: number, force: number, roller: Roller): BattleOutcome {
  const effective = strength * quality;
  const yourRoll = roller.die(20);
  const invaderRoll = roller.die(20);
  const yourScore = effective + yourRoll;
  const invaderScore = force + invaderRoll;
  return { effective, force, yourRoll, invaderRoll, yourScore, invaderScore, win: yourScore >= invaderScore };
}
