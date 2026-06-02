#!/usr/bin/env node
// Engine CLI. Every subcommand: resolve campaign -> load state -> run op ->
// (if it changed anything, including consuming the RNG) atomic-save + log -> print JSON.
// The narrator reads the printed JSON; it never invents a number a tool didn't return.
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './core/errors';
import { rollNotation } from './core/dice';
import { makeRoller } from './core/rng';
import { resolveCampaign, loadState, saveState, logEvent, applyDelta, CAMPAIGNS_DIR } from './state';
import { parseState } from './types';
import { getActor } from './character';
import * as rules from './rules';
import * as combat from './combat';
import * as session from './session';
import * as srd from './srd';
import * as chronicle from './chronicle';

interface Parsed { positional: string[]; flags: Record<string, string | true>; sets: string[]; }
function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const sets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      let key: string, val: string | true;
      if (eq >= 0) { key = body.slice(0, eq); val = body.slice(eq + 1); }
      else {
        key = body;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { val = next; i++; } else val = true;
      }
      if (key === 'set') sets.push(val as string); else flags[key] = val;
    } else positional.push(a);
  }
  return { positional, flags, sets };
}

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: string | true | undefined): number | undefined => (typeof v === 'string' ? Number(v) : undefined);
const bool = (v: string | true | undefined): boolean => v === true || v === 'true';
function out(obj: unknown) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function setNested(target: any, dottedPath: string, value: unknown) {
  const keys = dottedPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
const getNested = (obj: any, p: string) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function main() {
  const argv = process.argv.slice(2);
  const { positional, flags, sets } = parseArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];
  if (!cmd || cmd === 'help') return out({ usage: USAGE });

  if (cmd === 'campaign' && sub === 'list') {
    const list = fs.existsSync(CAMPAIGNS_DIR)
      ? fs.readdirSync(CAMPAIGNS_DIR).filter((d) => fs.existsSync(path.join(CAMPAIGNS_DIR, d, 'state.json')))
      : [];
    return out({ op: 'campaign.list', campaigns: list });
  }
  if (cmd === 'srd') return out({ op: 'srd', kind: sub, result: srd.lookup(sub, positional[2] || (str(flags.name) as string)) });

  const campaign = resolveCampaign(str(flags.campaign));
  const state = loadState(campaign);

  let result: any, mutated = false;
  const key = sub && ['state', 'combat', 'region', 'session', 'inventory', 'monster', 'campaign', 'chronicle', 'npc', 'faction', 'clock'].includes(cmd)
    ? `${cmd} ${sub}` : cmd;

  switch (key) {
    case 'roll': {
      const roller = makeRoller(state.rng);
      result = { op: 'roll', ...rollNotation(roller, positional[1] || (str(flags.notation) as string)), rng: roller.consumed() };
      mutated = true; break;
    }
    case 'check': result = rules.check(state, { actor: str(flags.actor)!, skill: str(flags.skill), ability: str(flags.ability), dc: num(flags.dc), adv: bool(flags.adv), dis: bool(flags.dis) }); mutated = true; break;
    case 'save': result = rules.save(state, { actor: str(flags.actor)!, ability: str(flags.ability), dc: num(flags.dc), adv: bool(flags.adv), dis: bool(flags.dis) }); mutated = true; break;
    case 'attack': result = rules.attack(state, { attacker: str(flags.attacker), target: str(flags.target), weapon: str(flags.weapon), bonus: num(flags.bonus) || 0, ability: str(flags.ability), proficient: bool(flags.proficient), damage: str(flags.damage), type: str(flags.type), adv: bool(flags.adv), dis: bool(flags.dis), ambush: bool(flags.ambush) }); mutated = true; break;
    case 'damage': result = rules.damage(state, { target: str(flags.target)!, amount: num(flags.amount), roll: str(flags.roll), type: str(flags.type), crit: bool(flags.crit) }); mutated = true; break;
    case 'heal': result = rules.heal(state, { target: str(flags.target)!, amount: num(flags.amount) }); mutated = true; break;
    case 'cast': result = rules.cast(state, { actor: str(flags.actor)!, spell: str(flags.spell)!, slot: num(flags.slot) }); mutated = true; break;
    case 'rest': result = rules.rest(state, { actor: str(flags.actor)!, type: str(flags.type)!, hitDice: num(flags.hitDice) }); mutated = true; break;
    case 'use': result = rules.useResource(state, { actor: str(flags.actor)!, resource: str(flags.resource)! }); mutated = true; break;
    case 'levelup': result = rules.levelUp(state, { actor: str(flags.actor)!, hpRoll: num(flags.hpRoll) }); mutated = true; break;
    case 'modify': result = rules.modify(state, { actor: str(flags.actor), resource: str(flags.resource)!, delta: num(flags.delta) }); mutated = true; break;
    case 'inventory add': case 'inventory remove': {
      const actor: any = getActor(state, str(flags.actor)!);
      actor.inventory = actor.inventory || [];
      const item = str(flags.item)!; const qty = num(flags.qty) || 1;
      if (sub === 'add') {
        const ex = actor.inventory.find((i: any) => i.id === item);
        if (ex) ex.qty = (ex.qty || 1) + qty; else actor.inventory.push({ id: item, qty });
      } else {
        const ex = actor.inventory.find((i: any) => i.id === item);
        if (!ex) throw new EngineError(`${str(flags.actor)} has no "${item}"`);
        ex.qty = (ex.qty || 1) - qty;
        if (ex.qty <= 0) actor.inventory = actor.inventory.filter((i: any) => i.id !== item);
      }
      result = { op: `inventory.${sub}`, actor: str(flags.actor), item, qty, inventory: actor.inventory };
      mutated = true; break;
    }
    case 'state get': result = { op: 'state.get', path: str(flags.path) || null, value: flags.path ? getNested(state, str(flags.path)!) : state }; break;
    case 'state patch': {
      let delta: any = {};
      if (flags.file) delta = JSON.parse(fs.readFileSync(path.resolve(str(flags.file)!), 'utf8'));
      for (const s of sets) {
        const eq = s.indexOf('='); if (eq < 0) throw new EngineError(`--set needs key=value, got "${s}"`);
        let v: any = s.slice(eq + 1); try { v = JSON.parse(v); } catch { /* keep string */ }
        setNested(delta, s.slice(0, eq), v);
      }
      applyDelta(state, delta);
      parseState(state); // reject illegal merged state before it lands
      result = { op: 'state.patch', delta }; mutated = true; break;
    }
    case 'combat start': result = combat.startCombat(state, { participants: str(flags.participants) }); mutated = true; break;
    case 'combat next': result = combat.nextTurn(state); mutated = true; break;
    case 'combat end': result = combat.endCombat(state); mutated = true; break;
    case 'combat status': result = combat.combatStatus(state); break;
    case 'combat spawn': result = combat.spawnCombatant(state, { id: str(flags.id)!, name: str(flags.name)!, hp: num(flags.hp)!, ac: num(flags.ac)!, init: num(flags.init) }); mutated = true; break;
    case 'monster add': result = combat.addMonster(state, { from: str(flags.from)!, as: str(flags.as) }); mutated = true; break;
    case 'npc add': {
      const id = str(flags.id) || (str(flags.name) || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) throw new EngineError('npc add requires --name or --id');
      if (state.npcs[id]) throw new EngineError(`NPC "${id}" already exists; use state patch to update`);
      const npc: any = {
        name: str(flags.name) || id,
        ...(str(flags.role) ? { role: str(flags.role) } : {}),
        vector: { goal: '', secret: '', voice: '', attitude: '' },
      };
      state.npcs[id] = npc;
      const npcDir = path.join(campaign.dir, 'npcs');
      if (!fs.existsSync(npcDir)) fs.mkdirSync(npcDir, { recursive: true });
      const personaPath = path.join(npcDir, `${id}.persona.md`);
      const memoryPath = path.join(npcDir, `${id}.memory.log`);
      if (!fs.existsSync(personaPath)) {
        fs.writeFileSync(personaPath, [
          '---',
          `id: ${id}`,
          `name: ${npc.name}`,
          `role: ${str(flags.role) || ''}`,
          'voice: ""',
          'motivation: ""',
          'secrets: ""',
          'relationships: []',
          'speech_quirks: ""',
          '---',
          '',
          '## Notes',
          '',
          '',
        ].join('\n'));
      }
      if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '# No scenes yet.\n');
      result = { op: 'npc.add', id, npc, scaffolded: { persona: personaPath, memory: memoryPath } };
      mutated = true; break;
    }
    case 'faction rep': {
      const fid = str(flags.faction);
      if (!fid) throw new EngineError('faction rep requires --faction <id>');
      const factions: any = (state as any).factions || {};
      if (!factions[fid]) throw new EngineError(`no faction "${fid}"; add it via state patch first`);
      const delta = num(flags.delta);
      const set = num(flags.set);
      if (delta !== undefined) factions[fid].score = (factions[fid].score ?? 0) + delta;
      else if (set !== undefined) factions[fid].score = set;
      else throw new EngineError('faction rep requires --delta N or --set N');
      factions[fid].score = Math.max(-5, Math.min(5, factions[fid].score));
      result = { op: 'faction.rep', faction: fid, score: factions[fid].score, name: factions[fid].name || fid };
      mutated = true; break;
    }
    case 'region enter': result = session.regionEnter(state, { region: positional[2] || str(flags.region) }); mutated = true; break;
    case 'region leave': { const meta: any = state.meta; const from = meta.currentRegion; meta.currentRegion = null; result = { op: 'region.leave', from }; mutated = true; break; }
    case 'session start': result = session.sessionStart(state); break;
    case 'session end': result = session.sessionEnd(state); break;
    case 'chronicle append': result = chronicle.append(state, { text: str(flags.text) }); mutated = true; break;
    case 'chronicle compress': result = chronicle.compress(state); break;
    case 'chronicle commit': result = chronicle.commit(state, { summary: str(flags.summary) }); mutated = true; break;
    case 'chronicle read': result = chronicle.read(state); break;
    case 'campaign load': result = session.sessionStart(state); break;
    case 'clock add': {
      const cid = str(flags.id) || positional[2];
      if (!cid) throw new EngineError('clock add requires --id');
      if (!str(flags.label)) throw new EngineError('clock add requires --label "description"');
      const segs = num(flags.segments) ?? 6;
      (state as any).clocks = (state as any).clocks || {};
      if ((state as any).clocks[cid]) throw new EngineError(`clock "${cid}" already exists`);
      (state as any).clocks[cid] = { label: str(flags.label), segments: segs, filled: 0, trigger: str(flags.trigger) };
      result = { op: 'clock.add', id: cid, ...((state as any).clocks[cid]) }; mutated = true; break;
    }
    case 'clock tick': {
      const cid = str(flags.id) || positional[2];
      if (!cid) throw new EngineError('clock tick requires --id');
      const clocks = (state as any).clocks || {};
      if (!clocks[cid]) throw new EngineError(`no clock "${cid}"`);
      const ck = clocks[cid];
      const by = num(flags.by) ?? 1;
      ck.filled = Math.min(ck.segments, ck.filled + by);
      const triggered = ck.filled >= ck.segments;
      result = { op: 'clock.tick', id: cid, filled: ck.filled, segments: ck.segments, triggered, trigger: triggered ? (ck.trigger ?? 'clock full') : null }; mutated = true; break;
    }
    case 'clock status': {
      const clocks = (state as any).clocks || {};
      result = { op: 'clock.status', clocks: Object.entries(clocks).map(([id, ck]: any) => ({ id, label: ck.label, filled: ck.filled, segments: ck.segments, pct: Math.round(100 * ck.filled / ck.segments), triggered: ck.filled >= ck.segments, trigger: ck.trigger ?? null })) };
      break;
    }
    case 'clock remove': {
      const cid = str(flags.id) || positional[2];
      if (!cid) throw new EngineError('clock remove requires --id');
      const clocks = (state as any).clocks || {};
      if (!clocks[cid]) throw new EngineError(`no clock "${cid}"`);
      delete clocks[cid];
      result = { op: 'clock.remove', id: cid }; mutated = true; break;
    }
    case 'intel add': {
      const actor: any = getActor(state, str(flags.actor)!);
      actor.inventory = actor.inventory || [];
      const iid = str(flags.id)!;
      if (!iid) throw new EngineError('intel add requires --id');
      actor.inventory.push({ id: iid, type: 'intel', note: str(flags.note) ?? '', status: str(flags.status) ?? 'secured', tags: str(flags.tags)?.split(',').map((t) => t.trim()) ?? [] });
      result = { op: 'intel.add', actor: str(flags.actor), id: iid }; mutated = true; break;
    }
    default: throw new EngineError(`unknown command "${argv.join(' ')}"\n${USAGE}`);
  }

  if (mutated) { saveState(campaign, state); logEvent(campaign, { event: result.op, detail: result }); }
  out({ campaign: campaign.name, ...result });
}

