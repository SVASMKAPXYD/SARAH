import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeFieldBriefings, buildPacket } from '../src/lib/sim/packetBuilder.ts';

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
  const packet = buildPacket({ ...base, fieldBriefings: reports, newFieldBriefings: [reports[1]] });

  assert.deepEqual(packet.field_briefings, reports);
  assert.deepEqual(packet.new_field_briefings, [reports[1]]);
});

test('decision packet defaults to no field briefings', () => {
  const packet = buildPacket(base);

  assert.deepEqual(packet.field_briefings, []);
  assert.deepEqual(packet.new_field_briefings, []);
});

test('acknowledging a Gemini request clears only the reports in its snapshot', () => {
  const included = ['First report', 'Second report'];
  const pending = [...included, 'Arrived while Gemini was responding'];

  assert.deepEqual(acknowledgeFieldBriefings(pending, included), ['Arrived while Gemini was responding']);
});

test('a stale or mismatched request snapshot does not clear pending reports', () => {
  const pending = ['A newer report'];

  assert.deepEqual(acknowledgeFieldBriefings(pending, ['An older report']), pending);
});
