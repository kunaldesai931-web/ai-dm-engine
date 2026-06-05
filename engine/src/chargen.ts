import type { TState } from './types';
import { EngineError } from './core/errors';
import { getClass, getRace, getSubrace, getBackground, getLevel } from './srd';

export function scaffoldCampaignState(name: string, seed: string): TState {
  return {
    meta: { campaign: name, rulesetId: '5e' },
    rng: { seed, cursor: 0 },
    pcs: {}, npcs: {}, factions: {}, clocks: {},
  } as unknown as TState;
}

export interface ChargenInput {
  id: string; name: string;
  race: string; subrace?: string; cls: string; background?: string; bgSkills?: string[];
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  skills: string[];
  armorAc?: number; // optional precomputed AC from chosen armor; default unarmored
}

const mod = (score: number) => Math.floor((score - 10) / 2);

export function assembleCharacter(input: ChargenInput): any {
  const race = getRace(input.race);
  if (!race) throw new EngineError(`unknown race "${input.race}"`);
  const cls = getClass(input.cls);
  if (!cls) throw new EngineError(`unknown class "${input.cls}"`);
  let sub = null;
  if (input.subrace) {
    sub = getSubrace(input.subrace);
    if (!sub) throw new EngineError(`unknown subrace "${input.subrace}"`);
  }

  // abilities: base + racial + subrace
  const abilities = { ...input.abilities };
  for (const b of race.abilityBonuses) (abilities as any)[b.ability] += b.bonus;
  if (sub) for (const b of sub.abilityBonuses) (abilities as any)[b.ability] += b.bonus;

  // skills: validate against class options; collect background skills
  const allowed = new Set(cls.skillChoices.from);
  if (input.skills.length > cls.skillChoices.choose) {
    throw new EngineError(`${cls.name} chooses ${cls.skillChoices.choose} skills, got ${input.skills.length}`);
  }
  for (const s of input.skills) {
    if (!allowed.has(s)) throw new EngineError(`"${s}" is not a ${cls.name} skill option`);
  }
  let bgSkills: string[] = input.bgSkills ?? [];
  if (input.background) {
    const bg = getBackground(input.background);
    if (bg) bgSkills = bg.skills;          // SRD background
    // else: custom background — caller passed bgSkills explicitly (already in bgSkills)
  }
  const skills: Record<string, string> = {};
  for (const s of [...input.skills, ...bgSkills]) skills[s] = 'proficient';

  const lvl = getLevel(cls.index, 1)!;
  const conMod = mod(abilities.con);
  const hpMax = cls.hitDie + conMod;

  return {
    name: input.name,
    race: race.index, subrace: sub?.index ?? null, class: cls.name, level: 1,
    abilities,
    profBonus: lvl.profBonus,
    ac: input.armorAc ?? 10 + mod(abilities.dex),
    speed: race.speed,
    initiativeMod: mod(abilities.dex),
    hp: { current: hpMax, max: hpMax, temp: 0 },
    hitDice: { used: 0, max: 1 },
    saves: cls.saves,
    skills,
    features: [...lvl.features],
    xp: 0,
  };
}
