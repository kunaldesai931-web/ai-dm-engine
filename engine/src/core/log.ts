// Generic append-only jsonl audit writer. Every roll and state change is logged
// here with a timestamp; the file is the engine's tamper-evident audit trail.
import fs from 'node:fs';

export function appendLog(file: string, event: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(file, line);
}
