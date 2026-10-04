'use client';
/**
 * P1 — the night forest (plan §2, §3a). R3F Canvas with fog, dim moonlight, a heightmap
 * ground, instanced trees/logs/rocks, water, the base marker, the rover with its headlamp,
 * and the ground-truth bodies (survivor, fox, deer) on Three.js layer 1.
 *
 * Layer 1 is hidden from the main camera until `revealTruth` is on (after mission end);
 * the SensorRig camera always sees every layer, so the rover's RGB/thermal frames show
 * the survivor and animals even while the operator view hides them.
 *
 * Every mesh carries `userData.thermal` (0..1) for the thermal pass in SensorRig.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HEADLAMP_RANGE_M, THERMAL_TEMPERATURE } from '@/lib/constants';
import { DEG, dirFromBearing, rayCircle } from '@/lib/geo';
import { stepAnimals, type AnimalState } from '@/lib/world/animals';
import { poseAlongPath, type World } from '@/lib/world/terrain';
import { useMissionStore, useUIStore } from '@/store/missionStore';

export const TRUTH_LAYER = 1;

// ---------------------------------------------------------------------------
// Instancing helper
// ---------------------------------------------------------------------------

function Instances({
  count,
  geometry,
  material,
  setup,
  thermal,
  layers,
}: {
  count: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  setup: (i: number, o: THREE.Object3D) => void;
  thermal: number;
  layers?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      setup(i, dummy);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    if (layers !== undefined) m.layers.set(layers);
  }, [count, setup, layers]);
  if (count === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, count]} userData={{ thermal }} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Static world
// ---------------------------------------------------------------------------

function Ground({ world }: { world: World }) {
  const geom = useMemo(() => {
    const size = world.halfSize * 2 + 40;
    const seg = 150;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, world.heightAt(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, [world]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} userData={{ thermal: THERMAL_TEMPERATURE.ground }}>
      <meshStandardMaterial color="#33402e" roughness={1} />
    </mesh>
  );
}

function Trails({ world }: { world: World }) {
  const pts = useMemo(() => world.truth.trails.flat(), [world]);
  const geom = useMemo(() => new THREE.CircleGeometry(1.7, 10).rotateX(-Math.PI / 2), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a4a35', roughness: 1 }), []);
  const setup = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const p = pts[i];
      o.position.set(p.x, world.heightAt(p.x, p.z) + 0.03, p.z);
    },
    [pts, world],
  );
  return <Instances count={pts.length} geometry={geom} material={mat} setup={setup} thermal={THERMAL_TEMPERATURE.ground} />;
}

function Trees({ world }: { world: World }) {
  const trunkGeom = useMemo(() => new THREE.CylinderGeometry(0.7, 1, 1, 6), []);
  const canopyGeom = useMemo(() => new THREE.ConeGeometry(1, 1, 7), []);
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4b34', roughness: 1 }), []);
  const canopyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f5c38', roughness: 1 }), []);
  const trunks = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const t = world.trees[i];
      const y = world.heightAt(t.x, t.z);
      const trunkH = t.h * 0.35;
      o.position.set(t.x, y + trunkH / 2, t.z);
      o.scale.set(t.r, trunkH, t.r);
    },
    [world],
  );
  const canopies = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const t = world.trees[i];
      const y = world.heightAt(t.x, t.z);
      const trunkH = t.h * 0.35;
      const canopyH = t.h - trunkH + 1;
      o.position.set(t.x, y + trunkH + canopyH / 2 - 0.5, t.z);
      o.scale.set(t.canopyR, canopyH, t.canopyR);
    },
    [world],
  );
  return (
    <>
      <Instances count={world.trees.length} geometry={trunkGeom} material={trunkMat} setup={trunks} thermal={THERMAL_TEMPERATURE.tree} />
      <Instances count={world.trees.length} geometry={canopyGeom} material={canopyMat} setup={canopies} thermal={THERMAL_TEMPERATURE.tree} />
    </>
  );
}

function Logs({ world }: { world: World }) {
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6e5038', roughness: 1 }), []);
  const setup = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const l = world.logs[i];
      o.position.set(l.x, world.heightAt(l.x, l.z) + l.r, l.z);
      o.rotation.y = -l.angleDeg * DEG;
      o.scale.set(l.r * 2, l.r * 2, l.lengthM);
    },
    [world],
  );
  return <Instances count={world.logs.length} geometry={geom} material={mat} setup={setup} thermal={THERMAL_TEMPERATURE.log} />;
}

function Rocks({ world }: { world: World }) {
  const geom = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a9099', roughness: 0.9 }), []);
  const setup = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const r = world.rocks[i];
      o.position.set(r.x, world.heightAt(r.x, r.z) + r.r * 0.5, r.z);
      o.rotation.set(i * 0.7, i * 1.3, 0);
      o.scale.set(r.r, r.r * 0.8, r.r);
    },
    [world],
  );
  return <Instances count={world.rocks.length} geometry={geom} material={mat} setup={setup} thermal={THERMAL_TEMPERATURE.rock} />;
}

function WaterMesh({ world }: { world: World }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b6a9c', roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85 }), []);
  const boxGeom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const w = world.water;
  const segs = useMemo(() => {
    if (!w || w.kind !== 'creek') return [] as { x: number; z: number; len: number; bearing: number }[];
    const out: { x: number; z: number; len: number; bearing: number }[] = [];
    for (let i = 1; i < w.polyline.length; i++) {
      const a = w.polyline[i - 1];
      const b = w.polyline[i];
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len: Math.hypot(b.x - a.x, b.z - a.z) + 0.6, bearing: (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI });
    }
    return out;
  }, [w]);
  const setup = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const s = segs[i];
      const width = w && w.kind === 'creek' ? w.widthM : 3;
      o.position.set(s.x, world.heightAt(s.x, s.z) + 0.04, s.z);
      o.rotation.y = -s.bearing * DEG;
      o.scale.set(width, 0.06, s.len);
    },
    [segs, w, world],
  );
  if (!w) return null;
  if (w.kind === 'pond') {
    return (
      <mesh position={[w.x, world.heightAt(w.x, w.z) + 0.05, w.z]} rotation={[-Math.PI / 2, 0, 0]} material={mat} userData={{ thermal: THERMAL_TEMPERATURE.water }}>
        <circleGeometry args={[w.r, 24]} />
      </mesh>
    );
  }
  return <Instances count={segs.length} geometry={boxGeom} material={mat} setup={setup} thermal={THERMAL_TEMPERATURE.water} />;
}

function Fungi({ world }: { world: World }) {
  const geom = useMemo(() => new THREE.SphereGeometry(0.18, 8, 6), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6ff5ff', emissive: '#3fd9ff', emissiveIntensity: 2.5 }), []);
  const all = useMemo(() => world.fungi.flatMap((p) => p.mushrooms), [world]);
  const setup = useMemo(
    () => (i: number, o: THREE.Object3D) => {
      const m = all[i];
      o.position.set(m.x, world.heightAt(m.x, m.z) + 0.15, m.z);
    },
    [all, world],
  );
  return (
    <>
      <Instances count={all.length} geometry={geom} material={mat} setup={setup} thermal={THERMAL_TEMPERATURE.fungi} />
      {world.fungi.map((p, i) => (
        <pointLight key={i} position={[p.x, world.heightAt(p.x, p.z) + 0.6, p.z]} color="#4fe0ff" intensity={6} distance={7} decay={2} />
      ))}
    </>
  );
}

function BaseMarker({ world }: { world: World }) {
  const y = world.heightAt(0, 0);
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, 1.2, 0]} userData={{ thermal: THERMAL_TEMPERATURE.base }}>
        <cylinderGeometry args={[0.06, 0.06, 2.4, 6]} />
        <meshStandardMaterial color="#9aa0a6" />
      </mesh>
      <mesh position={[0, 2.5, 0]} userData={{ thermal: THERMAL_TEMPERATURE.base }}>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff8c1a" emissiveIntensity={3} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ thermal: THERMAL_TEMPERATURE.base }}>
        <ringGeometry args={[1.4, 1.7, 32]} />
        <meshStandardMaterial color="#ff9f3a" emissive="#ff8c1a" emissiveIntensity={1.2} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 2.6, 0]} color="#ffb060" intensity={10} distance={14} decay={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rover
// ---------------------------------------------------------------------------

/** World-space pose of the rover body (shared with the SensorRig). */
export function roverWorldPose(world: World, r: { x: number; z: number; headingDeg: number }) {
  return { x: r.x, y: world.heightAt(r.x, r.z), z: r.z, rotY: -r.headingDeg * DEG };
}

