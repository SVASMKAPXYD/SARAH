'use client';
/** Captures aligned RGB, thermal, and calibrated depth images from one sensor camera. */
import { useFBO } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CAMERA_VFOV_DEG, DEPTH_MAX_RANGE_M, NIGHT_VISIBILITY_EXPOSURE_LIFT, NIGHT_VISIBILITY_LIGHT_LIFT, SENSOR_FORWARD_OFFSET_M, SENSOR_HEIGHT_M, SENSOR_IMAGE_H, SENSOR_IMAGE_W, SENSOR_TICK_HZ } from '@/lib/constants';
import { dirFromBearing } from '@/lib/geo';
import type { SensorFrame } from '@/lib/types';
import type { World } from '@/lib/world/terrain';
import { useMissionStore } from '@/store/missionStore';

const W = SENSOR_IMAGE_W;
const H = SENSOR_IMAGE_H;
const BLACK = new THREE.Color('#000000');

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

function thermalMaterial(mats: ThermalMats, temperature: number): THREE.MeshBasicMaterial {
  const key = Math.round(temperature * 100) / 100;
  let material = mats.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color: thermalColor(key), fog: false });
    mats.set(key, material);
  }
  return material;
}

function makeDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { maxRangeM: { value: DEPTH_MAX_RANGE_M } },
    vertexShader: `
      varying vec3 sensorViewPosition;
      void main() {
        vec4 localPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
        #endif
        vec4 viewPosition = modelViewMatrix * localPosition;
        sensorViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float maxRangeM;
      varying vec3 sensorViewPosition;
      void main() {
        float distanceM = length(sensorViewPosition);
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

type Capture = { url: string; base64: string };

function readback(
  gl: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  canvas: HTMLCanvasElement,
  buffer: Uint8Array,
  imageData: ImageData,
  mime: 'image/jpeg' | 'image/png',
): Capture {
  gl.readRenderTargetPixels(target, 0, 0, W, H, buffer);
  const row = W * 4;
  for (let y = 0; y < H; y++) {
    const sourceRow = (H - 1 - y) * row;
    imageData.data.set(buffer.subarray(sourceRow, sourceRow + row), y * row);
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create sensor image canvas context.');
  context.putImageData(imageData, 0, 0);
  const url = mime === 'image/png' ? canvas.toDataURL(mime) : canvas.toDataURL(mime, 0.9);
  const separator = url.indexOf(',');
  if (separator < 0) throw new Error(`Unable to encode sensor capture as ${mime}.`);
  return { url, base64: url.slice(separator + 1) };
}

function renderPass(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
  mode: 'rgb' | 'thermal' | 'depth',
  thermalMats: ThermalMats,
  depthMaterial: THREE.ShaderMaterial,
  lightLevel: number,
) {
  const previousTarget = gl.getRenderTarget();
  const previousOverride = scene.overrideMaterial;
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const previousClearColor = gl.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = gl.getClearAlpha();
  const previousExposure = gl.toneMappingExposure;
  const adjustedLights: Array<[THREE.Light, number]> = [];
  const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  try {
    if (mode === 'rgb') {
      const lift = 1 + (1 - lightLevel) * NIGHT_VISIBILITY_LIGHT_LIFT;
      scene.traverse((object) => {
        if (
          object instanceof THREE.AmbientLight
          || object instanceof THREE.HemisphereLight
          || object instanceof THREE.DirectionalLight
        ) {
          adjustedLights.push([object, object.intensity]);
          object.intensity *= lift;
        }
      });
      gl.toneMappingExposure = previousExposure * (1 + (1 - lightLevel) * NIGHT_VISIBILITY_EXPOSURE_LIFT);
    } else if (mode === 'thermal') {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        swapped.push([mesh, mesh.material]);
        const temperature = typeof mesh.userData.thermal === 'number' ? mesh.userData.thermal : 0.15;
        mesh.material = thermalMaterial(thermalMats, temperature);
      });
      scene.background = BLACK;
      scene.fog = null;
    } else if (mode === 'depth') {
      scene.overrideMaterial = depthMaterial;
      scene.background = BLACK;
      scene.fog = null;
    }
    gl.setRenderTarget(target);
    gl.setClearColor(BLACK, 1);
    gl.clear(true, true, true);
    gl.render(scene, camera);
  } finally {
    for (const [mesh, material] of swapped) mesh.material = material;
    scene.overrideMaterial = previousOverride;
    scene.background = previousBackground;
    scene.fog = previousFog;
    for (const [light, intensity] of adjustedLights) light.intensity = intensity;
    gl.toneMappingExposure = previousExposure;
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(previousClearColor, previousClearAlpha);
  }
}

export default function SensorRig({ world }: { world: World }) {
  const fboSettings = useMemo(() => ({
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    stencilBuffer: false,
    generateMipmaps: false,
  }), []);
  const rgbFbo = useFBO(W, H, fboSettings);
  const thermalFbo = useFBO(W, H, fboSettings);
  const depthFbo = useFBO(W, H, fboSettings);
  const cam = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(CAMERA_VFOV_DEG, W / H, 0.1, 300);
    camera.layers.enableAll();
    camera.userData.sensor = true;
    return camera;
  }, []);
  const depthMaterial = useMemo(() => makeDepthMaterial(), []);
  const canvases = useMemo(() => {
    const create = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      return canvas;
    };
    return { rgb: create(), thermal: create(), depth: create() };
  }, []);
  const buffer = useMemo(() => new Uint8Array(W * H * 4), []);
  const imageData = useMemo(() => new ImageData(W, H), []);
  const thermalMats = useMemo<ThermalMats>(() => new Map(), []);
  const lastCaptureMs = useRef(-Infinity);
  const lastRequest = useRef(-1);
  const seq = useRef(0);

  useEffect(() => {
    return () => {
      depthMaterial.dispose();
      for (const material of thermalMats.values()) material.dispose();
      thermalMats.clear();
    };
  }, [depthMaterial, thermalMats]);

  useFrame((state) => {
    const { gl, scene } = state;
    const mission = useMissionStore.getState();
    const nowMs = state.clock.elapsedTime * 1000;
    const due = nowMs - lastCaptureMs.current >= 1000 / SENSOR_TICK_HZ || mission.captureRequest !== lastRequest.current;
    if (!due) return;
    lastCaptureMs.current = nowMs;
    lastRequest.current = mission.captureRequest;

    const rover = mission.rover;
    const y = world.heightAt(rover.x, rover.z) + SENSOR_HEIGHT_M;
    const direction = dirFromBearing(rover.headingDeg);
    const cameraX = rover.x + direction.x * SENSOR_FORWARD_OFFSET_M;
    const cameraZ = rover.z + direction.z * SENSOR_FORWARD_OFFSET_M;
    cam.position.set(cameraX, y, cameraZ);
    cam.lookAt(cameraX + direction.x * 20, y, cameraZ + direction.z * 20);
    cam.updateMatrixWorld();

    renderPass(gl, scene, cam, rgbFbo, 'rgb', thermalMats, depthMaterial, world.params.light_level);
    const rgb = readback(gl, rgbFbo, canvases.rgb, buffer, imageData, 'image/jpeg');
    renderPass(gl, scene, cam, thermalFbo, 'thermal', thermalMats, depthMaterial, world.params.light_level);
    const thermal = readback(gl, thermalFbo, canvases.thermal, buffer, imageData, 'image/jpeg');
    renderPass(gl, scene, cam, depthFbo, 'depth', thermalMats, depthMaterial, world.params.light_level);
    const depth = readback(gl, depthFbo, canvases.depth, buffer, imageData, 'image/png');

    const frame: SensorFrame = {
      seq: seq.current++,
      t: performance.now(),
      worldVersion: mission.worldVersion,
      rgbUrl: rgb.url,
      thermalUrl: thermal.url,
      depthUrl: depth.url,
      rgbB64: rgb.base64,
      thermalB64: thermal.base64,
      depthPngB64: depth.base64,
      pose: { x: rover.x, z: rover.z, headingDeg: rover.headingDeg },
    };
    useMissionStore.setState({ frame });
  });

  return null;
}
