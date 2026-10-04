import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TERRAIN_PARAMS } from '../src/lib/gemini/schema.ts';
import { parseReplay, ReplayPlayer, serializeReplay } from '../src/lib/sim/replay.ts';

const packet = { pose: { x: 0, z: 0, heading_deg: 350 } };

test('migrates version-1 relative movement replays to absolute bearings', () => {
  const replay = parseReplay({
    version: 1,
    seed: 7,
    params: DEFAULT_TERRAIN_PARAMS,
    entries: [{
      packetHash: '',
      decision: {
        action: { type: 'MOVE', turn_deg: 30, distance_m: 5 },
        brief_reason: 'Move around the obstacle.',
      },
    }],
  });

  assert.equal(replay.version, 3);
  const next = new ReplayPlayer(replay).next(packet);
  assert.equal(next?.decision.bearing_deg, 20);
  assert.equal(next?.decision.distance_m, 5);
  assert.equal(next?.decision.reason, 'Move around the obstacle.');
  assert.equal(next?.decision.replace_entire_memory, '');
});

test('migrates legacy survivor marks without moving the rover', () => {
  const replay = parseReplay({
    version: 1,
    seed: 7,
    params: DEFAULT_TERRAIN_PARAMS,
    entries: [{
      decision: {
        action: { type: 'MARK_SURVIVOR' },
        brief_reason: 'Survivor located.',
      },
    }],
  });

  const next = new ReplayPlayer(replay).next(packet);
  assert.equal(next?.decision.mark_survivor, true);
  assert.equal(next?.decision.distance_m, 0);
});

test('serializes and reads current version-3 decisions', () => {
  const log = {
    version: 3,
    seed: 7,
    params: DEFAULT_TERRAIN_PARAMS,
    entries: [{
      seed: 7,
      step: 0,
      packetHash: '',
      decision: { bearing_deg: 45, distance_m: 2, reason: 'Follow the trail.', replace_entire_memory: '' },
      thought: 'Follow the trail.',
      model: null,
      latencyMs: 1,
    }],
  };
  const replay = parseReplay(JSON.parse(serializeReplay(log)));
  assert.deepEqual(replay.entries[0].decision, log.entries[0].decision);
});

test('migrates sparse version-2 memory updates to full replacement memory', () => {
  const replay = parseReplay({
    version: 2,
    seed: 7,
    params: DEFAULT_TERRAIN_PARAMS,
    entries: [
      {
        decision: {
          bearing_deg: 45,
          distance_m: 2,
          reason: 'Follow the trail.',
          memory_update: 'Creek is east of base.',
        },
      },
      {
        decision: {
          bearing_deg: 90,
          distance_m: 1,
          reason: 'Inspect the creek.',
        },
      },
    ],
  });

  assert.equal(replay.version, 3);
  assert.equal(replay.entries[0].decision.replace_entire_memory, 'Creek is east of base.');
  assert.equal(replay.entries[1].decision.replace_entire_memory, 'Creek is east of base.');
});
