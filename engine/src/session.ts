// Session & region helpers: re-entry brief, session end summary, region transitions.
import { EngineError } from './errors';
import type { TState } from './types';

// 3-line re-entry brief built only from loaded state — never from memory (matches the
// project's anti-drift ritual).
export function sessionStart(state: TState) {
  const m: any = state.meta || {};
  const activeQuests = Object.entries((state.quests || {}) as Record<string, any>)
    .filter(([, q]) => q.status === 'ongoing')
    .map(([id, q]) => q.objective || id);
  const c: any = (state as any).combat;
  const turn = c && c.active ? `combat — ${c.order[c.turnIndex].id} (round ${c.round})` : 'exploration / free play';
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

export function sessionEnd(state: TState) {
  const pcs = Object.entries((state.pcs || {}) as Record<string, any>).map(([id, c]) => ({
    id, hp: c.hp ? `${c.hp.current}/${c.hp.max}` : null, xp: c.xp ?? null, level: c.level ?? null,
  }));
  return {
    op: 'session.end',
    gold: (state.party as any)?.gold ?? null,
    party: pcs,
    note: "review the summary, then commit the campaign dir to git as this session's save point",
  };
}

export function regionEnter(state: TState, a: { region?: string }) {
  if (!a.region) throw new EngineError('region enter needs <id>');
  const prev = (state.meta as any).currentRegion || null;
  (state.meta as any).currentRegion = a.region;
  return { op: 'region.enter', from: prev, to: a.region, note: "load this region's module + chronicle; archive the previous region context" };
}
