/**
 * P3 — executor (plan §3b). Turns a Decision into an ActionPlan, then advances the rover
 * tick by tick. `last_result` strings are produced verbatim as in plan §3b.
 *
 *   MOVE        rotate in place (180°/s), then drive (4 m/s) with collision stop 0.5 m
 *               before obstacles; max 15 m; turn clamped to −180..180.
 *   GOTO_NODE   retrace the partial polyline back to the last node (if mid-edge), then
 *               follow the Dijkstra path over safe edges. No Gemini calls en route.
 *   MARK_SURVIVOR  protocol rule: previous AND current assessment CONFIRMED_CANDIDATE and
 *               center LiDAR column ≤ 2 m; else rejected with the reason.
 *   RETURN_TO_BASE only after RESCUE; EXTRACT = Dijkstra to BASE, no Gemini calls.
 *
 * Nothing else says no to Gemini.
 */
import { AT_NODE_RADIUS_M, MAX_MOVE_M, RESCUE_RANGE_M, ROVER_SPEED_MPS, TURN_RATE_DPS } from '../constants';
import { bearingDeg, clamp, dirFromBearing, distance, normDeg, wrapDeg, type Vec2 } from '../geo';
import type { Assessment, Decision, LidarGrid, LidarHit, MapState, Phase, RoverState } from '../types';
import type { World } from '../world/terrain';
import { pathPolyline, safeReturnPath, shortestPath } from './dijkstra';
import { nodeAt, nodeById } from './mapStore';
import { forwardClearance, type DynamicBodies } from './sensors';

export type ActionPlan =
  | { kind: 'MOVE'; turnDeg: number; distanceM: number }
  | { kind: 'FOLLOW'; label: 'GOTO_NODE' | 'EXTRACT'; waypoints: Vec2[]; via: string[]; targetNode: string }
  | { kind: 'MARK'; accepted: boolean; lastResult: string }
  | { kind: 'REJECT'; lastResult: string };

export interface ExecState {
  plan: ActionPlan;
  stage: 'TURN' | 'DRIVE' | 'DONE';
  targetHeadingDeg: number;
  startHeadingDeg: number;
  drivenM: number;
  wpIndex: number;
  blockedBy: LidarHit | null;
}

export interface PlanContext {
  map: MapState;
  rover: RoverState;
  /** Positions driven since the last node (for mid-edge retrace). */
  trace: Vec2[];
  lastNodeId: string;
  previousAssessment: Assessment;
  currentAssessment: Assessment;
  lidar: LidarGrid | null;
  phase: Phase;
}

