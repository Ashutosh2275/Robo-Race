import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { integrateDrive, slopeAt, type DriveState } from './drivePhysics';
import { CONTROL_PRESETS, type ControlTuning, type VehicleTuning } from './driveControls';
import {
  stepVehicle3D,
  applyRecovery,
  getSafeRecoveryAnchor,
  createDefaultRecoveryAnchors,
  type VehiclePose,
  TRACK_WIDTH,
  TRACK_LENGTH,
} from './vehicleDynamics';
import {
  createInitialSubsystems,
  stepSubsystems,
  type SubsystemsState,
  type HazardType,
} from './robotSubsystems';
import {
  UniversalController,
  type ControllerConfig,
} from './universalController';
import {
  MAP_SCALE,
  CHECKPOINTS,
  HILL_NODES,
  evaluateCourseHeight,
  evaluateCourseSurface,
  generateRockFieldStones,
  validateRouteClearance,
  type CourseCollider,
} from './courseLayout';
import './style.css';

const $ = <T extends HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const ui = $<HTMLDivElement>('#ui');
const canvas = $<HTMLCanvasElement>('#game');
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (a: number, b: number, t: number) => a + (b - a) * (1 - Math.exp(-t));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// -------------------------------------------------------------
// 1. Scene, Renderer, Industrial Lighting & PBR Materials
// -------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#222629');
scene.fog = new THREE.Fog('#222629', 45, 120);

const course = new THREE.Group();
course.scale.set(MAP_SCALE, 1, MAP_SCALE);
scene.add(course);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

scene.add(new THREE.HemisphereLight('#e4edf0', '#252926', 1.3));
const sun = new THREE.DirectionalLight('#fff0d4', 2.3);
sun.position.set(-12, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -32;
sun.shadow.camera.right = 32;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.bias = -0.0003;
scene.add(sun);

// Overhead spotlights for industrial arena realism
for (const x of [-16, 0, 16]) {
  const light = new THREE.PointLight('#fff3df', 25, 20, 1.8);
  light.position.set(x, 7.5, 0);
  scene.add(light);
}

const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.1, 150);
camera.position.set(0, 8, 14);

function generateSurfaceTexture(base: string, marks: string[], kind: 'grain' | 'stone' | 'wood' | 'slick') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const a = (i * 73) % 256;
    const b = (i * 151 + 29) % 256;
    x.fillStyle = marks[i % marks.length];
    if (kind === 'grain') {
      x.globalAlpha = 0.28;
      x.fillRect(a, b, 1 + (i % 3), 1);
    } else if (kind === 'stone') {
      x.globalAlpha = 0.55;
      x.beginPath();
      x.ellipse(a, b, 2 + i % 5, 1 + i % 3, (i % 7) * 0.3, 0, Math.PI * 2);
      x.fill();
    } else if (kind === 'wood') {
      x.globalAlpha = 0.35;
      x.lineWidth = 1 + (i % 2);
      x.beginPath();
      x.moveTo(a, 0);
      x.lineTo(a + ((i % 5) - 2) * 4, 256);
      x.stroke();
    } else {
      x.globalAlpha = 0.25;
      x.lineWidth = 2;
      x.beginPath();
      x.ellipse(a, b, 8 + i % 13, 2 + i % 4, (i % 9) * 0.2, 0, Math.PI * 2);
      x.stroke();
    }
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: '#323537', roughness: 0.92, map: generateSurfaceTexture('#323537', ['#404345', '#2a2c2d', '#494c4e'], 'grain') }),
  lane: new THREE.MeshStandardMaterial({ color: '#44484a', roughness: 0.86, map: generateSurfaceTexture('#44484a', ['#4e5356', '#3b3e40'], 'grain') }),
  barrier: new THREE.MeshStandardMaterial({ color: '#e8e5db', roughness: 0.75 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#e5ad2a', roughness: 0.68 }),
  coverYellow: new THREE.MeshStandardMaterial({ color: '#cb9f2a', roughness: 0.82, metalness: 0.08 }),
  black: new THREE.MeshStandardMaterial({ color: '#141719', roughness: 0.72, metalness: 0.18 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#181b19', roughness: 0.95, map: generateSurfaceTexture('#181b19', ['#262b27', '#111312'], 'grain') }),
  metal: new THREE.MeshStandardMaterial({ color: '#556066', roughness: 0.40, metalness: 0.78 }),
  wheel: new THREE.MeshStandardMaterial({ color: '#c4c1b5', roughness: 0.65, metalness: 0.32 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a6045', roughness: 0.86, map: generateSurfaceTexture('#7a6045', ['#8d7254', '#644e37'], 'wood') }),
  red: new THREE.MeshStandardMaterial({ color: '#c33027', roughness: 0.62 }),
  green: new THREE.MeshStandardMaterial({ color: '#88a679', roughness: 0.92 }),
  sand: new THREE.MeshStandardMaterial({ color: '#bca06e', roughness: 0.98, map: generateSurfaceTexture('#bca06e', ['#cca874', '#9e8053'], 'grain') }),
  gravel: new THREE.MeshStandardMaterial({ color: '#808078', roughness: 0.98, map: generateSurfaceTexture('#808078', ['#a5a498', '#66665e'], 'stone') }),
  turf: new THREE.MeshStandardMaterial({ color: '#4e6648', roughness: 0.96 }),
  ice: new THREE.MeshStandardMaterial({ color: '#526162', roughness: 0.16, metalness: 0.45, map: generateSurfaceTexture('#526162', ['#a0b2b4', '#3d4849'], 'slick') }),
  bridge: new THREE.MeshStandardMaterial({ color: '#626b70', roughness: 0.52, metalness: 0.38 }),
  oil: new THREE.MeshStandardMaterial({ color: '#090b0a', roughness: 0.06, metalness: 0.88 }),
  water: new THREE.MeshStandardMaterial({ color: '#2b788a', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.78 }),
  fire: new THREE.MeshStandardMaterial({ color: '#e54d1d', emissive: '#ff5e13', emissiveIntensity: 1.8, roughness: 0.4 }),
};

function box(parent: THREE.Object3D, mat: THREE.Material, p: THREE.Vector3, s: THREE.Vector3, rot = 0, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), mat);
  m.position.copy(p);
  m.rotation.y = rot;
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent: THREE.Object3D, mat: THREE.Material, p: THREE.Vector3, r: number, h: number, axis = 'y', segments = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
  m.position.copy(p);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// -------------------------------------------------------------
// 2. Arena Layout, Walls, and Colliders
// -------------------------------------------------------------
const colliders: CourseCollider[] = [];

function solidBox(id: string, x: number, z: number, w: number, d: number, h: number, mat: THREE.Material, rot = 0, y = h / 2, walkable = false) {
  box(course, mat, V(x, y, z), V(w, h, d), rot);
  colliders.push({ id, x, z, hx: w / 2, hz: d / 2, y, height: h, rot, walkable });
}

// Main Arena Floors
box(course, mats.floor, V(0, -0.24, 0), V(38, 0.45, 30), 0, false);
box(course, mats.lane, V(0, 0.005, 0), V(36, 0.05, 28), 0, false);

// Perimeter Barriers
for (const [id, x, z, w, d] of [
  ['wall_north', 0, -13.82, 36, 0.32],
  ['wall_south', 0, 13.82, 36, 0.32],
  ['wall_west', -18.02, 0, 0.32, 27.5],
  ['wall_east', 18.02, 0, 0.32, 27.5],
] as [string, number, number, number, number][]) {
  solidBox(id, x, z, w, d, 0.78, mats.barrier, 0, 0.39);
}

// Yellow hazard stripes along perimeter
for (let x = -17; x <= 17; x += 2) {
  box(course, mats.yellow, V(x, 0.4, -13.6), V(1.55, 0.16, 0.055));
  box(course, mats.yellow, V(x, 0.4, 13.6), V(1.55, 0.16, 0.055));
}

// Gantry builder
function gantry(x: number, z: number, label: string, color: THREE.Material) {
  solidBox(`gantry_post_${label}_L`, x, z - 2.85, 0.22, 0.22, 2.8, mats.black, 0, 1.4);
  solidBox(`gantry_post_${label}_R`, x, z + 2.85, 0.22, 0.22, 2.8, mats.black, 0, 1.4);
  box(course, color, V(x, 2.65, z), V(0.35, 0.38, 5.9));
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 96;
  const cx = cvs.getContext('2d')!;
  cx.fillStyle = '#171c19';
  cx.fillRect(0, 0, 512, 96);
  cx.fillStyle = '#f0bd53';
  cx.font = '800 45px Arial';
  cx.textAlign = 'center';
  cx.fillText(label, 256, 64);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs) }));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(x, 2.65, z);
  course.add(sign);
}

