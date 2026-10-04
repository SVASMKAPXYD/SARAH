'use client';
/**
 * P4 — rover camera panel: the clean RGB / thermal frame from the SensorRig (plan §2 "UI"),
 * thermal/light toggle, swap-with-main button, and a toggle to preview the exact overlay
 * image Gemini receives.
 */
/* eslint-disable @next/next/no-img-element */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useMissionStore, useUIStore } from '@/store/missionStore';

export default function RoverPanel({ variant, className = '' }: { variant: 'main' | 'mini'; className?: string }) {
  const frame = useMissionStore((s) => s.frame);
  const thermal = useUIStore((s) => s.thermal);
  const setThermal = useUIStore((s) => s.setThermal);
  const swapViews = useUIStore((s) => s.swapViews);
  const showGemini = useUIStore((s) => s.showGeminiOverlay);
  const setShowGemini = useUIStore((s) => s.setShowGeminiOverlay);

  const src = frame
    ? showGemini
      ? `data:image/jpeg;base64,${thermal ? frame.thermalGeminiB64 : frame.rgbGeminiB64}`
      : thermal
        ? frame.thermalUrl
        : frame.rgbUrl
    : null;

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-zinc-700/80 bg-black ${className}`}>
      <div className="relative flex-1 min-h-0 bg-black">
        {src ? (
          <img src={src} alt={thermal ? 'thermal camera' : 'rgb camera'} className="h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-zinc-600">no frame yet</div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5">
          <Badge tone={thermal ? 'red' : 'blue'}>{thermal ? 'THERMAL' : 'RGB'}</Badge>
          {frame && <span className="font-mono text-[10px] text-zinc-300/80">#{frame.seq}</span>}
          {showGemini && <Badge tone="violet">gemini view</Badge>}
        </div>
      </div>
      <div className={`flex items-center gap-1 border-t border-zinc-800 bg-zinc-900/90 ${variant === 'main' ? 'px-3 py-1.5' : 'px-1.5 py-1'}`}>
        <Button size="sm" variant={thermal ? 'primary' : 'secondary'} onClick={() => setThermal(!thermal)} title="Toggle thermal / headlamp view">
          {thermal ? 'Thermal' : 'Light'}
        </Button>
        <Button size="sm" variant={showGemini ? 'primary' : 'ghost'} onClick={() => setShowGemini(!showGemini)} title="Show the overlay image Gemini receives">
          Grid
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={swapViews} title="Swap with the main view">
          {variant === 'main' ? '⇄ 3D' : '⇄ Main'}
        </Button>
      </div>
    </div>
  );
}
