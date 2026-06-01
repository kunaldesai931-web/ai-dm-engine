// Generic, engine-agnostic state IO: load+validate, atomic save, delta merge.
// Both the RPG engine and the realm sim engine build their persistence on this,
// so there is one atomic-write implementation and one delta-merge rule.
import fs from 'node:fs';

// A validator parses unknown JSON into a typed, invariant-checked state (or throws).
// zod schemas' parse functions (e.g. parseState) satisfy this directly.
export type Validator<S> = (data: unknown) => S;

// Load + validate a JSON state file.
export function loadJson<S>(file: string, validate: Validator<S>): S {
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Atomic write: temp file -> fsync -> rename. A crash can never leave a
// half-written save. Re-validates before the bytes land.
export function saveJson<S>(file: string, state: S, validate: Validator<S>): void {
  validate(state); // re-validate before it lands
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(state, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// Deep-merge a delta into state (arrays replace, objects merge, primitives overwrite).
export function applyDelta(state: any, delta: any): any {
  function merge(target: any, src: any): any {
    if (typeof src !== 'object' || src === null) return src;
    if (Array.isArray(src)) return src.slice();
    for (const key of Object.keys(src)) {
      const val = src[key];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        merge(target[key], val);
      } else {
        target[key] = Array.isArray(val) ? val.slice() : val;
      }
    }
    return target;
  }
  return merge(state, delta);
}