gantry(-14.2, 8.0, 'START', mats.green);
gantry(-15.0, -12.0, 'FINISH', mats.yellow);

// Slalom Barriers with guaranteed 2.8m clear driving lane
for (let i = 0; i < 5; i++) {
  const x = -9.2 + i * 1.35;
  const z = 8.0 + (i % 2 === 0 ? 1.05 : -1.05);
  solidBox(`slalom_barrier_${i}`, x, z, 1.4, 0.38, 0.78, i % 2 === 0 ? mats.yellow : mats.barrier, 0.06, 0.39);
}

// Speed Breakers (3 rounded bumps)
for (let i = 0; i < 3; i++) {
  const x = -2.1 + i * 1.05;
  const bump = box(course, i % 2 ? mats.yellow : mats.black, V(x, 0.12, 8.0), V(0.42, 0.24, 2.5));
  bump.castShadow = true;
  colliders.push({ id: `speed_breaker_${i}`, x, z: 8.0, hx: 0.42, hz: 1.25, y: 0.12, height: 0.24, rot: 0, walkable: true });
}

// Curved Wooden Ramp (length 3.0, width 3.0, height 0.88)
const rampMesh = box(course, mats.wood, V(4.8, 0.44, 8.0), V(3.0, 0.88, 3.0));
rampMesh.castShadow = true;
colliders.push({ id: 'curved_ramp', x: 4.8, z: 8.0, hx: 1.5, hz: 1.5, y: 0.44, height: 0.88, rot: 0, walkable: true });
for (const side of [-1, 1]) {
  solidBox(`ramp_curb_${side}`, 4.8, 8.0 + side * 1.58, 3.1, 0.16, 0.35, mats.black, 0, 0.95);
}

// Raised Bridge Structure (approach at 7.8, deck at 9.6, descent at 11.4, height 0.62)
const bridgeApproach = box(course, mats.wood, V(7.8, 0.31, 8.0), V(1.6, 0.62, 2.6));
colliders.push({ id: 'bridge_approach', x: 7.8, z: 8.0, hx: 0.8, hz: 1.3, y: 0.31, height: 0.62, rot: 0, walkable: true });

const bridgeDeck = box(course, mats.bridge, V(9.6, 0.50, 8.0), V(2.2, 0.24, 2.6));
colliders.push({ id: 'bridge_deck', x: 9.6, z: 8.0, hx: 1.1, hz: 1.3, y: 0.50, height: 0.24, rot: 0, walkable: true });

const bridgeDescent = box(course, mats.wood, V(11.4, 0.31, 8.0), V(1.6, 0.62, 2.6));
colliders.push({ id: 'bridge_descent', x: 11.4, z: 8.0, hx: 0.8, hz: 1.3, y: 0.31, height: 0.62, rot: 0, walkable: true });

// Bridge Safety Railings
for (const z of [6.65, 9.35]) {
  solidBox(`bridge_rail_${z}`, 9.6, z, 3.8, 0.15, 0.45, mats.black, 0, 0.85);
}
// Bridge support trestles
for (const bx of [8.2, 11.0]) {
  for (const bz of [7.0, 9.0]) {
    cyl(course, mats.metal, V(bx, 0.25, bz), 0.12, 0.5, 'y');
  }
}

// Rotating Steel Disc Platform at x = 10.65, z = 0.1
const discGroup = new THREE.Group();
discGroup.position.set(10.65, 0.15, 0.1);
course.add(discGroup);
cyl(discGroup, mats.metal, V(0, 0, 0), 1.35, 0.2, 'y', 36);
cyl(discGroup, mats.yellow, V(0, 0.105, 0), 1.15, 0.025, 'y', 36);
for (let a = 0; a < 12; a++) {
  const t = a * Math.PI / 6;
  box(discGroup, a % 2 ? mats.black : mats.yellow, V(Math.sin(t) * 0.88, 0.125, Math.cos(t) * 0.88), V(0.09, 0.03, 0.42), t, false);
}

// Sand & Marble Pit at x = 13.45, z = 4.55
box(course, mats.sand, V(13.45, 0.045, 4.55), V(3.3, 0.09, 3.5), 0, false);
for (let i = 0; i < 90; i++) {
  const px = 12.0 + Math.random() * 2.9;
  const pz = 3.0 + Math.random() * 3.1;
  const marble = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.025, 8, 8), i % 4 === 0 ? mats.metal : mats.barrier);
  marble.position.set(px, 0.11, pz);
  marble.castShadow = true;
  course.add(marble);
}

// Mixed Terrain Sections along z ~ 0
box(course, mats.sand, V(5.25, 0.045, 0), V(2.45, 0.09, 2.85), 0, false);
box(course, mats.gravel, V(2.8, 0.045, 0), V(2.45, 0.09, 2.85), 0, false);
box(course, mats.turf, V(0.35, 0.045, 0), V(2.45, 0.09, 2.85), 0, false);
box(course, mats.black, V(-2.1, 0.045, 0), V(2.45, 0.09, 2.85), 0, false);

// Deterministic Rock Field with 3D irregular polyhedral stones
const rockData = generateRockFieldStones(20261027);
const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
for (const rk of rockData) {
  const rockMesh = new THREE.Mesh(rockGeo, mats.gravel);
  rockMesh.position.set(rk.x, rk.y, rk.z);
  rockMesh.scale.set(rk.scaleX, rk.scaleY, rk.scaleZ);
  rockMesh.rotation.set(rk.rotX, rk.rotY, rk.rotZ);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  course.add(rockMesh);
}