const USAGE = `engine <command> [--campaign <name>] [flags]
  roll <NdM+K>
  check  --actor ID (--skill S | --ability A) [--dc N] [--adv|--dis]
  save   --actor ID --ability A [--dc N] [--adv|--dis]
  attack --attacker ID --target ID [--weapon W | --damage NdM+K] [--ability A --proficient | --bonus N] [--adv|--dis]
  damage --target ID (--amount N | --roll NdM+K) [--type T] [--crit]
  heal   --target ID --amount N
  cast   --actor ID --spell S [--slot N]        # SRD spells carry their own level
  rest    --actor ID --type short|long [--hitDice N]   # short: spend N Hit Dice to heal
  use     --actor ID --resource <name>                 # consume Action Surge, Second Wind, etc.
  levelup --actor ID [--hpRoll N]                      # level up (omit hpRoll for average)
  modify  --resource gold --delta N | modify --actor ID --resource xp --delta N
  inventory add|remove --actor ID --item ID [--qty N]
  intel add --actor ID --id <key> --note "desc" [--tags tag1,tag2] [--status secured]
  state get [--path a.b.c]
  state patch [--file patch.json] [--set a.b=val ...]
  combat start --participants id1,id2,...
  combat spawn --id <id> --name "Name" --hp N --ac N [--init N]   # custom ephemeral enemy
  combat next | combat end | combat status
  monster add --from <srd-monster> [--as ID]
  npc add --name "Full Name" [--id id-slug] [--role "description"]
  faction rep --faction <id> (--delta N | --set N)   # score clamped to [-5, +5]
  clock add --id <id> --label "desc" [--segments N] [--trigger "what happens"]
  clock tick --id <id> [--by N]
  clock status | clock remove --id <id>
  srd spell|weapon|condition|monster <name>
  region enter <id> | region leave
  session start | session end
  chronicle append --text "<turn summary>" | chronicle compress | chronicle commit --summary "<text>" | chronicle read
  campaign list | campaign load`;

try { main(); }
catch (err: any) {
  const msg = err instanceof EngineError ? err.message : String(err?.stack || err);
  process.stderr.write(JSON.stringify({ error: msg }, null, 2) + '\n');
  process.exit(1);
}
