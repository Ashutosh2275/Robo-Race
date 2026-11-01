import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { integrateDrive, slopeAt, type DriveState } from './drivePhysics';
import { CONTROL_PRESETS, type ControlTuning, type VehicleTuning } from './driveControls';
import { DRIVE_SPROCKET_RADIUS_M, MOTOR_SPECIFICATIONS, maxMotorAccelerationMps2, maxTrackSpeedMps } from './drivetrainConfig';
import {
  stepVehicle3D,
  applyRecovery,
  getSafeRecoveryAnchor,
  createDefaultRecoveryAnchors,
  type VehiclePose,
  TRACK_WIDTH,
  TRACK_LENGTH,
  TRACK_CONTACT_OFFSET,
  ROBOT_COLLISION_HEIGHT,
  getFootprintAabbHalfExtents,
} from './vehicleDynamics';
import {
  createInitialSubsystems,
  stepSubsystems,
  isRobotDestroyed,
  type SubsystemsState,
  type HazardType,
} from './robotSubsystems';
import {
  UniversalController,
  type ControllerConfig,
  type ControllerMode,
} from './universalController';
import {
  MAP_SCALE,
  DRIVE_ROUTE,
  DRIVE_ROUTE_WIDTH,
  ARENA_FLOOR_HEIGHT,
  HILL_ENTRY_LINK,
  HILL_EXIT_LINK,
  PARALLEL_PLANK_CENTERS,
  CHECKPOINTS,
  SLALOM_BARRIERS,
  SPEED_BREAKER_XS,
  HILL_NODES,
  evaluateCourseHeight,
  evaluateCourseSurface,
  createDeterministicRNG,
  generateRockFieldStones,
  validateRouteClearance,
  validateDriveRoute,
  validateSlalomClearance,
  crossesCheckpointGate,
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
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.normalBias = 0.025;
sun.shadow.bias = -0.0002;
scene.add(sun);

// Overhead spotlights for industrial arena realism
for (const x of [-16, 0, 16]) {
  const light = new THREE.PointLight('#fff3df', 25, 20, 1.8);
  light.position.set(x, 7.5, 0);
  scene.add(light);
}

const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.1, 150);
camera.position.set(0, 8, 14);
const cameraRaycaster = new THREE.Raycaster();
const cameraRayHits: THREE.Intersection[] = [];
const cameraDirection = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const cameraDesiredPosition = new THREE.Vector3();

