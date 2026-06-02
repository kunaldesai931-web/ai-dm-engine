// 5e SRD mechanics. Pure operations over state; each returns a structured result
// (with component dice) the narrator reads. No operation invents a number.
import { makeRoller } from './core/rng';
import { rollD20, rollNotation } from './core/dice';
import { EngineError } from './core/errors';
import { getActor, abilityMod, profBonus, skillMod, saveMod } from './character';
import { getSpell, getWeapon } from './srd';
import type { TState, TCharacter } from './types';

export function check(state: TState, a: { actor: string; skill?: string; ability?: string; dc?: number; adv?: boolean; dis?: boolean }) {
  const actor = getActor(state, a.actor);
  let mod: number, label: string;
  if (a.skill) { const s = skillMod(actor, a.skill); mod = s.mod; label = `${a.skill} (${s.ability})`; }
  else if (a.ability) { mod = abilityMod(actor, a.ability); label = a.ability; }
  else throw new EngineError('check needs --skill or --ability');

  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: a.adv, disadvantage: a.dis });
  const total = d20.natural + mod;
  return {
    op: 'check', actor: a.actor, label, dc: a.dc ?? null,
    d20: d20.rolls, used: d20.natural, mode: d20.mode, modifier: mod, total,
    crit: d20.crit, fumble: d20.fumble, success: a.dc != null ? total >= a.dc : null,
    rng: roller.consumed(),
  };
}

export function save(state: TState, a: { actor: string; ability?: string; dc?: number; adv?: boolean; dis?: boolean }) {
  const actor = getActor(state, a.actor);
  if (!a.ability) throw new EngineError('save needs --ability');
  const mod = saveMod(actor, a.ability);
  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: a.adv, disadvantage: a.dis });
  const total = d20.natural + mod;
  return {
    op: 'save', actor: a.actor, ability: a.ability, dc: a.dc ?? null,
    d20: d20.rolls, used: d20.natural, mode: d20.mode, modifier: mod, total,
    crit: d20.crit, fumble: d20.fumble, success: a.dc != null ? total >= a.dc : null,
    rng: roller.consumed(),
  };
}

// Temp HP absorbs first, then current; clamped to >= 0. Reaching 0 sets unconscious.
function applyDamage(actor: TCharacter, amount: number) {
  const hp = actor.hp!;
  const before = { current: hp.current!, temp: hp.temp || 0 };
  let remaining = amount;
  let temp = before.temp;
  if (temp > 0) { const absorbed = Math.min(temp, remaining); temp -= absorbed; remaining -= absorbed; }
  const current = Math.max(0, before.current - remaining);
  hp.temp = temp; hp.current = current;
  const downed = current === 0 && before.current > 0;
  if (downed) actor.conditions = Array.from(new Set([...(actor.conditions || []), 'unconscious']));
  return { before, after: { current, temp }, downed };
}

export function damage(state: TState, a: { target: string; amount?: number; roll?: string; type?: string; crit?: boolean }) {
  const actor = getActor(state, a.target);
  if (!actor.hp || actor.hp.current == null) throw new EngineError(`${actor.name}: hp not set`);
  let rolled: any = null, total = a.amount, rng: any = undefined;
  if (a.roll) {
    const roller = makeRoller(state.rng);
    rolled = rollNotation(roller, a.roll, { doubleDice: !!a.crit });
    total = rolled.total; rng = roller.consumed();
  }
  if (total == null) throw new EngineError('damage needs --amount or --roll');
  total = Math.max(0, Math.floor(total));
  const transition = applyDamage(actor, total);
  return { op: 'damage', target: a.target, type: a.type || null, amount: total, roll: rolled, ...transition, rng };
}

export function heal(state: TState, a: { target: string; amount?: number }) {
  const actor = getActor(state, a.target);
  if (!actor.hp || actor.hp.max == null) throw new EngineError(`${actor.name}: hp.max not set`);
  if (a.amount == null) throw new EngineError('heal needs --amount');
  const before = actor.hp.current;
  actor.hp.current = Math.min(actor.hp.max, (before || 0) + Math.max(0, Math.floor(a.amount)));
  if (before === 0 && actor.hp.current > 0) actor.conditions = (actor.conditions || []).filter((c) => c !== 'unconscious');
  return { op: 'heal', target: a.target, amount: a.amount, before, after: actor.hp.current };
}

