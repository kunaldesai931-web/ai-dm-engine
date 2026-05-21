// Auditable, reproducible RNG. A roll is a pure function of (seed, cursor); the
// cursor lives in state and only ever increments, so the whole roll history is
// replayable AND verifiable (you can prove no roll was secretly re-rolled).

function xmur3(str: string): () => number {
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

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFloat(seed: string, cursor: number): number {
  const h = xmur3(`${seed}#${cursor}`)();
  return mulberry32(h)();
}

export interface RngState { seed: string; cursor: number; }
export interface Roller {
  die(sides: number): number;
  consumed(): { from: number; to: number };
}

// Roller bound to a state's rng block. Each die consumes exactly one cursor tick.
export function makeRoller(rngState: RngState): Roller {
  const start = rngState.cursor;
  return {
    die(sides: number) {
      const f = drawFloat(rngState.seed, rngState.cursor);
      rngState.cursor += 1;
      return Math.floor(f * sides) + 1;
    },
    consumed() {
      return { from: start, to: rngState.cursor };
    },
  };
}
