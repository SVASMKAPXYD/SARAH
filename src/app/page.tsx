'use client';
/**
 * SARAH operator view: large map or large POV, thought transcript, and the mission
 * command bar. The 3D canvases are client-only.
 */
import dynamic from 'next/dynamic';
import { useMission } from '@/hooks/useMission';

const Stage = dynamic(() => import('@/components/stage/Stage'), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center bg-[#d7e4f0] text-sm text-slate-600">Loading SARAH…</div>,
});

export default function Home() {
  useMission();
  return <Stage />;
}
