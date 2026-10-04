import { COLLISION_STOP_M, ROVER_RADIUS_M } from '../constants';
import { dirFromBearing, rayCircle, rayCircleSpan, type Vec2 } from '../geo';
import type { CollisionHit } from '../types';
import type { AnimalState } from '../world/animals';
import type { Obstacle, World } from '../world/terrain';

export interface DynamicBodies {
  animals: AnimalState[];
  survivor: Vec2 | null;
}

interface Body {
  x: number;
  z: number;
  r: number;
  top: number;
  hit: CollisionHit;
  solid: boolean;
}

function dynamicBodies(dyn: DynamicBodies | undefined): Body[] {
  if (!dyn) return [];
  const bodies: Body[] = dyn.animals.map((animal) =>
    animal.kind === 'deer'
      ? { x: animal.x, z: animal.z, r: 0.5, top: 1.4, hit: 'TREE', solid: false }
      : { x: animal.x, z: animal.z, r: 0.3, top: 0.4, hit: 'ROCK', solid: false },
  );
  if (dyn.survivor) bodies.push({ x: dyn.survivor.x, z: dyn.survivor.z, r: 0.45, top: 1.1, hit: 'ROCK', solid: true });
  return bodies;
}

function obstacleBodies(obstacles: Obstacle[]): Body[] {
  return obstacles.map((obstacle) => ({
    x: obstacle.x,
    z: obstacle.z,
    r: obstacle.r,
    top: obstacle.top,
    hit: obstacle.kind,
    solid: true,
  }));
}

function boundaryDistance(origin: Vec2, direction: Vec2, halfSize: number, margin = 3): number {
  const limit = halfSize - margin;
  let nearest = Infinity;
  if (direction.x > 1e-9) nearest = Math.min(nearest, (limit - origin.x) / direction.x);
  if (direction.x < -1e-9) nearest = Math.min(nearest, (-limit - origin.x) / direction.x);
  if (direction.z > 1e-9) nearest = Math.min(nearest, (limit - origin.z) / direction.z);
  if (direction.z < -1e-9) nearest = Math.min(nearest, (-limit - origin.z) / direction.z);
  return Math.max(0, nearest);
}

/** Private simulator physics: stop before a solid obstacle; never sent as model guidance. */
export function forwardClearance(
  world: World,
  pose: { x: number; z: number; headingDeg: number },
  dyn: DynamicBodies | undefined,
  maxM: number,
): { freeM: number; hit: CollisionHit | null } {
  const bodies = [...obstacleBodies(world.obstacles), ...dynamicBodies(dyn)].filter((body) => body.solid);
  const direction = dirFromBearing(pose.headingDeg);
  let nearest: { m: number; hit: CollisionHit } | null = null;
  for (const body of bodies) {
    const dx = body.x - pose.x;
    const dz = body.z - pose.z;
    if (dx * dx + dz * dz > (maxM + body.r + ROVER_RADIUS_M) ** 2) continue;
    if (dx * direction.x + dz * direction.z < -(body.r + ROVER_RADIUS_M)) continue;
    const distance = rayCircle(pose, direction, body, body.r + ROVER_RADIUS_M);
    if (distance !== null && (!nearest || distance < nearest.m)) nearest = { m: distance, hit: body.hit };
  }
  const edge = boundaryDistance(pose, direction, world.halfSize);
  if (edge <= maxM && (!nearest || edge < nearest.m)) nearest = { m: edge, hit: 'STEEP_SLOPE' };
  if (!nearest) return { freeM: maxM, hit: null };
  return { freeM: Math.max(0, nearest.m - COLLISION_STOP_M), hit: nearest.hit };
}

export function collisionClearanceInFront(
  world: World,
  pose: { x: number; z: number; headingDeg: number },
  dyn: DynamicBodies | undefined,
  maxM: number,
  groundHeightM: number,
): number {
  const bodies = [...obstacleBodies(world.obstacles), ...dynamicBodies(dyn)];
  const direction = dirFromBearing(pose.headingDeg);
  let clearance = maxM;
  for (const body of bodies) {
    if (body.top < groundHeightM) continue;
    const span = rayCircleSpan(pose, direction, body, body.r + ROVER_RADIUS_M);
    if (span && span.enter < clearance) clearance = span.enter;
  }
  clearance = Math.min(clearance, boundaryDistance(pose, direction, world.halfSize));
  return Math.max(0, clearance - COLLISION_STOP_M);
}
