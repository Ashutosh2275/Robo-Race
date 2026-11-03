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
  getContactPatches,
  vehicleBarrierPenetration,
  getTurntableOmega,
  applyTurntableSurfaceInteraction,
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
  ROUTE_DECK_HEIGHT,
  ROUTE_HEIGHT_OFFSET,
  HILL_ENTRY_LINK,
  HILL_EXIT_LINK,
  PARALLEL_PLANK_CENTERS,
  TURNTABLE_CENTER,
  TURNTABLE_RADIUS,
  CHECKPOINTS,
  SLALOM_BLOCKS,
  SPEED_BREAKER_XS,
  HILL_NODES,
  HILL_DECK_WIDTH,
  evaluateCourseHeight,
  evaluateRockHeight,
  evaluateCourseSurface,
  createDeterministicRNG,
  generateRockFieldStones,
  ROCK_FIELD_STONES,
  validateRouteClearance,
  validateDriveRoute,
  validateSlalomClearance,
  crossesCheckpointGate,
  type CourseCollider,
  type CoursePoint,
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
(window as any).__threeScene = scene;
(window as any).__course = course;

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

function generateFlameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Multi-pass organic combustion plasma flame texture (Blender / VFX Grade)
  const imgData = ctx.createImageData(128, 256);
  const data = imgData.data;

  for (let py = 0; py < 256; py++) {
    const v = 1.0 - py / 255; // 0 at bottom, 1 at top
    for (let px = 0; px < 128; px++) {
      const u = (px - 64) / 64; // -1 to 1 lateral
      const distFromCenter = Math.abs(u);

      // Parabolic flame envelope: wider at base, tapering towards flickering tip
      const envelope = Math.max(0, 1.0 - Math.pow(distFromCenter, 1.8) * (1.2 + 2.4 * v));
      if (envelope <= 0 || v > 0.98) {
        continue;
      }

      // 3-octave harmonic turbulence simulating natural convection lick
      const turb1 = Math.sin(px * 0.12 + py * 0.08) * 0.25;
      const turb2 = Math.cos(px * 0.24 - py * 0.16) * 0.15;
      const turb3 = Math.sin(px * 0.48 + py * 0.32) * 0.10;
      const flameTurb = Math.max(0, envelope + turb1 + turb2 + turb3);

      // Multi-stage combustion color temperature gradient
      let r = 0, g = 0, b = 0, a = 0;
      if (v < 0.22) {
        // Combustion base: bright golden core with deep orange perimeter
        r = 255;
        g = Math.floor(160 + 85 * (1 - distFromCenter));
        b = Math.floor(40 + 180 * Math.max(0, 1 - distFromCenter * 2));
        a = Math.floor(245 * flameTurb);
      } else if (v < 0.55) {
        // High-temperature luminous body
        const t = (v - 0.22) / 0.33;
        r = 255;
        g = Math.floor(180 * (1 - t * 0.55) * (1 - distFromCenter * 0.35));
        b = Math.floor(25 * (1 - t));
        a = Math.floor(230 * flameTurb * (1 - t * 0.2));
      } else if (v < 0.85) {
        // Licking orange-red flame tips
        const t = (v - 0.55) / 0.30;
        r = Math.floor(255 - t * 65);
        g = Math.floor(80 * (1 - t));
        b = 10;
        a = Math.floor(180 * flameTurb * (1 - t * 0.5));
      } else {
        // Dissipating incandescent smoke mantle
        const t = (v - 0.85) / 0.15;
        r = Math.floor(180 * (1 - t));
        g = Math.floor(30 * (1 - t));
        b = 10;
        a = Math.floor(80 * flameTurb * (1 - t));
      }

      const idx = (py * 128 + px) * 4;
      data[idx] = Math.min(255, Math.max(0, r));
      data[idx + 1] = Math.min(255, Math.max(0, g));
      data[idx + 2] = Math.min(255, Math.max(0, b));
      data[idx + 3] = Math.min(255, Math.max(0, a));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function generateOilSlickTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a0d10';
  ctx.fillRect(0, 0, 256, 256);
  // Iridescent petroleum thin-film interference bands (optical dispersion on wet asphalt)
  const bands = [
    { r: 35, col: 'rgba(30, 110, 210, 0.55)' },
    { r: 60, col: 'rgba(170, 40, 190, 0.48)' },
    { r: 85, col: 'rgba(235, 185, 30, 0.50)' },
    { r: 110, col: 'rgba(25, 210, 160, 0.42)' },
    { r: 135, col: 'rgba(225, 75, 55, 0.38)' },
    { r: 165, col: 'rgba(45, 160, 235, 0.35)' },
    { r: 195, col: 'rgba(190, 60, 170, 0.30)' },
  ];
  for (const b of bands) {
    ctx.strokeStyle = b.col;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.ellipse(128 + (b.r % 15 - 7), 128 + (b.r % 11 - 5), b.r, b.r * 0.75, b.r * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

const flameTexture = generateFlameTexture();
const oilSlickTexture = generateOilSlickTexture();

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: '#272a2c', roughness: 0.94, map: generateSurfaceTexture('#272a2c', ['#383b3d', '#1f2122', '#414446'], 'grain') }),
  asphalt: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0.05, map: generateSurfaceTexture('#3b4143', ['#4a5052', '#303638', '#53595b'], 'asphalt') }),
  laneStripeWhite: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.55 }),
  laneStripeYellow: new THREE.MeshStandardMaterial({ color: '#e8af28', roughness: 0.60 }),
  curbRed: new THREE.MeshStandardMaterial({ color: '#c72b22', roughness: 0.62 }),
  curbWhite: new THREE.MeshStandardMaterial({ color: '#f0f0eb', roughness: 0.65 }),
  barrier: new THREE.MeshStandardMaterial({ color: '#e5e2d8', roughness: 0.72 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#e5ad2a', roughness: 0.65 }),
  slalomMortar: new THREE.MeshStandardMaterial({ color: '#4b4841', roughness: 0.96 }),
  slalomBrick: new THREE.MeshStandardMaterial({ color: '#b79b64', roughness: 0.91, map: generateSurfaceTexture('#b79b64', ['#cbb37c', '#9e8555'], 'stone') }),
  slalomBrickLight: new THREE.MeshStandardMaterial({ color: '#c2a66b', roughness: 0.93, map: generateSurfaceTexture('#c2a66b', ['#d0b57c', '#a9905f'], 'stone') }),
  orange: new THREE.MeshStandardMaterial({ color: '#e4551f', roughness: 0.72 }),
  coverYellow: new THREE.MeshStandardMaterial({ color: '#cb9f2a', roughness: 0.78, metalness: 0.12 }),
  black: new THREE.MeshStandardMaterial({ color: '#141618', roughness: 0.75, metalness: 0.15 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#161917', roughness: 0.95, map: generateSurfaceTexture('#161917', ['#242926', '#101211'], 'chevron') }),
  metal: new THREE.MeshStandardMaterial({ color: '#5a646a', roughness: 0.35, metalness: 0.82 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.12, metalness: 0.98 }),
  wheel: new THREE.MeshStandardMaterial({ color: '#c8c5ba', roughness: 0.50, metalness: 0.45 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a5e42', roughness: 0.85, map: generateSurfaceTexture('#7a5e42', ['#8c6e4e', '#614831'], 'wood') }),
  red: new THREE.MeshStandardMaterial({ color: '#c82e25', roughness: 0.58 }),
  green: new THREE.MeshStandardMaterial({ color: '#7ca86f', roughness: 0.88 }),
  sand: new THREE.MeshStandardMaterial({ color: '#baa06f', roughness: 0.98, map: generateSurfaceTexture('#baa06f', ['#cca874', '#9e8053'], 'grain') }),
  gravel: new THREE.MeshStandardMaterial({ color: '#7d7d76', roughness: 0.98, map: generateSurfaceTexture('#7d7d76', ['#a5a498', '#63635b'], 'stone') }),
  turf: new THREE.MeshStandardMaterial({ color: '#4a6844', roughness: 0.95 }),
  ice: new THREE.MeshStandardMaterial({ color: '#566668', roughness: 0.14, metalness: 0.50, map: generateSurfaceTexture('#566668', ['#a8b8ba', '#3a4445'], 'slick') }),
  bridge: new THREE.MeshStandardMaterial({ color: '#687176', roughness: 0.45, metalness: 0.55 }),
  diamondPlate: new THREE.MeshStandardMaterial({ color: '#495057', roughness: 0.35, metalness: 0.85, map: generateSurfaceTexture('#495057', ['#5c636a', '#343a40'], 'chevron') }),
  concreteCurb: new THREE.MeshStandardMaterial({ color: '#ced4da', roughness: 0.88 }),
  fiaRed: new THREE.MeshStandardMaterial({ color: '#d90429', roughness: 0.65 }),
  fiaWhite: new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.65 }),
  trussRed: new THREE.MeshStandardMaterial({ color: '#c92a2a', roughness: 0.35, metalness: 0.75 }),
  trussWhite: new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.40, metalness: 0.60 }),
  concretePier: new THREE.MeshStandardMaterial({ color: '#52585c', roughness: 0.92, map: generateSurfaceTexture('#52585c', ['#60666a', '#44494c'], 'stone') }),
  oil: new THREE.MeshStandardMaterial({ color: '#0d1318', roughness: 0.08, metalness: 0.88, map: oilSlickTexture }),
  water: new THREE.MeshPhysicalMaterial({
    color: '#095568',
    emissive: '#021820',
    roughness: 0.005,
    metalness: 0.02,
    transmission: 0.92,
    ior: 1.333,
    transparent: true,
    opacity: 0.88,
    reflectivity: 0.99,
    clearcoat: 1.0,
    clearcoatRoughness: 0.01,
  }),
  waterFoam: new THREE.MeshStandardMaterial({
    color: '#e0f7fa',
    roughness: 0.35,
    transparent: true,
    opacity: 0.60,
    side: THREE.DoubleSide,
  }),
  flameTongue: new THREE.MeshBasicMaterial({
    map: flameTexture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  granite: new THREE.MeshStandardMaterial({
    color: '#6e706e',
    roughness: 0.86,
    metalness: 0.08,
    map: generateSurfaceTexture('#6e706e', ['#878987', '#545654', '#3e403e'], 'stone'),
  }),
  basalt: new THREE.MeshStandardMaterial({
    color: '#2e3033',
    roughness: 0.90,
    metalness: 0.15,
    map: generateSurfaceTexture('#2e3033', ['#3d4044', '#1f2022'], 'stone'),
  }),
  riverStone: new THREE.MeshStandardMaterial({
    color: '#82796b',
    roughness: 0.72,
    metalness: 0.05,
    map: generateSurfaceTexture('#82796b', ['#968c7e', '#6e6558'], 'grain'),
  }),
  limestone: new THREE.MeshStandardMaterial({
    color: '#b0a998',
    roughness: 0.82,
    metalness: 0.04,
    map: generateSurfaceTexture('#b0a998', ['#c4bdae', '#948e80'], 'stone'),
  }),
  sandstone: new THREE.MeshStandardMaterial({
    color: '#a38f71',
    roughness: 0.92,
    map: generateSurfaceTexture('#a38f71', ['#b8a486', '#8a775c'], 'grain'),
  }),
  gravelBed: new THREE.MeshStandardMaterial({
    color: '#636563',
    roughness: 0.95,
    map: generateSurfaceTexture('#636563', ['#7b7d7b', '#4d4f4d'], 'stone'),
  }),
  magmaBed: new THREE.MeshStandardMaterial({
    color: '#1a0500',
    emissive: '#ff4400',
    emissiveIntensity: 2.8,
    roughness: 0.85,
  }),
  fire: new THREE.MeshStandardMaterial({ color: '#e84917', emissive: '#ff540a', emissiveIntensity: 2.2, roughness: 0.35 }),
  fireCore: new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#fff2a8',
    emissiveIntensity: 3.6,
    roughness: 0.20,
    transparent: true,
    opacity: 0.95,
  }),
  fireMantle: new THREE.MeshStandardMaterial({
    color: '#ff6200',
    emissive: '#ff4d00',
    emissiveIntensity: 2.5,
    roughness: 0.28,
    transparent: true,
    opacity: 0.88,
  }),
  fireRuby: new THREE.MeshStandardMaterial({
    color: '#d41400',
    emissive: '#990a00',
    emissiveIntensity: 1.9,
    roughness: 0.38,
    transparent: true,
    opacity: 0.78,
  }),
  charcoal: new THREE.MeshStandardMaterial({
    color: '#1a1614',
    emissive: '#ff2d00',
    emissiveIntensity: 2.2,
    roughness: 0.92,
  }),
  ember: new THREE.MeshBasicMaterial({
    color: '#ff922b',
    transparent: true,
    opacity: 0.95,
  }),
  splashDrop: new THREE.MeshBasicMaterial({
    color: '#aee9f2',
    transparent: true,
    opacity: 0.85,
  }),
  laserCyan: new THREE.MeshBasicMaterial({ color: '#20e3b2', transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
  laserGold: new THREE.MeshBasicMaterial({ color: '#f0bd53', transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  beaconAmber: new THREE.MeshBasicMaterial({ color: '#ff922b' }),
  beaconRed: new THREE.MeshBasicMaterial({ color: '#fa5252' }),
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

function slopedDeckSegment(
  id: string,
  p0: CoursePoint,
  p1: CoursePoint,
  width: number,
  y0: number,
  y1: number,
  thickness: number,
  material: THREE.Material,
) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dz / len, nz = -dx / len;
  const half = width / 2;

  const vertices = [
    p0.x - half * nx, y0, p0.z - half * nz,
    p0.x + half * nx, y0, p0.z + half * nz,
    p1.x + half * nx, y1, p1.z + half * nz,
    p1.x - half * nx, y1, p1.z - half * nz,
    p0.x - half * nx, y0 - thickness, p0.z - half * nz,
    p0.x + half * nx, y0 - thickness, p0.z + half * nz,
    p1.x + half * nx, y1 - thickness, p1.z + half * nz,
    p1.x - half * nx, y1 - thickness, p1.z - half * nz,
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

function slopedDeckZ(id: string, x: number, width: number, z0: number, z1: number, y0: number, y1: number, thickness: number, material: THREE.Material) {
  const half = width / 2;
  const vertices = [
    x - half, y0, z0, x + half, y0, z0, x + half, y1, z1, x - half, y1, z1,
    x - half, y0 - thickness, z0, x + half, y0 - thickness, z0,
    x + half, y1 - thickness, z1, x - half, y1 - thickness, z1,
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

function tubeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radialSegments = 12) {
  const delta = b.clone().sub(a);
  const len = delta.length();
  if (len < 1e-4) return null;
  const geom = new THREE.CylinderGeometry(radius, radius, len, radialSegments);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  course.add(mesh);
  return mesh;
}

/** Alternating solid masonry hurdle: short interlocking brick wall, not a cone or fence. */
function buildSlalomBlock(data: typeof SLALOM_BLOCKS[number]) {
  const { x, z, length, span, height } = data;
  const group = new THREE.Group();
  group.name = data.id;
  group.position.set(x, ROUTE_DECK_HEIGHT, z);
  course.add(group);
  const base = box(group, mats.black, V(0, 0.075, 0), V(length + 0.16, 0.15, span + 0.08));
  base.castShadow = true;
  base.receiveShadow = true;
  // A continuous hidden core keeps the jointed brick faces collision-safe.
  const core = box(group, mats.slalomMortar, V(0, height / 2, 0), V(length, height, span));
  core.castShadow = true;
  core.receiveShadow = true;
  cameraOccluders.push(core);

  const rows = 4;
  const brickHeight = height / rows;
  for (let row = 0; row < rows; row++) {
    const pieces = Math.max(3, Math.ceil(span / 0.58));
    const pieceSpan = span / pieces;
    for (let piece = 0; piece < pieces; piece++) {
      const stagger = row % 2 ? pieceSpan * 0.5 : 0;
      const zLocal = -span / 2 + pieceSpan * (piece + 0.5) + stagger;
      // Keep the staggered half-brick pattern inside the wall footprint.
      if (Math.abs(zLocal) > span / 2 - pieceSpan * 0.48) continue;
      const brick = box(group, (row + piece) % 3 === 0 ? mats.slalomBrickLight : mats.slalomBrick,
        V((piece % 2 ? 1 : -1) * (length * 0.035), (row + 0.5) * brickHeight, zLocal),
        V(length * 0.93, brickHeight * 0.9, pieceSpan * 0.93));
      brick.castShadow = true;
      brick.receiveShadow = true;
      cameraOccluders.push(brick);
    }
  }
  // Dark end returns and small anchor feet make this read as a built hurdle.
  for (const edge of [-1, 1]) {
    box(group, mats.black, V(0, height / 2, edge * (span / 2 - 0.035)), V(length + 0.07, height + 0.06, 0.07));
    box(group, mats.black, V(0, 0.13, edge * (span / 2 - 0.13)), V(length + 0.24, 0.26, 0.22));
  }
  // Collision core matches the visible wall footprint and sits on the deck.
  colliders.push({
    id: data.id,
    x,
    z,
    hx: length / 2,
    hz: span / 2,
    y: ROUTE_DECK_HEIGHT + height / 2,
    height,
    rot: 0,
    walkable: false,
  });
}

// Main Arena Floors & Dedicated Path-Based Racing Circuit
box(course, mats.floor, V(0, ARENA_FLOOR_HEIGHT - 0.225, 0), V(50, 0.45, 36), 0, false);

// Build one continuous solid 3D viaduct road. Obstacles are layered onto this
// measured corridor below; there are no detached rectangular road pads or gaping voids.
function createRouteRibbon(
  offset: number,
  width: number,
  material: THREE.Material,
  yLift: number,
  route: { x: number; z: number }[] = DRIVE_ROUTE,
  withSkirts = false,
  skirtDepth = 0.22,
) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.32));
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
    const dot = miter.x * nx + miter.z * nz;
    const miterScale = clamp(1 / Math.max(0.65, Math.abs(dot)), 1.0, 1.35);

    // Centerline elevation governs the cross-section height uniformly
    // Suppress highway road markings inside off-road rock quarry, hazard zones, motorized turntable, and marble pit
    const inTurntable = Math.hypot(p.x - TURNTABLE_CENTER.x, p.z - TURNTABLE_CENTER.z) <= TURNTABLE_RADIUS + 0.15;
    const inRockField = p.x >= 1.40 && p.x <= 4.60 && Math.abs(p.z) <= 1.35;
    const inHazardZone = p.x >= -10.6 && p.x <= -1.7 && Math.abs(p.z - (-4.0)) <= 1.8;
    const inMarblePit = p.x >= 11.8 && p.x <= 15.1 && p.z >= 2.8 && p.z <= 6.3;
    const suppressMarkings = inRockField || inHazardZone || inTurntable || inMarblePit;
    const centerY = inRockField
      ? ROUTE_DECK_HEIGHT
      : inTurntable
        ? ROUTE_DECK_HEIGHT - 0.08
        : inMarblePit
          ? ROUTE_DECK_HEIGHT - 0.04
          : evaluateCourseHeight(p.x, p.z);

    if (withSkirts) {
      // 4 vertices per cross-section: 0: Top Left, 1: Top Right, 2: Bottom Right, 3: Bottom Left
      const xL = p.x + miter.x * (offset - half * miterScale);
      const zL = p.z + miter.z * (offset - half * miterScale);
      const xR = p.x + miter.x * (offset + half * miterScale);
      const zR = p.z + miter.z * (offset + half * miterScale);
      const topY = centerY + yLift;
      const botY = centerY - skirtDepth;

      positions.push(xL, topY, zL); // 0
      positions.push(xR, topY, zR); // 1
      positions.push(xR, botY, zR); // 2
      positions.push(xL, botY, zL); // 3

      if (i < points.length - 1) {
        const base = i * 4;
        const nextIdx = (i + 1) * 4;
        // Top driving deck
        indices.push(base, nextIdx, base + 1, base + 1, nextIdx, nextIdx + 1);
        // Right vertical side wall
        indices.push(base + 1, nextIdx + 1, base + 2, base + 2, nextIdx + 1, nextIdx + 2);
        // Bottom solid slab
        indices.push(base + 2, nextIdx + 2, base + 3, base + 3, nextIdx + 2, nextIdx + 3);
        // Left vertical side wall
        indices.push(base + 3, nextIdx + 3, base, base, nextIdx + 3, nextIdx);
      }
    } else {
      // Surface ribbon overlay (lane striping and markings)
      // Suppress painted highway markings inside natural quarry bed and hazard basins
      const effectiveHalf = suppressMarkings ? 0 : half;
      for (const side of [-1, 1]) {
        const lateral = (offset + side * effectiveHalf) * miterScale;
        const x = p.x + miter.x * lateral;
        const z = p.z + miter.z * lateral;
        positions.push(x, centerY + yLift, z);
      }
      if (i < points.length - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
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
  return mesh;
}

// 1. Segmented Watertight Viaduct Corridors
// By segmenting the visual circuit into continuous linear corridors and terminating
// each leg before the 180° hairpin turn plazas, we eliminate inverted miter normals,
// self-intersecting polygon fans, and folded origami pleats completely.
// Corridor 1: Start gate along Lane 1 through Slalom, Breakers, Curved Ramp, Bridge, Marble Pit, Turntable, and Rock Field to the crest of the 45-degree descent ramp
const corridor1: CoursePoint[] = [
  ...DRIVE_ROUTE.slice(0, 15),
  { x: 0.52, z: -1.09 },
];
// Corridor 2b: From the top of the water basket exit climb ramp through oil hazard to Hairpin 1
const corridor2b: CoursePoint[] = [
  { x: -7.0, z: -4.0 },
  { x: -10.0, z: -4.0 },
  { x: -13.2, z: -4.0 },
];
const corridor3: CoursePoint[] = [
  { x: -13.2, z: -8.0 },
  { x: -7.5, z: -8.0 },
  { x: -0.2, z: -8.0 },
];
const corridor4: CoursePoint[] = [
  { x: -0.2, z: -12.0 },
  { x: -13.2, z: -12.0 },
  { x: -15.5, z: -12.0 },
];

for (const corr of [corridor1, corridor2b, corridor3, corridor4]) {
  createRouteRibbon(0, DRIVE_ROUTE_WIDTH, mats.asphalt, 0.006, corr, true, 0.22);
  createRouteRibbon(-(DRIVE_ROUTE_WIDTH / 2 - 0.12), 0.065, mats.laneStripeWhite, 0.016, corr, false);
  createRouteRibbon(DRIVE_ROUTE_WIDTH / 2 - 0.12, 0.065, mats.laneStripeWhite, 0.016, corr, false);
  createRouteRibbon(0, 0.08, mats.yellow, 0.016, corr, false);
}

// Monolithic West Wing Continuous Viaduct Deck Slab (seals all gaps between Lanes 2 and 3 completely)
// Covers Lanes 2 and 3 (z in [-14.0, -5.8]), leaving Lane 1 open to the ground-level fire and water basket
box(course, mats.concretePier, V(-8.5, ROUTE_DECK_HEIGHT - 0.12, -9.9), V(18.0, 0.22, 8.0));
box(course, mats.asphalt, V(-8.5, ROUTE_DECK_HEIGHT - 0.005, -9.9), V(17.8, 0.01, 7.8));

// Structural Heavy Pier Bents carrying the elevated circuit above the arena floor
const pierBentPositions: CoursePoint[] = [
  { x: -16.0, z: 8.0 },
  { x: -11.0, z: 8.0 },
  { x: -5.5, z: 8.0 },
  { x: 1.5, z: 8.0 },
  { x: 13.5, z: 2.2 },   // Checkpoint 6 turn shelf support
  { x: 7.0, z: 0.0 },    // approaching mixed terrain
  { x: -11.5, z: -4.0 }, // after oil
  { x: -15.5, z: -6.0 }, // Hairpin 1 plaza outer pier
  { x: -13.2, z: -6.0 }, // Hairpin 1 plaza center pier
  { x: -10.0, z: -8.0 }, // parallel planks approach
  { x: -4.0, z: -8.0 },  // parallel planks exit
  { x: 1.8, z: -10.0 },  // Hairpin 2 plaza outer pier
  { x: -0.2, z: -10.0 }, // Hairpin 2 plaza center pier
  { x: -6.0, z: -12.0 }, // finish straight
  { x: -11.0, z: -12.0 },
  { x: -15.0, z: -12.0 }, // finish line gantry
];
for (const pb of pierBentPositions) {
  const deckY = evaluateCourseHeight(pb.x, pb.z);
  if (deckY < ROUTE_DECK_HEIGHT - 0.1) continue;
  const legHeight = (deckY - 0.22) - ARENA_FLOOR_HEIGHT;
  if (legHeight < 0.25) continue;
  // Transverse cap beam seated right under the viaduct slab
  box(course, mats.concretePier, V(pb.x, deckY - 0.15, pb.z), V(0.44, 0.26, DRIVE_ROUTE_WIDTH - 0.4));
  for (const side of [-1, 1]) {
    const colZ = pb.z + side * (DRIVE_ROUTE_WIDTH / 2 - 0.85);
    cyl(course, mats.concretePier, V(pb.x, ARENA_FLOOR_HEIGHT + legHeight / 2, colZ), 0.22, legHeight, 'y', 20);
    box(course, mats.concretePier, V(pb.x, ARENA_FLOOR_HEIGHT + 0.18, colZ), V(0.72, 0.36, 0.72));
  }
}

// Perimeter Barriers
for (const [id, x, z, w, d] of [
  ['wall_north', 0, -17.82, 46, 0.32],
  ['wall_south', 0, 17.82, 46, 0.32],
  ['wall_west', -24.02, 0, 0.32, 36],
  ['wall_east', 24.02, 0, 0.32, 36],
] as [string, number, number, number, number][]) {
  solidBox(id, x, z, w, d, 0.78, mats.barrier, 0, ARENA_FLOOR_HEIGHT + 0.39);
}

// Yellow hazard stripes along perimeter
for (let x = -22; x <= 22; x += 2) {
  box(course, mats.yellow, V(x, 0.4, -13.6), V(1.55, 0.16, 0.055));
  box(course, mats.yellow, V(x, 0.4, 13.6), V(1.55, 0.16, 0.055));
}

// A continuous approach ramp lifts the driving deck from arena grade to its
// one-metre supported elevation before the start gate.
slopedDeck('start_climb_ramp', -20.6, -19.2, 8.0, DRIVE_ROUTE_WIDTH,
  ARENA_FLOOR_HEIGHT, ROUTE_DECK_HEIGHT, 0.16, mats.wood);
colliders.push({ id: 'start_climb_ramp', x: -19.9, z: 8.0, hx: 0.7, hz: DRIVE_ROUTE_WIDTH / 2, y: (ARENA_FLOOR_HEIGHT + ROUTE_DECK_HEIGHT) / 2, height: ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT, rot: 0, walkable: true });

// Brick walls reach in from alternating edges, making a real left-right weave
// while leaving the opposite half of the lane open at every hurdle.
for (const obstacle of SLALOM_BLOCKS) {
  buildSlalomBlock(obstacle);
}

// Obstacle 3: Competition Speed Breakers (3 smooth rounded rubber humps across corridor)
for (let i = 0; i < SPEED_BREAKER_XS.length; i++) {
  const x = SPEED_BREAKER_XS[i];
  // Rubber hump spans the full widened course deck so it cannot be bypassed
  // around an exposed road edge.
  const bumpGeo = new THREE.CylinderGeometry(0.42, 0.42, DRIVE_ROUTE_WIDTH, 24, 1, false, 0, Math.PI);
  const bump = new THREE.Mesh(bumpGeo, i % 2 === 0 ? mats.yellow : mats.black);
  bump.rotation.z = Math.PI / 2;
  bump.rotation.y = Math.PI / 2;
  bump.scale.set(0.21, 1, 1); // height ≈ 0.09m
  bump.position.set(x, ROUTE_DECK_HEIGHT + 0.025, 8.0);
  bump.castShadow = true;
  bump.receiveShadow = true;
  course.add(bump);
  colliders.push({ id: `speed_breaker_${i}`, x, z: 8.0, hx: 0.45, hz: DRIVE_ROUTE_WIDTH / 2, y: ROUTE_DECK_HEIGHT + 0.05, height: 0.09, rot: 0, walkable: true });
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
colliders.push({ id: 'curved_ramp', x: 4.8, z: 8.0, hx: 1.5, hz: DRIVE_ROUTE_WIDTH / 2, y: ROUTE_DECK_HEIGHT + 0.455, height: 0.85, rot: 0, walkable: true });
// Heavy continuous engineered safety parapets following the curved ramp elevation profile
for (const side of [-1, 1]) {
  const zWall = 8.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.12);
  const wallSegments = 16;
  const segW = 3.0 / wallSegments;
  for (let p = 0; p < wallSegments; p++) {
    const px = 3.3 + (p + 0.5) * segW;
    const deckY = evaluateCourseHeight(px, 8.0);
    solidBox(`ramp_barrier_${side}_${p}`, px, zWall, segW + 0.04, 0.16, 0.36, mats.concretePier, 0, deckY + 0.18);
    box(course, mats.yellow, V(px, deckY + 0.37, zWall), V(segW + 0.04, 0.03, 0.18), 0, false);
    // Cat-eye reflector markers along the inside of the parapet
    if (p % 3 === 0) {
      box(course, side === 1 ? mats.red : mats.laneStripeWhite, V(px, deckY + 0.22, zWall - side * 0.09), V(0.06, 0.06, 0.02), 0, false);
    }
  }
}

// Heavy structural pier bents supporting the curved ramp crown above arena floor
for (const x of [4.2, 5.4]) {
  const deckBottom = evaluateCourseHeight(x, 8.0) - 0.09;
  const legHeight = Math.max(0.12, deckBottom - ARENA_FLOOR_HEIGHT);
  box(course, mats.concretePier, V(x, ARENA_FLOOR_HEIGHT + legHeight / 2, 8.0), V(0.42, legHeight, DRIVE_ROUTE_WIDTH - 0.5));
  for (const side of [-1, 1]) {
    box(course, mats.concretePier, V(x, ARENA_FLOOR_HEIGHT + 0.18, 8.0 + side * 1.05), V(0.68, 0.36, 0.68));
  }
}

// ---------------------------------------------------------------------------
// CHECKPOINT 5: Grand Warren Steel Arch Bridge & Water Crossing (Ultra-Real 3D + 4D)
// ---------------------------------------------------------------------------
const bridgeDeckCrown = ROUTE_DECK_HEIGHT + 0.59;

// 1. Approaches & Heavy Concrete Abutments
// Seamless approach deck from curved ramp (x=6.3) to bridge west abutment (x=6.85)
box(course, mats.concretePier, V(6.65, ROUTE_DECK_HEIGHT - 0.10, 8.0), V(0.80, 0.22, DRIVE_ROUTE_WIDTH));
box(course, mats.asphalt, V(6.65, ROUTE_DECK_HEIGHT + 0.005, 8.0), V(0.80, 0.01, DRIVE_ROUTE_WIDTH - 0.24));

// West Abutment (x = 7.0, z = 8.0)
box(course, mats.concretePier, V(6.85, ARENA_FLOOR_HEIGHT + 0.55, 8.0), V(0.8, 1.1, DRIVE_ROUTE_WIDTH + 0.35));
// Yellow/Black Impact Attenuator Drums
for (const side of [-1, 1]) {
  const az = 8.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.28);
  cyl(course, mats.yellow, V(6.25, ROUTE_DECK_HEIGHT + 0.28, az), 0.22, 0.56, 'y');
  cyl(course, mats.black, V(6.25, ROUTE_DECK_HEIGHT + 0.58, az), 0.23, 0.06, 'y');
}

// East Abutment (x = 12.2, z = 8.0) - seamlessly anchors into Checkpoint 6 turn shelf
box(course, mats.concretePier, V(12.35, ARENA_FLOOR_HEIGHT + 0.55, 8.0), V(0.8, 1.1, DRIVE_ROUTE_WIDTH + 0.35));
// Only outer (north) guardrail end receives an impact attenuator; south side is the open turn path into Gate 06
const azEastNorth = 8.0 + (DRIVE_ROUTE_WIDTH / 2 - 0.28);
cyl(course, mats.yellow, V(12.95, ROUTE_DECK_HEIGHT + 0.28, azEastNorth), 0.22, 0.56, 'y');
cyl(course, mats.black, V(12.95, ROUTE_DECK_HEIGHT + 0.58, azEastNorth), 0.23, 0.06, 'y');

// 2. Physical Walkable Colliders matching terrain heights exactly
colliders.push({ id: 'bridge_approach', x: 7.8, z: 8.0, hx: 0.8, hz: DRIVE_ROUTE_WIDTH / 2, y: ROUTE_DECK_HEIGHT + 0.31, height: 0.62, rot: 0, walkable: true });
colliders.push({ id: 'bridge_deck', x: 9.6, z: 8.0, hx: 1.0, hz: DRIVE_ROUTE_WIDTH / 2, y: ROUTE_DECK_HEIGHT + 0.47, height: 0.24, rot: 0, walkable: true });
colliders.push({ id: 'bridge_descent', x: 11.4, z: 8.0, hx: 0.8, hz: DRIVE_ROUTE_WIDTH / 2, y: ROUTE_DECK_HEIGHT + 0.31, height: 0.62, rot: 0, walkable: true });

// 3. Central Span Diamond-Plate Steel Deck Overlay
box(course, mats.diamondPlate, V(9.6, bridgeDeckCrown + 0.015, 8.0), V(2.0, 0.03, DRIVE_ROUTE_WIDTH - 0.16), 0, false);

// 4. Heavy Structural Crash Guard Rails
for (const side of [-1, 1]) {
  const zRail = 8.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.16);
  // Lower continuous rub beam
  solidBox(`bridge_rail_low_${side}`, 9.6, zRail, 5.2, 0.14, 0.30, mats.black, 0, bridgeDeckCrown + 0.25);
  // Upper handrail
  box(course, mats.metal, V(9.6, bridgeDeckCrown + 0.52, zRail), V(5.2, 0.08, 0.08));
  // Reflective cat-eye markers
  for (let rx = 7.4; rx <= 11.8; rx += 0.8) {
    box(course, side === 1 ? mats.red : mats.laneStripeWhite, V(rx, bridgeDeckCrown + 0.38, zRail + side * 0.08), V(0.08, 0.08, 0.03), 0, false);
  }
}

// 5. Sunken River Basin & Ultra-Realistic 3D Fluid Water with Gerstner Waves
box(course, mats.concretePier, V(9.6, ARENA_FLOOR_HEIGHT + 0.18, 8.0), V(5.8, 0.22, 5.6), 0, false);
box(course, mats.black, V(9.6, ARENA_FLOOR_HEIGHT + 0.26, 8.0), V(5.5, 0.06, 5.3), 0, false);

// Subdivided dynamic fluid wave plane
const bridgeWaterGeom = new THREE.PlaneGeometry(5.4, 5.2, 48, 48);
const bridgeWaterBasePositions = new Float32Array(bridgeWaterGeom.attributes.position.array);
const bridgeWaterMesh = new THREE.Mesh(bridgeWaterGeom, mats.water);
bridgeWaterMesh.rotation.x = -Math.PI / 2;
bridgeWaterMesh.position.set(9.6, ARENA_FLOOR_HEIGHT + 0.33, 8.0);
bridgeWaterMesh.receiveShadow = true;
course.add(bridgeWaterMesh);

// Shoreline foam perimeter strips
box(course, mats.waterFoam, V(9.6, ARENA_FLOOR_HEIGHT + 0.34, 5.45), V(5.4, 0.02, 0.12), 0, false);
box(course, mats.waterFoam, V(9.6, ARENA_FLOOR_HEIGHT + 0.34, 10.55), V(5.4, 0.02, 0.12), 0, false);

const bridgeWaterRipples: THREE.Mesh[] = [];
for (let i = 0; i < 6; i++) {
  const ripple = new THREE.Mesh(
    new THREE.TorusGeometry(0.35 + (i % 3) * 0.18, 0.016, 8, 32),
    new THREE.MeshBasicMaterial({ color: '#8dd9e8', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(7.8 + (i % 3) * 1.8, ARENA_FLOOR_HEIGHT + 0.34 + (i % 2) * 0.002, 6.5 + Math.floor(i / 3) * 2.8);
  course.add(ripple);
  bridgeWaterRipples.push(ripple);
}

// 6. Massive Concrete Piers in River Basin with Cutwaters
for (const px of [8.4, 10.8]) {
  for (const side of [-1, 1]) {
    const pz = 8.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.35);
    // Concrete pier footing
    box(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + 0.40, pz), V(0.75, 0.80, 0.75));
    // Steel support column
    cyl(course, mats.metal, V(px, ARENA_FLOOR_HEIGHT + 0.80 + 0.25, pz), 0.18, 0.50, 'y', 20);
  }
}

// 7. Parabolic Red & White Warren Steel Arch Superstructure
const bridgeStrobes: THREE.Mesh[] = [];
for (const side of [-1, 1]) {
  const zArch = 8.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.14);
  // Bottom chord beam along full bridge span
  box(course, mats.metal, V(9.6, bridgeDeckCrown + 0.08, zArch), V(5.2, 0.14, 0.14));
  // Central top chord beam
  box(course, mats.metal, V(9.6, bridgeDeckCrown + 2.15, zArch), V(2.6, 0.14, 0.14));
  // Slanted portal end posts
  tubeBetween(V(7.0, ROUTE_DECK_HEIGHT + 0.10, zArch), V(8.3, bridgeDeckCrown + 2.15, zArch), 0.08, mats.metal);
  tubeBetween(V(12.2, ROUTE_DECK_HEIGHT + 0.10, zArch), V(10.9, bridgeDeckCrown + 2.15, zArch), 0.08, mats.metal);

  // Vertical posts and diagonal Warren truss members
  const postXs = [7.65, 8.3, 8.95, 9.6, 10.25, 10.9, 11.55];
  for (let p = 0; p < postXs.length; p++) {
    const px = postXs[p];
    const botY = evaluateCourseHeight(px, 8.0) + 0.08;
    const topY = px >= 8.3 && px <= 10.9
      ? bridgeDeckCrown + 2.15
      : (px < 8.3
          ? ROUTE_DECK_HEIGHT + (bridgeDeckCrown + 2.15 - ROUTE_DECK_HEIGHT) * ((px - 7.0) / 1.3)
          : ROUTE_DECK_HEIGHT + (bridgeDeckCrown + 2.15 - ROUTE_DECK_HEIGHT) * ((12.2 - px) / 1.3));
    tubeBetween(V(px, botY, zArch), V(px, topY, zArch), 0.06, mats.trussRed);
    if (p < postXs.length - 1) {
      const nextX = postXs[p + 1];
      const nextBotY = evaluateCourseHeight(nextX, 8.0) + 0.08;
      const nextTopY = nextX >= 8.3 && nextX <= 10.9
        ? bridgeDeckCrown + 2.15
        : (nextX < 8.3
            ? ROUTE_DECK_HEIGHT + (bridgeDeckCrown + 2.15 - ROUTE_DECK_HEIGHT) * ((nextX - 7.0) / 1.3)
            : ROUTE_DECK_HEIGHT + (bridgeDeckCrown + 2.15 - ROUTE_DECK_HEIGHT) * ((12.2 - nextX) / 1.3));
      if (p % 2 === 0) {
        tubeBetween(V(px, botY, zArch), V(nextX, nextTopY, zArch), 0.045, mats.trussWhite);
      } else {
        tubeBetween(V(px, topY, zArch), V(nextX, nextBotY, zArch), 0.045, mats.trussWhite);
      }
    }
  }
}

// 8. Overhead Portal Sway Frames & 4D Flashing Clearance Strobe Beacons
for (const ox of [8.3, 9.6, 10.9]) {
  const zL = 8.0 - (DRIVE_ROUTE_WIDTH / 2 - 0.14);
  const zR = 8.0 + (DRIVE_ROUTE_WIDTH / 2 - 0.14);
  box(course, mats.metal, V(ox, bridgeDeckCrown + 2.15, 8.0), V(0.14, 0.14, DRIVE_ROUTE_WIDTH - 0.28));

  // Flashing Navigation Beacons atop portal frames
  for (const bz of [zL, zR]) {
    const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12), mats.beaconRed);
    strobe.position.set(ox, bridgeDeckCrown + 2.24, bz);
    course.add(strobe);
    bridgeStrobes.push(strobe);
  }
}

// ---------------------------------------------------------------------------
// CHECKPOINT 7: Motorized Industrial Turntable at x = 10.65, z = 0.1 (Ultra-Real 3D + 4D)
// ---------------------------------------------------------------------------
// 1. Monolithic Stationary Steel Pit Basin & Mounting Collar (Recessed into Apron)
// Heavy reinforced concrete pit foundation pad supporting the widened 4.90m turntable
box(course, mats.concretePier, V(TURNTABLE_CENTER.x, ROUTE_DECK_HEIGHT - 0.10, TURNTABLE_CENTER.z), V(5.6, 0.20, 5.6));
// Outer machined steel coaming flange ring (outer rim diameter 5.24m, R = 2.62m)
cyl(course, mats.metal, V(TURNTABLE_CENTER.x, ROUTE_DECK_HEIGHT + 0.018, TURNTABLE_CENTER.z), 2.62, 0.055, 'y', 64);
// Inner roller-bearing raceway ring
cyl(course, mats.black, V(TURNTABLE_CENTER.x, ROUTE_DECK_HEIGHT + 0.012, TURNTABLE_CENTER.z), 2.52, 0.048, 'y', 64);
// Beveled hazard transition rim
cyl(course, mats.yellow, V(TURNTABLE_CENTER.x, ROUTE_DECK_HEIGHT + 0.022, TURNTABLE_CENTER.z), 2.68, 0.018, 'y', 64);

// 32 Precision Chrome Roller Bearings seated inside the perimeter raceway trough
const racewayBallGeo = new THREE.SphereGeometry(0.045, 12, 12);
for (let b = 0; b < 32; b++) {
  const theta = (b * Math.PI * 2) / 32;
  const bx = TURNTABLE_CENTER.x + 2.52 * Math.cos(theta);
  const bz = TURNTABLE_CENTER.z + 2.52 * Math.sin(theta);
  const ballMesh = new THREE.Mesh(racewayBallGeo, mats.chrome);
  ballMesh.position.set(bx, ROUTE_DECK_HEIGHT + 0.032, bz);
  ballMesh.castShadow = true;
  course.add(ballMesh);
}

// Perimeter 32 alternating yellow and black hazard marking segments on pit rim
for (let h = 0; h < 32; h++) {
  const theta = (h * Math.PI * 2) / 32;
  const hx = TURNTABLE_CENTER.x + 2.65 * Math.cos(theta);
  const hz = TURNTABLE_CENTER.z + 2.65 * Math.sin(theta);
  box(course, h % 2 === 0 ? mats.yellow : mats.black, V(hx, ROUTE_DECK_HEIGHT + 0.035, hz), V(0.18, 0.012, 0.48), theta, false);
}

// Heavy electric motor drive pod mounted on stationary coaming (east rim)
box(course, mats.charcoal, V(TURNTABLE_CENTER.x + 2.74, ROUTE_DECK_HEIGHT + 0.22, TURNTABLE_CENTER.z), V(0.55, 0.44, 0.45));
cyl(course, mats.metal, V(TURNTABLE_CENTER.x + 2.50, ROUTE_DECK_HEIGHT + 0.12, TURNTABLE_CENTER.z), 0.16, 0.18, 'y', 16);
box(course, mats.yellow, V(TURNTABLE_CENTER.x + 2.74, ROUTE_DECK_HEIGHT + 0.46, TURNTABLE_CENTER.z), V(0.40, 0.04, 0.35), 0, false);

// 2. Rotating Turntable Platter (inside discGroup)
const discGroup = new THREE.Group();
discGroup.position.set(TURNTABLE_CENTER.x, ROUTE_DECK_HEIGHT + 0.025, TURNTABLE_CENTER.z);
course.add(discGroup);

// Main heavy industrial diamond-plate steel platter (diameter 4.90m, R = 2.45m, flush with track surface)
cyl(discGroup, mats.diamondPlate, V(0, 0.020, 0), TURNTABLE_RADIUS - 0.01, 0.048, 'y', 64);
// Machined steel perimeter drive gear rim with teeth
cyl(discGroup, mats.metal, V(0, 0.010, 0), TURNTABLE_RADIUS + 0.02, 0.040, 'y', 64);

// 64 Machined gear teeth around perimeter rim
const toothGeo = new THREE.BoxGeometry(0.04, 0.035, 0.06);
for (let gt = 0; gt < 64; gt++) {
  const gAngle = (gt * Math.PI * 2) / 64;
  const toothMesh = new THREE.Mesh(toothGeo, mats.metal);
  toothMesh.position.set((TURNTABLE_RADIUS + 0.02) * Math.cos(gAngle), 0.018, (TURNTABLE_RADIUS + 0.02) * Math.sin(gAngle));
  toothMesh.rotation.y = -gAngle;
  discGroup.add(toothMesh);
}

// 16 Bold Alternating Industrial Hazard Wedges (High-visibility warning spinner spanning R=0.65m to 2.36m)
for (let a = 0; a < 16; a++) {
  const t = a * Math.PI / 8;
  const wedgeDist = 1.48;
  box(discGroup, a % 2 ? mats.black : mats.yellow, V(Math.sin(t) * wedgeDist, 0.046, Math.cos(t) * wedgeDist), V(0.38, 0.008, 1.74), t, false);
}

// 8 Radial structural steel stiffener ribs radiating from hub to outer rim
for (let r = 0; r < 8; r++) {
  const rt = r * Math.PI / 4;
  box(discGroup, mats.metal, V(Math.sin(rt) * 1.45, 0.048, Math.cos(rt) * 1.45), V(0.05, 0.014, 1.80), rt, false);
}

// 8 Directional amber warning chevrons / arrows on deck showing spin direction
for (let ar = 0; ar < 8; ar++) {
  const at = ar * Math.PI / 4 + Math.PI / 8;
  const ax = 1.95 * Math.sin(at);
  const az = 1.95 * Math.cos(at);
  const arrowMesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 3), mats.beaconAmber);
  arrowMesh.position.set(ax, 0.052, az);
  arrowMesh.rotation.x = Math.PI / 2;
  arrowMesh.rotation.z = -at + Math.PI / 2;
  discGroup.add(arrowMesh);
}

// 3. Heavy Industrial Center Bearing Spindle Hub
cyl(discGroup, mats.metal, V(0, 0.055, 0), 0.55, 0.042, 'y', 36);
cyl(discGroup, mats.chrome, V(0, 0.082, 0), 0.38, 0.035, 'y', 32);
cyl(discGroup, mats.wheel, V(0, 0.105, 0), 0.24, 0.030, 'y', 24);
// 16 Chrome hex bolts in bolt circle (R = 0.44m)
for (let b = 0; b < 16; b++) {
  const bt = b * Math.PI / 8;
  cyl(discGroup, mats.metal, V(Math.sin(bt) * 0.44, 0.085, Math.cos(bt) * 0.44), 0.026, 0.03, 'y', 8);
}
// Central rotary slip-ring beacon housing
cyl(discGroup, mats.metal, V(0, 0.135, 0), 0.12, 0.05, 'y', 16);
const discCenterBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 16), mats.beaconAmber);
discCenterBeacon.position.set(0, 0.19, 0);
discGroup.add(discCenterBeacon);

