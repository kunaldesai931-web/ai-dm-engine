// Combat tracking. HP lives on the sheets (single source of truth), so it carries
// across attacks automatically — the registry just holds initiative order and turn.
import { makeRoller } from './core/rng';
import { rollD20 } from './core/dice';
import { EngineError } from './core/errors';
import { getActor, abilityMod } from './character';
import { getMonster } from './srd';
import type { TState } from './types';

export function startCombat(state: TState, a: { participants?: string }) {
  const ids = String(a.participants || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new EngineError('combat start needs >=2 --participants (comma-separated)');
  const roller = makeRoller(state.rng);
  const order = ids.map((id) => {
    const actor = getActor(state, id);
    const mod = actor.initiativeMod != null ? actor.initiativeMod : abilityMod(actor, 'dex');
    const d20 = rollD20(roller);
    return { id, initiative: d20.natural + mod, roll: d20.natural, mod };
  }).sort((x, y) => y.initiative - x.initiative);
  (state as any).combat = { active: true, round: 1, turnIndex: 0, order };
  // Reveal stat blocks for all participants at combat start (transparency rule).
  const statBlocks = ids.reduce<Record<string, any>>((acc, id) => {
    const actor = getActor(state, id);
    acc[id] = { name: actor.name, hp: actor.hp, ac: actor.ac, conditions: actor.conditions || [] };
    return acc;
  }, {});
  return { op: 'combat.start', round: 1, order, turn: order[0].id, statBlocks, rng: roller.consumed() };
}

// Spawn a custom ephemeral combatant (not an SRD monster). Ephemeral combatants
// are auto-purged from npcs when combat ends — they don't pollute persistent state.
export function spawnCombatant(state: TState, a: { id: string; name: string; hp: number; ac: number; init?: number }) {
  if (!a.id || !a.name) throw new EngineError('combat spawn needs --id and --name');
  if (!a.hp || a.hp < 1) throw new EngineError('combat spawn needs --hp N (positive)');
  if (!a.ac || a.ac < 1) throw new EngineError('combat spawn needs --ac N (positive)');
  state.npcs = state.npcs || {};
  if ((state.npcs as any)[a.id]) throw new EngineError(`npc "${a.id}" already exists; choose a different --id`);
  (state.npcs as any)[a.id] = {
    name: a.name, ac: a.ac, hp: { current: a.hp, max: a.hp, temp: 0 },
    initiativeMod: a.init ?? 0, conditions: [], ephemeral: true,
  };
  return { op: 'combat.spawn', id: a.id, name: a.name, hp: a.hp, ac: a.ac };
}

export function nextTurn(state: TState) {
  const c = (state as any).combat;
  if (!c || !c.active) throw new EngineError('no active combat');
  c.turnIndex += 1;
  if (c.turnIndex >= c.order.length) { c.turnIndex = 0; c.round += 1; }
  const id = c.order[c.turnIndex].id;
  const actor = getActor(state, id);
  return {
    op: 'combat.next', round: c.round, turn: id,
    actor: { name: actor.name, hp: actor.hp, ac: actor.ac, conditions: actor.conditions || [], resources: (actor as any).resources || {} },
  };
}

export function combatStatus(state: TState) {
  const c = (state as any).combat;
  if (!c || !c.active) throw new EngineError('no active combat');
  const combatants = c.order.map((entry: any, i: number) => {
    const actor = getActor(state, entry.id);
    return {
      id: entry.id, name: actor.name, initiative: entry.initiative,
      hp: actor.hp, ac: actor.ac, conditions: actor.conditions || [],
      isCurrent: i === c.turnIndex,
    };
  });
  return { op: 'combat.status', round: c.round, current: c.order[c.turnIndex].id, combatants };
}

export function endCombat(state: TState) {
  const c = (state as any).combat;
  if (!c || !c.active) throw new EngineError('no active combat');
  const rounds = c.round;
  // Purge ephemeral combatants — they don't belong in persistent NPC state.
  const purged: string[] = [];
  for (const [id, npc] of Object.entries((state.npcs || {}) as Record<string, any>)) {
    if (npc.ephemeral) { delete (state.npcs as any)[id]; purged.push(id); }
  }
  (state as any).combat = { active: false };
  return { op: 'combat.end', rounds, purged };
}

// Spawn an SRD monster into npcs with its AC/HP, ready to fight.
export function addMonster(state: TState, a: { from: string; as?: string }) {
  const m = getMonster(a.from);
  if (!m) throw new EngineError(`no SRD monster matching "${a.from}"`);
  const id = a.as || m.index;
  state.npcs = state.npcs || {};
  if ((state.npcs as any)[id]) throw new EngineError(`npc "${id}" already exists; pass --as <id>`);
  (state.npcs as any)[id] = {
    name: m.name, ac: m.ac, hp: { current: m.hp, max: m.hp, temp: 0 },
    initiativeMod: m.dexMod, conditions: [], srdMonster: m.index, cr: m.cr,
  };
  return { op: 'monster.add', id, name: m.name, ac: m.ac, hp: m.hp, cr: m.cr };
}