const fmtDeg = (d: number) => `${Math.round(normDeg(d))}°`;
const fmtTurn = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d)}°`;

export function planAction(decision: Decision, ctx: PlanContext): ActionPlan {
  const a = decision.action;
  switch (a.type) {
    case 'MOVE': {
      const turnDeg = clamp(a.turn_deg ?? 0, -180, 180);
      const distanceM = clamp(a.distance_m ?? 0, 0, MAX_MOVE_M);
      return { kind: 'MOVE', turnDeg, distanceM };
    }
    case 'GOTO_NODE': {
      const id = a.node_id ?? '';
      const target = nodeById(ctx.map, id);
      if (!target) return { kind: 'REJECT', lastResult: `GOTO_NODE rejected: unknown node${id ? ` ${id}` : ''}` };
      if (distance(ctx.rover, target) <= AT_NODE_RADIUS_M) return { kind: 'REJECT', lastResult: `GOTO_NODE rejected: already at ${id}` };
      const route = buildRoute(ctx, id);
      if (!route) return { kind: 'REJECT', lastResult: `GOTO_NODE rejected: no safe route from ${ctx.lastNodeId} to ${id}` };
      return { kind: 'FOLLOW', label: 'GOTO_NODE', ...route, targetNode: id };
    }
    case 'MARK_SURVIVOR': {
      const center = ctx.lidar?.level['0'];
      const centerM = center?.m ?? null;
      const bothConfirmed = ctx.previousAssessment === 'CONFIRMED_CANDIDATE' && ctx.currentAssessment === 'CONFIRMED_CANDIDATE';
      const inRange = centerM !== null && centerM <= RESCUE_RANGE_M;
      if (bothConfirmed && inRange) {
        return { kind: 'MARK', accepted: true, lastResult: `MARK_SURVIVOR accepted at (${ctx.rover.x.toFixed(1)}, ${ctx.rover.z.toFixed(1)}), target ${centerM!.toFixed(1)} m ahead. Phase RESCUE; RETURN_TO_BASE when ready.` };
      }
      const reasons: string[] = [];
      if (!bothConfirmed) reasons.push(`needs CONFIRMED_CANDIDATE on two consecutive observations (previous was ${ctx.previousAssessment}, current ${ctx.currentAssessment})`);
      if (!inRange) reasons.push(`center LiDAR column must read ≤ ${RESCUE_RANGE_M} m (reads ${centerM === null ? '>30' : centerM.toFixed(1)} m)`);
      return { kind: 'MARK', accepted: false, lastResult: `MARK_SURVIVOR rejected: ${reasons.join('; ')}` };
    }
    case 'RETURN_TO_BASE': {
      if (ctx.phase !== 'RESCUE' && ctx.phase !== 'EXTRACT') return { kind: 'REJECT', lastResult: 'RETURN_TO_BASE rejected: survivor not yet marked (allowed only after RESCUE)' };
      if (distance(ctx.rover, { x: 0, z: 0 }) <= AT_NODE_RADIUS_M) return { kind: 'REJECT', lastResult: 'RETURN_TO_BASE: already at BASE' };
      const route = buildRoute(ctx, 'BASE');
      if (!route) return { kind: 'REJECT', lastResult: `RETURN_TO_BASE rejected: no safe route from ${ctx.lastNodeId} to BASE` };
      return { kind: 'FOLLOW', label: 'EXTRACT', ...route, targetNode: 'BASE' };
    }
  }
}

/** Retrace partial polyline to the last node (if mid-edge), then Dijkstra path to target. */
function buildRoute(ctx: PlanContext, targetId: string): { waypoints: Vec2[]; via: string[] } | null {
  const atNode = nodeAt(ctx.map, ctx.rover, AT_NODE_RADIUS_M);
  const startNode = atNode?.id ?? ctx.lastNodeId;
  const ids = targetId === 'BASE' ? safeReturnPath(ctx.map, startNode) : shortestPath(ctx.map, startNode, targetId);
  if (!ids || ids.length === 0 || ids[ids.length - 1] !== targetId) return null;
  const waypoints: Vec2[] = [];
  if (!atNode) {
    // mid-edge: drive back along our own trace to the last node
    for (let i = ctx.trace.length - 1; i >= 0; i--) waypoints.push(ctx.trace[i]);
    const ln = nodeById(ctx.map, ctx.lastNodeId);
    if (ln) waypoints.push({ x: ln.x, z: ln.z });
  }
  waypoints.push(...pathPolyline(ctx.map, ids));
  const t = nodeById(ctx.map, targetId)!;
  waypoints.push({ x: t.x, z: t.z });
  return { waypoints: waypoints.filter((p, i, arr) => i === 0 || distance(p, arr[i - 1]) > 0.05), via: ids };
}

export function startExecution(plan: ActionPlan, rover: RoverState): ExecState {
  const target = plan.kind === 'MOVE' ? normDeg(rover.headingDeg + plan.turnDeg) : rover.headingDeg;
  return {
    plan,
    stage: plan.kind === 'MOVE' || plan.kind === 'FOLLOW' ? 'TURN' : 'DONE',
    targetHeadingDeg: target,
    startHeadingDeg: rover.headingDeg,
    drivenM: 0,
    wpIndex: 0,
    blockedBy: null,
  };
}

export interface TickResult {
  exec: ExecState;
  pose: { x: number; z: number; headingDeg: number };
  movedM: number;
  done: boolean;
  lastResult: string | null;
}

/** Advance the current action by dt seconds. Pure: returns the new exec state and pose. */
export function tickExecution(
  exec: ExecState,
  rover: { x: number; z: number; headingDeg: number },
  world: World,
  dyn: DynamicBodies,
  dt: number,
): TickResult {
  const pose = { ...rover };
  let movedM = 0;
  const e: ExecState = { ...exec };
  const plan = e.plan;

  if (plan.kind === 'MARK' || plan.kind === 'REJECT') {
    return { exec: { ...e, stage: 'DONE' }, pose, movedM, done: true, lastResult: plan.lastResult };
  }

  if (plan.kind === 'MOVE') {
    if (e.stage === 'TURN') {
      const remaining = wrapDeg(e.targetHeadingDeg - pose.headingDeg);
      const step = TURN_RATE_DPS * dt;
      if (Math.abs(remaining) <= step) {
        pose.headingDeg = e.targetHeadingDeg;
        e.stage = plan.distanceM > 0 ? 'DRIVE' : 'DONE';
      } else {
        pose.headingDeg = normDeg(pose.headingDeg + Math.sign(remaining) * step);
      }
      if (e.stage === 'DONE') {
        return { exec: e, pose, movedM, done: true, lastResult: `TURNED ${fmtTurn(plan.turnDeg)}, heading now ${fmtDeg(pose.headingDeg)} (no move)` };
      }
    }
    if (e.stage === 'DRIVE') {
      const want = Math.min(ROVER_SPEED_MPS * dt, plan.distanceM - e.drivenM);
      const { freeM, hit } = forwardClearance(world, pose, dyn, want + 1);
      const go = Math.max(0, Math.min(want, freeM));
      if (go > 0) {
        const d = dirFromBearing(pose.headingDeg);
        pose.x += d.x * go;
        pose.z += d.z * go;
        e.drivenM += go;
        movedM = go;
      }
      if (go < want - 1e-6) {
        e.stage = 'DONE';
        e.blockedBy = hit;
        return { exec: e, pose, movedM, done: true, lastResult: `BLOCKED by ${hit ?? 'OBSTACLE'} after ${e.drivenM.toFixed(1)} m, heading ${fmtDeg(pose.headingDeg)}` };
      }
      if (e.drivenM >= plan.distanceM - 1e-6) {
        e.stage = 'DONE';
        return { exec: e, pose, movedM, done: true, lastResult: `MOVED ${e.drivenM.toFixed(1)} m, heading now ${fmtDeg(pose.headingDeg)}` };
      }
    }
    return { exec: e, pose, movedM, done: false, lastResult: null };
  }

  // FOLLOW: waypoint following at speed with turn-rate-limited heading.
  let budget = ROVER_SPEED_MPS * dt;
  while (budget > 1e-6 && e.wpIndex < plan.waypoints.length) {
    const wp = plan.waypoints[e.wpIndex];
    const dToWp = distance(pose, wp);
    if (dToWp < 0.15) {
      e.wpIndex++;
      continue;
    }
    const want = bearingDeg(pose, wp);
    const diff = wrapDeg(want - pose.headingDeg);
    const maxTurn = TURN_RATE_DPS * dt;
    if (Math.abs(diff) > maxTurn) {
      pose.headingDeg = normDeg(pose.headingDeg + Math.sign(diff) * maxTurn);
      break; // turn this tick, drive next
    }
    pose.headingDeg = want;
    const step = Math.min(budget, dToWp);
    const { freeM, hit } = forwardClearance(world, pose, dyn, step + 1);
    const go = Math.min(step, freeM);
    if (go <= 1e-6) {
      e.stage = 'DONE';
      e.blockedBy = hit;
      return { exec: e, pose, movedM, done: true, lastResult: `BLOCKED by ${hit ?? 'OBSTACLE'} while following route to ${plan.targetNode} after ${e.drivenM.toFixed(1)} m, heading ${fmtDeg(pose.headingDeg)}` };
    }
    const d = dirFromBearing(pose.headingDeg);
    pose.x += d.x * go;
    pose.z += d.z * go;
    e.drivenM += go;
    movedM += go;
    budget -= go;
    if (go < step - 1e-6) {
      e.stage = 'DONE';
      e.blockedBy = hit;
      return { exec: e, pose, movedM, done: true, lastResult: `BLOCKED by ${hit ?? 'OBSTACLE'} while following route to ${plan.targetNode} after ${e.drivenM.toFixed(1)} m, heading ${fmtDeg(pose.headingDeg)}` };
    }
  }
  if (e.wpIndex >= plan.waypoints.length) {
    e.stage = 'DONE';
    const via = plan.via.length > 2 ? ` via ${plan.via.slice(1, -1).join(', ')}` : '';
    const label = plan.label === 'EXTRACT' ? `EXTRACTED to BASE${via} (${e.drivenM.toFixed(1)} m)` : `ARRIVED at ${plan.targetNode}${via} (${e.drivenM.toFixed(1)} m)`;
    return { exec: e, pose, movedM, done: true, lastResult: label };
  }
  e.stage = 'DRIVE';
  return { exec: e, pose, movedM, done: false, lastResult: null };
}
