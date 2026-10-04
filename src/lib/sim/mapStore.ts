/**
 * P3 — Gemini-authored map store (plan §3d). Pure functions over MapState so the
 * mission loop, the manual console and the replay player share one implementation.
 *
 * Nodes/edges/frontiers are stored exactly as Gemini declares them. The store only:
 *   - creates BASE at start,
 *   - assigns ids (N1.., E1.., F1..) and the pose of `node_here`,
 *   - closes an edge from the previous node using the polyline actually driven,
 *   - attaches Gemini's own evidence to the current node.
 * No local judgment of content.
 */
import { NODE_MERGE_RADIUS_M } from '../constants';
import { bearingDeg, distance, polylineLength, round, type Vec2 } from '../geo';
import type { Assessment, Decision, Frontier, MapState, MapUpdate, NodeKind, TopoEdge, TopoNode } from '../types';

export function createMapState(base: Vec2 = { x: 0, z: 0 }): MapState {
  return {
    nodes: [{ id: 'BASE', x: base.x, z: base.z, kind: 'BASE', visited: true, note: 'trailhead / deployment point' }],
    edges: [],
    frontiers: [],
    nextNodeIndex: 1,
    nextEdgeIndex: 1,
    nextFrontierIndex: 1,
  };
}

export function nodeById(map: MapState, id: string): TopoNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

