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
import type {
  Decision,
  FeedEntry,
  GradeResult,
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

  // rover + driven path
  rover: RoverState;
  /** Every pose of this run, for the overhead-map trail. Cleared only by reset or regenerate. */
  drivenPath: Vec2[];
  distanceTraveledM: number;
  exec: ExecState | null;

  // loop
  status: MissionStatus;
  pausedFrom: MissionStatus | null;
  needsDecision: boolean;
  error: string | null;
  deciderMode: DeciderMode;
  lastSource: DecisionSource | null;
  lastModel: string | null;
  budget: number;

  // decisions
  lastDecision: Decision | null;
  lastThought: string;
  lastLatencyMs: number | null;
  lastTokens: { input: number; output: number; total: number } | null;
  totalTokens: number;
  lastResult: string;
  memory: string;
  feed: FeedEntry[];
  /** Verbatim radio calls for Gemini, oldest first. */
  briefings: string[];
  markPosition: Vec2 | null;
  grade: GradeResult | null;

  // sensors
  frame: SensorFrame | null;
  captureRequest: number;

  // replay
  replayLog: ReplayLog | null;
  replaySource: ReplayLog | null;
}

export const initialRover = (): RoverState => ({ x: 0, z: 0, headingDeg: 0, phase: 'SEARCH', step: 0, decisionsUsed: 0 });

export const useMissionStore = create<MissionState>(() => ({
  seed: DEFAULT_SEED,
  params: DEFAULT_TERRAIN_PARAMS,
  world: null,
  worldVersion: 0,
  animals: [],

  rover: initialRover(),
  drivenPath: [],
  distanceTraveledM: 0,
  exec: null,

  status: 'idle',
  pausedFrom: null,
  needsDecision: false,
  error: null,
  deciderMode: 'api',
  lastSource: null,
  lastModel: null,
  budget: DECISION_BUDGET,

  lastDecision: null,
  lastThought: '',
  lastLatencyMs: null,
  lastTokens: null,
  totalTokens: 0,
  lastResult: 'Mission start at BASE. No actions yet.',
  memory: '',
  feed: [],
  briefings: [],
  markPosition: null,
  grade: null,

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
  sensorView: 'rgb' | 'thermal' | 'depth';
  revealTruth: boolean;
  devConsole: boolean;
  setMainView: (v: UIState['mainView']) => void;
  swapViews: () => void;
  setSensorView: (v: UIState['sensorView']) => void;
  cycleSensorView: () => void;
  setRevealTruth: (v: boolean) => void;
  setDevConsole: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  mainView: 'world',
  sensorView: 'rgb',
  revealTruth: false,
  devConsole: false,
  setMainView: (mainView) => set({ mainView }),
  swapViews: () => set({ mainView: get().mainView === 'world' ? 'rover' : 'world' }),
  setSensorView: (sensorView) => set({ sensorView }),
  cycleSensorView: () => set((state) => ({
    sensorView: state.sensorView === 'rgb' ? 'thermal' : state.sensorView === 'thermal' ? 'depth' : 'rgb',
  })),
  setRevealTruth: (revealTruth) => set({ revealTruth }),
  setDevConsole: (devConsole) => set({ devConsole }),
}));