// 8 Embedded rotating amber navigation markers at platter perimeter (R = 2.32m)
for (let m = 0; m < 8; m++) {
  const mt = m * Math.PI / 4;
  cyl(discGroup, mats.beaconAmber, V(Math.sin(mt) * 2.32, 0.048, Math.cos(mt) * 2.32), 0.055, 0.022, 'y', 12);
}

// 4. Heavy Structural Pier Bent Anchored to Arena Floor
const discLegHeight = ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT;
// Massive central reinforced concrete support column
cyl(course, mats.concretePier, V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + discLegHeight / 2, TURNTABLE_CENTER.z), 0.75, discLegHeight, 'y', 32);
// Octagonal footing base pad on arena floor
box(course, mats.concretePier, V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + 0.25, TURNTABLE_CENTER.z), V(2.2, 0.5, 2.2));
// 4 Diagonal structural steel outrigger cantilever struts supporting outer pit rim
for (let o = 0; o < 4; o++) {
  const oAngle = o * Math.PI / 2 + Math.PI / 4;
  const oRimX = TURNTABLE_CENTER.x + 2.30 * Math.cos(oAngle);
  const oRimZ = TURNTABLE_CENTER.z + 2.30 * Math.sin(oAngle);
  tubeBetween(V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + 0.40, TURNTABLE_CENTER.z), V(oRimX, ROUTE_DECK_HEIGHT - 0.08, oRimZ), 0.10, mats.metal);
}

