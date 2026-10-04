'use client';
/**
 * Third-person views use the live chase-camera canvas. First-person views display the
 * selected synchronized sensor capture; the hidden canvas remains mounted to capture it.
 * The chase view's exposure lift brightens night without recoloring the sky.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CAMERA_VFOV_DEG, DEPTH_MAX_RANGE_M, NIGHT_VISIBILITY_EXPOSURE_LIFT, NIGHT_VISIBILITY_LIGHT_LIFT, SENSOR_HEIGHT_M } from '@/lib/constants';
import { dirFromBearing } from '@/lib/geo';
import type { World } from '@/lib/world/terrain';
import { useMissionStore, useUIStore } from '@/store/missionStore';
import SensorRig from './SensorRig';
import { Atmosphere, FollowCamera, Sky, TruthLayerToggle, WorldMeshes } from './Scene';

export type PovPerson = 'third' | 'first';

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
  useFrame(() => {
    const r = useMissionStore.getState().rover;
    const y = world.heightAt(r.x, r.z) + SENSOR_HEIGHT_M;
    const d = dirFromBearing(r.headingDeg);
    camera.position.set(r.x + d.x * 0.55, y, r.z + d.z * 0.55);
    camera.lookAt(r.x + d.x * 22, y - 0.45, r.z + d.z * 22);
  });
  return null;
}

function makeChaseDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { maxRangeM: { value: DEPTH_MAX_RANGE_M } },
    vertexShader: `
      varying vec3 chaseViewPosition;
      void main() {
        vec4 localPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
        #endif
        vec4 viewPosition = modelViewMatrix * localPosition;
        chaseViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float maxRangeM;
      varying vec3 chaseViewPosition;
      void main() {
        float distanceM = length(chaseViewPosition);
        if (distanceM >= maxRangeM) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        float hue = (240.0 / 360.0) * max(distanceM, 0.0) / maxRangeM;
        vec3 rgb = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
        gl_FragColor = vec4(rgb, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });
}

function isFillLight(o: THREE.Object3D): o is THREE.AmbientLight | THREE.HemisphereLight | THREE.DirectionalLight {
  return o instanceof THREE.AmbientLight || o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight;
}

/**
 * Wraps the canvas render. SensorRig calls gl.render with a camera flagged
 * `userData.sensor`; those passes stay ungraded. The on-screen camera gets either
 * an exposure lift that fades toward daytime, or a thermal false-color pass.
 */
function DisplayGrade({ person }: { person: PovPerson }) {
  const gl = useThree((s) => s.gl);
  const mats = useMemo<ThermalMats>(() => new Map(), []);
  const chaseDepthMaterial = useMemo(() => makeChaseDepthMaterial(), []);
  useEffect(
    () => () => {
      for (const m of mats.values()) m.dispose();
      mats.clear();
      chaseDepthMaterial.dispose();
    },
    [chaseDepthMaterial, mats],
  );
  useLayoutEffect(() => {
    const orig = gl.render.bind(gl);
    const render = (sceneObj: THREE.Object3D, camera: THREE.Camera) => {
      const scene = sceneObj as THREE.Scene;
      if (camera.userData?.sensor === true) {
        orig(scene, camera);
        return;
      }
      if (person === 'third' && useUIStore.getState().sensorView === 'depth') {
        const prevOverride = scene.overrideMaterial;
        const prevBg = scene.background;
        const prevFog = scene.fog;
        scene.overrideMaterial = chaseDepthMaterial;
        scene.background = BLACK;
        scene.fog = null;
        try {
          orig(scene, camera);
        } finally {
          scene.overrideMaterial = prevOverride;
          scene.background = prevBg;
          scene.fog = prevFog;
        }
        return;
      }
      if (useUIStore.getState().sensorView === 'thermal') {
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
      const level = useMissionStore.getState().params.light_level;
      const lift = 1 + (1 - level) * NIGHT_VISIBILITY_LIGHT_LIFT;
      const lights: Array<[THREE.Light, number]> = [];
      scene.traverse((o) => {
        if (!isFillLight(o)) return;
        lights.push([o, o.intensity]);
        o.intensity *= lift;
      });
      const prevExp = gl.toneMappingExposure;
      gl.toneMappingExposure = prevExp * (1 + (1 - level) * NIGHT_VISIBILITY_EXPOSURE_LIFT);
      try {
        orig(scene, camera);
      } finally {
        for (const [light, intensity] of lights) light.intensity = intensity;
        gl.toneMappingExposure = prevExp;
      }
    };
    gl.render = render as THREE.WebGLRenderer['render'];
    return () => {
      gl.render = orig;
    };
  }, [chaseDepthMaterial, gl, mats, person]);
  return null;
}

export default function PovView({ person }: { person: PovPerson }) {
  const world = useMissionStore((s) => s.world);
  const worldVersion = useMissionStore((s) => s.worldVersion);
  const frame = useMissionStore((s) => s.frame);
  const sensorView = useUIStore((s) => s.sensorView);
  const useSensorFrame = person === 'first';
  const sensorImage = frame
    ? sensorView === 'rgb'
      ? frame.rgbUrl
      : sensorView === 'thermal'
        ? frame.thermalUrl
        : frame.depthUrl
    : null;
  return (
    <div className={`relative h-full w-full ${sensorView === 'rgb' ? 'pov-photo' : ''}`}>
      <Canvas
        className={`h-full w-full ${useSensorFrame ? 'invisible' : ''}`}
        camera={{ fov: person === 'first' ? CAMERA_VFOV_DEG : 60, near: person === 'first' ? 0.08 : 0.5, far: 500, position: [0, 8, 14] }}
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
        <DisplayGrade person={person} />
      </Canvas>
      {useSensorFrame && sensorImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sensorImage}
          alt={
            sensorView === 'depth'
              ? 'LiDAR depth image: hue encodes radial distance from red at 0 m through yellow, green and cyan to blue just below 35 m; black is no return or 35 m and farther'
              : sensorView === 'thermal'
                ? 'Thermal sensor image'
                : 'Visible-light RGB sensor image'
          }
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {sensorView === 'depth' && (sensorImage || person === 'third') && (
        <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-slate-950/80 px-2 py-1 text-[11px] text-white">
          <span>0 m</span>
          <span className="h-2 w-24 rounded-sm" style={{ background: 'linear-gradient(to right, red, yellow, lime, cyan, blue)' }} />
          <span>35 m</span>
          <span className="ml-1 text-white/70">black: no return / ≥35 m</span>
        </div>
      )}
      {useSensorFrame && !sensorImage && <div className="absolute inset-0 grid place-items-center bg-black text-sm text-white/70">Waiting for sensor frame…</div>}
      {!world && <div className="absolute inset-0 grid place-items-center text-sm text-slate-600">Generating world…</div>}
    </div>
  );
}