function Rover({ world }: { world: World }) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const p = roverWorldPose(world, useMissionStore.getState().rover);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rotY;
  });
  return (
    <group ref={group}>
      <mesh position={[0, 0.32, 0]} userData={{ thermal: 0.45 }}>
        <boxGeometry args={[0.8, 0.36, 1.15]} />
        <meshStandardMaterial color="#c9cdd3" roughness={0.6} metalness={0.3} />
      </mesh>
      {[-0.42, 0.42].flatMap((x) =>
        [-0.38, 0.38].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.17, z]} rotation={[0, 0, Math.PI / 2]} userData={{ thermal: 0.35 }}>
            <cylinderGeometry args={[0.17, 0.17, 0.14, 10]} />
            <meshStandardMaterial color="#1e1f22" roughness={1} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.62, -0.1]} userData={{ thermal: 0.5 }}>
        <boxGeometry args={[0.28, 0.22, 0.3]} />
        <meshStandardMaterial color="#3b4149" />
      </mesh>
      <mesh position={[0, 0.62, -0.26]} userData={{ thermal: 0.6 }}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial color="#fff6d8" emissive="#fff2c0" emissiveIntensity={6} />
      </mesh>
      <spotLight
        ref={light}
        position={[0, 0.64, -0.3]}
        angle={0.78}
        penumbra={0.55}
        intensity={520}
        distance={HEADLAMP_RANGE_M * 2}
        decay={1.6}
        color="#fff0c8"
      />
      <object3D ref={target} position={[0, 0.1, -HEADLAMP_RANGE_M]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ground truth bodies (layer 1)
// ---------------------------------------------------------------------------

function Survivor({ world }: { world: World }) {
  const s = world.truth.survivor;
  const y = world.heightAt(s.x, s.z);
  const rotY = -s.headingDeg * DEG;
  const t = THERMAL_TEMPERATURE.person;
  const inDitch = s.situation === 'ditch';
  return (
    <group position={[s.x, y, s.z]} rotation={[0, rotY, 0]}>
      {inDitch && (
        <>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ thermal: THERMAL_TEMPERATURE.ground }}>
            <planeGeometry args={[3.2, 8]} />
            <meshStandardMaterial color="#2a2418" roughness={1} />
          </mesh>
          <mesh position={[1.55, 0.95, 0]} userData={{ thermal: THERMAL_TEMPERATURE.ground }}>
            <boxGeometry args={[0.7, 0.7, 8]} />
            <meshStandardMaterial color="#6a5538" roughness={1} />
          </mesh>
          <mesh position={[-1.55, 0.95, 0]} userData={{ thermal: THERMAL_TEMPERATURE.ground }}>
            <boxGeometry args={[0.7, 0.7, 8]} />
            <meshStandardMaterial color="#6a5538" roughness={1} />
          </mesh>
        </>
      )}
      {/* seated, or lowered in the ditch: legs forward, torso upright, head */}
      <mesh position={[0, inDitch ? 0.05 : 0.2, -0.35]} userData={{ thermal: t }}>
        <boxGeometry args={[0.42, 0.22, 0.7]} />
        <meshStandardMaterial color="#2f3f6b" />
      </mesh>
      <mesh position={[0, inDitch ? 0.42 : 0.65, 0]} userData={{ thermal: t }}>
        <boxGeometry args={[0.5, 0.7, 0.32]} />
        <meshStandardMaterial color="#e8641b" />
      </mesh>
      <mesh position={[0, inDitch ? 0.5 : 0.72, -0.17]} userData={{ thermal: t }}>
        <boxGeometry args={[0.52, 0.05, 0.02]} />
        <meshStandardMaterial color="#ffffff" emissive="#dfe8ff" emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[0, inDitch ? 0.28 : 0.5, -0.17]} userData={{ thermal: t }}>
        <boxGeometry args={[0.52, 0.05, 0.02]} />
        <meshStandardMaterial color="#ffffff" emissive="#dfe8ff" emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[0, inDitch ? 0.85 : 1.15, 0]} userData={{ thermal: t }}>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color="#d9a37e" />
      </mesh>
    </group>
  );
}

