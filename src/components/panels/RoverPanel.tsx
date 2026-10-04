'use client';
/**
 * P4 — rover camera panel: cycles through clean aligned RGB, thermal, and depth captures.
 */
/* eslint-disable @next/next/no-img-element */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useMissionStore, useUIStore } from '@/store/missionStore';

export default function RoverPanel({ variant, className = '' }: { variant: 'main' | 'mini'; className?: string }) {
  const frame = useMissionStore((s) => s.frame);
  const sensorView = useUIStore((s) => s.sensorView);
  const cycleSensorView = useUIStore((s) => s.cycleSensorView);
  const swapViews = useUIStore((s) => s.swapViews);
  const src = frame ? frame[`${sensorView}Url`] : null;
  const label = sensorView === 'rgb' ? 'Visible-light RGB' : sensorView === 'thermal' ? 'Thermal' : 'LiDAR depth';

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-zinc-700/80 bg-black ${className}`}>
      <div className="relative flex-1 min-h-0 bg-black">
        {src ? (
          <img src={src} alt={`${label} sensor frame`} className="h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-zinc-600">no frame yet</div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5">
          <Badge tone={sensorView === 'thermal' ? 'red' : sensorView === 'depth' ? 'violet' : 'blue'}>{sensorView === 'rgb' ? 'RGB' : sensorView === 'thermal' ? 'THERMAL' : 'DEPTH'}</Badge>
          {frame && <span className="font-mono text-[10px] text-zinc-300/80">#{frame.seq}</span>}
        </div>
      </div>
      <div className={`flex items-center gap-1 border-t border-zinc-800 bg-zinc-900/90 ${variant === 'main' ? 'px-3 py-1.5' : 'px-1.5 py-1'}`}>
        <Button size="sm" variant="secondary" onClick={cycleSensorView} title={`Cycle sensor view (currently ${label})`}>
          Next: {sensorView === 'rgb' ? 'Thermal' : sensorView === 'thermal' ? 'Depth' : 'Light'}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={swapViews} title="Swap with the main view">
          {variant === 'main' ? '⇄ 3D' : '⇄ Main'}
        </Button>
      </div>
    </div>
  );
}