// -------------------------------------------------------------
// 3. Mandatory Environmental Hazards: Fire -> Water -> Oil
// -------------------------------------------------------------
// Hazard 1: Fire Zone (x in [-3.8, -1.8], z in [-4.8, -3.2])
const fireFloor = box(course, mats.black, V(-2.8, 0.04, -4.0), V(2.2, 0.06, 2.2));
box(course, mats.yellow, V(-2.8, 0.05, -4.0), V(2.4, 0.02, 2.4), 0, false);
const fireFlames: THREE.Mesh[] = [];
for (let f = 0; f < 6; f++) {
  const fx = -3.5 + f * 0.28;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 8), mats.fire);
  flame.position.set(fx, 0.32, -4.0 + (f % 2 === 0 ? 0.3 : -0.3));
  course.add(flame);
  fireFlames.push(flame);
}
const fireLight = new THREE.PointLight('#ff6a1a', 15, 6, 1.5);
fireLight.position.set(-2.8, 0.9, -4.0);
scene.add(fireLight);

// Short Clean Transition Deck at x = -4.6, z = -4.0
box(course, mats.metal, V(-4.6, 0.05, -4.0), V(1.4, 0.08, 2.2));

// Hazard 2: Water Cooling Basin (x in [-7.5, -5.5], z in [-4.8, -3.2])
const waterPool = box(course, mats.water, V(-6.5, 0.06, -4.0), V(2.2, 0.06, 2.2));
waterPool.castShadow = false;
box(course, mats.metal, V(-6.5, 0.02, -4.0), V(2.35, 0.04, 2.35), 0, false);

// Hazard 3: Oil Slicks (x in [-10.5, -8.0], z in [-4.8, -3.2])
box(course, mats.oil, V(-9.25, 0.045, -4.0), V(2.6, 0.02, 2.4), 0, false);

// -------------------------------------------------------------
// 4. Switchback Climbing Hill (Part 7)
// -------------------------------------------------------------
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  const a = HILL_NODES[i];
  const b = HILL_NODES[i + 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const midZ = (a.z + b.z) / 2;
  const w = 2.8; // Generous 2.8m climbing width

  const segMesh = box(course, mats.wood, V(midX, midY, midZ), V(Math.abs(dx) || w, 0.16, Math.abs(dz) || w));
  colliders.push({
    id: `hill_seg_${i}`,
    x: midX,
    z: midZ,
    hx: (Math.abs(dx) || w) / 2,
    hz: (Math.abs(dz) || w) / 2,
    y: midY,
    height: 0.16,
    rot: 0,
    walkable: true,
  });

  // Guardrails along outer edges of the hill
  if (Math.abs(dz) < 0.01) {
    for (const side of [-1, 1]) {
      const rail = box(course, mats.black, V(midX, midY + 0.22, midZ + side * (w / 2 + 0.06)), V(len, 0.24, 0.12));
      rail.rotation.z = Math.atan2(b.y - a.y, dx);
    }
  } else if (Math.abs(dx) < 0.01) {
    for (const side of [-1, 1]) {
      const rail = box(course, mats.black, V(midX + side * (w / 2 + 0.06), midY + 0.22, midZ), V(0.12, 0.24, len));
      rail.rotation.x = -Math.atan2(b.y - a.y, dz);
    }
  }
}

// -------------------------------------------------------------
// 5. Corrected Parallel Plank Bridge (spacing matches 1.58m track width)
// -------------------------------------------------------------
// Track centers: left plank at z = -8.49, right plank at z = -6.91
box(course, mats.wood, V(-7.35, 0.21, -8.49), V(4.2, 0.18, 0.65));
box(course, mats.black, V(-7.35, 0.10, -8.49), V(4.25, 0.05, 0.70));
colliders.push({ id: 'parallel_plank_left', x: -7.35, z: -8.49, hx: 2.1, hz: 0.35, y: 0.21, height: 0.18, rot: 0, walkable: true });

box(course, mats.wood, V(-7.35, 0.21, -6.91), V(4.2, 0.18, 0.65));
box(course, mats.black, V(-7.35, 0.10, -6.91), V(4.25, 0.05, 0.70));
colliders.push({ id: 'parallel_plank_right', x: -7.35, z: -6.91, hx: 2.1, hz: 0.35, y: 0.21, height: 0.18, rot: 0, walkable: true });

// Checkered finish straight
for (let ix = 0; ix < 8; ix++) {
  for (let iz = 0; iz < 4; iz++) {
    box(course, (ix + iz) % 2 ? mats.black : mats.barrier, V(-15 + ix * 0.28, 0.045, -12 + iz * 0.28), V(0.28, 0.025, 0.28), 0, false);
  }
}

// -------------------------------------------------------------
// 6. Checkpoint Gates & Recovery Anchors
// -------------------------------------------------------------
const checkpointMeshes = CHECKPOINTS.map((cp, i) => {
  const g = new THREE.Group();
  g.position.set(cp.x, 0.02, cp.z);
  g.rotation.y = cp.yaw;
  course.add(g);

  // Crossbar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(cp.width, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: i === 0 ? '#f3c85f' : '#88a679', transparent: true, opacity: 0.6 }));
  bar.position.y = 0.035;
  g.add(bar);

  // Side posts
  for (const px of [-cp.width / 2 + 0.1, cp.width / 2 - 0.1]) {
    cyl(g, mats.metal, V(px, 0.32, 0), 0.09, 0.64, 'y');
  }

  // Illuminated Sign
  const cvs = document.createElement('canvas');
  cvs.width = 96;
  cvs.height = 64;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#171e19';
  ctx.fillRect(0, 0, 96, 64);
  ctx.fillStyle = '#f0bd53';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(String(cp.id).padStart(2, '0'), 48, 45);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.30), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs), side: THREE.DoubleSide }));
  signMesh.position.set(0, 0.72, 0);
  g.add(signMesh);

  return {
    ...cp,
    worldX: cp.x * MAP_SCALE,
    worldZ: cp.z * MAP_SCALE,
    group: g,
    bar,
    passed: false,
  };
});

const recoveryAnchors = createDefaultRecoveryAnchors(MAP_SCALE);

// -------------------------------------------------------------
// 7. Fixed Rigid Robot Model with Realistic Mechatronics (Part 3)
// -------------------------------------------------------------
const robot = new THREE.Group();
scene.add(robot);

// RIGID CENTRAL CHASSIS: strictly un-morphed, locked scale (1,1,1)
const chassis = new THREE.Group();
robot.add(chassis);

// Main bottom chassis tray
box(chassis, mats.black, V(0, 0.38, 0), V(1.36, 0.18, 1.52));

// Perimeter metal rails leaving top bay open as photographed
for (const x of [-0.60, 0.60]) {
  box(chassis, mats.metal, V(x, 0.58, 0), V(0.06, 0.22, 1.46));
}
for (const z of [-0.70, 0.70]) {
  box(chassis, mats.metal, V(0, 0.58, z), V(1.22, 0.22, 0.06));
}

// Mechatronics in the open bay:
// 1. 4S LiPo Battery pack (blue wrapped rectangular block with warning label)
const batteryMesh = box(chassis, new THREE.MeshStandardMaterial({ color: '#2b5ea8', roughness: 0.65 }), V(-0.24, 0.52, -0.05), V(0.48, 0.16, 0.72));
box(chassis, mats.yellow, V(-0.24, 0.605, -0.05), V(0.24, 0.015, 0.4)); // Battery label

