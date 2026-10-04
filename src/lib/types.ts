/**
 * SARAH shared types — the P1↔P2↔P3↔P4 contract (plan §3b, §3c, §4; spec §4 types kept).
 * Frame conventions: see constants.ts header.
 */
import type { LIDAR_COLUMN_KEYS, LIDAR_ROWS } from './constants';
import type { Decision, MapUpdate, TerrainParams } from './gemini/schema';

export type { Decision, MapUpdate, TerrainParams };

// ---------------------------------------------------------------------------
// Map (spec §4 types, Gemini-authored)
// ---------------------------------------------------------------------------

export type NodeKind = 'BASE' | 'JUNCTION' | 'VIEWPOINT' | 'DEAD_END' | 'EVIDENCE' | 'SURVIVOR';
export type Assessment = 'NO_EVIDENCE' | 'POSSIBLE' | 'LIKELY' | 'CONFIRMED_CANDIDATE';
export type TerrainKind = 'TRAIL' | 'FOREST' | 'SLOPE' | 'BRIDGE';

export interface TopoNode {
  id: string;
  x: number;
  z: number;
  kind: NodeKind;
  visited: boolean;
  note?: string;
  lastAssessment?: Assessment;
  thermalScore?: number;
  rgbPersonScore?: number;
  /** Consecutive observations at this node with assessment ≥ LIKELY. */
  evidenceFrames?: number;
}

export interface TopoEdge {
  id: string;
  from: string;
  to: string;
  /** Actual positions driven (recorded from motion). */
  polyline: { x: number; z: number }[];
  lengthM: number;
  bearingDeg: number;
  minClearanceM: number;
  safe: boolean;
  terrain?: TerrainKind;
  hazardCost: number;
}

export type FrontierGeometry = 'CLEAR' | 'NARROW' | 'UNCERTAIN';
export type FrontierStatus = 'UNEXPLORED' | 'TRAVERSED' | 'BLOCKED';

export interface Frontier {
  id: string;
  fromNode: string;
  bearingDeg: number;
  estimatedDistanceM: number;
  geometry: FrontierGeometry;
  status: FrontierStatus;
  note: string;
}

export interface MapState {
  nodes: TopoNode[];
  edges: TopoEdge[];
  frontiers: Frontier[];
  nextNodeIndex: number;
  nextEdgeIndex: number;
  nextFrontierIndex: number;
}

// ---------------------------------------------------------------------------
// Rover / mission
// ---------------------------------------------------------------------------

export type Phase = 'SEARCH' | 'INVESTIGATE' | 'CONFIRM' | 'RESCUE' | 'EXTRACT' | 'COMPLETE';

export interface RoverState {
  x: number;
  z: number;
  headingDeg: number;
  phase: Phase;
  currentNode: string | null;
  step: number;
  decisionsUsed: number;
}

export type Intent = Decision['intent'];
export type ActionType = Decision['action']['type'];

// ---------------------------------------------------------------------------
// LiDAR grid (plan §3c)
// ---------------------------------------------------------------------------

export type LidarColumnKey = (typeof LIDAR_COLUMN_KEYS)[number];
export type LidarRow = (typeof LIDAR_ROWS)[number];
export type LidarHit = 'CLEAR' | 'TREE' | 'FALLEN_LOG' | 'ROCK' | 'WATER' | 'STEEP_SLOPE' | 'GROUND';

export interface LidarCell {
  /** Distance in meters, or null when > LIDAR_MAX_M (CLEAR). */
  m: number | null;
  hit: LidarHit;
}

export type LidarRowGrid = Record<LidarColumnKey, LidarCell>;

export interface LidarGrid {
  level: LidarRowGrid;
  ground: LidarRowGrid;
}

// ---------------------------------------------------------------------------
// Observation packet (plan §4, sent to Gemini verbatim as JSON text)
// ---------------------------------------------------------------------------

export interface PacketNode {
  id: string;
  x: number;
  z: number;
  kind: NodeKind;
  visited: boolean;
  note?: string;
  last_assessment?: Assessment;
  bearing_from_rover_deg: number;
  distance_m: number;
}

export interface PacketEdge {
  id: string;
  from: string;
  to: string;
  length_m: number;
  bearing_deg: number;
  safe: boolean;
  terrain?: TerrainKind;
  hazard_cost: number;
}

export interface PacketFrontier {
  id: string;
  from_node: string;
  bearing_deg: number;
  estimated_distance_m: number;
  geometry: FrontierGeometry;
  status: FrontierStatus;
  note?: string;
}

export interface ObservationPacket {
  mission: {
    phase: Phase;
    step: number;
    decisions_remaining: number;
    distance_traveled_m: number;
    safe_return_path: string[];
    previous_assessment: Assessment;
  };
  pose: { x: number; z: number; heading_deg: number; at_node: string | null };
  lidar: LidarGrid;
  map: { nodes: PacketNode[]; edges: PacketEdge[]; frontiers: PacketFrontier[] };
  last_result: string;
}

// ---------------------------------------------------------------------------
// Sensors / frames
// ---------------------------------------------------------------------------

export interface SensorFrame {
  seq: number;
  t: number; // performance.now()
  /** Clean UI copies (no overlay), data URLs (image/jpeg). */
  rgbUrl: string;
  thermalUrl: string;
  /** Gemini copies with the burned-in overlay, base64 JPEG without the data: prefix. */
  rgbGeminiB64: string;
  thermalGeminiB64: string;
  lidar: LidarGrid;
  pose: { x: number; z: number; headingDeg: number };
}

// ---------------------------------------------------------------------------
// Decide API
// ---------------------------------------------------------------------------

export interface DecideRequest {
  packet: ObservationPacket;
  /** base64 JPEG (no data: prefix) */
  rgb: string;
  thermal: string;
}

export interface DecideResponse {
  decision: Decision;
  thoughtSummary: string;
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
  thought: string;
  latencyMs: number;
}

export interface ReplayLog {
  version: 1;
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
  leadsInvestigated: number;
  distanceTraveledM: number;
  nodesDeclared: number;
  frontiersDeclared: number;
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
  source?: DecideResponse['source'] | 'manual' | 'replay';
}
