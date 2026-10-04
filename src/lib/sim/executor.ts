/**
 * Execute Gemini's chosen MOVE or record its MARK_SURVIVOR claim. This module owns
 * only physical turn/motion limits and collision stops; it never chooses a route.
 */
import { MAX_MOVE_M, ROVER_SPEED_MPS, TURN_RATE_DPS } from '../constants';
import { clamp, dirFromBearing, normDeg, wrapDeg } from '../geo';
import type { CollisionHit, Decision, RoverState } from '../types';
import type { World } from '../world/terrain';
import { forwardClearance, type DynamicBodies } from './collisions';

export type ActionPlan =
  | { kind: 'MOVE'; turnDeg: number; distanceM: number }
  | { kind: 'MARK'; lastResult: string };

export interface ExecState {
  plan: ActionPlan;
  stage: 'TURN' | 'DRIVE' | 'DONE';
  targetHeadingDeg: number;
  startHeadingDeg: number;
  drivenM: number;
  blockedBy: CollisionHit | null;
}

const fmtDeg = (d: number) => `${Math.round(normDeg(d))}°`;
const fmtTurn = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d)}°`;

export function planAction(decision: Decision): ActionPlan {
  const action = decision.action;
  if (action.type === 'MARK_SURVIVOR') {
    return {
      kind: 'MARK',
      lastResult: 'MARK_SURVIVOR recorded at the rover position.',
    };
  }
  return {
    kind: 'MOVE',
    turnDeg: clamp(action.turn_deg ?? 0, -180, 180),
    distanceM: clamp(action.distance_m ?? 0, 0, MAX_MOVE_M),
  };
}

export function startExecution(plan: ActionPlan, rover: RoverState): ExecState {
  return {
    plan,
    stage: plan.kind === 'MOVE' ? 'TURN' : 'DONE',
    targetHeadingDeg: plan.kind === 'MOVE' ? normDeg(rover.headingDeg + plan.turnDeg) : rover.headingDeg,
    startHeadingDeg: rover.headingDeg,
    drivenM: 0,
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

/** Advance the current action by dt seconds. Physics remains local; route choice does not. */
export function tickExecution(
  exec: ExecState,
  rover: { x: number; z: number; headingDeg: number },
  world: World,
  dyn: DynamicBodies,
  dt: number,
): TickResult {
  const pose = { ...rover };
  const e: ExecState = { ...exec };
  const plan = e.plan;
  if (plan.kind === 'MARK') {
    return { exec: { ...e, stage: 'DONE' }, pose, movedM: 0, done: true, lastResult: plan.lastResult };
  }

  let movedM = 0;
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
      return {
        exec: e,
        pose,
        movedM,
        done: true,
        lastResult: `TURNED ${fmtTurn(plan.turnDeg)}, heading now ${fmtDeg(pose.headingDeg)} (no move)`,
      };
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
      return {
        exec: e,
        pose,
        movedM,
        done: true,
        lastResult: `BLOCKED by ${hit ?? 'OBSTACLE'} after ${e.drivenM.toFixed(1)} m, heading ${fmtDeg(pose.headingDeg)}`,
      };
    }
    if (e.drivenM >= plan.distanceM - 1e-6) {
      e.stage = 'DONE';
      return {
        exec: e,
        pose,
        movedM,
        done: true,
        lastResult: `MOVED ${e.drivenM.toFixed(1)} m, heading now ${fmtDeg(pose.headingDeg)}`,
      };
    }
  }
  return { exec: e, pose, movedM, done: false, lastResult: null };
}