// 2. Dual Brushless Motors (left and right with cooling ribs)
cyl(chassis, mats.metal, V(-0.46, 0.44, -0.48), 0.13, 0.30, 'z');
cyl(chassis, mats.metal, V(0.46, 0.44, -0.48), 0.13, 0.30, 'z');

// 3. Dual ESCs with anodized heat sinks
for (const x of [-0.18, 0.18]) {
  box(chassis, new THREE.MeshStandardMaterial({ color: '#882222', roughness: 0.4, metalness: 0.8 }), V(x, 0.51, 0.42), V(0.26, 0.08, 0.24));
}

// 4. 2.4GHz Radio Receiver with dual antennas
box(chassis, mats.black, V(0.28, 0.50, -0.08), V(0.26, 0.08, 0.24));
cyl(chassis, mats.black, V(0.25, 0.78, -0.08), 0.012, 0.52, 'y');
cyl(chassis, mats.black, V(0.31, 0.78, -0.08), 0.012, 0.52, 'y');

// 5. Silicone power cables and XT60 connector
cyl(chassis, mats.red, V(-0.04, 0.56, 0.15), 0.015, 0.38, 'z');
cyl(chassis, mats.black, V(0.04, 0.56, 0.15), 0.015, 0.38, 'z');
box(chassis, mats.yellow, V(0, 0.56, 0.32), V(0.06, 0.04, 0.08)); // XT60

// Track Assemblies and Yellow Protective Coverings
const trackCovers: THREE.Mesh[] = [];
const tracks: { group: THREE.Group; cleats: THREE.Mesh[]; rollers: THREE.Mesh[]; phase: number }[] = [];

for (const side of [-1, 1]) {
  const x = side * (TRACK_WIDTH / 2);
  const trackGroup = new THREE.Group();
  trackGroup.position.x = x;
  robot.add(trackGroup);

  // Authentic yellow protective track guard
  const guard = box(robot, mats.coverYellow, V(x, 0.68, 0), V(0.40, 0.14, 1.70));
  const outerSkirt = box(robot, mats.coverYellow, V(x, 0.56, 0), V(0.40, 0.12, 1.58));
  trackCovers.push(guard, outerSkirt);

  // Black continuous rubber belt loop
  box(trackGroup, mats.rubber, V(0, 0.32, 0), V(0.34, 0.42, 1.78), 0);

  // Pale circular exposed end wheels (drive sprocket & idler)
  for (const end of [-1, 1]) {
    cyl(trackGroup, mats.wheel, V(0, 0.32, end * 0.76), 0.21, 0.36, 'x', 24);
  }

  // Intermediate road wheels
  const rollerList: THREE.Mesh[] = [];
  for (const z of [-0.42, 0, 0.42]) {
    const r = cyl(trackGroup, mats.wheel, V(0, 0.32, z), 0.17, 0.35, 'x', 18);
    rollerList.push(r);
  }

  // Track cleats (treads) that animate along stadium path
  const cleats: THREE.Mesh[] = [];
  const cleatGeo = new THREE.BoxGeometry(0.35, 0.035, 0.12);
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2;
    const q = new THREE.Mesh(cleatGeo, mats.black);
    q.position.set(0, 0.32 + Math.sin(t) * 0.18, Math.cos(t) * 0.74);
    q.rotation.x = -Math.atan2(Math.cos(t) * 0.18, -Math.sin(t) * 0.74);
    q.castShadow = true;
    trackGroup.add(q);
    cleats.push(q);
  }

  tracks.push({ group: trackGroup, cleats, rollers: rollerList, phase: 0 });
}

