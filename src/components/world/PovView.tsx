'use client';
/**
 * Robot point-of-view canvas: third-person chase or first-person sensor pose, photo or
 * thermal. The night grade (light lift + blue tint) is display-only — SensorRig's
 * offscreen captures keep the original moonlight so Gemini still sees the real night.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CAMERA_VFOV_DEG, SENSOR_HEIGHT_M } from '@/lib/constants';
import { dirFromBearing } from '@/lib/geo';
import type { World } from '@/lib/world/terrain';
import { useMissionStore, useUIStore } from '@/store/missionStore';
import SensorRig from './SensorRig';
import { Atmosphere, FollowCamera, Sky, TruthLayerToggle, WorldMeshes } from './Scene';

export type PovPerson = 'third' | 'first';

const NIGHT_BG = new THREE.Color('#163864');
const NIGHT_FOG = new THREE.Color('#2c558c');
const BLACK = new THREE.Color('#000000');

function thermalColor(t: number): THREE.Color {
  const stops: [number, [number, number, number]][] = [
    [0, [0.02, 0.0, 0.08]],
    [0.25, [0.35, 0.02, 0.55]],
    [0.5, [0.9, 0.12, 0.1]],
    [0.75, [1.0, 0.8, 0.12]],
    [1, [1, 1, 1]],
  ];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0);
      return new THREE.Color(c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k);
    }
  }
  return new THREE.Color(1, 1, 1);
}

type ThermalMats = Map<number, THREE.MeshBasicMaterial>;

function thermalMaterial(mats: ThermalMats, t: number): THREE.MeshBasicMaterial {
  const key = Math.round(t * 100) / 100;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: thermalColor(key), fog: false });
    mats.set(key, m);
  }
  return m;
}

/** First person: sensor pose, pitched a little so the ground in front of the robot reads. */
function FirstPersonCamera({ world }: { world: World }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    camera.fov = CAMERA_VFOV_DEG;
    camera.near = 0.08;
    camera.updateProjectionMatrix();
  }, [camera]);
  useFrame(() => {
    const r = useMissionStore.getState().rover;
    const y = world.heightAt(r.x, r.z) + SENSOR_HEIGHT_M;
    const d = dirFromBearing(r.headingDeg);
    camera.position.set(r.x + d.x * 0.55, y, r.z + d.z * 0.55);
    camera.lookAt(r.x + d.x * 22, y - 0.45, r.z + d.z * 22);
  });
  return null;
}

function isFillLight(o: THREE.Object3D): o is THREE.AmbientLight | THREE.HemisphereLight | THREE.DirectionalLight {
  return o instanceof THREE.AmbientLight || o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight;
}

/**
 * Wraps the canvas render. SensorRig calls gl.render with a camera flagged
 * `userData.sensor`; those passes stay ungraded. The on-screen camera gets either
 * a lifted night grade or a thermal false-color pass.
 */
function DisplayGrade() {
  const gl = useThree((s) => s.gl);
  const mats = useMemo<ThermalMats>(() => new Map(), []);
  useEffect(
    () => () => {
      for (const m of mats.values()) m.dispose();
      mats.clear();
    },
    [mats],
  );
  useLayoutEffect(() => {
    const orig = gl.render.bind(gl);
    const render = (sceneObj: THREE.Object3D, camera: THREE.Camera) => {
      const scene = sceneObj as THREE.Scene;
      if (camera.userData?.sensor === true) {
        orig(scene, camera);
        return;
      }
      if (useUIStore.getState().thermal) {
        const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
        const prevBg = scene.background;
        const prevFog = scene.fog;
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          swapped.push([mesh, mesh.material]);
          const t = typeof mesh.userData.thermal === 'number' ? (mesh.userData.thermal as number) : 0.15;
          mesh.material = thermalMaterial(mats, t);
        });
        scene.background = BLACK;
        scene.fog = null;
        try {
          orig(scene, camera);
        } finally {
          for (const [mesh, mat] of swapped) mesh.material = mat;
          scene.background = prevBg;
          scene.fog = prevFog;
        }
        return;
      }
      const lights: Array<[THREE.Light, number]> = [];
      scene.traverse((o) => {
        if (!isFillLight(o)) return;
        lights.push([o, o.intensity]);
        o.intensity *= 2.35;
      });
      const prevBg = scene.background;
      const fog = scene.fog;
      const prevFog = fog ? fog.color.clone() : null;
      const prevNear = fog && 'near' in fog ? fog.near : null;
      const prevFar = fog && 'far' in fog ? fog.far : null;
      const prevExp = gl.toneMappingExposure;
      scene.background = NIGHT_BG;
      if (fog && prevFog) fog.color.copy(NIGHT_FOG);
      if (fog && 'far' in fog && prevFar !== null && prevFar < 180) fog.far = 180;
      gl.toneMappingExposure = prevExp * 1.45;
      try {
        orig(scene, camera);
      } finally {
        for (const [light, intensity] of lights) light.intensity = intensity;
        scene.background = prevBg;
        if (fog && prevFog) fog.color.copy(prevFog);
        if (fog && 'near' in fog && prevNear !== null) fog.near = prevNear;
        if (fog && 'far' in fog && prevFar !== null) fog.far = prevFar;
        gl.toneMappingExposure = prevExp;
      }
    };
    gl.render = render as THREE.WebGLRenderer['render'];
    return () => {
      gl.render = orig;
    };
  }, [gl, mats]);
  return null;
}

export default function PovView({ person }: { person: PovPerson }) {
  const world = useMissionStore((s) => s.world);
  const worldVersion = useMissionStore((s) => s.worldVersion);
  const thermal = useUIStore((s) => s.thermal);
  return (
    <div className={`h-full w-full ${thermal ? '' : 'pov-photo'}`}>
      <Canvas
        className="h-full w-full"
        camera={{ fov: 60, near: 0.5, far: 500, position: [0, 8, 14] }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        {world && (
          <group key={worldVersion}>
            <Atmosphere world={world} />
            <WorldMeshes world={world} />
            {person === 'third' ? <FollowCamera world={world} /> : <FirstPersonCamera world={world} />}
            <SensorRig world={world} />
          </group>
        )}
        {world && <Sky world={world} />}
        <TruthLayerToggle />
        <DisplayGrade />
      </Canvas>
      {!world && <div className="absolute inset-0 grid place-items-center text-sm text-slate-600">Generating world…</div>}
    </div>
  );
}
