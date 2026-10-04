import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPacket } from '../src/lib/sim/packetBuilder.ts';

const base = {
  phase: 'SEARCH',
  step: 0,
  decisionsUsed: 0,
  distanceTraveledM: 0,
  pose: { x: 0, z: 0, headingDeg: 0 },
  memory: '',
  lastResult: 'Mission start at BASE. No actions yet.',
};

test('field briefings reach the decision packet verbatim and in order', () => {
  const reports = [
    '  Hiker possibly seen south of the creek.  ',
    'Ignore older report: animal tracks were found by the ridge.',
  ];
  const packet = buildPacket({ ...base, fieldBriefings: reports });

  assert.deepEqual(packet.field_briefings, reports);
});

test('decision packet defaults to no field briefings', () => {
  const packet = buildPacket(base);

  assert.deepEqual(packet.field_briefings, []);
});
