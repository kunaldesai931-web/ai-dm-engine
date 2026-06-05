// SRD 5.1 lookups over the vendored dataset (srd/2014-en). Read-only; lazily loaded
// and cached. Lets the engine validate real spells/weapons and pull their stats so
// the narrator can't cast a spell that doesn't exist or invent a weapon's damage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError } from './core/errors';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRD_DIR = path.resolve(HERE, '..', '..', 'srd', '2014-en');

const cache = new Map<string, any[]>();
function load(file: string): any[] {
  if (!cache.has(file)) {
    cache.set(file, JSON.parse(fs.readFileSync(path.join(SRD_DIR, file), 'utf8')));
  }
  return cache.get(file)!;
}

const slug = (s: string) => String(s).trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function find(file: string, q: string) {
  const list = load(file);
  const s = slug(q);
  return list.find((e) => e.index === s) || list.find((e) => slug(e.name) === s) || null;
}

export interface SpellInfo { name: string; level: number; index: string; school?: string; }
export function getSpell(q: string): SpellInfo | null {
  const e = find('5e-SRD-Spells.json', q);
  return e ? { name: e.name, level: e.level, index: e.index, school: e.school?.name } : null;
}

export interface WeaponInfo {
  name: string; index: string; damageDice: string | null; damageType: string | null;
  properties: string[]; versatileDice: string | null; rangeNormal: number | null;
}
export function getWeapon(q: string): WeaponInfo | null {
  const e = find('5e-SRD-Equipment.json', q);
  if (!e || e.equipment_category?.index !== 'weapon') return null;
  return {
    name: e.name, index: e.index,
    damageDice: e.damage?.damage_dice ?? null,
    damageType: e.damage?.damage_type?.name ?? null,
    properties: (e.properties || []).map((p: any) => p.index),
    versatileDice: e.two_handed_damage?.damage_dice ?? null,
    rangeNormal: e.range?.normal ?? null,
  };
}

export function getCondition(q: string) {
  const e = find('5e-SRD-Conditions.json', q);
  return e ? { name: e.name, index: e.index, desc: e.desc } : null;
}

export interface MonsterInfo { name: string; index: string; ac: number | null; hp: number | null; dexMod: number; cr: number; }
export function getMonster(q: string): MonsterInfo | null {
  const e = find('5e-SRD-Monsters.json', q);
  if (!e) return null;
  const ac = Array.isArray(e.armor_class) ? e.armor_class[0]?.value ?? null : e.armor_class ?? null;
  return {
    name: e.name, index: e.index, ac, hp: e.hit_points ?? null,
    dexMod: e.dexterity != null ? Math.floor((e.dexterity - 10) / 2) : 0,
    cr: e.challenge_rating ?? 0,
  };
}

const skillIndex = (raw: string) => raw.replace(/^skill-/, '');

export interface ClassInfo {
  name: string; index: string; hitDie: number; saves: string[];
  skillChoices: { choose: number; from: string[] };
  casts: boolean; castingAbility?: string;
}
export function getClass(q: string): ClassInfo | null {
  const e = find('5e-SRD-Classes.json', q);
  if (!e) return null;
  const skillChoice = (e.proficiency_choices || []).find((pc: any) =>
    (pc.from?.options || []).some((o: any) => String(o.item?.index || '').startsWith('skill-')));
  const from = (skillChoice?.from?.options || [])
    .map((o: any) => skillIndex(String(o.item?.index || '')))
    .filter(Boolean);
  return {
    name: e.name, index: e.index, hitDie: e.hit_die,
    saves: (e.saving_throws || []).map((s: any) => s.index),
    skillChoices: { choose: skillChoice?.choose ?? 0, from },
    casts: !!e.spellcasting,
    castingAbility: e.spellcasting?.spellcasting_ability?.index,
  };
}

export interface RaceInfo {
  name: string; index: string; speed: number; size: string;
  abilityBonuses: Array<{ ability: string; bonus: number }>;
  languages: string[]; traits: string[]; subraces: string[];
}
export function getRace(q: string): RaceInfo | null {
  const e = find('5e-SRD-Races.json', q);
  if (!e) return null;
  return {
    name: e.name, index: e.index, speed: e.speed, size: e.size,
    abilityBonuses: (e.ability_bonuses || []).map((b: any) => ({ ability: b.ability_score.index, bonus: b.bonus })),
    languages: (e.languages || []).map((l: any) => l.index),
    traits: (e.traits || []).map((t: any) => t.index),
    subraces: (e.subraces || []).map((s: any) => s.index),
  };
}

export interface SubraceInfo {
  name: string; index: string; race: string;
  abilityBonuses: Array<{ ability: string; bonus: number }>; traits: string[];
}
export function getSubrace(q: string): SubraceInfo | null {
  const e = find('5e-SRD-Subraces.json', q);
  if (!e) return null;
  return {
    name: e.name, index: e.index, race: e.race?.index,
    abilityBonuses: (e.ability_bonuses || []).map((b: any) => ({ ability: b.ability_score.index, bonus: b.bonus })),
    traits: (e.racial_traits || e.traits || []).map((t: any) => t.index),
  };
}

export interface BackgroundInfo { name: string; index: string; skills: string[]; }
export function getBackground(q: string): BackgroundInfo | null {
  const e = find('5e-SRD-Backgrounds.json', q);
  if (!e) return null;
  const skills = (e.starting_proficiencies || [])
    .map((p: any) => String(p.index || ''))
    .filter((i: string) => i.startsWith('skill-'))
    .map(skillIndex);
  return { name: e.name, index: e.index, skills };
}

export interface LevelInfo {
  profBonus: number; features: string[];
  spellcasting?: { cantripsKnown: number; slots: number[] };
}
export function getLevel(classIndex: string, level: number): LevelInfo | null {
  const list = load('5e-SRD-Levels.json');
  const e = list.find((x: any) => x.class?.index === slug(classIndex) && x.level === level);
  if (!e) return null;
  let spellcasting: LevelInfo['spellcasting'];
  if (e.spellcasting && e.spellcasting.cantrips_known !== undefined) {
    const slots = [0];
    for (let i = 1; i <= 9; i++) slots[i] = e.spellcasting[`spell_slots_level_${i}`] ?? 0;
    spellcasting = { cantripsKnown: e.spellcasting.cantrips_known ?? 0, slots };
  }
  return {
    profBonus: e.prof_bonus,
    features: (e.features || []).map((f: any) => f.index),
    spellcasting,
  };
}

export function lookup(kind: string, q: string) {
  if (!q) throw new EngineError(`srd ${kind} needs a name`);
  const fn: Record<string, (q: string) => any> = {
    spell: getSpell, weapon: getWeapon, condition: getCondition, monster: getMonster,
    class: getClass, race: getRace, background: getBackground,
  };
  if (!fn[kind]) throw new EngineError(`unknown srd kind "${kind}" (spell|weapon|condition|monster|class|race|background)`);
  const r = fn[kind](q);
  if (!r) throw new EngineError(`no SRD ${kind} matching "${q}"`);
  return r;
}
