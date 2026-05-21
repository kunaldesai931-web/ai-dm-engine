// Session & region helpers: re-entry brief, session end summary, region transitions.

import { EngineError } from './dice.js';

// 3-line re-entry brief: where we are, what's at stake, whose turn. Built only from
// loaded state — never from memory (matches the project's anti-drift ritual).
export function sessionStart(state) {
  const m = state.meta || {};
  const activeQuests = Object.entries(state.quests || {})
    .filter(([, q]) => q.status === 'ongoing')
    .map(([id, q]) => q.objective || id);
  const turn = state.combat && state.combat.active
    ? `combat — ${state.combat.order[state.combat.turnIndex].id} (round ${state.combat.round})`
    : 'exploration / free play';
  return {
    op: 'session.start',
    brief: [
      `WHERE: ${m.currentRegion || '?'} — ${m.worldTime || '?'}`,
      `STAKES: ${activeQuests.length ? activeQuests.join('; ') : 'no active quests'}`,
      `TURN: ${turn}`,
    ],
    session: m.sessionNumber ?? null,
  };
}

export function sessionEnd(state) {
  const pcs = Object.entries(state.pcs || {}).map(([id, c]) => ({
    id, hp: c.hp ? `${c.hp.current}/${c.hp.max}` : null, xp: c.xp ?? null, level: c.level ?? null,
  }));
  return {
    op: 'session.end',
    gold: (state.party || {}).gold ?? null,
    party: pcs,
    note: 'review the summary, then commit the campaign dir to git as this session\'s save point',
  };
}

export function regionEnter(state, { region }) {
  if (!region) throw new EngineError('region enter needs <id>');
  const prev = (state.meta || {}).currentRegion || null;
  state.meta = state.meta || {};
  state.meta.currentRegion = region;
  return { op: 'region.enter', from: prev, to: region, note: 'load this region\'s module + chronicle; archive the previous region context' };
}
