/**
 * P3 — MissionController: the one place that writes the sim fields of the mission store.
 *
 *   start → world from (seed, params) → loop:
 *     tick animals + sensors (capture request to the SensorRig)
 *     action in progress?  → executor tick (4 m/s, 180°/s, collision stop)
 *     action complete?     → build packet, grab aligned RGB/thermal/depth,
 *                            ask the decider (api | manual | replay), validate, apply
 *                            memory replacement, execute the model's action,
 *                            record replay entry, append feed
 *   until budget exhausted / marked rover reaches BASE / error → grade → complete | failed.
 *
 * No local code selects routes or applies rescue-evidence gates. Only action shape and
 * physical simulation constrain the model; grading uses hidden truth after the run.
 */
import { DECISION_BUDGET, SENSOR_TICK_HZ } from '../constants';
import { DecisionSchema, parseTerrainParams } from '../gemini/schema';
import { distance } from '../geo';
import type { DecideResponse, Decision, FeedEntry, ObservationPacket, ReplayLog, TerrainParams } from '../types';
import { initAnimals, stepAnimals } from '../world/animals';
import { generateWorld } from '../world/terrain';
import { planAction, startExecution, tickExecution, type ActionPlan } from './executor';
import { gradeMission } from './grading';
import { buildPacket } from './packetBuilder';
import { createReplayLog, hashPacket, loadReplay, recordEntry, ReplayPlayer, serializeReplay } from './replay';
import type { DynamicBodies } from './collisions';
import { initialRover, useMissionStore, type DeciderMode, type DecisionSource, type MissionState } from '@/store/missionStore';

const TICK_MS = 50;
const PATH_SAMPLE_SPACING_M = 0.5;

