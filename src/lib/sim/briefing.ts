/**
 * Field briefings: natural-language clues from the search party, turned into a
 * weighted belief the mission loop uses when it chooses the next move.
 *
 * Definite wording ("is", "must be", "confirmed") shifts probability mass and
 * the commanded step more than hedges ("likely", "maybe", "might"). Clues
 * accumulate. A conflicting direction is dropped only when a higher-certainty
 * briefing contradicts it. With no briefing, callers leave the decider alone.
 */
import { MAX_MOVE_M, WORLD_HALF_SIZE_M } from '../constants.ts';
import { bearingDeg, clamp, dirFromBearing, distance, normDeg, round, wrapDeg, type Vec2 } from '../geo.ts';
import type { Decision, SearchGuidance } from '../types.ts';
import type { Water } from '../world/terrain.ts';

export const BELIEF_CELL_M = 12;

export type LandmarkKind = 'fallen_log' | 'trail' | 'water' | 'rock' | 'fungi' | 'tree' | 'clearing' | 'ridge';
export type CertaintyLabel = 'high' | 'medium' | 'low';

export interface BriefingDirection {
  name: string;
  bearingDeg: number;
  relative: boolean;
  quadrant: boolean;
}

export interface FieldBriefing {
  id: number;
  text: string;
  t: number;
  /** How sure the wording is, before recency or conflict (0–1). */
  certainty: number;
  certaintyLabel: CertaintyLabel;
  /** Weight actually applied to the search after recency and conflict (0–1). */
  weight: number;
  /** Certainty × recency, before a conflicting direction is overruled. */
  fullWeight: number;
  suppressed: boolean;
  summary: string;
  /** Rover pose when the clue arrived. Relative directions stay anchored here. */
  anchor: Vec2;
  direction: BriefingDirection | null;
  landmarks: LandmarkKind[];
  landmarkSupported: boolean;
  tight: boolean;
}

export interface BeliefCell {
  x: number;
  z: number;
  p: number;
}

export interface SearchBelief {
  cells: BeliefCell[];
  focus: Vec2;
  focusBearingDeg: number;
  stepM: number;
  strength: number;
  spreadM: number;
  summary: string;
}

export interface TerrainFeatures {
  halfSize: number;
  logs: { x: number; z: number }[];
  rocks: { x: number; z: number }[];
  trees: { x: number; z: number }[];
  fungi: { x: number; z: number }[];
  water: Water | null;
  truth: { trails: Vec2[][] };
}

const DIRECTIONS: { name: string; bearingDeg: number; re: RegExp }[] = [
  { name: 'NE', bearingDeg: 45, re: /\b(?:north[\s-]*east(?:ern)?|northeast(?:ern)?|ne)\b/g },
  { name: 'SE', bearingDeg: 135, re: /\b(?:south[\s-]*east(?:ern)?|southeast(?:ern)?|se)\b/g },
  { name: 'SW', bearingDeg: 225, re: /\b(?:south[\s-]*west(?:ern)?|southwest(?:ern)?|sw)\b/g },
  { name: 'NW', bearingDeg: 315, re: /\b(?:north[\s-]*west(?:ern)?|northwest(?:ern)?|nw)\b/g },
  { name: 'N', bearingDeg: 0, re: /\bnorth(?:ern)?\b/g },
  { name: 'S', bearingDeg: 180, re: /\bsouth(?:ern)?\b/g },
  { name: 'E', bearingDeg: 90, re: /\beast(?:ern)?\b/g },
  { name: 'W', bearingDeg: 270, re: /\bwest(?:ern)?\b/g },
];

const LANDMARKS: { kind: LandmarkKind; re: RegExp }[] = [
  { kind: 'fallen_log', re: /\b(?:fallen[\s-]*logs?|deadfalls?|windfalls?|downed[\s-]*logs?|logs?)\b/ },
  { kind: 'trail', re: /\b(?:trails?|footpaths?|paths?)\b/ },
  { kind: 'water', re: /\b(?:creeks?|streams?|rivers?|ponds?|lakes?|water)\b/ },
  { kind: 'ridge', re: /\b(?:ridges?|ridgelines?|hilltops?|hills?|slopes?)\b/ },
  { kind: 'rock', re: /\b(?:rocks?|boulders?|stones?)\b/ },
  { kind: 'fungi', re: /\b(?:fungi|mushrooms?)\b/ },
  { kind: 'clearing', re: /\b(?:clearings?|meadows?|open ground)\b/ },
  { kind: 'tree', re: /\b(?:trees?|forest|woods|pines?)\b/ },
];

