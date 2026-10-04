import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDepthRgb, SENSOR_CALIBRATION } from '../src/lib/sim/depth.ts';
import { SENSOR_TICK_HZ } from '../src/lib/constants.ts';

test('depth maps near-to-far distance across a non-cyclic red-to-blue hue scale', () => {
  assert.deepEqual(encodeDepthRgb(0), [255, 0, 0]);
  assert.deepEqual(encodeDepthRgb(8.75), [255, 255, 0]);
  assert.deepEqual(encodeDepthRgb(17.5), [0, 255, 0]);
  assert.deepEqual(encodeDepthRgb(26.25), [0, 255, 255]);
  assert.deepEqual(encodeDepthRgb(34.9), [0, 3, 255]);
  assert.deepEqual(encodeDepthRgb(35), [0, 0, 0]);
  assert.deepEqual(encodeDepthRgb(100), [0, 0, 0]);
  assert.deepEqual(encodeDepthRgb(-1), [255, 0, 0]);
  assert.deepEqual(encodeDepthRgb(Number.NaN), [0, 0, 0]);
});

test('sensor calibration declares aligned ordered images and depth decoding', () => {
  assert.deepEqual(SENSOR_CALIBRATION.image_order, ['rgb', 'thermal', 'depth']);
  assert.equal(SENSOR_CALIBRATION.image_width, 1024);
  assert.equal(SENSOR_CALIBRATION.image_height, 768);
  assert.equal(SENSOR_CALIBRATION.horizontal_fov_deg, 90);
  assert.equal(SENSOR_CALIBRATION.camera_height_m, 0.8);
  assert.equal(SENSOR_CALIBRATION.camera_forward_offset_m, 0.7);
  assert.equal(SENSOR_CALIBRATION.depth.min_distance_m, 0);
  assert.equal(SENSOR_CALIBRATION.depth.max_distance_m, 35);
  assert.equal(SENSOR_CALIBRATION.depth.color_space, 'HSV');
  assert.equal(SENSOR_CALIBRATION.depth.near_hue_deg, 0);
  assert.equal(SENSOR_CALIBRATION.depth.far_hue_deg, 240);
  assert.deepEqual(SENSOR_CALIBRATION.depth.near_rgb, [255, 0, 0]);
  assert.deepEqual(SENSOR_CALIBRATION.depth.range_limit_rgb, [0, 0, 255]);
  assert.deepEqual(SENSOR_CALIBRATION.depth.no_return_rgb, [0, 0, 0]);
});

test('sensor captures are scheduled at one frame every two seconds', () => {
  assert.equal(SENSOR_TICK_HZ, 0.5);
  assert.equal(1000 / SENSOR_TICK_HZ, 2000);
});
