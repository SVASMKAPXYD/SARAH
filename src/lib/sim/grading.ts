/**
 * P3 — grading against ground truth Gemini never saw (plan §2 "Grading").
 * Correct mark = MARK_SURVIVOR accepted within GRADING_RADIUS_M (3 m) of the true survivor.
 */
import { GRADING_RADIUS_M } from '../constants';
import { distance, round, type Vec2 } from '../geo';
import type { GradeResult, MissionOutcome } from '../types';
import type { World } from '../world/terrain';

export interface GradeInputs {
  world: World;
  markPosition: Vec2 | null;
  decisionsUsed: number;
  budget: number;
  distanceTraveledM: number;
  roverPos: Vec2;
  aborted?: boolean;
}

export function gradeMission(i: GradeInputs): GradeResult {
  const truth = i.world.truth.survivor;
  const returnedToBase = distance(i.roverPos, i.world.base) <= 1.5;
  let outcome: MissionOutcome;
  let distanceErrorM: number | null = null;
  if (i.markPosition) {
    distanceErrorM = round(distance(i.markPosition, truth));
    outcome = distanceErrorM <= GRADING_RADIUS_M ? 'CORRECT_MARK' : 'FALSE_MARK';
  } else if (i.aborted) outcome = 'ABORTED';
  else outcome = i.decisionsUsed >= i.budget ? 'BUDGET_EXHAUSTED' : 'NO_MARK';

  const success = outcome === 'CORRECT_MARK';
  const summaryMap: Record<MissionOutcome, string> = {
    CORRECT_MARK: `Survivor marked ${distanceErrorM?.toFixed(1)} m from truth in ${i.decisionsUsed} decisions${returnedToBase ? ' and rover returned to base' : ''}.`,
    FALSE_MARK: `False mark: ${distanceErrorM?.toFixed(1)} m from the real survivor (limit ${GRADING_RADIUS_M} m). Mission failed.`,
    NO_MARK: `Mission ended without a mark after ${i.decisionsUsed} decisions.`,
    BUDGET_EXHAUSTED: `Decision budget (${i.budget}) exhausted without a mark. Mission failed.`,
    ABORTED: 'Mission reset before completion.',
  };
  return {
    outcome,
    success,
    markPosition: i.markPosition,
    distanceErrorM,
    decisionsUsed: i.decisionsUsed,
    distanceTraveledM: round(i.distanceTraveledM),
    returnedToBase,
    summary: summaryMap[outcome],
  };
}
