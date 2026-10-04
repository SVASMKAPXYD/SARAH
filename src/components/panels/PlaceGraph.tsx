'use client';
/**
 * Topological place graph for the thought panel. Reads the same MapState the
 * mission loop and GraphOverlay use (nodes, frontiers, driven edges). No second map.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { dirFromBearing } from '@/lib/geo';
import type { Frontier, NodeKind, TopoNode } from '@/lib/types';
import { useMissionStore } from '@/store/missionStore';

const NODE_FILL: Record<NodeKind, string> = {
  BASE: '#c2410c',
  JUNCTION: '#0369a1',
  VIEWPOINT: '#4338ca',
  DEAD_END: '#be123c',
  EVIDENCE: '#a16207',
  SURVIVOR: '#15803d',
};

const FRONTIER_STROKE: Record<Frontier['status'], string> = {
  UNEXPLORED: '#c2410c',
  TRAVERSED: '#64748b',
  BLOCKED: '#be123c',
};

export default function PlaceGraph({ hud = false }: { hud?: boolean }) {
  const map = useMissionStore((s) => s.map);
  const frame = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState({ w: 280, h: 200 });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) setPx({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeById = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);

  const layout = useMemo(() => {
    if (map.nodes.length === 0) return null;
    const tips = frontierTips(map.frontiers, nodeById);
    const pts = [...map.nodes.map((n) => ({ x: n.x, z: n.z })), ...tips.map((t) => t.tip), ...map.edges.flatMap((e) => e.polyline)];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const contentW = Math.max(28, maxX - minX);
    const contentH = Math.max(28, maxZ - minZ);
    const contentSpan = Math.max(contentW, contentH);
    const shortPx = Math.max(1, Math.min(px.w, px.h));
    const u = contentSpan / (shortPx * 0.62);
    const worldW = u * px.w;
    const worldH = u * px.h;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return {
      tips,
      u,
      view: { x: cx - worldW / 2, z: cz - worldH / 2, w: worldW, h: worldH },
    };
  }, [map.nodes, map.edges, map.frontiers, nodeById, px.w, px.h]);

  const open = map.frontiers.filter((f) => f.status === 'UNEXPLORED').length;
  const summary = `${map.nodes.length} ${map.nodes.length === 1 ? 'node' : 'nodes'} · ${map.edges.length} driven ${map.edges.length === 1 ? 'edge' : 'edges'} · ${open} open ${open === 1 ? 'frontier' : 'frontiers'}`;

  if (!layout) {
    return (
      <p className={`grid h-full place-items-center px-4 text-center text-sm ${hud ? 'text-cyan-100/55' : 'text-slate-500'}`}>
        The place graph is empty. Nodes, frontiers, and driven edges show up here as the rover maps.
      </p>
    );
  }

  const { u, view, tips } = layout;
  const fs = 12 * u;
  const r = 8 * u;
  const edgeStroke = hud ? '#67e8f9' : '#1e293b';
  const labelFill = hud ? '#ecfeff' : '#0f172a';
  const labelStroke = hud ? '#082f49' : '#eef6fc';
  const muted = hud ? 'text-cyan-100/65' : 'text-slate-600';

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <p className={`truncate px-2 text-center font-mono text-[10px] leading-4 ${muted}`} title={summary}>
        {summary}
      </p>
      <div className="relative min-h-0">
        <div ref={frame} className="absolute inset-0">
        <svg
          width="100%"
          height="100%"
          viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`}
          role="img"
          aria-label={`Place graph, ${map.nodes.length} nodes, ${map.edges.length} driven edges, ${map.frontiers.length} frontiers`}
          className={`block h-full w-full ${hud ? 'drop-shadow-[0_0_5px_rgba(34,211,238,0.45)]' : ''}`}
        >
          {map.edges.map((e) => {
            const points =
              e.polyline.length >= 2
                ? e.polyline
                : [nodeById.get(e.from), nodeById.get(e.to)].filter((p): p is TopoNode => Boolean(p));
            if (points.length < 2) return null;
            return (
              <polyline
                key={e.id}
                points={points.map((p) => `${p.x},${p.z}`).join(' ')}
                fill="none"
                stroke={e.safe ? edgeStroke : hud ? '#fb7185' : '#9f1239'}
                strokeWidth={2.25 * u}
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                <title>
                  {e.id} · {e.from} to {e.to}
                </title>
              </polyline>
            );
          })}

          {tips.map((f) => {
            const color = hud
              ? f.status === 'UNEXPLORED' ? '#fbbf24' : f.status === 'TRAVERSED' ? '#67e8f9' : '#fb7185'
              : FRONTIER_STROKE[f.status];
            const ah = 4.2 * u;
            const left = dirFromBearing(f.bearingDeg + 152);
            const right = dirFromBearing(f.bearingDeg - 152);
            return (
              <g key={f.id} opacity={f.status === 'UNEXPLORED' ? 1 : 0.72}>
                <line
                  x1={f.from.x}
                  y1={f.from.z}
                  x2={f.tip.x}
                  y2={f.tip.z}
                  stroke={color}
                  strokeWidth={1.6 * u}
                  strokeDasharray={`${3.2 * u} ${2.2 * u}`}
                />
                <polygon
                  points={`${f.tip.x},${f.tip.z} ${f.tip.x + left.x * ah},${f.tip.z + left.z * ah} ${f.tip.x + right.x * ah},${f.tip.z + right.z * ah}`}
                  fill={color}
                />
                <text
                  x={f.tip.x + f.dir.x * 14 * u}
                  y={f.tip.z + f.dir.z * 14 * u}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fs * 0.85}
                  fill={color}
                  stroke={labelStroke}
                  strokeWidth={fs * 0.28}
                  style={{ paintOrder: 'stroke' }}
                >
                  {f.id}
                </text>
              </g>
            );
          })}

          {map.nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x} ${n.z})`}>
              <title>
                {n.id} · {n.kind}
                {n.note ? ` · ${n.note}` : ''}
              </title>
              {n.kind === 'BASE' ? (
                <rect x={-r * 1.15} y={-r * 1.15} width={r * 2.3} height={r * 2.3} rx={r * 0.35} fill={NODE_FILL.BASE} stroke="#fff7ed" strokeWidth={r * 0.22} />
              ) : (
                <circle r={r} fill={NODE_FILL[n.kind]} stroke="#f8fafc" strokeWidth={r * 0.22} />
              )}
              <text
                y={-r * 1.85}
                textAnchor="middle"
                fontSize={fs}
                fontWeight={600}
                fill={labelFill}
                stroke={labelStroke}
                strokeWidth={fs * 0.28}
                style={{ paintOrder: 'stroke' }}
              >
                {n.id}
              </text>
            </g>
          ))}
        </svg>
        </div>
      </div>
      <div className={`flex items-center justify-center gap-2 whitespace-nowrap px-1 pb-1 text-[10px] leading-4 ${muted}`}>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#c2410c]" />
          node
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0 w-3 border-t border-dashed border-[#c2410c]" />
          frontier
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-0.5 w-3 ${hud ? 'bg-cyan-300' : 'bg-slate-800'}`} />
          driven edge
        </span>
      </div>
    </div>
  );
}

function frontierTips(frontiers: Frontier[], nodeById: Map<string, TopoNode>) {
  return frontiers.flatMap((f) => {
    const from = nodeById.get(f.fromNode);
    if (!from) return [];
    const d = dirFromBearing(f.bearingDeg);
    const len = Math.min(16, Math.max(7, f.estimatedDistanceM * 0.4));
    const tip = { x: from.x + d.x * len, z: from.z + d.z * len };
    return [{ ...f, from, tip, dir: d }];
  });
}
