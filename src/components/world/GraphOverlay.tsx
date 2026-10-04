'use client';

import { useMemo } from 'react';
import { WORLD_HALF_SIZE_M } from '@/lib/constants';
import { useMissionStore, useUIStore } from '@/store/missionStore';

export default function GraphOverlay({ size = 260, className = '' }: { size?: number; className?: string }) {
  const rover = useMissionStore((state) => state.rover);
  const drivenPath = useMissionStore((state) => state.drivenPath);
  const markPosition = useMissionStore((state) => state.markPosition);
  const world = useMissionStore((state) => state.world);
  const revealTruth = useUIStore((state) => state.revealTruth);

  const view = useMemo(() => {
    const points = [...drivenPath, { x: rover.x, z: rover.z }];
    if (world) points.push(world.truth.survivor);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const span = Math.max(50, maxX - minX + 28, maxZ - minZ + 28);
    return { x: (minX + maxX - span) / 2, z: (minZ + maxZ - span) / 2, span };
  }, [drivenPath, rover.x, rover.z, world]);

  const u = view.span / size;
  const half = WORLD_HALF_SIZE_M;
  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/85 shadow-lg backdrop-blur ${className}`} style={{ width: size }}>
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
        <span>Operator map</span>
        <span className="font-mono normal-case">{drivenPath.length} path points</span>
      </div>
      <svg width={size} height={size} viewBox={`${view.x} ${view.z} ${view.span} ${view.span}`} className="block">
        <rect x={-half} y={-half} width={half * 2} height={half * 2} fill="none" stroke="#27272a" strokeWidth={0.6 * u} />
        <GridLines view={view} u={u} />
        {revealTruth && world && (
          <g opacity={0.85}>
            {world.water?.kind === 'creek' && (
              <polyline points={world.water.polyline.map((point) => `${point.x},${point.z}`).join(' ')} fill="none" stroke="#1d4ed8" strokeWidth={world.water.widthM} strokeOpacity={0.6} strokeLinejoin="round" />
            )}
            {world.water?.kind === 'pond' && <circle cx={world.water.x} cy={world.water.z} r={world.water.r} fill="#1d4ed8" fillOpacity={0.5} />}
            {world.truth.trails.map((trail, index) => (
              <polyline key={index} points={trail.map((point) => `${point.x},${point.z}`).join(' ')} fill="none" stroke="#3f6212" strokeWidth={2.4} strokeOpacity={0.7} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
        )}
        {world && (
          <g transform={`translate(${world.truth.survivor.x} ${world.truth.survivor.z})`}>
            <title>Hiker location</title>
            <circle className="survivor-ping" r={2.4 * u} fill="none" stroke="#ef4444" strokeWidth={0.7 * u} />
            <circle className="survivor-ping survivor-ping-delayed" r={2.4 * u} fill="none" stroke="#ef4444" strokeWidth={0.7 * u} />
            <circle r={1.4} fill="#ef4444" stroke="#450a0a" strokeWidth={0.4} />
          </g>
        )}
        {drivenPath.length > 1 && (
          <polyline points={drivenPath.map((point) => `${point.x},${point.z}`).join(' ')} fill="none" stroke="#e4e4e7" strokeWidth={Math.max(0.12, 0.8 * u)} strokeLinejoin="round" strokeLinecap="round" />
        )}
        <circle cx={0} cy={0} r={1.3} fill="#ffb347" stroke="#111827" strokeWidth={0.4 * u} />
        {markPosition && (
          <g transform={`translate(${markPosition.x} ${markPosition.z})`} stroke="#4ade80" strokeWidth={0.8 * u}>
            <line x1={-2.2 * u} y1={-2.2 * u} x2={2.2 * u} y2={2.2 * u} />
            <line x1={-2.2 * u} y1={2.2 * u} x2={2.2 * u} y2={-2.2 * u} />
          </g>
        )}
        <g transform={`translate(${rover.x} ${rover.z}) rotate(${rover.headingDeg})`}>
          <circle r={1.3} fill="#f8fafc" stroke="#020617" strokeWidth={0.4 * u} />
          <path d="M0,-2.2 L1.1,1.4 L0,0.8 L-1.1,1.4 Z" fill="#f8fafc" />
        </g>
      </svg>
    </div>
  );
}

function GridLines({ view, u }: { view: { x: number; z: number; span: number }; u: number }) {
  const step = view.span > 120 ? 20 : 10;
  const x0 = Math.ceil(view.x / step) * step;
  const z0 = Math.ceil(view.z / step) * step;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let x = x0; x <= view.x + view.span; x += step) xs.push(x);
  for (let z = z0; z <= view.z + view.span; z += step) zs.push(z);
  return (
    <g stroke="#27272a" strokeWidth={0.35 * u}>
      {xs.map((x) => <line key={`x${x}`} x1={x} y1={view.z} x2={x} y2={view.z + view.span} />)}
      {zs.map((z) => <line key={`z${z}`} x1={view.x} y1={z} x2={view.x + view.span} y2={z} />)}
    </g>
  );
}
