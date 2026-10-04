'use client';
/**
 * Immersive third-person view is the default; the layout control restores the
 * classic map/POV split while preserving the same mission tools and camera state.
 */
import { useRef, useState, type ReactNode, type PointerEvent } from 'react';
import AgentPanel from '@/components/panels/AgentPanel';
import Controls from '@/components/panels/Controls';
import ManualConsole from '@/components/panels/ManualConsole';
import MetricsStrip from '@/components/panels/MetricsStrip';
import ResultCard from '@/components/panels/ResultCard';
import TerrainChat from '@/components/panels/TerrainChat';
import ThoughtPanel from '@/components/panels/ThoughtPanel';
import GraphOverlay from '@/components/world/GraphOverlay';
import MapView from '@/components/world/MapView';
import PovView, { type PovPerson } from '@/components/world/PovView';
import { useMission } from '@/hooks/useMission';
import { useMissionStore, useUIStore } from '@/store/missionStore';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <Icon>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}
function ResetIcon() {
  return (
    <Icon>
      <path d="M4 12h9" />
      <path d="M8 8 4 12l4 4" />
      <circle cx="18" cy="12" r="2.4" />
    </Icon>
  );
}
function RunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <Icon>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.2" />
    </Icon>
  );
}
function ThermoIcon() {
  return (
    <Icon>
      <path d="M10 14.2V6a2 2 0 1 1 4 0v8.2" />
      <circle cx="12" cy="17" r="2.6" />
      <path d="M12 10.5v4" />
    </Icon>
  );
}
function DepthIcon() {
  return (
    <Icon>
      <path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3z" />
      <path d="m4.5 7 7.5 4 7.5-4M12 11v10" />
    </Icon>
  );
}
function FirstPersonIcon() {
  return (
    <Icon>
      <path d="M12 3v4" />
      <path d="M7 8.5 4 6" />
      <path d="m17 8.5 3-2.5" />
      <path d="M5 20c.8-4.1 3.1-6.2 7-6.2s6.2 2.1 7 6.2" />
      <circle cx="12" cy="10" r="3.3" />
    </Icon>
  );
}
function ThirdPersonIcon() {
  return (
    <Icon>
      <rect x="5" y="7" width="14" height="12" rx="2" />
      <path d="M9 7V4h6v3" />
      <circle cx="12" cy="13" r="3" />
    </Icon>
  );
}
function LayoutIcon({ immersive }: { immersive: boolean }) {
  return (
    <Icon>
      {immersive ? (
        <>
          <path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" />
          <path d="M9 9h6v6H9z" />
        </>
      ) : (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path d="M9 4.5v15M9 12h11.5" />
        </>
      )}
    </Icon>
  );
}

function ViewModeButtons({
  person,
  sensorView,
  cycleSensorView,
  setPerson,
}: {
  person: PovPerson;
  sensorView: 'rgb' | 'thermal' | 'depth';
  cycleSensorView: () => void;
  setPerson: (person: PovPerson) => void;
}) {
  const current = sensorView === 'rgb' ? 'visible-light' : sensorView;
  return (
    <>
      <IconButton
        label={person === 'third' ? 'Switch to first-person camera' : 'Switch to third-person camera'}
        pressed={person === 'first'}
        onClick={() => setPerson(person === 'third' ? 'first' : 'third')}
      >
        {person === 'third' ? <ThirdPersonIcon /> : <FirstPersonIcon />}
      </IconButton>
      <IconButton
        label={`Cycle sensor view (currently ${current})`}
        onClick={cycleSensorView}
      >
        {sensorView === 'thermal' ? <ThermoIcon /> : sensorView === 'depth' ? <DepthIcon /> : <EyeIcon />}
      </IconButton>
    </>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  className = '',
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-[2px] border bg-white/95 text-slate-800 shadow-sm hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-800 ${pressed ? 'border-slate-900' : 'border-slate-500'} ${className}`}
    >
      {children}
    </button>
  );
}

function CommandButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-[3px] border text-slate-800 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-800 disabled:cursor-not-allowed ${
        pressed ? 'border-slate-900 bg-slate-100' : 'border-slate-500 bg-white hover:bg-slate-50'
      } ${disabled && !pressed ? 'opacity-40' : ''}`}
    >
      {children}
    </button>
  );
}

