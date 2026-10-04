/** Shared SARAH types. Frame conventions: see constants.ts. */
import type { Decision, TerrainParams } from './gemini/schema';
import type { SensorCalibration } from './sim/depth';

export type { Decision, TerrainParams };

// ---------------------------------------------------------------------------
// Rover / mission
// ---------------------------------------------------------------------------

export type Phase = 'SEARCH' | 'EXTRACT' | 'COMPLETE';

export interface RoverState {
  x: number;
  z: number;
  headingDeg: number;
  phase: Phase;
  step: number;
  decisionsUsed: number;
}

// ---------------------------------------------------------------------------
// Local simulator collision result; never sent to Gemini as a sensor channel.
// ---------------------------------------------------------------------------

export type CollisionHit = 'TREE' | 'FALLEN_LOG' | 'ROCK' | 'WATER' | 'STEEP_SLOPE' | 'OBSTACLE';

// ---------------------------------------------------------------------------
// Observation packet: explicit current inputs only; prior model context is never reused.
// ---------------------------------------------------------------------------

export interface ObservationPacket {
  world: {
    width_m: number;
    height_m: number;
    bounds_m: { min_x: number; max_x: number; min_z: number; max_z: number };
    base: { x: number; z: number };
  };
  mission: {
    phase: Phase;
    step: number;
    decisions_remaining: number;
    distance_traveled_m: number;
  };
  pose: { x: number; z: number; heading_deg: number };
  sensors: SensorCalibration;
  memory: string;
  last_result: string;
  /** Present only after the field team radios a location clue. */
  search_guidance?: SearchGuidance;
}

/** Weighted field briefings the decider should fold into the next search move. */
export interface SearchGuidance {
  strength: number;
  focus_bearing_deg: number;
  step_m: number;
  summary: string;
  clues: {
    text: string;
    certainty: number;
    weight: number;
    summary: string;
    suppressed: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Sensors / frames
// ---------------------------------------------------------------------------

export interface SensorFrame {
  seq: number;
  t: number; // performance.now()
  worldVersion: number;
  /** Clean sensor captures at the same pose/tick. Depth is a lossless image/png. */
  rgbUrl: string;
  thermalUrl: string;
  depthUrl: string;
  rgbB64: string;
  thermalB64: string;
  depthPngB64: string;
  pose: { x: number; z: number; headingDeg: number };
}

// ---------------------------------------------------------------------------
// Decide API
// ---------------------------------------------------------------------------

export interface DecideRequest {
  packet: ObservationPacket;
  /** base64 image payloads, without data-URL prefixes */
  rgb: string;
  thermal: string;
  depth: string;
}

export interface DecideResponse {
  decision: Decision;
  thoughtSummary: string;
  model: string | null;
  latencyMs: number;
  tokens: { input: number; output: number; total: number };
  source: 'gemini' | 'mock';
}

// ---------------------------------------------------------------------------
// Replay (plan §3b)
// ---------------------------------------------------------------------------

export interface ReplayEntry {
  seed: number;
  step: number;
  packetHash: string;
  decision: Decision;
  relativeTurnDeg?: number;
  thought: string;
  model: string | null;
  latencyMs: number;
}

export interface ReplayLog {
  version: 3;
  seed: number;
  params: TerrainParams;
  entries: ReplayEntry[];
}

// ---------------------------------------------------------------------------
// Grading (plan §2 "Grading")
// ---------------------------------------------------------------------------

export type MissionOutcome = 'CORRECT_MARK' | 'FALSE_MARK' | 'NO_MARK' | 'BUDGET_EXHAUSTED' | 'ABORTED';

export interface GradeResult {
  outcome: MissionOutcome;
  success: boolean;
  markPosition: { x: number; z: number } | null;
  distanceErrorM: number | null;
  decisionsUsed: number;
  distanceTraveledM: number;
  returnedToBase: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Feed (UI)
// ---------------------------------------------------------------------------

export interface FeedEntry {
  id: number;
  step: number;
  t: number;
  kind: 'decision' | 'result' | 'system' | 'error' | 'thought';
  text: string;
  decision?: Decision;
  thought?: string;
  latencyMs?: number;
  model?: string | null;
  source?: DecideResponse['source'] | 'manual' | 'replay';
}
