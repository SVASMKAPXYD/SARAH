import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TERRAIN_PARAMS, DecisionJsonSchema, DecisionSchema, MEMORY_MAX_CHARS, TerrainParamsSchema } from '../src/lib/gemini/schema.ts';

test('requires a complete replacement memory on every decision', () => {
  assert.deepEqual(DecisionSchema.parse({
    bearing_deg: 270,
    distance_m: 4,
    reason: 'Follow the visible trail.',
    replace_entire_memory: '',
  }), {
    bearing_deg: 270,
    distance_m: 4,
    reason: 'Follow the visible trail.',
    replace_entire_memory: '',
  });
  assert.equal(DecisionSchema.safeParse({
    bearing_deg: 90,
    distance_m: 0,
    reason: 'The hiker is here.',
    mark_survivor: true,
    replace_entire_memory: 'Current memory, plus new note: creek is east of base.',
  }).success, true);
  assert.deepEqual(DecisionJsonSchema.required, ['bearing_deg', 'distance_m', 'reason', 'replace_entire_memory']);
  assert.match(DecisionJsonSchema.properties.replace_entire_memory.description, /OVERWRITES the entire current memory file/);
  assert.match(DecisionJsonSchema.properties.replace_entire_memory.description, /Never return only new notes/);
  assert.equal(DecisionSchema.safeParse({
    bearing_deg: 90,
    distance_m: 0,
    reason: 'The hiker is here.',
  }).success, false);
});

test('rejects missing, out-of-range, oversized, and legacy structured decisions', () => {
  assert.equal(DecisionSchema.safeParse({ bearing_deg: 10, distance_m: 2 }).success, false);
  assert.equal(DecisionSchema.safeParse({ bearing_deg: 361, distance_m: 2, reason: 'out of range' }).success, false);
  assert.equal(DecisionSchema.safeParse({ bearing_deg: 0, distance_m: 16, reason: 'too far' }).success, false);
  assert.equal(DecisionSchema.safeParse({
    bearing_deg: 0,
    distance_m: 2,
    reason: 'oversized memory',
    replace_entire_memory: 'x'.repeat(MEMORY_MAX_CHARS + 1),
  }).success, false);
  assert.equal(DecisionSchema.safeParse({
    observations: 'old contract',
    action: { type: 'MOVE', turn_deg: 10, distance_m: 2 },
  }).success, false);
  assert.equal(DecisionSchema.safeParse({ bearing_deg: 0, distance_m: 2, reason: 'extra policy fields', intent: 'EXPLORE' }).success, false);
});

test('terrain schema holds slope and bumpiness at zero', () => {
  const params = TerrainParamsSchema.parse({
    ...DEFAULT_TERRAIN_PARAMS,
    slope: 1,
    bumpiness: 0.9,
  });
  assert.equal(params.slope, 0);
  assert.equal(params.bumpiness, 0);
  assert.equal(DEFAULT_TERRAIN_PARAMS.slope, 0);
  assert.equal(DEFAULT_TERRAIN_PARAMS.bumpiness, 0);
});
