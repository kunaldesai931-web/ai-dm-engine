// Combat tracking. HP lives on the sheets (single source of truth), so it carries
// across attacks automatically — the registry just holds initiative order and turn.

import { makeRoller } from './rng.js';
import { rollD20, EngineError } from './dice.js';
import { getActor, abilityMod } from './character.js';

export function startCombat(state, { participants }) {
  const ids = String(participants).split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new EngineError('combat start needs >=2 --participants (comma-separated)');
  const roller = makeRoller(state.rng);
  const order = ids.map((id) => {
    const actor = getActor(state, id);
    const mod = actor.initiativeMod != null ? actor.initiativeMod : abilityMod(actor, 'dex');
    const d20 = rollD20(roller);
    return { id, initiative: d20.natural + mod, roll: d20.natural, mod };
  }).sort((a, b) => b.initiative - a.initiative);
  state.combat = { active: true, round: 1, turnIndex: 0, order };
  return { op: 'combat.start', round: 1, order, turn: order[0].id, rng: roller.consumed() };
}

export function nextTurn(state) {
  const c = state.combat;
  if (!c || !c.active) throw new EngineError('no active combat');
  c.turnIndex += 1;
  if (c.turnIndex >= c.order.length) { c.turnIndex = 0; c.round += 1; }
  return { op: 'combat.next', round: c.round, turn: c.order[c.turnIndex].id };
}

export function endCombat(state) {
  if (!state.combat || !state.combat.active) throw new EngineError('no active combat');
  const rounds = state.combat.round;
  state.combat = { active: false };
  return { op: 'combat.end', rounds };
}