function generateSurfaceTexture(base: string, marks: string[], kind: 'grain' | 'stone' | 'wood' | 'slick' | 'asphalt' | 'chevron') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 512, 512);

  if (kind === 'asphalt') {
    // Ultra-realistic asphalt: high-frequency aggregate grit + subtle tyre rubber marks
    for (let i = 0; i < 1800; i++) {
      const a = (i * 163) % 512;
      const b = (i * 307 + 73) % 512;
      x.fillStyle = marks[i % marks.length];
      x.globalAlpha = 0.18 + (i % 5) * 0.08;
      const r = 1 + (i % 3);
      x.fillRect(a, b, r, r);
    }
    // Subtle skid mark streaks
    x.fillStyle = '#111314';
    x.globalAlpha = 0.09;
    for (let k = 0; k < 4; k++) {
      x.fillRect(0, 80 + k * 110, 512, 34 + (k % 2) * 16);
    }
  } else if (kind === 'chevron') {
    // Chevron tread cleats pattern for continuous rubber tracks
    x.fillStyle = '#101211';
    x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#282d2a';
    x.lineWidth = 14;
    x.lineCap = 'round';
    for (let y = 16; y < 512; y += 48) {
      x.beginPath();
      x.moveTo(64, y);
      x.lineTo(256, y + 26);
      x.lineTo(448, y);
      x.stroke();
    }
  } else {
    for (let i = 0; i < 400; i++) {
      const a = (i * 73) % 512;
      const b = (i * 151 + 29) % 512;
      x.fillStyle = marks[i % marks.length];
      if (kind === 'grain') {
        x.globalAlpha = 0.32;
        x.fillRect(a, b, 2 + (i % 3), 2);
      } else if (kind === 'stone') {
        x.globalAlpha = 0.60;
        x.beginPath();
        x.ellipse(a, b, 4 + i % 6, 2 + i % 4, (i % 7) * 0.3, 0, Math.PI * 2);
        x.fill();
      } else if (kind === 'wood') {
        x.globalAlpha = 0.40;
        x.lineWidth = 2 + (i % 3);
        x.beginPath();
        x.moveTo(a, 0);
        x.lineTo(a + ((i % 5) - 2) * 8, 512);
        x.stroke();
      } else {
        x.globalAlpha = 0.28;
        x.lineWidth = 3;
        x.beginPath();
        x.ellipse(a, b, 14 + i % 18, 4 + i % 6, (i % 9) * 0.2, 0, Math.PI * 2);
        x.stroke();
      }
    }
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: '#272a2c', roughness: 0.94, map: generateSurfaceTexture('#272a2c', ['#383b3d', '#1f2122', '#414446'], 'grain') }),
  asphalt: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0.05, map: generateSurfaceTexture('#3b4143', ['#4a5052', '#303638', '#53595b'], 'asphalt') }),
  laneStripeWhite: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.55 }),
  laneStripeYellow: new THREE.MeshStandardMaterial({ color: '#e8af28', roughness: 0.60 }),
  curbRed: new THREE.MeshStandardMaterial({ color: '#c72b22', roughness: 0.62 }),
  curbWhite: new THREE.MeshStandardMaterial({ color: '#f0f0eb', roughness: 0.65 }),
  barrier: new THREE.MeshStandardMaterial({ color: '#e5e2d8', roughness: 0.72 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#e5ad2a', roughness: 0.65 }),
  coverYellow: new THREE.MeshStandardMaterial({ color: '#cb9f2a', roughness: 0.78, metalness: 0.12 }),
  black: new THREE.MeshStandardMaterial({ color: '#141618', roughness: 0.75, metalness: 0.15 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#161917', roughness: 0.95, map: generateSurfaceTexture('#161917', ['#242926', '#101211'], 'chevron') }),
  metal: new THREE.MeshStandardMaterial({ color: '#5a646a', roughness: 0.35, metalness: 0.82 }),
  wheel: new THREE.MeshStandardMaterial({ color: '#c8c5ba', roughness: 0.50, metalness: 0.45 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a5e42', roughness: 0.85, map: generateSurfaceTexture('#7a5e42', ['#8c6e4e', '#614831'], 'wood') }),
  red: new THREE.MeshStandardMaterial({ color: '#c82e25', roughness: 0.58 }),
  green: new THREE.MeshStandardMaterial({ color: '#7ca86f', roughness: 0.88 }),
  sand: new THREE.MeshStandardMaterial({ color: '#baa06f', roughness: 0.98, map: generateSurfaceTexture('#baa06f', ['#cca874', '#9e8053'], 'grain') }),
  gravel: new THREE.MeshStandardMaterial({ color: '#7d7d76', roughness: 0.98, map: generateSurfaceTexture('#7d7d76', ['#a5a498', '#63635b'], 'stone') }),
  turf: new THREE.MeshStandardMaterial({ color: '#4a6844', roughness: 0.95 }),
  ice: new THREE.MeshStandardMaterial({ color: '#566668', roughness: 0.14, metalness: 0.50, map: generateSurfaceTexture('#566668', ['#a8b8ba', '#3a4445'], 'slick') }),
  bridge: new THREE.MeshStandardMaterial({ color: '#687176', roughness: 0.45, metalness: 0.55 }),
  oil: new THREE.MeshStandardMaterial({ color: '#090a0a', roughness: 0.04, metalness: 0.92 }),
  water: new THREE.MeshStandardMaterial({ color: '#17677d', roughness: 0.16, metalness: 0.12, transparent: true, opacity: 0.84 }),
  fire: new THREE.MeshStandardMaterial({ color: '#e84917', emissive: '#ff540a', emissiveIntensity: 2.2, roughness: 0.35 }),
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
const cameraOccluders: THREE.Object3D[] = [];

function solidBox(id: string, x: number, z: number, w: number, d: number, h: number, mat: THREE.Material, rot = 0, y = h / 2, walkable = false) {
  const mesh = box(course, mat, V(x, y, z), V(w, h, d), rot);
  if (!walkable) cameraOccluders.push(mesh);
  colliders.push({ id, x, z, hx: w / 2, hz: d / 2, y, height: h, rot, walkable });
}

function slopedDeck(id: string, x0: number, x1: number, z: number, width: number, y0: number, y1: number, thickness: number, material: THREE.Material) {
  const half = width / 2;
  const vertices = [
    x0, y0, z - half, x0, y0, z + half, x1, y1, z + half, x1, y1, z - half,
    x0, y0 - thickness, z - half, x0, y0 - thickness, z + half,
    x1, y1 - thickness, z + half, x1, y1 - thickness, z - half,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  course.add(mesh);
  return mesh;
}

function beamBetween(a: THREE.Vector3, b: THREE.Vector3, thickness: number, material: THREE.Material) {
  const delta = b.clone().sub(a);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(delta.length(), thickness, thickness), material);
  beam.position.copy(a).add(b).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(V(1, 0, 0), delta.normalize());
  beam.castShadow = true;
  beam.receiveShadow = true;
  course.add(beam);
  return beam;
}

/** Reusable modular slalom barrier: weighted feet, molded body, reflectors and visible end hardware. */
function buildSlalomBarrier(data: typeof SLALOM_BARRIERS[number]) {
  const { x, z, width: length, depth, height } = data;
  const group = new THREE.Group();
  group.name = data.id;
  group.position.set(x, 0, z);
  course.add(group);

  const footDepth = depth;
  const bodyDepth = Math.max(0.32, depth - 0.24);
  const footWidth = length * 0.34;
  for (const side of [-1, 1]) {
    box(group, mats.rubber, V(side * length * 0.30, 0.055, 0), V(footWidth, 0.11, footDepth));
    // A small amber toe plate and two recessed fixing points make the feet
    // read as weighted event hardware rather than a floating cuboid.
    box(group, mats.yellow, V(side * length * 0.30, 0.114, 0), V(footWidth * 0.72, 0.018, footDepth * 0.84));
    for (const face of [-1, 1]) {
      cyl(group, mats.metal, V(side * length * 0.30, 0.125, face * (footDepth * 0.38)), 0.035, 0.018, 'y', 10);
    }
  }

  const bodyBottom = 0.12;
  const bodyHeight = height - bodyBottom;
  const body = box(group, mats.yellow, V(0, bodyBottom + bodyHeight / 2, 0), V(length, bodyHeight, bodyDepth));
  body.castShadow = true;
  cameraOccluders.push(body);

  // Raised top and end caps protect the molded shell and clarify the intended
  // module boundaries when viewed at driving height.
  box(group, mats.coverYellow, V(0, height - 0.035, 0), V(length - 0.10, 0.07, bodyDepth + 0.035));
  for (const end of [-1, 1]) {
    box(group, mats.black, V(end * (length / 2 - 0.025), bodyBottom + bodyHeight / 2, 0), V(0.07, bodyHeight + 0.025, bodyDepth + 0.06));
    for (const face of [-1, 1]) {
      cyl(group, mats.metal, V(end * (length / 2 - 0.10), 0.23, face * (bodyDepth / 2 + 0.038)), 0.035, 0.025, 'z', 10);
    }
  }

  // Red retroreflective panels with pale borders repeat on both faces, so the
  // barrier remains legible from either approach direction.
  const panelCount = Math.max(2, Math.floor(length / 0.38));
  for (let panel = 0; panel < panelCount; panel++) {
    const panelX = -length / 2 + (panel + 0.5) * length / panelCount;
    if (Math.abs(panelX) > length / 2 - 0.15) continue;
    for (const face of [-1, 1]) {
      const zFace = face * (bodyDepth / 2 + 0.014);
      box(group, mats.curbWhite, V(panelX, bodyBottom + bodyHeight * 0.57, zFace), V(0.19, 0.30, 0.018));
      box(group, mats.red, V(panelX, bodyBottom + bodyHeight * 0.57, zFace + face * 0.012), V(0.125, 0.22, 0.020));
    }
  }

  // One simple envelope collider covers the shell and its feet without
  // generating redundant colliders for decorative bolts and reflectors.
  colliders.push({
    id: data.id,
    x,
    z,
    hx: length / 2 + 0.06,
    hz: footDepth / 2,
    y: (height + 0.06) / 2,
    height: height + 0.06,
    rot: 0,
    walkable: false,
  });
}

// Main Arena Floors & Dedicated Path-Based Racing Circuit
box(course, mats.floor, V(0, ARENA_FLOOR_HEIGHT - 0.225, 0), V(40, 0.45, 36), 0, false);

// Build one continuous road first. Obstacles are layered onto this measured
// corridor below; there are no detached rectangular road pads or oversized
// paved dead zones. The road follows all gates and obstacle approaches.
function createRouteRibbon(offset: number, width: number, material: THREE.Material, yLift: number, route: { x: number; z: number }[] = DRIVE_ROUTE) {
  // Use the validated route polyline directly. A global Catmull-Rom spline
  // bowed through the staggered obstacles and folded the inner road edge on
  // tight bends, producing the black triangular artifacts in the screenshots.
  // Subdivide each straight segment so changes in ramp height are sampled at
  // the same resolution as the visible deck instead of being bridged by one
  // long, floating road triangle.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.35));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      points.push(V(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t));
    }
  }
  const last = route.at(-1)!;
  points.push(V(last.x, 0, last.z));
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width * 0.5;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    // Mitered cross-sections keep adjoining road pieces sealed without the
    // unbounded offset spikes that created loops at hairpins.
    const nx = tz;
    const nz = -tx;
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const previousLength = Math.hypot(p.x - previous.x, p.z - previous.z) || len;
    const nextLength = Math.hypot(next.x - p.x, next.z - p.z) || len;
    const ptx = (p.x - previous.x) / previousLength;
    const ptz = (p.z - previous.z) / previousLength;
    const ntx = (next.x - p.x) / nextLength;
    const ntz = (next.z - p.z) / nextLength;
    const previousNormal = V(ptz, 0, -ptx);
    const nextNormal = V(ntz, 0, -ntx);
    const miter = previousNormal.add(nextNormal).normalize();
    const miterScale = clamp(1 / Math.max(0.67, Math.abs(miter.x * nx + miter.z * nz)), 1, 1.5);
    for (const side of [-1, 1]) {
      const lateral = (offset + side * half) * miterScale;
      const x = p.x + miter.x * lateral;
      const z = p.z + miter.z * lateral;
      positions.push(x, evaluateCourseHeight(x, z) + yLift, z);
    }
    if (i < points.length - 1) {
      const a = i * 2;
      // Vertex order must face upward in Three.js' Y-up coordinate system.
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  course.add(mesh);
}

createRouteRibbon(0, DRIVE_ROUTE_WIDTH + 0.12, mats.black, -0.16);
createRouteRibbon(0, DRIVE_ROUTE_WIDTH, mats.asphalt, 0.006);
createRouteRibbon(-(DRIVE_ROUTE_WIDTH / 2 - 0.09), 0.055, mats.laneStripeWhite, 0.020);
createRouteRibbon(DRIVE_ROUTE_WIDTH / 2 - 0.09, 0.055, mats.laneStripeWhite, 0.020);

// A connected optional training spur makes the steep switchback a usable
// obstacle detour between the rotating-disc area and the final hairpin.
for (const link of [HILL_ENTRY_LINK, HILL_EXIT_LINK]) {
  createRouteRibbon(0, 3.52, mats.black, -0.16, link);
  createRouteRibbon(0, 3.4, mats.asphalt, 0.006, link);
  createRouteRibbon(-(3.4 / 2 - 0.09), 0.055, mats.laneStripeWhite, 0.020, link);
  createRouteRibbon(3.4 / 2 - 0.09, 0.055, mats.laneStripeWhite, 0.020, link);
}

// Perimeter Barriers
for (const [id, x, z, w, d] of [
  ['wall_north', 0, -17.82, 36, 0.32],
  ['wall_south', 0, 17.82, 36, 0.32],
  ['wall_west', -18.02, 0, 0.32, 36],
  ['wall_east', 18.02, 0, 0.32, 36],
] as [string, number, number, number, number][]) {
  solidBox(id, x, z, w, d, 0.78, mats.barrier, 0, ARENA_FLOOR_HEIGHT + 0.39);
}

// Yellow hazard stripes along perimeter
for (let x = -17; x <= 17; x += 2) {
  box(course, mats.yellow, V(x, 0.4, -13.6), V(1.55, 0.16, 0.055));
  box(course, mats.yellow, V(x, 0.4, 13.6), V(1.55, 0.16, 0.055));
}

// Gantry builder
function gantry(x: number, z: number, label: string, color: THREE.Material) {
  const gateHalfSpan = DRIVE_ROUTE_WIDTH / 2 + 0.38;
  solidBox(`gantry_post_${label}_L`, x, z - gateHalfSpan, 0.18, 0.18, 2.55, mats.black, 0, 1.275);
  solidBox(`gantry_post_${label}_R`, x, z + gateHalfSpan, 0.18, 0.18, 2.55, mats.black, 0, 1.275);
  // Keep the gantry just wider than the driving corridor: oversized beams had
  // been filling the chase-camera view and made the entry look blocked.
  const crossbar = box(course, color, V(x, 2.42, z), V(0.22, 0.22, gateHalfSpan * 2 + 0.16));
  cameraOccluders.push(crossbar);
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
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.54), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs) }));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(x, 2.42, z);
  course.add(sign);
}

gantry(-14.2, 8.0, 'START', mats.green);
gantry(-15.0, -12.0, 'FINISH', mats.yellow);

// Alternating slalom barriers leave a verified, robot-width side passage.
for (const barrier of SLALOM_BARRIERS) {
  // Alternating sides force a steering weave; each module stays short enough
  // to preserve a clear opening and is built with real feet and reflectors.
  buildSlalomBarrier(barrier);
}

// Obstacle 3: Competition Speed Breakers (3 smooth rounded rubber humps across corridor)
for (let i = 0; i < SPEED_BREAKER_XS.length; i++) {
  const x = SPEED_BREAKER_XS[i];
  // Smooth cylinder half spanning the full 3.8m corridor width
  const bumpGeo = new THREE.CylinderGeometry(0.42, 0.42, 3.8, 24, 1, false, 0, Math.PI);
  const bump = new THREE.Mesh(bumpGeo, i % 2 === 0 ? mats.yellow : mats.black);
  bump.rotation.z = Math.PI / 2;
  bump.rotation.y = Math.PI / 2;
  bump.scale.set(0.21, 1, 1); // height ≈ 0.09m
  bump.position.set(x, 0.025, 8.0);
  bump.castShadow = true;
  bump.receiveShadow = true;
  course.add(bump);
  colliders.push({ id: `speed_breaker_${i}`, x, z: 8.0, hx: 0.45, hz: 1.9, y: 0.05, height: 0.09, rot: 0, walkable: true });
}

