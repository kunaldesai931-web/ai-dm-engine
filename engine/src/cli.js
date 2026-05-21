#!/usr/bin/env node
// Engine CLI. Every subcommand: resolve campaign -> load state -> run op ->
// (if it changed anything, including consuming the RNG) atomic-save + log -> print JSON.
// The narrator reads the printed JSON; it never invents a number a tool didn't return.

import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './dice.js';
import { rollNotation } from './dice.js';
import { makeRoller } from './rng.js';
import {
  resolveCampaign, loadState, saveState, logEvent, applyDelta, validateState,
  CAMPAIGNS_DIR,
} from './state.js';
import { getActor } from './character.js';
import * as rules from './rules.js';
import * as combat from './combat.js';
import * as session from './session.js';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const sets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      let key, val;
      if (eq >= 0) { key = body.slice(0, eq); val = body.slice(eq + 1); }
      else {
        key = body;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { val = next; i++; }
        else val = true; // bare boolean flag
      }
      if (key === 'set') sets.push(val);
      else flags[key] = val;
    } else positional.push(a);
  }
  return { positional, flags, sets };
}

const num = (v) => (v == null ? undefined : Number(v));
const bool = (v) => v === true || v === 'true';

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function setNested(target, dottedPath, value) {
  const keys = dottedPath.split('.');
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function getNested(obj, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function main() {
  const argv = process.argv.slice(2);
  const { positional, flags, sets } = parseArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];

  if (!cmd || cmd === 'help') return out({ usage: USAGE });

  // campaign management (some subcommands don't need an existing state)
  if (cmd === 'campaign') {
    if (sub === 'list') {
      const list = fs.existsSync(CAMPAIGNS_DIR)
        ? fs.readdirSync(CAMPAIGNS_DIR).filter((d) => fs.existsSync(path.join(CAMPAIGNS_DIR, d, 'state.json')))
        : [];
      return out({ op: 'campaign.list', campaigns: list });
    }
  }

  const campaign = resolveCampaign(flags.campaign);
  const state = loadState(campaign);

  // dispatch -> { result, mutated }
  let result, mutated = false;
  const key = sub && ['state', 'combat', 'region', 'session', 'inventory', 'campaign'].includes(cmd)
    ? `${cmd} ${sub}` : cmd;

  switch (key) {
    case 'roll': {
      const roller = makeRoller(state.rng);
      result = { op: 'roll', ...rollNotation(roller, positional[1] || flags.notation), rng: roller.consumed() };
      mutated = true; break;
    }
    case 'check':
      result = rules.check(state, { actor: flags.actor, skill: flags.skill, ability: flags.ability, dc: num(flags.dc), adv: bool(flags.adv), dis: bool(flags.dis) });
      mutated = true; break;
    case 'save':
      result = rules.save(state, { actor: flags.actor, ability: flags.ability, dc: num(flags.dc), adv: bool(flags.adv), dis: bool(flags.dis) });
      mutated = true; break;
    case 'attack':
      result = rules.attack(state, { attacker: flags.attacker, target: flags.target, weapon: flags.weapon, bonus: num(flags.bonus) || 0, ability: flags.ability, proficient: bool(flags.proficient), damage: flags.damage, type: flags.type, adv: bool(flags.adv), dis: bool(flags.dis) });
      mutated = true; break;
    case 'damage':
      result = rules.damage(state, { target: flags.target, amount: num(flags.amount), roll: flags.roll, type: flags.type, crit: bool(flags.crit) });
      mutated = true; break;
    case 'heal':
      result = rules.heal(state, { target: flags.target, amount: num(flags.amount) });
      mutated = true; break;
    case 'cast':
      result = rules.cast(state, { actor: flags.actor, spell: flags.spell, slot: num(flags.slot) });
      mutated = true; break;
    case 'rest':
      result = rules.rest(state, { actor: flags.actor, type: flags.type });
      mutated = true; break;
    case 'modify':
      result = rules.modify(state, { actor: flags.actor, resource: flags.resource, delta: num(flags.delta) });
      mutated = true; break;
    case 'inventory add': case 'inventory remove': {
      const actor = getActor(state, flags.actor);
      actor.inventory = actor.inventory || [];
      const qty = num(flags.qty) || 1;
      if (sub === 'add') {
        const ex = actor.inventory.find((i) => i.id === flags.item);
        if (ex) ex.qty = (ex.qty || 1) + qty; else actor.inventory.push({ id: flags.item, qty });
      } else {
        const ex = actor.inventory.find((i) => i.id === flags.item);
        if (!ex) throw new EngineError(`${flags.actor} has no "${flags.item}"`);
        ex.qty = (ex.qty || 1) - qty;
        if (ex.qty <= 0) actor.inventory = actor.inventory.filter((i) => i.id !== flags.item);
      }
      result = { op: `inventory.${sub}`, actor: flags.actor, item: flags.item, qty, inventory: actor.inventory };
      mutated = true; break;
    }
    case 'state get':
      result = { op: 'state.get', path: flags.path || null, value: flags.path ? getNested(state, flags.path) : state };
      break;
    case 'state patch': {
      let delta = {};
      if (flags.file) delta = JSON.parse(fs.readFileSync(path.resolve(flags.file), 'utf8'));
      for (const s of sets) {
        const eq = s.indexOf('='); if (eq < 0) throw new EngineError(`--set needs key=value, got "${s}"`);
        let v = s.slice(eq + 1); try { v = JSON.parse(v); } catch {}
        setNested(delta, s.slice(0, eq), v);
      }
      applyDelta(state, delta);
      validateState(state); // reject illegal merged state before it lands
      result = { op: 'state.patch', delta };
      mutated = true; break;
    }
    case 'combat start': result = combat.startCombat(state, { participants: flags.participants }); mutated = true; break;
    case 'combat next': result = combat.nextTurn(state); mutated = true; break;
    case 'combat end': result = combat.endCombat(state); mutated = true; break;
    case 'region enter': result = session.regionEnter(state, { region: positional[2] || flags.region }); mutated = true; break;
    case 'region leave': state.meta = state.meta || {}; { const from = state.meta.currentRegion; state.meta.currentRegion = null; result = { op: 'region.leave', from }; } mutated = true; break;
    case 'session start': result = session.sessionStart(state); break;
    case 'session end': result = session.sessionEnd(state); break;
    case 'campaign load': result = session.sessionStart(state); break;
    default:
      throw new EngineError(`unknown command "${argv.join(' ')}"\n${USAGE}`);
  }

  if (mutated) {
    saveState(campaign, state);
    logEvent(campaign, { event: result.op, detail: result });
  }
  out({ campaign: campaign.name, ...result });
}

const USAGE = `engine <command> [--campaign <name>] [flags]
  roll <NdM+K>
  check  --actor ID (--skill S | --ability A) [--dc N] [--adv|--dis]
  save   --actor ID --ability A [--dc N] [--adv|--dis]
  attack --attacker ID --target ID [--ability A --proficient | --bonus N] --damage NdM+K [--type T] [--adv|--dis]
  damage --target ID (--amount N | --roll NdM+K) [--type T] [--crit]
  heal   --target ID --amount N
  cast   --actor ID --spell S [--slot N]
  rest   --actor ID --type short|long
  modify --actor ID --resource gold|xp --delta N
  inventory add|remove --actor ID --item ID [--qty N]
  state get [--path a.b.c]
  state patch [--file patch.json] [--set a.b=val ...]
  combat start --participants id1,id2,... | combat next | combat end
  region enter <id> | region leave
  session start | session end
  campaign list | campaign load`;

try { main(); }
catch (err) {
  if (err instanceof EngineError) { process.stderr.write(JSON.stringify({ error: err.message }, null, 2) + '\n'); process.exit(1); }
  process.stderr.write(JSON.stringify({ error: String(err && err.stack || err) }, null, 2) + '\n'); process.exit(1);
}
