// Errors the engine raises on illegal actions or incomplete data. The CLI prints
// these as clean JSON; they are intentional ("DEX not set", "no slots left"), not bugs.
export class EngineError extends Error {}
