/** Small 2D geometry helpers in the SARAH frame (see constants.ts header). */

export type Vec2 = { x: number; z: number };

export const DEG = Math.PI / 180;

/** Normalize to [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Normalize to (−180, 180]. */
export function wrapDeg(deg: number): number {
  let d = normDeg(deg);
  if (d > 180) d -= 360;
  return d;
}

/** Absolute bearing from `from` to `to`: atan2(dx, −dz), 0 = north, clockwise. */
export function bearingDeg(from: Vec2, to: Vec2): number {
  return normDeg((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Unit direction vector for an absolute bearing. */
export function dirFromBearing(bearing: number): Vec2 {
  const r = bearing * DEG;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += distance(pts[i - 1], pts[i]);
  return L;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Ray (origin, unit dir) vs circle (center, radius). Returns the distance along the
 * ray to the first intersection ≥ 0, or null.
 */
export function rayCircle(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
  const fx = origin.x - center.x;
  const fz = origin.z - center.z;
  const b = 2 * (fx * dir.x + fz * dir.z);
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / 2;
  if (t1 >= 0) return t1;
  const t2 = (-b + s) / 2;
  if (t2 >= 0) return 0; // origin inside the circle
  return null;
}

/**
 * Ray vs circle: entry and exit distances along the ray (both ≥ 0, entry clamped to 0 when
 * the origin is inside), or null when the ray misses.
 */
export function rayCircleSpan(origin: Vec2, dir: Vec2, center: Vec2, radius: number): { enter: number; exit: number } | null {
  const fx = origin.x - center.x;
  const fz = origin.z - center.z;
  const b = 2 * (fx * dir.x + fz * dir.z);
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / 2;
  const t2 = (-b + s) / 2;
  if (t2 < 0) return null;
  return { enter: Math.max(0, t1), exit: t2 };
}

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string, hex. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
