'use client';
/**
 * Viewport stage. Mode A (default): large overhead map, small POV. Mode B: large POV,
 * small map. The diagonal arrow swaps them. Secondary mission tools stay in the
 * session drawer so the loop, graph, replay, and dev console are still reachable.
 */
import { useState, type ReactNode } from 'react';
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

type LayoutMode = 'map-large' | 'pov-large';

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
function SwapIcon() {
  return (
    <Icon>
      <path d="M14 5h5v5" />
      <path d="m19 5-7 7" />
      <path d="M10 19H5v-5" />
      <path d="m5 19 7-7" />
    </Icon>
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
  const show = useUIStore((s) => s.showGeminiOverlay);
  const setShow = useUIStore((s) => s.setShowGeminiOverlay);
  const frame = useMissionStore((s) => s.frame);
  const thermal = useUIStore((s) => s.thermal);
  const src = frame
    ? show
      ? `data:image/jpeg;base64,${thermal ? frame.thermalGeminiB64 : frame.rgbGeminiB64}`
      : thermal
        ? frame.thermalUrl
        : frame.rgbUrl
    : null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Sensor frame</span>
        <button type="button" onClick={() => setShow(!show)} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800">
          {show ? 'Gemini overlay' : 'Clean frame'}
        </button>
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={thermal ? 'Thermal sensor frame' : 'RGB sensor frame'} className="max-h-40 w-full object-contain" />
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
  const thermal = useUIStore((s) => s.thermal);
  const setThermal = useUIStore((s) => s.setThermal);

  const [layout, setLayout] = useState<LayoutMode>('map-large');
  const [person, setPerson] = useState<PovPerson>('third');
  const [chatOpen, setChatOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const largeMap = layout === 'map-large';
  const running = status === 'running' || status === 'waiting_for_gemini';
  const paused = status === 'paused';
  const swap = () => setLayout((m) => (m === 'map-large' ? 'pov-large' : 'map-large'));

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#d7e4f0] text-slate-900" data-layout={layout} data-status={status} data-phase={phase} data-seed={seed}>
      <h1 className="sr-only">SARAH</h1>
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
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
        <span className="ml-2 hidden font-mono text-[11px] text-slate-600 sm:inline">
          seed {seed} · {phase} · {status.replace(/_/g, ' ')}
        </span>
        <button
          type="button"
          aria-expanded={toolsOpen}
          aria-label="Session tools"
          title="Session tools"
          onClick={() => setToolsOpen((v) => !v)}
          className="ml-auto rounded border border-slate-500 bg-white/90 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-white"
        >
          Session
        </button>
      </header>

      <div
        className="grid min-h-0 flex-1 gap-2 px-2 pb-2"
        style={{
          gridTemplateColumns: 'minmax(148px, 32%) minmax(0, 1fr)',
          gridTemplateRows: 'minmax(128px, 0.9fr) minmax(0, 1.15fr)',
          gridTemplateAreas: '"side main" "thought main"',
        }}
      >
        <div className="relative min-h-0 min-w-0" style={{ gridArea: largeMap ? 'side' : 'main' }}>
          <div className="absolute inset-0 overflow-hidden rounded-md border border-[#8ea3b8] bg-[#d5e6f7]">
            <PovView person={person} />
            {!thermal && <div className="pov-wash pointer-events-none absolute inset-0 z-[1]" />}
            <div className="absolute right-1.5 top-1.5 z-10 flex gap-1" role="group" aria-label="Point of view sensor">
              <IconButton label="Light-based sight" pressed={!thermal} onClick={() => setThermal(false)}>
                <EyeIcon />
              </IconButton>
              <IconButton label="Thermal readings" pressed={thermal} onClick={() => setThermal(true)}>
                <ThermoIcon />
              </IconButton>
            </div>
            <div className="absolute bottom-1.5 left-1.5 z-10 flex overflow-hidden rounded-[2px] border border-slate-500 bg-white/95 text-[11px] font-medium text-slate-800 shadow-sm" role="group" aria-label="Camera follow mode">
              <button
                type="button"
                aria-pressed={person === 'third'}
                aria-label="Third-person camera"
                title="Third-person camera"
                onClick={() => setPerson('third')}
                className={`px-1.5 py-1 ${person === 'third' ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
              >
                3rd
              </button>
              <button
                type="button"
                aria-pressed={person === 'first'}
                aria-label="First-person camera"
                title="First-person camera"
                onClick={() => setPerson('first')}
                className={`border-l border-slate-500 px-1.5 py-1 ${person === 'first' ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
              >
                1st
              </button>
            </div>
            {largeMap && (
              <IconButton className="absolute bottom-1.5 right-1.5 z-10" label="Switch to large point of view" onClick={swap}>
                <SwapIcon />
              </IconButton>
            )}
          </div>
        </div>

        <div className="relative min-h-0 min-w-0" style={{ gridArea: largeMap ? 'main' : 'side' }}>
          <div className="absolute inset-0 overflow-hidden rounded-md border border-[#8ea3b8] bg-[#c5d7ea]">
            <MapView />
            <button
              type="button"
              title="Describe how the landscape should change"
              aria-label="Describe how the landscape should change"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
              className="absolute right-1.5 top-1.5 z-10 grid h-8 w-8 place-items-center rounded-full border border-slate-500 bg-white text-lg leading-none text-slate-800 shadow-sm hover:bg-slate-50"
            >
              +
            </button>
            {!largeMap && (
              <IconButton className="absolute bottom-1.5 right-1.5 z-10" label="Switch to large map" onClick={swap}>
                <SwapIcon />
              </IconButton>
            )}
          </div>
        </div>

        <div className="relative min-h-0 min-w-0" style={{ gridArea: 'thought' }}>
          <div className="absolute inset-0">
            <ThoughtPanel />
          </div>
        </div>
      </div>

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