export function nodeAt(map: MapState, p: Vec2, radius: number): TopoNode | undefined {
  let best: TopoNode | undefined;
  let bestD = radius;
  for (const n of map.nodes) {
    const d = distance(n, p);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function edgeBetween(map: MapState, a: string, b: string): TopoEdge | undefined {
  return map.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

export interface DeclareNodeArgs {
  pose: Vec2;
  kind: Exclude<NodeKind, 'BASE'>;
  note: string;
  /** Node the rover last departed from (edge origin). */
  prevNodeId: string | null;
  /** Positions actually driven since leaving prevNodeId (excluding the node itself). */
  trace: Vec2[];
  minClearanceM: number;
  annotation: MapUpdate['edge_annotation'];
}

/**
 * Declare `node_here`. If within NODE_MERGE_RADIUS_M of an existing node, that node is
 * updated instead (kind/note), and an edge is still closed if the rover arrived from a
 * different node without one. Returns the resulting node id.
 */
export function declareNode(map: MapState, a: DeclareNodeArgs): { map: MapState; nodeId: string; edgeId: string | null } {
  let nodes = map.nodes.slice();
  let edges = map.edges.slice();
  let nextNodeIndex = map.nextNodeIndex;
  let nextEdgeIndex = map.nextEdgeIndex;

  const existing = nodeAt(map, a.pose, NODE_MERGE_RADIUS_M);
  let nodeId: string;
  if (existing) {
    nodeId = existing.id;
    nodes = nodes.map((n) =>
      n.id === existing.id ? { ...n, kind: n.kind === 'BASE' ? 'BASE' : a.kind, note: a.note || n.note, visited: true } : n,
    );
  } else {
    nodeId = `N${nextNodeIndex++}`;
    nodes.push({ id: nodeId, x: round(a.pose.x, 2), z: round(a.pose.z, 2), kind: a.kind, visited: true, note: a.note });
  }

  let edgeId: string | null = null;
  const prev = a.prevNodeId ? nodeById(map, a.prevNodeId) : undefined;
  if (prev && prev.id !== nodeId && !edgeBetween(map, prev.id, nodeId)) {
    const target = nodes.find((n) => n.id === nodeId)!;
    const polyline = [{ x: prev.x, z: prev.z }, ...a.trace, { x: target.x, z: target.z }].filter(
      (p, i, arr) => i === 0 || distance(p, arr[i - 1]) > 0.05,
    );
    const lengthM = polylineLength(polyline);
    if (lengthM > 0.5) {
      edgeId = `E${nextEdgeIndex++}`;
      edges.push({
        id: edgeId,
        from: prev.id,
        to: nodeId,
        polyline: polyline.map((p) => ({ x: round(p.x, 2), z: round(p.z, 2) })),
        lengthM: round(lengthM),
        bearingDeg: Math.round(bearingDeg(prev, target)),
        minClearanceM: round(a.minClearanceM),
        safe: true,
        terrain: a.annotation?.terrain ?? 'FOREST',
        hazardCost: a.annotation?.hazard_cost ?? 0,
      });
    }
  } else if (prev && a.annotation) {
    // Re-annotate the existing edge the rover just drove.
    const e = edgeBetween(map, prev.id, nodeId);
    if (e) edges = edges.map((x) => (x.id === e.id ? { ...x, terrain: a.annotation!.terrain, hazardCost: a.annotation!.hazard_cost } : x));
  }

  return { map: { ...map, nodes, edges, nextNodeIndex, nextEdgeIndex }, nodeId, edgeId };
}

export function addFrontiers(map: MapState, fromNode: string, list: MapUpdate['new_frontiers']): MapState {
  if (list.length === 0) return map;
  let idx = map.nextFrontierIndex;
  const frontiers: Frontier[] = map.frontiers.slice();
  for (const f of list) {
    frontiers.push({
      id: `F${idx++}`,
      fromNode,
      bearingDeg: Math.round(((f.bearing_deg % 360) + 360) % 360),
      estimatedDistanceM: round(f.estimated_distance_m),
      geometry: f.geometry,
      status: 'UNEXPLORED',
      note: f.note,
    });
  }
  return { ...map, frontiers, nextFrontierIndex: idx };
}

export function updateFrontiers(map: MapState, updates: MapUpdate['frontier_updates']): MapState {
  if (updates.length === 0) return map;
  const byId = new Map(updates.map((u) => [u.id, u.status]));
  return { ...map, frontiers: map.frontiers.map((f) => (byId.has(f.id) ? { ...f, status: byId.get(f.id)! } : f)) };
}

/** Attach Gemini's own assessment/evidence to a node (plan §3d "Evidence"). */
export function attachEvidence(map: MapState, nodeId: string, assessment: Assessment, evidence: Decision['evidence']): MapState {
  return {
    ...map,
    nodes: map.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            lastAssessment: assessment,
            thermalScore: evidence.thermal,
            rgbPersonScore: evidence.rgb_person,
          }
        : n,
    ),
  };
}

export function markVisited(map: MapState, nodeId: string): MapState {
  return { ...map, nodes: map.nodes.map((n) => (n.id === nodeId ? { ...n, visited: true } : n)) };
}

export interface ApplyContext {
  pose: Vec2;
  prevNodeId: string | null;
  currentNodeId: string | null;
  trace: Vec2[];
  minClearanceM: number;
}

/** Apply `decision.map_update` (+ evidence). Returns the new map and the node the rover is now "at", if any. */
export function applyMapUpdate(
  map: MapState,
  decision: Decision,
  ctx: ApplyContext,
): { map: MapState; nodeHereId: string | null; edgeId: string | null } {
  let m = map;
  let nodeHereId: string | null = ctx.currentNodeId;
  let edgeId: string | null = null;
  const u = decision.map_update;

  if (u.node_here) {
    const r = declareNode(m, {
      pose: ctx.pose,
      kind: u.node_here.kind,
      note: u.node_here.note,
      prevNodeId: ctx.prevNodeId,
      trace: ctx.trace,
      minClearanceM: ctx.minClearanceM,
      annotation: u.edge_annotation,
    });
    m = r.map;
    nodeHereId = r.nodeId;
    edgeId = r.edgeId;
  } else if (u.edge_annotation && ctx.currentNodeId && ctx.prevNodeId && ctx.currentNodeId !== ctx.prevNodeId) {
    const e = edgeBetween(m, ctx.prevNodeId, ctx.currentNodeId);
    if (e) m = { ...m, edges: m.edges.map((x) => (x.id === e.id ? { ...x, terrain: u.edge_annotation!.terrain, hazardCost: u.edge_annotation!.hazard_cost } : x)) };
  }

  const frontierOrigin = nodeHereId ?? ctx.prevNodeId ?? 'BASE';
  m = addFrontiers(m, frontierOrigin, u.new_frontiers);
  m = updateFrontiers(m, u.frontier_updates);

  const evidenceNode = nodeHereId ?? ctx.currentNodeId;
  if (evidenceNode) m = attachEvidence(m, evidenceNode, decision.survivor_assessment, decision.evidence);

  return { map: m, nodeHereId, edgeId };
}