// ---------------------------------------------------------------------------
// CHECKPOINT 6: Marble Chicane, Stepping Platforms & Turn Shelf (Ultra-Real 3D + 4D)
// ---------------------------------------------------------------------------
// 0. Monolithic Engineered Concrete Turn Plaza Deck (seals CP5 Bridge Descent to CP6 and CP7 Turntable)
const apronX0 = 7.6, apronX1 = 17.5;
const apronZ0 = -3.2, apronZ1 = 11.0;
const apronW = apronX1 - apronX0;
const apronD = apronZ1 - apronZ0;
const apronCenterX = (apronX0 + apronX1) / 2;
const apronCenterZ = (apronZ0 + apronZ1) / 2;
box(course, mats.concretePier, V(apronCenterX, ROUTE_DECK_HEIGHT - 0.11, apronCenterZ), V(apronW, 0.22, apronD));
// Fascia skirting along the open side edges
box(course, mats.black, V(apronX0 - 0.05, ROUTE_DECK_HEIGHT - 0.11, apronCenterZ), V(0.10, 0.24, apronD));

// Heavy Continuous Concrete Retaining Barrier Walls around outer apron perimeter
// Sweeps along the true outer curve perimeter leaving the entire 6.0m roadway unblocked
const apronWallArc = [
  { x: 13.0, z: 10.8 },
  { x: 15.6, z: 9.6 },
  { x: 16.8, z: 6.8 },
  { x: 16.8, z: 2.8 },
  { x: 16.0, z: -0.5 },
  { x: 14.5, z: -3.2 },
  { x: 7.6, z: -3.2 },
];
for (let w = 0; w < apronWallArc.length - 1; w++) {
  const wa = apronWallArc[w], wb = apronWallArc[w + 1];
  const wdx = wb.x - wa.x, wdz = wb.z - wa.z;
  const wLen = Math.hypot(wdx, wdz);
  const wAng = Math.atan2(wdz, wdx);
  const wMidX = (wa.x + wb.x) / 2, wMidZ = (wa.z + wb.z) / 2;
  box(course, mats.concretePier, V(wMidX, ROUTE_DECK_HEIGHT + 0.38, wMidZ), V(wLen + 0.08, 0.76, 0.32), wAng);
  box(course, mats.yellow, V(wMidX, ROUTE_DECK_HEIGHT + 0.78, wMidZ), V(wLen + 0.08, 0.04, 0.36), wAng, false);
  box(course, w % 2 === 0 ? mats.red : mats.laneStripeWhite, V(wMidX, ROUTE_DECK_HEIGHT + 0.45, wMidZ), V(0.08, 0.08, 0.35), wAng, false);
  colliders.push({ id: `apron_barrier_${w}`, x: wMidX, z: wMidZ, hx: (wLen + 0.08) / 2, hz: 0.16, y: ROUTE_DECK_HEIGHT + 0.38, height: 0.76, rot: wAng, walkable: false });
}

