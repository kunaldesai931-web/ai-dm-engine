import { z } from 'zod';
import { EngineError } from '../core/errors.js';

const Attr = z.number().int().min(0);
const Attributes = z.object({
  body: Attr, agility: Attr, reaction: Attr, strength: Attr,
  willpower: Attr, logic: Attr, intuition: Attr, charisma: Attr,
  edge: Attr, magic: Attr,
});
const Monitor = z.object({ max: z.number().int().min(1), damage: z.number().int().min(0) });

export const ShadowrunActor = z.object({
  name: z.string(),
  sr: z.literal(true),
  attributes: Attributes,
  skills: z.record(z.string(), z.number().int().min(0)),
  monitors: z.object({ physical: Monitor, stun: Monitor }),
  edgeCurrent: z.number().int().min(0),
  armor: z.number().int().min(0),
  tradition: z.enum(['hermetic', 'shamanic']).optional(),
  spells: z.array(z.object({ name: z.string(), drain: z.number().int() })).optional(),
});
export type TShadowrunActor = z.infer<typeof ShadowrunActor>;

export function physicalMonitorMax(body: number): number { return 8 + Math.ceil(body / 2); }
export function stunMonitorMax(willpower: number): number { return 8 + Math.ceil(willpower / 2); }

export function parseShadowrunActor(obj: unknown): TShadowrunActor {
  const r = ShadowrunActor.safeParse(obj);
  if (!r.success) throw new EngineError(`invalid Shadowrun actor: ${r.error.issues.map((i) => i.message || i.code).join('; ')}`);
  return r.data;
}
