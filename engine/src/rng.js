// Auditable, reproducible RNG.
//
// A roll is a pure function of (seed, cursor). The cursor lives in state and only
// ever increments, so the whole roll history of a campaign is replayable AND
// verifiable: you can prove no roll was secretly re-rolled (the cursor never goes
// backward, and every roll is logged with the cursor index it consumed).

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic float in [0,1) for a given (seed, cursor) pair.
function drawFloat(seed, cursor) {
  const h = xmur3(`${seed}#${cursor}`)();
  return mulberry32(h)();
}

// Roller bound to a state's rng block. Each die consumes exactly one cursor tick.
// Returns the rolled values and the [start, end) cursor range consumed, for logging.
export function makeRoller(rngState) {
  const start = rngState.cursor;
  return {
    die(sides) {
      const f = drawFloat(rngState.seed, rngState.cursor);
      rngState.cursor += 1;
      return Math.floor(f * sides) + 1;
    },
    consumed() {
      return { from: start, to: rngState.cursor };
    },
  };
}
