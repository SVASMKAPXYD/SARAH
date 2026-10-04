/**
 * P3 — grading against ground truth Gemini never saw (plan §2 "Grading").
 * Correct mark = MARK_SURVIVOR accepted within GRADING_RADIUS_M (3 m) of the true survivor.
 */
import { GRADING_RADIUS_M } from '../constants';
import { distance, round, type Vec2 } from '../geo';
import type { Decision, GradeResult, MapState, MissionOutcome } from '../types';
import type { World } from '../world/terrain';

export interface GradeInputs {
  world: World;
  map: MapState;
  markPosition: Vec2 | null;
  decisionsUsed: number;
  budget: number;
  distanceTraveledM: number;
  decisions: Decision[];
  roverPos: Vec2;
  aborted?: boolean;
}

export function countLeadsInvestigated(decisions: Decision[]): number {
  // A "lead" = a run of consecutive INVESTIGATE/APPROACH intents.
  let leads = 0;
  let inLead = false;
  for (const d of decisions) {
    const investigating = d.intent === 'INVESTIGATE_THERMAL_LEAD' || d.intent === 'APPROACH_CANDIDATE';
    if (investigating && !inLead) leads++;
    inLead = investigating;
  }
  return leads;
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
    leadsInvestigated: countLeadsInvestigated(i.decisions),
    distanceTraveledM: round(i.distanceTraveledM),
    nodesDeclared: i.map.nodes.length - 1,
    frontiersDeclared: i.map.frontiers.length,
    returnedToBase,
    summary: summaryMap[outcome],
  };
}
