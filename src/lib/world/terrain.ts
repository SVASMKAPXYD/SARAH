/**
 * P1 — seeded procedural night forest (plan §2 "Procedural low-poly night forest").
 *
 * `generateWorld(params, seed)` returns everything the renderer, the sensor sim and the
 * grader need. `truth` (survivor, animals, true trails) is GROUND TRUTH: it is never
 * serialized into an ObservationPacket and never sent to Gemini.
 */
import { SURVIVOR_MIN_DIST_FROM_BASE_M, WORLD_HALF_SIZE_M } from '../constants';
import { bearingDeg, dirFromBearing, distance, mulberry32, normDeg, polylineLength, type Vec2 } from '../geo';
import type { SurvivorSituation, TerrainParams } from '../gemini/schema';

export type ObstacleKind = 'TREE' | 'ROCK' | 'FALLEN_LOG' | 'WATER';

/** 2D collision/raycast primitive. Logs and creeks are approximated by chains of circles. */
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  r: number;
  /** Height of the top above ground (m). Used by the LiDAR rows. */
  top: number;
}

export interface Tree {
  x: number;
  z: number;
  r: number; // trunk radius
  h: number; // height
  canopyR: number;
}
export interface Log {
  x: number;
  z: number;
  lengthM: number;
  angleDeg: number; // bearing of the log axis
  r: number;
}
export interface Rock {
  x: number;
  z: number;
  r: number;
}
export type Water =
  | { kind: 'creek'; polyline: Vec2[]; widthM: number }
  | { kind: 'pond'; x: number; z: number; r: number };
export interface FungiPatch {
  x: number;
  z: number;
  mushrooms: Vec2[];
}

/** A car that loops a trail. Pose is sampled in the renderer so it moves while the mission is idle. */
export interface TrailCar {
  path: Vec2[];
  offsetM: number;
  speedMps: number;
  color: string;
}

export interface WorldTruth {
  survivor: { x: number; z: number; headingDeg: number; situation: SurvivorSituation };
  foxes: Vec2[];
  deer: Vec2[];
  trails: Vec2[][];
}

export interface World {
  seed: number;
  params: TerrainParams;
  halfSize: number;
  heightAt: (x: number, z: number) => number;
  trees: Tree[];
  logs: Log[];
  rocks: Rock[];
  water: Water | null;
  fungi: FungiPatch[];
  cars: TrailCar[];
  base: Vec2;
  /** Flat obstacle list for 2D raycasts (trees, rocks, log circles, water circles). */
  obstacles: Obstacle[];
  truth: WorldTruth;
}

function pointToPolylineDist(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const L2 = abx * abx + abz * abz || 1e-9;
    let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * abx), p.z - (a.z + t * abz));
    if (d < best) best = d;
  }
  return best;
}

function distToTrails(p: Vec2, trails: Vec2[][]): number {
  let best = Infinity;
  for (const t of trails) best = Math.min(best, pointToPolylineDist(p, t));
  return best;
}

