import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPacket } from '../src/lib/sim/packetBuilder.ts';

test('decision packet carries current pose, result, and explicit memory without a graph', () => {
  const packet = buildPacket({
    phase: 'SEARCH',
    step: 3,
    decisionsUsed: 3,
    distanceTraveledM: 7.26,
    pose: { x: 1.24, z: -2.26, headingDeg: 361 },
    memory: 'Creek is east.',
    lastResult: 'BLOCKED by TREE after 1.0 m',
    budget: 40,
  });

  assert.deepEqual(packet.world, {
    width_m: 180,
    height_m: 180,
    bounds_m: { min_x: -90, max_x: 90, min_z: -90, max_z: 90 },
    base: { x: 0, z: 0 },
  });
  assert.deepEqual(packet.pose, { x: 1.2, z: -2.3, heading_deg: 1 });
  assert.equal(packet.memory, 'Creek is east.');
  assert.equal(packet.last_result, 'BLOCKED by TREE after 1.0 m');
  assert.equal(packet.mission.decisions_remaining, 37);
  assert.equal('map' in packet, false);
});
