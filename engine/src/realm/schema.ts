// Realm-state contract (zod) + invariants. Same honesty discipline as the RPG
// engine's types.ts: looseObject preserves descriptive fields the engine doesn't
// model; ranges and floors are enforced so illegal states are rejected, not fixed
// silently. parseRealm converts zod failures into readable EngineErrors.
import { z } from 'zod';
import { EngineError } from '../core/errors';

export const TAX_LEVELS = ['low', 'normal', 'high'] as const;

export const ARMY_QUALITY_MIN = 0.5;
export const ARMY_QUALITY_MAX = 2.0;

export const Army = z.looseObject({
  strength: z.number().min(0).default(0),
  quality: z.number().min(ARMY_QUALITY_MIN).max(ARMY_QUALITY_MAX).default(1.0),
});

export const War = z.looseObject({
  invader: z.string(),
  force: z.number().min(0),
  strikesIn: z.number().int().min(0),
});

export const Food = z.looseObject({
  stock: z.number(),
  production: z.number().min(0),
  consumption: z.number().min(0),
});

export const Resources = z.looseObject({
  treasury: z.number().int().min(0), // never negative — shortfalls floor at 0 in resolve
  food: Food,
  manpower: z.number().min(0),
});

// The abstract heart. Each clock is clamped to its range in resolve; the schema is
// the final guard — an out-of-range clock is an illegal state, rejected on write.
export const Clocks = z.looseObject({
  stability: z.number().int().min(-5).max(5),
  unrest: z.number().int().min(0).max(10),
  prosperity: z.number().int().min(-5).max(5),
});

export const Holding = z.looseObject({ id: z.string(), tier: z.number().int().min(1) });

export const Realm = z.looseObject({
  meta: z.looseObject({
    realm: z.string(),
    ruler: z.string().optional(),
    turn: z.number().int().min(0),
    calendar: z.looseObject({ unit: z.string(), value: z.string() }),
  }),
  rng: z.looseObject({ seed: z.string(), cursor: z.number().int().min(0) }),
  resources: Resources,
  clocks: Clocks,
  policies: z.looseObject({ tax: z.enum(TAX_LEVELS).default('normal') }).default({ tax: 'normal' }),
  holdings: z.array(Holding).default([]),
  army: Army.default({ strength: 0, quality: 1.0 }),
  threat: z.number().min(0).default(0),
  war: War.nullable().default(null),
  pending: z.array(z.any()).default([]),
  event: z.any().nullable().default(null),
});

export type TRealm = z.infer<typeof Realm>;
export type TTaxLevel = (typeof TAX_LEVELS)[number];

// Parse + validate, converting zod failures into readable EngineErrors.
export function parseRealm(obj: unknown): TRealm {
  const r = Realm.safeParse(obj);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message || i.code).join('; ');
    throw new EngineError(`invalid realm: ${msg}`);
  }
  return r.data;
}
