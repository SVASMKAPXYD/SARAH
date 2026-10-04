/**
 * P3/P2 — replay (plan §3b). The recorder appends one entry per decision; the player
 * returns recorded decisions in order so the executor can re-drive a real Gemini run
 * with zero network. `?replay=<name>` loads `public/replays/<name>.json`.
 * A replay is a recording, not a decision-maker.
 */
import { fnv1a } from '../geo';
import { DecisionSchema, parseTerrainParams } from '../gemini/schema';
import type { Decision, ObservationPacket, ReplayEntry, ReplayLog, TerrainParams } from '../types';

export function hashPacket(packet: ObservationPacket): string {
  return fnv1a(JSON.stringify(packet));
}

export function createReplayLog(seed: number, params: TerrainParams): ReplayLog {
  return { version: 1, seed, params, entries: [] };
}

export function recordEntry(log: ReplayLog, e: ReplayEntry): ReplayLog {
  return { ...log, entries: [...log.entries, e] };
}

export function serializeReplay(log: ReplayLog): string {
  return JSON.stringify(log, null, 2);
}

export function parseReplay(json: unknown): ReplayLog {
  const o = json as Partial<ReplayLog>;
  if (!o || o.version !== 1 || typeof o.seed !== 'number' || !Array.isArray(o.entries)) throw new Error('invalid replay log');
  const params = parseTerrainParams(o.params);
  const entries: ReplayEntry[] = o.entries.map((e, i) => {
    const entry = e as Partial<ReplayEntry>;
    return {
      seed: typeof entry.seed === 'number' ? entry.seed : o.seed!,
      step: typeof entry.step === 'number' ? entry.step : i,
      packetHash: String(entry.packetHash ?? ''),
      decision: DecisionSchema.parse(entry.decision),
      thought: String(entry.thought ?? ''),
      latencyMs: Number(entry.latencyMs ?? 0),
    };
  });
  return { version: 1, seed: o.seed, params, entries };
}

export async function loadReplay(name: string): Promise<ReplayLog> {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  const res = await fetch(`/replays/${safe}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`replay ${safe} not found (${res.status})`);
  return parseReplay(await res.json());
}

/** Player: hands back recorded decisions in order; warns when the packet diverged. */
export class ReplayPlayer {
  private index = 0;
  constructor(public readonly log: ReplayLog) {}
  get remaining(): number {
    return this.log.entries.length - this.index;
  }
  next(packet: ObservationPacket): { decision: Decision; thought: string; latencyMs: number; diverged: boolean } | null {
    const e = this.log.entries[this.index];
    if (!e) return null;
    this.index++;
    const diverged = e.packetHash !== '' && e.packetHash !== hashPacket(packet);
    return { decision: e.decision, thought: e.thought, latencyMs: e.latencyMs, diverged };
  }
  reset() {
    this.index = 0;
  }
}