// Contact shadow beneath robot
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.96, 24),
  new THREE.MeshBasicMaterial({ color: '#0d100e', transparent: true, opacity: 0.32, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.14;
robot.add(shadow);

// Dust Particle System
const dustGeo = new THREE.SphereGeometry(0.08, 6, 5);
const dustMat = new THREE.MeshBasicMaterial({ color: '#c2b395', transparent: true, opacity: 0.35, depthWrite: false });
const dustParticles: Array<{ mesh: THREE.Mesh; life: number }> = [];
for (let i = 0; i < 20; i++) {
  const m = new THREE.Mesh(dustGeo, dustMat);
  m.visible = false;
  scene.add(m);
  dustParticles.push({ mesh: m, life: 0 });
}

// -------------------------------------------------------------
// 8. Vehicle Physics & Subsystems Simulation Setup
// -------------------------------------------------------------
type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
const savedPrefs = (() => {
  try {
    return JSON.parse(localStorage.getItem('robo-race-profile-v2') || '{}');
  } catch {
    return {};
  }
})();

const config = {
  difficulty: (['Beginner', 'Intermediate', 'Advanced', 'Expert'].includes(savedPrefs.difficulty) ? savedPrefs.difficulty : 'Intermediate') as Difficulty,
  quality: (['Low', 'Balanced', 'High', 'Ultra'].includes(savedPrefs.quality) ? savedPrefs.quality : 'Balanced') as string,
  controlMode: (['single_stick', 'tank_dual_stick'].includes(savedPrefs.controlMode) ? savedPrefs.controlMode : 'single_stick') as 'single_stick' | 'tank_dual_stick',
  raceDuration: Number(savedPrefs.raceDuration ?? 300),
  penalty: Number(savedPrefs.penalty ?? 6),
  deadzone: Number(savedPrefs.deadzone ?? 0.08),
  expo: Number(savedPrefs.expo ?? 0.20),
  sensitivity: Number(savedPrefs.sensitivity ?? 1.0),
  preset: (['Low', 'Medium', 'High', 'Custom'].includes(savedPrefs.preset) ? savedPrefs.preset : 'Medium') as 'Low' | 'Medium' | 'High' | 'Custom',
};

const tuning: VehicleTuning = {
  ...CONTROL_PRESETS[config.preset === 'Custom' ? 'Medium' : config.preset],
};

const controller = new UniversalController({
  mode: config.controlMode,
  deadzone: config.deadzone,
  expo: config.expo,
  sensitivity: config.sensitivity,
  invertThrottle: false,
  invertSteering: false,
}, tuning);

const startAnchor = recoveryAnchors[0];
const pose: VehiclePose = {
  x: startAnchor.x,
  y: startAnchor.y,
  z: startAnchor.z,
  vx: 0,
  vy: 0,
  vz: 0,
  pitch: 0,
  yaw: startAnchor.yaw,
  roll: 0,
  pitchRate: 0,
  yawRate: 0,
  rollRate: 0,
  isFlipped: false,
  isGrounded: true,
  flippedTimer: 0,
};

const motionState: DriveState = {
  x: pose.x,
  z: pose.z,
  vx: 0,
  vz: 0,
  yaw: pose.yaw,
  angular: 0,
};

let subsystems: SubsystemsState = createInitialSubsystems();
let raceState: 'menu' | 'countdown' | 'racing' | 'paused' | 'finished' | 'failed' = 'menu';
let elapsed = 0;
let penaltyTime = 0;
let countdown = 0;
let currentCheckpoint = 0;
let cameraMode = 0; // 0: Chase, 1: Low Bumper, 2: Tactical Overhead, 3: Orbit Inspection
let bestTime = Number(localStorage.getItem('robo-race-best-v2') || '0');
let toastTimer = 0;
let recoveryCooldown = 0;
let audioCtx: AudioContext | undefined;
let cutawayMode = false;
let drivingHudVisible = false;

function tone(freq: number, duration = 0.12, volume = 0.04) {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {}
}

function displayToast(msg: string) {
  const t = $<HTMLDivElement>('.toast');
  if (t) {
    t.textContent = msg;
    t.classList.add('show');
    toastTimer = 1.5;
  }
}

function savePreferences() {
  localStorage.setItem('robo-race-profile-v2', JSON.stringify({
    version: 2,
    difficulty: config.difficulty,
    quality: config.quality,
    controlMode: config.controlMode,
    raceDuration: config.raceDuration,
    penalty: config.penalty,
    deadzone: config.deadzone,
    expo: config.expo,
    sensitivity: config.sensitivity,
    preset: config.preset,
  }));
}

// -------------------------------------------------------------
// 9. UI, HUD, and Interaction Panels
// -------------------------------------------------------------
function renderUI() {
  ui.innerHTML = `
    <div class="topbar">
      <div class="brand"><b>●</b> ROBO RACE <span style="color:#aab4a8">/ 3D</span></div>
      <div class="hud">
        <div class="pill"><small>TIME</small><strong id="time">00:00.00</strong></div>
        <div class="pill"><small>GATES</small><strong id="gates">00 / 11</strong></div>
        <div class="pill"><small>SPEED</small><strong id="speed">0.0 <span style="font-size:9px">m/s</span></strong></div>
        <div class="pill" id="pillBat"><small>BATTERY</small><strong id="bat">100%</strong></div>
        <div class="pill" id="pillMot"><small>MOTOR</small><strong id="mot">28°C</strong></div>
        <div class="pill" id="pillHlt"><small>HEALTH</small><strong id="hlt">100%</strong></div>
      </div>
    </div>
    <div class="progress" id="next">PASS GATE <i>01</i> IN ORDER</div>
    <div id="rolloverAlert" class="rollover-banner hidden">⚠️ ROBOT OVERTURNED · PRESS [R] TO RECOVER</div>
    <div class="toolbar">
      <button class="iconbtn" id="pause">Ⅱ PAUSE</button>
      <button class="iconbtn" id="camera">◉ CAMERA</button>
      <button class="iconbtn" id="recover">↻ RECOVER · R</button>
      <button class="iconbtn" id="cutaway">⚙ CUTAWAY</button>
      <button class="iconbtn" id="settingsBtn">⚙ SETTINGS</button>
    </div>
    <div class="controls">
      KEYBOARD&nbsp; <kbd>W</kbd><kbd>S</kbd> DRIVE &nbsp; <kbd>A</kbd> LEFT · <kbd>D</kbd> RIGHT &nbsp; <kbd>SPACE</kbd> BRAKE &nbsp; <kbd>R</kbd> RECOVER &nbsp; <kbd>C</kbd> CAMERA &nbsp; <kbd>ESC</kbd> PAUSE
    </div>
    <div class="toast"></div>
    <div class="mobile-controls">
      <div class="joystick left" data-stick="left"><div class="joy-center"></div><div class="joy-knob"></div><div class="joy-label">LEFT TRACK</div></div>
      <div class="joystick right" data-stick="right"><div class="joy-center"></div><div class="joy-knob"></div><div class="joy-label">RIGHT TRACK</div></div>
      <div class="mobile-buttons">
        <button class="iconbtn" id="brake">BRAKE</button>
        <button class="iconbtn" id="mobRecover">RECOVER</button>
        <button class="iconbtn" id="restart">RESET</button>
      </div>
    </div>
    <div id="overlay"></div>
    <div id="settings" class="settings hidden">
      <b>SIMULATION SETTINGS</b>
      <label>Controller Mode
        <select id="controlMode">
          <option value="single_stick">Single Stick / Universal</option>
          <option value="tank_dual_stick">Dual Stick (Tank Mode)</option>
        </select>
      </label>
      <label>Tuning Preset
        <select id="preset">
          <option>Low</option><option selected>Medium</option><option>High</option><option>Custom</option>
        </select>
      </label>
      <label>Drive Sensitivity <input id="sens" type="range" min="0.4" max="1.6" step="0.05" value="1.0"></label>
      <label>Stick Deadzone <input id="dead" type="range" min="0" max="0.25" step="0.01" value="0.08"></label>
      <label>Stick Expo <input id="expo" type="range" min="0" max="0.6" step="0.05" value="0.20"></label>
      <label>Difficulty
        <select id="difficulty">
          <option>Beginner</option><option selected>Intermediate</option><option>Advanced</option><option>Expert</option>
        </select>
      </label>
      <label>Race Duration
        <select id="duration">
          <option value="120">2 minutes</option>
          <option value="180">3 minutes</option>
          <option value="300" selected>5 minutes</option>
          <option value="480">8 minutes</option>
          <option value="600">10 minutes</option>
        </select>
      </label>
      <label>Graphics Quality
        <select id="quality">
          <option>Low</option><option selected>Balanced</option><option>High</option><option>Ultra</option>
        </select>
      </label>
      <div class="control-diagram">
        <b>DIFFERENTIAL CONTROLS:</b><br>
        W: Forward · S: Reverse<br>
        A: Always left relative to heading<br>
        D: Always right relative to heading<br>
        W+A / S+A: Left arcs (nose rotates left)<br>
        W+D / S+D: Right arcs (nose rotates right)<br>
        Space: Mechanical brake · R: Safe checkpoint recovery
      </div>
    </div>
    <div id="driveTelemetry" class="drive-telemetry hidden"></div>
  `;

  // Attach button events
  $('#pause').addEventListener('click', togglePause);
  $('#camera').addEventListener('click', cycleCamera);
  $('#recover').addEventListener('click', recoverVehicle);
  $('#settingsBtn').addEventListener('click', () => { controller.neutralize(); $('#settings').classList.toggle('hidden'); });
  $('#cutaway').addEventListener('click', toggleCutaway);
  $('#restart')?.addEventListener('click', restartRace);
  $('#mobRecover')?.addEventListener('click', recoverVehicle);

  $('#controlMode').addEventListener('change', e => {
    config.controlMode = (e.target as HTMLSelectElement).value as 'single_stick' | 'tank_dual_stick';
    controller.updateConfig({ mode: config.controlMode });
    savePreferences();
    displayToast(`CONTROL MODE: ${config.controlMode.toUpperCase()}`);
  });

  $('#preset').addEventListener('change', e => {
    const val = (e.target as HTMLSelectElement).value as 'Low' | 'Medium' | 'High' | 'Custom';
    config.preset = val;
    if (val !== 'Custom') {
      Object.assign(tuning, CONTROL_PRESETS[val]);
      controller.updateTuning(tuning);
    }
    savePreferences();
  });

  $('#sens').addEventListener('input', e => {
    config.sensitivity = Number((e.target as HTMLInputElement).value);
    controller.updateConfig({ sensitivity: config.sensitivity });
    savePreferences();
  });

  $('#dead').addEventListener('input', e => {
    config.deadzone = Number((e.target as HTMLInputElement).value);
    controller.updateConfig({ deadzone: config.deadzone });
    savePreferences();
  });

  $('#expo').addEventListener('input', e => {
    config.expo = Number((e.target as HTMLInputElement).value);
    controller.updateConfig({ expo: config.expo });
    savePreferences();
  });

  $('#difficulty').addEventListener('change', e => {
    config.difficulty = (e.target as HTMLSelectElement).value as Difficulty;
    savePreferences();
    displayToast(`DIFFICULTY: ${config.difficulty.toUpperCase()}`);
  });

  $('#duration').addEventListener('change', e => {
    config.raceDuration = Number((e.target as HTMLSelectElement).value);
    savePreferences();
  });

  $('#quality').addEventListener('change', e => {
    setGraphicsQuality((e.target as HTMLSelectElement).value);
    savePreferences();
  });

  // Mobile Joysticks
  document.querySelectorAll<HTMLElement>('.joystick').forEach(el => {
    let pid = -1;
    const knob = el.querySelector<HTMLElement>('.joy-knob')!;
    const update = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left - r.width / 2) / (r.width * 0.36), -1, 1);
      const ny = clamp(-(e.clientY - r.top - r.height / 2) / (r.height * 0.36), -1, 1);
      knob.style.transform = `translate(calc(-50% + ${nx * 40}px), calc(-50% - ${ny * 40}px))`;
      controller.setTouchStick(el.dataset.stick as 'left' | 'right', nx, ny, true);
    };

    el.addEventListener('pointerdown', e => {
      pid = e.pointerId;
      el.setPointerCapture(pid);
      update(e);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId === pid) update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === pid) {
        pid = -1;
        controller.setTouchStick(el.dataset.stick as 'left' | 'right', 0, 0, false);
        knob.style.transform = 'translate(-50%, -50%)';
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  });

  showMenu();
}

