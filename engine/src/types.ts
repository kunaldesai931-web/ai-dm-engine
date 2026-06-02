// Canonical state schema (zod). looseObject/record preserve descriptive fields the
// engine doesn't model, while invariants are enforced in a refinement pass.
import { z } from 'zod';
import { EngineError } from './core/errors';

export const HP = z.looseObject({
  current: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  temp: z.number().nullable().default(0),
});

export const SpellSlot = z.looseObject({ max: z.number(), used: z.number() });

export const ChronicleBufferEntry = z.looseObject({ t: z.string(), text: z.string() });
export const ChronicleLogEntry = z.looseObject({ t: z.string(), summary: z.string() });
export const Chronicle = z.looseObject({
  buffer: z.array(ChronicleBufferEntry).default([]),
  log: z.array(ChronicleLogEntry).default([]),
});

export const Abilities = z.looseObject({
  str: z.number().nullable().optional(),
  dex: z.number().nullable().optional(),
  con: z.number().nullable().optional(),
  int: z.number().nullable().optional(),
  wis: z.number().nullable().optional(),
  cha: z.number().nullable().optional(),
});

// Limited-use resource (Action Surge, Second Wind, Bardic Inspiration, etc.)
export const Resource = z.looseObject({
  used: z.number().int().min(0).default(0),
  max: z.number().int().min(1),
  recharge: z.enum(['short', 'long']),
});

export const Character = z.looseObject({
  name: z.string(),
  class: z.string().nullable().optional(),
  level: z.number().nullable().optional(),
  abilities: Abilities.optional(),
  profBonus: z.number().nullable().optional(),
  ac: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  initiativeMod: z.number().nullable().optional(),
  hp: HP.optional(),
  hitDice: z.looseObject({ used: z.number().int().min(0).default(0), max: z.number().int().min(1).optional() }).optional(),
  saves: z.array(z.string()).optional(),
  skills: z.record(z.string(), z.string()).optional(),
  spellSlots: z.record(z.string(), SpellSlot).optional(),
  knownSpells: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
  resources: z.record(z.string(), Resource).optional(),
  conditions: z.array(z.string()).optional(),
  effects: z.array(z.any()).optional(),
  inventory: z.array(z.any()).optional(),
  xp: z.number().nullable().optional(),
});

// Ticking-clock threat tracker. Each clock has N segments; filled segments show
// urgency. When filled === segments the trigger fires (surfaced in session start).
export const Clock = z.looseObject({
  label: z.string(),
  segments: z.number().int().min(2).max(12),
  filled: z.number().int().min(0).default(0),
  trigger: z.string().optional(),
});

export const State = z.looseObject({
  meta: z.looseObject({ campaign: z.string() }),
  rng: z.looseObject({ seed: z.string(), cursor: z.number().int().min(0) }),
  houseRules: z.looseObject({}).optional(),
  pcs: z.record(z.string(), Character).default({}),
  npcs: z.record(z.string(), Character).default({}),
  party: z.looseObject({ gold: z.number().optional() }).optional(),
  quests: z.record(z.string(), z.any()).optional(),
  factions: z.record(z.string(), z.any()).optional(),
  threads: z.record(z.string(), z.any()).optional(),
  clocks: z.record(z.string(), Clock).optional(),
  combat: z.any().optional(),
  chronicle: Chronicle.optional(),
}).superRefine((s, ctx) => {
  const all = { ...(s.pcs || {}), ...(s.npcs || {}) } as Record<string, any>;
  for (const [id, c] of Object.entries(all)) {
    if (c.hp) {
      const { current, max, temp } = c.hp;
      if (max != null) {
        if (max < 0) ctx.addIssue({ code: 'custom', message: `${id}: hp.max must be >= 0` });
        if (current != null && (current < 0 || current > max)) {
          ctx.addIssue({ code: 'custom', message: `${id}: hp.current ${current} out of [0, ${max}]` });
        }
      }
      if (temp != null && temp < 0) ctx.addIssue({ code: 'custom', message: `${id}: hp.temp must be >= 0` });
    }
    for (const [lvl, slot] of Object.entries((c.spellSlots || {}) as Record<string, any>)) {
      if (slot.used < 0 || slot.used > slot.max) {
        ctx.addIssue({ code: 'custom', message: `${id}: spell slot L${lvl} used ${slot.used} out of [0, ${slot.max}]` });
      }
    }
  }
});

export type TState = z.infer<typeof State>;
export type TCharacter = z.infer<typeof Character>;

// Parse + validate, converting zod failures into readable EngineErrors.
export function parseState(obj: unknown): TState {
  const r = State.safeParse(obj);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message || i.code).join('; ');
    throw new EngineError(`invalid state: ${msg}`);
  }
  return r.data;
}