export class MissionController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private sensorAccum = 0;
  private inflight = false;
  private feedId = 1;
  private replayPlayer: ReplayPlayer | null = null;
  private pendingPacket: ObservationPacket | null = null;

  // ------------------------------------------------------------------ helpers
  private get s(): MissionState {
    return useMissionStore.getState();
  }
  private set(patch: Partial<MissionState> | ((s: MissionState) => Partial<MissionState>)) {
    useMissionStore.setState(patch);
  }
  private feed(kind: FeedEntry['kind'], text: string, extra: Partial<FeedEntry> = {}) {
    const s = this.s;
    const entry: FeedEntry = { id: this.feedId++, step: s.rover.step, t: Date.now(), kind, text, ...extra };
    this.set({ feed: [...s.feed.slice(-199), entry] });
  }
  private dyn(): DynamicBodies {
    const s = this.s;
    return { animals: s.animals, survivor: s.world ? s.world.truth.survivor : null };
  }

  // ------------------------------------------------------------------ world
  /** Generate (or regenerate) the world and reset the mission on it. */
  regenerate(seed: number = this.s.seed, params: TerrainParams = this.s.params) {
    this.stopTimer();
    const fixedParams = parseTerrainParams(params);
    const world = generateWorld(fixedParams, seed);
    this.set({ seed, params: fixedParams, world, worldVersion: this.s.worldVersion + 1 });
    this.resetMission();
    this.feed('system', `World generated from seed ${seed}: ${fixedParams.narration}`);
  }

  /** Make sure a world exists (called on mount). */
  ensureWorld() {
    if (!this.s.world) this.regenerate();
  }

  /** Reset the mission on the current world (same seed). */
  reset() {
    this.stopTimer();
    this.resetMission();
    this.feed('system', 'Mission reset. Rover at BASE.');
  }

  private resetMission() {
    const s = this.s;
    this.inflight = false;
    this.pendingPacket = null;
    this.sensorAccum = 0;
    this.replayPlayer = s.replaySource ? new ReplayPlayer(s.replaySource) : null;
    const world = s.world;
    const rover = initialRover();
    this.set({
      animals: world ? initAnimals(world) : [],
      rover,
      drivenPath: [{ x: rover.x, z: rover.z }],
      distanceTraveledM: 0,
      exec: null,
      status: 'idle',
      pausedFrom: null,
      needsDecision: false,
      error: null,
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
      captureRequest: s.captureRequest + 1,
      replayLog: createReplayLog(s.seed, s.params),
    });
  }

  // ------------------------------------------------------------------ run control
  start() {
    const s = this.s;
    this.ensureWorld();
    if (s.status === 'paused') return this.resume();
    if (s.status === 'running' || s.status === 'waiting_for_gemini') return;
    if (s.status === 'complete' || s.status === 'failed') this.resetMission();
    this.set({ status: 'running', needsDecision: true, error: null });
    this.feed('system', `Mission started (${this.s.deciderMode} decider, budget ${this.s.budget}).`);
    this.startTimer();
  }

  pause() {
    const s = this.s;
    if (s.status !== 'running' && s.status !== 'waiting_for_gemini') return;
    this.set({ status: 'paused', pausedFrom: s.status });
    this.feed('system', 'Paused.');
  }

  resume() {
    const s = this.s;
    if (s.status !== 'paused') return;
    const back = this.inflight ? 'waiting_for_gemini' : 'running';
    this.set({ status: back, pausedFrom: null, error: null });
    this.feed('system', 'Resumed.');
    this.startTimer();
  }

  setDeciderMode(mode: DeciderMode) {
    this.set({ deciderMode: mode });
    if (mode === 'replay' && this.s.replaySource && !this.replayPlayer) this.replayPlayer = new ReplayPlayer(this.s.replaySource);
  }

  setParams(params: TerrainParams) {
    this.set({ params });
  }

  setSeed(seed: number) {
    this.set({ seed });
  }

  /** Save a field briefing verbatim for Gemini's next decision. */
  submitBriefing(raw: string): { ok: boolean; error?: string } {
    if (!raw.trim()) return { ok: false, error: 'Enter a briefing first.' };
    if (raw.length > 500) return { ok: false, error: 'Briefings must be 500 characters or fewer.' };
    this.ensureWorld();
    const s = this.s;
    if (!s.world) return { ok: false, error: 'The map is not ready yet.' };
    const briefings = [...s.briefings, raw].slice(-24);
    this.set({ briefings });
    this.feed('system', 'Field briefing saved verbatim for Gemini’s next decision.');
    return { ok: true };
  }

  /** Manual console: consume a Decision when the loop is waiting in manual mode. */
  submitManualDecision(raw: unknown): { ok: boolean; error?: string } {
    const parsed = DecisionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const s = this.s;
    if (s.deciderMode !== 'manual') return { ok: false, error: 'decider mode is not manual' };
    if (!this.pendingPacket || (s.status !== 'waiting_for_gemini' && s.status !== 'paused')) {
      return { ok: false, error: 'the loop is not waiting for a decision' };
    }
    const packet = this.pendingPacket;
    this.pendingPacket = null;
    this.inflight = false;
    this.applyDecision(packet, parsed.data, { thought: '', model: null, latencyMs: 0, tokens: { input: 0, output: 0, total: 0 }, source: 'manual' });
    return { ok: true };
  }

  /** Load `public/replays/<name>.json`, switch to replay mode and regenerate on its seed/params. */
  async loadReplay(name: string): Promise<void> {
    const log = await loadReplay(name);
    this.set({ replaySource: log, deciderMode: 'replay' });
    this.regenerate(log.seed, log.params);
    this.feed('system', `Replay "${name}" loaded: ${log.entries.length} recorded decisions.`);
  }

  clearReplay() {
    this.replayPlayer = null;
    this.set({ replaySource: null, deciderMode: 'api' });
  }

  /** Download the current replay log as JSON. */
  downloadReplay(filename = `sarah-replay-${this.s.seed}.json`) {
    const log: ReplayLog | null = this.s.replayLog;
    if (!log || typeof document === 'undefined') return;
    const blob = new Blob([serializeReplay(log)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------------ timer
  private startTimer() {
    if (this.timer) return;
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }
  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const s = this.s;
    const now = performance.now();
    // Background tabs throttle timers to ~1 Hz; allow up to 0.25 s per tick so the sim keeps pace.
    const dt = Math.min(0.25, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    if (!s.world) return;
    if (s.status !== 'running' && s.status !== 'waiting_for_gemini') return;

    // Animals move whenever the sim runs.
    const animals = stepAnimals(s.animals, s.rover, dt);
    this.set({ animals });

    // 1 Hz sensors.
    this.sensorAccum += dt;
    if (this.sensorAccum >= 1 / SENSOR_TICK_HZ) {
      this.sensorAccum = 0;
      this.sensorTick();
    }

    if (s.status !== 'running') return;

    if (s.exec && s.exec.stage !== 'DONE') {
      this.executorTick(dt);
    } else if (s.needsDecision && !this.inflight) {
      void this.requestDecision();
    }
  }

  private sensorTick() {
    const s = this.s;
    if (!s.world) return;
    this.set({ captureRequest: s.captureRequest + 1 });
  }

  // ------------------------------------------------------------------ executor
  private executorTick(dt: number) {
    const s = this.s;
    if (!s.world || !s.exec) return;
    const r = tickExecution(s.exec, s.rover, s.world, this.dyn(), dt);
    const pose = r.pose;
    const point = { x: pose.x, z: pose.z };
    const path = s.drivenPath;
    const pathLast = path[path.length - 1];
    const drivenPath = r.movedM > 0 && (!pathLast || distance(pathLast, pose) >= PATH_SAMPLE_SPACING_M) ? [...path, point] : path;
    const rover = { ...s.rover, x: pose.x, z: pose.z, headingDeg: pose.headingDeg };
    this.set({ rover, exec: r.exec, drivenPath, distanceTraveledM: s.distanceTraveledM + r.movedM });
    if (r.done) this.onActionDone(r.exec.plan, r.lastResult ?? '');
  }

  private onActionDone(plan: ActionPlan, lastResult: string) {
    const s = this.s;
    if (!s.world) return;
    let drivenPath = s.drivenPath;
    let markPosition = s.markPosition;
    const rover = { ...s.rover };

    // Record the endpoint even when the action is shorter than trace sampling.
    const pathLast = drivenPath[drivenPath.length - 1];
    if (!pathLast || distance(pathLast, rover) > 0.05) drivenPath = [...drivenPath, { x: rover.x, z: rover.z }];

    if (plan.kind === 'MARK') {
      markPosition = { x: rover.x, z: rover.z };
      rover.phase = 'EXTRACT';
    } else if (markPosition && distance(rover, s.world.base) <= 1.5) {
      rover.phase = 'COMPLETE';
    }

    this.set({ rover, drivenPath, markPosition, lastResult, exec: null, needsDecision: true });
    this.feed('result', lastResult);

    if (rover.phase === 'COMPLETE') this.finish('complete');
  }

  // ------------------------------------------------------------------ decisions
  private currentFrames(): { rgb: string; thermal: string; depth: string } | null {
    const f = this.s.frame;
    const rover = this.s.rover;
    if (!f || f.worldVersion !== this.s.worldVersion || !f.rgbB64 || !f.thermalB64 || !f.depthPngB64) return null;
    const samePosition = Math.hypot(f.pose.x - rover.x, f.pose.z - rover.z) <= 0.05;
    const headingDelta = Math.abs(((f.pose.headingDeg - rover.headingDeg + 540) % 360) - 180);
    if (!samePosition || headingDelta > 0.5) return null;
    return { rgb: f.rgbB64, thermal: f.thermalB64, depth: f.depthPngB64 };
  }

  private buildCurrentPacket(): ObservationPacket {
    const s = this.s;
    return buildPacket({
      phase: s.rover.phase,
      step: s.rover.step,
      decisionsUsed: s.rover.decisionsUsed,
      distanceTraveledM: s.distanceTraveledM,
      pose: s.rover,
      memory: s.memory,
      lastResult: s.lastResult,
      budget: s.budget,
      fieldBriefings: s.briefings,
    });
  }

  private async requestDecision() {
    const s = this.s;
    if (!s.world || this.inflight) return;
    if (s.rover.decisionsUsed >= s.budget) {
      this.feed('system', `Decision budget (${s.budget}) exhausted.`);
      this.finish('failed');
      return;
    }
    this.inflight = true;
    const packet = this.buildCurrentPacket();
    this.set({ needsDecision: false, status: 'waiting_for_gemini' });

    if (s.deciderMode === 'manual') {
      this.pendingPacket = packet;
      return; // submitManualDecision() completes the cycle
    }

    if (s.deciderMode === 'replay') {
      if (!this.replayPlayer) {
        this.inflight = false;
        this.fail('replay mode selected but no replay log is loaded (use ?replay=<file>)');
        return;
      }
      const next = this.replayPlayer.next(packet);
      if (!next) {
        this.inflight = false;
        this.feed('system', `Replay log exhausted after ${s.rover.decisionsUsed} decisions.`);
        this.finish(s.markPosition ? 'complete' : 'failed');
        return;
      }
      if (next.diverged) this.feed('system', `Replay step ${s.rover.step}: packet differs from the recording (world or sensors diverged).`);
      // small delay so the UI shows the waiting state
      await new Promise((r) => setTimeout(r, 200));
      this.inflight = false;
      if (this.s.status === 'idle') return; // reset while waiting
      this.applyDecision(packet, next.decision, { thought: next.thought, model: next.model, latencyMs: next.latencyMs, tokens: { input: 0, output: 0, total: 0 }, source: 'replay' });
      return;
    }

    // api mode: the server decides between Gemini and the mock.
    const frames = this.currentFrames();
    if (!frames) {
      this.inflight = false;
      const state = this.s;
      this.set({ needsDecision: true, status: 'running', captureRequest: state.captureRequest + 1 });
      return;
    }
    const t0 = performance.now();
    try {
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packet, rgb: frames.rgb, thermal: frames.thermal, depth: frames.depth, budget: s.budget }),
      });
      const json = (await res.json()) as Partial<DecideResponse> & { error?: string };
      if (!res.ok || !json.decision) throw new Error(json.error ?? `HTTP ${res.status}`);
      const parsed = DecisionSchema.safeParse(json.decision);
      if (!parsed.success) throw new Error(`invalid decision from server: ${parsed.error.message.slice(0, 300)}`);
      this.inflight = false;
      if (this.s.status === 'idle') return; // reset while waiting
      this.applyDecision(packet, parsed.data, {
        thought: json.thoughtSummary ?? '',
        model: json.model ?? null,
        latencyMs: json.latencyMs ?? Math.round(performance.now() - t0),
        tokens: json.tokens ?? { input: 0, output: 0, total: 0 },
        source: json.source ?? 'gemini',
      });
    } catch (e) {
      this.inflight = false;
      if (this.s.status === 'idle') return;
      this.fail(`decision request failed: ${(e as Error).message}`);
    }
  }

  private applyDecision(
    packet: ObservationPacket,
    decision: Decision,
    meta: { thought: string; model: string | null; latencyMs: number; tokens: { input: number; output: number; total: number }; source: DecisionSource },
  ) {
    const s = this.s;
    if (!s.world) return;
    const step = s.rover.step + 1;
    const decisionsUsed = s.rover.decisionsUsed + 1;

    const phase = decision.mark_survivor ? 'EXTRACT' : s.rover.phase;
    const rover = { ...s.rover, step, decisionsUsed, phase };
    const plan = planAction(decision);
    const exec = startExecution(plan, rover);

    const replayLog = s.replayLog
      ? recordEntry(s.replayLog, { seed: s.seed, step, packetHash: hashPacket(packet), decision, thought: meta.thought, model: meta.model, latencyMs: meta.latencyMs })
      : s.replayLog;

    const keepPaused = this.s.status === 'paused';
    this.set({
      rover,
      exec,
      status: keepPaused ? 'paused' : 'running',
      pausedFrom: keepPaused ? 'running' : null,
      lastDecision: decision,
      lastThought: meta.thought,
      lastLatencyMs: meta.latencyMs,
      lastTokens: meta.tokens,
      totalTokens: s.totalTokens + meta.tokens.total,
      lastSource: meta.source,
      lastModel: meta.model,
      memory: decision.replace_entire_memory,
      replayLog,
      error: null,
    });

    const actionText = decision.mark_survivor
      ? 'MARK_SURVIVOR at current position'
      : `MOVE bearing ${Math.round(decision.bearing_deg)}°, ${decision.distance_m} m`;
    if (meta.thought) this.feed('thought', meta.thought, { thought: meta.thought, source: meta.source });
    this.feed('decision', `${decision.reason} → ${actionText}`, { decision, latencyMs: meta.latencyMs, model: meta.model, source: meta.source });
    if (decision.replace_entire_memory !== s.memory) {
      this.feed('system', 'Gemini replaced its persistent memory.');
    }
    // MARK plans have no motion: resolve them now so last_result is reported and
    // the loop asks for the next decision instead of stalling on a DONE executor.
    if (exec.stage === 'DONE') {
      const r = tickExecution(exec, rover, s.world, this.dyn(), 0);
      this.onActionDone(r.exec.plan, r.lastResult ?? '');
    }
  }

  // ------------------------------------------------------------------ end states
  private fail(message: string) {
    this.feed('error', message);
    this.set({ error: message });
    this.finish('failed');
  }

  private finish(status: 'complete' | 'failed') {
    const s = this.s;
    if (!s.world) return;
    this.stopTimer();
    const grade = gradeMission({
      world: s.world,
      markPosition: s.markPosition,
      decisionsUsed: s.rover.decisionsUsed,
      budget: s.budget,
      distanceTraveledM: s.distanceTraveledM,
      roverPos: s.rover,
    });
    const final = status === 'complete' && !grade.success ? 'failed' : status;
    this.set({ status: final, grade, exec: null, needsDecision: false, pausedFrom: null });
    this.feed('system', `Mission ${final.toUpperCase()}: ${grade.summary}`);
  }

  dispose() {
    this.stopTimer();
  }
}

let singleton: MissionController | null = null;
export function getMissionController(): MissionController {
  if (!singleton) singleton = new MissionController();
  return singleton;
}