// Attack: d20 + bonus vs target AC; on hit roll damage (dice doubled on crit). If a
// known SRD weapon is named and no --damage given, its damage dice are used.
export function attack(state: TState, a: any) {
  const atk = getActor(state, a.attacker);
  const tgt = getActor(state, a.target);
  if (tgt.ac == null) throw new EngineError(`${tgt.name}: AC not set — cannot resolve attack`);

  let dmgNotation: string | undefined = a.damage;
  let weaponInfo = null;
  if (a.weapon) {
    weaponInfo = getWeapon(a.weapon);
    if (weaponInfo && !dmgNotation) {
      const ability = a.ability || (weaponInfo.properties.includes('finesse') ? 'dex' : 'str');
      const m = atk.abilities ? (atk.abilities as any)[ability] : null;
      const bonus = m != null ? Math.floor((m - 10) / 2) : 0;
      dmgNotation = `${weaponInfo.damageDice}${bonus >= 0 ? '+' : ''}${bonus}`;
    }
  }

  let toHit = Number(a.bonus) || 0;
  if (a.ability) toHit += abilityMod(atk, a.ability) + (a.proficient ? profBonus(atk) : 0);

  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: a.adv, disadvantage: a.dis });
  const totalToHit = d20.natural + toHit;
  // Ambush rule: attacking an unaware target auto-crits on any hit (dice doubled).
  const isCrit = d20.crit || !!a.ambush;
  const hit = isCrit || (!d20.fumble && totalToHit >= tgt.ac);

  let dmg: any = null, transition: any = null;
  if (hit && dmgNotation) {
    dmg = rollNotation(roller, dmgNotation, { doubleDice: isCrit });
    transition = applyDamage(tgt, Math.max(0, dmg.total));
  }
  return {
    op: 'attack', attacker: a.attacker, target: a.target,
    weapon: weaponInfo ? weaponInfo.name : (a.weapon || null),
    d20: d20.rolls, used: d20.natural, mode: d20.mode, toHitBonus: toHit, toHit: totalToHit,
    targetAc: tgt.ac, crit: isCrit, ambush: !!a.ambush, fumble: d20.fumble, hit,
    damage: dmg, type: a.type || (weaponInfo ? weaponInfo.damageType : null), ...(transition || {}),
    rng: roller.consumed(),
  };
}

// Cast a spell. If it's a known SRD spell, its level is authoritative (cantrip = no
// slot); homebrew spells fall back to the explicit --slot. Slot availability enforced.
export function cast(state: TState, a: { actor: string; spell: string; slot?: number }) {
  const actor = getActor(state, a.actor);
  const srd = getSpell(a.spell);
  let level = a.slot;
  if (srd) level = srd.level; // real spells carry their real level
  if (level == null) throw new EngineError(`"${a.spell}" is not an SRD spell; pass --slot N (or 0 for a cantrip)`);
  if (level === 0) return { op: 'cast', actor: a.actor, spell: srd ? srd.name : a.spell, level: 0, srd: !!srd, note: 'cantrip / no slot consumed' };

  const slots = (actor.spellSlots || {}) as Record<string, any>;
  const s = slots[String(level)];
  if (!s) throw new EngineError(`${actor.name}: has no level-${level} spell slots`);
  if (s.used >= s.max) throw new EngineError(`${actor.name}: no level-${level} slots remaining (${s.used}/${s.max})`);
  s.used += 1;
  return { op: 'cast', actor: a.actor, spell: srd ? srd.name : a.spell, level, srd: !!srd, slotsAfter: { used: s.used, max: s.max } };
}

export function rest(state: TState, a: { actor: string; type: string }) {
  const actor = getActor(state, a.actor);
  if (a.type === 'long') {
    if (actor.hp && actor.hp.current === 0) throw new EngineError(`${actor.name}: cannot take a long rest at 0 HP`);
    const before = { hp: actor.hp ? actor.hp.current : null };
    if (actor.hp && actor.hp.max != null) actor.hp.current = actor.hp.max;
    for (const s of Object.values((actor.spellSlots || {}) as Record<string, any>)) s.used = 0;
    return { op: 'rest', actor: a.actor, type: a.type, before, after: { hp: actor.hp ? actor.hp.current : null } };
  }
  if (a.type === 'short') return { op: 'rest', actor: a.actor, type: a.type, note: 'short rest: spend Hit Dice manually (not auto-applied)' };
  throw new EngineError('rest --type must be short or long');
}

const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export function modify(state: TState, a: { actor?: string; resource: string; delta?: number }) {
  if (a.delta == null || !Number.isFinite(Number(a.delta))) throw new EngineError('modify needs numeric --delta');
  const delta = Number(a.delta);
  if (a.resource === 'gold') {
    state.party = state.party || {};
    const before = (state.party as any).gold || 0;
    const after = before + delta;
    if (after < 0) throw new EngineError(`gold would go negative (${before} ${delta >= 0 ? '+' : ''}${delta})`);
    (state.party as any).gold = after;
    return { op: 'modify', resource: 'gold', before, after };
  }
  if (a.resource === 'xp') {
    if (!a.actor) throw new EngineError('xp modify needs --actor');
    const actor = getActor(state, a.actor);
    const before = actor.xp || 0;
    const after = Math.max(0, before + delta);
    actor.xp = after;
    const newLevel = XP_THRESHOLDS.filter((t) => after >= t).length;
    return { op: 'modify', actor: a.actor, resource: 'xp', before, after, level: actor.level ?? null, suggestedLevel: newLevel, levelUp: actor.level != null && newLevel > actor.level };
  }
  throw new EngineError(`unknown resource "${a.resource}" (gold|xp)`);
}
