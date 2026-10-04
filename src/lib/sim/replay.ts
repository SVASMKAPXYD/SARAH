/**
 * P3/P2 — replay (plan §3b). The recorder appends one entry per decision; the player
 * returns recorded decisions in order so the executor can re-drive a real Gemini run
 * with zero network. `?replay=<name>` loads `public/replays/<name>.json`.
 * A replay is a recording, not a decision-maker.
 */
import { fnv1a } from '../geo.ts';
import { DecisionSchema, parseTerrainParams } from '../gemini/schema.ts';
import { normalizeBearing } from './movement.ts';
import type { Decision, ObservationPacket, ReplayEntry, ReplayLog, TerrainParams } from '../types.ts';

export function hashPacket(packet: ObservationPacket): string {
  return fnv1a(JSON.stringify(packet));
}

export function createReplayLog(seed: number, params: TerrainParams): ReplayLog {
  return { version: 3, seed, params, entries: [] };
}

export function recordEntry(log: ReplayLog, e: ReplayEntry): ReplayLog {
  return { ...log, entries: [...log.entries, e] };
}

export function serializeReplay(log: ReplayLog): string {
  return JSON.stringify(log, null, 2);
}

export function parseReplay(json: unknown): ReplayLog {
  if (!json || typeof json !== 'object') throw new Error('invalid replay log');
  const o = json as { version?: unknown; seed?: unknown; params?: unknown; entries?: unknown };
  if ((o.version !== 1 && o.version !== 2 && o.version !== 3) || typeof o.seed !== 'number' || !Array.isArray(o.entries)) {
    throw new Error('invalid replay log');
  }
  const params = parseTerrainParams(o.params);
  let replayMemory = '';
  const entries: ReplayEntry[] = o.entries.map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`invalid replay entry at index ${i}`);
    const entry = e as Record<string, unknown>;
    let decision: Decision;
    let relativeTurnDeg: number | undefined;
    if (o.version === 1) {
      const legacy = parseLegacyDecision(entry.decision);
      decision = { ...legacy.decision, replace_entire_memory: replayMemory };
      relativeTurnDeg = legacy.relativeTurnDeg;
    } else if (o.version === 2) {
      const oldDecision = entry.decision && typeof entry.decision === 'object'
        ? entry.decision as Record<string, unknown>
        : {};
      const { memory_update: memoryUpdate, ...decisionFields } = oldDecision;
      if (typeof memoryUpdate === 'string') replayMemory = memoryUpdate;
      decision = DecisionSchema.parse({ ...decisionFields, replace_entire_memory: replayMemory });
    } else {
      decision = DecisionSchema.parse(entry.decision);
      replayMemory = decision.replace_entire_memory;
    }
    return {
      seed: typeof entry.seed === 'number' ? entry.seed : o.seed as number,
      step: typeof entry.step === 'number' ? entry.step : i,
      packetHash: String(entry.packetHash ?? ''),
      decision,
      ...(relativeTurnDeg !== undefined ? { relativeTurnDeg } : {}),
      thought: String(entry.thought ?? ''),
      model: typeof entry.model === 'string' ? entry.model : null,
      latencyMs: Number(entry.latencyMs ?? 0),
    };
  });
  return { version: 3, seed: o.seed, params, entries };
}

function parseLegacyDecision(value: unknown): { decision: Decision; relativeTurnDeg: number } {
  if (!value || typeof value !== 'object') throw new Error('invalid legacy replay decision');
  const legacy = value as { action?: unknown; brief_reason?: unknown };
  if (!legacy.action || typeof legacy.action !== 'object') throw new Error('invalid legacy replay action');
  const action = legacy.action as Record<string, unknown>;
  const reason = typeof legacy.brief_reason === 'string' ? legacy.brief_reason : 'Legacy replay decision.';
  if (action.type === 'MOVE') {
    const distance = typeof action.distance_m === 'number' && Number.isFinite(action.distance_m)
      ? Math.max(0, Math.min(15, action.distance_m))
      : 0;
    const turn = typeof action.turn_deg === 'number' && Number.isFinite(action.turn_deg)
      ? Math.max(-180, Math.min(180, action.turn_deg))
      : 0;
    return {
      decision: DecisionSchema.parse({ bearing_deg: 0, distance_m: distance, reason, replace_entire_memory: '' }),
      relativeTurnDeg: turn,
    };
  }
  if (action.type === 'MARK_SURVIVOR') {
    return {
      decision: DecisionSchema.parse({ bearing_deg: 0, distance_m: 0, reason, mark_survivor: true, replace_entire_memory: '' }),
      relativeTurnDeg: 0,
    };
  }
  throw new Error('invalid legacy replay action type');
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
  public readonly log: ReplayLog;

  constructor(log: ReplayLog) {
    this.log = log;
  }
  get remaining(): number {
    return this.log.entries.length - this.index;
  }
  next(packet: ObservationPacket): { decision: Decision; thought: string; model: string | null; latencyMs: number; diverged: boolean } | null {
    const e = this.log.entries[this.index];
    if (!e) return null;
    this.index++;
    const diverged = e.packetHash !== '' && e.packetHash !== hashPacket(packet);
    const decision = e.relativeTurnDeg === undefined
      ? e.decision
      : { ...e.decision, bearing_deg: normalizeBearing(packet.pose.heading_deg + e.relativeTurnDeg) };
    return { decision, thought: e.thought, model: e.model, latencyMs: e.latencyMs, diverged };
  }
  reset() {
    this.index = 0;
  }
}
