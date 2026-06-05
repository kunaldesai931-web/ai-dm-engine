import { rollPool } from './dice.js';
import type { Roller } from '../core/rng.js';

export interface CastInput {
  force: number; magic: number;
  castingPool: number; drainValue: number; drainResistPool: number;
}
export interface CastResult {
  castHits: number; castGlitch: boolean;
  drainResistHits: number; drainTaken: number;
  drainType: 'stun' | 'physical'; overcast: boolean;
}

export function castSpell(roller: Roller, input: CastInput): CastResult {
  const cast = rollPool(roller, input.castingPool);
  const resist = rollPool(roller, input.drainResistPool);
  const drainTaken = Math.max(0, input.drainValue - resist.hits);
  const overcast = input.force > input.magic;
  return {
    castHits: cast.hits, castGlitch: cast.glitch,
    drainResistHits: resist.hits, drainTaken,
    drainType: overcast ? 'physical' : 'stun', overcast,
  };
}
