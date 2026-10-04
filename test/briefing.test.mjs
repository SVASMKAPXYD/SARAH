import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPacket } from '../src/lib/sim/packetBuilder.ts';
import {
  angularSeparation,
  computeSearchBelief,
  parseBriefing,
  steerDecision,
} from '../src/lib/sim/briefing.ts';

const emptyWorld = {
  halfSize: 90,
  logs: [],
  rocks: [],
  trees: [],
  fungi: [],
  water: null,
  truth: { trails: [] },
};

function atBase(text, id = 1) {
  return parseBriefing(text, { x: 0, z: 0 }, id);
}

test('definite south weighs more than a hedge and both land south of Sarah', () => {
  const high = atBase("the hiker is to the south of Sarah's current location");
  const low = atBase("the hiker is likely to the south of Sarah's current location", 2);
  assert.equal(high.certaintyLabel, 'high');
  assert.equal(low.certaintyLabel, 'low');
  assert.ok(high.certainty > 0.8);
  assert.ok(low.certainty < 0.5);
  assert.ok(low.certainty > 0.3);
  assert.equal(high.direction?.name, 'S');
  assert.equal(high.direction?.relative, true);
  assert.equal(low.direction?.relative, true);

  const highBelief = computeSearchBelief([high], emptyWorld, { x: 0, z: 0 }).belief;
  const lowBelief = computeSearchBelief([low], emptyWorld, { x: 0, z: 0 }).belief;
  assert.ok(highBelief && lowBelief);
  assert.ok(highBelief.focus.z > 20);
  assert.ok(lowBelief.focus.z > 20);
  assert.ok(highBelief.strength > lowBelief.strength);
  assert.ok(highBelief.focus.z > lowBelief.focus.z);
  assert.ok(highBelief.spreadM < lowBelief.spreadM);

  const unguided = { bearing_deg: 0, distance_m: 6, reason: 'sweep', replace_entire_memory: '' };
  const highMove = steerDecision(unguided, highBelief);
  const lowMove = steerDecision(unguided, lowBelief);
  const blocked = { bearing_deg: 90, distance_m: 0, reason: 'turn after collision', replace_entire_memory: '' };
  assert.deepEqual(steerDecision(blocked, highBelief), blocked);
  assert.ok(angularSeparation(highMove.bearing_deg, 180) < angularSeparation(lowMove.bearing_deg, 180));
  assert.ok(highMove.distance_m > lowMove.distance_m);
  assert.ok(angularSeparation(lowMove.bearing_deg, 180) < angularSeparation(0, 180));
});

test('southeast quadrant and a hedged fallen log parse into different targets', () => {
  const quadrant = atBase('hiker is in south east quadrant');
  assert.equal(quadrant.direction?.name, 'SE');
  assert.equal(quadrant.direction?.quadrant, true);
  assert.equal(quadrant.direction?.relative, false);
  const quadrantBelief = computeSearchBelief([quadrant], emptyWorld, { x: 0, z: 0 }).belief;
  assert.ok(quadrantBelief);
  assert.ok(quadrantBelief.focus.x > 10);
  assert.ok(quadrantBelief.focus.z > 10);

  const curly = parseBriefing('the hiker is to the south of Sarah’s current location', { x: 0, z: 0 }, 3);
  assert.equal(curly.direction?.relative, true);
  assert.equal(curly.certaintyLabel, 'high');

  const world = { ...emptyWorld, logs: [{ x: 30, z: -24 }] };
  const hedged = atBase('hiker is likely next to a fallen log');
  assert.deepEqual(hedged.landmarks, ['fallen_log']);
  assert.equal(hedged.certaintyLabel, 'low');
  const logBelief = computeSearchBelief([hedged], world, { x: 0, z: 0 }).belief;
  assert.ok(logBelief);
  const toLog = Math.hypot(logBelief.focus.x - 30, logBelief.focus.z + 24);
  assert.ok(toLog < 18, `focus ${logBelief.focus.x},${logBelief.focus.z} should sit on the log`);
  assert.ok(logBelief.focus.z < 0);
});

test('a higher-certainty conflict overrules the earlier direction without deleting it', () => {
  const south = atBase('the hiker is to the south of Sarah');
  const north = atBase('the hiker might be to the north of Sarah', 2);
  const { briefings, belief } = computeSearchBelief([south, north], emptyWorld, { x: 0, z: 0 });
  assert.equal(briefings[0].suppressed, false);
  assert.equal(briefings[1].suppressed, true);
  assert.ok(briefings[0].weight > briefings[1].weight);
  assert.ok(belief && belief.focus.z > 0);
  assert.ok(belief.strength > 0.8);

  const older = atBase('the hiker is to the south of Sarah', 1);
  const newer = atBase('the hiker is to the north of Sarah', 2);
  const tied = computeSearchBelief([older, newer], emptyWorld, { x: 0, z: 0 });
  assert.equal(tied.briefings[0].suppressed, false);
  assert.equal(tied.briefings[1].suppressed, false);
  assert.ok(tied.briefings[1].weight > tied.briefings[0].weight);
});

test('an unsupported ridge is extracted but does not move the search', () => {
  const ridge = atBase('the hiker must be on the ridge');
  assert.deepEqual(ridge.landmarks, ['ridge']);
  assert.equal(ridge.certaintyLabel, 'high');
  const { briefings, belief } = computeSearchBelief([ridge], emptyWorld, { x: 0, z: 0 });
  assert.equal(briefings[0].landmarkSupported, false);
  assert.equal(belief, null);
});

test('no briefing leaves the decision packet unchanged', () => {
  const packet = buildPacket({
    phase: 'SEARCH',
    step: 0,
    decisionsUsed: 0,
    distanceTraveledM: 0,
    pose: { x: 0, z: 0, headingDeg: 0 },
    memory: '',
    lastResult: 'Mission start at BASE. No actions yet.',
  });
  assert.equal('search_guidance' in packet, false);
  const unguided = { bearing_deg: 12, distance_m: 6, reason: 'sweep', replace_entire_memory: 'notes' };
  assert.deepEqual(steerDecision(unguided, null), unguided);
});