// 2. High-Tech Industrial Low-Friction Testing Basin (Checkpoint 06 Marble & Bearing Bed)
// Recessed containment bed with heavy structural steel coaming and beveled transition ramps
const pitX0 = 11.95, pitX1 = 14.85;
const pitZ0 = 3.05, pitZ1 = 5.95;
const pitCenterX = (pitX0 + pitX1) / 2; // 13.40
const pitCenterZ = (pitZ0 + pitZ1) / 2; // 4.50
const pitWidthX = pitX1 - pitX0;        // 2.90m
const pitLengthZ = pitZ1 - pitZ0;       // 2.90m

// A. Recessed dark aggregate containment bed foundation
box(course, mats.black, V(pitCenterX, ROUTE_DECK_HEIGHT - 0.02, pitCenterZ), V(pitWidthX + 0.20, 0.04, pitLengthZ + 0.20), 0, false);
box(course, mats.floor, V(pitCenterX, ROUTE_DECK_HEIGHT - 0.01, pitCenterZ), V(pitWidthX, 0.02, pitLengthZ), 0, false);

// B. Longitudinal Heavy Steel Coamings with Hazard Warning Stripes (East and West borders)
// West containment coaming (inner lane edge)
box(course, mats.metal, V(pitX0 - 0.08, ROUTE_DECK_HEIGHT + 0.05, pitCenterZ), V(0.16, 0.12, pitLengthZ + 0.30));
box(course, mats.yellow, V(pitX0 - 0.08, ROUTE_DECK_HEIGHT + 0.115, pitCenterZ), V(0.14, 0.02, pitLengthZ + 0.30), 0, false);
// East containment coaming (outer lane edge)
box(course, mats.metal, V(pitX1 + 0.08, ROUTE_DECK_HEIGHT + 0.05, pitCenterZ), V(0.16, 0.12, pitLengthZ + 0.30));
box(course, mats.yellow, V(pitX1 + 0.08, ROUTE_DECK_HEIGHT + 0.115, pitCenterZ), V(0.14, 0.02, pitLengthZ + 0.30), 0, false);

// Bolted flanged gussets on coaming walls
for (let bz = pitZ0; bz <= pitZ1; bz += 0.95) {
  box(course, mats.metal, V(pitX0 - 0.18, ROUTE_DECK_HEIGHT + 0.05, bz), V(0.08, 0.10, 0.12));
  box(course, mats.metal, V(pitX1 + 0.18, ROUTE_DECK_HEIGHT + 0.05, bz), V(0.08, 0.10, 0.12));
}

// C. Beveled Diamond-Plate Transition Ramps at North Entry and South Exit
// North entry transition ramp (sloping down from deck into recessed basin)
slopedDeckZ('pit_entry_ramp', pitCenterX, pitWidthX, pitZ1 + 0.32, pitZ1, ROUTE_DECK_HEIGHT, ROUTE_DECK_HEIGHT - 0.015, 0.03, mats.diamondPlate);
// North entry debris drainage grate
box(course, mats.black, V(pitCenterX, ROUTE_DECK_HEIGHT - 0.005, pitZ1 + 0.06), V(pitWidthX, 0.015, 0.12), 0, false);

// South exit transition ramp (sloping up from recessed basin back to deck)
slopedDeckZ('pit_exit_ramp', pitCenterX, pitWidthX, pitZ0, pitZ0 - 0.32, ROUTE_DECK_HEIGHT - 0.015, ROUTE_DECK_HEIGHT, 0.03, mats.diamondPlate);
// South exit debris drainage grate
box(course, mats.black, V(pitCenterX, ROUTE_DECK_HEIGHT - 0.005, pitZ0 - 0.06), V(pitWidthX, 0.015, 0.12), 0, false);

// 3. 4D Motorized Revolving Amber Warning Beacons at pit outer corners
const hazardRevolvingBeacons: THREE.Group[] = [];
for (const bz of [pitZ0 - 0.15, pitZ1 + 0.15]) {
  const bx = pitX1 + 0.22;
  cyl(course, mats.metal, V(bx, ROUTE_DECK_HEIGHT + 0.45, bz), 0.045, 0.90, 'y');
  const bGroup = new THREE.Group();
  bGroup.position.set(bx, ROUTE_DECK_HEIGHT + 0.95, bz);
  course.add(bGroup);
  // Amber beacon glass dome
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 12), mats.beaconAmber);
  bGroup.add(dome);
  // Rotating reflector mirror
  const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 0.07), mats.yellow);
  bGroup.add(reflector);
  hazardRevolvingBeacons.push(bGroup);
}

// 4. 4D Animated Directional Chasing Chevron Signs (>>>) along East Outer Wall
const chevronSignArrows: THREE.Mesh[] = [];
const chevronSignGroup = new THREE.Group();
chevronSignGroup.position.set(16.65, ROUTE_DECK_HEIGHT + 0.70, pitCenterZ);
chevronSignGroup.rotation.y = -Math.PI / 2;
course.add(chevronSignGroup);
box(chevronSignGroup, mats.black, V(0, 0, 0), V(2.4, 0.65, 0.10));
for (let a = 0; a < 4; a++) {
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 3), new THREE.MeshBasicMaterial({ color: '#f0bd53' }));
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.set(-0.75 + a * 0.50, 0, 0.06);
  chevronSignGroup.add(arrow);
  chevronSignArrows.push(arrow);
}

// 5. Ultra-Realistic 3D Precision Industrial Rolling Elements & Ball Bearings
// High-grade engineering materials for maximum visual authenticity:
// a) Mirror-finished chrome steel ball bearings with sharp specular reflections
// b) Ceramic Silicon Nitride (Si3N4) black high-speed bearing beads
// c) Polished mineral marbles (amber quartz, royal cobalt, carnelian red)
const bearingSphereGeo = new THREE.SphereGeometry(1, 16, 14);
const chromeBearingMat = new THREE.MeshStandardMaterial({
  color: '#f4f6f8',
  metalness: 0.98,
  roughness: 0.06,
});
const ceramicBearingMat = new THREE.MeshStandardMaterial({
  color: '#1a1d1f',
  metalness: 0.35,
  roughness: 0.18,
});
const amberMarbleMat = new THREE.MeshStandardMaterial({
  color: '#c48232',
  metalness: 0.12,
  roughness: 0.16,
});
const cobaltMarbleMat = new THREE.MeshStandardMaterial({
  color: '#1e3f66',
  metalness: 0.12,
  roughness: 0.16,
});
const carnelianMarbleMat = new THREE.MeshStandardMaterial({
  color: '#8b281d',
  metalness: 0.12,
  roughness: 0.16,
});
const bearingMaterials = [
  chromeBearingMat,
  chromeBearingMat, // higher weighting for mirror steel bearings
  ceramicBearingMat,
  amberMarbleMat,
  cobaltMarbleMat,
  carnelianMarbleMat,
];

const marbleRng = createDeterministicRNG(20261101);
for (let i = 0; i < 96; i++) {
  const px = pitX0 + 0.18 + marbleRng() * (pitWidthX - 0.36);
  const pz = pitZ0 + 0.18 + marbleRng() * (pitLengthZ - 0.36);
  // Realistic bearing diameters: 7cm to 13cm
  const radius = 0.036 + marbleRng() * 0.028;
  const mat = bearingMaterials[i % bearingMaterials.length];
  const sphere = new THREE.Mesh(bearingSphereGeo, mat);
  sphere.position.set(px, ROUTE_DECK_HEIGHT - 0.01 + radius * 0.95, pz);
  sphere.scale.set(radius, radius, radius);
  sphere.rotation.set(marbleRng() * Math.PI, marbleRng() * Math.PI, marbleRng() * Math.PI);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  course.add(sphere);
}

// 5 Distinct Natural Geological Rock Geometries (Granite, Basalt, River Cobble, Limestone, Scree)
function createGraniteBoulderGeo(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const noise = 1.0 + 0.16 * Math.sin(3.2 * x + 2.1 * y) * Math.cos(2.8 * z) + 0.06 * Math.sin(6.4 * x);
    const flattenBottom = y < -0.1 ? 0.72 : 1.0;
    pos.setXYZ(i, x * noise, y * noise * flattenBottom, z * noise);
  }
  geo.computeVertexNormals();
  return geo;
}

function createBasaltCragGeo(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(1.0, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const sharp = 1.0 + 0.20 * Math.sign(Math.sin(2.4 * x)) * Math.cos(2.4 * z);
    pos.setXYZ(i, x * sharp, y * (0.85 + 0.15 * Math.sin(3.5 * y)), z * sharp);
  }
  geo.computeVertexNormals();
  return geo;
}

function createRiverStoneGeo(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * 1.18, y * 0.52 * (1.0 + 0.06 * Math.sin(4.2 * x)), z * 0.88);
  }
  geo.computeVertexNormals();
  return geo;
}

function createLimestoneSlabGeo(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.92, 1.08, 0.44, 9, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const irreg = 1.0 + 0.14 * Math.sin(5.0 * Math.atan2(z, x));
    pos.setXYZ(i, x * irreg, y, z * irreg);
  }
  geo.computeVertexNormals();
  return geo;
}

function createScreeClusterGeo(): THREE.BufferGeometry {
  const geo = new THREE.TetrahedronGeometry(1.0, 1);
  geo.computeVertexNormals();
  return geo;
}

const graniteGeo = createGraniteBoulderGeo();
const basaltGeo = createBasaltCragGeo();
const riverStoneGeo = createRiverStoneGeo();
const limestoneGeo = createLimestoneSlabGeo();
const screeGeo = createScreeClusterGeo();
const rockGeos = [graniteGeo, basaltGeo, riverStoneGeo, limestoneGeo, screeGeo];
const rockMats = [mats.granite, mats.basalt, mats.riverStone, mats.limestone, mats.gravel];

// Natural Boulder Quarry Bed & Substrate Base along z ~ 0 (x in [1.35, 4.65])
// Monolithic dark crushed aggregate bed eliminating harsh seam cuts and covering asphalt completely
box(course, mats.gravelBed, V(3.0, ROUTE_DECK_HEIGHT + 0.025, 0), V(3.3, 0.045, DRIVE_ROUTE_WIDTH - 0.15));

// Smooth bevelled crushed stone lead-in and exit ramps (eliminates harsh box-cut seams)
slopedDeck('rock_bed_entry_ramp', 1.20, 1.40, 0, DRIVE_ROUTE_WIDTH - 0.20, ROUTE_DECK_HEIGHT, ROUTE_DECK_HEIGHT + 0.035, 0.03, mats.gravelBed);
slopedDeck('rock_bed_exit_ramp', 4.60, 4.80, 0, DRIVE_ROUTE_WIDTH - 0.20, ROUTE_DECK_HEIGHT + 0.035, ROUTE_DECK_HEIGHT, 0.03, mats.gravelBed);

// Natural weathered granite retaining rock kerbs along both shoulders
for (const side of [-1, 1]) {
  const zCurb = side * (DRIVE_ROUTE_WIDTH / 2 - 0.18);
  box(course, mats.granite, V(3.0, ROUTE_DECK_HEIGHT + 0.07, zCurb), V(3.4, 0.14, 0.26));
}

// 75 Realistic Sculpted Natural Boulders with Physical Heights in evaluateCourseHeight
for (let i = 0; i < ROCK_FIELD_STONES.length; i++) {
  const rk = ROCK_FIELD_STONES[i];
  const geo = rockGeos[i % rockGeos.length];
  const mat = rockMats[i % rockMats.length];
  const rockMesh = new THREE.Mesh(geo, mat);
  rockMesh.position.set(rk.x, rk.y + ROUTE_DECK_HEIGHT + 0.02, rk.z);
  rockMesh.scale.set(rk.scaleX, rk.scaleY, rk.scaleZ);
  rockMesh.rotation.set(rk.rotX, rk.rotY, rk.rotZ);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  course.add(rockMesh);
}

// 80 Scattered Scree Pebbles & Gravel Clusters embedded between boulders
const screeRng = createDeterministicRNG(4321);
for (let i = 0; i < 80; i++) {
  const sx = 1.55 + screeRng() * 2.9;
  const sz = -1.15 + screeRng() * 2.3;
  const sSize = 0.025 + screeRng() * 0.038;
  const sMesh = new THREE.Mesh(screeGeo, i % 2 === 0 ? mats.granite : mats.basalt);
  sMesh.position.set(sx, ROUTE_DECK_HEIGHT + 0.038 + sSize * 0.4, sz);
  sMesh.scale.set(sSize, sSize * 0.65, sSize);
  sMesh.rotation.set(screeRng() * Math.PI, screeRng() * Math.PI, 0);
  sMesh.castShadow = true;
  course.add(sMesh);
}

