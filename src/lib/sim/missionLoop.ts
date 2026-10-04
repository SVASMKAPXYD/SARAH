/**
 * P3 — MissionController: the one place that writes the sim fields of the mission store.
 *
 *   start → world from (seed, params) → BASE node → loop:
 *     tick animals + sensors (LiDAR @ 1 Hz, capture request to the SensorRig)
 *     action in progress?  → executor tick (4 m/s, 180°/s, collision stop)
 *     action complete?     → build packet, grab latest RGB/thermal (or a placeholder),
 *                            ask the decider (api | manual | replay), validate, apply
 *                            map_update, derive phase, plan + start the action,
 *                            record replay entry, append feed
 *   until budget exhausted / EXTRACT reaches BASE / error → grade → complete | failed.
 *
 * Nothing here judges Gemini's content: physics (executor), the two protocol rules
 * (executor) and schema shape (zod) are the only checks. Runs in the browser only.
 */
import { AT_NODE_RADIUS_M, DECISION_BUDGET, LIDAR_MAX_M, SENSOR_TICK_HZ } from '../constants';
import { DecisionSchema } from '../gemini/schema';
import { dirFromBearing, distance } from '../geo';
import type { DecideResponse, Decision, FeedEntry, ObservationPacket, Phase, ReplayLog, TerrainParams } from '../types';
import { initAnimals, stepAnimals } from '../world/animals';
import { generateWorld } from '../world/terrain';
import { safeReturnPath } from './dijkstra';
import { planAction, startExecution, tickExecution, type ActionPlan } from './executor';
import { gradeMission } from './grading';
import { applyMapUpdate, createMapState, nodeAt } from './mapStore';
import { renderGeminiImage } from './overlay';
import { buildPacket } from './packetBuilder';
import { derivePhase, phaseAfterExecution } from './phase';
import { createReplayLog, hashPacket, loadReplay, recordEntry, ReplayPlayer, serializeReplay } from './replay';
import { computeLidar, minLevelClearance, type DynamicBodies } from './sensors';
import { initialRover, useMissionStore, type DeciderMode, type DecisionSource, type MissionState } from '@/store/missionStore';

const TICK_MS = 50;
const TRACE_SPACING_M = 0.5;

