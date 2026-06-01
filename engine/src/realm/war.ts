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