// ---------------------------------------------------------------------------
// 45-DEGREE DESCENT RAMP: From elevated rock field exit to ground-level hazards
// ---------------------------------------------------------------------------
// Lifts vehicle from high-elevation viaduct (ROUTE_DECK_HEIGHT = 0.67) down to ground level (ARENA_FLOOR_HEIGHT = -0.33).
// Under real physics, gravity accelerates the robot downhill with steep forward pitch.
const rampP0: CoursePoint = { x: 0.52, z: -1.09 };
const rampP1: CoursePoint = { x: -0.13, z: -1.91 };
slopedDeckSegment('descent_ramp_45_deck', rampP0, rampP1, DRIVE_ROUTE_WIDTH, ROUTE_DECK_HEIGHT, ARENA_FLOOR_HEIGHT, 0.18, mats.asphalt);
colliders.push({
  id: 'descent_ramp_45',
  x: (rampP0.x + rampP1.x) / 2,
  z: (rampP0.z + rampP1.z) / 2,
  hx: 0.65,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: (ROUTE_DECK_HEIGHT + ARENA_FLOOR_HEIGHT) / 2,
  height: ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT,
  rot: Math.atan2(rampP1.z - rampP0.z, rampP1.x - rampP0.x) + Math.PI / 2,
  walkable: true,
});

// Structural concrete pier bents supporting the elevated crest at rampP0
const rampPierH = (ROUTE_DECK_HEIGHT - 0.18) - ARENA_FLOOR_HEIGHT;
for (const side of [-1, 1]) {
  const normX = (-1.09 - (-1.91)) / 1.05;
  const normZ = -(0.52 - (-0.13)) / 1.05;
  const pzX = rampP0.x + side * (DRIVE_ROUTE_WIDTH / 2 - 0.6) * normX;
  const pzZ = rampP0.z + side * (DRIVE_ROUTE_WIDTH / 2 - 0.6) * normZ;
  cyl(course, mats.concretePier, V(pzX, ARENA_FLOOR_HEIGHT + rampPierH / 2, pzZ), 0.22, rampPierH, 'y', 20);
}

// Parapet side barriers along the 45-degree descent slope
for (const side of [-1, 1]) {
  const normX = (-1.09 - (-1.91)) / 1.05;
  const normZ = -(0.52 - (-0.13)) / 1.05;
  const wSide = side * (DRIVE_ROUTE_WIDTH / 2 - 0.12);
  const wp0: CoursePoint = { x: rampP0.x + wSide * normX, z: rampP0.z + wSide * normZ };
  const wp1: CoursePoint = { x: rampP1.x + wSide * normX, z: rampP1.z + wSide * normZ };
  slopedDeckSegment(`descent_ramp_parapet_${side}`, wp0, wp1, 0.24, ROUTE_DECK_HEIGHT + 0.36, ARENA_FLOOR_HEIGHT + 0.36, 0.36, mats.concretePier);
  const cux = (wp1.x - wp0.x) / 1.05, cuz = (wp1.z - wp0.z) / 1.05;
  const wp1Dock: CoursePoint = { x: wp1.x - 0.16 * cux, z: wp1.z - 0.16 * cuz };
  slopedDeckSegment(`descent_ramp_coping_${side}`, wp0, wp1Dock, 0.28, ROUTE_DECK_HEIGHT + 0.38, ARENA_FLOOR_HEIGHT + 0.38, 0.04, mats.yellow);
}

// Ground-level transition runout connecting the foot of the 45-degree ramp to the fire hearth
const runoutP0 = rampP1;
const runoutP1 = { x: -1.8, z: -4.0 };
slopedDeckSegment('descent_ground_runout', runoutP0, runoutP1, DRIVE_ROUTE_WIDTH, ARENA_FLOOR_HEIGHT, ARENA_FLOOR_HEIGHT, 0.12, mats.asphalt);

// Parapet side barriers along the ground runout to fire hearth
const roDx = runoutP1.x - runoutP0.x;
const roDz = runoutP1.z - runoutP0.z;
const roLen = Math.hypot(roDx, roDz);
const roNormX = -roDz / roLen;
const roNormZ = roDx / roLen;
for (const side of [-1, 1]) {
  const normX = (-1.09 - (-1.91)) / 1.05;
  const normZ = -(0.52 - (-0.13)) / 1.05;
  const wSide = side * (DRIVE_ROUTE_WIDTH / 2 - 0.12);
  const roW0: CoursePoint = { x: rampP1.x + wSide * normX, z: rampP1.z + wSide * normZ };
  const roW1: CoursePoint = { x: runoutP1.x + wSide * roNormX, z: runoutP1.z + wSide * roNormZ };
  slopedDeckSegment(`runout_parapet_${side}`, roW0, roW1, 0.24, ARENA_FLOOR_HEIGHT + 0.36, ARENA_FLOOR_HEIGHT + 0.36, 0.36, mats.concretePier);
  const roW0Dock: CoursePoint = { x: roW0.x + 0.16 * (roDx / roLen), z: roW0.z + 0.16 * (roDz / roLen) };
  slopedDeckSegment(`runout_coping_${side}`, roW0Dock, roW1, 0.28, ARENA_FLOOR_HEIGHT + 0.38, ARENA_FLOOR_HEIGHT + 0.38, 0.04, mats.yellow);
  // Heavy reinforced concrete transition anchor pylon terminating the slope
  box(course, mats.concretePier, V(roW0.x, ARENA_FLOOR_HEIGHT + 0.22, roW0.z), V(0.42, 0.44, 0.42));
  box(course, mats.yellow, V(roW0.x, ARENA_FLOOR_HEIGHT + 0.46, roW0.z), V(0.46, 0.06, 0.46), 0, false);
}

// -------------------------------------------------------------
// 3. Mandatory Environmental Hazards: Fire -> Water -> Oil (Blender-Grade 3D & 4D)
// -------------------------------------------------------------
// Hazard 1: Industrial Refractory-Brick Fire Hearth (x in [-3.8, -1.8], z in [-4.8, -3.2]) on Ground Level
box(course, mats.concretePier, V(-2.8, ARENA_FLOOR_HEIGHT - 0.05, -4.0), V(2.4, 0.10, DRIVE_ROUTE_WIDTH));
box(course, mats.black, V(-2.8, ARENA_FLOOR_HEIGHT + 0.015, -4.0), V(2.2, 0.03, DRIVE_ROUTE_WIDTH - 0.30));

// Incandescent Magma Fissure Underbed
box(course, mats.magmaBed, V(-2.8, ARENA_FLOOR_HEIGHT + 0.022, -4.0), V(2.15, 0.018, DRIVE_ROUTE_WIDTH - 0.36), 0, false);

// Heavy refractory brick borders along both shoulders with hazard coping
for (const side of [-1, 1]) {
  const zCurb = -4.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.16);
  box(course, mats.slalomBrick, V(-2.8, ARENA_FLOOR_HEIGHT + 0.12, zCurb), V(2.2, 0.22, 0.32));
  box(course, mats.yellow, V(-2.8, ARENA_FLOOR_HEIGHT + 0.24, zCurb), V(2.2, 0.04, 0.34), 0, false);
}

// 36 Sculpted Basalt Charcoal Rocks with Glowing Lava Fissures
const charRNG = createDeterministicRNG(1984);
for (let c = 0; c < 36; c++) {
  const cx = -3.65 + charRNG() * 1.7;
  const cz = -4.0 + (charRNG() - 0.5) * (DRIVE_ROUTE_WIDTH - 0.85);
  const cr = 0.09 + charRNG() * 0.11;
  const rock = new THREE.Mesh(basaltGeo, mats.charcoal);
  rock.position.set(cx, ARENA_FLOOR_HEIGHT + 0.03 + cr * 0.45, cz);
  rock.scale.set(cr * (1.1 + charRNG() * 0.5), cr * (0.6 + charRNG() * 0.4), cr * (1.1 + charRNG() * 0.5));
  rock.rotation.set(charRNG() * Math.PI, charRNG() * Math.PI, charRNG() * Math.PI);
  rock.castShadow = true;
  course.add(rock);
}

// Ultra-Realistic Additive Curved Flame Tongues (Blender / AAA Video Grade)
// Crossed curving parametric flame ribbons with organic S-curve silhouettes
function createFlameTongueGeometry(height: number, width: number): THREE.BufferGeometry {
  const slices = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const plane of [0, 1]) {
    const vBase = plane * (slices + 1) * 2;
    for (let s = 0; s <= slices; s++) {
      const v = s / slices;
      const y = v * height;
      const profile = Math.sin(Math.PI * Math.pow(v, 0.65));
      const w = width * (0.18 + 0.82 * profile) * (1 - v * 0.92);
      const curveX = Math.sin(v * Math.PI * 1.5) * 0.07;
      const curveZ = Math.cos(v * Math.PI * 1.2) * 0.05;

      if (plane === 0) {
        positions.push(-w * 0.5 + curveX, y, curveZ, w * 0.5 + curveX, y, curveZ);
      } else {
        positions.push(curveX, y, -w * 0.5 + curveZ, curveX, y, w * 0.5 + curveZ);
      }
      uvs.push(0.0, v, 1.0, v);

      if (s < slices) {
        const row = vBase + s * 2;
        indices.push(row, row + 1, row + 2, row + 1, row + 3, row + 2);
        indices.push(row, row + 2, row + 1, row + 1, row + 2, row + 3);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface UltraRealFlame {
  mesh: THREE.Mesh;
  baseX: number;
  baseZ: number;
  baseScaleY: number;
  baseScaleXZ: number;
  phase1: number;
  phase2: number;
  freqLick: number;
  swaySpeed: number;
}
const ultraRealFlames: UltraRealFlame[] = [];
const flameGeom = createFlameTongueGeometry(1.25, 0.42);

for (let f = 0; f < 28; f++) {
  const fx = -3.65 + (f % 7) * 0.26 + (f % 2 ? 0.06 : -0.06);
  const fz = -4.0 + (Math.floor(f / 7) - 1.5) * 1.15 + ((f * 3) % 5 - 2.0) * 0.22;
  const flameMesh = new THREE.Mesh(flameGeom, mats.flameTongue);
  flameMesh.position.set(fx, ARENA_FLOOR_HEIGHT + 0.05, fz);
  const sXZ = 0.75 + (f % 3) * 0.22;
  const sY = 0.85 + ((f * 5) % 4) * 0.20;
  flameMesh.scale.set(sXZ, sY, sXZ);
  course.add(flameMesh);

  ultraRealFlames.push({
    mesh: flameMesh,
    baseX: fx,
    baseZ: fz,
    baseScaleY: sY,
    baseScaleXZ: sXZ,
    phase1: f * 0.73,
    phase2: f * 1.19,
    freqLick: 9.0 + (f % 4) * 2.2,
    swaySpeed: 4.5 + (f % 3) * 1.8,
  });
}

// Ascending 3D Thermal Spark & Ember Particle System (72 individual spark crystals)
interface FireEmber {
  mesh: THREE.Mesh;
  baseX: number;
  baseZ: number;
  y: number;
  vy: number;
  omega: number;
  swirlRadius: number;
  phase: number;
}
const fireEmbers: FireEmber[] = [];
for (let i = 0; i < 72; i++) {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.024, 0), mats.ember);
  const baseX = -3.65 + charRNG() * 1.7;
  const baseZ = -4.0 + (charRNG() - 0.5) * (DRIVE_ROUTE_WIDTH - 1.1);
  const ember: FireEmber = {
    mesh,
    baseX,
    baseZ,
    y: ARENA_FLOOR_HEIGHT + 0.12 + charRNG() * 1.8,
    vy: 1.4 + charRNG() * 1.8,
    omega: 3.5 + charRNG() * 4.5,
    swirlRadius: 0.06 + charRNG() * 0.22,
    phase: charRNG() * Math.PI * 2,
  };
  mesh.position.set(baseX, ember.y, baseZ);
  course.add(mesh);
  fireEmbers.push(ember);
}

// Dual Chaotic Dynamic Firelights (Core Radiant + Turbulent Jitter)
const fireLightCore = new THREE.PointLight('#ff7700', 18, 8.5, 1.4);
fireLightCore.position.set(-2.8, ARENA_FLOOR_HEIGHT + 0.95, -4.0);
scene.add(fireLightCore);

const fireLightFlicker = new THREE.PointLight('#ff2200', 12, 6.5, 1.6);
fireLightFlicker.position.set(-2.8, ARENA_FLOOR_HEIGHT + 1.35, -4.0);
scene.add(fireLightFlicker);

// Dynamic billowing smoke particles
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = smokeCanvas.height = 128;
const smokeContext = smokeCanvas.getContext('2d')!;
const smokeGradient = smokeContext.createRadialGradient(64, 64, 8, 64, 64, 62);
smokeGradient.addColorStop(0, 'rgba(40,42,44,0.58)');
smokeGradient.addColorStop(0.55, 'rgba(65,68,70,0.28)');
smokeGradient.addColorStop(1, 'rgba(80,82,82,0)');
smokeContext.fillStyle = smokeGradient;
smokeContext.fillRect(0, 0, 128, 128);
const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
const smokeMaterial = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0.52, depthWrite: false });
const fireSmoke: THREE.Sprite[] = [];
for (let i = 0; i < 12; i++) {
  const smoke = new THREE.Sprite(smokeMaterial.clone());
  smoke.position.set(-3.6 + i * 0.14, ARENA_FLOOR_HEIGHT + 0.85 + (i % 3) * 0.14, -4.0 + ((i % 4) - 1.5) * 0.65);
  smoke.scale.set(0.65, 1.05, 1);
  course.add(smoke);
  fireSmoke.push(smoke);
}

// ---------------------------------------------------------------------------
// Hazard 2: Heavy Industrial Water Cooling Basket (0.5m Deep, Ground Bed)
// ---------------------------------------------------------------------------
// Heavy concrete foundation seated at arena floor level
box(course, mats.concretePier, V(-4.8, ARENA_FLOOR_HEIGHT - 0.08, -4.0), V(2.2, 0.16, DRIVE_ROUTE_WIDTH));
box(course, mats.metal, V(-4.8, ARENA_FLOOR_HEIGHT + 0.01, -4.0), V(2.05, 0.04, DRIVE_ROUTE_WIDTH - 0.12));

// Deep 0.50m Stainless Steel Basket Enclosure Walls (Left & Right Shoulders)
const basketWallHeight = 0.50;
for (const side of [-1, 1]) {
  const zCoam = -4.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.14);
  // Heavy solid steel containment wall of height 0.5m
  box(course, mats.metal, V(-4.8, ARENA_FLOOR_HEIGHT + basketWallHeight / 2, zCoam), V(2.1, basketWallHeight, 0.28));
  // Industrial yellow hazard warning coping along top rim
  box(course, mats.yellow, V(-4.8, ARENA_FLOOR_HEIGHT + basketWallHeight + 0.02, zCoam), V(2.1, 0.04, 0.32), 0, false);
  // Structural vertical stiffeners (ribs) spaced along the basket walls
  for (const sx of [-0.8, -0.4, 0, 0.4, 0.8]) {
    box(course, mats.metal, V(-4.8 + sx, ARENA_FLOOR_HEIGHT + basketWallHeight / 2, zCoam + side * 0.16), V(0.08, basketWallHeight, 0.08));
    box(course, mats.black, V(-4.8 + sx, ARENA_FLOOR_HEIGHT + basketWallHeight * 0.6, zCoam + side * 0.18), V(0.06, 0.06, 0.06), 0, false);
  }
}

// Submerged Dual Diamond-Plate Traction Runner Tracks (Gauge 1.58m)
// Tracks touch the solid floor bed directly; robot does not float away
box(course, mats.diamondPlate, V(-4.8, ARENA_FLOOR_HEIGHT + 0.02, -4.0 - 0.79), V(2.0, 0.02, 0.45), 0, false);
box(course, mats.diamondPlate, V(-4.8, ARENA_FLOOR_HEIGHT + 0.02, -4.0 + 0.79), V(2.0, 0.02, 0.45), 0, false);
// Transverse drainage rungs along basket floor
for (let gx = -5.6; gx <= -4.0; gx += 0.32) {
  box(course, mats.metal, V(gx, ARENA_FLOOR_HEIGHT + 0.025, -4.0), V(0.04, 0.015, DRIVE_ROUTE_WIDTH - 0.48), 0, false);
}

