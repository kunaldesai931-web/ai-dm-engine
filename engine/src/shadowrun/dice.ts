import { EngineError } from '../core/errors.js';
import type { Roller } from '../core/rng.js';

export interface PoolResult {
  dice: number[]; hits: number; ones: number;
  glitch: boolean; critGlitch: boolean;
  net: number | null; success: boolean | null;
}

export function rollPool(roller: Roller, dice: number, threshold?: number): PoolResult {
  if (!Number.isInteger(dice) || dice < 0) throw new EngineError(`pool dice must be a non-negative integer, got ${dice}`);
  const rolled: number[] = [];
  for (let i = 0; i < dice; i++) rolled.push(roller.die(6));
  const hits = rolled.filter((d) => d >= 5).length;
  const ones = rolled.filter((d) => d === 1).length;
  const glitch = dice > 0 && ones >= Math.ceil(dice / 2);
  const critGlitch = glitch && hits === 0;
  let net: number | null = null;
  let success: boolean | null = null;
  if (threshold !== undefined) { net = hits - threshold; success = hits >= threshold; }
  return { dice: rolled, hits, ones, glitch, critGlitch, net, success };
}
