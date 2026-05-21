// 5e SRD mechanics. Pure operations over state; each returns a structured result
// (with component dice) that the narrator reads. No operation invents a number.

import { makeRoller } from './rng.js';
import { rollD20, rollNotation, EngineError } from './dice.js';
import { getActor, abilityMod, profBonus, skillMod, saveMod } from './character.js';

// Ability/skill check: d20 + mod vs DC.
export function check(state, { actor: id, skill, ability, dc, adv, dis }) {
  const actor = getActor(state, id);
  let mod, label;
  if (skill) { const s = skillMod(actor, skill); mod = s.mod; label = `${skill} (${s.ability})`; }
  else if (ability) { mod = abilityMod(actor, ability); label = ability; }
  else throw new EngineError('check needs --skill or --ability');

  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: adv, disadvantage: dis });
  const total = d20.natural + mod;
  const success = dc != null ? total >= dc : null;
  return {
    op: 'check', actor: id, label, dc: dc ?? null,
    d20: d20.rolls, used: d20.natural, mode: d20.mode, modifier: mod, total,
    crit: d20.crit, fumble: d20.fumble, success,
    rng: roller.consumed(),
  };
}

// Saving throw.
export function save(state, { actor: id, ability, dc, adv, dis }) {
  const actor = getActor(state, id);
  if (!ability) throw new EngineError('save needs --ability');
  const mod = saveMod(actor, ability);
  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: adv, disadvantage: dis });
  const total = d20.natural + mod;
  return {
    op: 'save', actor: id, ability, dc: dc ?? null,
    d20: d20.rolls, used: d20.natural, mode: d20.mode, modifier: mod, total,
    crit: d20.crit, fumble: d20.fumble, success: dc != null ? total >= dc : null,
    rng: roller.consumed(),
  };
}

// Apply damage to a sheet: temp HP absorbs first, then current; clamped to >= 0.
// Reaching 0 sets `unconscious` and flags death saves.
function applyDamage(actor, amount) {
  const before = { current: actor.hp.current, temp: actor.hp.temp || 0 };
  let remaining = amount;
  let temp = before.temp;
  if (temp > 0) { const absorbed = Math.min(temp, remaining); temp -= absorbed; remaining -= absorbed; }
  const current = Math.max(0, before.current - remaining);
  actor.hp.temp = temp;
  actor.hp.current = current;
  const downed = current === 0 && before.current > 0;
  if (downed) {
    actor.conditions = Array.from(new Set([...(actor.conditions || []), 'unconscious']));
  }
  return { before, after: { current, temp }, downed };
}

export function damage(state, { target: id, amount, roll, type, crit }) {
  const actor = getActor(state, id);
  if (actor.hp == null || actor.hp.current == null) throw new EngineError(`${actor.name}: hp not set`);
  let rolled = null, total = amount;
  if (roll) {
    const roller = makeRoller(state.rng);
    rolled = rollNotation(roller, roll, { doubleDice: !!crit });
    total = rolled.total;
    var rng = roller.consumed();
  }
  if (total == null) throw new EngineError('damage needs --amount or --roll');
  total = Math.max(0, Math.floor(total));
  const transition = applyDamage(actor, total);
  return { op: 'damage', target: id, type: type || null, amount: total, roll: rolled, ...transition, rng };
}

export function heal(state, { target: id, amount }) {
  const actor = getActor(state, id);
  if (actor.hp == null || actor.hp.max == null) throw new EngineError(`${actor.name}: hp.max not set`);
  if (amount == null) throw new EngineError('heal needs --amount');
  const before = actor.hp.current;
  actor.hp.current = Math.min(actor.hp.max, (before || 0) + Math.max(0, Math.floor(amount)));
  if (before === 0 && actor.hp.current > 0) {
    actor.conditions = (actor.conditions || []).filter((c) => c !== 'unconscious');
  }
  return { op: 'heal', target: id, amount, before, after: actor.hp.current };
}