// Ultra-Realistic STILL Water Surface (Tranquil Mirror Glass Surface)
// Filled to depth ~0.34m inside the 0.50m basket (leaves 0.16m freeboard to rim)
const stillWaterLevel = ARENA_FLOOR_HEIGHT + 0.34;
const hazardWaterGeom = new THREE.PlaneGeometry(2.0, DRIVE_ROUTE_WIDTH - 0.28, 1, 1);
const hazardWaterMesh = new THREE.Mesh(hazardWaterGeom, mats.water);
hazardWaterMesh.rotation.x = -Math.PI / 2;
hazardWaterMesh.position.set(-4.8, stillWaterLevel, -4.0);
hazardWaterMesh.receiveShadow = true;
course.add(hazardWaterMesh);

// Shoreline froth & meniscus strips along all four basket tank walls
for (const side of [-1, 1]) {
  box(course, mats.waterFoam, V(-4.8, stillWaterLevel + 0.005, -4.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.22)), V(2.0, 0.015, 0.10), 0, false);
}
box(course, mats.waterFoam, V(-5.78, stillWaterLevel + 0.005, -4.0), V(0.06, 0.015, DRIVE_ROUTE_WIDTH - 0.36), 0, false);
box(course, mats.waterFoam, V(-3.82, stillWaterLevel + 0.005, -4.0), V(0.06, 0.015, DRIVE_ROUTE_WIDTH - 0.36), 0, false);

// Interactive Vehicle Water Splashes (particle pool for track spray)
interface WaterSplashParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}
const waterSplashPool: WaterSplashParticle[] = [];
const splashDropGeo = new THREE.DodecahedronGeometry(0.022, 0);
for (let i = 0; i < 48; i++) {
  const mesh = new THREE.Mesh(splashDropGeo, mats.splashDrop);
  mesh.visible = false;
  course.add(mesh);
  waterSplashPool.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.45 });
}

const hazardWaterRipples: THREE.Mesh[] = [];
for (let i = 0; i < 6; i++) {
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.26, 28), new THREE.MeshBasicMaterial({ color: '#8dd9e8', transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(-5.6 + i * 0.30, stillWaterLevel + 0.008, -4.0 + (i % 2 ? 0.8 : -0.8));
  course.add(ripple);
  hazardWaterRipples.push(ripple);
}

// ---------------------------------------------------------------------------
// Exit Climb Ramp out of Water Basket: x in [-7.0, -5.8]
// ---------------------------------------------------------------------------
// Climbs from ground-level water bed up to elevated viaduct deck (ROUTE_DECK_HEIGHT)
slopedDeck('water_basket_exit_ramp', -7.0, -5.8, -4.0, DRIVE_ROUTE_WIDTH - 0.24,
  ROUTE_DECK_HEIGHT, ARENA_FLOOR_HEIGHT + 0.02, 0.16, mats.diamondPlate);
colliders.push({ id: 'water_basket_exit_ramp', x: -6.4, z: -4.0, hx: 0.6, hz: DRIVE_ROUTE_WIDTH / 2, y: (ARENA_FLOOR_HEIGHT + 0.02 + ROUTE_DECK_HEIGHT) / 2, height: ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT, rot: 0, walkable: true });
// Parapets along the climb
for (const side of [-1, 1]) {
  const zWall = -4.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.15);
  box(course, mats.metal, V(-6.4, (ARENA_FLOOR_HEIGHT + ROUTE_DECK_HEIGHT) / 2 + 0.28, zWall), V(1.25, 0.35, 0.24));
  box(course, mats.yellow, V(-6.4, (ARENA_FLOOR_HEIGHT + ROUTE_DECK_HEIGHT) / 2 + 0.48, zWall), V(1.25, 0.04, 0.26), 0, false);
}

// Hazard 3: High-Gloss Iridescent Oil Skid Pad (x in [-10.5, -8.0])
box(course, mats.concretePier, V(-9.25, ROUTE_DECK_HEIGHT - 0.08, -4.0), V(2.6, 0.18, DRIVE_ROUTE_WIDTH));
box(course, mats.oil, V(-9.25, ROUTE_DECK_HEIGHT + 0.038, -4.0), V(2.55, 0.02, DRIVE_ROUTE_WIDTH - 0.20), 0, false);
// Containment curbs with yellow/black hazard chevron warnings
for (const side of [-1, 1]) {
  const zCurb = -4.0 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.15);
  box(course, mats.barrier, V(-9.25, ROUTE_DECK_HEIGHT + 0.12, zCurb), V(2.55, 0.22, 0.30));
  box(course, mats.yellow, V(-9.25, ROUTE_DECK_HEIGHT + 0.23, zCurb), V(2.55, 0.04, 0.32), 0, false);
}

// ---------------------------------------------------------------------------
// CONTINUOUS CENTRAL SAFETY DIVIDER WALLS & DIRECTIONAL CHEVRONS (ONE SINGLE PATH)
// ---------------------------------------------------------------------------
// Eliminates mixed paths and channelizes the 3 parallel straightaways:
// Lane 1 (z = -4.0, Westbound) | Lane 2 (z = -8.0, Eastbound) | Lane 3 (z = -12.0, Westbound)

// Central Barrier Wall 1 (separates Lane 1 and Lane 2 at z = -6.0 from x = -12.2 to -0.2)
const divWall1Len = 12.0;
const divWall1MidX = -6.2;
box(course, mats.concretePier, V(divWall1MidX, ROUTE_DECK_HEIGHT + 0.30, -6.0), V(divWall1Len, 0.60, 0.44));
box(course, mats.yellow, V(divWall1MidX, ROUTE_DECK_HEIGHT + 0.62, -6.0), V(divWall1Len, 0.06, 0.48), 0, false);
colliders.push({ id: 'central_divider_wall_1', x: divWall1MidX, z: -6.0, hx: divWall1Len / 2, hz: 0.24, y: ROUTE_DECK_HEIGHT + 0.30, height: 0.60, rot: 0, walkable: false });

// Reflective Cat-Eyes and Luminaires along Wall 1
for (let wx = -11.8; wx <= -0.8; wx += 1.4) {
  // North face (facing Lane 1)
  box(course, mats.laneStripeWhite, V(wx, ROUTE_DECK_HEIGHT + 0.45, -5.76), V(0.08, 0.08, 0.02), 0, false);
  // South face (facing Lane 2)
  box(course, mats.red, V(wx, ROUTE_DECK_HEIGHT + 0.45, -6.24), V(0.08, 0.08, 0.02), 0, false);
}
// Floodlight stanchions on Wall 1
for (const fx of [-10.2, -6.2, -2.2]) {
  cyl(course, mats.metal, V(fx, ROUTE_DECK_HEIGHT + 1.2, -6.0), 0.04, 1.2, 'y');
  box(course, mats.yellow, V(fx, ROUTE_DECK_HEIGHT + 1.8, -6.0), V(0.24, 0.12, 0.36), 0, false);
}

// Central Barrier Wall 2 (separates Lane 2 and Lane 3 at z = -10.0 from x = -13.2 to -1.2)
const divWall2Len = 12.0;
const divWall2MidX = -7.2;
box(course, mats.concretePier, V(divWall2MidX, ROUTE_DECK_HEIGHT + 0.30, -10.0), V(divWall2Len, 0.60, 0.44));
box(course, mats.yellow, V(divWall2MidX, ROUTE_DECK_HEIGHT + 0.62, -10.0), V(divWall2Len, 0.06, 0.48), 0, false);
colliders.push({ id: 'central_divider_wall_2', x: divWall2MidX, z: -10.0, hx: divWall2Len / 2, hz: 0.24, y: ROUTE_DECK_HEIGHT + 0.30, height: 0.60, rot: 0, walkable: false });

for (let wx = -12.8; wx <= -1.8; wx += 1.4) {
  // North face (facing Lane 2)
  box(course, mats.laneStripeWhite, V(wx, ROUTE_DECK_HEIGHT + 0.45, -9.76), V(0.08, 0.08, 0.02), 0, false);
  // South face (facing Lane 3)
  box(course, mats.red, V(wx, ROUTE_DECK_HEIGHT + 0.45, -10.24), V(0.08, 0.08, 0.02), 0, false);
}
for (const fx of [-11.2, -7.2, -3.2]) {
  cyl(course, mats.metal, V(fx, ROUTE_DECK_HEIGHT + 1.2, -10.0), 0.04, 1.2, 'y');
  box(course, mats.yellow, V(fx, ROUTE_DECK_HEIGHT + 1.8, -10.0), V(0.24, 0.12, 0.36), 0, false);
}

// Prominent Directional Road Surface Chevron Markings
function paintDirectionChevron(x: number, z: number, dir: -1 | 1) {
  // Do not paint highway chevrons inside the fire hearth, water basket, or steep slopes
  if (x >= -6.8 && x <= 0.8 && Math.abs(z - (-4.0)) < 2.0) return;
  const deckY = evaluateCourseHeight(x, z);
  for (let arm of [-1, 1]) {
    const angle = dir === -1 ? (arm * 0.5) : (Math.PI - arm * 0.5);
    const m = box(course, mats.laneStripeWhite, V(x + (dir === -1 ? -0.12 : 0.12), deckY + 0.008, z + arm * 0.25), V(0.55, 0.004, 0.12), angle, false);
    m.rotation.y = angle;
  }
}
// Lane 1 Westbound Chevrons (<<<) on elevated viaduct
for (const cx of [-7.8, -9.5, -11.5]) {
  paintDirectionChevron(cx, -4.0, -1);
}
// Lane 2 Eastbound Chevrons (>>>)
for (const cx of [-11.5, -9.0, -5.5, -1.5]) {
  paintDirectionChevron(cx, -8.0, 1);
}
// Lane 3 Westbound Chevrons (<<<)
for (const cx of [-1.5, -5.5, -9.0, -13.0]) {
  paintDirectionChevron(cx, -12.0, -1);
}

// ---------------------------------------------------------------------------
// HAIRPIN 1: West U-Turn Plaza & Retaining Barrier Wall (Between CP09 and CP10)
// ---------------------------------------------------------------------------
// 1. Monolithic Turning Plaza Deck Slab
const hp1X0 = -17.2, hp1X1 = -11.5;
const hp1Z0 = -10.0, hp1Z1 = -2.0;
const hp1W = hp1X1 - hp1X0;
const hp1D = hp1Z1 - hp1Z0;
const hp1MidX = (hp1X0 + hp1X1) / 2;
const hp1MidZ = (hp1Z0 + hp1Z1) / 2;
box(course, mats.concretePier, V(hp1MidX, ROUTE_DECK_HEIGHT - 0.11, hp1MidZ), V(hp1W, 0.22, hp1D));
box(course, mats.black, V(hp1X0 - 0.05, ROUTE_DECK_HEIGHT - 0.11, hp1MidZ), V(0.10, 0.24, hp1D));
box(course, mats.asphalt, V(hp1MidX, ROUTE_DECK_HEIGHT + 0.005, hp1MidZ), V(hp1W - 0.1, 0.01, hp1D - 0.1), 0, false);

// 2. Semicircular Outer Curved Retaining Barrier Wall (Facing West, -X)
const hp1ArcSteps = 16;
for (let s = 0; s < hp1ArcSteps; s++) {
  const theta0 = Math.PI / 2 + (Math.PI * s) / hp1ArcSteps;
  const theta1 = Math.PI / 2 + (Math.PI * (s + 1)) / hp1ArcSteps;
  const midTheta = (theta0 + theta1) / 2;
  const bx = -13.2 + 4.0 * Math.cos(midTheta);
  const bz = -6.0 + 4.0 * Math.sin(midTheta);
  const segLen = 4.0 * (Math.PI / hp1ArcSteps);
  box(course, mats.concretePier, V(bx, ROUTE_DECK_HEIGHT + 0.38, bz), V(0.32, 0.76, segLen + 0.06), midTheta);
  box(course, s % 2 === 0 ? mats.yellow : mats.black, V(bx, ROUTE_DECK_HEIGHT + 0.78, bz), V(0.36, 0.08, segLen + 0.06), midTheta, false);
  box(course, s % 2 === 0 ? mats.red : mats.laneStripeWhite, V(bx - 0.18 * Math.cos(midTheta), ROUTE_DECK_HEIGHT + 0.45, bz - 0.18 * Math.sin(midTheta)), V(0.06, 0.08, 0.08), midTheta, false);
}

// 3. Central Inner Apex Dividing Island
const hp1IslandSteps = 10;
for (let s = 0; s < hp1IslandSteps; s++) {
  const theta0 = Math.PI / 2 + (Math.PI * s) / hp1IslandSteps;
  const theta1 = Math.PI / 2 + (Math.PI * (s + 1)) / hp1IslandSteps;
  const midTheta = (theta0 + theta1) / 2;
  const ix = -13.2 + 1.0 * Math.cos(midTheta);
  const iz = -6.0 + 1.0 * Math.sin(midTheta);
  const segLen = 1.0 * (Math.PI / hp1IslandSteps);
  const kMat = s % 2 === 0 ? mats.fiaRed : mats.fiaWhite;
  box(course, kMat, V(ix, ROUTE_DECK_HEIGHT + 0.06, iz), V(0.24, 0.10, segLen + 0.04), midTheta, false);
}
cyl(course, mats.concretePier, V(-13.2, ROUTE_DECK_HEIGHT + 0.05, -6.0), 0.95, 0.10, 'y', 20);
cyl(course, mats.yellow, V(-13.0, ROUTE_DECK_HEIGHT + 0.32, -5.9), 0.22, 0.60, 'y');
cyl(course, mats.black, V(-13.0, ROUTE_DECK_HEIGHT + 0.64, -5.9), 0.23, 0.06, 'y');
cyl(course, mats.yellow, V(-13.0, ROUTE_DECK_HEIGHT + 0.32, -6.1), 0.22, 0.60, 'y');
cyl(course, mats.black, V(-13.0, ROUTE_DECK_HEIGHT + 0.64, -6.1), 0.23, 0.06, 'y');

// 4. Yellow Racing Guidance Arc around Hairpin 1
const hp1GuideSteps = 16;
for (let s = 0; s < hp1GuideSteps; s++) {
  const theta0 = Math.PI / 2 + (Math.PI * s) / hp1GuideSteps;
  const theta1 = Math.PI / 2 + (Math.PI * (s + 1)) / hp1GuideSteps;
  const midTheta = (theta0 + theta1) / 2;
  const gx = -13.2 + 2.4 * Math.cos(midTheta);
  const gz = -6.0 + 2.4 * Math.sin(midTheta);
  const segLen = 2.4 * (Math.PI / hp1GuideSteps);
  if (s % 2 === 0) {
    box(course, mats.yellow, V(gx, ROUTE_DECK_HEIGHT + 0.016, gz), V(0.08, 0.008, segLen), midTheta, false);
  }
}

// 5. 4D Motorized Revolving Amber Warning Beacon at apex
const hp1BeaconGroup = new THREE.Group();
hp1BeaconGroup.position.set(-13.2, ROUTE_DECK_HEIGHT + 1.15, -6.0);
cyl(course, mats.metal, V(-13.2, ROUTE_DECK_HEIGHT + 0.55, -6.0), 0.05, 1.10, 'y');
const hp1Dome = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12), mats.beaconAmber);
hp1BeaconGroup.add(hp1Dome);
const hp1Reflector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.08), mats.yellow);
hp1BeaconGroup.add(hp1Reflector);
course.add(hp1BeaconGroup);
hazardRevolvingBeacons.push(hp1BeaconGroup);

// 6. 4D Electronic Chasing LED Chevron Signs (pointing south through the U-turn)
for (let c = 0; c < 4; c++) {
  const theta = Math.PI * 0.65 + (Math.PI * 0.70 * c) / 3;
  const cx = -13.2 + 3.82 * Math.cos(theta);
  const cz = -6.0 + 3.82 * Math.sin(theta);
  box(course, mats.black, V(cx, ROUTE_DECK_HEIGHT + 0.55, cz), V(0.08, 0.28, 0.45), theta);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.20, 3), mats.yellow);
  arrow.rotation.z = Math.PI / 2;
  arrow.rotation.y = theta;
  arrow.position.set(cx - 0.06 * Math.cos(theta), ROUTE_DECK_HEIGHT + 0.55, cz - 0.06 * Math.sin(theta));
  course.add(arrow);
  chevronSignArrows.push(arrow);
}