const HEDGES: { re: RegExp; weight: number }[] = [
  { re: /\b(?:possibly|perhaps|maybe)\b/, weight: 0.28 },
  { re: /\b(?:might|may)\b/, weight: 0.32 },
  { re: /\bcould be\b/, weight: 0.34 },
  { re: /\b(?:i think|i guess|unsure|uncertain)\b/, weight: 0.36 },
  { re: /\blikely\b/, weight: 0.42 },
  { re: /\bprobably\b/, weight: 0.5 },
];

const DEFINITES: { re: RegExp; weight: number }[] = [
  { re: /\b(?:confirmed|definitely|certainly|certain)\b/, weight: 0.96 },
  { re: /\bmust be\b/, weight: 0.94 },
  { re: /\b(?:is|are|was|were)\b/, weight: 0.86 },
];

const LANDMARK_LABEL: Record<LandmarkKind, string> = {
  fallen_log: 'fallen log',
  trail: 'trail',
  water: 'water',
  ridge: 'ridge',
  rock: 'rock',
  fungi: 'fungi',
  clearing: 'clearing',
  tree: 'trees',
};

export function certaintyLabel(certainty: number): CertaintyLabel {
  if (certainty >= 0.72) return 'high';
  if (certainty >= 0.45) return 'medium';
  return 'low';
}

export function compassLabel(bearing: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(normDeg(bearing) / 45) % 8];
}

export function angularSeparation(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b));
}

/** Shortest-arc blend. t=1 returns `to`. */
export function lerpAngle(from: number, to: number, t: number): number {
  return normDeg(from + wrapDeg(to - from) * clamp(t, 0, 1));
}

export function parseBriefing(raw: string, anchor: Vec2, id: number, t = Date.now()): FieldBriefing {
  const text = raw.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 500);
  const norm = text.toLowerCase();
  const certainty = languageCertainty(norm);
  const direction = findDirection(norm);
  const landmarks = findLandmarks(norm);
  const relative = direction
    ? /\b(?:sarah|rover|robot)\b/.test(norm) || /\bcurrent (?:location|position|pose)\b/.test(norm) || /\bof (?:her|him)\b/.test(norm)
    : false;
  const quadrant = /\bquadrants?\b/.test(norm);
  const tight = /\b(?:next to|beside|against|near|by a|by the)\b/.test(norm);
  const parsed: FieldBriefing = {
    id,
    text,
    t,
    certainty,
    certaintyLabel: certaintyLabel(certainty),
    weight: certainty,
    fullWeight: certainty,
    suppressed: false,
    summary: '',
    anchor: { x: anchor.x, z: anchor.z },
    direction: direction ? { ...direction, relative, quadrant } : null,
    landmarks,
    landmarkSupported: true,
    tight,
  };
  parsed.summary = describeBriefing(parsed);
  return parsed;
}

