/**
 * P1 — LiDAR grid (plan §3c): 9 columns × 2 rows over the camera's 90° FOV. Each cell is
 * the minimum of 3 rays. Implemented as a 2D ray-vs-circle approximation over the world's
 * obstacle list plus the dynamic bodies (animals, survivor).
 *
 * Rows:
 *   level  — horizontal at SENSOR_HEIGHT_M (catches trunks, rocks, tall bodies)
 *   ground — pitched LIDAR_GROUND_PITCH_DEG (catches low logs, water, drop-offs; else GROUND)
 *
 * TODO(P1): replace with Three.js raycasts against the rendered meshes (heightmap slopes,
 *           STEEP_SLOPE hits, exact log geometry).
 */
import {
  COLLISION_STOP_M,
  LIDAR_COLUMN_KEYS,
  LIDAR_COLUMN_WIDTH_DEG,
  LIDAR_GROUND_PITCH_DEG,
  LIDAR_MAX_M,
  LIDAR_RAYS_PER_CELL,
  ROVER_RADIUS_M,
  SENSOR_HEIGHT_M,
} from '../constants';
import { DEG, dirFromBearing, rayCircle, rayCircleSpan, round, type Vec2 } from '../geo';
import type { LidarCell, LidarColumnKey, LidarGrid, LidarHit, LidarRowGrid } from '../types';
import type { AnimalState } from '../world/animals';
import type { Obstacle, World } from '../world/terrain';

export interface DynamicBodies {
  animals: AnimalState[];
  /** Survivor is a solid body for LiDAR/collision; it is labelled generically (no leak). */
  survivor: Vec2 | null;
}

interface Body {
  x: number;
  z: number;
  r: number;
  top: number;
  hit: LidarHit;
  solid: boolean; // blocks the rover
}

/** Dynamic bodies are reported with generic labels — the LiDAR cannot classify a body. */
function dynamicBodies(dyn: DynamicBodies | undefined): Body[] {
  if (!dyn) return [];
  const out: Body[] = [];
  for (const a of dyn.animals) {
    out.push(a.kind === 'deer' ? { x: a.x, z: a.z, r: 0.5, top: 1.4, hit: 'TREE', solid: false } : { x: a.x, z: a.z, r: 0.3, top: 0.4, hit: 'ROCK', solid: false });
  }
  if (dyn.survivor) out.push({ x: dyn.survivor.x, z: dyn.survivor.z, r: 0.45, top: 1.1, hit: 'ROCK', solid: true });
  return out;
}

function obstacleBodies(obs: Obstacle[]): Body[] {
  return obs.map((o) => ({ x: o.x, z: o.z, r: o.r, top: o.top, hit: o.kind, solid: true }));
}

/** Nearest hit along a horizontal ray at height `h` (bodies shorter than h are skipped). */
function castLevel(origin: Vec2, dir: Vec2, bodies: Body[], h: number, maxM: number): { m: number; hit: LidarHit } | null {
  let best: { m: number; hit: LidarHit } | null = null;
  for (const b of bodies) {
    if (b.top < h) continue;
    // cheap reject
    const dx = b.x - origin.x;
    const dz = b.z - origin.z;
    if (dx * dx + dz * dz > (maxM + b.r) ** 2) continue;
    if (dx * dir.x + dz * dir.z < -b.r) continue;
    const t = rayCircle(origin, dir, b, b.r);
    if (t !== null && t <= maxM && (!best || t < best.m)) best = { m: t, hit: b.hit };
  }
  return best;
}

/**
 * Ground row: ray from height h pitched down. While crossing a body's footprint the ray keeps
 * descending, so it hits if its height drops to the body's top before it exits the footprint
 * (low logs right in front of the rover are caught this way). Water always registers. Else GROUND.
 */
function castGround(origin: Vec2, dir: Vec2, bodies: Body[], h: number, pitchDeg: number, groundHitM: number): { m: number; hit: LidarHit } {
  const tanP = Math.tan(-pitchDeg * DEG);
  let best: { m: number; hit: LidarHit } = { m: groundHitM, hit: 'GROUND' };
  for (const b of bodies) {
    const dx = b.x - origin.x;
    const dz = b.z - origin.z;
    if (dx * dx + dz * dz > (groundHitM + b.r) ** 2) continue;
    const span = rayCircleSpan(origin, dir, b, b.r);
    if (!span || span.enter >= best.m) continue;
    if (b.hit === 'WATER') {
      best = { m: span.enter, hit: b.hit };
      continue;
    }
    const heightAtExit = h - span.exit * tanP;
    if (heightAtExit > b.top) continue; // the ray clears the body
    const tHit = Math.max(span.enter, (h - b.top) / tanP);
    if (tHit < best.m) best = { m: tHit, hit: b.hit };
  }
  return best;
}

