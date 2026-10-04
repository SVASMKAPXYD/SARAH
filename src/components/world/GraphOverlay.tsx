'use client';
/**
 * P1/P4 — top-down SVG minimap of the map GEMINI authored (plan §2 "UI", §3d):
 * BASE + declared nodes, recorded edges, frontiers as arrows at their bearing, the current
 * safe return route highlighted, the rover with its 90° FOV wedge and the partial trace.
 * With `revealTruth` (after the mission ends) the true trails, water, survivor and animals
 * are drawn underneath so judges can compare Gemini's map with the world.
 *
 * Draws in world units via the SVG viewBox (x east → right, z south → down, north up).
 */
import { useMemo } from 'react';
import { CAMERA_HFOV_DEG, WORLD_HALF_SIZE_M } from '@/lib/constants';
import { dirFromBearing } from '@/lib/geo';
import type { Frontier, NodeKind, TopoNode } from '@/lib/types';
import { useMissionStore, useUIStore } from '@/store/missionStore';

const NODE_COLOR: Record<NodeKind, string> = {
  BASE: '#ffb347',
  JUNCTION: '#8ecae6',
  VIEWPOINT: '#c7d2fe',
  DEAD_END: '#f87171',
  EVIDENCE: '#fbbf24',
  SURVIVOR: '#4ade80',
};
const FRONTIER_COLOR: Record<Frontier['status'], string> = { UNEXPLORED: '#f59e0b', TRAVERSED: '#6b7280', BLOCKED: '#ef4444' };

