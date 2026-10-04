'use client';
/**
 * P1 — sensor rig (plan §3c): one camera pose at the rover for every sensor.
 *
 *   RGB      offscreen render target (drei useFBO) at 512×384, 90° HFOV, read back to a
 *            canvas at the 1 Hz sensor tick.
 *   THERMAL  second pass over the same camera: every mesh's material is swapped for an
 *            unlit false-colour material chosen from its `userData.thermal` temperature
 *            (plan §3c table), fog and sky off → darkness does not matter.
 *   LiDAR    from the store (computed by the MissionController on the same tick).
 *
 * The clean copies go to the UI (`frame.rgbUrl/thermalUrl`); the Gemini copies get the
 * burned-in bearing/distance overlay (`frame.rgbGeminiB64/thermalGeminiB64`).
 *
 * TODO(P1): render only on the tick (currently also 1 Hz while idle so the panel is live);
 *           Three.js raycast LiDAR against these meshes instead of the 2D approximation.
 */
import { useFBO } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CAMERA_VFOV_DEG, SENSOR_HEIGHT_M, SENSOR_IMAGE_H, SENSOR_IMAGE_W, SENSOR_TICK_HZ } from '@/lib/constants';
import { dirFromBearing } from '@/lib/geo';
import { renderGeminiImage } from '@/lib/sim/overlay';
import { computeLidar } from '@/lib/sim/sensors';
import type { World } from '@/lib/world/terrain';
import { useMissionStore } from '@/store/missionStore';

const W = SENSOR_IMAGE_W;
const H = SENSOR_IMAGE_H;

/** Ironbow-ish palette: 0 → near black, 0.25 purple, 0.5 red, 0.75 yellow, 1 white. */
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

const BLACK = new THREE.Color('#000000');

/** Render the scene from the sensor camera into `fbo`; thermal = material swap, no fog/sky. */
function renderPass(gl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, fbo: THREE.WebGLRenderTarget, thermal: boolean, mats: ThermalMats) {
  const prevTarget = gl.getRenderTarget();
  const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  let prevBg: THREE.Scene['background'] = null;
  let prevFog: THREE.Scene['fog'] = null;
  if (thermal) {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      swapped.push([m, m.material]);
      const t = typeof m.userData.thermal === 'number' ? (m.userData.thermal as number) : 0.15;
      m.material = thermalMaterial(mats, t);
    });
    prevBg = scene.background;
    prevFog = scene.fog;
    scene.background = BLACK;
    scene.fog = null;
  }
  gl.setRenderTarget(fbo);
  gl.clear();
  gl.render(scene, cam);
  gl.setRenderTarget(prevTarget);
  if (thermal) {
    for (const [m, mat] of swapped) m.material = mat;
    scene.background = prevBg;
    scene.fog = prevFog;
  }
}

/** Read the render target back (flipping Y) into `canvas`; returns a clean JPEG data URL. */
function readback(gl: THREE.WebGLRenderer, fbo: THREE.WebGLRenderTarget, canvas: HTMLCanvasElement, buffer: Uint8Array, imageData: ImageData): string {
  gl.readRenderTargetPixels(fbo, 0, 0, W, H, buffer);
  const row = W * 4;
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * row;
    imageData.data.set(buffer.subarray(src, src + row), y * row);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.75);
}

export default function SensorRig({ world }: { world: World }) {
  // UnsignedByteType so readRenderTargetPixels can fill a Uint8Array (drei defaults to HalfFloat).
  const fboSettings = useMemo(() => ({ type: THREE.UnsignedByteType, stencilBuffer: false, generateMipmaps: false }), []);
  const rgbFbo = useFBO(W, H, fboSettings);
  const thermalFbo = useFBO(W, H, fboSettings);

  const cam = useMemo(() => {
    const c = new THREE.PerspectiveCamera(CAMERA_VFOV_DEG, W / H, 0.1, 300);
    c.layers.enableAll();
    // Display-only passes (night grade, thermal preview) must not retint this capture.
    c.userData.sensor = true;
    return c;
  }, []);

  const canvases = useMemo(() => {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return c;
    };
    return { rgb: mk(), thermal: mk() };
  }, []);
  const buffer = useMemo(() => new Uint8Array(W * H * 4), []);
  const imageData = useMemo(() => new ImageData(W, H), []);
  const thermalMats = useMemo<ThermalMats>(() => new Map(), []);

  const lastCaptureMs = useRef(-Infinity);
  const lastRequest = useRef(-1);
  const seq = useRef(0);

  useEffect(
    () => () => {
      for (const m of thermalMats.values()) m.dispose();
      thermalMats.clear();
    },
    [thermalMats],
  );

  useFrame((state) => {
    const { gl, scene } = state;
    const s = useMissionStore.getState();
    const nowMs = state.clock.elapsedTime * 1000;
    const due = nowMs - lastCaptureMs.current >= 1000 / SENSOR_TICK_HZ || s.captureRequest !== lastRequest.current;
    if (!due) return;
    lastCaptureMs.current = nowMs;
    lastRequest.current = s.captureRequest;

    // Pose the shared sensor camera at the rover.
    const r = s.rover;
    const y = world.heightAt(r.x, r.z) + SENSOR_HEIGHT_M;
    const d = dirFromBearing(r.headingDeg);
    cam.position.set(r.x + d.x * 0.45, y, r.z + d.z * 0.45);
    cam.lookAt(r.x + d.x * 20, y, r.z + d.z * 20);
    cam.updateMatrixWorld();

    const lidar = s.lidar ?? computeLidar(world, r, { animals: s.animals, survivor: world.truth.survivor });

    renderPass(gl, scene, cam, rgbFbo, false, thermalMats);
    const rgbUrl = readback(gl, rgbFbo, canvases.rgb, buffer, imageData);
    renderPass(gl, scene, cam, thermalFbo, true, thermalMats);
    const thermalUrl = readback(gl, thermalFbo, canvases.thermal, buffer, imageData);
    const rgbGeminiB64 = renderGeminiImage(canvases.rgb, lidar, 'RGB');
    const thermalGeminiB64 = renderGeminiImage(canvases.thermal, lidar, 'THERMAL');

    useMissionStore.setState({
      frame: {
        seq: seq.current++,
        t: performance.now(),
        rgbUrl,
        thermalUrl,
        rgbGeminiB64,
        thermalGeminiB64,
        lidar,
        pose: { x: r.x, z: r.z, headingDeg: r.headingDeg },
      },
    });
  });

  return null;
}
