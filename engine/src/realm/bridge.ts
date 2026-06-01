// The bridge: turns code-owned numbers into narration-ready descriptors the RPG
// GM can weave in. Descriptors, never raw numbers — the GM narrates texture, not a
// spreadsheet. v1 is one-directional (sim → RPG, read-only); the digest shape is
// fixed now so v2's reverse direction doesn't churn it.
import type { TRealm } from './schema';

export interface RealmDigest {
  realm: string;
  turn: number;
  treasuryTier: string;
  stability: string;
  unrest: string;
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

function crisesFrom(realm: Pick<TRealm, 'resources' | 'clocks'>): string[] {
  const crises: string[] = [];
  if (realm.resources.treasury <= 0) crises.push('the treasury is empty');
  const food = realm.resources.food;
  if (food.stock <= 0 && food.consumption > food.production) crises.push('grain shortage across the holdings');
  if (realm.clocks.unrest >= 7) crises.push('unrest near open revolt');
  if (realm.clocks.stability <= -3) crises.push('the realm is fracturing');
  return crises;
}

export function buildDigest(realm: TRealm, sinceLastDigest: string[] = []): RealmDigest {
  return {
    realm: realm.meta.realm,
    turn: realm.meta.turn,
    treasuryTier: treasuryTier(realm.resources.treasury),
    stability: stabilityWord(realm.clocks.stability),
    unrest: unrestWord(realm.clocks.unrest),
    crises: crisesFrom(realm),
    sinceLastDigest,
  };
}
