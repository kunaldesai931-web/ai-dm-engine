// Session & region helpers: re-entry brief, session end summary, region transitions.
import { EngineError } from './core/errors';
import type { TState } from './types';

const URGENCY_ORDER: Record<string, number> = { high: 0, medium: 1, normal: 2, low: 3 };

// Re-entry brief + full dashboard built only from loaded state — never from memory.
export function sessionStart(state: TState) {
  const m: any = state.meta || {};

  const quests = Object.entries((state.quests || {}) as Record<string, any>)
    .filter(([, q]) => q.status === 'ongoing')
    .map(([id, q]) => ({ id, objective: q.objective || id, stake: q.stake ?? null, clues: q.clues ?? [] }));

  const threads = Object.entries((state.threads || {}) as Record<string, any>)
    .map(([id, t]) => ({ id, urgency: t.urgency || 'normal', intro: t.intro ?? null, clues: t.clues ?? [] }))
    .sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 2) - (URGENCY_ORDER[b.urgency] ?? 2));

  const leads = Object.entries((state.npcs || {}) as Record<string, any>)
    .filter(([, n]) => n.vector)
    .map(([id, n]) => ({ id, name: n.name, role: n.role ?? null, attitude: n.vector?.attitude ?? null }));

  const factions = Object.entries((state.factions || {}) as Record<string, any>)
    .map(([id, f]) => ({ id, name: f.name || id, score: f.score ?? 0, disposition: f.disposition ?? null }))
    .sort((a, b) => a.score - b.score);

  const c: any = (state as any).combat;
  const turn = c?.active ? `combat — ${c.order[c.turnIndex].id} (round ${c.round})` : 'exploration / free play';

  return {
    op: 'session.start',
    brief: [
      `WHERE: ${m.currentRegion || '?'} — ${m.worldTime || '?'}`,
      `STAKES: ${quests.length ? quests.map((q) => q.objective).join('; ') : 'no active quests'}`,
      `TURN: ${turn}`,
    ],
    session: m.sessionNumber ?? null,
    dashboard: { quests, threads, leads, factions },
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
