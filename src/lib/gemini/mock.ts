/**
 * P2 — deterministic mock decider. Produces a valid Decision from the packet ALONE
 * (it never sees ground truth) so the P1/P3/P4 loop runs without a Gemini key.
 *
 * Behaviour: steer toward the clearest LiDAR column, declare a VIEWPOINT every few
 * steps (DEAD_END when blocked), add a frontier for other open columns, occasionally
 * GOTO_NODE to exercise path following. It never marks a survivor, so a mock mission
 * ends by budget exhaustion — that is expected; use the manual console for MARK_SURVIVOR.
 * Once the packet reports phase RESCUE (after a manual mark) it issues RETURN_TO_BASE.
 */
import { LIDAR_COLUMN_KEYS, LIDAR_MAX_M, MAX_MOVE_M } from '../constants';
import { normDeg } from '../geo';
import type { Decision, LidarColumnKey, ObservationPacket, TerrainParams } from '../types';
import { DEFAULT_TERRAIN_PARAMS } from './schema';

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

  // After an accepted MARK_SURVIVOR (packet says phase RESCUE/EXTRACT) the only sensible
  // move is extraction. Still packet-only: the mock reads the phase, not ground truth.
  if (packet.mission.phase === 'RESCUE' || packet.mission.phase === 'EXTRACT') {
    return {
      observations: 'Mock: survivor marked; extracting along the mapped route.',
      map_update: { node_here: null, new_frontiers: [], frontier_updates: [], edge_annotation: null },
      survivor_assessment: packet.mission.previous_assessment,
      evidence: { thermal: 1, rgb_person: 1, bearing_deg: 0 },
      intent: 'RETURN_TO_BASE',
      action: { type: 'RETURN_TO_BASE' },
      confidence: 0.9,
      brief_reason: 'The survivor is marked, so I return to base along the edges I have driven.',
    };
  }

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

  // Occasionally backtrack to a known node (exercises GOTO_NODE + Dijkstra).
  const otherNodes = nodes.filter((n) => n.id !== packet.pose.at_node && n.distance_m > 3);
  if (step > 0 && step % 9 === 0 && otherNodes.length > 0 && !blocked) {
    const target = otherNodes[(step / 9) % otherNodes.length];
    return {
      observations: `Mock: all nearby columns read ${Math.round(best.s)} m or less; revisiting ${target.id} for a second look.`,
      map_update: { node_here: null, new_frontiers: [], frontier_updates: [], edge_annotation: null },
      survivor_assessment: 'NO_EVIDENCE',
      evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
      intent: 'FOLLOW_KNOWN_ROUTE',
      action: { type: 'GOTO_NODE', node_id: target.id },
      confidence: 0.5,
      brief_reason: `I am backtracking to ${target.id} along edges I have already driven.`,
    };
  }

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

/** Terrain mock: nudge defaults from keywords. */
export function mockTerrain(prompt: string, current: TerrainParams = DEFAULT_TERRAIN_PARAMS): TerrainParams {
  const p = prompt.toLowerCase();
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
  else if (/fog|mist/.test(p)) bump('fog_density', 0.2);
  if (/clear sky|no fog/.test(p)) out.fog_density = 0.05;
  if (/bright|full moon/.test(p)) bump('moonlight', 0.3);
  if (/dark|new moon|overcast/.test(p)) bump('moonlight', -0.3);
  if (/steep|hill|slope|ridge/.test(p)) bump('slope', 0.3);
  if (/flat/.test(p)) out.slope = 0.05;
  if (/logs?|deadfall|windfall/.test(p)) bump('fallen_logs', 0.3);
  if (/branch|maze|forks?|many trails/.test(p)) bump('branchiness', 0.3);
  const foxM = p.match(/(\d|no|two|one)\s+fox/);
  if (foxM) out.fox_count = foxM[1] === 'no' ? 0 : foxM[1] === 'two' ? 2 : foxM[1] === 'one' ? 1 : Math.min(2, Number(foxM[1]));
  const deerM = p.match(/(\d|no|two|one)\s+deer/);
  if (deerM) out.deer_count = deerM[1] === 'no' ? 0 : deerM[1] === 'two' ? 2 : deerM[1] === 'one' ? 1 : Math.min(2, Number(deerM[1]));
  if (/fung|mushroom|glow/.test(p)) out.fungi_patches = Math.min(3, out.fungi_patches + 1);
  const seedM = p.match(/seed\s*(\d+)/);
  if (seedM) out.seed = Number(seedM[1]);
  out.narration = `Mock terrain: ${prompt.trim() || 'defaults'} → trees ${out.tree_density.toFixed(1)}, ${out.water}, fog ${out.fog_density.toFixed(1)}, ${out.fox_count} fox, ${out.deer_count} deer, ${out.fungi_patches} fungi.`;
  return out;
}
