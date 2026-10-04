'use client';
/**
 * P4 — layout per plan §2: big third-person view with Gemini's graph overlaid, a mini rover
 * camera panel (swappable with the main view), agent panel + feed on the side, metrics
 * strip, controls, terrain chat, dev-only manual console, result card.
 *
 * The 3D Canvas stays mounted while swapping (the SensorRig lives inside it); only its
 * container's classes change.
 */
import dynamic from 'next/dynamic';
import AgentPanel from '@/components/panels/AgentPanel';
import Controls from '@/components/panels/Controls';
import ManualConsole from '@/components/panels/ManualConsole';
import MetricsStrip from '@/components/panels/MetricsStrip';
import ResultCard from '@/components/panels/ResultCard';
import RoverPanel from '@/components/panels/RoverPanel';
import TerrainChat from '@/components/panels/TerrainChat';
import GraphOverlay from '@/components/world/GraphOverlay';
import { useMission } from '@/hooks/useMission';
import { useMissionStore, useUIStore } from '@/store/missionStore';

const Scene = dynamic(() => import('@/components/world/Scene'), {
  ssr: false,
  loading: () => <div className="grid h-full w-full place-items-center text-sm text-zinc-500">Loading 3D…</div>,
});

const MINI = 'absolute bottom-3 right-3 z-20 h-48 w-64 overflow-hidden rounded-lg border border-zinc-700 shadow-xl';
const MAIN = 'absolute inset-0';

export default function Home() {
  useMission();
  const mainView = useUIStore((s) => s.mainView);
  const devConsole = useUIStore((s) => s.devConsole);
  const grade = useMissionStore((s) => s.grade);
  const phase = useMissionStore((s) => s.rover.phase);
  const status = useMissionStore((s) => s.status);

  return (
    <div className="flex min-h-screen flex-col gap-2 bg-zinc-950 p-2 text-zinc-100 lg:h-screen">
      <header className="flex items-center gap-3">
        <div className="flex items-baseline gap-2 px-1">
          <h1 className="text-base font-semibold tracking-tight">SARAH</h1>
          <span className="hidden text-[11px] text-zinc-500 sm:inline">Search And Rescue Autonomous Helper · Gemini maps, Gemini drives</span>
        </div>
        <MetricsStrip className="ml-auto" />
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[1fr_400px] lg:grid-rows-1">
        {/* Main view + overlays */}
        <section className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-lg border border-zinc-800 bg-black lg:h-auto">
          <div className={mainView === 'world' ? MAIN : MINI}>
            <Scene />
            {mainView === 'rover' && (
              <button
                onClick={() => useUIStore.getState().setMainView('world')}
                className="absolute right-1.5 top-1.5 rounded bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800"
                title="Swap with the main view"
              >
                ⇄ Main
              </button>
            )}
          </div>
          <RoverPanel variant={mainView === 'rover' ? 'main' : 'mini'} className={mainView === 'rover' ? MAIN : MINI} />
          <GraphOverlay className="absolute left-3 top-3 z-20" size={240} />
          <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 text-[11px] text-zinc-300">
            <span className="rounded bg-zinc-900/80 px-2 py-1 font-mono">
              {phase} · {status.replace(/_/g, ' ')}
            </span>
          </div>
        </section>

        {/* Side column */}
        <aside className="flex flex-col gap-2 lg:min-h-0 lg:overflow-y-auto">
          <Controls />
          {grade && <ResultCard />}
          <AgentPanel className="min-h-[320px] flex-1" />
          <TerrainChat />
          {process.env.NODE_ENV !== 'production' && devConsole && <ManualConsole />}
        </aside>
      </main>
    </div>
  );
}
