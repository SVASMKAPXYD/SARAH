/**
 * P2 — deterministic mock decider. Produces a valid Decision from the packet ALONE
 * (it never sees ground truth) so the P1/P3/P4 loop runs without a Gemini key.
 *
 * This deliberately simple offline fixture steers toward the clearest LiDAR column and
 * declares occasional map memory. It is not a substitute for Gemini's navigation policy.
 */
import { LIDAR_COLUMN_KEYS, LIDAR_MAX_M, MAX_MOVE_M } from '../constants';
import { normDeg } from '../geo';
import type { Decision, LidarColumnKey, ObservationPacket, TerrainParams } from '../types';
import { DEFAULT_TERRAIN_PARAMS, describeLight } from './schema';

function columnScore(packet: ObservationPacket, key: LidarColumnKey): number {
  const level = packet.lidar.level[key];
  const ground = packet.lidar.ground[key];
  let score = level.m ?? LIDAR_MAX_M;
  if (ground.hit === 'WATER' || ground.hit === 'STEEP_SLOPE') score = Math.min(score, (ground.m ?? 2) - 0.5);
  if (ground.hit === 'FALLEN_LOG') score = Math.min(score, (ground.m ?? 2));
  // mild preference for straight ahead
  score -= Math.abs(Number(key)) * 0.02;
  return score;
}

export function mockDecide(packet: ObservationPacket): Decision {
  const step = packet.mission.step;
  const heading = packet.pose.heading_deg;
  const blocked = /^BLOCKED/.test(packet.last_result);
  const nodes = packet.map.nodes;

  // Stuck against something the thin LiDAR rays do not see (body-width contact): turn to look.
  const stuck = blocked && /after 0\.0 m/.test(packet.last_result);
  if (stuck) {
    const turn = step % 2 === 0 ? 70 : -110;
    return {
      observations: `Mock: the last move was blocked immediately by ${/BLOCKED by (\w+)/.exec(packet.last_result)?.[1] ?? 'an obstacle'} the grid does not show; turning ${turn}° to scan.`,
      map_update: {
        node_here: packet.pose.at_node ? null : { kind: 'DEAD_END', note: 'Mock: blocked at body contact' },
        new_frontiers: [],
        frontier_updates: [],
        edge_annotation: null,
      },
      survivor_assessment: 'NO_EVIDENCE',
      evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
      intent: 'SCAN',
      action: { type: 'MOVE', turn_deg: turn, distance_m: 0 },
      confidence: 0.4,
      brief_reason: `I cannot move forward, so I turn ${turn}° in place to look for another way.`,
    };
  }

  // Rank columns by clearance; after a blocked move, avoid the columns around the blocked heading.
  const ranked = [...LIDAR_COLUMN_KEYS]
    .map((k) => ({ k, s: columnScore(packet, k) }))
    .filter((c) => !blocked || Math.abs(Number(c.k)) >= 20)
    .sort((a, b) => b.s - a.s);
  const best = ranked[0];
  const bestM = packet.lidar.level[best.k].m ?? LIDAR_MAX_M;

  // Everything close: turn in place to look around.
  if (best.s < 3) {
    return {
      observations: `Mock: obstacles within ${best.s.toFixed(1)} m across the whole grid; turning to look for an opening.`,
      map_update: {
        node_here: blocked ? { kind: 'DEAD_END', note: 'Mock: boxed in, turning around' } : null,
        new_frontiers: [],
        frontier_updates: [],
        edge_annotation: blocked ? { terrain: 'FOREST', hazard_cost: 0.5 } : null,
      },
      survivor_assessment: 'NO_EVIDENCE',
      evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
      intent: 'SCAN',
      action: { type: 'MOVE', turn_deg: 90, distance_m: 0 },
      confidence: 0.4,
      brief_reason: 'I am boxed in, so I turn 90° to scan for an opening.',
    };
  }

  const turn = Number(best.k);
  const distance = Math.max(1, Math.min(MAX_MOVE_M, Math.floor(bestM - 1.5)));

  const declareNode = blocked || step % 3 === 0;
  const nodeKind = blocked ? 'DEAD_END' : nodes.length <= 1 ? 'JUNCTION' : 'VIEWPOINT';

  // Frontiers for other open columns (absolute bearings), max 2, only when declaring a node.
  const newFrontiers = declareNode
    ? ranked
        .slice(1)
        .filter((c) => c.s >= 12 && Math.abs(Number(c.k) - turn) >= 20)
        .slice(0, 2)
        .map((c) => ({
          bearing_deg: Math.round(normDeg(heading + Number(c.k))),
          estimated_distance_m: Math.round(packet.lidar.level[c.k].m ?? LIDAR_MAX_M),
          geometry: c.s >= 20 ? ('CLEAR' as const) : ('NARROW' as const),
          note: `Mock: open column ${c.k}`,
        }))
    : [];

  // Mark an UNEXPLORED frontier we are now pointing at as TRAVERSED.
  const absBearing = normDeg(heading + turn);
  const frontierUpdates = packet.map.frontiers
    .filter((f) => f.status === 'UNEXPLORED' && Math.abs(((f.bearing_deg - absBearing + 540) % 360) - 180) < 15 && f.from_node === packet.pose.at_node)
    .slice(0, 1)
    .map((f) => ({ id: f.id, status: 'TRAVERSED' as const }));

  return {
    observations: `Mock: clearest column ${best.k} reads ${bestM >= LIDAR_MAX_M ? '>30' : bestM.toFixed(1)} m${
      blocked ? ' after a blocked move' : ''
    }; no thermal signature evaluated.`,
    map_update: {
      node_here: declareNode ? { kind: nodeKind, note: blocked ? 'Mock: blocked here' : `Mock viewpoint at step ${step}` } : null,
      new_frontiers: newFrontiers,
      frontier_updates: frontierUpdates,
      edge_annotation: declareNode ? { terrain: 'FOREST', hazard_cost: blocked ? 0.5 : 0.1 } : null,
    },
    survivor_assessment: 'NO_EVIDENCE',
    evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
    intent: 'EXPLORE_FRONTIER',
    action: { type: 'MOVE', turn_deg: turn, distance_m: distance },
    confidence: 0.6,
    brief_reason: `I head ${turn === 0 ? 'straight' : `${turn > 0 ? 'right' : 'left'} ${Math.abs(turn)}°`} toward the clearest column for ${distance} m.`,
  };
}