export function computeSearchBelief(
  input: FieldBriefing[],
  world: TerrainFeatures,
  rover: Vec2,
): { briefings: FieldBriefing[]; belief: SearchBelief | null } {
  const features = {
    halfSize: world.halfSize || WORLD_HALF_SIZE_M,
    logs: world.logs,
    rocks: world.rocks,
    trees: world.trees,
    fungi: world.fungi,
    water: world.water,
    trails: world.truth.trails,
  };
  const briefings = applyWeights(input.map((b) => ({ ...b, direction: b.direction ? { ...b.direction } : null, landmarks: [...b.landmarks] })));
  for (const b of briefings) {
    const unsupported = b.landmarks.filter((kind) => !landmarkAvailable(kind, features));
    b.landmarkSupported = unsupported.length === 0;
    b.summary = describeBriefing(b, unsupported);
  }

  const half = features.halfSize;
  const origin = -half + BELIEF_CELL_M / 2;
  const n = Math.floor((half * 2) / BELIEF_CELL_M);
  const scored: { x: number; z: number; score: number }[] = [];
  let maxScore = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const cell = { x: origin + ix * BELIEF_CELL_M, z: origin + iz * BELIEF_CELL_M };
      let score = 0;
      for (const b of briefings) score += cellScore(b, cell, features);
      if (score > maxScore) maxScore = score;
      if (score > 0) scored.push({ ...cell, score });
    }
  }
  if (maxScore < 1e-4 || scored.length === 0) return { briefings, belief: null };

  const focusCell = pickFocus(scored, rover);
  const strength = briefings.reduce((m, b) => {
    const land = b.landmarks.some((kind) => landmarkAvailable(kind, features));
    const dir = Boolean(b.direction) && !b.suppressed;
    if (!dir && !land) return m;
    // Movement follows the wording's certainty. Recency shifts where mass sits;
    // an overruled clue must not water down a stronger one.
    return Math.max(m, b.suppressed ? b.fullWeight : b.certainty);
  }, 0);
  const keep = maxScore * (0.38 + 0.32 * clamp(strength, 0, 1));
  const shown = scored.filter((c) => c.score >= keep);
  const cells = (shown.length ? shown : [focusCell]).map((c) => ({ x: c.x, z: c.z, p: c.score / maxScore }));
  const focus = { x: focusCell.x, z: focusCell.z };
  const spreadM = cells.reduce((sum, c) => sum + distance(c, focus), 0) / cells.length;
  const distToFocus = distance(rover, focus);
  const active = briefings.filter((b) => !b.suppressed && b.weight > 0.05 && (b.direction || b.landmarks.length > 0));
  const summary = active.map((b) => b.summary).slice(-3).join('; ') || 'field clue';
  return {
    briefings,
    belief: {
      cells,
      focus,
      focusBearingDeg: bearingDeg(rover, focus),
      stepM: clamp(distToFocus, 2, MAX_MOVE_M),
      strength: clamp(strength, 0, 1),
      spreadM,
      summary,
    },
  };
}

/** Blend an unguided decision toward the belief. No belief leaves the decision unchanged. */
export function steerDecision(decision: Decision, belief: SearchBelief | null): Decision {
  if (!belief || decision.mark_survivor || belief.strength <= 0) return decision;
  // A zero-length move is the decider's collision response. Keep that turn so a
  // strong clue cannot pin Sarah against the obstacle.
  if (decision.distance_m === 0) return decision;
  const w = clamp(belief.strength, 0, 1);
  const bearing = lerpAngle(decision.bearing_deg, belief.focusBearingDeg, w);
  const distanceM = clamp(decision.distance_m * (1 - w) + belief.stepM * w, 0, MAX_MOVE_M);
  const pct = Math.round(w * 100);
  const reason = `Field clue ${pct}% — ${belief.summary}. Searching ${compassLabel(belief.focusBearingDeg)}.`.slice(0, 500);
  return {
    ...decision,
    bearing_deg: round(bearing, 1),
    distance_m: round(distanceM, 1),
    reason,
  };
}

/** Where the next step will aim if the unguided move is "continue on this heading". */
export function previewCommand(headingDeg: number, rover: Vec2, belief: SearchBelief) {
  const focusBearingDeg = bearingDeg(rover, belief.focus);
  const steered = steerDecision(
    { bearing_deg: headingDeg, distance_m: 6, reason: 'preview', replace_entire_memory: '' },
    { ...belief, focusBearingDeg, stepM: clamp(distance(rover, belief.focus), 2, MAX_MOVE_M) },
  );
  const dir = dirFromBearing(steered.bearing_deg);
  return {
    bearingDeg: steered.bearing_deg,
    focusBearingDeg,
    distanceM: steered.distance_m,
    aim: { x: rover.x + dir.x * steered.distance_m, z: rover.z + dir.z * steered.distance_m },
  };
}

export function guidanceFromBelief(belief: SearchBelief, briefings: FieldBriefing[]): SearchGuidance {
  return {
    strength: round(belief.strength, 2),
    focus_bearing_deg: Math.round(belief.focusBearingDeg),
    step_m: round(belief.stepM, 1),
    summary: belief.summary.slice(0, 400),
    clues: briefings.slice(-8).map((b) => ({
      text: b.text.slice(0, 240),
      certainty: round(b.certainty, 2),
      weight: round(b.weight, 2),
      summary: b.summary.slice(0, 160),
      suppressed: b.suppressed,
    })),
  };
}