/** World edge = a drop-off (STEEP_SLOPE). Distance along `dir` to the inner boundary, or Infinity. */
export function boundaryDistance(origin: Vec2, dir: Vec2, halfSize: number, margin = 3): number {
  const lim = halfSize - margin;
  let best = Infinity;
  if (dir.x > 1e-9) best = Math.min(best, (lim - origin.x) / dir.x);
  if (dir.x < -1e-9) best = Math.min(best, (-lim - origin.x) / dir.x);
  if (dir.z > 1e-9) best = Math.min(best, (lim - origin.z) / dir.z);
  if (dir.z < -1e-9) best = Math.min(best, (-lim - origin.z) / dir.z);
  return Math.max(0, best);
}

export function computeLidar(world: World, pose: { x: number; z: number; headingDeg: number }, dyn?: DynamicBodies): LidarGrid {
  const bodies = [...obstacleBodies(world.obstacles), ...dynamicBodies(dyn)];
  const origin = { x: pose.x, z: pose.z };
  const groundHitM = SENSOR_HEIGHT_M / Math.tan(-LIDAR_GROUND_PITCH_DEG * DEG);
  const level = {} as LidarRowGrid;
  const ground = {} as LidarRowGrid;
  for (const key of LIDAR_COLUMN_KEYS) {
    const center = Number(key);
    let lv: LidarCell = { m: null, hit: 'CLEAR' };
    let gr: LidarCell = { m: round(groundHitM), hit: 'GROUND' };
    let grBest = Infinity;
    let lvBest = Infinity;
    for (let i = 0; i < LIDAR_RAYS_PER_CELL; i++) {
      const rel = center - LIDAR_COLUMN_WIDTH_DEG / 2 + ((i + 0.5) / LIDAR_RAYS_PER_CELL) * LIDAR_COLUMN_WIDTH_DEG;
      const dir = dirFromBearing(pose.headingDeg + rel);
      const edge = boundaryDistance(origin, dir, world.halfSize);
      let l = castLevel(origin, dir, bodies, SENSOR_HEIGHT_M, LIDAR_MAX_M);
      if (edge <= LIDAR_MAX_M && (!l || edge < l.m)) l = { m: edge, hit: 'STEEP_SLOPE' };
      if (l && l.m < lvBest) {
        lvBest = l.m;
        lv = { m: round(l.m), hit: l.hit };
      }
      let g = castGround(origin, dir, bodies, SENSOR_HEIGHT_M, LIDAR_GROUND_PITCH_DEG, groundHitM);
      if (edge < g.m) g = { m: edge, hit: 'STEEP_SLOPE' };
      if (g.m < grBest) {
        grBest = g.m;
        gr = { m: round(g.m), hit: g.hit };
      }
    }
    level[key as LidarColumnKey] = lv;
    ground[key as LidarColumnKey] = gr;
  }
  return { level, ground };
}

/**
 * Forward clearance for collision (executor): distance the rover can drive along its
 * heading before its body (radius ROVER_RADIUS_M) touches a solid, minus COLLISION_STOP_M.
 */
export function forwardClearance(
  world: World,
  pose: { x: number; z: number; headingDeg: number },
  dyn?: DynamicBodies,
  maxM: number = LIDAR_MAX_M,
): { freeM: number; hit: LidarHit | null } {
  const bodies = [...obstacleBodies(world.obstacles), ...dynamicBodies(dyn)].filter((b) => b.solid);
  const dir = dirFromBearing(pose.headingDeg);
  let best: { m: number; hit: LidarHit } | null = null;
  for (const b of bodies) {
    const dx = b.x - pose.x;
    const dz = b.z - pose.z;
    if (dx * dx + dz * dz > (maxM + b.r + ROVER_RADIUS_M) ** 2) continue;
    if (dx * dir.x + dz * dir.z < -(b.r + ROVER_RADIUS_M)) continue;
    const t = rayCircle(pose, dir, b, b.r + ROVER_RADIUS_M);
    if (t !== null && (!best || t < best.m)) best = { m: t, hit: b.hit };
  }
  const edge = boundaryDistance(pose, dir, world.halfSize);
  if (edge <= maxM && (!best || edge < best.m)) best = { m: edge, hit: 'STEEP_SLOPE' };
  if (!best) return { freeM: maxM, hit: null };
  return { freeM: Math.max(0, best.m - COLLISION_STOP_M), hit: best.hit };
}

/** Min level-row distance across the grid (used for edge minClearanceM). */
export function minLevelClearance(grid: LidarGrid): number {
  let m = LIDAR_MAX_M;
  for (const key of LIDAR_COLUMN_KEYS) {
    const c = grid.level[key];
    if (c.m !== null && c.m < m) m = c.m;
  }
  return m;
}
