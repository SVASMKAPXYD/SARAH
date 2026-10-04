import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_MODEL_PREFERENCE,
  modelFallbackReason,
  preferredAvailableModels,
  rememberUnavailableModel,
} from '../src/lib/gemini/modelRouting.ts';

const model = 'gemini-3.5-flash-lite';

test('keeps the requested Flash-Lite preference order', () => {
  assert.deepEqual(GEMINI_MODEL_PREFERENCE, [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ]);
});

test('falls through on model-specific quota and unavailable model errors', () => {
  assert.equal(
    modelFallbackReason(
      Object.assign(new Error('quota exceeded: GenerateRequestsPerMinutePerProjectPerModel'), { status: 429 }),
      model,
    ),
    'model-specific quota exhausted',
  );
  assert.equal(
    modelFallbackReason(Object.assign(new Error(`model ${model} is not found`), { status: 404 }), model),
    'model unavailable to this API/project',
  );
  assert.equal(modelFallbackReason(Object.assign(new Error('temporarily unavailable'), { status: 503 }), model), 'model temporarily unavailable');
});

test('does not hide project-wide quota, auth, request, or unknown 429 errors', () => {
  assert.equal(modelFallbackReason(Object.assign(new Error('quota exceeded per project'), { status: 429 }), model), null);
  assert.equal(modelFallbackReason(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }), model), null);
  assert.equal(modelFallbackReason(Object.assign(new Error('invalid API key'), { status: 401 }), model), null);
  assert.equal(modelFallbackReason(Object.assign(new Error('invalid request schema'), { status: 400 }), model), null);
  assert.equal(modelFallbackReason(new Error('fetch failed'), model), null);
});

test('remembers a model-level 404 for the current server process', () => {
  rememberUnavailableModel(model);
  assert.deepEqual(preferredAvailableModels(), GEMINI_MODEL_PREFERENCE.slice(1));
});