function clampCount(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function situationPhrase(s: TerrainParams['survivor_situation']): string {
  if (s === 'ditch') return 'survivor in a ditch';
  if (s === 'slope') return 'survivor on a slope';
  if (s === 'obstacle') return 'survivor against an obstacle';
  return 'survivor seated by a log';
}

/** One-line confirmation of fields that moved. Used when Gemini is not called. */
function confirmTerrain(prev: TerrainParams, out: TerrainParams): string {
  const bits: string[] = [];
  if (Math.abs(out.light_level - prev.light_level) > 0.05) bits.push(describeLight(out.light_level));
  if (out.survivor_situation !== prev.survivor_situation) bits.push(situationPhrase(out.survivor_situation));
  if (out.car_count > prev.car_count) bits.push(out.car_count === 1 ? 'a car added' : 'cars added');
  else if (out.car_count < prev.car_count) bits.push('cars removed');
  const animals = out.fox_count + out.deer_count;
  const prevAnimals = prev.fox_count + prev.deer_count;
  if (animals > prevAnimals) bits.push('moving animals added');
  else if (animals < prevAnimals) bits.push('fewer animals');
  if (out.fog_density > prev.fog_density + 0.08) bits.push('thicker fog');
  else if (out.fog_density < prev.fog_density - 0.08) bits.push('clearer air');
  if (out.tree_density > prev.tree_density + 0.08) bits.push('denser trees');
  else if (out.tree_density < prev.tree_density - 0.08) bits.push('sparser trees');
  if (out.water !== prev.water) bits.push(out.water === 'none' ? 'no water' : `a ${out.water}`);
  if (!bits.length) bits.push('terrain unchanged');
  const line = bits.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Terrain mock: nudge supported params from keywords. Gemini is the real mapper. */
export function mockTerrain(prompt: string, current: TerrainParams = DEFAULT_TERRAIN_PARAMS): TerrainParams {
  const p = prompt.toLowerCase();
  const prev: TerrainParams = { ...current };
  const out: TerrainParams = { ...current };
  const bump = (k: keyof TerrainParams, d: number) => {
    const v = out[k];
    if (typeof v === 'number') (out as Record<string, unknown>)[k] = Math.max(0, Math.min(1, v + d));
  };
  if (/dense|thick|more trees|pines?/.test(p)) bump('tree_density', 0.3);
  if (/sparse|open|clearing|fewer trees/.test(p)) bump('tree_density', -0.3);
  if (/creek|stream|river/.test(p)) out.water = 'creek';
  if (/pond|lake/.test(p)) out.water = 'pond';
  if (/dry|no water/.test(p)) out.water = 'none';
  if (/heavy fog|thick fog|foggy/.test(p)) bump('fog_density', 0.3);
  else if (/light fog|thin fog/.test(p)) out.fog_density = 0.3;
  else if (/fog|mist|visibility/.test(p)) bump('fog_density', 0.2);
  if (/clear sky|no fog|clear air/.test(p)) out.fog_density = 0.05;
  if (/evening|dusk|sunset|twilight/.test(p)) {
    out.light_level = 0.42;
    out.moonlight = 0.35;
  } else if (/night|midnight|after dark|moonlit/.test(p)) {
    out.light_level = 0.08;
    out.moonlight = 0.7;
  } else if (/dawn|sunrise/.test(p)) {
    out.light_level = 0.3;
    out.moonlight = 0.25;
  } else if (/daytime|day time|\bday\b|noon|midday|sunny|sunlight|morning|afternoon/.test(p)) {
    out.light_level = 0.95;
    out.moonlight = 0.12;
  }
  if (/bright|full moon/.test(p)) bump('moonlight', 0.3);
  if (/new moon/.test(p)) bump('moonlight', -0.3);
  if (/logs?|deadfall|windfall/.test(p)) bump('fallen_logs', 0.3);
  if (/branch|maze|forks?|many trails/.test(p)) bump('branchiness', 0.3);
  if (/\bno cars\b|without cars|remove cars/.test(p)) out.car_count = 0;
  else if (/\bcars?\b|vehicles?|trucks?|automobiles?/.test(p)) out.car_count = clampCount(Math.max(2, out.car_count + 2), 4);
  if (/\bno animals\b|without animals|no wildlife/.test(p)) {
    out.fox_count = 0;
    out.deer_count = 0;
  } else if (/moving animals|animals|wildlife|creatures/.test(p)) {
    out.fox_count = clampCount(Math.max(2, out.fox_count), 4);
    out.deer_count = clampCount(Math.max(2, out.deer_count), 4);
  }
  const foxM = p.match(/(\d|no|two|one)\s+fox/);
  if (foxM) out.fox_count = foxM[1] === 'no' ? 0 : foxM[1] === 'two' ? 2 : foxM[1] === 'one' ? 1 : clampCount(Number(foxM[1]), 4);
  const deerM = p.match(/(\d|no|two|one)\s+deer/);
  if (deerM) out.deer_count = deerM[1] === 'no' ? 0 : deerM[1] === 'two' ? 2 : deerM[1] === 'one' ? 1 : clampCount(Number(deerM[1]), 4);
  if (/ditch|gully|ravine|trench/.test(p)) out.survivor_situation = 'ditch';
  else if (/obstacle|pinned|wedged|against a (rock|log|boulder)/.test(p)) out.survivor_situation = 'obstacle';
  else if (/on a slope|steep bank|hillside/.test(p)) out.survivor_situation = 'slope';
  else if (/seated|sitting|against a log/.test(p)) out.survivor_situation = 'seated';
  if (/fung|mushroom|glow/.test(p)) out.fungi_patches = Math.min(3, out.fungi_patches + 1);
  const seedM = p.match(/seed\s*(\d+)/);
  if (seedM) out.seed = Number(seedM[1]);
  out.narration = confirmTerrain(prev, out);
  return out;
}
