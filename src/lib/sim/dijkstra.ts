/**
 * P3 — Dijkstra over `safe` edges, cost = lengthM + hazardCost (plan §3b).
 * Used only for GOTO_NODE and EXTRACT; never to choose where to explore.
 */
import type { Vec2 } from '../geo';
import type { MapState, TopoEdge } from '../types';

export function edgeCost(e: TopoEdge): number {
  return e.lengthM + e.hazardCost;
}

/** Shortest path as node ids [from, ..., to], or null if unreachable. */
export function shortestPath(map: MapState, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const n of map.nodes) dist.set(n.id, Infinity);
  if (!dist.has(from) || !dist.has(to)) return null;
  dist.set(from, 0);

  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null || best === Infinity) break;
    if (u === to) break;
    visited.add(u);
    for (const e of map.edges) {
      if (!e.safe) continue;
      const v = e.from === u ? e.to : e.to === u ? e.from : null;
      if (!v || visited.has(v)) continue;
      const nd = best + edgeCost(e);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
      }
    }
  }
  if ((dist.get(to) ?? Infinity) === Infinity) return null;
  const path: string[] = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

/** Dijkstra to BASE from `current` (packet.mission.safe_return_path). */
export function safeReturnPath(map: MapState, current: string | null): string[] {
  if (!current) return [];
  return shortestPath(map, current, 'BASE') ?? [];
}

/** Concatenate the stored edge polylines along a node path (polyline reversed as needed). */
export function pathPolyline(map: MapState, nodeIds: string[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < nodeIds.length; i++) {
    const a = nodeIds[i - 1];
    const b = nodeIds[i];
    const e = map.edges.find((x) => x.safe && ((x.from === a && x.to === b) || (x.from === b && x.to === a)));
    if (!e) continue;
    const pts = e.from === a ? e.polyline : [...e.polyline].reverse();
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.05) out.push({ x: p.x, z: p.z });
    }
  }
  return out;
}