function showMenu() {
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow">PROFESSIONAL SIMULATION</div>
        <h1>ROBO RACE<br><span style="color:#eab449">3D</span></h1>
        <p>Drive the tracked differential-drive robot across challenging terrain: slaloms, bridge crossings, switchback climbing, rock fields, and the fire-water-oil hazard zone.</p>
        <div>
          <span class="tag">REALISTIC DIFFERENTIAL DRIVE</span>
          <span class="tag">PHYSICAL ROLLOVER</span>
          <span class="tag">THERMAL & BATTERY MODEL</span>
          <span class="tag">11 ORDERED GATES</span>
        </div>
        <p style="font-size:11px;margin:12px 0 14px">
          <b>Keyboard:</b> W/S Drive · A Left · D Right · Space Brake · R Recover · C Camera · Esc Pause<br>
          <b>Controllers:</b> Compatible with Xbox, PS, RadioMaster & EdgeTX transmitters
        </p>
        <button class="action" id="btnStartRace">START RACE</button>
        <div class="subactions">
          <button class="iconbtn" id="btnMenuCam">CAMERA: CHASE</button>
          <button class="iconbtn" id="btnMenuSettings">SETTINGS</button>
        </div>
      </div>
    </div>
  `;
  $('#btnStartRace', o).addEventListener('click', startRace);
  $('#btnMenuCam', o).addEventListener('click', cycleCamera);
  $('#btnMenuSettings', o).addEventListener('click', () => $('#settings').classList.toggle('hidden'));
}

function showPaused() {
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow">RACE PAUSED</div>
        <h1>Take a breath.</h1>
        <p>Timer and vehicle state are safely paused. Resume your run or reset.</p>
        <button class="action" id="btnResume">RESUME RACE</button>
        <div class="subactions">
          <button class="iconbtn" id="btnRestart">RESTART RACE</button>
          <button class="iconbtn" id="btnMainMenu">MAIN MENU</button>
        </div>
      </div>
    </div>
  `;
  $('#btnResume', o).addEventListener('click', () => { raceState = 'racing'; hideOverlays(); });
  $('#btnRestart', o).addEventListener('click', startRace);
  $('#btnMainMenu', o).addEventListener('click', () => { raceState = 'menu'; showMenu(); });
}

