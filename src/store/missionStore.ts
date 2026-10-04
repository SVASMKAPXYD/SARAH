/**
 * P3/P4 — single Zustand store for the mission. The MissionController (lib/sim/missionLoop.ts)
 * owns all writes to the sim fields; UI components read via selectors. Keep World (with
 * ground truth) here only for rendering/grading — never serialize it toward Gemini.
 */
import { create } from 'zustand';
import { DECISION_BUDGET, DEFAULT_SEED } from '@/lib/constants';
import { DEFAULT_TERRAIN_PARAMS } from '@/lib/gemini/schema';
import type { Vec2 } from '@/lib/geo';
import type { ExecState } from '@/lib/sim/executor';
import { createMapState } from '@/lib/sim/mapStore';
import type {
  Assessment,
  Decision,
  FeedEntry,
  GradeResult,
  LidarGrid,
  MapState,
  ReplayLog,
  RoverState,
  SensorFrame,
  TerrainParams,
} from '@/lib/types';
import type { AnimalState } from '@/lib/world/animals';
import type { World } from '@/lib/world/terrain';

export type MissionStatus = 'idle' | 'running' | 'waiting_for_gemini' | 'paused' | 'complete' | 'failed';
export type DeciderMode = 'api' | 'replay' | 'manual';
export type DecisionSource = 'gemini' | 'mock' | 'manual' | 'replay';

export interface MissionState {
  // world
  seed: number;
  params: TerrainParams;
  world: World | null;
  worldVersion: number;
  animals: AnimalState[];

  // rover + map
  rover: RoverState;
  map: MapState;
  lastNodeId: string;
  trace: Vec2[];
  traceMinClearanceM: number;
  distanceTraveledM: number;
  exec: ExecState | null;
  returnRoute: string[];

  // loop
  status: MissionStatus;
  pausedFrom: MissionStatus | null;
  needsDecision: boolean;
  error: string | null;
  deciderMode: DeciderMode;
  lastSource: DecisionSource | null;
  budget: number;

  // decisions
  lastDecision: Decision | null;
  lastThought: string;
  lastLatencyMs: number | null;
  lastTokens: { input: number; output: number; total: number } | null;
  totalTokens: number;
  lastResult: string;
  previousAssessment: Assessment;
  decisions: Decision[];
  feed: FeedEntry[];
  markPosition: Vec2 | null;
  grade: GradeResult | null;

  // sensors
  lidar: LidarGrid | null;
  frame: SensorFrame | null;
  captureRequest: number;

  // replay
  replayLog: ReplayLog | null;
  replaySource: ReplayLog | null;
}

export const initialRover = (): RoverState => ({ x: 0, z: 0, headingDeg: 0, phase: 'SEARCH', currentNode: 'BASE', step: 0, decisionsUsed: 0 });

export const useMissionStore = create<MissionState>(() => ({
  seed: DEFAULT_SEED,
  params: DEFAULT_TERRAIN_PARAMS,
  world: null,
  worldVersion: 0,
  animals: [],

  rover: initialRover(),
  map: createMapState(),
  lastNodeId: 'BASE',
  trace: [],
  traceMinClearanceM: 30,
  distanceTraveledM: 0,
  exec: null,
  returnRoute: ['BASE'],

  status: 'idle',
  pausedFrom: null,
  needsDecision: false,
  error: null,
  deciderMode: 'api',
  lastSource: null,
  budget: DECISION_BUDGET,

  lastDecision: null,
  lastThought: '',
  lastLatencyMs: null,
  lastTokens: null,
  totalTokens: 0,
  lastResult: 'Mission start at BASE. No actions yet.',
  previousAssessment: 'NO_EVIDENCE',
  decisions: [],
  feed: [],
  markPosition: null,
  grade: null,

  lidar: null,
  frame: null,
  captureRequest: 0,

  replayLog: null,
  replaySource: null,
}));

// ---------------------------------------------------------------------------
// UI-only store
// ---------------------------------------------------------------------------

export interface UIState {
  mainView: 'world' | 'rover';
  thermal: boolean;
  revealTruth: boolean;
  devConsole: boolean;
  showGeminiOverlay: boolean;
  setMainView: (v: UIState['mainView']) => void;
  swapViews: () => void;
  setThermal: (v: boolean) => void;
  setRevealTruth: (v: boolean) => void;
  setDevConsole: (v: boolean) => void;
  setShowGeminiOverlay: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  mainView: 'world',
  thermal: false,
  revealTruth: false,
  devConsole: false,
  showGeminiOverlay: false,
  setMainView: (mainView) => set({ mainView }),
  swapViews: () => set({ mainView: get().mainView === 'world' ? 'rover' : 'world' }),
  setThermal: (thermal) => set({ thermal }),
  setRevealTruth: (revealTruth) => set({ revealTruth }),
  setDevConsole: (devConsole) => set({ devConsole }),
  setShowGeminiOverlay: (showGeminiOverlay) => set({ showGeminiOverlay }),
}));