export function formatFocusOffset(from: Vec2, to: Vec2): string {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const parts: string[] = [];
  if (Math.abs(dz) >= 1) parts.push(`${Math.abs(dz).toFixed(0)} m ${dz > 0 ? 'south' : 'north'}`);
  if (Math.abs(dx) >= 1) parts.push(`${Math.abs(dx).toFixed(0)} m ${dx > 0 ? 'east' : 'west'}`);
  return parts.join(', ') || 'at Sarah';
}

function languageCertainty(norm: string): number {
  let hedge = 1;
  for (const h of HEDGES) if (h.re.test(norm)) hedge = Math.min(hedge, h.weight);
  if (hedge < 1) return hedge;
  let definite = 0;
  for (const d of DEFINITES) if (d.re.test(norm)) definite = Math.max(definite, d.weight);
  return definite > 0 ? definite : 0.55;
}

function findDirection(norm: string): { name: string; bearingDeg: number } | null {
  let best: { name: string; bearingDeg: number; index: number; length: number } | null = null;
  for (const d of DIRECTIONS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = d.re.exec(norm))) {
      const length = m[0].length;
      if (!best || length > best.length || (length === best.length && m.index > best.index)) {
        best = { name: d.name, bearingDeg: d.bearingDeg, index: m.index, length };
      }
    }
  }
  return best ? { name: best.name, bearingDeg: best.bearingDeg } : null;
}

function findLandmarks(norm: string): LandmarkKind[] {
  const found: LandmarkKind[] = [];
  for (const landmark of LANDMARKS) {
    if (landmark.re.test(norm) && !found.includes(landmark.kind)) found.push(landmark.kind);
  }
  return found;
}

function describeBriefing(b: FieldBriefing, unsupported: LandmarkKind[] = []): string {
  const bits: string[] = [];
  if (b.direction) {
    const place = b.direction.quadrant ? `${b.direction.name} quadrant` : b.direction.name;
    bits.push(b.direction.relative ? `${place} of Sarah` : place);
  }
  if (b.landmarks.length) bits.push(b.landmarks.map((k) => LANDMARK_LABEL[k]).join(', '));
  if (!bits.length) return 'No location clue';
  const line = bits.join(' · ');
  if (!unsupported.length) return line;
  return `${line} (no ${unsupported.map((k) => LANDMARK_LABEL[k]).join('/')} on this map)`;
}

function recencyOf(index: number, count: number): number {
  if (count <= 1) return 1;
  return 0.7 + 0.3 * (index / (count - 1));
}

function applyWeights(briefings: FieldBriefing[]): FieldBriefing[] {
  const dirs = briefings.flatMap((b, index) => (b.direction ? [{ index, bearing: b.direction.bearingDeg, certainty: b.certainty }] : []));
  const dominant = dirs.reduce<{ index: number; bearing: number; certainty: number } | null>((best, d) => {
    if (!best) return d;
    if (d.certainty > best.certainty + 0.02) return d;
    if (best.certainty > d.certainty + 0.02) return best;
    return d.index > best.index ? d : best;
  }, null);
  briefings.forEach((b, index) => {
    const recency = recencyOf(index, briefings.length);
    const full = clamp(b.certainty * recency, 0, 1);
    const winner = dominant;
    const conflicts = Boolean(
      winner && b.direction && angularSeparation(b.direction.bearingDeg, winner.bearing) > 100 && b.certainty < winner.certainty - 0.02,
    );
    b.fullWeight = full;
    b.suppressed = conflicts;
    b.weight = conflicts && winner ? clamp(full * (1 - winner.certainty), 0, 1) : full;
  });
  return briefings;
}

function landmarkAvailable(kind: LandmarkKind, features: { logs: unknown[]; rocks: unknown[]; trees: unknown[]; fungi: unknown[]; water: Water | null; trails: Vec2[][] }): boolean {
  switch (kind) {
    case 'fallen_log': return features.logs.length > 0;
    case 'trail': return features.trails.some((t) => t.length > 1);
    case 'water': return features.water != null;
    case 'rock': return features.rocks.length > 0;
    case 'fungi': return features.fungi.length > 0;
    case 'tree': return features.trees.length > 0;
    case 'clearing': return features.trees.length > 0;
    case 'ridge': return false;
    default: return false;
  }
}

