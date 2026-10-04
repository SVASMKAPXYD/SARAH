/**
 * The displayed phase follows Gemini's declared intent. It does not gate actions or
 * choose routes; only reaching base after Gemini declares return completes extraction.
 */
import type { Decision, Phase } from '../types';

/** Phase after Gemini's decision is received (before execution). */
export function derivePhase(prev: Phase, decision: Decision): Phase {
  if (prev === 'COMPLETE') return prev;
  switch (decision.intent) {
    case 'EXPLORE_FRONTIER':
    case 'FOLLOW_KNOWN_ROUTE':
      return 'SEARCH';
    case 'INVESTIGATE_THERMAL_LEAD':
      return 'INVESTIGATE';
    case 'SCAN':
      return 'INVESTIGATE';
    case 'APPROACH_CANDIDATE':
      return 'CONFIRM';
    case 'MARK_SURVIVOR':
      return 'CONFIRM';
    case 'RETURN_TO_BASE':
      return 'EXTRACT';
  }
}

/** Phase after the executor finishes the action. */
export function phaseAfterExecution(phase: Phase, outcome: { markRecorded?: boolean; arrivedAtBase?: boolean }): Phase {
  if (outcome.markRecorded) return 'RESCUE';
  if (outcome.arrivedAtBase && (phase === 'EXTRACT' || phase === 'RESCUE')) return 'COMPLETE';
  return phase;
}