// Curved Wooden Ramp at x = 4.8, z = 8.0 (length 3.0, width 3.2, peak height 0.88)
// Realistic arched wooden timber decking with bevelled transition
// Separate timber boards follow the actual curved ramp profile instead of
// floating as flat steps above or below the robot's contact surface.
const plankCount = 18;
for (let p = 0; p < plankCount; p++) {
  const step = 3.0 / plankCount;
  const x0 = 3.3 + p * step;
  const x1 = Math.min(6.3, x0 + step + 0.02);
  slopedDeck(`curved_ramp_board_${p}`, x0, x1, 8.0, DRIVE_ROUTE_WIDTH,
    evaluateCourseHeight(x0, 8.0), evaluateCourseHeight(x1, 8.0), 0.09, mats.wood);
}
colliders.push({ id: 'curved_ramp', x: 4.8, z: 8.0, hx: 1.5, hz: DRIVE_ROUTE_WIDTH / 2, y: 0.455, height: 0.85, rot: 0, walkable: true });
for (const side of [-1, 1]) {
  for (let p = 0; p < 12; p++) {
    const px = 3.45 + (p + 0.5) * 0.225;
    const top = evaluateCourseHeight(px, 8.0);
    solidBox(`ramp_curb_${side}_${p}`, px, 8.0 + side * 1.53, 0.24, 0.12, 0.20, mats.black, 0, top + 0.10);
  }
}

// Steel trestles sit directly beneath the elevated crown; no floating curb blocks.
for (const x of [4.35, 4.8, 5.25]) {
  const deckBottom = evaluateCourseHeight(x, 8.0) - 0.09;
  const supportHeight = Math.max(0.08, deckBottom - 0.03);
  for (const side of [-1, 1]) cyl(course, mats.metal, V(x, 0.03 + supportHeight / 2, 8.0 + side * 1.36), 0.045, supportHeight, 'y', 10);
}

// Raised Bridge Structure (approach at 7.8, deck at 9.6, descent at 11.4, height 0.62)
// The approach and descent are true wedge decks matching the ground-height
// profile, with the deck sandwiched between their exact endpoint elevations.
slopedDeck('bridge_approach_mesh', 7.0, 8.6, 8.0, DRIVE_ROUTE_WIDTH, 0.03, 0.62, 0.14, mats.wood);
colliders.push({ id: 'bridge_approach', x: 7.8, z: 8.0, hx: 0.8, hz: DRIVE_ROUTE_WIDTH / 2, y: 0.34, height: 0.62, rot: 0, walkable: true });

// Diamond-plate steel bridge deck
const bridgeDeck = box(course, mats.bridge, V(9.6, 0.50, 8.0), V(2.0, 0.24, DRIVE_ROUTE_WIDTH));
bridgeDeck.castShadow = true;
colliders.push({ id: 'bridge_deck', x: 9.6, z: 8.0, hx: 1.0, hz: DRIVE_ROUTE_WIDTH / 2, y: 0.50, height: 0.24, rot: 0, walkable: true });

// A shallow catch basin beneath the bridge adds visible depth to the crossing;
// the drivable deck remains the physical support surface above it.
box(course, mats.black, V(9.6, -0.02, 8.0), V(4.9, 0.10, 3.25), 0, false);
box(course, mats.water, V(9.6, 0.035, 8.0), V(4.65, 0.025, 3.0), 0, false);
const bridgeWaterRipples: THREE.Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const ripple = new THREE.Mesh(
    new THREE.TorusGeometry(0.34 + (i % 3) * 0.12, 0.012, 5, 24),
    new THREE.MeshBasicMaterial({ color: '#8dcbd0', transparent: true, opacity: 0.20, depthWrite: false }),
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(8.0 + (i % 3) * 1.5, 0.055 + (i % 2) * 0.002, 7.0 + Math.floor(i / 3) * 1.8);
  course.add(ripple);
  bridgeWaterRipples.push(ripple);
}

slopedDeck('bridge_descent_mesh', 10.6, 12.2, 8.0, DRIVE_ROUTE_WIDTH, 0.62, 0.03, 0.14, mats.wood);
colliders.push({ id: 'bridge_descent', x: 11.4, z: 8.0, hx: 0.8, hz: DRIVE_ROUTE_WIDTH / 2, y: 0.34, height: 0.62, rot: 0, walkable: true });

// Bridge Safety Railings
for (const z of [8.0 - DRIVE_ROUTE_WIDTH / 2 + 0.18, 8.0 + DRIVE_ROUTE_WIDTH / 2 - 0.18]) {
  solidBox(`bridge_rail_${z}`, 9.6, z, 3.8, 0.15, 0.45, mats.black, 0, 0.85);
}
// Bridge support trestles stop at the measured underside of the deck.
for (const bx of [8.2, 11.0]) {
  for (const bz of [8.0 - 1.55, 8.0 + 1.55]) {
    const supportHeight = Math.max(0.08, evaluateCourseHeight(bx, bz) - 0.14 - 0.03);
    cyl(course, mats.metal, V(bx, 0.03 + supportHeight / 2, bz), 0.12, supportHeight, 'y');
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
box(course, mats.sand, V(13.45, 0.04, 4.55), V(3.3, 0.08, 3.5), 0, false);
// Deterministic, low-profile loose pebbles stay inside the sand obstacle bounds.
const marbleRng = createDeterministicRNG(20261101);
const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
for (let i = 0; i < 64; i++) {
  const px = 12.05 + marbleRng() * 2.8;
  const pz = 3.10 + marbleRng() * 2.9;
  const size = 0.045 + marbleRng() * 0.035;
  const pebble = new THREE.Mesh(pebbleGeo, i % 4 === 0 ? mats.metal : mats.gravel);
  pebble.position.set(px, 0.08 + size * 0.55, pz);
  pebble.scale.set(size * 1.2, size * 0.65, size);
  pebble.rotation.set(marbleRng() * Math.PI, marbleRng() * Math.PI, marbleRng() * Math.PI);
  pebble.castShadow = true;
  pebble.receiveShadow = true;
  course.add(pebble);
}

// Mixed Terrain Sections along z ~ 0
box(course, mats.sand, V(5.25, 0.015, 0), V(2.45, 0.03, 2.85), 0, false);
box(course, mats.gravel, V(2.8, 0.015, 0), V(2.45, 0.03, 2.85), 0, false);
box(course, mats.turf, V(0.35, 0.015, 0), V(2.45, 0.03, 2.85), 0, false);
box(course, mats.black, V(-2.1, 0.015, 0), V(2.45, 0.03, 2.85), 0, false);

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
const fireFloor = box(course, mats.black, V(-2.8, 0.015, -4.0), V(2.2, 0.03, DRIVE_ROUTE_WIDTH - 0.08));
box(course, mats.yellow, V(-2.8, 0.022, -4.0), V(2.4, 0.012, DRIVE_ROUTE_WIDTH), 0, false);
const fireFlames: THREE.Mesh[] = [];
for (let f = 0; f < 6; f++) {
  const fx = -3.5 + f * 0.28;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 8), mats.fire);
  flame.position.set(fx, 0.32, -4.0 + (f % 2 === 0 ? 1.25 : -1.25));
  course.add(flame);
  fireFlames.push(flame);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 7), new THREE.MeshBasicMaterial({ color: '#ffd783', transparent: true, opacity: 0.92 }));
  core.position.set(fx, 0.21, flame.position.z);
  course.add(core);
}
const fireLight = new THREE.PointLight('#ff6a1a', 15, 6, 1.5);
fireLight.position.set(-2.8, 0.9, -4.0);
scene.add(fireLight);
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = smokeCanvas.height = 128;
const smokeContext = smokeCanvas.getContext('2d')!;
const smokeGradient = smokeContext.createRadialGradient(64, 64, 8, 64, 64, 62);
smokeGradient.addColorStop(0, 'rgba(55,58,60,0.42)');
smokeGradient.addColorStop(0.55, 'rgba(76,79,80,0.20)');
smokeGradient.addColorStop(1, 'rgba(85,88,88,0)');
smokeContext.fillStyle = smokeGradient;
smokeContext.fillRect(0, 0, 128, 128);
const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
const smokeMaterial = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0.48, depthWrite: false });
const fireSmoke: THREE.Sprite[] = [];
for (let i = 0; i < 7; i++) {
  const smoke = new THREE.Sprite(smokeMaterial.clone());
  smoke.position.set(-3.45 + i * 0.22, 0.75 + (i % 3) * 0.12, -4.0 + (i % 2 ? 0.95 : -0.95));
  smoke.scale.set(0.55, 0.8, 1);
  course.add(smoke);
  fireSmoke.push(smoke);
}

// Narrow single-plank crossing between the deep water and oil modules.
slopedDeck('single_plank_entry', -7.95, -7.70, -4.0, 2.4, 0.03, 0.22, 0.14, mats.wood);
box(course, mats.wood, V(-7.0, 0.14, -4.0), V(1.4, 0.16, 2.4));
box(course, mats.black, V(-7.0, 0.045, -4.0), V(1.45, 0.05, 2.48));
slopedDeck('single_plank_exit', -6.30, -6.05, -4.0, 2.4, 0.22, 0.03, 0.14, mats.wood);
for (const side of [-1, 1]) {
  solidBox(`single_plank_side_guide_${side}`, -7.0, -4.0 + side * 1.42, 1.9, 0.16, 0.28, mats.black, 0, 0.17);
}