function showResults() {
  const totalAdj = elapsed + penaltyTime;
  if (!bestTime || totalAdj < bestTime) {
    bestTime = totalAdj;
    localStorage.setItem('robo-race-best-v2', String(bestTime));
  }
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow">COURSE COMPLETE · 11 / 11 GATES</div>
        <h1>Race Finished!</h1>
        <p class="result-time">${formatTime(elapsed)} <span style="font-size:14px;color:#aeb8a9">+ ${penaltyTime.toFixed(1)}s penalty</span></p>
        <p>Adjusted Total: <b style="color:#f0bd53">${formatTime(totalAdj)}</b><br>
           Course Record: <b style="color:#f0bd53">${formatTime(bestTime)}</b><br>
           Battery Remaining: ${subsystems.battery.percentage.toFixed(0)}% · Chassis Integrity: ${subsystems.integrity.chassis.toFixed(0)}%
        </p>
        <button class="action" id="btnAgain">RACE AGAIN</button>
        <div class="subactions">
          <button class="iconbtn" id="btnMenu">MAIN MENU</button>
        </div>
      </div>
    </div>
  `;
  $('#btnAgain', o).addEventListener('click', startRace);
  $('#btnMenu', o).addEventListener('click', () => { raceState = 'menu'; showMenu(); });
}

function hideOverlays() {
  const o = $<HTMLDivElement>('#overlay');
  if (o) o.innerHTML = '';
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function togglePause() {
  if (raceState === 'racing') {
    raceState = 'paused';
    controller.neutralize();
    showPaused();
  } else if (raceState === 'paused') {
    raceState = 'racing';
    hideOverlays();
  }
}

function cycleCamera() {
  cameraMode = (cameraMode + 1) % 4;
  const names = ['CHASE CAMERA', 'LOW BUMPER VIEW', 'TACTICAL OVERHEAD', 'GARAGE INSPECTION'];
  displayToast(names[cameraMode]);
}

function toggleCutaway() {
  cutawayMode = !cutawayMode;
  trackCovers.forEach(c => (c.visible = !cutawayMode));
  displayToast(cutawayMode ? 'TRACK ASSEMBLY CUTAWAY VIEW' : 'ROBOT EXTERIOR VIEW');
}

function setGraphicsQuality(q: string) {
  config.quality = q;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'Low' ? 1.0 : q === 'Balanced' ? 1.5 : q === 'High' ? 1.8 : 2.0));
  sun.castShadow = q !== 'Low';
  sun.shadow.mapSize.set(q === 'Ultra' ? 4096 : q === 'High' ? 2048 : 1024, q === 'Ultra' ? 4096 : q === 'High' ? 2048 : 1024);
  renderer.setSize(innerWidth, innerHeight);
}

// -------------------------------------------------------------
// 10. Start, Restart, and Checkpoint Recovery Logic
// -------------------------------------------------------------
function startRace() {
  tone(520, 0.12, 0.04);
  controller.neutralize();
  elapsed = 0;
  penaltyTime = 0;
  currentCheckpoint = 0;
  subsystems = createInitialSubsystems();

  checkpointMeshes.forEach(c => {
    c.passed = false;
    (c.bar.material as THREE.MeshBasicMaterial).color.set('#88a679');
  });

  const anchor = recoveryAnchors[0];
  applyRecovery(pose, anchor, evaluateCourseHeight);
  motionState.x = pose.x;
  motionState.z = pose.z;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.yaw = pose.yaw;
  motionState.angular = 0;

  raceState = 'countdown';
  countdown = 3.0;
  hideOverlays();
  displayToast('READY');
}

function restartRace() {
  startRace();
}

function recoverVehicle() {
  if (recoveryCooldown > 0) return;
  recoveryCooldown = 1.0;

  const anchor = getSafeRecoveryAnchor(currentCheckpoint, recoveryAnchors);
  applyRecovery(pose, anchor, evaluateCourseHeight);

  motionState.x = pose.x;
  motionState.z = pose.z;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.yaw = pose.yaw;
  motionState.angular = 0;

  penaltyTime += config.penalty;
  tone(380, 0.18, 0.05);
  displayToast(`RECOVERED TO ${anchor.label.toUpperCase()} · +${config.penalty}s`);
}

// Global Key Listeners
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyB'].includes(e.code)) {
    e.preventDefault();
  }
  controller.handleKeyDown(e.code);

  if (e.repeat) return;
  if (e.code === 'Escape') togglePause();
  if (e.code === 'KeyR' && raceState === 'racing' && $('#settings').classList.contains('hidden')) recoverVehicle();
  if (e.code === 'KeyC' && raceState !== 'menu') cycleCamera();
  if (e.code === 'F3') {
    drivingHudVisible = !drivingHudVisible;
    $('#driveTelemetry').classList.toggle('hidden', !drivingHudVisible);
  }
});

window.addEventListener('keyup', e => {
  controller.handleKeyUp(e.code);
});

// -------------------------------------------------------------
// 11. Physics Step & Collision Resolution
// -------------------------------------------------------------
const FIXED_DT = 1 / 120;
let accumulator = 0;
let lastFrameTime = performance.now();

function collidesWithBarrier(x: number, z: number, y: number) {
  for (const c of colliders) {
    if (c.walkable) continue;
    const dx = x - c.x * MAP_SCALE;
    const dz = z - c.z * MAP_SCALE;
    const halfW = c.hx * MAP_SCALE;
    const halfD = c.hz * MAP_SCALE;

    if (Math.abs(dx) < halfW + 0.85 && Math.abs(dz) < halfD + 0.85) {
      const overlapX = (halfW + 0.85) - Math.abs(dx);
      const overlapZ = (halfD + 0.85) - Math.abs(dz);
      if (overlapX < overlapZ) {
        return { nx: dx > 0 ? 1 : -1, nz: 0 };
      } else {
        return { nx: 0, nz: dz > 0 ? 1 : -1 };
      }
    }
  }
  return null;
}

function stepPhysics(dt: number) {
  // Debug hook for automated verification
  (window as unknown as Record<string, unknown>).__gameDebug = {
    raceState,
    countdown,
    pose,
    motionState,
    subsystems,
    currentCheckpoint,
  };

  if (raceState === 'countdown') {
    countdown -= dt;
    if (countdown <= 0) {
      raceState = 'racing';
      displayToast('GO!');
    }
    return;
  }

  if (raceState !== 'racing') return;

  elapsed += dt;
  if (recoveryCooldown > 0) recoveryCooldown -= dt;

  // Poll Universal Controller outputs
  const inputs = controller.poll();
  if (inputs.recover) recoverVehicle();
  if (inputs.changeCamera) cycleCamera();
  if (inputs.togglePause) togglePause();

  // If vehicle is flipped, track power cannot drive on ground
  const effectiveLeft = pose.isFlipped ? 0 : inputs.leftTrack;
  const effectiveRight = pose.isFlipped ? 0 : inputs.rightTrack;

  // Query ground slope and surface at current position
  const slope = slopeAt(evaluateCourseHeight, motionState.x / MAP_SCALE, motionState.z / MAP_SCALE);
  const surf = evaluateCourseSurface(motionState.x / MAP_SCALE, motionState.z / MAP_SCALE);

  // Difficulty grip multiplier
  const gripMult = config.difficulty === 'Beginner' ? 1.25 : config.difficulty === 'Intermediate' ? 1.0 : config.difficulty === 'Advanced' ? 0.82 : 0.68;
  const effectiveGrip = surf.grip * gripMult;

  // Integrate differential drive physics
  const driveResult = integrateDrive(
    motionState,
    effectiveLeft,
    effectiveRight,
    { grip: effectiveGrip, rollingResistance: surf.rollingResistance },
    slope,
    {
      maxSpeed: tuning.maxSpeed * config.sensitivity,
      motorAcceleration: tuning.acceleration,
      braking: tuning.braking,
      turnRate: tuning.maxRotation,
      turnResponse: tuning.steeringResponse,
      gravity: 9.81,
      coastDeceleration: 2.7,
    },
    dt,
    inputs.brake
  );

  // Synchronize pose with planar motion
  pose.x = motionState.x;
  pose.z = motionState.z;
  pose.yaw = motionState.yaw;
  pose.vx = motionState.vx;
  pose.vz = motionState.vz;

  // Collision handling against static barriers
  let impactDamage = 0;
  const hit = collidesWithBarrier(pose.x, pose.z, pose.y);
  if (hit) {
    const dot = pose.vx * hit.nx + pose.vz * hit.nz;
    if (dot < 0) {
      const impactSpeed = Math.abs(dot);
      pose.vx -= (1 + 0.15) * dot * hit.nx;
      pose.vz -= (1 + 0.15) * dot * hit.nz;
      motionState.vx = pose.vx;
      motionState.vz = pose.vz;
      pose.x += hit.nx * 0.03;
      pose.z += hit.nz * 0.03;
      motionState.x = pose.x;
      motionState.z = pose.z;

      if (impactSpeed > 1.2) {
        impactDamage = impactSpeed * 2.5;
        penaltyTime += 1.0;
        tone(120, 0.14, 0.06);
        displayToast('BARRIER IMPACT');
      }
    }
  }

  // Step 3D Vehicle Dynamics (pitch, roll, ground contour following, rollover)
  stepVehicle3D(
    pose,
    (x, z) => evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE),
    driveResult.longitudinalSpeed,
    motionState.angular,
    dt
  );

  // Step Mechatronics & Subsystems (Battery, Motors, ESC, Thermal, Hazards)
  stepSubsystems(
    subsystems,
    effectiveLeft,
    effectiveRight,
    driveResult.motorSlip,
    surf.hazard,
    impactDamage,
    dt
  );

  // Update Three.js Robot Rigidbody Position and Rotation
  robot.position.set(pose.x, pose.y, pose.z);
  robot.rotation.set(0, pose.yaw, 0, 'YXZ');
  chassis.rotation.x = pose.pitch;
  chassis.rotation.z = pose.roll;

  // Debug hook for automated verification
  (window as unknown as Record<string, unknown>).__gameDebug = {
    raceState,
    countdown,
    pose,
    motionState,
    inputs,
    subsystems,
    currentCheckpoint,
  };

  // Animate track cleats and road wheels independently for left and right tracks
  for (let side = 0; side < tracks.length; side++) {
    const tr = tracks[side];
    const beltSpeed = side === 0 ? driveResult.trackSpeedLeft : driveResult.trackSpeedRight;
    tr.phase -= beltSpeed * dt * 1.6;

    for (let i = 0; i < tr.cleats.length; i++) {
      const t = (i / tr.cleats.length) * Math.PI * 2 + tr.phase;
      const q = tr.cleats[i];
      q.position.y = 0.32 + Math.sin(t) * 0.18;
      q.position.z = Math.cos(t) * 0.74;
      q.rotation.x = -Math.atan2(Math.cos(t) * 0.18, -Math.sin(t) * 0.74);
    }

    for (const w of tr.rollers) {
      w.rotation.x += beltSpeed * dt * 2.5;
    }
  }

  // Dust particles on acceleration and slip
  if ((Math.abs(driveResult.longitudinalSpeed) > 1.2 || driveResult.motorSlip > 0.25) && Math.random() < dt * 8) {
    const p = dustParticles.find(d => d.life <= 0);
    if (p) {
      p.life = 0.55;
      p.mesh.visible = true;
      p.mesh.position.set(pose.x + (Math.random() - 0.5) * 0.6, 0.16, pose.z + (Math.random() - 0.5) * 0.6);
      p.mesh.scale.setScalar(0.6 + Math.random() * 0.8);
    }
  }

  for (const d of dustParticles) {
    if (d.life > 0) {
      d.life -= dt;
      d.mesh.position.y += dt * 0.45;
      d.mesh.scale.multiplyScalar(1 + dt * 0.6);
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, d.life * 0.6);
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  // Checkpoint validation
  if (currentCheckpoint < checkpointMeshes.length) {
    const cp = checkpointMeshes[currentCheckpoint];
    const distSq = (pose.x - cp.worldX) ** 2 + (pose.z - cp.worldZ) ** 2;

    if (distSq < (2.2 * MAP_SCALE) ** 2) {
      cp.passed = true;
      currentCheckpoint++;
      (cp.bar.material as THREE.MeshBasicMaterial).color.set('#f0bd53');
      tone(620, 0.14, 0.05);
      displayToast(`GATE ${String(currentCheckpoint).padStart(2, '0')} CLEARED`);

      if (currentCheckpoint >= checkpointMeshes.length) {
        raceState = 'finished';
        showResults();
      }
    }
  }
}

// -------------------------------------------------------------
// 12. Camera Positioning & Tracking
// -------------------------------------------------------------
function updateCamera(dt: number) {
  const yaw = pose.yaw;
  let offset: THREE.Vector3;
  let lookTarget: THREE.Vector3;

  if (cameraMode === 0) {
    // Dynamic chase camera
    offset = V(-Math.sin(yaw) * 6.8, 4.8, -Math.cos(yaw) * 6.8);
    lookTarget = V(pose.x + Math.sin(yaw) * 0.5, pose.y + 0.65, pose.z + Math.cos(yaw) * 0.5);
  } else if (cameraMode === 1) {
    // Low bumper view
    offset = V(-Math.sin(yaw) * 4.2, 2.6, -Math.cos(yaw) * 4.2);
    lookTarget = V(pose.x + Math.sin(yaw) * 1.2, pose.y + 0.45, pose.z + Math.cos(yaw) * 1.2);
  } else if (cameraMode === 2) {
    // Tactical overhead
    offset = V(0, 13.5, -0.4);
    lookTarget = V(pose.x, pose.y, pose.z);
  } else {
    // Garage / inspection orbit
    const t = performance.now() * 0.0005;
    offset = V(Math.sin(t) * 4.5, 3.2, Math.cos(t) * 4.5);
    lookTarget = V(pose.x, pose.y + 0.5, pose.z);
  }

  const desired = V(pose.x, pose.y, pose.z).add(offset);
  camera.position.lerp(desired, 1 - Math.exp(-dt * 4.5));
  camera.lookAt(lookTarget);
}

// -------------------------------------------------------------
// 13. HUD & Telemetry Displays
// -------------------------------------------------------------
function updateHUD(dt: number) {
  const t = $<HTMLElement>('#time');
  const g = $<HTMLElement>('#gates');
  const s = $<HTMLElement>('#speed');
  const n = $<HTMLElement>('#next');
  const bat = $<HTMLElement>('#bat');
  const mot = $<HTMLElement>('#mot');
  const hlt = $<HTMLElement>('#hlt');
  const rolloverBanner = $<HTMLElement>('#rolloverAlert');

  if (t) t.textContent = formatTime(elapsed);
  if (g) g.textContent = `${String(currentCheckpoint).padStart(2, '0')} / 11`;
  if (s) {
    const spd = Math.hypot(pose.vx, pose.vz);
    s.innerHTML = `${spd.toFixed(1)} <span style="font-size:9px">m/s</span>`;
  }
  if (n) {
    n.innerHTML = raceState === 'finished' ? 'COURSE COMPLETE' :
      raceState === 'countdown' ? `RACE STARTS IN <i>${Math.max(1, Math.ceil(countdown))}</i>` :
      raceState === 'paused' ? 'RACE PAUSED' :
      `PASS GATE <i>${String(currentCheckpoint + 1).padStart(2, '0')}</i> IN ORDER`;
  }

  if (bat) bat.textContent = `${subsystems.battery.percentage.toFixed(0)}%`;
  if (mot) mot.textContent = `${Math.round(Math.max(subsystems.motors.leftTemp, subsystems.motors.rightTemp))}°C`;
  if (hlt) hlt.textContent = `${Math.round(subsystems.integrity.chassis)}%`;

  // Rollover warning banner
  if (rolloverBanner) {
    rolloverBanner.classList.toggle('hidden', !pose.isFlipped);
  }

  // Telemetry details panel
  if (drivingHudVisible) {
    const tel = $<HTMLElement>('#driveTelemetry');
    if (tel) {
      const inputs = controller.poll();
      tel.innerHTML = `
        SRC: ${inputs.source.toUpperCase()} (${inputs.deviceName})<br>
        THR: ${Math.round(inputs.throttle * 100)}% · STR: ${Math.round(inputs.steering * 100)}%<br>
        L TRACK: ${inputs.leftTrack.toFixed(2)} · R TRACK: ${inputs.rightTrack.toFixed(2)}<br>
        PITCH: ${(pose.pitch * 57.3).toFixed(1)}° · ROLL: ${(pose.roll * 57.3).toFixed(1)}°<br>
        FLIPPED: ${pose.isFlipped ? 'YES (OVERTURNED)' : 'NO'}<br>
        BATTERY: ${subsystems.battery.voltage.toFixed(1)}V · ${subsystems.battery.currentAmps.toFixed(1)}A<br>
        MOTORS: L ${subsystems.motors.leftTemp.toFixed(0)}°C / R ${subsystems.motors.rightTemp.toFixed(0)}°C<br>
        HAZARD: ${subsystems.activeHazard.toUpperCase()}
      `;
    }
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $<HTMLElement>('.toast')?.classList.remove('show');
  }
}

// -------------------------------------------------------------
// 14. Animation Loop
// -------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const frameTime = clamp((now - lastFrameTime) / 1000, 0, 0.05);
  lastFrameTime = now;

  accumulator += frameTime;
  while (accumulator >= FIXED_DT) {
    stepPhysics(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  // Animate flames and disc
  discGroup.rotation.y += frameTime * 0.45;
  for (let f = 0; f < fireFlames.length; f++) {
    fireFlames[f].scale.y = 0.8 + Math.sin(now * 0.015 + f * 1.5) * 0.35;
  }

  updateCamera(frameTime);
  renderer.render(scene, camera);
  updateHUD(frameTime);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Render UI & Start animation
renderUI();
animate();