// Attack: d20 + bonus vs target AC; on hit roll damage (dice doubled on a crit).
export function attack(state, { attacker, target, weapon, bonus = 0, ability, proficient, damage: dmgNotation, type, adv, dis }) {
  const atk = getActor(state, attacker);
  const tgt = getActor(state, target);
  if (tgt.ac == null) throw new EngineError(`${tgt.name}: AC not set — cannot resolve attack`);
  let toHit = Number(bonus) || 0;
  if (ability) toHit += abilityMod(atk, ability) + (proficient ? profBonus(atk) : 0);

  const roller = makeRoller(state.rng);
  const d20 = rollD20(roller, { advantage: adv, disadvantage: dis });
  const totalToHit = d20.natural + toHit;
  const hit = d20.crit || (!d20.fumble && totalToHit >= tgt.ac);

  let dmg = null, transition = null;
  if (hit && dmgNotation) {
    dmg = rollNotation(roller, dmgNotation, { doubleDice: d20.crit });
    transition = applyDamage(tgt, Math.max(0, dmg.total));
  }
  return {
    op: 'attack', attacker, target, weapon: weapon || null,
    d20: d20.rolls, used: d20.natural, mode: d20.mode, toHitBonus: toHit, toHit: totalToHit,
    targetAc: tgt.ac, crit: d20.crit, fumble: d20.fumble, hit,
    damage: dmg, type: type || null, ...(transition || {}),
    rng: roller.consumed(),
  };
}

// Cast a leveled spell: requires an available slot of that level (cantrips = level 0, no slot).
export function cast(state, { actor: id, spell, slot }) {
  const actor = getActor(state, id);
  if (slot == null || Number(slot) === 0) {
    return { op: 'cast', actor: id, spell, slot: 0, note: 'cantrip / no slot consumed' };
  }
  const slots = actor.spellSlots || {};
  const s = slots[String(slot)];
  if (!s) throw new EngineError(`${actor.name}: has no level-${slot} spell slots`);
  if (s.used >= s.max) throw new EngineError(`${actor.name}: no level-${slot} slots remaining (${s.used}/${s.max})`);
  s.used += 1;
  return { op: 'cast', actor: id, spell, slot: Number(slot), slotsAfter: { used: s.used, max: s.max } };
}

// Rest. Long rest restores HP to max and all spell slots; refused while at 0 HP.
export function rest(state, { actor: id, type }) {
  const actor = getActor(state, id);
  if (type === 'long') {
    if (actor.hp && actor.hp.current === 0) throw new EngineError(`${actor.name}: cannot take a long rest at 0 HP`);
    const before = { hp: actor.hp ? actor.hp.current : null };
    if (actor.hp && actor.hp.max != null) actor.hp.current = actor.hp.max;
    for (const s of Object.values(actor.spellSlots || {})) s.used = 0;
    return { op: 'rest', actor: id, type, before, after: { hp: actor.hp ? actor.hp.current : null } };
  }
  if (type === 'short') return { op: 'rest', actor: id, type, note: 'short rest: spend Hit Dice manually (not auto-applied)' };
  throw new EngineError('rest --type must be short or long');
}

// Modify a numeric resource. gold -> party.gold; xp -> pcs[actor].xp (with level-up flag).
const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export function modify(state, { actor: id, resource, delta }) {
  if (delta == null || !Number.isFinite(Number(delta))) throw new EngineError('modify needs numeric --delta');
  delta = Number(delta);
  if (resource === 'gold') {
    state.party = state.party || {};
    const before = state.party.gold || 0;
    const after = before + delta;
    if (after < 0) throw new EngineError(`gold would go negative (${before} ${delta >= 0 ? '+' : ''}${delta})`);
    state.party.gold = after;
    return { op: 'modify', resource, before, after };
  }
  if (resource === 'xp') {
    const actor = getActor(state, id);
    const before = actor.xp || 0;
    const after = Math.max(0, before + delta);
    actor.xp = after;
    const newLevel = XP_THRESHOLDS.filter((t) => after >= t).length;
    const levelUp = actor.level != null && newLevel > actor.level;
    return { op: 'modify', actor: id, resource, before, after, level: actor.level, suggestedLevel: newLevel, levelUp };
  }
  throw new EngineError(`unknown resource "${resource}" (gold|xp)`);
}
