import { CAMERA_HFOV_DEG, DEPTH_MAX_RANGE_M, SENSOR_FORWARD_OFFSET_M, SENSOR_HEIGHT_M, SENSOR_IMAGE_H, SENSOR_IMAGE_W } from '../constants.ts';

export const DEPTH_ENCODING = {
  format: 'hsv_hue_radial_distance_v1',
  min_distance_m: 0,
  max_distance_m: DEPTH_MAX_RANGE_M,
  color_space: 'HSV',
  near_hue_deg: 0,
  far_hue_deg: 240,
  saturation: 1,
  value: 1,
  near_rgb: [255, 0, 0],
  range_limit_rgb: [0, 0, 255],
  no_return_rgb: [0, 0, 0],
  formula: 'if distance_m >= 35 then RGB = (0, 0, 0); otherwise hue_deg = 240 * distance_m / 35 and RGB = HSV(hue_deg, 1, 1)',
} as const;

export const SENSOR_CALIBRATION = {
  image_width: SENSOR_IMAGE_W,
  image_height: SENSOR_IMAGE_H,
  horizontal_fov_deg: CAMERA_HFOV_DEG,
  camera_height_m: SENSOR_HEIGHT_M,
  camera_forward_offset_m: SENSOR_FORWARD_OFFSET_M,
  image_order: ['rgb', 'thermal', 'depth'],
  depth: DEPTH_ENCODING,
} as const;

export type SensorCalibration = typeof SENSOR_CALIBRATION;
export type SensorView = 'rgb' | 'thermal' | 'depth';

export function encodeDepthRgb(distanceM: number): [number, number, number] {
  if (!Number.isFinite(distanceM) || distanceM >= DEPTH_MAX_RANGE_M) return [0, 0, 0];
  const clamped = Math.max(0, distanceM);
  const hue = (240 * clamped) / DEPTH_MAX_RANGE_M;
  const chroma = 1;
  const hueSector = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSector % 2) - 1));
  const rgb: [number, number, number] = [0, 0, 0];
  if (hueSector < 1) {
    rgb[0] = chroma;
    rgb[1] = secondary;
  } else if (hueSector < 2) {
    rgb[0] = secondary;
    rgb[1] = chroma;
  } else if (hueSector < 3) {
    rgb[1] = chroma;
    rgb[2] = secondary;
  } else {
    rgb[1] = secondary;
    rgb[2] = chroma;
  }
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}