function cellScore(b: FieldBriefing, cell: Vec2, features: { logs: { x: number; z: number }[]; rocks: { x: number; z: number }[]; trees: { x: number; z: number }[]; fungi: { x: number; z: number }[]; water: Water | null; trails: Vec2[][] }): number {
  const supported = b.landmarks.filter((kind) => landmarkAvailable(kind, features));
  const useDir = Boolean(b.direction) && !b.suppressed;
  if (!useDir && supported.length === 0) return 0;
  const w = useDir ? b.weight : b.fullWeight;
  if (w <= 0) return 0;
  let sector = 0;
  let range = 1;
  if (useDir && b.direction) {
    const origin = b.direction.relative ? b.anchor : { x: 0, z: 0 };
    const halfWidth = b.direction.quadrant ? 46 : 28 + (1 - b.certainty) * 70;
    sector = sectorScore(bearingDeg(origin, cell), b.direction.bearingDeg, halfWidth);
    const preferred = b.direction.quadrant ? 62 : 16 + b.certainty * 40;
    const sigma = b.direction.quadrant ? 36 : 16 + (1 - b.certainty) * 20;
    const d = distance(origin, cell);
    range = Math.exp(-((d - preferred) ** 2) / (2 * sigma * sigma));
  }
  let prox = 0;
  if (supported.length) {
    const sigma = (b.tight ? 9 : 16) * (1.2 - 0.45 * b.certainty);
    prox = Math.max(...supported.map((kind) => landmarkProximity(cell, kind, features, sigma)));
  }
  let factor = 0;
  if (useDir && supported.length) factor = sector * range * (0.25 + 0.75 * prox);
  else if (useDir) factor = sector * range;
  else factor = prox;
  return w * factor;
}

function sectorScore(bearing: number, center: number, halfWidth: number): number {
  const d = angularSeparation(bearing, center);
  if (d >= halfWidth) return 0;
  return Math.cos((d / halfWidth) * Math.PI / 2);
}

function landmarkProximity(cell: Vec2, kind: LandmarkKind, features: { logs: { x: number; z: number }[]; rocks: { x: number; z: number }[]; trees: { x: number; z: number }[]; fungi: { x: number; z: number }[]; water: Water | null; trails: Vec2[][] }, sigma: number): number {
  const d = nearestLandmark(cell, kind, features);
  if (!Number.isFinite(d)) return 0;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

function nearestLandmark(cell: Vec2, kind: LandmarkKind, features: { logs: { x: number; z: number }[]; rocks: { x: number; z: number }[]; trees: { x: number; z: number }[]; fungi: { x: number; z: number }[]; water: Water | null; trails: Vec2[][] }): number {
  switch (kind) {
    case 'fallen_log': return nearestPoint(cell, features.logs);
    case 'rock': return nearestPoint(cell, features.rocks);
    case 'fungi': return nearestPoint(cell, features.fungi);
    case 'tree': return nearestPoint(cell, features.trees);
    case 'clearing': return clearingDistance(cell, features.trees);
    case 'trail': return Math.min(...features.trails.map((t) => pointToPolyline(cell, t)));
    case 'water': return waterDistance(cell, features.water);
    default: return Infinity;
  }
}

function nearestPoint(cell: Vec2, pts: { x: number; z: number }[]): number {
  let best = Infinity;
  for (const p of pts) best = Math.min(best, distance(cell, p));
  return best;
}

function clearingDistance(cell: Vec2, trees: { x: number; z: number }[]): number {
  let count = 0;
  for (const tree of trees) if (distance(cell, tree) < 14) count++;
  // Open ground scores as distance 0; crowded cells score as far away.
  return count * 8;
}

function waterDistance(cell: Vec2, water: Water | null): number {
  if (!water) return Infinity;
  if (water.kind === 'pond') return Math.max(0, distance(cell, water) - water.r);
  return pointToPolyline(cell, water.polyline);
}

function pointToPolyline(p: Vec2, poly: Vec2[]): number {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) return distance(p, poly[0]);
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const L2 = abx * abx + abz * abz || 1e-9;
    let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * abx), p.z - (a.z + t * abz)));
  }
  return best;
}

function pickFocus(scored: { x: number; z: number; score: number }[], rover: Vec2) {
  let best = scored[0];
  let far: typeof best | null = null;
  for (const c of scored) {
    if (c.score > best.score) best = c;
    if (distance(c, rover) >= 8 && (!far || c.score > far.score)) far = c;
  }
  if (distance(best, rover) >= 8) return best;
  if (far && far.score >= best.score * 0.55) return far;
  return best;
}
