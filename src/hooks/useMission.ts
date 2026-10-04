'use client';
/**
 * P3/P4 — React entry point to the MissionController. Mounts the world once, reads URL
 * flags (`?replay=<file>`, `?dev=1`) and NEXT_PUBLIC_DEV_CONSOLE, and hands the panels
 * a stable set of actions. All sim writes still go through the controller.
 */
import { useEffect, useMemo } from 'react';
import { getMissionController } from '@/lib/sim/missionLoop';
import { useMissionStore, useUIStore } from '@/store/missionStore';

let booted = false; // several panels call useMission(); boot the world/URL flags once per page load

export function useMission() {
  const controller = useMemo(() => getMissionController(), []);
  const status = useMissionStore((s) => s.status);
  const deciderMode = useMissionStore((s) => s.deciderMode);

  useEffect(() => {
    if (booted) return;
    booted = true;
    controller.ensureWorld();
    const sp = new URLSearchParams(window.location.search);
    if (process.env.NODE_ENV !== 'production' && (sp.get('dev') === '1' || process.env.NEXT_PUBLIC_DEV_CONSOLE === '1')) {
      useUIStore.getState().setDevConsole(true);
    }
    const replay = sp.get('replay');
    if (replay) {
      controller.loadReplay(replay).catch((e: Error) => {
        useMissionStore.setState({ error: `replay load failed: ${e.message}` });
      });
    }
  }, [controller]);

  return useMemo(
    () => ({
      controller,
      status,
      deciderMode,
      run: () => controller.start(),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      reset: () => controller.reset(),
      regenerate: (seed?: number, params?: Parameters<typeof controller.regenerate>[1]) => controller.regenerate(seed, params),
      setDeciderMode: (m: Parameters<typeof controller.setDeciderMode>[0]) => controller.setDeciderMode(m),
      submitManualDecision: (raw: unknown) => controller.submitManualDecision(raw),
      submitBriefing: (text: string) => controller.submitBriefing(text),
      downloadReplay: () => controller.downloadReplay(),
    }),
    [controller, status, deciderMode],
  );
}