// Hazard 2: road-width cooling basin directly after fire. The floor is low,
// while the animated water surface sits above the track tread line.
const waterPool = box(course, mats.water, V(-4.8, 0.045, -4.0), V(2.0, 0.03, DRIVE_ROUTE_WIDTH - 0.08));
waterPool.castShadow = false;
box(course, mats.metal, V(-4.8, -0.16, -4.0), V(2.12, 0.08, DRIVE_ROUTE_WIDTH + 0.08), 0, false);
const hazardWaterRipples: THREE.Mesh[] = [];
for (let i = 0; i < 5; i++) {
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.20, 24), new THREE.MeshBasicMaterial({ color: '#a9f4ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(-5.55 + i * 0.36, 0.064, -4.0 + (i % 2 ? 0.7 : -0.7));
  course.add(ripple);
  hazardWaterRipples.push(ripple);
}

// Hazard 3: oil follows the raised plank crossing (x in [-10.5, -8.0]).
box(course, mats.oil, V(-9.25, 0.04, -4.0), V(2.6, 0.02, DRIVE_ROUTE_WIDTH - 0.08), 0, false);

// -------------------------------------------------------------
// 4. Switchback Climbing Hill (Part 7)
// -------------------------------------------------------------
// One miter-joined climbing surface replaces stacked midpoint-height slabs.
// The height profile eases each incline and stays level through every landing.
const hillDeckWidth = 3.4;
createRouteRibbon(0, hillDeckWidth, mats.wood, 0.006, HILL_NODES);
createRouteRibbon(0, hillDeckWidth, mats.black, -0.16, HILL_NODES);
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  const a = HILL_NODES[i];
  const b = HILL_NODES[i + 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const midZ = (a.z + b.z) / 2;
  const w = hillDeckWidth; // Broad enough for both track covers through every turn shelf.
  const deck = { nx: -dz / len, nz: dx / len, length: len };
  colliders.push({
    id: `hill_seg_${i}`,
    x: midX,
    z: midZ,
    hx: Math.abs(dx) / 2 + Math.abs(deck.nx) * w / 2,
    hz: Math.abs(dz) / 2 + Math.abs(deck.nz) * w / 2,
    y: midY - 0.08,
    height: 0.16,
    rot: 0,
    walkable: true,
  });

  // Raised edge beams follow each slope and meet at the level landing shelves.
  for (const side of [-1, 1]) {
    const offset = side * (w / 2 - 0.12);
    const railStart = V(a.x + deck.nx * offset, a.y + 0.30, a.z + deck.nz * offset);
    const railEnd = V(b.x + deck.nx * offset, b.y + 0.30, b.z + deck.nz * offset);
    beamBetween(railStart, railEnd, 0.10, mats.black);
  }

  // Steel legs support each sloping board at regular intervals from the floor.
  const supports = Math.max(1, Math.ceil(len / 1.7));
  for (let s = 0; s <= supports; s++) {
    const t = s / supports;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const surfaceY = evaluateCourseHeight(x + deck.nx * (w / 2 - 0.24), z + deck.nz * (w / 2 - 0.24)) - 0.16;
    const height = surfaceY - 0.03;
    if (height < 0.14) continue;
    for (const side of [-1, 1]) {
      cyl(course, mats.metal, V(x + deck.nx * side * (w / 2 - 0.24), 0.03 + height / 2, z + deck.nz * side * (w / 2 - 0.24)), 0.045, height, 'y', 8);
    }
  }
}

// -------------------------------------------------------------
// 5. Corrected Parallel Plank Bridge (spacing matches 1.58m track width)
// -------------------------------------------------------------
// Paired plank centres follow the robot's actual track spacing.
for (const [i, plank] of PARALLEL_PLANK_CENTERS.entries()) {
  box(course, mats.wood, V(plank.x, 0.21, plank.z), V(4.2, 0.18, 0.65));
  box(course, mats.black, V(plank.x, 0.10, plank.z), V(4.25, 0.05, 0.70));
  colliders.push({ id: `parallel_plank_${i === 0 ? 'left' : 'right'}`, x: plank.x, z: plank.z, hx: 2.1, hz: 0.35, y: 0.21, height: 0.18, rot: 0, walkable: true });
}

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
  const gateY = evaluateCourseHeight(cp.x, cp.z);
  g.position.set(cp.x, gateY, cp.z);
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
  // Put the number board on an outer shoulder post instead of suspending it
  // in the center of the lane, where it read as a floating blind obstacle.
  const signX = -cp.width / 2 - 0.30;
  cyl(g, mats.metal, V(signX, 0.46, 0), 0.035, 0.58, 'y');
  signMesh.position.set(signX, 0.86, 0);
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

const routeClearanceAudit = validateRouteClearance(colliders);
const driveRouteAudit = validateDriveRoute();
const slalomClearanceAudit = validateSlalomClearance();
if (!routeClearanceAudit.valid) {
  console.warn('Course clearance audit found possible checkpoint obstructions:', routeClearanceAudit.issues);
}
if (!driveRouteAudit.valid) {
  console.error('Drive corridor validation failed:', driveRouteAudit.issues);
}
if (!slalomClearanceAudit.valid) {
  console.error('Slalom passage validation failed:', slalomClearanceAudit.issues);
}

const recoveryAnchors = createDefaultRecoveryAnchors(MAP_SCALE).map(anchor => ({
  ...anchor,
  y: evaluateCourseHeight(anchor.x / MAP_SCALE, anchor.z / MAP_SCALE) - TRACK_CONTACT_OFFSET,
}));
const worldCourseHeight = (x: number, z: number) => evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE);

// -------------------------------------------------------------
// 7. Fixed Rigid Robot Model with Realistic Mechatronics (Part 3)
// -------------------------------------------------------------
const robot = new THREE.Group();
robot.rotation.order = 'YXZ';
scene.add(robot);

// RIGID CENTRAL CHASSIS: strictly un-morphed, locked scale (1,1,1)
// All mechanical components are children of robotBody so that the complete vehicle
// pitches, yaws, rolls, and flips as ONE coherent rigid body!
const robotBody = new THREE.Group();
robotBody.rotation.order = 'YXZ';
robot.add(robotBody);

const chassis = new THREE.Group();
robotBody.add(chassis);

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
const batteryMesh = box(chassis, new THREE.MeshStandardMaterial({ color: '#2558a0', roughness: 0.55 }), V(-0.24, 0.52, -0.05), V(0.48, 0.16, 0.72));
box(chassis, mats.yellow, V(-0.24, 0.605, -0.05), V(0.24, 0.015, 0.4)); // Battery label

// 2. Dual Brushless Motors (left and right with cooling ribs and copper stator coils)
for (const side of [-1, 1]) {
  const mx = side * 0.46;
  cyl(chassis, mats.metal, V(mx, 0.44, -0.48), 0.13, 0.30, 'z');
  // Copper stator coils visible through motor cooling slits
  cyl(chassis, new THREE.MeshStandardMaterial({ color: '#c86e38', metalness: 0.85, roughness: 0.35 }), V(mx, 0.44, -0.48), 0.11, 0.22, 'z');
}

// 3. Dual ESCs with ruby anodized extruded heat sinks
for (const x of [-0.18, 0.18]) {
  box(chassis, new THREE.MeshStandardMaterial({ color: '#8b1c1c', roughness: 0.35, metalness: 0.85 }), V(x, 0.51, 0.42), V(0.26, 0.08, 0.24));
  // Heat sink cooling fins
  for (let f = -0.10; f <= 0.10; f += 0.035) {
    box(chassis, mats.black, V(x + f, 0.56, 0.42), V(0.015, 0.04, 0.22));
  }
}

// 4. 2.4GHz Radio Receiver with dual whip antennas
box(chassis, mats.black, V(0.28, 0.50, -0.08), V(0.26, 0.08, 0.24));
cyl(chassis, mats.metal, V(0.25, 0.58, -0.08), 0.02, 0.08, 'y');
cyl(chassis, mats.metal, V(0.31, 0.58, -0.08), 0.02, 0.08, 'y');
cyl(chassis, mats.black, V(0.25, 0.82, -0.08), 0.012, 0.48, 'y');
cyl(chassis, mats.black, V(0.31, 0.82, -0.08), 0.012, 0.48, 'y');

// 5. Silicone power cables and XT60 connector
cyl(chassis, mats.red, V(-0.04, 0.56, 0.15), 0.015, 0.38, 'z');
cyl(chassis, mats.black, V(0.04, 0.56, 0.15), 0.015, 0.38, 'z');
box(chassis, mats.yellow, V(0, 0.56, 0.32), V(0.06, 0.04, 0.08)); // XT60

// Track Assemblies and Yellow Protective Coverings (strictly inside robotBody)
const trackCovers: THREE.Mesh[] = [];
const tracks: { group: THREE.Group; cleats: THREE.Mesh[]; wheelSpins: THREE.Group[]; phase: number }[] = [];

