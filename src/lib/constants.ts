/**
 * SARAH shared constants (plan §3b, §3c, §4). Confirmed at T+0 — change here only.
 *
 * FRAME CONVENTIONS (used everywhere, stated verbatim in the prompt):
 *   units: meters
 *   x = east, z = south (Three.js +z)
 *   heading 0° = north = −z; clockwise positive, so 90° = east
 *   bearingTo(p) = atan2(dx, −dz)
 *   turn_deg positive = clockwise / right
 *   absolute bearing of a relative direction = heading + turn
 */

// Rover motion
export const ROVER_SPEED_MPS = 4;
export const TURN_RATE_DPS = 180;
export const MAX_MOVE_M = 15;
export const ROVER_RADIUS_M = 0.4;
export const COLLISION_STOP_M = 0.5; // stop this far before an obstacle surface
export const MAX_SLOPE_DEG = 35;

// Sensors
export const DEPTH_MAX_RANGE_M = 35;
export const COLLISION_CLEARANCE_MAX_M = 30;
export const HEADLAMP_RANGE_M = 30;
export const CAMERA_HFOV_DEG = 90;
export const SENSOR_IMAGE_W = 512;
export const SENSOR_IMAGE_H = 384;
export const SENSOR_HEIGHT_M = 0.8; // camera / level LiDAR row height above ground
export const SENSOR_FORWARD_OFFSET_M = 0.7; // rover front is 0.575 m forward from its center
export const SENSOR_TICK_HZ = 0.5;
export const NIGHT_VISIBILITY_LIGHT_LIFT = 1.8;
export const NIGHT_VISIBILITY_EXPOSURE_LIFT = 0.65;

// Mission
export const DECISION_BUDGET = 40;
export const GRADING_RADIUS_M = 3; // mark within this of the true survivor = correct
export const SURVIVOR_MIN_DIST_FROM_BASE_M = 40;
export const NODE_MERGE_RADIUS_M = 1.0; // a node declared this close to the current node updates it
export const AT_NODE_RADIUS_M = 1.0;

// Decoys (plan §2)
export const FOX_FLEE_RADIUS_M = 6;
export const FOX_SPEED_MPS = 1;
export const DEER_FLEE_RADIUS_M = 8;
export const DEER_BOLT_DISTANCE_M = 20;
export const DEER_BOLT_SPEED_MPS = 8;

/** Thermal pass per-object temperatures (0..1), plan §3c. */
export const THERMAL_TEMPERATURE = {
  person: 1.0,
  deer: 0.9,
  fox: 0.8,
  rock: 0.25,
  tree: 0.15,
  log: 0.15,
  ground: 0.1,
  fungi: 0.1,
  water: 0.05,
  base: 0.3,
} as const;

// Vertical FOV for a 4:3 sensor image at 90° horizontal.
export const CAMERA_VFOV_DEG =
  (2 * Math.atan(Math.tan((CAMERA_HFOV_DEG * Math.PI) / 360) * (SENSOR_IMAGE_H / SENSOR_IMAGE_W)) * 180) /
  Math.PI;

export const DEFAULT_SEED = 1337;
export const WORLD_HALF_SIZE_M = 90; // world spans ±90 m around base