// -------------------------------------------------------------
// 4. Arena Paddock Boundary & Grand Prix Floodlight Towers (Clean Single Path)
// -------------------------------------------------------------
// High-mast stadium floodlight towers along the southern perimeter
for (const fx of [8.0, 11.2, 14.5]) {
  const pz = -15.5;
  cyl(course, mats.metal, V(fx, ARENA_FLOOR_HEIGHT + 3.0, pz), 0.12, 6.0, 'y');
  box(course, mats.concretePier, V(fx, ARENA_FLOOR_HEIGHT + 0.35, pz), V(0.9, 0.7, 0.9));
  // Crossarm & Luminaire Pods
  box(course, mats.yellow, V(fx, ARENA_FLOOR_HEIGHT + 5.9, pz), V(1.4, 0.18, 0.35), 0, false);
  const towerLight = new THREE.DirectionalLight('#fff0d4', 0.85);
  towerLight.position.set(fx, ARENA_FLOOR_HEIGHT + 6.0, pz);
  towerLight.target.position.set(fx, ROUTE_DECK_HEIGHT, -8.0);
  scene.add(towerLight);
  scene.add(towerLight.target);
}

// -------------------------------------------------------------
// 5. Over-Engineered Parallel Plank Bridge (spacing matches 1.58m track width)
// -------------------------------------------------------------
for (const [i, plank] of PARALLEL_PLANK_CENTERS.entries()) {
  // Main elevated plank timber beam
  box(course, mats.wood, V(plank.x, ROUTE_DECK_HEIGHT + 0.21, plank.z), V(4.2, 0.18, 0.65));
  box(course, mats.black, V(plank.x, ROUTE_DECK_HEIGHT + 0.10, plank.z), V(4.25, 0.05, 0.70));
  colliders.push({ id: `parallel_plank_${i === 0 ? 'left' : 'right'}`, x: plank.x, z: plank.z, hx: 2.1, hz: 0.35, y: ROUTE_DECK_HEIGHT + 0.21, height: 0.18, rot: 0, walkable: true });

  // Entry Wedge Ramp (smooth 0.40m ramp up from deck to plank top)
  slopedDeck(`plank_entry_ramp_${i}`, plank.x + 2.1, plank.x + 2.5, plank.z, 0.65, ROUTE_DECK_HEIGHT + 0.27, ROUTE_DECK_HEIGHT, 0.10, mats.wood);
  // Exit Wedge Ramp (smooth 0.40m ramp down from plank top to deck)
  slopedDeck(`plank_exit_ramp_${i}`, plank.x - 2.5, plank.x - 2.1, plank.z, 0.65, ROUTE_DECK_HEIGHT, ROUTE_DECK_HEIGHT + 0.27, 0.10, mats.wood);

  // High-contrast white center guidance stripe along each plank
  box(course, mats.laneStripeWhite, V(plank.x, ROUTE_DECK_HEIGHT + 0.275, plank.z), V(4.1, 0.008, 0.08), 0, false);

  // Sturdy vertical stanchions supporting each plank from the deck
  for (const sx of [-1.5, 0, 1.5]) {
    cyl(course, mats.metal, V(plank.x + sx, ROUTE_DECK_HEIGHT + 0.09, plank.z), 0.05, 0.18, 'y');
    box(course, mats.concretePier, V(plank.x + sx, ROUTE_DECK_HEIGHT + 0.02, plank.z), V(0.20, 0.04, 0.20));
  }
}
// Transverse steel cross-ties connecting both plank structures across the gap
for (const cx of [-1.4, 0, 1.4]) {
  beamBetween(
    V(PARALLEL_PLANK_CENTERS[0].x + cx, ROUTE_DECK_HEIGHT + 0.08, PARALLEL_PLANK_CENTERS[0].z),
    V(PARALLEL_PLANK_CENTERS[1].x + cx, ROUTE_DECK_HEIGHT + 0.08, PARALLEL_PLANK_CENTERS[1].z),
    0.06, mats.metal
  );
}

// ---------------------------------------------------------------------------
// HAIRPIN 2: East U-Turn Plaza & Retaining Barrier Wall (Between CP10 and CP11)
// ---------------------------------------------------------------------------
// 1. Monolithic Turning Plaza Deck Slab
const hp2X0 = -2.2, hp2X1 = 3.8;
const hp2Z0 = -14.0, hp2Z1 = -6.0;
const hp2W = hp2X1 - hp2X0;
const hp2D = hp2Z1 - hp2Z0;
const hp2MidX = (hp2X0 + hp2X1) / 2;
const hp2MidZ = (hp2Z0 + hp2Z1) / 2;
box(course, mats.concretePier, V(hp2MidX, ROUTE_DECK_HEIGHT - 0.11, hp2MidZ), V(hp2W, 0.22, hp2D));
box(course, mats.black, V(hp2X1 + 0.05, ROUTE_DECK_HEIGHT - 0.11, hp2MidZ), V(0.10, 0.24, hp2D));
box(course, mats.asphalt, V(hp2MidX, ROUTE_DECK_HEIGHT + 0.005, hp2MidZ), V(hp2W - 0.1, 0.01, hp2D - 0.1), 0, false);

// 2. Semicircular Outer Curved Retaining Barrier Wall (Facing East, +X)
const hp2ArcSteps = 16;
for (let s = 0; s < hp2ArcSteps; s++) {
  const theta0 = -Math.PI / 2 + (Math.PI * s) / hp2ArcSteps;
  const theta1 = -Math.PI / 2 + (Math.PI * (s + 1)) / hp2ArcSteps;
  const midTheta = (theta0 + theta1) / 2;
  const bx = -0.2 + 4.0 * Math.cos(midTheta);
  const bz = -10.0 + 4.0 * Math.sin(midTheta);
  const segLen = 4.0 * (Math.PI / hp2ArcSteps);
  box(course, mats.concretePier, V(bx, ROUTE_DECK_HEIGHT + 0.38, bz), V(0.32, 0.76, segLen + 0.06), midTheta);
  box(course, s % 2 === 0 ? mats.yellow : mats.black, V(bx, ROUTE_DECK_HEIGHT + 0.78, bz), V(0.36, 0.08, segLen + 0.06), midTheta, false);
  box(course, s % 2 === 0 ? mats.laneStripeWhite : mats.red, V(bx - 0.18 * Math.cos(midTheta), ROUTE_DECK_HEIGHT + 0.45, bz - 0.18 * Math.sin(midTheta)), V(0.06, 0.08, 0.08), midTheta, false);
}

// 3. Central Inner Apex Dividing Island
const hp2IslandSteps = 10;
for (let s = 0; s < hp2IslandSteps; s++) {
  const theta0 = -Math.PI / 2 + (Math.PI * s) / hp2IslandSteps;
  const theta1 = -Math.PI / 2 + (Math.PI * (s + 1)) / hp2IslandSteps;
  const midTheta = (theta0 + theta1) / 2;
  const ix = -0.2 + 1.0 * Math.cos(midTheta);
  const iz = -10.0 + 1.0 * Math.sin(midTheta);
  const segLen = 1.0 * (Math.PI / hp2IslandSteps);
  const kMat = s % 2 === 0 ? mats.fiaRed : mats.fiaWhite;
  box(course, kMat, V(ix, ROUTE_DECK_HEIGHT + 0.06, iz), V(0.24, 0.10, segLen + 0.04), midTheta, false);
}
cyl(course, mats.concretePier, V(-0.2, ROUTE_DECK_HEIGHT + 0.05, -10.0), 0.95, 0.10, 'y', 20);
cyl(course, mats.yellow, V(-0.4, ROUTE_DECK_HEIGHT + 0.32, -9.9), 0.22, 0.60, 'y');
cyl(course, mats.black, V(-0.4, ROUTE_DECK_HEIGHT + 0.64, -9.9), 0.23, 0.06, 'y');
cyl(course, mats.yellow, V(-0.4, ROUTE_DECK_HEIGHT + 0.32, -10.1), 0.22, 0.60, 'y');
cyl(course, mats.black, V(-0.4, ROUTE_DECK_HEIGHT + 0.64, -10.1), 0.23, 0.06, 'y');

// 4. Yellow Racing Guidance Arc around Hairpin 2
const hp2GuideSteps = 16;
for (let s = 0; s < hp2GuideSteps; s++) {
  const theta0 = -Math.PI / 2 + (Math.PI * s) / hp2GuideSteps;
  const theta1 = -Math.PI / 2 + (Math.PI * (s + 1)) / hp2GuideSteps;
  const midTheta = (theta0 + theta1) / 2;
  const gx = -0.2 + 2.4 * Math.cos(midTheta);
  const gz = -10.0 + 2.4 * Math.sin(midTheta);
  const segLen = 2.4 * (Math.PI / hp2GuideSteps);
  if (s % 2 === 0) {
    box(course, mats.yellow, V(gx, ROUTE_DECK_HEIGHT + 0.016, gz), V(0.08, 0.008, segLen), midTheta, false);
  }
}

// 5. 4D Motorized Revolving Amber Warning Beacon at apex
const hp2BeaconGroup = new THREE.Group();
hp2BeaconGroup.position.set(-0.2, ROUTE_DECK_HEIGHT + 1.15, -10.0);
cyl(course, mats.metal, V(-0.2, ROUTE_DECK_HEIGHT + 0.55, -10.0), 0.05, 1.10, 'y');
const hp2Dome = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12), mats.beaconAmber);
hp2BeaconGroup.add(hp2Dome);
const hp2Reflector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.08), mats.yellow);
hp2BeaconGroup.add(hp2Reflector);
course.add(hp2BeaconGroup);
hazardRevolvingBeacons.push(hp2BeaconGroup);

// 6. 4D Electronic Chasing LED Chevron Signs (pointing west toward finish straight)
for (let c = 0; c < 4; c++) {
  const theta = -Math.PI * 0.35 + (Math.PI * 0.70 * c) / 3;
  const cx = -0.2 + 3.82 * Math.cos(theta);
  const cz = -10.0 + 3.82 * Math.sin(theta);
  box(course, mats.black, V(cx, ROUTE_DECK_HEIGHT + 0.55, cz), V(0.08, 0.28, 0.45), theta);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.20, 3), mats.yellow);
  arrow.rotation.z = -Math.PI / 2;
  arrow.rotation.y = theta;
  arrow.position.set(cx - 0.06 * Math.cos(theta), ROUTE_DECK_HEIGHT + 0.55, cz - 0.06 * Math.sin(theta));
  course.add(arrow);
  chevronSignArrows.push(arrow);
}

// -------------------------------------------------------------
// Checkered finish straight and Grand Overhead Finish Gantry
// -------------------------------------------------------------
for (let ix = 0; ix < 10; ix++) {
  for (let iz = 0; iz < 12; iz++) {
    box(course, (ix + iz) % 2 ? mats.black : mats.laneStripeWhite, V(-14.7 + ix * 0.30, ROUTE_DECK_HEIGHT + 0.015, -12 + (iz - 5.5) * 0.30), V(0.30, 0.012, 0.30), 0, false);
  }
}

// -------------------------------------------------------------
// 6. Checkpoint Gates & Recovery Anchors (Ultra-Real 3D Gantries + 4D Laser Scan Lines)
// -------------------------------------------------------------
const checkpointLaserBeams: THREE.Mesh[] = [];
const checkpointBeacons: THREE.Mesh[] = [];

const checkpointMeshes = CHECKPOINTS.map((cp, i) => {
  const g = new THREE.Group();
  const gateY = evaluateCourseHeight(cp.x, cp.z);
  g.position.set(cp.x, gateY, cp.z);
  g.rotation.y = cp.yaw;
  course.add(g);

  // 1. Structural Steel Truss Gantry (Left & Right Columns)
  // Standardized proportional gantry spans tailored to exact corridor widths
  // Gates 01, 02, 03, 04, 05, 08, 09, 11 span the 6.0m roadway: 6.6m span
  // Gate 06 (Marble Pit Turn): 7.4m span to clear the full diagonal turn envelope
  // Gate 07 (Turntable): 7.2m span to clear the enlarged 4.9m rotating deck and corridor
  // Gate 10 (Parallel Planks): 4.4m span
  const gantrySpan = i === 6 ? 7.2 : (i === 9 ? 4.4 : (i === 5 ? 7.4 : 6.6));
  const halfSpan = gantrySpan / 2;
  const towerH = 2.85;
  for (const side of [-1, 1]) {
    const px = side * (halfSpan - 0.15);
    // Support foundation pier extending down to the true ground level
    const worldTowerX = cp.x + px * Math.cos(cp.yaw);
    const worldTowerZ = cp.z - px * Math.sin(cp.yaw);
    const groundY = evaluateCourseHeight(worldTowerX, worldTowerZ);
    const drop = gateY - groundY;
    if (drop > 0.05) {
      box(g, mats.concretePier, V(px, -drop / 2, 0), V(0.48, drop, 0.48));
    }
    // Heavy concrete footing with hazard striping
    box(g, mats.yellow, V(px, 0.14, 0), V(0.42, 0.28, 0.42));
    box(g, mats.black, V(px, 0.14, 0.12), V(0.44, 0.10, 0.20), 0, false);
    // Vertical steel column tower
    box(g, mats.metal, V(px, towerH / 2, 0), V(0.20, towerH, 0.20));
    // Truss horizontal banding
    for (let t = 0.6; t < towerH - 0.2; t += 0.7) {
      box(g, mats.black, V(px, t, 0), V(0.24, 0.05, 0.24), 0, false);
    }
    // Top flashing strobe beacon
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12), mats.beaconAmber);
    beacon.position.set(px, towerH + 0.08, 0);
    g.add(beacon);
    checkpointBeacons.push(beacon);
  }

  // 2. Overhead Horizontal Truss Crossbar
  const crossbar = box(g, mats.metal, V(0, towerH, 0), V(gantrySpan - 0.10, 0.18, 0.24));
  cameraOccluders.push(crossbar);

  // 3. Double-Sided Illuminated Overhead LED Display
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 96;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#111413';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = '#f0bd53';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 504, 88);
  ctx.fillStyle = '#f0bd53';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(cp.label.toUpperCase(), 256, 58);
  const signTex = new THREE.CanvasTexture(cvs);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.8, gantrySpan - 1.2), 0.52), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
  signMesh.position.set(0, towerH, 0);
  g.add(signMesh);

  // 4. Ultra-Realistic Laser Timing Scan Beam across the roadway
  const laserColor = i === 0 ? '#f0bd53' : i === 10 ? '#ffd700' : '#20e3b2';
  const laserBeamGeo = new THREE.CylinderGeometry(0.016, 0.016, gantrySpan - 0.4, 12);
  laserBeamGeo.rotateZ(Math.PI / 2);
  const bar = new THREE.Mesh(
    laserBeamGeo,
    new THREE.MeshBasicMaterial({ color: laserColor })
  );
  bar.position.set(0, 0.04, 0);
  g.add(bar);

  // Soft vertical laser shimmer curtain
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(gantrySpan - 0.4, 0.35),
    new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  shimmer.position.set(0, 0.18, 0);
  g.add(shimmer);
  checkpointLaserBeams.push(bar);

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

const recoveryAnchors = createDefaultRecoveryAnchors(MAP_SCALE).map(anchor => {
  const patches = getContactPatches(anchor.x, anchor.z, anchor.yaw);
  const supportY = (
    evaluateCourseHeight(patches.frontLeft.x / MAP_SCALE, patches.frontLeft.z / MAP_SCALE)
    + evaluateCourseHeight(patches.frontRight.x / MAP_SCALE, patches.frontRight.z / MAP_SCALE)
    + evaluateCourseHeight(patches.rearLeft.x / MAP_SCALE, patches.rearLeft.z / MAP_SCALE)
    + evaluateCourseHeight(patches.rearRight.x / MAP_SCALE, patches.rearRight.z / MAP_SCALE)
  ) / 4;
  return { ...anchor, y: supportY - TRACK_CONTACT_OFFSET };
});
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

