// The bridge: turns code-owned numbers into narration-ready descriptors the RPG
// GM can weave in. Descriptors, never raw numbers — the GM narrates texture, not a
// spreadsheet. v1 is one-directional (sim → RPG, read-only); the digest shape is
// fixed now so v2's reverse direction doesn't churn it.
import type { TRealm } from './schema';
import { INVASION_THRESHOLD } from './war';

export interface RealmDigest {
  realm: string;
  turn: number;
  treasuryTier: string;
  stability: string;
  unrest: string;
  war: string;
  crises: string[];
  sinceLastDigest: string[];
}

function band(value: number, bands: [number, string][]): string {
  // bands are [upperInclusive, label] in ascending order; last is the catch-all.
  for (const [upper, label] of bands) if (value <= upper) return label;
  return bands[bands.length - 1][1];
}

function treasuryTier(treasury: number): string {
  return band(treasury, [
    [0, 'empty'],
    [29, 'strained'],
    [99, 'modest'],
    [249, 'comfortable'],
    [Infinity, 'flush'],
  ]);
}

function stabilityWord(stability: number): string {
  return band(stability, [
    [-3, 'collapsing'],
    [-1, 'shaky'],
    [1, 'steady'],
    [3, 'firm'],
    [Infinity, 'unshakable'],
  ]);
}

function unrestWord(unrest: number): string {
  return band(unrest, [
    [1, 'calm'],
    [3, 'murmurs'],
    [6, 'restless'],
    [8, 'seething'],
    [Infinity, 'on the brink of revolt'],
  ]);
}

function crisesFrom(realm: any): string[] {
  const crises: string[] = [];
  if (realm.resources.treasury <= 0) crises.push('the treasury is empty');
  const food = realm.resources.food;
  if (food.stock <= 0 && food.consumption > food.production) crises.push('grain shortage across the holdings');
  if (realm.clocks.unrest >= 7) crises.push('unrest near open revolt');
  if (realm.clocks.stability <= -3) crises.push('the realm is fracturing');
  if (realm.war) crises.push(`${realm.war.invader} threatens the realm`);
  return crises;
}

function warWord(realm: any): string {
  if (realm.war) {
    return realm.war.strikesIn > 0
      ? `${realm.war.invader} is massing on the border`
      : 'the realm is under siege';
  }
  if ((realm.threat ?? 0) >= INVASION_THRESHOLD / 2) return 'distant war-drums';
  return 'peace holds';
}

export function buildDigest(realm: TRealm, sinceLastDigest: string[] = []): RealmDigest {
  return {
    realm: realm.meta.realm,
    turn: realm.meta.turn,
    treasuryTier: treasuryTier(realm.resources.treasury),
    stability: stabilityWord(realm.clocks.stability),
    unrest: unrestWord(realm.clocks.unrest),
    war: warWord(realm),
    crises: crisesFrom(realm),
    sinceLastDigest,
  };
}
