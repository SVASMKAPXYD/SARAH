/**
 * P1 — decoy animals (plan §2): fox wanders ~1 m/s and flees inside 6 m; deer stands
 * still, bolts inside 8 m and stops ~20 m away. Pure functions over AnimalState so the
 * mission tick can run them without React.
 * TODO(P1): keep animals off obstacles / water; animate legs in the renderer.
 */
import {
  DEER_BOLT_DISTANCE_M,
  DEER_BOLT_SPEED_MPS,
  DEER_FLEE_RADIUS_M,
  FOX_FLEE_RADIUS_M,
  FOX_SPEED_MPS,
  WORLD_HALF_SIZE_M,
} from '../constants';
import { bearingDeg, dirFromBearing, distance, mulberry32, normDeg, type Vec2 } from '../geo';
import type { World } from './terrain';

export type AnimalKind = 'fox' | 'deer';

export interface AnimalState {
  id: string;
  kind: AnimalKind;
  x: number;
  z: number;
  headingDeg: number;
  mode: 'wander' | 'stand' | 'flee' | 'bolt';
  /** bolt: distance left to run */
  boltRemainingM: number;
  wanderTimer: number;
}

export function initAnimals(world: World): AnimalState[] {
  const out: AnimalState[] = [];
  world.truth.foxes.forEach((p, i) =>
    out.push({ id: `fox${i}`, kind: 'fox', x: p.x, z: p.z, headingDeg: (i * 97) % 360, mode: 'wander', boltRemainingM: 0, wanderTimer: 0 }),
  );
  world.truth.deer.forEach((p, i) =>
    out.push({ id: `deer${i}`, kind: 'deer', x: p.x, z: p.z, headingDeg: (i * 211 + 45) % 360, mode: 'stand', boltRemainingM: 0, wanderTimer: 0 }),
  );
  return out;
}

const rnd = mulberry32(42);

export function stepAnimals(animals: AnimalState[], rover: Vec2, dt: number): AnimalState[] {
  return animals.map((a) => {
    const d = distance(a, rover);
    const away = normDeg(bearingDeg(rover, a));
    const next = { ...a };
    if (a.kind === 'fox') {
      if (d < FOX_FLEE_RADIUS_M) {
        next.mode = 'flee';
        next.headingDeg = away;
        advance(next, FOX_SPEED_MPS * 2.5, dt);
      } else {
        next.mode = 'wander';
        next.wanderTimer -= dt;
        if (next.wanderTimer <= 0) {
          next.headingDeg = normDeg(a.headingDeg + (rnd() - 0.5) * 120);
          next.wanderTimer = 2 + rnd() * 3;
        }
        advance(next, FOX_SPEED_MPS, dt);
      }
    } else {
      if (a.mode === 'bolt') {
        const run = Math.min(next.boltRemainingM, DEER_BOLT_SPEED_MPS * dt);
        advance(next, run / Math.max(dt, 1e-6), dt);
        next.boltRemainingM -= run;
        if (next.boltRemainingM <= 0) next.mode = 'stand';
      } else if (d < DEER_FLEE_RADIUS_M) {
        next.mode = 'bolt';
        next.headingDeg = normDeg(away + (rnd() - 0.5) * 40);
        next.boltRemainingM = DEER_BOLT_DISTANCE_M;
      } else {
        next.mode = 'stand';
      }
    }
    // stay in the world
    const lim = WORLD_HALF_SIZE_M - 5;
    next.x = Math.max(-lim, Math.min(lim, next.x));
    next.z = Math.max(-lim, Math.min(lim, next.z));
    return next;
  });
}

function advance(a: AnimalState, speed: number, dt: number) {
  const dir = dirFromBearing(a.headingDeg);
  a.x += dir.x * speed * dt;
  a.z += dir.z * speed * dt;
}
