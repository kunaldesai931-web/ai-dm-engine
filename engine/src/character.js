// Character-sheet helpers. These refuse to guess: if the sheet is missing a number
// the engine errors rather than inventing one (mechanical honesty over convenience).

import { EngineError } from './dice.js';

export const SKILL_ABILITY = {
  athletics: 'str',
  acrobatics: 'dex', 'sleight-of-hand': 'dex', stealth: 'dex',
  arcana: 'int', history: 'int', investigation: 'int', nature: 'int', religion: 'int',
  'animal-handling': 'wis', insight: 'wis', medicine: 'wis', perception: 'wis', survival: 'wis',
  deception: 'cha', intimidation: 'cha', performance: 'cha', persuasion: 'cha',
};

export function getActor(state, id) {
  const c = (state.pcs && state.pcs[id]) || (state.npcs && state.npcs[id]);
  if (!c) throw new EngineError(`unknown actor "${id}"`);
  return c;
}

export function abilityMod(actor, ability) {
  const score = actor.abilities && actor.abilities[ability];
  if (score == null) {
    throw new EngineError(`${actor.name}: ${ability.toUpperCase()} is not set on the sheet — complete it before rolling`);
  }
  return Math.floor((score - 10) / 2);
}

export function profBonus(actor) {
  if (actor.profBonus == null) throw new EngineError(`${actor.name}: profBonus not set`);
  return actor.profBonus;
}

// Skill modifier: ability mod + proficiency ("prof") or double ("expertise").
export function skillMod(actor, skill) {
  const ability = SKILL_ABILITY[skill];
  if (!ability) throw new EngineError(`unknown skill "${skill}"`);
  let mod = abilityMod(actor, ability);
  const tier = (actor.skills || {})[skill];
  if (tier === 'prof') mod += profBonus(actor);
  else if (tier === 'expertise') mod += 2 * profBonus(actor);
  return { mod, ability, tier: tier || 'untrained' };
}

export function saveMod(actor, ability) {
  let mod = abilityMod(actor, ability);
  if ((actor.saves || []).includes(ability)) mod += profBonus(actor);
  return mod;
}
