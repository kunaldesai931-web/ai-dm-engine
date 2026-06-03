import { z } from 'zod';
import { EngineError } from '../core/errors.js';

const Stats = z.object({
  melee: z.number().int().min(0),
  ranged: z.number().int().min(0),
  defense: z.number().int().min(0),
  resolve: z.number().int().min(0),
  initiative: z.number().int().min(0),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
});

const Injury = z.object({
  id: z.string(),
  name: z.string(),
  stat: z.enum(['melee', 'ranged', 'defense', 'resolve', 'initiative']),
  amount: z.number().int(),
});

const Death = z.object({
  cause: z.string(),
  battleId: z.string(),
  dayOfCampaign: z.number().int().min(0),
  location: z.string(),
});

const CompanionArc = z.object({
  questId: z.string(),
  stage: z.number().int().min(0),
  completed: z.boolean(),
});

export const RosterMember = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'companion', 'hireling']),
  backgroundId: z.string(),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  stats: Stats,
  traits: z.array(z.string()),
  perks: z.array(z.string()),
  injuries: z.array(Injury),
  gear: z.array(z.string()),
  wages: z.number().int().min(0),
  hiddenTrait: z.string().optional(),
  death: Death.optional(),
  arc: CompanionArc.optional(),
  morale: z.number().int().min(0).max(10),
}).superRefine((m, ctx) => {
  if (m.stats.hp > m.stats.maxHp) {
    ctx.addIssue({ code: 'custom', message: `${m.id}: hp ${m.stats.hp} exceeds maxHp ${m.stats.maxHp}` });
  }
});

export const CombatUnit = z.object({
  memberId: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'companion', 'hireling', 'enemy']),
  stats: Stats,
  currentHp: z.number().int().min(0),
  morale: z.number().int().min(0).max(10),
  position: z.object({ col: z.number().int().min(0), row: z.number().int().min(0) }),
  status: z.enum(['active', 'stunned', 'routing', 'down', 'dead']),
  hasActed: z.boolean(),
  hasMoved: z.boolean(),
}).superRefine((u, ctx) => {
  if (u.currentHp > u.stats.maxHp) {
    ctx.addIssue({ code: 'custom', message: `${u.memberId}: currentHp ${u.currentHp} exceeds stats.maxHp ${u.stats.maxHp}` });
  }
});

export const WarbandCampaignState = z.object({
  meta: z.object({
    campaign: z.string(),
    day: z.number().int().min(1),
    gold: z.number().int().min(0),
  }),
  rng: z.object({ seed: z.string(), cursor: z.number().int().min(0) }),
  protagonist: RosterMember,
  companions: z.record(z.string(), RosterMember),
  hirelings: z.record(z.string(), RosterMember),
  activeBattle: z.object({
    battleId: z.string(),
    units: z.record(z.string(), CombatUnit),
    turnOrder: z.array(z.string()),
    currentTurnIndex: z.number().int().min(0),
    grid: z.array(z.array(z.enum(['open', 'blocked', 'occupied']))),
  }).optional(),
});

export type TRosterMember = z.infer<typeof RosterMember>;
export type TCombatUnit = z.infer<typeof CombatUnit>;
export type TWarbandCampaignState = z.infer<typeof WarbandCampaignState>;

function wrapParse<T>(schema: z.ZodType<T>, obj: unknown, label: string): T {
  const r = schema.safeParse(obj);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message || i.code).join('; ');
    throw new EngineError(`invalid ${label}: ${msg}`);
  }
  return r.data;
}

export function parseRosterMember(obj: unknown): TRosterMember {
  return wrapParse(RosterMember, obj, 'RosterMember');
}

export function parseWarbandCampaignState(obj: unknown): TWarbandCampaignState {
  return wrapParse(WarbandCampaignState, obj, 'WarbandCampaignState');
}
