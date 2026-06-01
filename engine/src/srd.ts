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

export function lookup(kind: string, q: string) {
  if (!q) throw new EngineError(`srd ${kind} needs a name`);
  const fn: Record<string, (q: string) => any> = { spell: getSpell, weapon: getWeapon, condition: getCondition, monster: getMonster };
  if (!fn[kind]) throw new EngineError(`unknown srd kind "${kind}" (spell|weapon|condition|monster)`);
  const r = fn[kind](q);
  if (!r) throw new EngineError(`no SRD ${kind} matching "${q}"`);
  return r;
}