function SensorPreview() {
  const frame = useMissionStore((s) => s.frame);
  const sensorView = useUIStore((s) => s.sensorView);
  const cycleSensorView = useUIStore((s) => s.cycleSensorView);
  const src = frame ? frame[`${sensorView}Url`] : null;
  const label = sensorView === 'rgb' ? 'Visible-light RGB' : sensorView === 'thermal' ? 'Thermal' : 'LiDAR depth';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label} sensor frame</span>
        <button type="button" onClick={cycleSensorView} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800">
          Next sensor
        </button>
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${label} sensor frame`} className="max-h-40 w-full object-contain" />
      ) : (
        <p className="text-xs text-zinc-500">No frame yet</p>
      )}
    </div>
  );
}

export default function Stage() {
  useMission();
  const { run, pause, reset, regenerate, status } = useMission();
  const phase = useMissionStore((s) => s.rover.phase);
  const seed = useMissionStore((s) => s.seed);
  const devConsole = useUIStore((s) => s.devConsole);
  const sensorView = useUIStore((s) => s.sensorView);
  const cycleSensorView = useUIStore((s) => s.cycleSensorView);

  const [layout, setLayout] = useState<'immersive' | 'classic'>('immersive');
  const [person, setPerson] = useState<PovPerson>('third');
  const [miniMapSize, setMiniMapSize] = useState(180);
  const resizeStart = useRef<{ pointerId: number; x: number; y: number; size: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const immersive = layout === 'immersive';
  const running = status === 'running' || status === 'waiting_for_gemini';
  const paused = status === 'paused';
  const resizeMap = (e: PointerEvent<HTMLButtonElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const max = Math.max(120, Math.min(window.innerWidth * 0.42, window.innerHeight * 0.5));
    setMiniMapSize(Math.round(Math.max(120, Math.min(max, start.size + Math.max(e.clientX - start.x, e.clientY - start.y)))));
  };

  return (
    <div className={`${immersive ? 'relative bg-slate-950 text-slate-100' : 'flex flex-col bg-[#d7e4f0] text-slate-900'} h-dvh w-full overflow-hidden`} data-layout={layout} data-status={status} data-phase={phase} data-seed={seed}>
      <h1 className="sr-only">SARAH</h1>
      <header className={`${immersive
        ? 'absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-slate-950/80 to-transparent pr-[min(380px,38vw)]'
        : 'relative z-30 shrink-0 bg-[#d7e4f0]'} flex items-center gap-1.5 px-2 py-2`}>
        <CommandButton label="Regenerate terrain" onClick={() => regenerate(Math.floor(Math.random() * 100000))}>
          <RegenerateIcon />
        </CommandButton>
        <CommandButton label="Reset robot to start" onClick={() => reset()}>
          <ResetIcon />
        </CommandButton>
        <CommandButton label="Run mission" pressed={running} disabled={running} onClick={() => run()}>
          <RunIcon />
        </CommandButton>
        <CommandButton label="Pause mission" pressed={paused} disabled={!running} onClick={() => pause()}>
          <PauseIcon />
        </CommandButton>
        <CommandButton
          label={immersive ? 'Switch to classic split layout' : 'Enter fullscreen mode'}
          onClick={() => setLayout(immersive ? 'classic' : 'immersive')}
        >
          <LayoutIcon immersive={immersive} />
        </CommandButton>
        <span className={`ml-2 hidden truncate font-mono text-[11px] sm:inline ${immersive ? 'text-white/75' : 'text-slate-600'}`}>
          seed {seed} · {phase} · {status.replace(/_/g, ' ')}
        </span>
        <button
          type="button"
          aria-expanded={toolsOpen}
          aria-label="Session tools"
          title="Session tools"
          onClick={() => setToolsOpen((v) => !v)}
          className={`ml-auto rounded border px-2 py-1 text-xs font-medium shadow-sm ${immersive ? 'border-white/40 bg-slate-950/60 text-white hover:bg-slate-900/80' : 'border-slate-500 bg-white/90 text-slate-800 hover:bg-white'}`}
        >
          Session
        </button>
      </header>

      {immersive ? (
        <>
          <div className="absolute inset-0">
            <PovView person={person} />
            {person === 'third' && sensorView === 'rgb' && <div className="pov-wash pointer-events-none absolute inset-0 z-[1]" />}
          </div>
          <div
            className="absolute left-3 top-14 z-20 overflow-hidden rounded-md border border-cyan-100/60 shadow-[0_0_16px_rgba(34,211,238,0.18)]"
            style={{ width: miniMapSize, height: miniMapSize, maxWidth: '42vw', maxHeight: '50vh' }}
          >
            <MapView />
            <button
              type="button"
              title="Describe how the landscape should change"
              aria-label="Describe how the landscape should change"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
              className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-cyan-100/60 bg-slate-950/75 text-lg leading-none text-cyan-50 shadow-sm hover:bg-slate-900"
            >
              +
            </button>
            <button
              type="button"
              aria-label="Resize minimap"
              title="Drag or use arrow keys to resize minimap"
              className="absolute bottom-1 right-1 z-10 grid h-6 w-6 touch-none cursor-nwse-resize place-items-center rounded border border-cyan-100/50 bg-slate-950/70 text-cyan-100"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                resizeStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, size: miniMapSize };
              }}
              onPointerMove={resizeMap}
              onPointerUp={(e) => {
                if (resizeStart.current?.pointerId === e.pointerId) resizeStart.current = null;
              }}
              onPointerCancel={() => {
                resizeStart.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const max = Math.max(120, Math.min(window.innerWidth * 0.42, window.innerHeight * 0.5));
                  setMiniMapSize((s) => Math.min(max, s + 16));
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setMiniMapSize((s) => Math.max(120, s - 16));
                }
              }}
            >
              <Icon><path d="M5 19 19 5M11 5h8v8" /></Icon>
            </button>
          </div>
          <div className="absolute bottom-4 left-3 z-20 flex gap-2">
            <ViewModeButtons person={person} sensorView={sensorView} cycleSensorView={cycleSensorView} setPerson={setPerson} />
          </div>
          <aside className="absolute bottom-0 right-0 top-12 z-20 w-[min(370px,38vw)] p-3 max-sm:top-auto max-sm:h-[52vh] max-sm:w-[min(300px,72vw)]">
            <ThoughtPanel hud />
          </aside>
        </>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 px-2 pb-2"
          style={{
            gridTemplateColumns: 'minmax(148px, 32%) minmax(0, 1fr)',
            gridTemplateRows: 'minmax(128px, 0.9fr) minmax(0, 1.15fr)',
            gridTemplateAreas: '"side main" "thought main"',
          }}
        >
          <div className="relative min-h-0 min-w-0" style={{ gridArea: 'side' }}>
            <div className="absolute inset-0 overflow-hidden rounded-md border border-[#8ea3b8] bg-[#d5e6f7]">
              <MapView />
              <button type="button" title="Describe how the landscape should change" aria-label="Describe how the landscape should change" aria-expanded={chatOpen} onClick={() => setChatOpen((v) => !v)} className="absolute right-1.5 top-1.5 z-10 grid h-8 w-8 place-items-center rounded-full border border-slate-500 bg-white text-lg leading-none text-slate-800 shadow-sm hover:bg-slate-50">+</button>
            </div>
          </div>
          <div className="relative min-h-0 min-w-0" style={{ gridArea: 'main' }}>
            <div className="absolute inset-0 overflow-hidden rounded-md border border-[#8ea3b8] bg-[#d5e6f7]">
              <PovView person={person} />
              {person === 'third' && sensorView === 'rgb' && <div className="pov-wash pointer-events-none absolute inset-0 z-[1]" />}
              <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
                <ViewModeButtons person={person} sensorView={sensorView} cycleSensorView={cycleSensorView} setPerson={setPerson} />
              </div>
            </div>
          </div>
          <div className="relative min-h-0 min-w-0" style={{ gridArea: 'thought' }}>
            <div className="absolute inset-0"><ThoughtPanel /></div>
          </div>
        </div>
      )}

      {chatOpen && (
        <div className="fixed right-3 top-14 z-50 flex max-h-[calc(100vh-4.5rem)] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-[#8ea3b8] bg-white shadow-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-medium text-slate-800">Landscape</h2>
            <button type="button" aria-label="Close landscape chat" onClick={() => setChatOpen(false)} className="grid h-7 w-7 place-items-center rounded text-slate-600 hover:bg-slate-100">
              ×
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto p-2">
            <TerrainChat />
          </div>
        </div>
      )}

      {toolsOpen && (
        <div className="fixed bottom-3 right-3 top-14 z-40 flex w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl" style={{ colorScheme: 'dark' }}>
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
            <h2 className="text-sm font-medium">Session</h2>
            <button type="button" aria-label="Close session tools" onClick={() => setToolsOpen(false)} className="grid h-7 w-7 place-items-center rounded text-zinc-300 hover:bg-zinc-800">
              ×
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            <ResultCard />
            <MetricsStrip />
            <Controls showTransport={false} />
            <SensorPreview />
            <GraphOverlay size={280} className="max-w-full" />
            <AgentPanel className="h-80 shrink-0" />
            {devConsole && <ManualConsole />}
          </div>
        </div>
      )}
    </div>
  );
}
