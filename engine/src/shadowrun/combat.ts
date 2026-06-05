import { rollPool } from './dice.js';
import type { Roller } from '../core/rng.js';
import type { TShadowrunActor } from './actor.js';

type Monitor = { max: number; damage: number };
type Monitors = { physical: Monitor; stun: Monitor };
export type SrStatus = 'ok' | 'wounded' | 'unconscious' | 'down' | 'dead';

export function soak(actor: TShadowrunActor, roller: Roller, damage: number, ap = 0): { hits: number; netDamage: number } {
  const pool = actor.attributes.body + Math.max(0, actor.armor - ap);
  const r = rollPool(roller, pool);
  return { hits: r.hits, netDamage: Math.max(0, damage - r.hits) };
}

// Pure: returns NEW monitors + status. Stun overflow spills into physical 1:1.
export function applyDamage(monitors: Monitors, amount: number, type: 'physical' | 'stun', body: number): { monitors: Monitors; status: SrStatus } {
  const m: Monitors = {
    physical: { ...monitors.physical },
    stun: { ...monitors.stun },
  };
  if (type === 'stun') {
    const total = m.stun.damage + amount;
    if (total > m.stun.max) {
      m.stun.damage = m.stun.max;
      m.physical.damage += total - m.stun.max;
    } else {
      m.stun.damage = total;
    }
  } else {
    m.physical.damage += amount;
  }
  let status: SrStatus = 'ok';
  if (m.physical.damage > m.physical.max + body) status = 'dead';
  else if (m.physical.damage >= m.physical.max) status = 'down';
  else if (m.stun.damage >= m.stun.max) status = 'unconscious';
  else if (m.physical.damage > 0 || m.stun.damage > 0) status = 'wounded';
  return { monitors: m, status };
}

export function initiative(actor: TShadowrunActor, roller: Roller): { score: number; hits: number; total: number } {
  const score = actor.attributes.reaction + actor.attributes.intuition;
  const r = rollPool(roller, score);
  return { score, hits: r.hits, total: score + r.hits };
}
