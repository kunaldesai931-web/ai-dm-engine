// Dice-notation parsing and rolling. All randomness flows through a roller bound
// to campaign state (see rng.js), so every die is reproducible and logged.

const NOTATION = /^([0-9]*)d([0-9]+)([+-][0-9]+)?$/i;

// Parse "3d6+2", "1d20", "d8", "2d10-1" -> { count, sides, modifier }.
export function parseNotation(notation) {
  const m = String(notation).trim().match(NOTATION);
  if (!m) throw new EngineError(`bad dice notation: "${notation}" (expected like 3d6+2)`);
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (count < 1 || count > 100) throw new EngineError(`die count out of range: ${count}`);
  if (![2, 3, 4, 6, 8, 10, 12, 20, 100].includes(sides)) {
    throw new EngineError(`unsupported die: d${sides}`);
  }
  return { count, sides, modifier };
}

// Roll a notation string. `doubleDice` doubles the number of dice (crit damage).
export function rollNotation(roller, notation, { doubleDice = false } = {}) {
  const { count, sides, modifier } = parseNotation(notation);
  const n = doubleDice ? count * 2 : count;
  const dice = [];
  for (let i = 0; i < n; i++) dice.push(roller.die(sides));
  const total = dice.reduce((a, b) => a + b, 0) + modifier;
  return { notation, dice, modifier, total };
}

// A single d20 with optional advantage/disadvantage. Reports which die was used
// and natural 1/20 for crit handling.
export function rollD20(roller, { advantage = false, disadvantage = false } = {}) {
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false; // they cancel per 5e RAW
  }
  const rolls = [roller.die(20)];
  if (advantage || disadvantage) rolls.push(roller.die(20));
  const natural = advantage ? Math.max(...rolls) : disadvantage ? Math.min(...rolls) : rolls[0];
  return { rolls, natural, crit: natural === 20, fumble: natural === 1, mode: advantage ? 'advantage' : disadvantage ? 'disadvantage' : 'flat' };
}

export class EngineError extends Error {}
