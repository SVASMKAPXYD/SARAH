import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBearing, shortestTurnToBearing } from '../src/lib/sim/movement.ts';

test('absolute compass bearing becomes the shortest physical turn', () => {
  assert.equal(normalizeBearing(360), 0);
  assert.equal(shortestTurnToBearing(350, 10), 20);
  assert.equal(shortestTurnToBearing(10, 350), -20);
  assert.equal(shortestTurnToBearing(90, 270), 180);
});