/** 1×1 black JPEG, used only if neither the rig nor the overlay burner can produce a frame. */
const PLACEHOLDER_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

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
    const world = generateWorld(params, seed);
    this.set({ seed, params, world, worldVersion: this.s.worldVersion + 1 });
    this.resetMission();
    this.feed('system', `World generated from seed ${seed}: ${params.narration}`);
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
      map: createMapState(),
      lastNodeId: 'BASE',
      trace: [],
      drivenPath: [],
      traceMinClearanceM: LIDAR_MAX_M,
      distanceTraveledM: 0,
      exec: null,
      returnRoute: ['BASE'],
      status: 'idle',
      pausedFrom: null,
      needsDecision: false,
      error: null,
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
      lidar: world ? computeLidar(world, rover, this.dyn()) : null,
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
    this.applyDecision(packet, parsed.data, { thought: '', latencyMs: 0, tokens: { input: 0, output: 0, total: 0 }, source: 'manual' });
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
    const lidar = computeLidar(s.world, s.rover, this.dyn());
    const moving = s.exec !== null && s.exec.stage === 'DRIVE';
    this.set({
      lidar,
      captureRequest: s.captureRequest + 1,
      traceMinClearanceM: moving ? Math.min(s.traceMinClearanceM, minLevelClearance(lidar)) : s.traceMinClearanceM,
    });
  }

  // ------------------------------------------------------------------ executor
  private executorTick(dt: number) {
    const s = this.s;
    if (!s.world || !s.exec) return;
    const r = tickExecution(s.exec, s.rover, s.world, this.dyn(), dt);
    const pose = r.pose;
    const trace = s.trace;
    const last = trace[trace.length - 1];
    const point = { x: pose.x, z: pose.z };
    const newTrace = r.movedM > 0 && (!last || distance(last, pose) >= TRACE_SPACING_M) ? [...trace, point] : trace;
    const path = s.drivenPath;
    const pathLast = path[path.length - 1];
    const drivenPath = r.movedM > 0 && (!pathLast || distance(pathLast, pose) >= TRACE_SPACING_M) ? [...path, point] : path;
    const at = nodeAt(s.map, pose, AT_NODE_RADIUS_M);
    const rover = { ...s.rover, x: pose.x, z: pose.z, headingDeg: pose.headingDeg, currentNode: at?.id ?? null };
    this.set({ rover, exec: r.exec, trace: newTrace, drivenPath, distanceTraveledM: s.distanceTraveledM + r.movedM });
    if (r.done) this.onActionDone(r.exec.plan, r.lastResult ?? '');
  }

  private onActionDone(plan: ActionPlan, lastResult: string) {
    const s = this.s;
    if (!s.world) return;
    let phase: Phase = s.rover.phase;
    let lastNodeId = s.lastNodeId;
    let trace = s.trace;
    let drivenPath = s.drivenPath;
    let markPosition = s.markPosition;
    const rover = { ...s.rover };

    // final pose always closes the segment trace and the full-run trail
    const lastPt = trace[trace.length - 1];
    if (!lastPt || distance(lastPt, rover) > 0.05) trace = [...trace, { x: rover.x, z: rover.z }];
    const pathLast = drivenPath[drivenPath.length - 1];
    if (!pathLast || distance(pathLast, rover) > 0.05) drivenPath = [...drivenPath, { x: rover.x, z: rover.z }];

    if (plan.kind === 'MARK' && plan.accepted) {
      const centerM = s.lidar?.level['0'].m ?? 0;
      const d = dirFromBearing(rover.headingDeg);
      markPosition = { x: rover.x + d.x * centerM, z: rover.z + d.z * centerM };
      phase = phaseAfterExecution(phase, { markAccepted: true });
    }
    if (plan.kind === 'FOLLOW' && rover.currentNode === plan.targetNode) {
      lastNodeId = plan.targetNode;
      trace = [];
      if (plan.label === 'EXTRACT' && plan.targetNode === 'BASE') phase = phaseAfterExecution(phase, { arrivedAtBase: true });
    }
    rover.phase = phase;

    this.set({ rover, lastNodeId, trace, drivenPath, markPosition, lastResult: lastResult, exec: null, needsDecision: true, returnRoute: safeReturnPath(s.map, rover.currentNode ?? lastNodeId) });
    this.feed('result', lastResult);

    if (phase === 'COMPLETE') this.finish('complete');
  }

  // ------------------------------------------------------------------ decisions
  private currentFrames(packet: ObservationPacket): { rgb: string; thermal: string } {
    const f = this.s.frame;
    if (f && f.rgbGeminiB64 && f.thermalGeminiB64) return { rgb: f.rgbGeminiB64, thermal: f.thermalGeminiB64 };
    // The rig has not produced a frame yet: burn the overlay onto a black frame so Gemini
    // still gets the bearing/distance grid; fall back to a 1×1 JPEG outside a browser.
    try {
      if (typeof document !== 'undefined') {
        return { rgb: renderGeminiImage(null, packet.lidar, 'RGB (no render)'), thermal: renderGeminiImage(null, packet.lidar, 'THERMAL (no render)') };
      }
    } catch {
      /* fall through */
    }
    return { rgb: PLACEHOLDER_JPEG_B64, thermal: PLACEHOLDER_JPEG_B64 };
  }

  private buildCurrentPacket(): ObservationPacket {
    const s = this.s;
    const lidar = s.world ? computeLidar(s.world, s.rover, this.dyn()) : s.lidar!;
    const at = nodeAt(s.map, s.rover, AT_NODE_RADIUS_M);
    this.set({ lidar });
    return buildPacket({
      phase: s.rover.phase,
      step: s.rover.step,
      decisionsUsed: s.rover.decisionsUsed,
      distanceTraveledM: s.distanceTraveledM,
      previousAssessment: s.previousAssessment,
      pose: s.rover,
      atNode: at?.id ?? null,
      lastNodeId: s.lastNodeId,
      lidar,
      map: s.map,
      lastResult: s.lastResult,
      budget: s.budget,
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
      this.applyDecision(packet, next.decision, { thought: next.thought, latencyMs: next.latencyMs, tokens: { input: 0, output: 0, total: 0 }, source: 'replay' });
      return;
    }

    // api mode: the server decides between Gemini and the mock.
    const frames = this.currentFrames(packet);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packet, rgb: frames.rgb, thermal: frames.thermal, budget: s.budget }),
      });
      const json = (await res.json()) as Partial<DecideResponse> & { error?: string };
      if (!res.ok || !json.decision) throw new Error(json.error ?? `HTTP ${res.status}`);
      const parsed = DecisionSchema.safeParse(json.decision);
      if (!parsed.success) throw new Error(`invalid decision from server: ${parsed.error.message.slice(0, 300)}`);
      this.inflight = false;
      if (this.s.status === 'idle') return; // reset while waiting
      this.applyDecision(packet, parsed.data, {
        thought: json.thoughtSummary ?? '',
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
    meta: { thought: string; latencyMs: number; tokens: { input: number; output: number; total: number }; source: DecisionSource },
  ) {
    const s = this.s;
    if (!s.world) return;
    const step = s.rover.step + 1;
    const decisionsUsed = s.rover.decisionsUsed + 1;

    // 1. map_update + evidence → store
    const at = nodeAt(s.map, s.rover, AT_NODE_RADIUS_M);
    const applied = applyMapUpdate(s.map, decision, {
      pose: s.rover,
      prevNodeId: s.lastNodeId,
      currentNodeId: at?.id ?? null,
      trace: s.trace,
      minClearanceM: s.traceMinClearanceM,
    });
    let map = applied.map;
    let lastNodeId = s.lastNodeId;
    let trace = s.trace;
    let traceMinClearanceM = s.traceMinClearanceM;
    let currentNode: string | null = at?.id ?? null;
    if (applied.nodeHereId) {
      currentNode = applied.nodeHereId;
      lastNodeId = applied.nodeHereId;
      trace = [];
      traceMinClearanceM = LIDAR_MAX_M;
    } else if (currentNode && currentNode !== lastNodeId) {
      lastNodeId = currentNode;
      trace = [];
      traceMinClearanceM = LIDAR_MAX_M;
    }

    // 2. phase from intent
    let phase = derivePhase(s.rover.phase, decision);

    // 3. plan the action (physics + the two protocol rules live in the executor)
    const rover = { ...s.rover, step, decisionsUsed, currentNode, phase };
    const plan = planAction(decision, {
      map,
      rover,
      trace,
      lastNodeId,
      previousAssessment: s.previousAssessment,
      currentAssessment: decision.survivor_assessment,
      lidar: packet.lidar,
      phase,
    });
    if (plan.kind === 'FOLLOW' && plan.label === 'EXTRACT') {
      phase = phaseAfterExecution(phase, { extractStarted: true });
      rover.phase = phase;
      map = { ...map, nodes: map.nodes.map((n) => (n.id === lastNodeId ? { ...n, visited: true } : n)) };
    }
    const exec = startExecution(plan, rover);

    // 4. replay record
    const replayLog = s.replayLog
      ? recordEntry(s.replayLog, { seed: s.seed, step, packetHash: hashPacket(packet), decision, thought: meta.thought, latencyMs: meta.latencyMs })
      : s.replayLog;

    const keepPaused = this.s.status === 'paused';
    this.set({
      map,
      rover,
      lastNodeId,
      trace,
      traceMinClearanceM,
      exec,
      status: keepPaused ? 'paused' : 'running',
      pausedFrom: keepPaused ? 'running' : null,
      lastDecision: decision,
      lastThought: meta.thought,
      lastLatencyMs: meta.latencyMs,
      lastTokens: meta.tokens,
      totalTokens: s.totalTokens + meta.tokens.total,
      lastSource: meta.source,
      previousAssessment: decision.survivor_assessment,
      decisions: [...s.decisions, decision],
      replayLog,
      returnRoute: safeReturnPath(map, currentNode ?? lastNodeId),
      error: null,
    });

    const a = decision.action;
    const actionText =
      a.type === 'MOVE'
        ? `MOVE turn ${a.turn_deg ?? 0}°, ${a.distance_m ?? 0} m`
        : a.type === 'GOTO_NODE'
          ? `GOTO_NODE ${a.node_id ?? '?'}`
          : a.type;
    if (meta.thought) this.feed('thought', meta.thought, { thought: meta.thought, source: meta.source });
    this.feed('decision', `[${decision.intent}] ${decision.brief_reason} → ${actionText}`, { decision, latencyMs: meta.latencyMs, source: meta.source });
    if (applied.nodeHereId && decision.map_update.node_here) {
      this.feed('system', `Declared ${applied.nodeHereId} (${decision.map_update.node_here.kind})${applied.edgeId ? `, closed edge ${applied.edgeId}` : ''}.`);
    }
    // MARK / REJECT plans have no motion: resolve them now so last_result is reported and
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
      map: s.map,
      markPosition: s.markPosition,
      decisionsUsed: s.rover.decisionsUsed,
      budget: s.budget,
      distanceTraveledM: s.distanceTraveledM,
      decisions: s.decisions,
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
