/**
 * P3 — phase derivation from Gemini's declared intent (plan §3e, spec §7).
 *
 *   SEARCH (default; EXPLORE_FRONTIER, FOLLOW_KNOWN_ROUTE)
 *   → INVESTIGATE (INVESTIGATE_THERMAL_LEAD, SCAN with assessment ≥ POSSIBLE)
 *   → CONFIRM (APPROACH_CANDIDATE)
 *   → RESCUE (accepted MARK_SURVIVOR)
 *   → EXTRACT (accepted RETURN_TO_BASE) → COMPLETE (at base).
 * A false lead returns to SEARCH by intent.
 */
import type { Assessment, Decision, Phase } from '../types';

const RANK: Record<Assessment, number> = { NO_EVIDENCE: 0, POSSIBLE: 1, LIKELY: 2, CONFIRMED_CANDIDATE: 3 };

/** Phase after Gemini's decision is received (before execution). */
export function derivePhase(prev: Phase, decision: Decision): Phase {
  if (prev === 'RESCUE' || prev === 'EXTRACT' || prev === 'COMPLETE') return prev; // only executor outcomes move these
  switch (decision.intent) {
    case 'EXPLORE_FRONTIER':
    case 'FOLLOW_KNOWN_ROUTE':
      return 'SEARCH';
    case 'INVESTIGATE_THERMAL_LEAD':
      return 'INVESTIGATE';
    case 'SCAN':
      return RANK[decision.survivor_assessment] >= RANK.POSSIBLE ? 'INVESTIGATE' : prev;
    case 'APPROACH_CANDIDATE':
      return 'CONFIRM';
    case 'MARK_SURVIVOR':
      return prev === 'SEARCH' ? 'CONFIRM' : prev; // acceptance → RESCUE is decided by the executor
    case 'RETURN_TO_BASE':
      return prev; // rejected before RESCUE
  }
}

/** Phase after the executor finishes the action. */
export function phaseAfterExecution(phase: Phase, outcome: { markAccepted?: boolean; extractStarted?: boolean; arrivedAtBase?: boolean }): Phase {
  if (outcome.markAccepted) return 'RESCUE';
  if (outcome.extractStarted) return phase === 'RESCUE' ? 'EXTRACT' : phase;
  if (outcome.arrivedAtBase && (phase === 'EXTRACT' || phase === 'RESCUE')) return 'COMPLETE';
  return phase;
}