// 6. High-Intensity LED Projector Headlights with Chrome Bezels
for (const side of [-1, 1]) {
  const hx = side * 0.42;
  cyl(chassis, mats.metal, V(hx, 0.48, 0.76), 0.055, 0.05, 'z');
  cyl(chassis, new THREE.MeshBasicMaterial({ color: '#ffffff' }), V(hx, 0.48, 0.78), 0.042, 0.02, 'z');
  const headSpot = new THREE.SpotLight(0xfff6dd, 7.5, 9.0, Math.PI / 4.5, 0.4, 1.2);
  headSpot.position.set(hx, 0.48, 0.78);
  headSpot.target.position.set(hx, 0.15, 3.5);
  chassis.add(headSpot);
  chassis.add(headSpot.target);
}

// 7. Heavy Forged Steel Tow Recovery Shackles (Front & Rear)
for (const end of [-1, 1]) {
  const bz = end * 0.77;
  for (const sx of [-0.35, 0.35]) {
    cyl(chassis, mats.metal, V(sx, 0.38, bz), 0.025, 0.06, 'x');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16), mats.yellow);
    ring.position.set(sx, 0.38, bz + end * 0.04);
    ring.rotation.x = Math.PI / 2;
    chassis.add(ring);
  }
}

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
let turntableCurrentOmega = 0.48; // rad/s mechanical turntable rotation speed
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b style="color:#f0bd53;letter-spacing:0.05em;">SIMULATION SETTINGS</b>
        <button id="closeSettingsBtn" class="iconbtn" style="padding:4px 8px;font-size:10px;">✕ CLOSE</button>
      </div>
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
  $('#closeSettingsBtn')?.addEventListener('click', () => $('#settings').classList.add('hidden'));
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

let lastBarrierCollision: string | null = null;
function collidesWithBarrier(x: number, z: number, y: number) {
  lastBarrierCollision = null;
  const robotBottom = y + TRACK_CONTACT_OFFSET;
  const robotTop = y + ROBOT_COLLISION_HEIGHT;
  for (const c of colliders) {
    if (c.walkable) continue;
    if (c.y + c.height / 2 < robotBottom || c.y - c.height / 2 > robotTop) continue;
    const hit = vehicleBarrierPenetration(x, z, pose.yaw, {
      x: c.x * MAP_SCALE,
      z: c.z * MAP_SCALE,
      hx: c.hx * MAP_SCALE,
      hz: c.hz * MAP_SCALE,
      rot: c.rot,
    });
    if (hit) {
      lastBarrierCollision = c.id;
      return hit;
    }
  }
  return null;
}

// Debug hooks for automated verification & visual capture
(window as unknown as Record<string, unknown>).__setCameraPose = (cx: number, cy: number, cz: number, tx: number, ty: number, tz: number) => {
  (window as unknown as Record<string, unknown>).__overrideCamera = { cx, cy, cz, tx, ty, tz };
};
(window as unknown as Record<string, unknown>).__teleportRobot = (x: number, z: number, yaw: number) => {
  motionState.x = x;
  motionState.z = z;
  motionState.yaw = yaw;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.angular = 0;
  pose.x = x;
  pose.z = z;
  pose.yaw = yaw;
  pose.vx = 0;
  pose.vz = 0;
  pose.yawRate = 0;
  pose.pitch = 0;
  pose.roll = 0;
};

function stepPhysics(dt: number) {
  // Continuous smooth mechanical turntable rotation (configurable by race difficulty)
  const targetTurntableOmega = getTurntableOmega(config.difficulty as 'Beginner' | 'Intermediate' | 'Advanced' | 'Pro');
  turntableCurrentOmega += (targetTurntableOmega - turntableCurrentOmega) * (1 - Math.exp(-dt * 3.5));
  discGroup.rotation.y += turntableCurrentOmega * dt;

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
    lastBarrierCollision,
    turntableOmega: turntableCurrentOmega,
    turntableRadius: TURNTABLE_RADIUS,
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

  // Physical Obstacle Reaction Torque ("broad twist" when tracks hit discrete raised boulders)
  // Uneven elevation from rock boulders creates asymmetric retarding drag on the climbing track, producing authentic yaw twist.
  // CRITICAL FIX: Only discrete rock obstacles (evaluateRockHeight) generate broad twist.
  // Smooth planar slopes, bridges, and curved ramps have evaluateRockHeight == 0, preserving 100% steering authority.
  const trackContact = getContactPatches(motionState.x, motionState.z, motionState.yaw);
  const rockFL = evaluateRockHeight(trackContact.frontLeft.x / MAP_SCALE, trackContact.frontLeft.z / MAP_SCALE);
  const rockFR = evaluateRockHeight(trackContact.frontRight.x / MAP_SCALE, trackContact.frontRight.z / MAP_SCALE);
  const rockRL = evaluateRockHeight(trackContact.rearLeft.x / MAP_SCALE, trackContact.rearLeft.z / MAP_SCALE);
  const rockRR = evaluateRockHeight(trackContact.rearRight.x / MAP_SCALE, trackContact.rearRight.z / MAP_SCALE);
  const rockLeftH = (rockFL + rockRL) * 0.5;
  const rockRightH = (rockFR + rockRR) * 0.5;
  const rockDiffH = rockLeftH - rockRightH;
  if (!pose.isFlipped && Math.abs(rockDiffH) > 0.025 && Math.abs(driveResult.longitudinalSpeed) > 0.15) {
    const obstacleTwistRate = -Math.sign(driveResult.longitudinalSpeed) * rockDiffH * 2.8;
    motionState.angular += (obstacleTwistRate - motionState.angular) * (1 - Math.exp(-dt * 6.0));
    motionState.yaw += obstacleTwistRate * dt;
  }

  // Genuine Motorized Mechanical Turntable Surface Interaction
  // (transfers tangential deck velocity, yaw torque, and centrifugal drift to robot tracks)
  if (!pose.isFlipped) {
    const ttResult = applyTurntableSurfaceInteraction(
      motionState.x,
      motionState.z,
      motionState.vx,
      motionState.vz,
      motionState.yaw,
      motionState.angular,
      {
        centerX: TURNTABLE_CENTER.x,
        centerZ: TURNTABLE_CENTER.z,
        radius: TURNTABLE_RADIUS,
        omega: turntableCurrentOmega,
      },
      effectiveGrip,
      dt,
      MAP_SCALE
    );
    if (ttResult.onTurntable) {
      motionState.vx = ttResult.vx;
      motionState.vz = ttResult.vz;
      motionState.yaw = ttResult.yaw;
      motionState.angular = ttResult.yawRate;
      pose.vx = ttResult.vx;
      pose.vz = ttResult.vz;
      pose.yaw = ttResult.yaw;
      pose.yawRate = ttResult.yawRate;
    }
  }

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
    // Resolve the complete overlap along the minimum separating axis each
    // step. The old 3 cm nudge left the vehicle embedded in barriers, causing
    // collision jitter while the differential tracks continued turning.
    const separation = hit.depth + 0.005;
    pose.x += hit.nx * separation;
    pose.z += hit.nz * separation;
    motionState.x = pose.x;
    motionState.z = pose.z;
    if (dot < 0) {
      const impactSpeed = Math.abs(dot);
      pose.vx -= (1 + 0.08) * dot * hit.nx;
      pose.vz -= (1 + 0.08) * dot * hit.nz;
      motionState.vx = pose.vx;
      motionState.vz = pose.vz;

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
  // Keep planar motion state in strict lockstep with 3D pose yaw
  motionState.yaw = pose.yaw;

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
  const contactPatches = getContactPatches(pose.x, pose.z, pose.yaw);
  const supportGroundY = (
    evaluateCourseHeight(contactPatches.frontLeft.x / MAP_SCALE, contactPatches.frontLeft.z / MAP_SCALE)
    + evaluateCourseHeight(contactPatches.frontRight.x / MAP_SCALE, contactPatches.frontRight.z / MAP_SCALE)
    + evaluateCourseHeight(contactPatches.rearLeft.x / MAP_SCALE, contactPatches.rearLeft.z / MAP_SCALE)
    + evaluateCourseHeight(contactPatches.rearRight.x / MAP_SCALE, contactPatches.rearRight.z / MAP_SCALE)
  ) / 4;
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
    lastBarrierCollision,
    turntableOmega: turntableCurrentOmega,
    turntableRadius: TURNTABLE_RADIUS,
    groundContact: {
      terrainY: evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE),
      supportY: supportGroundY,
      trackBottomY: pose.y + TRACK_CONTACT_OFFSET,
      probes: {
        frontLeft: evaluateCourseHeight(contactPatches.frontLeft.x / MAP_SCALE, contactPatches.frontLeft.z / MAP_SCALE),
        frontRight: evaluateCourseHeight(contactPatches.frontRight.x / MAP_SCALE, contactPatches.frontRight.z / MAP_SCALE),
        rearLeft: evaluateCourseHeight(contactPatches.rearLeft.x / MAP_SCALE, contactPatches.rearLeft.z / MAP_SCALE),
        rearRight: evaluateCourseHeight(contactPatches.rearRight.x / MAP_SCALE, contactPatches.rearRight.z / MAP_SCALE),
      },
      sideDropTime: pose.sideDropTime,
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
  if ((window as unknown as { __overrideCamera?: { cx: number; cy: number; cz: number; tx: number; ty: number; tz: number } }).__overrideCamera) {
    const o = (window as unknown as { __overrideCamera: { cx: number; cy: number; cz: number; tx: number; ty: number; tz: number } }).__overrideCamera;
    camera.position.set(o.cx, o.cy, o.cz);
    camera.lookAt(o.tx, o.ty, o.tz);
    return;
  }
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

  const tSec = now * 0.001;

  // 1. Dynamic Gerstner Waves on Checkpoint 05 River Water
  {
    const pos = bridgeWaterGeom.attributes.position;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const vx = bridgeWaterBasePositions[i * 3];
      const vy = bridgeWaterBasePositions[i * 3 + 1];
      const wave = 0.024 * Math.sin(vx * 2.8 + vy * 1.9 - tSec * 2.6) +
                   0.014 * Math.cos(vx * 4.2 - vy * 3.3 + tSec * 3.5) +
                   0.007 * Math.sin(vx * 7.6 + vy * 6.1 - tSec * 5.1);
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
    bridgeWaterGeom.computeVertexNormals();
  }

  // 2. Still Water Hazard Basin (Tranquil, Crystal-Clear Glass Surface without Flowing Current)
  // Water remains still; disturbances radiate organically when vehicle tracks plunge in

  // 3. Ultra-Realistic Additive Curved Flame Tongues (Dynamic Multi-Frequency Licking)
  for (let f = 0; f < ultraRealFlames.length; f++) {
    const fl = ultraRealFlames[f];
    const lick = 1.0 + 0.30 * Math.sin(tSec * fl.freqLick + fl.phase1) + 0.15 * Math.cos(tSec * (fl.freqLick * 1.6) + fl.phase2);
    const flickerXZ = 1.0 + 0.16 * Math.sin(tSec * (fl.freqLick * 1.25) + fl.phase2);
    fl.mesh.scale.set(fl.baseScaleXZ * flickerXZ, fl.baseScaleY * lick, fl.baseScaleXZ * flickerXZ);
    fl.mesh.rotation.z = 0.12 * Math.sin(tSec * fl.swaySpeed + fl.phase1);
    fl.mesh.rotation.x = 0.09 * Math.cos(tSec * (fl.swaySpeed * 1.1) + fl.phase2);
    fl.mesh.rotation.y = fl.phase1 + 0.18 * Math.sin(tSec * 2.8 + f);
  }

  // 4. Magma Hearth Underbed & Charcoal Breathing Glow
  mats.magmaBed.emissiveIntensity = 2.6 + 0.8 * Math.sin(tSec * 4.5) + 0.3 * Math.cos(tSec * 9.2);
  mats.charcoal.emissiveIntensity = 2.2 + 0.6 * Math.sin(tSec * 5.2) + 0.3 * Math.cos(tSec * 11.4);

  // 5. Ascending 3D Thermal Spark & Ember Particles (72 helical sparks)
  for (let i = 0; i < fireEmbers.length; i++) {
    const em = fireEmbers[i];
    em.y += em.vy * frameTime;
    const h = em.y - (ARENA_FLOOR_HEIGHT + 0.12);
    if (h > 1.95) {
      em.y = ARENA_FLOOR_HEIGHT + 0.12;
      em.baseX = -3.65 + Math.random() * 1.7;
      em.baseZ = -4.0 + (Math.random() - 0.5) * (DRIVE_ROUTE_WIDTH - 1.1);
    } else {
      em.mesh.position.x = em.baseX + Math.sin(em.omega * h + em.phase) * (em.swirlRadius * (1 + h * 0.6));
      em.mesh.position.z = em.baseZ + Math.cos(em.omega * h + em.phase) * (em.swirlRadius * (1 + h * 0.6));
      em.mesh.position.y = em.y;
      const progress = h / 1.95;
      (em.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.95 * (1 - progress * progress));
    }
  }

  // 6. Interactive Vehicle Water Splash Particles
  const inWater = (pose.x / MAP_SCALE >= -5.8 && pose.x / MAP_SCALE <= -3.8 && Math.abs(pose.z / MAP_SCALE - (-4.0)) < DRIVE_ROUTE_WIDTH / 2);
  const robotSpeed = Math.hypot(pose.vx, pose.vz);
  if (inWater && robotSpeed > 0.35) {
    for (let k = 0; k < 2; k++) {
      const p = waterSplashPool.find(drop => drop.life <= 0);
      if (p) {
        const side = k === 0 ? -1 : 1;
        p.mesh.position.set(
          pose.x + (Math.random() - 0.5) * 0.4,
          (ARENA_FLOOR_HEIGHT + 0.35) * MAP_SCALE,
          pose.z + side * (TRACK_WIDTH * 0.5 * MAP_SCALE)
        );
        p.vx = (Math.random() - 0.5) * 1.2;
        p.vy = 1.8 + Math.random() * 1.8;
        p.vz = side * (0.8 + Math.random() * 1.2);
        p.life = p.maxLife;
        p.mesh.visible = true;
      }
    }
  }
  for (let i = 0; i < waterSplashPool.length; i++) {
    const p = waterSplashPool[i];
    if (p.life > 0) {
      p.life -= frameTime;
      p.vy -= 9.81 * frameTime * 1.4;
      p.mesh.position.x += p.vx * frameTime;
      p.mesh.position.y += p.vy * frameTime;
      p.mesh.position.z += p.vz * frameTime;
      if (p.life <= 0 || p.mesh.position.y < (ARENA_FLOOR_HEIGHT + 0.02) * MAP_SCALE) {
        p.life = 0;
        p.mesh.visible = false;
      }
    }
  }

  // 7. Dual Chaotic Dynamic Firelights
  fireLightCore.intensity = 18.0 + Math.sin(now * 0.021) * 3.2 + Math.sin(now * 0.047) * 1.5;
  fireLightFlicker.intensity = 12.5 + Math.sin(now * 0.029) * 3.8 + Math.cos(now * 0.063) * 2.4;
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

  // 4D Checkpoint 5 Flashing Aviation Navigation Beacons
  const bridgeStrobeOn = Math.sin(now * 0.012) > 0.4;
  for (let i = 0; i < bridgeStrobes.length; i++) {
    bridgeStrobes[i].visible = bridgeStrobeOn;
  }

  // 4D Checkpoint 6 Motorized Revolving Amber Beacons
  for (let i = 0; i < hazardRevolvingBeacons.length; i++) {
    hazardRevolvingBeacons[i].rotation.y += frameTime * 4.2;
  }

  // 4D Checkpoint 6 Electronic Chasing Chevron Arrow Signs
  for (let a = 0; a < chevronSignArrows.length; a++) {
    const phase = (now * 0.005 - a * 0.55) % (Math.PI * 2);
    chevronSignArrows[a].visible = Math.sin(phase) > -0.25;
  }

  // 4D Checkpoints 01-11 Dynamic Holographic Laser Tripwire Scan Lines & Beacons
  const cpStrobeOn = Math.sin(now * 0.008) > 0.3;
  for (let i = 0; i < checkpointBeacons.length; i++) {
    checkpointBeacons[i].visible = cpStrobeOn;
  }
  for (let i = 0; i < checkpointLaserBeams.length; i++) {
    const beam = checkpointLaserBeams[i];
    const cp = checkpointMeshes[i];
    const pulse = 0.45 + 0.35 * Math.sin(now * 0.006 + i * 0.7);
    (beam.material as THREE.MeshBasicMaterial).opacity = cp.passed ? 0.30 : pulse;
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