function Cars({ world }: { world: World }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    world.cars.forEach((car, i) => {
      const g = refs.current[i];
      if (!g) return;
      const pose = poseAlongPath(car.path, car.offsetM + clock.elapsedTime * car.speedMps);
      g.position.set(pose.x, world.heightAt(pose.x, pose.z), pose.z);
      g.rotation.y = -pose.headingDeg * DEG;
    });
  });
  if (world.cars.length === 0) return null;
  return (
    <>
      {world.cars.map((car, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <mesh position={[0, 0.55, 0]} userData={{ thermal: 0.35 }}>
            <boxGeometry args={[1.7, 0.7, 4.2]} />
            <meshStandardMaterial color={car.color} metalness={0.45} roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.05, -0.15]} userData={{ thermal: 0.3 }}>
            <boxGeometry args={[1.45, 0.5, 1.7]} />
            <meshStandardMaterial color="#d5e2ee" metalness={0.15} roughness={0.15} />
          </mesh>
          {[
            [-0.85, 1.25],
            [0.85, 1.25],
            [-0.85, -1.25],
            [0.85, -1.25],
          ].map(([x, z]) => (
            <mesh key={`${x}${z}`} position={[x, 0.28, z]} rotation={[0, 0, Math.PI / 2]} userData={{ thermal: 0.2 }}>
              <cylinderGeometry args={[0.32, 0.32, 0.28, 10]} />
              <meshStandardMaterial color="#1a1a1a" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

function Animals({ world }: { world: World }) {
  const refs = useRef<Map<string, THREE.Group>>(new Map());
  const animals = useMissionStore((s) => s.animals);
  const sim = useRef<AnimalState[]>([]);
  useLayoutEffect(() => {
    sim.current = animals.map((a) => ({ ...a }));
  }, [animals]);
  useFrame((_, dt) => {
    const s = useMissionStore.getState();
    const live = s.status === 'running' || s.status === 'waiting_for_gemini';
    const list = live ? s.animals : stepAnimals(sim.current, s.rover, Math.min(0.05, dt));
    if (!live) sim.current = list;
    for (const a of list) {
      const g = refs.current.get(a.id);
      if (!g) continue;
      g.position.set(a.x, world.heightAt(a.x, a.z), a.z);
      g.rotation.y = -a.headingDeg * DEG;
    }
  });
  return (
    <>
      {animals.map((a) => (
        <group
          key={a.id}
          ref={(el) => {
            if (el) refs.current.set(a.id, el);
            else refs.current.delete(a.id);
          }}
        >
          <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ thermal: a.kind === 'deer' ? THERMAL_TEMPERATURE.deer : THERMAL_TEMPERATURE.fox }}>
            <circleGeometry args={[a.kind === 'deer' ? 1.5 : 0.95, 14]} />
            <meshBasicMaterial color={a.kind === 'deer' ? '#8d5a32' : '#e07040'} />
          </mesh>
          {a.kind === 'fox' ? (
            <>
              <mesh position={[0, 0.22, 0]} userData={{ thermal: THERMAL_TEMPERATURE.fox }}>
                <boxGeometry args={[0.22, 0.24, 0.6]} />
                <meshStandardMaterial color="#b4542a" />
              </mesh>
              <mesh position={[0, 0.34, -0.33]} userData={{ thermal: THERMAL_TEMPERATURE.fox }}>
                <boxGeometry args={[0.16, 0.16, 0.2]} />
                <meshStandardMaterial color="#c9683a" />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.95, 0]} userData={{ thermal: THERMAL_TEMPERATURE.deer }}>
                <boxGeometry args={[0.5, 0.6, 1.3]} />
                <meshStandardMaterial color="#6b4b32" />
              </mesh>
              <mesh position={[0, 1.45, -0.75]} userData={{ thermal: THERMAL_TEMPERATURE.deer }}>
                <boxGeometry args={[0.22, 0.5, 0.3]} />
                <meshStandardMaterial color="#75543a" />
              </mesh>
              {[-0.18, 0.18].flatMap((x) =>
                [-0.45, 0.45].map((z) => (
                  <mesh key={`${x}${z}`} position={[x, 0.33, z]} userData={{ thermal: THERMAL_TEMPERATURE.deer }}>
                    <boxGeometry args={[0.1, 0.66, 0.1]} />
                    <meshStandardMaterial color="#5a3f2a" />
                  </mesh>
                )),
              )}
            </>
          )}
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera + layer control
// ---------------------------------------------------------------------------

const CAM_BACK_M = 9;
const CAM_MIN_BACK_M = 2.5;

/**
 * Third-person follow camera. Trees between the rover and the camera would fill the view
 * with canopy, so the back distance is clamped to the first tree footprint hit by a 2D ray
 * cast backwards from the rover (camera collision, plan §2 "third-person view").
 */
export function FollowCamera({ world }: { world: World }) {
  const camera = useThree((s) => s.camera);
  const look = useRef(new THREE.Vector3());
  const want = useRef(new THREE.Vector3());
  const init = useRef(false);
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // First-person mode borrows this camera and changes fov/near; restore the chase lens.
    if (cam.isPerspectiveCamera && (cam.fov !== 60 || cam.near !== 0.5)) {
      cam.fov = 60;
      cam.near = 0.5;
      cam.updateProjectionMatrix();
    }
    const r = useMissionStore.getState().rover;
    const d = dirFromBearing(r.headingDeg);
    const back = { x: -d.x, z: -d.z };
    let dist = CAM_BACK_M;
    for (const t of world.trees) {
      const dx = t.x - r.x;
      const dz = t.z - r.z;
      if (dx * dx + dz * dz > (CAM_BACK_M + t.canopyR) ** 2) continue;
      const hit = rayCircle(r, back, t, t.canopyR + 0.6);
      if (hit !== null && hit - 0.3 < dist) dist = Math.max(CAM_MIN_BACK_M, hit - 0.3);
    }
    const y = world.heightAt(r.x, r.z);
    const camY = y + 2.2 + dist * 0.3;
    want.current.set(r.x - d.x * dist, Math.max(camY, world.heightAt(r.x - d.x * dist, r.z - d.z * dist) + 1.5), r.z - d.z * dist);
    look.current.set(r.x + d.x * 5, y + 1, r.z + d.z * 5);
    if (!init.current) {
      camera.position.copy(want.current);
      init.current = true;
    } else {
      camera.position.lerp(want.current, 0.08);
    }
    camera.lookAt(look.current);
  });
  return null;
}

export function TruthLayerToggle() {
  const revealTruth = useUIStore((s) => s.revealTruth);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (revealTruth) camera.layers.enable(TRUTH_LAYER);
    else camera.layers.disable(TRUTH_LAYER);
  }, [revealTruth, camera]);
  return null;
}

export interface LightLook {
  background: string;
  fog: string;
  ambient: string;
  ambientIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
}

const NIGHT_LOOK = { bg: '#0b1020', fog: '#12182a', ambient: '#9eb0d4', hemiSky: '#3a4f80', hemiGround: '#1a2214', sun: '#b7c6ee', amb: 0.28, hemi: 0.55, sunI: 0.85 };
const EVENING_LOOK = { bg: '#3a2048', fog: '#6a4038', ambient: '#f0c09a', hemiSky: '#e08a55', hemiGround: '#3a2a18', sun: '#ff9944', amb: 0.62, hemi: 0.85, sunI: 1.65 };
const DAY_LOOK = { bg: '#8ec5ef', fog: '#c5dff5', ambient: '#fff8ee', hemiSky: '#d5ecff', hemiGround: '#7ea062', sun: '#fff4dd', amb: 1.2, hemi: 1.15, sunI: 2.45 };

function mixHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Sky and fill lights from light_level (night → evening → day) with a moonlight boost at night. */
export function lightingFor(params: { light_level: number; moonlight: number }): LightLook {
  const level = Math.min(1, Math.max(0, params.light_level));
  const t = level <= 0.5 ? level / 0.5 : (level - 0.5) / 0.5;
  const from = level <= 0.5 ? NIGHT_LOOK : EVENING_LOOK;
  const to = level <= 0.5 ? EVENING_LOOK : DAY_LOOK;
  const nightness = 1 - level;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    background: mixHex(from.bg, to.bg, t),
    fog: mixHex(from.fog, to.fog, t),
    ambient: mixHex(from.ambient, to.ambient, t),
    ambientIntensity: lerp(from.amb, to.amb) + nightness * params.moonlight * 0.25,
    hemiSky: mixHex(from.hemiSky, to.hemiSky, t),
    hemiGround: mixHex(from.hemiGround, to.hemiGround, t),
    hemiIntensity: lerp(from.hemi, to.hemi),
    sun: mixHex(from.sun, to.sun, t),
    sunIntensity: lerp(from.sunI, to.sunI) * (1 + nightness * params.moonlight * 0.85),
  };
}

/** Background + fog must be direct children of the Canvas (`attach` targets the parent). */
export function Sky({ world }: { world: World }) {
  const look = lightingFor(world.params);
  const far = 35 + (1 - world.params.fog_density) * 140;
  return (
    <>
      <color attach="background" args={[look.background]} />
      <fog attach="fog" args={[look.fog, 6, far]} />
    </>
  );
}

export function Atmosphere({ world }: { world: World }) {
  const look = lightingFor(world.params);
  return (
    <>
      <ambientLight intensity={look.ambientIntensity} color={look.ambient} />
      <hemisphereLight args={[look.hemiSky, look.hemiGround, look.hemiIntensity]} />
      <directionalLight position={[60, 90, -40]} intensity={look.sunIntensity} color={look.sun} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Shared night-forest meshes. The map and POV canvases each mount their own copy. */
export function WorldMeshes({ world }: { world: World }) {
  return (
    <>
      <Ground world={world} />
      <Trails world={world} />
      <Trees world={world} />
      <Logs world={world} />
      <Rocks world={world} />
      <WaterMesh world={world} />
      <Fungi world={world} />
      <Cars world={world} />
      <BaseMarker world={world} />
      <Rover world={world} />
      <Survivor world={world} />
      <Animals world={world} />
    </>
  );
}
