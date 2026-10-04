'use client';
/**
 * Overhead map: the live forest from straight above (not a chase camera). Drag pans,
 * the wheel and the on-screen buttons zoom. The rover's trace is a glowing line and
 * an HTML "robot" label tracks the body.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { WORLD_HALF_SIZE_M } from '@/lib/constants';
import type { World } from '@/lib/world/terrain';
import { useMissionStore } from '@/store/missionStore';
import { TruthLayerToggle, WorldMeshes } from './Scene';

const MIN_H = 22;
const MAX_H = 480;
const LIM = WORLD_HALF_SIZE_M + 40;

function clampHeight(h: number) {
  return Math.min(MAX_H, Math.max(MIN_H, h));
}

function MapSky() {
  return (
    <>
      <color attach="background" args={['#c5dff0']} />
      <fog attach="fog" args={['#d4e8f6', 200, 620]} />
    </>
  );
}

function MapLights() {
  return (
    <>
      <ambientLight intensity={1.35} color="#eef6e8" />
      <hemisphereLight args={['#d7ecff', '#6f8f55', 1.05]} />
      <directionalLight position={[40, 160, 24]} intensity={2.05} color="#fff8ee" />
    </>
  );
}

function OverheadCamera({ heightRef }: { heightRef: RefObject<number> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const center = useRef({ x: 0, z: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const worldVersion = useMissionStore((s) => s.worldVersion);

  useEffect(() => {
    center.current.x = 0;
    center.current.z = 0;
  }, [worldVersion]);

  useLayoutEffect(() => {
    const h = heightRef.current ?? 190;
    camera.up.set(0, 0, -1);
    camera.position.set(0, h, 0);
    camera.lookAt(0, 0, 0);
  }, [camera, heightRef]);

  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is unavailable for some synthetic events; dragging still tracks moves.
      }
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      drag.current = { x: e.clientX, y: e.clientY };
      const rect = el.getBoundingClientRect();
      const h = heightRef.current ?? 190;
      const visibleH = 2 * Math.tan((camera.fov * Math.PI) / 360) * h;
      const worldPerPx = visibleH / Math.max(1, rect.height);
      // Grab-the-terrain: dragging right/down moves the camera west/north.
      center.current.x = Math.min(LIM, Math.max(-LIM, center.current.x - dx * worldPerPx));
      center.current.z = Math.min(LIM, Math.max(-LIM, center.current.z - dy * worldPerPx));
    };
    const up = (e: PointerEvent) => {
      drag.current = null;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      const cur = heightRef.current ?? 190;
      heightRef.current = clampHeight(cur * Math.exp(dy * 0.00115));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [camera, gl, heightRef]);

  useFrame(() => {
    const h = heightRef.current ?? 190;
    const c = center.current;
    camera.up.set(0, 0, -1);
    camera.position.set(c.x, h, c.z);
    camera.lookAt(c.x, 0, c.z);
  });
  return null;
}

function PathHistory({ world }: { world: World }) {
  const [pts, setPts] = useState<THREE.Vector3[]>([]);
  const lastKey = useRef('');
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.12) return;
    acc.current = 0;
    const { trace, rover } = useMissionStore.getState();
    const key = `${trace.length}:${rover.x.toFixed(1)}:${rover.z.toFixed(1)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const raw = [...trace, { x: rover.x, z: rover.z }];
    const src: { x: number; z: number }[] = [];
    for (const p of raw) {
      const prev = src[src.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) > 0.05) src.push(p);
    }
    if (src.length < 2) {
      setPts((prev) => (prev.length ? [] : prev));
      return;
    }
    setPts(src.map((p) => new THREE.Vector3(p.x, world.heightAt(p.x, p.z) + 0.8, p.z)));
  });
  if (pts.length < 2) return null;
  return (
    <>
      <Line points={pts} color="#9dffd2" lineWidth={7} transparent opacity={0.55} depthTest={false} toneMapped={false} />
      <Line points={pts} color="#f4fff8" lineWidth={2.25} transparent opacity={0.95} depthTest={false} toneMapped={false} />
    </>
  );
}

function RobotBeacon({ world }: { world: World }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const r = useMissionStore.getState().rover;
    const m = ref.current;
    if (!m) return;
    m.position.set(r.x, world.heightAt(r.x, r.z) + 0.5, r.z);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <ringGeometry args={[0.85, 1.25, 24]} />
      <meshBasicMaterial color="#f8fafc" depthTest={false} toneMapped={false} transparent opacity={0.95} side={THREE.DoubleSide} />
    </mesh>
  );
}

function RobotLabel({ world, labelRef }: { world: World; labelRef: RefObject<HTMLDivElement | null> }) {
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    const el = labelRef.current;
    if (!el) return;
    const r = useMissionStore.getState().rover;
    v.current.set(r.x, world.heightAt(r.x, r.z) + 1.2, r.z);
    v.current.project(camera);
    if (v.current.z > 1) {
      el.style.opacity = '0';
      return;
    }
    const x = Math.min(size.width - 24, Math.max(24, (v.current.x * 0.5 + 0.5) * size.width));
    const y = Math.min(size.height - 14, Math.max(14, (-v.current.y * 0.5 + 0.5) * size.height));
    el.style.opacity = '1';
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  });
  return null;
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-[2px] border border-slate-500 bg-white/95 text-sm font-medium text-slate-800 shadow-sm hover:bg-white"
    >
      {children}
    </button>
  );
}

export default function MapView() {
  const world = useMissionStore((s) => s.world);
  const worldVersion = useMissionStore((s) => s.worldVersion);
  const labelRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(190);
  const zoomBy = (factor: number) => {
    heightRef.current = clampHeight((heightRef.current ?? 190) * factor);
  };
  return (
    <div className="absolute inset-0 touch-none">
      <Canvas
        className="h-full w-full"
        camera={{ fov: 42, near: 0.2, far: 2000, position: [0, 190, 0] }}
        dpr={[1, 1.35]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.2;
        }}
      >
        <MapLights />
        {world && (
          <group key={worldVersion}>
            <WorldMeshes world={world} />
            <PathHistory world={world} />
            <RobotBeacon world={world} />
            <RobotLabel world={world} labelRef={labelRef} />
          </group>
        )}
        {world && <MapSky />}
        <TruthLayerToggle />
        <OverheadCamera heightRef={heightRef} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-1">
        <ZoomButton label="Zoom in" onClick={() => zoomBy(0.8)}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1.25)}>
          −
        </ZoomButton>
      </div>
      <div
        ref={labelRef}
        className="pointer-events-none absolute left-0 top-0 z-[5] whitespace-nowrap rounded border border-slate-500/80 bg-[#e7eef6]/95 px-1.5 py-0.5 text-[11px] font-medium text-slate-800 shadow-sm"
        style={{ opacity: 0 }}
      >
        robot
      </div>
      {!world && <div className="absolute inset-0 grid place-items-center text-sm text-slate-600">Generating world…</div>}
    </div>
  );
}
