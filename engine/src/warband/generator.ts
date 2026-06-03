import type { Roller } from '../core/rng.js';
import type { TRosterMember } from './schema.js';

const NAMES = [
  'Bors', 'Crom', 'Durst', 'Edric', 'Finn', 'Garn', 'Hadwin', 'Idris',
  'Jorik', 'Keld', 'Lothar', 'Mord', 'Nils', 'Oswin', 'Petr', 'Raulf',
  'Sigrid', 'Tova', 'Ulf', 'Vara', 'Wulf', 'Xara', 'Yrsa', 'Zela',
];

let counter = 0;

type Background = {
  id: string;
  name: string;
  description: string;
  stats: {
    melee: number;
    ranged: number;
    defense: number;
    resolve: number;
    initiative: number;
    maxHp: number;
  };
  startingTrait: string;
  startingGear: string[];
  perkPool: string[];
};

function pickRandom<T>(roll: Roller, arr: T[]): T {
  const idx = roll.die(arr.length) - 1;
  return arr[idx];
}

// roll(3) - 2 gives values 1,2,3 → -1,0,+1
function variance(roll: Roller): number {
  return roll.die(3) - 2;
}

export function generateHireling(
  roll: Roller,
  backgrounds: Background[],
  traits: string[],
): TRosterMember {
  const bg = pickRandom(roll, backgrounds);
  const name = pickRandom(roll, NAMES);

  const melee = bg.stats.melee + variance(roll);
  const ranged = bg.stats.ranged + variance(roll);
  const defense = bg.stats.defense + variance(roll);
  const resolve = bg.stats.resolve + variance(roll);
  const initiative = bg.stats.initiative + variance(roll);
  const maxHp = bg.stats.maxHp + variance(roll);
  const hp = maxHp;

  // Pick two distinct traits: visible + hidden
  const traitIdx1 = roll.die(traits.length) - 1;
  let traitIdx2 = roll.die(traits.length) - 1;
  if (traitIdx2 === traitIdx1) {
    traitIdx2 = (traitIdx2 + 1) % traits.length;
  }
  const visibleTrait = traits[traitIdx1];
  const hiddenTrait = traits[traitIdx2];

  const wages = 3 + roll.die(4);

  const id = `hireling-${Date.now()}-${++counter}`;

  return {
    id,
    name,
    role: 'hireling',
    backgroundId: bg.id,
    level: 1,
    xp: 0,
    stats: {
      melee: Math.max(0, melee),
      ranged: Math.max(0, ranged),
      defense: Math.max(0, defense),
      resolve: Math.max(0, resolve),
      initiative: Math.max(0, initiative),
      hp: Math.max(0, hp),
      maxHp: Math.max(1, maxHp),
    },
    traits: [visibleTrait],
    hiddenTrait,
    perks: [],
    injuries: [],
    gear: [...bg.startingGear],
    wages,
    morale: 5,
  };
}
