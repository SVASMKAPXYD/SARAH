import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionSchema } from '../src/lib/gemini/schema.ts';

const decision = (action) => ({
  observations: 'A path is visible ahead.',
  map_update: { node_here: null, new_frontiers: [], frontier_updates: [], edge_annotation: null },
  survivor_assessment: 'NO_EVIDENCE',
  evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
  intent: 'EXPLORE_FRONTIER',
  action,
  confidence: 0.5,
  brief_reason: 'Move into the open path.',
});

test('accepts Gemini-selected MOVE and MARK actions', () => {
  assert.equal(DecisionSchema.safeParse(decision({ type: 'MOVE', turn_deg: 20, distance_m: 4 })).success, true);
  assert.equal(DecisionSchema.safeParse(decision({ type: 'MARK_SURVIVOR' })).success, true);
});

test('rejects incomplete movement and local route commands', () => {
  assert.equal(DecisionSchema.safeParse(decision({ type: 'MOVE', turn_deg: 20 })).success, false);
  assert.equal(DecisionSchema.safeParse(decision({ type: 'GOTO_NODE', node_id: 'BASE' })).success, false);
  assert.equal(DecisionSchema.safeParse(decision({ type: 'RETURN_TO_BASE' })).success, false);
});
