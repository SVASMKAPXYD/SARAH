import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreshDecisionInteraction } from '../src/lib/gemini/interactionRequest.ts';

test('same-model decisions are separate, unstored interactions', () => {
  const first = buildFreshDecisionInteraction({
    model: 'gemini-3.5-flash-lite',
    system: 'No previous context.',
    input: [{ type: 'text', text: 'memory one' }],
    schema: {},
  });
  const second = buildFreshDecisionInteraction({
    model: 'gemini-3.5-flash-lite',
    system: 'No previous context.',
    input: [{ type: 'text', text: 'memory two' }],
    schema: {},
  });

  assert.equal(first.store, false);
  assert.equal(second.store, false);
  assert.equal(Object.hasOwn(first, 'previous_interaction_id'), false);
  assert.equal(Object.hasOwn(second, 'previous_interaction_id'), false);
  assert.notEqual(first.input[0].text, second.input[0].text);
});