export default function GraphOverlay({ size = 260, className = '' }: { size?: number; className?: string }) {
  const map = useMissionStore((s) => s.map);
  const rover = useMissionStore((s) => s.rover);
  const trace = useMissionStore((s) => s.trace);
  const lastNodeId = useMissionStore((s) => s.lastNodeId);
  const returnRoute = useMissionStore((s) => s.returnRoute);
  const markPosition = useMissionStore((s) => s.markPosition);
  const world = useMissionStore((s) => s.world);
  const animals = useMissionStore((s) => s.animals);
  const revealTruth = useUIStore((s) => s.revealTruth);

  // Fit BASE + nodes + rover (+ truth when revealed), min 50 m window.
  const view = useMemo(() => {
    const pts: { x: number; z: number }[] = [...map.nodes, { x: rover.x, z: rover.z }];
    if (revealTruth && world) pts.push(world.truth.survivor);
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const margin = 14;
    const span = Math.max(50, maxX - minX + margin * 2, maxZ - minZ + margin * 2);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return { x: cx - span / 2, z: cz - span / 2, span };
  }, [map.nodes, rover.x, rover.z, revealTruth, world]);

  const nodeById = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const routeEdges = useMemo(() => {
    const set = new Set<string>();
    for (let i = 1; i < returnRoute.length; i++) set.add(`${returnRoute[i - 1]}|${returnRoute[i]}`);
    return set;
  }, [returnRoute]);

  const u = view.span / size; // world meters per CSS px
  const fs = 11 * u;
  const r = 1.6 * u;
  const fovHalf = (CAMERA_HFOV_DEG / 2) * (Math.PI / 180);
  const headRad = rover.headingDeg * (Math.PI / 180);
  const wedgeR = 12;
  const wl = { x: rover.x + Math.sin(headRad - fovHalf) * wedgeR, z: rover.z - Math.cos(headRad - fovHalf) * wedgeR };
  const wr = { x: rover.x + Math.sin(headRad + fovHalf) * wedgeR, z: rover.z - Math.cos(headRad + fovHalf) * wedgeR };
  const fwd = dirFromBearing(rover.headingDeg);
  const half = WORLD_HALF_SIZE_M;

  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/85 shadow-lg backdrop-blur ${className}`} style={{ width: size }}>
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
        <span>Gemini&apos;s map</span>
        <span className="font-mono normal-case">
          {map.nodes.length} nodes · {map.edges.length} edges · {map.frontiers.filter((f) => f.status === 'UNEXPLORED').length} open
        </span>
      </div>
      <svg width={size} height={size} viewBox={`${view.x} ${view.z} ${view.span} ${view.span}`} className="block">
        {/* world bounds */}
        <rect x={-half} y={-half} width={half * 2} height={half * 2} fill="none" stroke="#27272a" strokeWidth={0.6 * u} />
        <GridLines view={view} u={u} />

        {revealTruth && world && (
          <g opacity={0.9}>
            {world.water?.kind === 'creek' && (
              <polyline points={world.water.polyline.map((p) => `${p.x},${p.z}`).join(' ')} fill="none" stroke="#1d4ed8" strokeWidth={world.water.widthM} strokeOpacity={0.6} strokeLinejoin="round" />
            )}
            {world.water?.kind === 'pond' && <circle cx={world.water.x} cy={world.water.z} r={world.water.r} fill="#1d4ed8" fillOpacity={0.5} />}
            {world.truth.trails.map((t, i) => (
              <polyline key={i} points={t.map((p) => `${p.x},${p.z}`).join(' ')} fill="none" stroke="#3f6212" strokeWidth={2.4} strokeOpacity={0.7} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {animals.map((a) => (
              <circle key={a.id} cx={a.x} cy={a.z} r={a.kind === 'deer' ? 1.3 : 0.9} fill={a.kind === 'deer' ? '#a16207' : '#ea580c'} stroke="#000" strokeWidth={0.3} />
            ))}
            <g transform={`translate(${world.truth.survivor.x} ${world.truth.survivor.z})`}>
              <circle r={3} fill="none" stroke="#4ade80" strokeWidth={0.5} strokeDasharray={`${1.2} ${1}`} />
              <circle r={1.2} fill="#4ade80" stroke="#052e16" strokeWidth={0.3} />
              <text y={-4} textAnchor="middle" fontSize={fs} fill="#86efac">
                survivor
              </text>
            </g>
          </g>
        )}

        {/* edges */}
        {map.edges.map((e) => {
          const onRoute = routeEdges.has(`${e.from}|${e.to}`) || routeEdges.has(`${e.to}|${e.from}`);
          return (
            <polyline
              key={e.id}
              points={e.polyline.map((p) => `${p.x},${p.z}`).join(' ')}
              fill="none"
              stroke={onRoute ? '#22d3ee' : e.safe ? '#a1a1aa' : '#7f1d1d'}
              strokeWidth={(onRoute ? 2.2 : 1.2) * u}
              strokeOpacity={onRoute ? 1 : 0.8}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* current partial trace */}
        {trace.length > 0 && (
          <polyline
            points={[nodeById.get(lastNodeId) ?? trace[0], ...trace, { x: rover.x, z: rover.z }].map((p) => `${p.x},${p.z}`).join(' ')}
            fill="none"
            stroke="#e4e4e7"
            strokeWidth={1 * u}
            strokeDasharray={`${1.5 * u} ${1.5 * u}`}
            strokeOpacity={0.7}
          />
        )}

        {/* frontiers */}
        {map.frontiers.map((f) => {
          const n = nodeById.get(f.fromNode);
          if (!n) return null;
          const d = dirFromBearing(f.bearingDeg);
          const len = Math.min(18, Math.max(5, f.estimatedDistanceM * 0.6));
          const tip = { x: n.x + d.x * len, z: n.z + d.z * len };
          const color = FRONTIER_COLOR[f.status];
          const left = dirFromBearing(f.bearingDeg + 150);
          const right = dirFromBearing(f.bearingDeg - 150);
          const ah = 2.2 * u;
          return (
            <g key={f.id} opacity={f.status === 'UNEXPLORED' ? 1 : 0.55}>
              <line x1={n.x} y1={n.z} x2={tip.x} y2={tip.z} stroke={color} strokeWidth={1 * u} strokeDasharray={f.status === 'TRAVERSED' ? `${1.2 * u} ${1.2 * u}` : undefined} />
              <polygon points={`${tip.x},${tip.z} ${tip.x + left.x * ah},${tip.z + left.z * ah} ${tip.x + right.x * ah},${tip.z + right.z * ah}`} fill={color} />
              <text x={tip.x + d.x * 2 * u} y={tip.z + d.z * 2 * u} fontSize={fs * 0.85} fill={color} textAnchor="middle" dominantBaseline="middle">
                {f.id}
              </text>
            </g>
          );
        })}

        {/* nodes */}
        {map.nodes.map((n) => (
          <NodeGlyph key={n.id} n={n} r={r} fs={fs} highlight={returnRoute.includes(n.id)} />
        ))}

        {/* mark */}
        {markPosition && (
          <g transform={`translate(${markPosition.x} ${markPosition.z})`} stroke="#4ade80" strokeWidth={0.8 * u}>
            <line x1={-2.2 * u} y1={-2.2 * u} x2={2.2 * u} y2={2.2 * u} />
            <line x1={-2.2 * u} y1={2.2 * u} x2={2.2 * u} y2={-2.2 * u} />
          </g>
        )}

        {/* rover + FOV wedge */}
        <polygon points={`${rover.x},${rover.z} ${wl.x},${wl.z} ${wr.x},${wr.z}`} fill="#fde68a" fillOpacity={0.12} stroke="#fde68a" strokeOpacity={0.35} strokeWidth={0.4 * u} />
        <polygon
          points={[
            { x: rover.x + fwd.x * 2.6 * u, z: rover.z + fwd.z * 2.6 * u },
            { x: rover.x + dirFromBearing(rover.headingDeg + 140).x * 2.2 * u, z: rover.z + dirFromBearing(rover.headingDeg + 140).z * 2.2 * u },
            { x: rover.x + dirFromBearing(rover.headingDeg - 140).x * 2.2 * u, z: rover.z + dirFromBearing(rover.headingDeg - 140).z * 2.2 * u },
          ]
            .map((p) => `${p.x},${p.z}`)
            .join(' ')}
          fill="#fef3c7"
          stroke="#111827"
          strokeWidth={0.4 * u}
        />
      </svg>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-2 pb-1.5 text-[9px] text-zinc-500">
        <Legend color="#ffb347" label="base" />
        <Legend color="#8ecae6" label="junction" />
        <Legend color="#c7d2fe" label="viewpoint" />
        <Legend color="#f87171" label="dead end" />
        <Legend color="#f59e0b" label="frontier" />
        <Legend color="#22d3ee" label="return route" />
      </div>
    </div>
  );
}

function NodeGlyph({ n, r, fs, highlight }: { n: TopoNode; r: number; fs: number; highlight: boolean }) {
  const color = NODE_COLOR[n.kind];
  return (
    <g transform={`translate(${n.x} ${n.z})`}>
      {highlight && <circle r={r * 1.9} fill="none" stroke="#22d3ee" strokeWidth={r * 0.25} strokeOpacity={0.8} />}
      <circle r={n.kind === 'BASE' ? r * 1.4 : r} fill={color} stroke="#09090b" strokeWidth={r * 0.25} opacity={n.visited ? 1 : 0.6} />
      <text y={-r * 1.6} textAnchor="middle" fontSize={fs} fill={color} style={{ paintOrder: 'stroke' }} stroke="#09090b" strokeWidth={fs * 0.18}>
        {n.id}
      </text>
    </g>
  );
}

function GridLines({ view, u }: { view: { x: number; z: number; span: number }; u: number }) {
  const step = view.span > 120 ? 40 : view.span > 60 ? 20 : 10;
  const lines: number[] = [];
  const start = Math.floor(view.x / step) * step;
  for (let v = start; v <= view.x + view.span; v += step) lines.push(v);
  const startZ = Math.floor(view.z / step) * step;
  const zl: number[] = [];
  for (let v = startZ; v <= view.z + view.span; v += step) zl.push(v);
  return (
    <g stroke="#1f1f23" strokeWidth={0.5 * u}>
      {lines.map((x) => (
        <line key={`x${x}`} x1={x} y1={view.z} x2={x} y2={view.z + view.span} />
      ))}
      {zl.map((z) => (
        <line key={`z${z}`} x1={view.x} y1={z} x2={view.x + view.span} y2={z} />
      ))}
    </g>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
