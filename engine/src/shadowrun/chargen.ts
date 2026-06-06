import { EngineError } from '../core/errors.js';
import { physicalMonitorMax, stunMonitorMax, type TShadowrunActor } from './actor.js';

export const BUDGETS = { ATTRIBUTE_POINTS: 20, SKILL_POINTS: 24, MAX_SKILL: 6, EDGE_ALLOWANCE: 2, MAGIC_MAX: 6, ARMOR_MAX: 12 };

const ATTR_KEYS = ['body', 'agility', 'reaction', 'strength', 'willpower', 'logic', 'intuition', 'charisma'] as const;
type AttrKey = (typeof ATTR_KEYS)[number];

export interface Metatype { id: string; name: string; mods: Record<string, number>; ranges: Record<string, [number, number]>; edgeBase: number; armorInnate: number; }
export interface SpellDef { name: string; drain: number; category: string; combat?: boolean; }
export interface PowerDef { name: string; cost: number; modifiers: Record<string, number>; }
export interface AugDef { name: string; modifiers: Record<string, number>; }
export interface SrChargenData { metatypes: Metatype[]; spells: SpellDef[]; powers: PowerDef[]; augmentations: AugDef[]; }

export interface RunnerInput {
  name: string; metatype: string;
  attributes: Record<AttrKey, number>;     // BOUGHT 1..6 (range per metatype)
  skills: Record<string, number>;
  edge?: number; armor?: number;
  magicType?: 'mundane' | 'magician' | 'adept';
  magic?: number; tradition?: 'hermetic' | 'shamanic';
  spells?: string[]; powers?: string[]; augmentations?: string[];
}

function applyMods(acc: { attrs: Record<string, number>; armor: number; initiativeDice: number }, mods: Record<string, number>) {
  for (const [k, v] of Object.entries(mods)) {
    if ((ATTR_KEYS as readonly string[]).includes(k)) acc.attrs[k] += v;
    else if (k === 'armor') acc.armor += v;
    else if (k === 'initiativeDice') acc.initiativeDice += v;
    // unknown keys (e.g. unarmedDamage) are narrated, not applied
  }
}

export function assembleRunner(input: RunnerInput, data: SrChargenData): TShadowrunActor {
  const meta = data.metatypes.find((m) => m.id === input.metatype);
  if (!meta) throw new EngineError(`unknown metatype "${input.metatype}"`);

  // attributes: validate bought ranges + budget
  let spent = 0;
  for (const k of ATTR_KEYS) {
    const v = input.attributes[k];
    const [lo, hi] = meta.ranges[k] ?? [1, 6];
    if (v < lo || v > hi) throw new EngineError(`${meta.name} ${k} must be ${lo}–${hi}, got ${v}`);
    spent += v - 1;
  }
  if (spent > BUDGETS.ATTRIBUTE_POINTS) throw new EngineError(`attribute points over budget: ${spent} > ${BUDGETS.ATTRIBUTE_POINTS}`);

  // skills
  let skillSpent = 0;
  for (const [name, r] of Object.entries(input.skills)) {
    if (r > BUDGETS.MAX_SKILL) throw new EngineError(`skill "${name}" rating ${r} exceeds ${BUDGETS.MAX_SKILL}`);
    skillSpent += r;
  }
  if (skillSpent > BUDGETS.SKILL_POINTS) throw new EngineError(`skill points over budget: ${skillSpent} > ${BUDGETS.SKILL_POINTS}`);

  const magicType = input.magicType ?? 'mundane';

  // collect modifier sources (augmentations now; powers in Task 4)
  const modSources: Array<Record<string, number>> = [];
  for (const augName of input.augmentations ?? []) {
    const aug = data.augmentations.find((x) => x.name === augName);
    if (!aug) throw new EngineError(`unknown augmentation "${augName}"`);
    modSources.push(aug.modifiers);
  }

  // magic validation (core handles mundane; Task 4 fills magician/adept)
  let magic = 0;
  let spellEntries: Array<{ name: string; drain: number }> | undefined;
  let powerNames: string[] | undefined;
  if (magicType === 'mundane') {
    if (input.magic || input.spells?.length || input.powers?.length || input.tradition) {
      throw new EngineError('mundane runners cannot have magic, spells, powers, or a tradition');
    }
  } else if (magicType === 'magician') {
    magic = input.magic ?? 0;
    if (magic < 1 || magic > BUDGETS.MAGIC_MAX) throw new EngineError(`magician Magic must be 1–${BUDGETS.MAGIC_MAX}`);
    if (!input.tradition) throw new EngineError('a magician needs a tradition (hermetic|shamanic)');
    if (input.powers?.length) throw new EngineError('magicians use spells, not powers');
    const names = input.spells ?? [];
    if (names.length > magic) throw new EngineError(`a magician knows at most Magic (${magic}) spells, got ${names.length}`);
    spellEntries = names.map((n) => {
      const sp = data.spells.find((s) => s.name.toLowerCase() === n.toLowerCase());
      if (!sp) throw new EngineError(`unknown spell "${n}"`);
      return { name: sp.name, drain: sp.drain };   // engine-owned drain
    });
  } else if (magicType === 'adept') {
    magic = input.magic ?? 0;
    if (magic < 1 || magic > BUDGETS.MAGIC_MAX) throw new EngineError(`adept Magic must be 1–${BUDGETS.MAGIC_MAX}`);
    if (input.spells?.length || input.tradition) throw new EngineError('adepts use powers, not spells/tradition');
    powerNames = input.powers ?? [];
    let cost = 0;
    for (const pn of powerNames) {
      const p = data.powers.find((x) => x.name === pn);
      if (!p) throw new EngineError(`unknown power "${pn}"`);
      cost += p.cost;
      modSources.push(p.modifiers);   // applied with augmentations below
    }
    if (cost > magic) throw new EngineError(`adept power points over budget: ${cost} > ${magic}`);
  } else {
    throw new EngineError(`unknown magicType "${magicType}"`);
  }

  // edge
  const edge = input.edge ?? meta.edgeBase;
  if (edge < 1 || edge > meta.edgeBase + BUDGETS.EDGE_ALLOWANCE) throw new EngineError(`edge must be ${1}–${meta.edgeBase + BUDGETS.EDGE_ALLOWANCE}`);

  // armor
  if ((input.armor ?? 0) > BUDGETS.ARMOR_MAX) throw new EngineError(`armor exceeds ${BUDGETS.ARMOR_MAX}`);

  // build final attributes = bought + metatype mods + modifier sources
  const acc = {
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, input.attributes[k]])) as Record<string, number>,
    armor: (input.armor ?? 0) + meta.armorInnate,
    initiativeDice: 0,
  };
  applyMods(acc, meta.mods);
  for (const mods of modSources) applyMods(acc, mods);

  const finalAttrs: any = { ...acc.attrs, edge, magic };
  const runner: TShadowrunActor = {
    name: input.name, sr: true,
    attributes: finalAttrs,
    skills: input.skills,
    monitors: {
      physical: { max: physicalMonitorMax(finalAttrs.body), damage: 0 },
      stun: { max: stunMonitorMax(finalAttrs.willpower), damage: 0 },
    },
    edgeCurrent: edge, armor: acc.armor,
    magicType,
    ...(acc.initiativeDice > 0 ? { initiativeDice: acc.initiativeDice } : {}),
    ...(input.augmentations?.length ? { augmentations: input.augmentations } : {}),
    ...(spellEntries ? { spells: spellEntries, tradition: input.tradition } : {}),
    ...(powerNames ? { powers: powerNames } : {}),
  } as TShadowrunActor;
  return runner;
}