function createTrackBeltGeometry() {
  const centerZ = 0.58;
  const centerY = 0.32;
  const outerRadius = 0.20;
  const innerRadius = 0.135;
  const shape = new THREE.Shape();
  shape.moveTo(-centerZ, centerY - outerRadius);
  shape.lineTo(centerZ, centerY - outerRadius);
  shape.absarc(centerZ, centerY, outerRadius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-centerZ, centerY + outerRadius);
  shape.absarc(-centerZ, centerY, outerRadius, Math.PI / 2, Math.PI * 1.5, false);
  shape.closePath();

  const inner = new THREE.Path();
  inner.moveTo(-centerZ, centerY + innerRadius);
  inner.lineTo(centerZ, centerY + innerRadius);
  inner.absarc(centerZ, centerY, innerRadius, Math.PI / 2, -Math.PI / 2, true);
  inner.lineTo(-centerZ, centerY - innerRadius);
  inner.absarc(-centerZ, centerY, innerRadius, -Math.PI / 2, -Math.PI * 1.5, true);
  inner.closePath();
  shape.holes.push(inner);

  const width = 0.34;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 16, steps: 1 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const trackBeltGeometry = createTrackBeltGeometry();
const trackLoopRadius = 0.195;
const trackStraightLength = 1.16;
const trackLoopLength = trackStraightLength * 2 + Math.PI * 2 * trackLoopRadius;

function sampleTrackLoop(distance: number) {
  const s = ((distance % trackLoopLength) + trackLoopLength) % trackLoopLength;
  let y: number;
  let z: number;
  let tangentY: number;
  let tangentZ: number;
  if (s < trackStraightLength) {
    z = -0.58 + s;
    y = 0.32 + trackLoopRadius;
    tangentY = 0;
    tangentZ = 1;
  } else if (s < trackStraightLength + Math.PI * trackLoopRadius) {
    const angle = Math.PI / 2 - (s - trackStraightLength) / trackLoopRadius;
    z = 0.58 + Math.cos(angle) * trackLoopRadius;
    y = 0.32 + Math.sin(angle) * trackLoopRadius;
    tangentY = -Math.cos(angle);
    tangentZ = Math.sin(angle);
  } else if (s < trackStraightLength * 2 + Math.PI * trackLoopRadius) {
    const u = s - trackStraightLength - Math.PI * trackLoopRadius;
    z = 0.58 - u;
    y = 0.32 - trackLoopRadius;
    tangentY = 0;
    tangentZ = -1;
  } else {
    const u = s - trackStraightLength * 2 - Math.PI * trackLoopRadius;
    const angle = -Math.PI / 2 - u / trackLoopRadius;
    z = -0.58 + Math.cos(angle) * trackLoopRadius;
    y = 0.32 + Math.sin(angle) * trackLoopRadius;
    tangentY = -Math.cos(angle);
    tangentZ = Math.sin(angle);
  }
  return { y, z, rotationX: Math.atan2(-tangentY, tangentZ) };
}

for (const side of [-1, 1]) {
  const x = side * (TRACK_WIDTH / 2);
  const trackGroup = new THREE.Group();
  trackGroup.position.x = x;
  robotBody.add(trackGroup);

  // Authentic yellow protective track guard
  const guard = box(robotBody, mats.coverYellow, V(x, 0.68, 0), V(0.40, 0.14, 1.70));
  const outerSkirt = box(robotBody, mats.coverYellow, V(x, 0.56, 0), V(0.40, 0.12, 1.58));
  // End bevel caps on yellow guards
  for (const end of [-1, 1]) {
    const cap = box(robotBody, mats.coverYellow, V(x, 0.64, end * 0.82), V(0.39, 0.10, 0.14));
    trackCovers.push(cap);
  }
  trackCovers.push(guard, outerSkirt);

  // Continuous rubber belt band with an open center so the exposed wheels remain visible.
  const belt = new THREE.Mesh(trackBeltGeometry, mats.rubber);
  belt.castShadow = true;
  belt.receiveShadow = true;
  trackGroup.add(belt);

  // Two wheels per side, four total: one motor wheel and one passive idler.
  // The reference images do not reveal which wheel is powered, so use the
  // requested diagonal default (left-front + right-rear) as a documented
  // configuration assumption. Idlers receive no independent torque.
  const wheelSpins: THREE.Group[] = [];
  for (const end of [-1, 1]) {
    const isPowered = side < 0 ? end > 0 : end < 0;
    const spin = new THREE.Group();
    spin.position.set(0, 0.32, end * 0.58);
    trackGroup.add(spin);
    const wheel = cyl(spin, mats.wheel, V(0, 0, 0), DRIVE_SPROCKET_RADIUS_M, 0.36, 'x', 24);
    wheel.userData = { role: isPowered ? 'motor-driven sprocket' : 'passive belt-driven idler' };
    cyl(spin, mats.metal, V(side * 0.19, 0, 0), 0.05, 0.04, 'x', 12);
    wheelSpins.push(spin);
  }

  // Track cleats (treads) that animate along stadium path
  const cleats: THREE.Mesh[] = [];
  const cleatGeo = new THREE.BoxGeometry(0.35, 0.035, 0.13);
  for (let i = 0; i < 24; i++) {
    const point = sampleTrackLoop((i / 24) * trackLoopLength);
    const q = new THREE.Mesh(cleatGeo, mats.black);
    q.position.set(0, point.y, point.z);
    q.rotation.x = point.rotationX;
    q.castShadow = true;
    trackGroup.add(q);
    cleats.push(q);
  }

  tracks.push({ group: trackGroup, cleats, wheelSpins, phase: 0 });
}

// Contact shadow beneath robot (placed in scene, follows vehicle on ground)
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.05, 32),
  new THREE.MeshBasicMaterial({ color: '#090c0a', transparent: true, opacity: 0.38, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.035;
scene.add(shadow);

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

// Small pooled droplets are emitted only while the robot is actually moving
// or turning through the shallow fire-to-water cooling section.
const splashGeo = new THREE.SphereGeometry(0.045, 6, 5);
const splashMat = new THREE.MeshBasicMaterial({ color: '#8edce8', transparent: true, opacity: 0.72, depthWrite: false });
const splashParticles: Array<{ mesh: THREE.Mesh; life: number; vx: number; vy: number; vz: number }> = [];
for (let i = 0; i < 24; i++) {
  const m = new THREE.Mesh(splashGeo, splashMat);
  m.visible = false;
  scene.add(m);
  splashParticles.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
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
  cameraSensitivity: clamp(Number(savedPrefs.cameraSensitivity ?? 1.0), 0.3, 2.0),
  cameraFov: clamp(Number(savedPrefs.cameraFov ?? 54), 40, 80),
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
let previousRacePosition = { x: pose.x, z: pose.z };

let subsystems: SubsystemsState = createInitialSubsystems();
let raceState: 'menu' | 'countdown' | 'racing' | 'paused' | 'finished' | 'failed' = 'menu';
let elapsed = 0;
let penaltyTime = 0;
let countdown = 0;
let currentCheckpoint = 0;
let cameraMode = 0; // Selected home view; free-look is available in every view.
let cameraOrbitYaw = pose.yaw + Math.PI;
let cameraOrbitPitch = 0.72;
let cameraOrbitDistance = 6.8;
let cameraFollowYaw = pose.yaw;
let cameraFreeYaw = 0;
let cameraFreePitch = 0;
let cameraDistanceOffset = 0;
let cameraFreeLookIdle = 0;
const cameraKeys = new Set<string>();
let cameraPointerId: number | null = null;
let cameraPointerX = 0;
let cameraPointerY = 0;
let bestTime = Number(localStorage.getItem('robo-race-best-v2') || '0');
let toastTimer = 0;
let recoveryCooldown = 0;
let audioCtx: AudioContext | undefined;
let cutawayMode = false;
let drivingHudVisible = false;
let diagnosticsModalOpen = false;
let lastReportedYaw = 0;

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
    cameraSensitivity: config.cameraSensitivity,
    cameraFov: config.cameraFov,
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
      KEYBOARD&nbsp; <kbd>W</kbd><kbd>S</kbd> DRIVE &nbsp; <kbd>A</kbd> LEFT · <kbd>D</kbd> RIGHT &nbsp; <kbd>SPACE</kbd> BRAKE &nbsp; <kbd>R</kbd> RECOVER &nbsp; <kbd>C</kbd> CAMERA &nbsp; <kbd>ESC</kbd> PAUSE · CAMERA: RMB DRAG / NUMPAD
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
      <label>Camera Field of View <input id="cameraFov" type="range" min="40" max="80" step="1" value="54"></label>
      <label>Orbit Sensitivity <input id="cameraSens" type="range" min="0.3" max="2.0" step="0.1" value="1.0"></label>
      <div class="control-diagram">FREE CAMERA: Hold right mouse and drag to look · Numpad 4/6 orbit · Numpad 8/2 tilt · Numpad +/- zoom · wheel zoom. It eases back to the selected view after 4.5 seconds. Camera movement never drives the robot.</div>
      <div class="control-diagram">
        <b>DIFFERENTIAL CONTROLS:</b><br>
        W: Forward · S: Reverse<br>
        A: Counter-clockwise turn · D: Clockwise turn<br>
        T: Optional right-turn key<br>
        W+A / W+D: Forward left / right arcs<br>
        S+A / S+D: Reverse clockwise / counter-clockwise arcs<br>
        W+T / S+T: Right / reverse-left arcs<br>
        A alone: Pivot left · D/T/B: Pivot right<br>
        A+D: Opposing steering cancels to 0<br>
        W+S: Opposing throttle cancels to 0<br>
        Space: Mechanical brake · R: Safe checkpoint recovery
      </div>
      <button id="openCalibBtn" class="action" style="width:100%;margin-top:10px;background:#eab449;color:#101512;font-weight:800;border:none;">🎮 CONTROLLER CALIBRATION & DIAGNOSTICS</button>
    </div>
    <div id="driveTelemetry" class="drive-telemetry hidden"></div>

    <div id="diagnosticsModal" class="diagnostics-modal hidden">
      <div class="diag-header">
        <h2>🎮 CONTROLLER CALIBRATION & LIVE DIAGNOSTICS</h2>
        <button id="closeCalibBtn" class="diag-close">✕ CLOSE</button>
      </div>

      <div id="diagBanner" class="diag-banner ok">
        <span id="diagDeviceName">Device: None</span>
        <span id="diagFailsafeState">Failsafe: OK</span>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">HARDWARE PROFILE & PRESET</div>
        <div class="diag-grid-2">
          <label>Hardware Profile
            <select id="diagProfileSelect">
              <option value="default_gamepad">Standard Gamepad (Xbox/PlayStation)</option>
              <option value="radiomaster_boxer">RadioMaster Boxer / TX16S (EdgeTX)</option>
              <option value="flysky_fsi6x">FlySky FS-i6X / FS-i6</option>
              <option value="jumper_tpro">Jumper T-Pro / T-Lite</option>
            </select>
          </label>
          <label>Mode
            <select id="diagModeSelect">
              <option value="single_stick">Single Stick / Universal</option>
              <option value="tank_dual_stick">Dual Stick (Tank Mode)</option>
            </select>
          </label>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">AXIS CHANNEL MAPPINGS & INVERSION</div>
        <div class="diag-grid-4">
          <label>Steering Axis
            <select id="diagSteerAxis">
              <option value="0">Axis 0 (Left X)</option>
              <option value="1">Axis 1 (Left Y)</option>
              <option value="2">Axis 2 (Right X)</option>
              <option value="3">Axis 3 (Right Y)</option>
            </select>
          </label>
          <label>Throttle Axis
            <select id="diagThrottleAxis">
              <option value="0">Axis 0 (Left X)</option>
              <option value="1">Axis 1 (Left Y)</option>
              <option value="2">Axis 2 (Right X)</option>
              <option value="3">Axis 3 (Right Y)</option>
            </select>
          </label>
          <label>Left Track (Tank)
            <select id="diagLeftTrackAxis">
              <option value="0">Axis 0 (Left X)</option>
              <option value="1">Axis 1 (Left Y)</option>
              <option value="2">Axis 2 (Right X)</option>
              <option value="3">Axis 3 (Right Y)</option>
            </select>
          </label>
          <label>Right Track (Tank)
            <select id="diagRightTrackAxis">
              <option value="0">Axis 0 (Left X)</option>
              <option value="1">Axis 1 (Left Y)</option>
              <option value="2">Axis 2 (Right X)</option>
              <option value="3">Axis 3 (Right Y)</option>
            </select>
          </label>
        </div>
        <div class="diag-toggle-row">
          <label><input type="checkbox" id="diagInvertSteer"> Invert Steering</label>
          <label><input type="checkbox" id="diagInvertThrottle"> Invert Throttle</label>
          <button id="diagCalibCenterBtn" class="diag-btn">🎯 Calibrate Center (Zero Drift)</button>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">CANONICAL SEMANTIC DIRECTION VERIFICATION</div>
        <div class="diag-grid-4">
          <div class="diag-metric">
            <small>PHYSICAL STEERING</small>
            <strong id="diagPhysicalSteer">CENTER</strong>
            <div class="diag-bar-track"><div id="diagBarSteer" class="diag-bar-fill" style="width:50%"></div></div>
          </div>
          <div class="diag-metric">
            <small>SEMANTIC HEADING</small>
            <strong id="diagSemanticSteer">0.00</strong>
          </div>
          <div class="diag-metric">
            <small>EXPECTED NOSE</small>
            <strong id="diagExpectedNose">STRAIGHT</strong>
          </div>
          <div class="diag-metric">
            <small>DELTA YAW RATE</small>
            <strong id="diagDeltaYaw">0.00 rad/s</strong>
          </div>
        </div>
        <div class="diag-grid-4" style="margin-top:6px;">
          <div class="diag-metric">
            <small>THROTTLE DEMAND</small>
            <strong id="diagThrottleLabel">NEUTRAL</strong>
          </div>
          <div class="diag-metric">
            <small>SEMANTIC VALUE</small>
            <strong id="diagThrottleValue">0.00</strong>
          </div>
          <div class="diag-metric">
            <small>LEFT TRACK DEMAND</small>
            <strong id="diagLeftTrack">0.00</strong>
          </div>
          <div class="diag-metric">
            <small>RIGHT TRACK DEMAND</small>
            <strong id="diagRightTrack">0.00</strong>
          </div>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">RAW HARDWARE AXIS INPUTS</div>
        <div id="diagRawAxesList" class="diag-raw-axes">
          <span class="diag-axis-pill">No active controller detected</span>
        </div>
      </div>
    </div>
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

  $('#cameraFov').addEventListener('input', e => {
    config.cameraFov = Number((e.target as HTMLInputElement).value);
    camera.fov = config.cameraFov;
    camera.updateProjectionMatrix();
    savePreferences();
  });

  $('#cameraSens').addEventListener('input', e => {
    config.cameraSensitivity = Number((e.target as HTMLInputElement).value);
    savePreferences();
  });

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 2 && !(cameraMode === 3 && e.button === 0)) return;
    cameraPointerId = e.pointerId;
    cameraPointerX = e.clientX;
    cameraPointerY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (cameraPointerId !== e.pointerId) return;
    const scale = 0.004 * config.cameraSensitivity;
    cameraFreeYaw -= (e.clientX - cameraPointerX) * scale;
    cameraFreePitch = clamp(cameraFreePitch + (e.clientY - cameraPointerY) * scale, -1.25, 1.25);
    cameraFreeLookIdle = 4.5;
    cameraPointerX = e.clientX;
    cameraPointerY = e.clientY;
  });
  const endCameraOrbit = (e: PointerEvent) => {
    if (cameraPointerId !== e.pointerId) return;
    cameraPointerId = null;
  };
  canvas.addEventListener('pointerup', endCameraOrbit);
  canvas.addEventListener('pointercancel', endCameraOrbit);
  canvas.addEventListener('lostpointercapture', endCameraOrbit);
  canvas.addEventListener('wheel', e => {
    cameraDistanceOffset = clamp(cameraDistanceOffset + Math.sign(e.deltaY) * 0.65, -4.5, 8.0);
    cameraFreeLookIdle = 4.5;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Diagnostics & Calibration modal logic
  function syncDiagnosticsUI() {
    const profile = controller.getCurrentProfile();
    const ctrlConfig = controller.getConfig();
    const profSelect = $<HTMLSelectElement>('#diagProfileSelect');
    if (profSelect) profSelect.value = profile.id;
    const modeSelect = $<HTMLSelectElement>('#diagModeSelect');
    if (modeSelect) modeSelect.value = ctrlConfig.mode;
    const steerSelect = $<HTMLSelectElement>('#diagSteerAxis');
    if (steerSelect) steerSelect.value = String(profile.steeringAxis);
    const thrSelect = $<HTMLSelectElement>('#diagThrottleAxis');
    if (thrSelect) thrSelect.value = String(profile.throttleAxis);
    const leftSelect = $<HTMLSelectElement>('#diagLeftTrackAxis');
    if (leftSelect) leftSelect.value = String(profile.leftTrackAxis);
    const rightSelect = $<HTMLSelectElement>('#diagRightTrackAxis');
    if (rightSelect) rightSelect.value = String(profile.rightTrackAxis);
    const invSteer = $<HTMLInputElement>('#diagInvertSteer');
    if (invSteer) invSteer.checked = profile.invertSteering;
    const invThr = $<HTMLInputElement>('#diagInvertThrottle');
    if (invThr) invThr.checked = profile.invertThrottle;
  }

  function toggleDiagnosticsModal(show?: boolean) {
    diagnosticsModalOpen = typeof show === 'boolean' ? show : !diagnosticsModalOpen;
    $<HTMLElement>('#diagnosticsModal').classList.toggle('hidden', !diagnosticsModalOpen);
    if (diagnosticsModalOpen) {
      controller.neutralize();
      syncDiagnosticsUI();
    }
  }

  $('#openCalibBtn').addEventListener('click', () => toggleDiagnosticsModal(true));
  $('#closeCalibBtn').addEventListener('click', () => toggleDiagnosticsModal(false));

  $('#diagProfileSelect').addEventListener('change', e => {
    controller.selectProfileById((e.target as HTMLSelectElement).value);
    syncDiagnosticsUI();
    displayToast('HARDWARE PROFILE SWITCHED');
  });

  $('#diagModeSelect').addEventListener('change', e => {
    const mode = (e.target as HTMLSelectElement).value as ControllerMode;
    config.controlMode = mode;
    controller.updateConfig({ mode });
    savePreferences();
    displayToast(`MODE: ${mode.toUpperCase()}`);
  });

  $('#diagSteerAxis').addEventListener('change', e => {
    controller.setAxisMapping('steering', Number((e.target as HTMLSelectElement).value));
  });
  $('#diagThrottleAxis').addEventListener('change', e => {
    controller.setAxisMapping('throttle', Number((e.target as HTMLSelectElement).value));
  });
  $('#diagLeftTrackAxis').addEventListener('change', e => {
    controller.setAxisMapping('leftTrack', Number((e.target as HTMLSelectElement).value));
  });
  $('#diagRightTrackAxis').addEventListener('change', e => {
    controller.setAxisMapping('rightTrack', Number((e.target as HTMLSelectElement).value));
  });

  $('#diagInvertSteer').addEventListener('change', () => {
    controller.toggleInvert('steering');
    syncDiagnosticsUI();
    displayToast(`STEERING INVERT: ${controller.getCurrentProfile().invertSteering ? 'ON' : 'OFF'}`);
  });
  $('#diagInvertThrottle').addEventListener('change', () => {
    controller.toggleInvert('throttle');
    syncDiagnosticsUI();
    displayToast(`THROTTLE INVERT: ${controller.getCurrentProfile().invertThrottle ? 'ON' : 'OFF'}`);
  });
  $('#diagCalibCenterBtn').addEventListener('click', () => {
    controller.calibrateCenter();
    displayToast('CENTER ZERO-POINT CALIBRATED');
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

function showFailure(reason: string) {
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow" style="color:#ff7770">RACE FAILED · ROBOT DISABLED</div>
        <h1>Run ended.</h1>
        <p>${reason}. Structural integrity reached zero. The drivetrain is disabled and this attempt cannot be recovered.</p>
        <p>Time: <b>${formatTime(elapsed)}</b> · Battery: ${subsystems.battery.percentage.toFixed(0)}%</p>
        <button class="action" id="btnRestartFailed">RESTART RACE</button>
        <div class="subactions"><button class="iconbtn" id="btnFailedMenu">MAIN MENU</button></div>
      </div>
    </div>
  `;
  $('#btnRestartFailed', o).addEventListener('click', startRace);
  $('#btnFailedMenu', o).addEventListener('click', () => { raceState = 'menu'; showMenu(); });
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
  canvas.classList.toggle('orbit-inspection', cameraMode === 3);
  cameraPointerId = null;
  cameraFreeYaw = 0;
  cameraFreePitch = 0;
  cameraDistanceOffset = 0;
  cameraFreeLookIdle = 0;
  if (cameraMode === 3) {
    cameraOrbitYaw = pose.yaw + Math.PI;
    cameraOrbitPitch = 0.72;
  }
  const names = ['CHASE CAMERA', 'LOW BUMPER VIEW', 'TACTICAL OVERHEAD', 'FREE LOOK · DRAG TO ORBIT'];
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
  applyRecovery(pose, anchor, worldCourseHeight);
  motionState.x = pose.x;
  motionState.z = pose.z;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.yaw = pose.yaw;
  motionState.angular = 0;
  previousRacePosition = { x: pose.x, z: pose.z };

  raceState = 'countdown';
  countdown = 3.0;
  hideOverlays();
  displayToast('READY');
}

function restartRace() {
  startRace();
}

function recoverVehicle() {
  if (raceState !== 'racing' || isRobotDestroyed(subsystems) || recoveryCooldown > 0) return;
  recoveryCooldown = 1.0;

  const anchor = getSafeRecoveryAnchor(currentCheckpoint, recoveryAnchors, candidate => {
    const half = getFootprintAabbHalfExtents(candidate.yaw);
    const x = candidate.x / MAP_SCALE;
    const z = candidate.z / MAP_SCALE;
    return colliders.every(c => c.walkable ||
      Math.abs(x - c.x) >= c.hx + half.x / MAP_SCALE ||
      Math.abs(z - c.z) >= c.hz + half.z / MAP_SCALE);
  });
  if (!anchor) {
    displayToast('NO CLEAR RECOVERY POINT · MOVE TO SAFETY');
    return;
  }
  currentCheckpoint = anchor.checkpointIndex;
  checkpointMeshes.forEach((checkpoint, i) => {
    checkpoint.passed = i < currentCheckpoint;
    (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#f0bd53' : '#88a679');
  });
  applyRecovery(pose, anchor, worldCourseHeight);

  motionState.x = pose.x;
  motionState.z = pose.z;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.yaw = pose.yaw;
  motionState.angular = 0;
  previousRacePosition = { x: pose.x, z: pose.z };

  penaltyTime += config.penalty;
  tone(380, 0.18, 0.05);
  displayToast(`RECOVERED TO ${anchor.label.toUpperCase()} · +${config.penalty}s`);
}

// Global Key Listeners
const CAMERA_KEY_CODES = new Set(['Numpad4', 'Numpad6', 'Numpad8', 'Numpad2', 'NumpadAdd', 'NumpadSubtract']);
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyT', 'KeyD', 'KeyB'].includes(e.code)) {
    e.preventDefault();
  }
  if (CAMERA_KEY_CODES.has(e.code)) {
    e.preventDefault();
    cameraKeys.add(e.code);
    cameraFreeLookIdle = 4.5;
  }
  controller.handleKeyDown(e.code);

  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (diagnosticsModalOpen) {
      diagnosticsModalOpen = false;
      $('#diagnosticsModal').classList.add('hidden');
    } else {
      togglePause();
    }
  }
  if (e.code === 'KeyR' && raceState === 'racing' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) recoverVehicle();
  if (e.code === 'KeyC' && raceState !== 'menu') cycleCamera();
  if (e.code === 'F2') {
    diagnosticsModalOpen = !diagnosticsModalOpen;
    $('#diagnosticsModal').classList.toggle('hidden', !diagnosticsModalOpen);
    if (diagnosticsModalOpen) {
      controller.neutralize();
      const prof = controller.getCurrentProfile();
      const ps = $<HTMLSelectElement>('#diagProfileSelect');
      if (ps) ps.value = prof.id;
    }
  }
  if (e.code === 'F3') {
    drivingHudVisible = !drivingHudVisible;
    $('#driveTelemetry').classList.toggle('hidden', !drivingHudVisible);
  }
});

window.addEventListener('keyup', e => {
  controller.handleKeyUp(e.code);
  cameraKeys.delete(e.code);
});
window.addEventListener('blur', () => {
  cameraKeys.clear();
  cameraPointerId = null;
});

// -------------------------------------------------------------
// 11. Physics Step & Collision Resolution
// -------------------------------------------------------------
const FIXED_DT = 1 / 120;
let accumulator = 0;
let lastFrameTime = performance.now();

function collidesWithBarrier(x: number, z: number, y: number) {
  const half = getFootprintAabbHalfExtents(pose.yaw);
  const robotBottom = y + TRACK_CONTACT_OFFSET;
  const robotTop = y + ROBOT_COLLISION_HEIGHT;
  for (const c of colliders) {
    if (c.walkable) continue;
    if (c.y + c.height / 2 < robotBottom || c.y - c.height / 2 > robotTop) continue;
    const dx = x - c.x * MAP_SCALE;
    const dz = z - c.z * MAP_SCALE;
    const halfW = c.hx * MAP_SCALE;
    const halfD = c.hz * MAP_SCALE;

    if (Math.abs(dx) < halfW + half.x && Math.abs(dz) < halfD + half.z) {
      const overlapX = (halfW + half.x) - Math.abs(dx);
      const overlapZ = (halfD + half.z) - Math.abs(dz);
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
    routeClearanceAudit,
    slalomClearanceAudit,
    groundContact: {
      terrainY: evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE),
      trackBottomY: pose.y + TRACK_CONTACT_OFFSET,
    },
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
      maxSpeed: Math.min(tuning.maxSpeed * config.sensitivity, maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])),
      motorTrackSpeed: Math.min(maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])),
      motorAcceleration: Math.min(
        tuning.acceleration,
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[0]),
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[1]),
      ) * subsystems.motors.thermalThrottle,
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

  if (isRobotDestroyed(subsystems)) {
    raceState = 'failed';
    controller.neutralize();
    motionState.vx = 0;
    motionState.vz = 0;
    motionState.angular = 0;
    pose.vx = 0;
    pose.vz = 0;
    pose.yawRate = 0;
    showFailure('Chassis integrity depleted');
  }

  // Update Three.js Robot Rigidbody Position and Rotation (unified rigid structure)
  robot.position.set(pose.x, pose.y, pose.z);
  robot.rotation.y = pose.yaw;
  robotBody.rotation.x = pose.pitch;
  robotBody.rotation.z = pose.roll;
  chassis.rotation.set(0, 0, 0);

  // Position contact shadow on ground beneath vehicle
  const groundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE);
  shadow.position.set(pose.x, groundY + 0.015, pose.z);
  shadow.rotation.z = pose.yaw;
  (shadow.material as THREE.MeshBasicMaterial).opacity = pose.isFlipped ? 0.08 : 0.40;

  // Debug hook for automated verification
  (window as unknown as Record<string, unknown>).__gameDebug = {
    raceState,
    countdown,
    pose,
    motionState,
    inputs,
    subsystems,
    currentCheckpoint,
    routeClearanceAudit,
    slalomClearanceAudit,
    groundContact: {
      terrainY: evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE),
      trackBottomY: pose.y + TRACK_CONTACT_OFFSET,
    },
  };

  // Animate track cleats and road wheels independently for left and right tracks
  for (let side = 0; side < tracks.length; side++) {
    const tr = tracks[side];
    const beltSpeed = side === 0 ? driveResult.trackSpeedLeft : driveResult.trackSpeedRight;
    tr.phase = (tr.phase + beltSpeed * dt + trackLoopLength) % trackLoopLength;

    for (let i = 0; i < tr.cleats.length; i++) {
      const point = sampleTrackLoop((i / tr.cleats.length) * trackLoopLength + tr.phase);
      const q = tr.cleats[i];
      q.position.y = point.y;
      q.position.z = point.z;
      q.rotation.x = point.rotationX;
    }

    for (const w of tr.wheelSpins) {
      // Passive idlers turn only because the same belt pulls them; both
      // end wheels share the belt's speed and never add drive force.
      w.rotation.x += beltSpeed * dt / DRIVE_SPROCKET_RADIUS_M;
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

  const waterMotion = Math.hypot(pose.vx, pose.vz);
  const splashRate = surf.hazard === 'water' ? dt * (3 + waterMotion * 1.5 + Math.abs(motionState.angular) * 14) : 0;
  if (splashRate > 0 && Math.random() < splashRate) {
    const p = splashParticles.find(drop => drop.life <= 0);
    if (p) {
  const side = Math.random() < 0.5 ? -1 : 1;
      const rightX = Math.cos(pose.yaw);
      const rightZ = -Math.sin(pose.yaw);
      p.life = 0.42 + Math.random() * 0.22;
      p.mesh.visible = true;
      p.mesh.position.set(pose.x + rightX * side * 0.78, Math.max(pose.y + 0.24, 0.09), pose.z + rightZ * side * 0.78);
      p.vx = pose.vx * 0.18 + rightX * side * (0.45 + Math.random() * 0.65);
      p.vy = 0.75 + Math.random() * 1.1;
      p.vz = pose.vz * 0.18 + rightZ * side * (0.45 + Math.random() * 0.65);
      p.mesh.scale.setScalar(0.75 + Math.random() * 0.8);
    }
  }
  for (const p of splashParticles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.vy -= 4.8 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.scale.setScalar(Math.max(0.05, p.life * 2.4));
    if (p.life <= 0) p.mesh.visible = false;
  }

  // Checkpoint validation
  if (raceState === 'racing' && currentCheckpoint < checkpointMeshes.length) {
    const cp = checkpointMeshes[currentCheckpoint];

    if (crossesCheckpointGate(previousRacePosition, { x: pose.x, z: pose.z }, cp)) {
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
  previousRacePosition = { x: pose.x, z: pose.z };
}

// -------------------------------------------------------------
// 12. Camera Positioning & Tracking
// -------------------------------------------------------------
function updateCamera(dt: number) {
  const yawError = Math.atan2(Math.sin(pose.yaw - cameraFollowYaw), Math.cos(pose.yaw - cameraFollowYaw));
  cameraFollowYaw += yawError * (1 - Math.exp(-dt * 6.0));
  const yawKey = Number(cameraKeys.has('Numpad6')) - Number(cameraKeys.has('Numpad4'));
  const pitchKey = Number(cameraKeys.has('Numpad8')) - Number(cameraKeys.has('Numpad2'));
  const zoomKey = Number(cameraKeys.has('NumpadSubtract')) - Number(cameraKeys.has('NumpadAdd'));
  const cameraIsMoving = yawKey !== 0 || pitchKey !== 0 || zoomKey !== 0;
  if (cameraIsMoving) {
    cameraFreeYaw -= yawKey * 1.35 * dt;
    cameraFreePitch = clamp(cameraFreePitch + pitchKey * 0.9 * dt, -1.25, 1.25);
    cameraDistanceOffset = clamp(cameraDistanceOffset + zoomKey * 3.0 * dt, -4.5, 8.0);
    cameraFreeLookIdle = 4.5;
  } else if (cameraFreeLookIdle > 0) {
    cameraFreeLookIdle = Math.max(0, cameraFreeLookIdle - dt);
  } else {
    const recenter = Math.exp(-dt * 1.35);
    cameraFreeYaw *= recenter;
    cameraFreePitch *= recenter;
    cameraDistanceOffset *= recenter;
  }

  let homeYaw: number;
  let homePitch: number;
  let homeDistance: number;
  let lookTarget: THREE.Vector3;

  if (cameraMode === 0) {
    homeYaw = cameraFollowYaw + Math.PI;
    homePitch = Math.atan2(6.3, 5.8);
    homeDistance = Math.hypot(5.8, 6.3);
    lookTarget = V(pose.x + Math.sin(cameraFollowYaw) * 0.5, pose.y + 0.65, pose.z + Math.cos(cameraFollowYaw) * 0.5);
  } else if (cameraMode === 1) {
    homeYaw = cameraFollowYaw + Math.PI;
    homePitch = Math.atan2(2.6, 4.2);
    homeDistance = Math.hypot(4.2, 2.6);
    lookTarget = V(pose.x + Math.sin(cameraFollowYaw) * 1.2, pose.y + 0.45, pose.z + Math.cos(cameraFollowYaw) * 1.2);
  } else if (cameraMode === 2) {
    homeYaw = Math.PI;
    homePitch = Math.atan2(13.5, 0.4);
    homeDistance = Math.hypot(13.5, 0.4);
    lookTarget = V(pose.x, pose.y, pose.z);
  } else {
    // Free inspection view uses the same drag/key controls and auto-home timer.
    homeYaw = cameraOrbitYaw;
    homePitch = cameraOrbitPitch;
    homeDistance = cameraOrbitDistance;
    lookTarget = V(pose.x, pose.y + 0.5, pose.z);
  }

  const orbitYaw = homeYaw + cameraFreeYaw;
  const orbitPitch = clamp(homePitch + cameraFreePitch, 0.08, 1.50);
  const orbitDistance = clamp(homeDistance + cameraDistanceOffset, 2.8, 22);
  const horizontal = Math.cos(orbitPitch) * orbitDistance;
  const offset = V(Math.sin(orbitYaw) * horizontal, Math.sin(orbitPitch) * orbitDistance, Math.cos(orbitYaw) * horizontal);
  cameraLookTarget.copy(lookTarget);
  cameraDesiredPosition.set(pose.x, pose.y, pose.z).add(offset);

  // Keep the view from entering visible course geometry. The same scene colliders used for
  // rendering are queried; this only moves the camera and never changes vehicle motion.
  cameraDirection.copy(cameraDesiredPosition).sub(cameraLookTarget);
  const desiredDistance = cameraDirection.length();
  cameraDirection.normalize();
  cameraRaycaster.set(cameraLookTarget, cameraDirection);
  cameraRaycaster.far = desiredDistance;
  cameraRayHits.length = 0;
  cameraRaycaster.intersectObjects(cameraOccluders, false, cameraRayHits);
  const obstruction = cameraRayHits.find(hit => hit.distance > 0.35);
  if (obstruction) cameraDesiredPosition.copy(cameraLookTarget).addScaledVector(cameraDirection, Math.max(0.5, obstruction.distance - 0.28));

  camera.position.lerp(cameraDesiredPosition, 1 - Math.exp(-dt * 4.5));
  camera.lookAt(cameraLookTarget);
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
      raceState === 'failed' ? 'ROBOT DISABLED · RESTART REQUIRED' :
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

  // Live Diagnostics & Calibration Meters
  if (diagnosticsModalOpen) {
    const diag = controller.getDiagnostics();
    const banner = $<HTMLElement>('#diagBanner');
    if (banner) {
      banner.className = `diag-banner ${diag.failsafeActive ? 'alert' : 'ok'}`;
    }
    const devName = $<HTMLElement>('#diagDeviceName');
    if (devName) {
      devName.textContent = `Active: ${diag.deviceName} (${diag.source.toUpperCase()}) | Profile: ${diag.profileName}`;
    }
    const failState = $<HTMLElement>('#diagFailsafeState');
    if (failState) {
      failState.textContent = diag.failsafeActive ? '⚠️ FAILSAFE DISCONNECT ACTIVE' : 'FAILSAFE: OK (Connected)';
    }

    const physSteer = $<HTMLElement>('#diagPhysicalSteer');
    if (physSteer) {
      physSteer.textContent = diag.directionLabel;
      physSteer.className = diag.directionLabel === 'LEFT' ? 'left' : diag.directionLabel === 'RIGHT' ? 'right' : '';
    }
    const barSteer = $<HTMLElement>('#diagBarSteer');
    if (barSteer) {
      const pct = Math.max(0, Math.min(100, (diag.semanticSteering + 1) * 50));
      barSteer.style.width = `${pct}%`;
      barSteer.style.background = diag.semanticSteering > 0.05 ? '#64b5f6' : diag.semanticSteering < -0.05 ? '#ffb74d' : '#f0b84e';
    }
    const semSteer = $<HTMLElement>('#diagSemanticSteer');
    if (semSteer) {
      semSteer.textContent = `${diag.semanticSteering >= 0 ? '+' : ''}${diag.semanticSteering.toFixed(2)} (${diag.directionLabel})`;
    }
    const expNose = $<HTMLElement>('#diagExpectedNose');
    if (expNose) {
      expNose.textContent = diag.semanticSteering > 0.05 ? 'NOSE TURNS LEFT' : diag.semanticSteering < -0.05 ? 'NOSE TURNS RIGHT' : 'STRAIGHT';
      expNose.className = diag.semanticSteering > 0.05 ? 'left' : diag.semanticSteering < -0.05 ? 'right' : '';
    }
    const deltaYawEl = $<HTMLElement>('#diagDeltaYaw');
    if (deltaYawEl) {
      const dYaw = motionState.yaw - lastReportedYaw;
      deltaYawEl.textContent = `${motionState.angular.toFixed(2)} rad/s (Δ ${dYaw.toFixed(3)})`;
    }

    const thrLabel = $<HTMLElement>('#diagThrottleLabel');
    if (thrLabel) {
      thrLabel.textContent = diag.throttleLabel;
      thrLabel.className = diag.throttleLabel === 'FORWARD' ? 'forward' : diag.throttleLabel === 'REVERSE' ? 'reverse' : '';
    }
    const thrVal = $<HTMLElement>('#diagThrottleValue');
    if (thrVal) {
      thrVal.textContent = `${diag.semanticThrottle >= 0 ? '+' : ''}${diag.semanticThrottle.toFixed(2)}`;
    }
    const leftTrk = $<HTMLElement>('#diagLeftTrack');
    if (leftTrk) {
      leftTrk.textContent = diag.leftTrackCommand.toFixed(2);
    }
    const rightTrk = $<HTMLElement>('#diagRightTrack');
    if (rightTrk) {
      rightTrk.textContent = diag.rightTrackCommand.toFixed(2);
    }

    const rawList = $<HTMLElement>('#diagRawAxesList');
    if (rawList) {
      if (diag.rawAxes.length > 0) {
        rawList.innerHTML = diag.rawAxes.map((ax, idx) => `<span class="diag-axis-pill">Ch ${idx}: ${ax >= 0 ? '+' : ''}${ax.toFixed(2)}</span>`).join('');
      } else {
        rawList.innerHTML = `<span class="diag-axis-pill">Source: ${diag.source.toUpperCase()} (Keyboard / Touch / Disconnected)</span>`;
      }
    }
  }
  lastReportedYaw = motionState.yaw;

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
    fireFlames[f].rotation.z = Math.sin(now * 0.009 + f * 1.7) * 0.12;
  }
  fireLight.intensity = 13.5 + Math.sin(now * 0.021) * 2.2 + Math.sin(now * 0.047) * 0.8;
  for (let i = 0; i < fireSmoke.length; i++) {
    const phase = (now * 0.00032 + i * 0.15) % 1;
    const smoke = fireSmoke[i];
    smoke.position.y = 0.52 + phase * 1.35;
    smoke.position.x = -3.45 + i * 0.22 + Math.sin(now * 0.0012 + i) * phase * 0.28;
    smoke.scale.set(0.42 + phase * 0.52, 0.56 + phase * 0.74, 1);
    (smoke.material as THREE.SpriteMaterial).opacity = 0.42 * (1 - phase);
  }
  for (let i = 0; i < bridgeWaterRipples.length; i++) {
    const ripple = bridgeWaterRipples[i];
    const phase = (now * 0.00022 + i * 0.19) % 1;
    const size = 0.48 + phase * 1.35;
    ripple.scale.set(size, size, size);
    (ripple.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - phase);
  }
  for (let i = 0; i < hazardWaterRipples.length; i++) {
    const ripple = hazardWaterRipples[i];
    const phase = (now * 0.0003 + i * 0.21) % 1;
    const size = 0.65 + phase * 0.9;
    ripple.scale.set(size, size, size);
    (ripple.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - phase);
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
camera.fov = config.cameraFov;
camera.updateProjectionMatrix();
$<HTMLInputElement>('#cameraFov').value = String(config.cameraFov);
$<HTMLInputElement>('#cameraSens').value = String(config.cameraSensitivity);
$<HTMLSelectElement>('#quality').value = config.quality;
setGraphicsQuality(config.quality);
animate();