export function generateWorld(params: TerrainParams, seed: number): World {
  const rnd = mulberry32(seed);
  const half = WORLD_HALF_SIZE_M;
  const base: Vec2 = { x: 0, z: 0 };
  const inBounds = (p: Vec2, margin = 4) => Math.abs(p.x) < half - margin && Math.abs(p.z) < half - margin;

  // --- Heightmap: hills from slope, plus high-frequency roughness from bumpiness. ---
  const amp = 1 + params.slope * 7;
  const bumpAmp = params.bumpiness * 3.4;
  const baseHeight = (x: number, z: number) =>
    amp * (0.6 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038) + 0.4 * Math.sin((x + z) * 0.07 + 0.4)) -
    amp * 0.1 +
    bumpAmp * Math.sin(x * 0.52 + 1.2) * Math.cos(z * 0.47 + 0.4) +
    bumpAmp * 0.45 * Math.sin(x * 1.15 + z * 0.92);
  // TODO(P1): steep-slope detection (>35°) for STEEP_SLOPE LiDAR hits and collision stops.

  // --- Trails: a main trail north from base plus branches (branchiness). ---
  const trails: Vec2[][] = [];
  const walk = (start: Vec2, heading: number, lengthM: number, wobble: number): Vec2[] => {
    const pts: Vec2[] = [start];
    let h = heading;
    let p = start;
    let travelled = 0;
    while (travelled < lengthM) {
      h = normDeg(h + (rnd() - 0.5) * wobble);
      const d = dirFromBearing(h);
      const stepLen = 4;
      const np = { x: p.x + d.x * stepLen, z: p.z + d.z * stepLen };
      if (!inBounds(np, 8)) break;
      pts.push(np);
      p = np;
      travelled += stepLen;
    }
    return pts;
  };
  const mainHeading = normDeg(-20 + rnd() * 40);
  const main = walk(base, mainHeading, 70 + rnd() * 20, 30);
  trails.push(main);
  const branchCount = 1 + Math.round(params.branchiness * 3);
  for (let i = 0; i < branchCount; i++) {
    const src = trails[Math.floor(rnd() * trails.length)];
    if (src.length < 4) continue;
    const idx = 2 + Math.floor(rnd() * (src.length - 3));
    const from = src[idx];
    const baseHeading = bearingDeg(src[idx - 1], src[idx]);
    const side = rnd() < 0.5 ? -1 : 1;
    const heading = normDeg(baseHeading + side * (40 + rnd() * 50));
    const branch = walk(from, heading, 20 + rnd() * 35, 40);
    if (branch.length > 2) trails.push(branch);
  }

  // --- Survivor: ≥ 40 m from base, off trail (6–10 m from the nearest trail point), not at base. ---
  let survivor: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 200; i++) {
    const trail = trails[Math.floor(rnd() * trails.length)];
    const anchor = trail[Math.floor(rnd() * trail.length)];
    const off = dirFromBearing(rnd() * 360);
    const offM = 6 + rnd() * 4;
    const c = { x: anchor.x + off.x * offM, z: anchor.z + off.z * offM };
    if (!inBounds(c, 6)) continue;
    const dBase = distance(c, base);
    if (dBase < SURVIVOR_MIN_DIST_FROM_BASE_M) continue;
    const dTrail = distToTrails(c, trails);
    if (dTrail < 5) continue;
    // prefer farther from base but not absurdly far
    const score = Math.min(dBase, 75) - Math.abs(dTrail - 8) * 2;
    if (score > bestScore) {
      bestScore = score;
      survivor = c;
    }
  }
  if (!survivor) {
    const end = main[main.length - 1];
    const off = dirFromBearing(mainHeading + 90);
    survivor = { x: end.x + off.x * 8, z: end.z + off.z * 8 };
  }
  const survivorHeading = normDeg(rnd() * 360);
  const situation = params.survivor_situation;

  // --- Water ---
  let water: Water | null = null;
  if (params.water === 'creek') {
    // creek crossing the world, kept ≥ 15 m from base
    const side = rnd() < 0.5 ? -1 : 1;
    const zOff = side * (25 + rnd() * 30);
    const pts: Vec2[] = [];
    for (let x = -half; x <= half; x += 4) {
      pts.push({ x, z: zOff + Math.sin(x * 0.06 + seed) * 6 + Math.sin(x * 0.17) * 2 });
    }
    water = { kind: 'creek', polyline: pts, widthM: 3 };
  } else if (params.water === 'pond') {
    for (let i = 0; i < 50; i++) {
      const c = { x: (rnd() - 0.5) * 2 * (half - 20), z: (rnd() - 0.5) * 2 * (half - 20) };
      if (distance(c, base) > 28 && distance(c, survivor) > 16 && distToTrails(c, trails) > 8) {
        water = { kind: 'pond', x: c.x, z: c.z, r: 9 };
        break;
      }
    }
  }
  const nearWater = (p: Vec2, margin: number): boolean => {
    if (!water) return false;
    if (water.kind === 'pond') return distance(p, water) < water.r + margin;
    return pointToPolylineDist(p, water.polyline) < water.widthM / 2 + margin;
  };

  // --- Trees (kept off trails, away from base / survivor / water) ---
  const trees: Tree[] = [];
  const treeTarget = Math.round(120 + params.tree_density * 520);
  let tries = 0;
  while (trees.length < treeTarget && tries < treeTarget * 6) {
    tries++;
    const p = { x: (rnd() - 0.5) * 2 * half, z: (rnd() - 0.5) * 2 * half };
    if (distance(p, base) < 6) continue;
    if (distance(p, survivor) < 3) continue;
    if (distToTrails(p, trails) < 2.8) continue;
    if (nearWater(p, 1.5)) continue;
    let ok = true;
    for (const t of trees) {
      if (distance(p, t) < 2.2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    trees.push({ x: p.x, z: p.z, r: 0.25 + rnd() * 0.3, h: 8 + rnd() * 8, canopyR: 1.6 + rnd() * 1.6 });
  }

  // --- Fallen logs (some across trails) ---
  const logs: Log[] = [];
  const rocks: Rock[] = [];
  const logTarget = Math.round(params.fallen_logs * 28);
  for (let i = 0; i < logTarget * 4 && logs.length < logTarget; i++) {
    const onTrail = rnd() < 0.35;
    let p: Vec2;
    if (onTrail) {
      const trail = trails[Math.floor(rnd() * trails.length)];
      p = trail[Math.floor(rnd() * trail.length)];
    } else {
      p = { x: (rnd() - 0.5) * 2 * half, z: (rnd() - 0.5) * 2 * half };
    }
    if (distance(p, base) < 10 || distance(p, survivor) < 4 || nearWater(p, 2)) continue;
    logs.push({ x: p.x, z: p.z, lengthM: 3 + rnd() * 4, angleDeg: rnd() * 180, r: 0.3 + rnd() * 0.15 });
  }
  // Seated: a log behind them. Obstacle: a boulder and a log they are pinned against.
  const back = dirFromBearing(survivorHeading + 180);
  const ahead = dirFromBearing(survivorHeading);
  if (situation === 'obstacle') {
    rocks.push({ x: survivor.x + ahead.x * 1.5, z: survivor.z + ahead.z * 1.5, r: 1.25 });
    logs.push({
      x: survivor.x + ahead.x * 0.7,
      z: survivor.z + ahead.z * 0.7,
      lengthM: 4.2,
      angleDeg: normDeg(survivorHeading + 80),
      r: 0.42,
    });
  } else if (situation !== 'ditch') {
    logs.push({
      x: survivor.x + back.x * 0.9,
      z: survivor.z + back.z * 0.9,
      lengthM: 3.5,
      angleDeg: normDeg(survivorHeading + 90),
      r: 0.35,
    });
  }
  if (situation === 'slope') {
    const side = dirFromBearing(survivorHeading + 90);
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) * 1.6;
      rocks.push({
        x: survivor.x + side.x * t + ahead.x * 1.2,
        z: survivor.z + side.z * t + ahead.z * 1.2,
        r: 0.7 + (i % 2) * 0.35,
      });
    }
  }

  // --- Rocks ---
  const rockTarget = 10 + Math.round(params.slope * 20);
  for (let i = 0; i < rockTarget * 3 && rocks.length < rockTarget; i++) {
    const p = { x: (rnd() - 0.5) * 2 * half, z: (rnd() - 0.5) * 2 * half };
    if (distance(p, base) < 8 || distance(p, survivor) < 4 || distToTrails(p, trails) < 2 || nearWater(p, 1)) continue;
    rocks.push({ x: p.x, z: p.z, r: 0.5 + rnd() * 0.9 });
  }

  // --- Fungi patches (bright in RGB, cold in thermal) near trails ---
  const fungi: FungiPatch[] = [];
  for (let i = 0; i < params.fungi_patches * 5 && fungi.length < params.fungi_patches; i++) {
    const trail = trails[Math.floor(rnd() * trails.length)];
    const anchor = trail[Math.floor(rnd() * trail.length)];
    const off = dirFromBearing(rnd() * 360);
    const c = { x: anchor.x + off.x * (3 + rnd() * 3), z: anchor.z + off.z * (3 + rnd() * 3) };
    if (distance(c, base) < 12 || distance(c, survivor) < 8) continue;
    const mushrooms: Vec2[] = [];
    for (let k = 0; k < 7; k++) mushrooms.push({ x: c.x + (rnd() - 0.5) * 1.6, z: c.z + (rnd() - 0.5) * 1.6 });
    fungi.push({ x: c.x, z: c.z, mushrooms });
  }

  // --- Animals (initial positions near trails, 18–60 m from base) ---
  const animalSpot = (): Vec2 => {
    for (let i = 0; i < 60; i++) {
      const trail = trails[Math.floor(rnd() * trails.length)];
      const anchor = trail[Math.floor(rnd() * trail.length)];
      const off = dirFromBearing(rnd() * 360);
      const c = { x: anchor.x + off.x * (2 + rnd() * 6), z: anchor.z + off.z * (2 + rnd() * 6) };
      const d = distance(c, base);
      if (d > 18 && d < 60 && distance(c, survivor) > 10 && inBounds(c)) return c;
    }
    return { x: 20, z: -20 };
  };
  const foxes: Vec2[] = [];
  for (let i = 0; i < params.fox_count; i++) foxes.push(animalSpot());
  const deer: Vec2[] = [];
  for (let i = 0; i < params.deer_count; i++) deer.push(animalSpot());

  const carColors = ['#c23b3b', '#e8e8e8', '#1f4e8c', '#e0a020'];
  const cars: TrailCar[] = [];
  for (let i = 0; i < params.car_count; i++) {
    const trail = trails[i % trails.length];
    if (!trail || trail.length < 2) continue;
    const len = Math.max(8, polylineLength(trail));
    cars.push({
      path: trail,
      offsetM: 12 + (i * len) / params.car_count,
      speedMps: 5 + (i % 3) * 1.5,
      color: carColors[i % carColors.length],
    });
  }

  // Local landform around the survivor, applied after placement so x/z stay put.
  let heightAt = baseHeight;
  if (situation === 'ditch') {
    const fwd = dirFromBearing(survivorHeading);
    const right = dirFromBearing(survivorHeading + 90);
    const prev = heightAt;
    heightAt = (x, z) => {
      const dx = x - survivor.x;
      const dz = z - survivor.z;
      const along = dx * fwd.x + dz * fwd.z;
      const across = dx * right.x + dz * right.z;
      const well = Math.exp(-(along * along) / 22) * Math.exp(-(across * across) / 1.7);
      return prev(x, z) - 1.8 * well;
    };
  } else if (situation === 'slope') {
    const right = dirFromBearing(survivorHeading + 90);
    const prev = heightAt;
    heightAt = (x, z) => {
      const dx = x - survivor.x;
      const dz = z - survivor.z;
      const across = dx * right.x + dz * right.z;
      const local = Math.exp(-(dx * dx + dz * dz) / 90);
      return prev(x, z) + across * 0.7 * local;
    };
  }

  // --- Flat obstacle list for raycasts ---
  const obstacles: Obstacle[] = [];
  for (const t of trees) obstacles.push({ kind: 'TREE', x: t.x, z: t.z, r: t.r, top: t.h });
  for (const r of rocks) obstacles.push({ kind: 'ROCK', x: r.x, z: r.z, r: r.r, top: r.r * 0.9 });
  for (const l of logs) {
    const d = dirFromBearing(l.angleDeg);
    const n = Math.max(2, Math.ceil(l.lengthM / (l.r * 1.5)));
    for (let i = 0; i < n; i++) {
      const t = -l.lengthM / 2 + (i / (n - 1)) * l.lengthM;
      obstacles.push({ kind: 'FALLEN_LOG', x: l.x + d.x * t, z: l.z + d.z * t, r: l.r, top: l.r * 2 });
    }
  }
  if (water) {
    if (water.kind === 'pond') obstacles.push({ kind: 'WATER', x: water.x, z: water.z, r: water.r, top: 0 });
    else {
      const r = water.widthM / 2;
      for (let i = 0; i < water.polyline.length; i++) {
        const p = water.polyline[i];
        obstacles.push({ kind: 'WATER', x: p.x, z: p.z, r, top: 0 });
        if (i + 1 < water.polyline.length) {
          const q = water.polyline[i + 1];
          obstacles.push({ kind: 'WATER', x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, r, top: 0 });
        }
      }
    }
  }

  return {
    seed,
    params,
    halfSize: half,
    heightAt,
    trees,
    logs,
    rocks,
    water,
    fungi,
    cars,
    base,
    obstacles,
    truth: { survivor: { ...survivor, headingDeg: survivorHeading, situation }, foxes, deer, trails },
  };
}

/** Point and heading at a distance along a polyline, wrapping so cars loop. */
export function poseAlongPath(path: Vec2[], distanceM: number): { x: number; z: number; headingDeg: number } {
  if (path.length === 0) return { x: 0, z: 0, headingDeg: 0 };
  if (path.length === 1) return { x: path[0].x, z: path[0].z, headingDeg: 0 };
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const len = distance(path[i - 1], path[i]);
    lens.push(len);
    total += len;
  }
  if (total < 1e-3) return { x: path[0].x, z: path[0].z, headingDeg: 0 };
  let d = ((distanceM % total) + total) % total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const span = lens[i] || 1;
      const t = Math.min(1, d / span);
      const a = path[i];
      const b = path[i + 1];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, headingDeg: bearingDeg(a, b) };
    }
    d -= lens[i];
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, headingDeg: 0 };
}
