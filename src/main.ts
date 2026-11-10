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
  evaluateWaterBuoyancy,
} from './vehicleDynamics';
import {
  createInitialSubsystems,
  stepSubsystems,
  applyFallImpactDamage,
  applyBatteryShock,
  isRobotDestroyed,
  type SubsystemsState,
  type HazardType,
} from './robotSubsystems';
import {
  DEFAULT_SCORING_CONFIG,
  createCompetitionScoreState,
  awardObstacleGatePoints,
  awardObstacleZonePoints,
  computeOutOfBoundsFraction,
  stepBoundaryRule,
  evaluateFallOutcome,
  classifyFallZone,
  classifyFallOrigin,
  OBSTACLE_SCORE_TIERS,
  type ScoringConfig,
  type CompetitionScoreState,
} from './scoringRules';
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
  GROUND_DECK_HEIGHT,
  ROUTE_DECK_HEIGHT,
  ROUTE_HEIGHT_OFFSET,
  ELEVATION_TIER_SMALL,
  HILL_ENTRY_LINK,
  HILL_EXIT_LINK,
  PARALLEL_PLANK_CENTERS,
  PENDULUM_CONFIG,
  HANGING_BRIDGE_CONFIG,
  HANGING_SAND_PIT_Y,
  hangingBridgeTrackHeightAt,
  easeCushionedRamp,
  TURNTABLE_CENTER,
  TURNTABLE_RADIUS,
  SPIRAL_CONFIG,
  evaluateSpiralRamp,
  getActiveTrack,
  setActiveTrack,
  type TrackId,
  CHECKPOINTS,
  SLALOM_BLOCKS,
  SPEED_BREAKER_CONFIG,
  HIGH_CLIMB_CONFIG,
  evaluateHighClimbHeight,
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
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  // Stained wet concrete bay margin around spilled dark crude oil lake
  ctx.fillStyle = '#2d3236';
  ctx.fillRect(0, 0, 512, 512);

  // Irregular organic glossy black crude petroleum spill body
  ctx.fillStyle = '#07090d';
  ctx.beginPath();
  ctx.ellipse(256, 256, 224, 212, 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(175, 195, 118, 92, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(342, 315, 110, 88, 0.38, 0, Math.PI * 2);
  ctx.fill();

  // Soft natural iridescent rainbow thin-film gasoline/oil interference over deep black crude base
  const swirls = [
    { x: 245, y: 248, rx: 162, ry: 122, rot: 0.25, w: 20, col: 'rgba(18, 125, 175, 0.28)' },
    { x: 268, y: 266, rx: 132, ry: 96, rot: -0.35, w: 18, col: 'rgba(125, 32, 168, 0.28)' },
    { x: 246, y: 254, rx: 102, ry: 74, rot: 0.55, w: 16, col: 'rgba(185, 132, 22, 0.24)' },
    { x: 264, y: 242, rx: 72, ry: 52, rot: -0.20, w: 14, col: 'rgba(20, 152, 112, 0.24)' },
    { x: 165, y: 185, rx: 58, ry: 34, rot: -0.40, w: 12, col: 'rgba(128, 36, 165, 0.22)' },
    { x: 335, y: 318, rx: 52, ry: 32, rot: 0.35, w: 12, col: 'rgba(22, 138, 175, 0.22)' },
  ];
  for (const s of swirls) {
    ctx.strokeStyle = s.col;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.rx, s.ry, s.rot, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Subtle wet specular glint arcs & side droplets
  ctx.strokeStyle = 'rgba(195, 220, 240, 0.16)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(230, 222, 92, -2.55, -1.35);
  ctx.stroke();
  ctx.fillStyle = '#080b10';
  for (const [dx, dy, dr] of [[95, 360, 16], [415, 145, 18], [410, 405, 13], [115, 110, 14]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function generateHighClimbTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  // Slick dark charcoal epoxy steel deck background
  ctx.fillStyle = '#2b3137';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, y, 512, 16);
  }
  // Subtle directional zigzag guidance chevron path painted cleanly across deck width
  ctx.strokeStyle = 'rgba(232, 175, 40, 0.55)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([22, 18]);
  ctx.beginPath();
  ctx.moveTo(40, 256);
  ctx.lineTo(155, 110);
  ctx.lineTo(285, 402);
  ctx.lineTo(410, 110);
  ctx.lineTo(485, 256);
  ctx.stroke();
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const flameTexture = generateFlameTexture();
const oilSlickTexture = generateOilSlickTexture();
const highClimbTexture = generateHighClimbTexture();

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
  cardboard: new THREE.MeshStandardMaterial({
    color: '#c49a6c',
    roughness: 0.84,
    metalness: 0.04,
    map: generateSurfaceTexture('#c49a6c', ['#d4ab7c', '#b18759', '#dfb88c'], 'wood'),
    side: THREE.DoubleSide,
  }),
  cardboardEdge: new THREE.MeshStandardMaterial({
    color: '#8a6238',
    roughness: 0.92,
    metalness: 0.04,
    side: THREE.DoubleSide,
  }),
  stakeMetal: new THREE.MeshStandardMaterial({
    color: '#495057',
    roughness: 0.28,
    metalness: 0.88,
  }),
  oil: new THREE.MeshStandardMaterial({ color: '#c4cbd2', roughness: 0.14, metalness: 0.06, map: oilSlickTexture }),
  highClimbDeck: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.20, metalness: 0.44, map: highClimbTexture }),
  water: new THREE.MeshStandardMaterial({
    color: '#0e7e9e',
    emissive: '#04222c',
    roughness: 0.04,
    metalness: 0.16,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
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
(window as unknown as Record<string, unknown>).__colliders = colliders;
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
  const uvs = [
    0, 0,  0, 1,  1, 1,  1, 0,
    0, 0,  0, 1,  1, 1,  1, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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

/**
 * Multi-segment ramp deck whose elevation profile follows `easeFn(t)` identically
 * to `evaluateCourseHeight`, ensuring tracks match visual geometry sub-millimeter.
 */
function curvedSlopedDeck(
  id: string,
  x0: number,
  x1: number,
  z: number,
  width: number,
  y0: number,
  y1: number,
  thickness: number,
  material: THREE.Material,
  easeFn: (t: number) => number = easeCushionedRamp,
  segments = 24,
) {
  const half = width / 2;
  const xMin = Math.min(x0, x1);
  const xMax = Math.max(x0, x1);
  const span = Math.max(1e-6, Math.abs(x1 - x0));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const x = xMin + (xMax - xMin) * s;
    const u = Math.max(0, Math.min(1, Math.abs(x - x0) / span));
    const y = y0 + (y1 - y0) * easeFn(u);
    positions.push(
      x, y, z - half,
      x, y, z + half,
      x, y - thickness, z + half,
      x, y - thickness, z - half,
    );
    uvs.push(s, 0, s, 1, s, 0, s, 1);
  }

  for (let i = 0; i < segments; i++) {
    const o = i * 4;
    const n = (i + 1) * 4;
    // Top (+Y) and Bottom (-Y)
    indices.push(o, o + 1, n + 1, o, n + 1, n);
    indices.push(o + 3, n + 2, o + 2, o + 3, n + 3, n + 2);
    // South (-Z) and North (+Z) side cheeks
    indices.push(o, n, n + 3, o, n + 3, o + 3);
    indices.push(o + 1, o + 2, n + 2, o + 1, n + 2, n + 1);
  }
  const end = segments * 4;
  // West (-X) and East (+X) end caps
  indices.push(0, 3, 2, 0, 2, 1);
  indices.push(end + 1, end + 2, end + 3, end + 1, end + 3, end);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  course.add(mesh);
  return mesh;
}

/**
 * Adds recessed below-grade concrete abutment footings, flush steel sill plates,
 * under-deck longitudinal steel stringers (strictly below top surface), and curved
 * yellow caution edge stripes + center guide line along any Lane 4 ramp.
 */
function buildRampTrimAndFootings(
  idPrefix: string,
  xGround: number,
  xCrest: number,
  zLane: number,
  width: number,
  yGround: number,
  yCrest: number,
  segments = 24,
) {
  const sillDir = Math.sign(xGround - xCrest) || 1;
  // Concrete abutment buried flush below ground asphalt (-0.33m) + steel transition apron
  box(course, mats.concretePier, V(xGround + sillDir * 0.14, yGround - 0.16, zLane), V(0.36, 0.30, width + 0.24));
  box(course, mats.metal, V(xGround + sillDir * 0.10, yGround + 0.004, zLane), V(0.28, 0.012, width + 0.08), 0, false);

  for (const side of [-1, 1]) {
    const zEdge = zLane + side * (width / 2 - 0.05);
    curvedSlopedDeck(`${idPrefix}_stripe_${side}`, xGround, xCrest, zEdge, 0.075, yGround + 0.010, yCrest + 0.010, 0.006, mats.yellow, easeCushionedRamp, segments);
    curvedSlopedDeck(`${idPrefix}_stringer_${side}`, xGround, xCrest, zEdge, 0.085, yGround - 0.10, yCrest - 0.10, 0.12, mats.metal, easeCushionedRamp, segments);
  }
  curvedSlopedDeck(`${idPrefix}_center_guide`, xGround, xCrest, zLane, 0.065, yGround + 0.010, yCrest + 0.010, 0.006, mats.laneStripeYellow, easeCushionedRamp, segments);
}

/**
 * Builds symmetric angled parapet wingwalls with matching oriented SAT colliders
 * smoothly channeling wide 4.40m road traffic into narrower bridge throats.
 */
function addTaperedFunnelCurbs(
  idPrefix: string,
  x0: number,
  zOffset0: number,
  x1: number,
  zOffset1: number,
  zLane: number,
  laneDeckY: number,
) {
  for (const side of [-1, 1]) {
    const p0z = zLane + side * zOffset0;
    const p1z = zLane + side * zOffset1;
    const dx = x1 - x0;
    const dz = p1z - p0z;
    const len = Math.hypot(dx, dz) + 0.04;
    const rot = Math.atan2(-dz, dx);
    const midX = (x0 + x1) * 0.5;
    const midZ = (p0z + p1z) * 0.5;
    // Flush tapered competition threshold boundary line (zero physical barrier wall)
    box(course, mats.yellow, V(midX, laneDeckY + 0.011, midZ), V(len, 0.014, 0.14), rot, false);
    void idPrefix;
  }
}

/**
 * Marks lateral bridge approach step-ins with flush high-contrast competition boundary
 * painted markings (replaces blocking concrete portal walls).
 */
function addBridgePortalHeadwalls(
  idPrefix: string,
  xEdge: number,
  zInnerOffset: number,
  zOuterOffset: number,
  zLane: number,
  laneDeckY: number,
) {
  const spanZ = Math.max(0.24, zOuterOffset - zInnerOffset);
  const midZOffset = (zInnerOffset + zOuterOffset) * 0.5;
  for (const side of [-1, 1]) {
    const cz = zLane + side * midZOffset;
    box(course, mats.fiaRed, V(xEdge, laneDeckY + 0.011, cz), V(0.16, 0.014, spanZ + 0.06), 0, false);
    cyl(course, mats.yellow, V(xEdge, laneDeckY + 0.012, zLane + side * zInnerOffset), 0.11, 0.016, 'y');
    void idPrefix;
  }
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
  const uvs = [
    0, 0,  0, 1,  1, 1,  1, 0,
    0, 0,  0, 1,  1, 1,  1, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
  const uvs = [
    0, 0,  0, 1,  1, 1,  1, 0,
    0, 0,  0, 1,  1, 1,  1, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
  // Collision core matches the visible wall footprint with ample vertical safety envelope.
  colliders.push({
    id: data.id,
    x,
    z,
    hx: length / 2,
    hz: span / 2,
    y: ROUTE_DECK_HEIGHT + 0.70,
    height: 1.40,
    rot: 0,
    walkable: false,
  });
}

// Main Arena Floors & Dedicated Path-Based Racing Circuit (carved cleanly around sunken Sand Pit beneath Section 5B)
const pitFloorXMin = HANGING_BRIDGE_CONFIG.pitXMin;
const pitFloorXMax = HANGING_BRIDGE_CONFIG.pitXMax;
const pitFloorZMin = HANGING_BRIDGE_CONFIG.zLane - HANGING_BRIDGE_CONFIG.pitHalfZ;
const pitFloorZMax = HANGING_BRIDGE_CONFIG.zLane + HANGING_BRIDGE_CONFIG.pitHalfZ;
box(course, mats.floor, V((-25 + pitFloorXMin) * 0.5, ARENA_FLOOR_HEIGHT - 0.225, 0), V(pitFloorXMin + 25, 0.45, 36), 0, false);
box(course, mats.floor, V((pitFloorXMax + 25) * 0.5, ARENA_FLOOR_HEIGHT - 0.225, 0), V(25 - pitFloorXMax, 0.45, 36), 0, false);
box(course, mats.floor, V((pitFloorXMin + pitFloorXMax) * 0.5, ARENA_FLOOR_HEIGHT - 0.225, (-18 + pitFloorZMin) * 0.5), V(pitFloorXMax - pitFloorXMin, 0.45, pitFloorZMin + 18), 0, false);
box(course, mats.floor, V((pitFloorXMin + pitFloorXMax) * 0.5, ARENA_FLOOR_HEIGHT - 0.225, (pitFloorZMax + 18) * 0.5), V(pitFloorXMax - pitFloorXMin, 0.45, 18 - pitFloorZMax), 0, false);

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
    // Suppress highway road markings inside off-road rock quarry, hazard zones, and motorized turntable
    const inTurntable = Math.hypot(p.x - TURNTABLE_CENTER.x, p.z - TURNTABLE_CENTER.z) <= TURNTABLE_RADIUS + 0.15;
    const inRockField = p.x >= 6.0 && p.x <= 14.5 && Math.abs(p.z - 13.50) <= 2.2;
    const suppressMarkings = inRockField || inTurntable;
    const centerY = evaluateCourseHeight(p.x, p.z);

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

// 1. Reconstructed 5-Lane Full-Map Viaduct Corridors
// Connects the entire arena into 5 straight parallel east-west corridors connected by
// 4 wide semicircular 180° hairpin bridges, utilizing the full arena footprint.

function circularArcPoints(cx: number, cz: number, radius: number, start: number, end: number, count: number): CoursePoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count;
    return { x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) };
  });
}

// Lane 1: South Straight (Z = 13.50, Eastbound)
const corridorLane1: CoursePoint[] = [
  { x: -20.5, z: 13.50 },
  { x: -19.5, z: 13.50 },
  { x: -17.5, z: 13.50 },
  { x: -15.0, z: 13.50 },
  { x: -11.5, z: 13.50 },
  { x: -8.0, z: 13.50 },
  { x: -4.5, z: 13.50 },
  { x: -1.0, z: 13.50 },
  { x: 4.2, z: 13.50 },
  { x: 6.0, z: 13.50 },
  { x: 10.25, z: 13.50 },
  { x: 14.5, z: 13.50 },
  { x: 17.5, z: 13.50 },
];

// Hairpin 1: Semicircular Viaduct (cx = 17.50, cz = 10.125, R = 3.375)
const hairpin1Arc = circularArcPoints(17.50, 10.125, 3.375, Math.PI / 2, -Math.PI / 2, 24);

// Lane 2: Mid-South Straight (Z = 6.75, Westbound) — split cleanly around High-Incline Zigzag Ramp & Mega Speed Hump Gauntlet
const corridorLane2EastEntry: CoursePoint[] = [
  { x: 17.5, z: 6.75 },
  { x: HIGH_CLIMB_CONFIG.xEntryStart, z: 6.75 },
];
const corridorLane2EastExit: CoursePoint[] = [
  { x: HIGH_CLIMB_CONFIG.xExitEnd, z: 6.75 },
  { x: SPEED_BREAKER_CONFIG.deckXMax, z: 6.75 },
];
const corridorLane2West: CoursePoint[] = [
  { x: SPEED_BREAKER_CONFIG.deckXMin, z: 6.75 },
  { x: -7.5, z: 6.75 },
  { x: -9.5, z: 6.75 },
  { x: -12.0, z: 6.75 },
  { x: -17.5, z: 6.75 },
];

// Hairpin 2: Semicircular Viaduct (cx = -17.50, cz = 3.375, R = 3.375)
const hairpin2Arc = circularArcPoints(-17.50, 3.375, 3.375, Math.PI / 2, Math.PI * 1.5, 24);

// Lane 3: Center Straight Ground Approach & Landing Exit
// Ground Approach to Spiral: x in [-17.5, -5.85]
const corridorLane3Approach: CoursePoint[] = [
  { x: -17.5, z: 0.00 },
  { x: -13.0, z: 0.00 },
  { x: -8.00, z: 0.00 },
  { x: -5.85, z: 0.00 },
];
// Landing Exit from Descending Ramp to Hairpin 3: x in [10.45, 17.5]
const corridorLane3Exit: CoursePoint[] = [
  { x: 10.45, z: 0.00 },
  { x: 14.00, z: 0.00 },
  { x: 17.50, z: 0.00 },
];

// Hairpin 3: Semicircular Viaduct (cx = 17.50, cz = -3.375, R = 3.375)
const hairpin3Arc = circularArcPoints(17.50, -3.375, 3.375, Math.PI / 2, -Math.PI / 2, 24);

// Lane 4: Mid-North Straight (Z = -6.75, Westbound) — split around Pendulum & Suspension Bridge structures
const corridorLane4East: CoursePoint[] = [
  { x: 17.56, z: -6.75 },
  { x: PENDULUM_CONFIG.xEntryStart, z: -6.75 },
];
const corridorLane4Mid: CoursePoint[] = [
  { x: PENDULUM_CONFIG.xExitEnd, z: -6.75 },
  { x: HANGING_BRIDGE_CONFIG.xEntryStart, z: -6.75 },
];
const corridorLane4West: CoursePoint[] = [
  { x: HANGING_BRIDGE_CONFIG.xExitEnd, z: -6.75 },
  { x: -17.5, z: -6.75 },
];

// Hairpin 4: Semicircular Viaduct (cx = -17.50, cz = -10.125, R = 3.375)
const hairpin4Arc = circularArcPoints(-17.50, -10.125, 3.375, Math.PI / 2, Math.PI * 1.5, 24);

// Lane 5: North Finishing Straight (Z = -13.50, Eastbound)
// Approach to Fire Hazard: x in [-17.5, -5.5]
const corridorLane5Approach: CoursePoint[] = [
  { x: -17.5, z: -13.50 },
  { x: -12.0, z: -13.50 },
  { x: -5.50, z: -13.50 },
];
// Grand Finish Straightaway after Water Exit: x in [9.5, 16.0]
const corridorLane5Finish: CoursePoint[] = [
  { x: 9.5, z: -13.50 },
  { x: 12.0, z: -13.50 },
  { x: 16.0, z: -13.50 },
];

export const VIADUCT_LANE_WIDTH = DRIVE_ROUTE_WIDTH; // 4.40m gives 2.89x robot width
const allCircuitCorridors = [
  corridorLane1,
  hairpin1Arc,
  corridorLane2EastEntry,
  corridorLane2EastExit,
  corridorLane2West,
  hairpin2Arc,
  corridorLane3Approach,
  corridorLane3Exit,
  hairpin3Arc,
  corridorLane4East,
  corridorLane4Mid,
  corridorLane4West,
  hairpin4Arc,
  corridorLane5Approach,
  corridorLane5Finish,
];

for (const corr of allCircuitCorridors) {
  createRouteRibbon(0, VIADUCT_LANE_WIDTH, mats.asphalt, 0.006, corr, true, 0.22);
  createRouteRibbon(-(VIADUCT_LANE_WIDTH / 2 - 0.12), 0.065, mats.laneStripeWhite, 0.016, corr, false);
  createRouteRibbon(VIADUCT_LANE_WIDTH / 2 - 0.12, 0.065, mats.laneStripeWhite, 0.016, corr, false);
  createRouteRibbon(0, 0.08, mats.yellow, 0.016, corr, false);
}

// Structural Heavy Pier Bents carrying the elevated circuit above the arena floor
const pierBentPositions: CoursePoint[] = [
  // Lane 1 (Z = 13.50)
  { x: -17.0, z: 13.50 },
  { x: -10.0, z: 13.50 },
  { x: -3.0, z: 13.50 },
  { x: 4.0, z: 13.50 },
  { x: 10.0, z: 13.50 },
  { x: 16.0, z: 13.50 },
  // Hairpin 1
  { x: 20.8, z: 10.125 },
  // Lane 2 (Z = 6.75) — x=10 & x=16 omitted where High-Incline Zigzag Ramp builds dedicated 5.20m architectural piers
  { x: 4.0, z: 6.75 },
  { x: -3.0, z: 6.75 },
  { x: -10.0, z: 6.75 },
  { x: -16.0, z: 6.75 },
  // Hairpin 2
  { x: -20.8, z: 3.375 },
  // Lane 3 (Z = 0.00)
  { x: -16.0, z: 0.00 },
  { x: -10.0, z: 0.00 },
  { x: 2.0, z: 0.00 },
  { x: 8.0, z: 0.00 },
  { x: 14.0, z: 0.00 },
  // Hairpin 3
  { x: 20.8, z: -3.375 },
  // Lane 4 (Z = -6.75)
  { x: 16.0, z: -6.75 },
  { x: 10.0, z: -6.75 },
  { x: 2.0, z: -6.75 },
  { x: -5.0, z: -6.75 },
  { x: -12.0, z: -6.75 },
  { x: -16.0, z: -6.75 },
  // Hairpin 4
  { x: -20.8, z: -10.125 },
  // Lane 5 (Z = -13.50)
  { x: -16.0, z: -13.50 },
  { x: -10.0, z: -13.50 },
  { x: -4.0, z: -13.50 },
  { x: 2.0, z: -13.50 },
  { x: 8.0, z: -13.50 },
  { x: 14.0, z: -13.50 },
];
for (const pb of pierBentPositions) {
  const deckY = evaluateCourseHeight(pb.x, pb.z);
  if (deckY <= GROUND_DECK_HEIGHT + 0.15) continue;
  const legHeight = (deckY - 0.22) - ARENA_FLOOR_HEIGHT;
  if (legHeight < 0.25) continue;
  const bentW = DRIVE_ROUTE_WIDTH - 0.40;
  // Transverse cap beam seated right under the viaduct slab
  box(course, mats.concretePier, V(pb.x, deckY - 0.15, pb.z), V(0.44, 0.26, bentW));
  for (const side of [-1, 1]) {
    const colZ = pb.z + side * (bentW / 2 - 0.35);
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

// Solid perimeter wall hazard coping firmly seated on top of barrier parapets
const wallTopY = ARENA_FLOOR_HEIGHT + 0.78;
box(course, mats.yellow, V(0, wallTopY + 0.015, -17.82), V(46, 0.03, 0.34), 0, false);
box(course, mats.yellow, V(0, wallTopY + 0.015, 17.82), V(46, 0.03, 0.34), 0, false);
box(course, mats.yellow, V(-24.02, wallTopY + 0.015, 0), V(0.34, 0.03, 36), 0, false);
box(course, mats.yellow, V(24.02, wallTopY + 0.015, 0), V(0.34, 0.03, 36), 0, false);

// Start Bay and level transition to Lane 1 on ground grade (-0.33m)
box(course, mats.asphalt, V(-19.5, ARENA_FLOOR_HEIGHT + 0.01, 13.50), V(4.0, 0.02, DRIVE_ROUTE_WIDTH));
colliders.push({ id: 'start_bay_floor', x: -19.5, z: 13.50, hx: 2.0, hz: DRIVE_ROUTE_WIDTH / 2, y: ARENA_FLOOR_HEIGHT, height: 0.10, rot: 0, walkable: true });

// Brick walls reach in from alternating edges, making a real left-right weave
// while leaving the opposite half of the lane open at every hurdle.
for (const obstacle of SLALOM_BLOCKS) {
  buildSlalomBlock(obstacle);
}


// ---------------------------------------------------------------------------
// PARKING-GARAGE-STYLE SPIRAL RAMP & UPPER ROOFTOP TURNTABLE ON LANE 3
// ---------------------------------------------------------------------------
const hazardRevolvingBeacons: THREE.Group[] = [];

function buildSpiralClimbingStructure() {
  const cfg = SPIRAL_CONFIG;

  // 1. Heavy Engineered Central Core Pylon & Foundation Pier Assembly (cx = -4.50, cz = 0.00)
  // Replaces the slender flagpole/spindle with an authentic heavy industrial structural pylon.
  const pylonRadius = 0.25;
  const pylonTopY = cfg.yTop + 0.25; // y = 3.45m (harmonious with summit safety parapets)
  const pylonHeight = pylonTopY - ARENA_FLOOR_HEIGHT; // 3.78m total structural height
  const pylonCenterY = ARENA_FLOOR_HEIGHT + pylonHeight / 2;

  // A. Heavy Reinforced Concrete Foundation Pedestal on Arena Floor
  // Chamfered octagonal/circular concrete footing plinth anchoring the structure to the ground
  cyl(course, mats.concretePier, V(cfg.cx, ARENA_FLOOR_HEIGHT + 0.175, cfg.cz), 0.52, 0.35, 'y', 32);
  cyl(course, mats.concretePier, V(cfg.cx, ARENA_FLOOR_HEIGHT + 0.36, cfg.cz), 0.44, 0.06, 'y', 32);
  // Heavy cast-steel anchor base plate
  cyl(course, mats.metal, V(cfg.cx, ARENA_FLOOR_HEIGHT + 0.40, cfg.cz), 0.36, 0.04, 'y', 32);
  for (let b = 0; b < 8; b++) {
    const bTheta = (b * Math.PI) / 4;
    const bx = cfg.cx + 0.31 * Math.cos(bTheta);
    const bz = cfg.cz + 0.31 * Math.sin(bTheta);
    cyl(course, mats.chrome, V(bx, ARENA_FLOOR_HEIGHT + 0.43, bz), 0.022, 0.04, 'y', 8);
  }

  // B. Main Heavy Structural Steel Core Column Shaft
  cyl(course, mats.metal, V(cfg.cx, pylonCenterY, cfg.cz), pylonRadius, pylonHeight, 'y', 32);

  // C. 8 Longitudinal Structural Steel T-Flange Stiffener Ribs along Pylon Shaft
  for (let f = 0; f < 8; f++) {
    const fTheta = (f * Math.PI) / 4;
    const fx = cfg.cx + (pylonRadius + 0.018) * Math.cos(fTheta);
    const fz = cfg.cz + (pylonRadius + 0.018) * Math.sin(fTheta);
    box(course, mats.metal, V(fx, pylonCenterY, fz), V(0.038, pylonHeight, 0.024), fTheta, false);
  }

  // D. Circumferential Structural Mounting Collar Hubs with Bolted Flanges
  // Positioned directly at the three cantilever truss attachment horizons
  for (const hubY of [0.65, 1.85, 3.05]) {
    cyl(course, mats.metal, V(cfg.cx, hubY, cfg.cz), pylonRadius + 0.05, 0.16, 'y', 32);
    cyl(course, mats.concretePier, V(cfg.cx, hubY, cfg.cz), pylonRadius + 0.065, 0.04, 'y', 32);
  }

  // E. Summit Architectural Crown & Rotating Industrial Warning Beacon Station
  // Cleanly terminates at summit elevation without weird mid-air collars or pointy needles:
  const crownY = pylonTopY;
  cyl(course, mats.metal, V(cfg.cx, crownY, cfg.cz), pylonRadius + 0.06, 0.08, 'y', 32);
  cyl(course, mats.concretePier, V(cfg.cx, crownY + 0.05, cfg.cz), pylonRadius + 0.02, 0.04, 'y', 32);
  // Machined beacon pedestal mount
  cyl(course, mats.metal, V(cfg.cx, crownY + 0.11, cfg.cz), 0.14, 0.08, 'y', 24);
  // Hazard warning strobe beacon
  const spiralBeaconGroup = new THREE.Group();
  spiralBeaconGroup.position.set(cfg.cx, crownY + 0.23, cfg.cz);
  const spiralBeaconDome = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.16, 16), mats.beaconAmber);
  spiralBeaconGroup.add(spiralBeaconDome);
  const spiralBeaconReflector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.07), mats.yellow);
  spiralBeaconGroup.add(spiralBeaconReflector);
  // Protective steel beacon cage bars
  for (let cb = 0; cb < 4; cb++) {
    const cbAng = (cb * Math.PI) / 2;
    const cax = 0.11 * Math.cos(cbAng);
    const caz = 0.11 * Math.sin(cbAng);
    cyl(course, mats.metal, V(cfg.cx + cax, crownY + 0.23, cfg.cz + caz), 0.012, 0.18, 'y', 8);
  }
  cyl(course, mats.metal, V(cfg.cx, crownY + 0.32, cfg.cz), 0.12, 0.02, 'y', 16);
  course.add(spiralBeaconGroup);
  hazardRevolvingBeacons.push(spiralBeaconGroup);

  // F. Regular Octagonal Collider Prism (Snug 8-Sided Footprint - ZERO Lane Protrusion)
  // Replaces the crude 28cm AABB whose 40cm diagonal corners protruded into the driving curve:
  colliders.push({
    id: 'spiral_central_pylon_a',
    x: cfg.cx,
    z: cfg.cz,
    hx: 0.19,
    hz: 0.19,
    y: pylonCenterY,
    height: pylonHeight,
    rot: 0,
    walkable: false,
  });
  colliders.push({
    id: 'spiral_central_pylon_b',
    x: cfg.cx,
    z: cfg.cz,
    hx: 0.19,
    hz: 0.19,
    y: pylonCenterY,
    height: pylonHeight,
    rot: Math.PI / 4,
    walkable: false,
  });
  // Ground foundation footing collider (stays well clear of the approach road at x = -5.85)
  colliders.push({
    id: 'spiral_pylon_footing',
    x: cfg.cx,
    z: cfg.cz,
    hx: 0.40,
    hz: 0.40,
    y: ARENA_FLOOR_HEIGHT + 0.175,
    height: 0.35,
    rot: 0,
    walkable: false,
  });

  // 2. Continuous Solid Ground Foundation Apron under Spiral Precinct (x in [-11.75, 1.75], z in [-3.75, 3.75])
  // Completely eliminates any empty void or hole under the spiral structure and approach road:
  box(course, mats.asphalt, V(-5.00, ARENA_FLOOR_HEIGHT + 0.004, 0.00), V(13.50, 0.02, 7.50), 0, false);

  // 3. Beveled Transition Entrance Deck Plate (x in [-6.75, -5.85])
  // Smooth flush approach plate leading directly onto the continuous helical cardboard deck
  box(course, mats.diamondPlate, V(-6.30, ARENA_FLOOR_HEIGHT + 0.008, 0.00), V(0.90, 0.012, cfg.roadWidth), 0, false);

  // 4. Heavy Engineered Composite Spiral Climbing Surface (144 Segments over 1.5 turns, 540 degrees)
  // Continuous cantilevered spiral around central stake with structural steel bracket trusses.
  // Climbs from ground entrance (y = -0.33m at x = -5.60, z = 0.0) up to summit (y = 3.20m at x = -3.40, z = 0.0)
  const segments = 144;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const totalAngle = cfg.endAngle - cfg.startAngle; // 1.5 * 2 * PI = 3 * PI (540 deg)

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const theta = cfg.startAngle + t * totalAngle;
    const yBase = cfg.yGround + t * (cfg.yTop - cfg.yGround);

    // Inward superelevation banking matching evaluateSpiralRamp (outer edge slightly elevated):
    const camberInner = -0.020;
    const camberOuter = 0.020;

    const yTopIn = yBase + camberInner;
    const yTopOut = yBase + camberOuter;
    const yBotIn = yTopIn - 0.20; // Massive 20cm heavy structural composite deck girder
    const yBotOut = yTopOut - 0.20;

    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const xIn = cfg.cx + cfg.rInner * cosT;
    const zIn = cfg.cz + cfg.rInner * sinT;
    const xOut = cfg.cx + cfg.rOuter * cosT;
    const zOut = cfg.cz + cfg.rOuter * sinT;

    positions.push(xIn, yTopIn, zIn);   // 0
    positions.push(xOut, yTopOut, zOut); // 1
    positions.push(xOut, yBotOut, zOut); // 2
    positions.push(xIn, yBotIn, zIn);   // 3

    uvs.push(0, t * 18);
    uvs.push(1, t * 18);
    uvs.push(1, t * 18);
    uvs.push(0, t * 18);

    if (s < segments) {
      const b = s * 4;
      const n = (s + 1) * 4;
      // Top high-traction driving deck
      indices.push(b, n, b + 1, b + 1, n, n + 1);
      // Outer vertical concrete edge girder
      indices.push(b + 1, n + 1, b + 2, b + 2, n + 1, n + 2);
      // Bottom reinforced underside
      indices.push(b + 2, n + 2, b + 3, b + 3, n + 2, n + 3);
      // Inner vertical edge at stake
      indices.push(b + 3, n + 3, b, b, n + 3, n);
    }
  }

  const rampGeo = new THREE.BufferGeometry();
  rampGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  rampGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  rampGeo.setIndex(indices);
  rampGeo.computeVertexNormals();
  const rampMesh = new THREE.Mesh(rampGeo, mats.diamondPlate);
  rampMesh.receiveShadow = true;
  course.add(rampMesh);

  // 12 Heavy Structural Steel Cantilever Outrigger Trusses supporting Spiral Ramp from Central Pylon
  // Positioned cleanly BENEATH the 0.20m thick composite deck girder slab so they physically support it from below
  for (let b = 1; b <= 11; b++) {
    const t = b / 12;
    const theta = cfg.startAngle + t * totalAngle;
    const yDeck = cfg.yGround + t * (cfg.yTop - cfg.yGround);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const outX = cfg.cx + (cfg.rOuter - 0.18) * cosT;
    const outZ = cfg.cz + (cfg.rOuter - 0.18) * sinT;
    const inX = cfg.cx + (pylonRadius + 0.02) * cosT;
    const inZ = cfg.cz + (pylonRadius + 0.02) * sinT;

    // Horizontal structural steel cantilever outrigger arm supporting underside of 0.20m deck
    const yUnderSlab = yDeck - 0.24;
    tubeBetween(V(inX, yUnderSlab, inZ), V(outX, yUnderSlab, outZ), 0.065, mats.metal);
    // Bolted end-cap bracket at outer deck rim
    cyl(course, mats.concretePier, V(outX, yUnderSlab, outZ), 0.08, 0.14, 'y', 12);
    // Diagonal structural gusset strut anchoring from pylon hub collar up to outrigger arm
    const midX = inX * 0.35 + outX * 0.65;
    const midZ = inZ * 0.35 + outZ * 0.65;
    tubeBetween(V(inX, Math.max(ARENA_FLOOR_HEIGHT + 0.25, yUnderSlab - 0.48), inZ), V(midX, yUnderSlab, midZ), 0.050, mats.metal);
    // Bolted mounting shoe at pylon connection
    box(course, mats.metal, V(inX, yUnderSlab, inZ), V(0.08, 0.16, 0.08), -theta, false);
  }


  // Outer continuous concrete safety parapet wall (0.36m high) along the helical perimeter
  // Curves up along outer edge until theta = 23*PI/6 (s = 136, x = -2.335, z = -1.25) where it meets bridge North parapet
  const kerbPositions: number[] = [];
  const kerbIndices: number[] = [];
  // Flush Outer Competition Boundary Edge Lines along helical ramp (replaces raised parapet walls)
  const kerbSegments = 136;
  for (let s = 0; s < kerbSegments; s += 2) {
    const t = (s + 0.5) / segments;
    const theta = cfg.startAngle + t * totalAngle;
    const yBase = cfg.yGround + t * (cfg.yTop - cfg.yGround);
    const cxP = cfg.cx + (cfg.rOuter - 0.06) * Math.cos(theta);
    const czP = cfg.cz + (cfg.rOuter - 0.06) * Math.sin(theta);
    box(course, (s / 2) % 2 === 0 ? mats.yellow : mats.fiaRed, V(cxP, yBase + 0.022, czP), V(0.24, 0.014, 0.10), -theta, false);
  }

  // 5. Flared Summit Transition Apron & Fully Engineered Viaduct Approach Bridge
  // Continuous heavy reinforced concrete deck connecting Spiral Summit to Turntable Deck (x = -1.45)
  // A. Straight Viaduct Deck (x in [-2.35, -1.45], z in [-1.25, +1.25], thickness 0.22m)
  // Provides clean 2.50m wide driving roadway flush with summit elevation (y = 3.20m)
  box(course, mats.concretePier, V(-1.90, cfg.yTop - 0.11, 0.0), V(0.90, 0.22, 2.50));
  box(course, mats.diamondPlate, V(-1.90, cfg.yTop + 0.005, 0.0), V(0.90, 0.015, 2.48));

  // B. Flared Transition Apron Deck (x in [-3.20, -2.35] in Southern quadrant z in [0, zSouth])
  // Creates a clean chamfered structural prism eliminating crude rectangular cantilevers over empty space
  const apronGeo = new THREE.BufferGeometry();
  const yTopA = cfg.yTop;
  const yBotA = cfg.yTop - 0.22;
  const apronPos = [
    // Top face vertices (y = yTopA)
    -3.20, yTopA, 0.00,  // 0
    -2.35, yTopA, 0.00,  // 1
    -2.35, yTopA, 1.25,  // 2
    -3.20, yTopA, 0.55,  // 3
    // Bottom face vertices (y = yBotA)
    -3.20, yBotA, 0.00,  // 4
    -2.35, yBotA, 0.00,  // 5
    -2.35, yBotA, 1.25,  // 6
    -3.20, yBotA, 0.55,  // 7
  ];
  const apronIdx = [
    0, 2, 1,  0, 3, 2, // Top face (normals +Y)
    4, 5, 6,  4, 6, 7, // Bottom face (normals -Y)
    3, 7, 2,  2, 7, 6, // South angled fascia
    0, 4, 3,  3, 4, 7, // West joint face
    1, 2, 5,  2, 6, 5, // East face
    0, 1, 4,  1, 5, 4, // North centerline joint
  ];
  apronGeo.setAttribute('position', new THREE.Float32BufferAttribute(apronPos, 3));
  apronGeo.setIndex(apronIdx);
  apronGeo.computeVertexNormals();
  const apronMesh = new THREE.Mesh(apronGeo, mats.concretePier);
  course.add(apronMesh);

  // Flared apron diamond plate driving surface
  const apronPlateGeo = new THREE.BufferGeometry();
  const apronPlatePos = [
    -3.20, yTopA + 0.005, 0.00,
    -2.35, yTopA + 0.005, 0.00,
    -2.35, yTopA + 0.005, 1.24,
    -3.20, yTopA + 0.005, 0.54,
  ];
  const apronPlateUvs = [
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ];
  apronPlateGeo.setAttribute('position', new THREE.Float32BufferAttribute(apronPlatePos, 3));
  apronPlateGeo.setAttribute('uv', new THREE.Float32BufferAttribute(apronPlateUvs, 2));
  apronPlateGeo.setIndex([0, 2, 1, 0, 3, 2]);
  apronPlateGeo.computeVertexNormals();
  const apronPlateMesh = new THREE.Mesh(apronPlateGeo, mats.diamondPlate);
  course.add(apronPlateMesh);

  // Continuous yellow race track centerline stripe from spiral exit across flared apron and bridge to turntable
  box(course, mats.laneStripeYellow, V(-2.325, cfg.yTop + 0.012, 0.0), V(1.75, 0.006, 0.12), 0, false);

  // Dual heavy longitudinal steel wide-flange I-beam girders underneath approach bridge (x in [-2.35, -1.45])
  box(course, mats.metal, V(-1.90, cfg.yTop - 0.28, 0.95), V(0.90, 0.16, 0.16));
  box(course, mats.metal, V(-1.90, cfg.yTop - 0.28, -0.95), V(0.90, 0.16, 0.16));
  // Transverse steel header beam tying longitudinal girders at x = -2.35m
  box(course, mats.metal, V(-2.35, cfg.yTop - 0.28, 0.0), V(0.14, 0.16, 2.06));

  // Dual concrete support columns at x = -1.65m outside the spiral footprint (where no lower ramp exists below)
  for (const sideZ of [-0.95, 0.95]) {
    cyl(course, mats.concretePier, V(-1.65, (ARENA_FLOOR_HEIGHT + cfg.yTop - 0.22) / 2, sideZ), 0.18, (cfg.yTop - 0.22) - ARENA_FLOOR_HEIGHT, 'y', 24);
    box(course, mats.concretePier, V(-1.65, ARENA_FLOOR_HEIGHT + 0.15, sideZ), V(0.55, 0.30, 0.55));
  }
  // Transverse concrete crosshead beam tying the columns together under the longitudinal I-beams
  box(course, mats.concretePier, V(-1.65, cfg.yTop - 0.28, 0.0), V(0.36, 0.14, 2.20));

  // Heavy structural diagonal steel cantilever struts anchoring from central pylon collar up to transition apron header
  cyl(course, mats.concretePier, V(-4.40, cfg.yTop - 0.70, 0.0), 0.28, 0.18, 'y', 24);
  tubeBetween(V(-4.40, cfg.yTop - 0.70, 0.0), V(-2.35, cfg.yTop - 0.26, 0.65), 0.065, mats.metal);
  tubeBetween(V(-4.40, cfg.yTop - 0.70, 0.0), V(-2.35, cfg.yTop - 0.26, -0.65), 0.065, mats.metal);

  // Flush competition boundary edge stripes along Viaduct Approach Bridge (zero barrier walls):
  box(course, mats.yellow, V(-1.892, cfg.yTop + 0.015, -1.18), V(0.885, 0.012, 0.10), 0, false);
  box(course, mats.yellow, V(-1.90, cfg.yTop + 0.015, 1.18), V(0.90, 0.012, 0.10), 0, false);
  const wingwallAngle = -Math.atan2(0.70, 0.85);
  box(course, mats.yellow, V(-2.775, cfg.yTop + 0.015, 0.90), V(1.10, 0.012, 0.10), wingwallAngle, false);

  // 6. Connected Descending Viaduct Ramp (x in [3.45, 10.45], slopes smoothly from 3.20m down to -0.33m)
  // High-traction diamond plate deck with concrete under-girder slab and flush competition boundary lines
  const dX0 = cfg.descentX0; // 3.45
  const dX1 = cfg.descentX1; // 10.45
  const dWidth = cfg.descentWidth; // 2.30m matching roadWidth
  slopedDeck('spiral_descent_ramp', dX0, dX1, cfg.descentZ, dWidth, cfg.yTop, cfg.yGround, 0.16, mats.diamondPlate);
  slopedDeck('spiral_descent_stripe', dX0, dX1, cfg.descentZ, 0.12, cfg.yTop + 0.006, cfg.yGround + 0.006, 0.006, mats.laneStripeYellow);

  // Flush caution boundary edge lines along descending ramp shoulders (NO parapet walls or blockers)
  for (const side of [-1, 1]) {
    const zLine = cfg.descentZ + side * (dWidth * 0.5 - 0.06);
    slopedDeck(`spiral_descent_line_${side}`, dX0, dX1, zLine, 0.10, cfg.yTop + 0.012, cfg.yGround + 0.012, 0.012, mats.yellow);
  }

  // Solid under-deck abutment bulkhead beneath the summit transition at x = 3.45
  box(course, mats.concretePier, V(dX0, (ARENA_FLOOR_HEIGHT + cfg.yTop - 0.20) / 2, cfg.descentZ), V(0.36, (cfg.yTop - 0.20) - ARENA_FLOOR_HEIGHT, dWidth));
  colliders.push({
    id: 'spiral_descent_abutment_under',
    x: dX0,
    z: cfg.descentZ,
    hx: 0.22,
    hz: dWidth / 2,
    y: (ARENA_FLOOR_HEIGHT + cfg.yTop - 0.35) / 2,
    height: (cfg.yTop - 0.35) - ARENA_FLOOR_HEIGHT,
    rot: 0,
    walkable: false,
  });

  // Solid under-deck flank colliders beneath descending ramp (prevents ground bots wedging under descending deck)
  const descUnderLen = 8.50 - dX0; // 5.05m
  const descUnderMidX = (dX0 + 8.50) / 2; // 5.975m
  for (const side of [-1, 1]) {
    const zFlank = cfg.descentZ + side * (dWidth / 2 + 0.10);
    colliders.push({
      id: `spiral_descent_under_flank_${side > 0 ? 'north' : 'south'}`,
      x: descUnderMidX,
      z: zFlank,
      hx: descUnderLen / 2,
      hz: 0.14,
      y: (ARENA_FLOOR_HEIGHT + 1.60) / 2,
      height: 1.60 - ARENA_FLOOR_HEIGHT,
      rot: 0,
      walkable: false,
    });
  }
}


// Build the Featured Parking-Garage Spiral Ramp
buildSpiralClimbingStructure();

// ---------------------------------------------------------------------------
// SECTION 4: Lane 2 Ground Technical Straight (Z = 6.75, X in [-17.5, 17.5])
// Features the Huge Polished Mega Speed Hump Gauntlet (3 colossal arched mounds)
// relocated from Lane 1 to Lane 2 after clearing Rock Field -> Hairpin 1.
// ---------------------------------------------------------------------------
function createExtrudedArchMesh(
  cx: number,
  zCenter: number,
  widthZ: number,
  xOffsetStart: number,
  xOffsetEnd: number,
  halfLen: number,
  height: number,
  yDeck: number,
  yBottomOffset: number,
  liftOffset: number,
  segments: number,
  mat: THREE.Material,
  solidToDeck = false,
) {
  const halfW = widthZ * 0.5;
  const z0 = zCenter - halfW;
  const z1 = zCenter + halfW;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= segments; s++) {
    const u = s / segments;
    const dx = xOffsetStart + (xOffsetEnd - xOffsetStart) * u;
    const xPos = cx + dx;
    const normD = Math.min(1, Math.abs(dx) / halfLen);
    const cosVal = Math.cos(normD * Math.PI * 0.5);
    const yTop = yDeck + height * cosVal * cosVal + liftOffset;
    const yBot = (liftOffset > 0 && !solidToDeck)
      ? Math.max(yDeck - 0.01, yTop - yBottomOffset)
      : yDeck - yBottomOffset;

    positions.push(xPos, yTop, z0); // 0: Top-North
    positions.push(xPos, yTop, z1); // 1: Top-South
    positions.push(xPos, yBot, z1); // 2: Bot-South
    positions.push(xPos, yBot, z0); // 3: Bot-North

    uvs.push(0, u * 3);
    uvs.push(1, u * 3);
    uvs.push(1, u * 3);
    uvs.push(0, u * 3);

    if (s < segments) {
      const b = s * 4;
      const n = (s + 1) * 4;
      indices.push(b, b + 1, n, b + 1, n + 1, n);         // Top (+Y)
      indices.push(b, n, b + 3, b + 3, n, n + 3);         // North (-Z)
      indices.push(b + 1, b + 2, n + 1, b + 2, n + 2, n + 1); // South (+Z)
    }
  }
  // Start (-X) & End (+X) caps
  indices.push(0, 3, 1, 1, 3, 2);
  const e = segments * 4;
  indices.push(e, e + 1, e + 3, e + 1, e + 2, e + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildMegaSpeedHumpGauntlet() {
  const sCfg = SPEED_BREAKER_CONFIG;
  const zL = sCfg.laneZ;
  const halfRoadW = DRIVE_ROUTE_WIDTH * 0.5;
  const innerWidthZ = DRIVE_ROUTE_WIDTH - 0.56; // Fits flush inside the 0.28m left/right parapets
  const deckY = GROUND_DECK_HEIGHT;
  const spanLen = sCfg.deckXMax - sCfg.deckXMin; // 13.00m course
  const spanMidX = (sCfg.deckXMax + sCfg.deckXMin) * 0.5;

  // 1. Precast Concrete Viaduct Foundation Pad & Threshold Expansion Plates (x in [-6.55, +6.45])
  box(course, mats.asphalt, V(spanMidX, deckY - 0.105, zL), V(spanLen, 0.22, DRIVE_ROUTE_WIDTH));
  // Subtle yellow lane center guide across the flat valley floor sections (suppressed under hump arches)
  for (const vx of [2.30, -2.30]) {
    box(course, mats.laneStripeYellow, V(vx, deckY + 0.015, zL), V(1.00, 0.005, 0.08), 0, false);
  }
  for (const xEdge of [sCfg.deckXMax - 0.22, sCfg.deckXMin + 0.22]) {
    box(course, mats.metal, V(xEdge, deckY + 0.004, zL), V(0.42, 0.010, innerWidthZ));
  }
  // Westbound entry warning stripe on East threshold ahead of Hump 0
  box(course, mats.laneStripeYellow, V(sCfg.deckXMax - 0.14, deckY + 0.011, zL), V(0.14, 0.006, innerWidthZ - 0.24), 0, false);

  // Heavy diamond-plate traction expansion trenches in the two valleys between humps
  for (const vx of [2.30, -2.30]) {
    box(course, mats.diamondPlate, V(vx, deckY + 0.006, zL), V(0.96, 0.012, innerWidthZ - 0.04));
    for (const edgeOffset of [-0.46, 0.46]) {
      box(course, mats.metal, V(vx + edgeOffset, deckY + 0.009, zL), V(0.08, 0.016, innerWidthZ));
    }
  }

  // 2. Three Colossal Molded Mega-Hump Arches (alternating Yellow / Carbon Rubber / Yellow)
  for (let i = 0; i < sCfg.centersX.length; i++) {
    const cx = sCfg.centersX[i];
    const primaryMat = i % 2 === 0 ? mats.yellow : mats.rubber;
    const ribMat = i % 2 === 0 ? mats.black : mats.yellow;

    // Smooth primary extruded arch matching exact cos^2 physics profile
    course.add(createExtrudedArchMesh(
      cx, zL, innerWidthZ,
      -sCfg.halfLength, sCfg.halfLength,
      sCfg.halfLength, sCfg.height, deckY, 0.03, 0.002, 56,
      primaryMat,
    ));

    // Five contoured contrasting heavy-duty traction tread ribs gripping across the arch dome
    for (const dRib of [-1.05, -0.52, 0.0, 0.52, 1.05]) {
      course.add(createExtrudedArchMesh(
        cx, zL, innerWidthZ - 0.26,
        dRib - 0.09, dRib + 0.09,
        sCfg.halfLength, sCfg.height, deckY, 0.025, 0.016, 6,
        ribMat,
      ));
    }

    // Cast-steel side anchoring cheek bolsters + chrome anchor bolts flush along both shoulders
    for (const side of [-1, 1]) {
      const zFlange = zL + side * (innerWidthZ * 0.5 - 0.065);
      course.add(createExtrudedArchMesh(
        cx, zFlange, 0.13,
        -sCfg.halfLength + 0.06, sCfg.halfLength - 0.06,
        sCfg.halfLength, sCfg.height, deckY, 0.04, 0.016, 32,
        mats.metal,
        true,
      ));
      for (const dBolt of [-0.90, -0.45, 0.0, 0.45, 0.90]) {
        const cB = Math.cos((Math.abs(dBolt) / sCfg.halfLength) * Math.PI * 0.5);
        const yBolt = deckY + sCfg.height * cB * cB + 0.020;
        cyl(course, mats.chrome, V(cx + dBolt, yBolt, zFlange), 0.026, 0.018, 'y', 10);
      }
    }

    colliders.push({
      id: `speed_breaker_${i}`,
      x: cx,
      z: zL,
      hx: sCfg.halfLength,
      hz: halfRoadW,
      y: deckY + sCfg.height * 0.5,
      height: sCfg.height,
      rot: 0,
      walkable: true,
    });
  }

  // 3. Flush Competition Boundary Edge Lines flanking the Mega Speed Hump Gauntlet (no barrier walls)
  for (const side of [-1, 1]) {
    const zLine = zL + side * (halfRoadW - 0.08);
    box(course, mats.yellow, V(spanMidX, deckY + 0.012, zLine), V(spanLen, 0.014, 0.14), 0, false);
    for (let bx of sCfg.centersX) {
      box(course, mats.fiaRed, V(bx, deckY + 0.014, zLine), V(1.60, 0.014, 0.16), 0, false);
    }
  }
}

buildMegaSpeedHumpGauntlet();

// ---------------------------------------------------------------------------
// SECTION 2B: Lane 2 High-Incline Zigzag Challenge Ramp (Z = 6.75, X in [8.70, 17.00])
// Towering +3.20m vertical climb (y: -0.33m -> +2.87m) where straight throttle stalls
// into continuous forward-spinning belt slip and slides down; diagonal zigzagging conquers it.
// ---------------------------------------------------------------------------
function buildHighClimbZigzagRamp() {
  const cfg = HIGH_CLIMB_CONFIG;
  const zL = cfg.laneZ;
  const halfW = cfg.deckWidth * 0.5; // 2.60m (5.20m wide bowl)
  const ascentLen = cfg.xEntryStart - cfg.xSummitEast; // 4.60m
  const plateauLen = cfg.xSummitEast - cfg.xSummitWest; // 0.75m
  const plateauMidX = (cfg.xSummitEast + cfg.xSummitWest) * 0.5;
  const descentLen = cfg.xSummitWest - cfg.xExitEnd; // 2.95m

  // 1. Entry & Exit flush shoulder aprons & boundary transition stripes bridging 4.40m road -> 5.20m bowl
  for (const [edgeX, sign] of [[cfg.xEntryStart, 1], [cfg.xExitEnd, -1]] as const) {
    box(course, mats.laneStripeYellow, V(edgeX - sign * 0.06, cfg.yGround + 0.010, zL), V(0.14, 0.006, DRIVE_ROUTE_WIDTH - 0.56), 0, false);
    for (const side of [-1, 1]) {
      const shoulderZ = zL + side * 2.34;
      box(course, mats.asphalt, V(edgeX + sign * 0.12, cfg.yGround - 0.11, shoulderZ), V(0.40, 0.22, 0.52));
      box(course, mats.fiaRed, V(edgeX, cfg.yGround + 0.012, zL + side * 2.28), V(0.14, 0.014, 0.56), 0, false);
    }
  }

  // 2. Slick Coated Ascent Climb Face, Summit Plateau & High-Traction Rubberized Descent
  const ascentEase = (t: number) => easeCushionedRamp(t, cfg.ascentEdgeFrac);
  const descentEase = (t: number) => easeCushionedRamp(t, cfg.descentEdgeFrac);

  curvedSlopedDeck(
    'high_climb_ascent_deck',
    cfg.xEntryStart,
    cfg.xSummitEast,
    zL,
    cfg.deckWidth,
    cfg.yGround,
    cfg.ySummit,
    0.26,
    mats.highClimbDeck,
    ascentEase,
    40,
  );

  // Flat summit observation landing plateau
  box(course, mats.asphalt, V(plateauMidX, cfg.ySummit - 0.13, zL), V(plateauLen + 0.06, 0.26, cfg.deckWidth));
  box(course, mats.laneStripeYellow, V(cfg.xSummitEast - 0.08, cfg.ySummit + 0.005, zL), V(0.14, 0.008, cfg.deckWidth - 0.60), 0, false);
  box(course, mats.curbWhite, V(cfg.xSummitWest + 0.08, cfg.ySummit + 0.005, zL), V(0.14, 0.008, cfg.deckWidth - 0.60), 0, false);

  curvedSlopedDeck(
    'high_climb_descent_deck',
    cfg.xExitEnd,
    cfg.xSummitWest,
    zL,
    cfg.deckWidth,
    cfg.yGround,
    cfg.ySummit,
    0.26,
    mats.rubber,
    descentEase,
    40,
  );

  // 3. Heavy Architectural Concrete Support Piers & Cross-Girders under Ascent, Summit & Descent
  for (const px of [14.70, 13.00, 12.28, 11.72, 10.15]) {
    const deckY = evaluateHighClimbHeight(px, zL) ?? cfg.yGround;
    const colTop = deckY - 0.24;
    const legH = colTop - ARENA_FLOOR_HEIGHT;
    if (legH < 0.25) continue;
    const beamW = cfg.deckWidth - 0.36;
    box(course, mats.concretePier, V(px, colTop - 0.14, zL), V(0.46, 0.28, beamW));
    for (const side of [-1, 1]) {
      const colZ = zL + side * (beamW * 0.5 - 0.38);
      cyl(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + legH * 0.5, colZ), 0.24, legH, 'y', 20);
      box(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + 0.18, colZ), V(0.76, 0.36, 0.76));
    }
    // Cross steel structural K-bracing for tall summit piers
    if (legH > 1.80) {
      box(course, mats.trussRed, V(px, ARENA_FLOOR_HEIGHT + legH * 0.52, zL), V(0.14, 0.14, beamW - 0.70));
    }
  }

  // Under-deck longitudinal steel support stringers spanning ascent & descent
  for (const side of [-1, 1]) {
    const strZ = zL + side * 1.45;
    box(course, mats.metal, V(14.70, (cfg.yGround + cfg.ySummit) * 0.5 - 0.28, strZ), V(ascentLen * 0.96, 0.16, 0.16), 0, false).rotation.z = -Math.atan2(cfg.ySummit - cfg.yGround, ascentLen);
    box(course, mats.metal, V(10.18, (cfg.yGround + cfg.ySummit) * 0.5 - 0.28, strZ), V(descentLen * 0.94, 0.16, 0.16), 0, false).rotation.z = Math.atan2(cfg.ySummit - cfg.yGround, descentLen);
  }

  // 4. Flush Slope-Following Competition Edge Boundary Lines + Summit Corner Hazard Flush Lights (ZERO wall blockers!)
  for (const side of [-1, 1]) {
    const zEdgeLine = zL + side * (halfW - 0.09);

    // Flush Ascent edge boundary stripe
    curvedSlopedDeck(
      `high_climb_edge_asc_${side}`,
      cfg.xEntryStart,
      cfg.xSummitEast,
      zEdgeLine,
      0.16,
      cfg.yGround + 0.014,
      cfg.ySummit + 0.014,
      0.014,
      mats.yellow,
      ascentEase,
      36,
    );

    // Summit flat edge line & flush amber marker beacon on outer flank
    box(course, mats.yellow, V(plateauMidX, cfg.ySummit + 0.012, zEdgeLine), V(plateauLen + 0.06, 0.014, 0.16), 0, false);
    const summitBeacon = new THREE.Group();
    summitBeacon.position.set(plateauMidX, cfg.ySummit + 0.08, zL + side * (halfW + 0.04));
    summitBeacon.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.10, 12), mats.beaconAmber));
    course.add(summitBeacon);
    hazardRevolvingBeacons.push(summitBeacon);

    // Flush Descent edge boundary stripe
    curvedSlopedDeck(
      `high_climb_edge_desc_${side}`,
      cfg.xExitEnd,
      cfg.xSummitWest,
      zEdgeLine,
      0.16,
      cfg.yGround + 0.014,
      cfg.ySummit + 0.014,
      0.014,
      mats.fiaRed,
      descentEase,
      36,
    );
  }
}

buildHighClimbZigzagRamp();

// ---------------------------------------------------------------------------
// SECTION 5A: Swinging Pendulum Gauntlet on Lane 4 (Z = -6.75, X in [3.8, 16.2])
// High-profile catwalk bridge (2.00m wide) with 3 counter-swinging balls with gaps at 2.25x bot length
// ---------------------------------------------------------------------------
const pCfg = PENDULUM_CONFIG;

// 1. Recessed Below-Grade Approach Abutments, Curved Ramps & Tapered Entry Wingwalls
curvedSlopedDeck('pendulum_ascent_ramp', pCfg.xEntryStart, pCfg.xRampUpEnd, pCfg.zLane, pCfg.deckWidth, GROUND_DECK_HEIGHT, pCfg.deckY, 0.12, mats.diamondPlate);
buildRampTrimAndFootings('pendulum_ascent', pCfg.xEntryStart, pCfg.xRampUpEnd, pCfg.zLane, pCfg.deckWidth, GROUND_DECK_HEIGHT, pCfg.deckY);
addTaperedFunnelCurbs('pendulum_entry_funnel', 17.20, 2.06, pCfg.xEntryStart, 1.20, pCfg.zLane, GROUND_DECK_HEIGHT);

// 2. Elevated Catwalk Bridge (x in [5.90, 14.10]): 2.00m wide deck over framed cutaway chasm, NO guardrails
const pDeckLen = pCfg.xRampUpEnd - pCfg.xRampDownStart; // 8.20m
const pDeckMidX = (pCfg.xRampUpEnd + pCfg.xRampDownStart) / 2; // 10.00m

// Cutaway chasm beneath the narrow bridge & ramps: framed recessed trench with concrete retaining curbs
const pChasmLen = pCfg.xEntryStart - pCfg.xExitEnd - 0.60; // 11.80m
const pChasmMidX = (pCfg.xEntryStart + pCfg.xExitEnd) * 0.5; // 10.00m
box(course, mats.black, V(pChasmMidX, ARENA_FLOOR_HEIGHT - 0.08, pCfg.zLane), V(pChasmLen, 0.12, 3.80));
box(course, mats.concretePier, V(pChasmMidX, ARENA_FLOOR_HEIGHT + 0.02, pCfg.zLane + 2.06), V(pChasmLen, 0.16, 0.28));
box(course, mats.concretePier, V(pChasmMidX, ARENA_FLOOR_HEIGHT + 0.02, pCfg.zLane - 2.06), V(pChasmLen, 0.16, 0.28));

// Elevated diamond-plate bridge catwalk deck
box(course, mats.diamondPlate, V(pDeckMidX, pCfg.deckY - 0.04, pCfg.zLane), V(pDeckLen, 0.08, pCfg.deckWidth));
box(course, mats.laneStripeYellow, V(pDeckMidX, pCfg.deckY + 0.006, pCfg.zLane), V(pDeckLen, 0.012, 0.065), 0, false);

// Twin longitudinal heavy steel I-beam side stringers supporting the catwalk bridge
for (const side of [-1, 1]) {
  const zBeam = pCfg.zLane + side * (pCfg.deckWidth / 2 - 0.05);
  box(course, mats.metal, V(pDeckMidX, pCfg.deckY - 0.12, zBeam), V(pDeckLen, 0.16, 0.085));
}

// Transverse steel cross-tie beams under the bridge deck
for (let cx = pCfg.xRampDownStart + 0.40; cx <= pCfg.xRampUpEnd - 0.30; cx += 0.80) {
  box(course, mats.metal, V(cx, pCfg.deckY - 0.14, pCfg.zLane), V(0.10, 0.10, pCfg.deckWidth + 0.06));
}

// Bare edge danger markings (high-contrast yellow caution stripes along the edge of the drop - NO guardrails!)
for (const side of [-1, 1]) {
  const zEdge = pCfg.zLane + side * (pCfg.deckWidth / 2 - 0.05);
  box(course, mats.yellow, V(pDeckMidX, pCfg.deckY + 0.006, zEdge), V(pDeckLen, 0.012, 0.075), 0, false);
}

// Solid under-deck pier flank colliders for catwalk bridge (low ground-height barrier only so upper deck stays 100% clear)
for (const side of [-1, 1]) {
  const zFlank = pCfg.zLane + side * (pCfg.deckWidth / 2 - 0.16);
  colliders.push({
    id: `catwalk_bridge_under_flank_${side > 0 ? 'north' : 'south'}`,
    x: pDeckMidX,
    z: zFlank,
    hx: pDeckLen / 2,
    hz: 0.14,
    y: ARENA_FLOOR_HEIGHT + 0.22,
    height: 0.44,
    rot: 0,
    walkable: false,
  });
}

// Heavy steel support piers underneath the bridge at ball locations (ground-height collider avoids snagging ramp approaches)
for (const px of pCfg.ballPositionsX) {
  cyl(course, mats.metal, V(px, (ARENA_FLOOR_HEIGHT + pCfg.deckY) / 2, pCfg.zLane), 0.12, pCfg.deckY - ARENA_FLOOR_HEIGHT, 'y');
  box(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + 0.08, pCfg.zLane), V(0.50, 0.16, 0.50));
  colliders.push({
    id: `catwalk_bridge_under_pier_${px}`,
    x: px,
    z: pCfg.zLane,
    hx: 0.28,
    hz: 0.28,
    y: ARENA_FLOOR_HEIGHT + 0.24,
    height: 0.48,
    rot: 0,
    walkable: false,
  });
}

// 3. Descent Ramp (x in [3.8, 5.9]): Westbound vehicle descends smoothly from 1.35m to ground -0.33m
curvedSlopedDeck('pendulum_descent_ramp', pCfg.xRampDownStart, pCfg.xExitEnd, pCfg.zLane, pCfg.deckWidth, pCfg.deckY, GROUND_DECK_HEIGHT, 0.12, mats.diamondPlate);
buildRampTrimAndFootings('pendulum_descent', pCfg.xExitEnd, pCfg.xRampDownStart, pCfg.zLane, pCfg.deckWidth, GROUND_DECK_HEIGHT, pCfg.deckY);
addBridgePortalHeadwalls('pendulum_exit', pCfg.xExitEnd, 1.12, 2.06, pCfg.zLane, GROUND_DECK_HEIGHT);

// 5. Overhead Heavy Industrial Steel Gantry Frame (y = 4.45m)
const gantryStrobes: THREE.Mesh[] = [];
const gantryZNorth = pCfg.zLane + 2.30;
const gantryZSouth = pCfg.zLane - 2.30;
const gantryXWest = 5.20;
const gantryXEast = 14.80;
const gantryTopY = 4.45;

// 4 Main Vertical Steel Support Pylons
for (const gx of [gantryXWest, gantryXEast]) {
  for (const gz of [gantryZSouth, gantryZNorth]) {
    cyl(course, mats.metal, V(gx, ARENA_FLOOR_HEIGHT + (gantryTopY - ARENA_FLOOR_HEIGHT) / 2, gz), 0.14, gantryTopY - ARENA_FLOOR_HEIGHT, 'y');
    box(course, mats.concretePier, V(gx, ARENA_FLOOR_HEIGHT + 0.35, gz), V(0.60, 0.70, 0.60));
    box(course, mats.yellow, V(gx, ARENA_FLOOR_HEIGHT + 0.72, gz), V(0.50, 0.04, 0.50), 0, false);

    // Flashing amber caution strobe beacon atop each pylon
    const strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12), mats.beaconAmber);
    strobe.position.set(gx, gantryTopY + 0.10, gz);
    course.add(strobe);
    gantryStrobes.push(strobe);

    // Solid obstacle collider for gantry support legs
    colliders.push({
      id: `pendulum_pylon_${gx > 10 ? 'east' : 'west'}_${gz > pCfg.zLane ? 'north' : 'south'}`,
      x: gx,
      z: gz,
      hx: 0.35,
      hz: 0.35,
      y: ARENA_FLOOR_HEIGHT + (gantryTopY - ARENA_FLOOR_HEIGHT) / 2,
      height: gantryTopY - ARENA_FLOOR_HEIGHT,
      rot: 0,
      walkable: false,
    });
  }
}

// Longitudinal overhead box girders
box(course, mats.charcoal, V(pDeckMidX, gantryTopY, gantryZNorth), V(gantryXEast - gantryXWest + 0.6, 0.20, 0.20));
box(course, mats.charcoal, V(pDeckMidX, gantryTopY, gantryZSouth), V(gantryXEast - gantryXWest + 0.6, 0.20, 0.20));

// Transverse overhead bridge beams spanning above each swinging pendulum
for (const bx of pCfg.ballPositionsX) {
  box(course, mats.charcoal, V(bx, gantryTopY, pCfg.zLane), V(0.24, 0.20, gantryZNorth - gantryZSouth));
  // Industrial pillow block bearing housing at pivot
  box(course, mats.metal, V(bx, pCfg.ballPivotY, pCfg.zLane), V(0.28, 0.16, 0.28));
}

// 6. 3 Dynamic Swinging Pendulum Assemblies
interface SwingingPendulum {
  x: number;
  zCenter: number;
  pivotY: number;
  armLength: number;
  ballRadius: number;
  omega: number;
  amplitude: number;
  phase: number;
  armGroup: THREE.Group;
  ballMesh: THREE.Mesh;
}

const swingingPendulums: SwingingPendulum[] = [];

for (let i = 0; i < pCfg.ballPositionsX.length; i++) {
  const bx = pCfg.ballPositionsX[i];
  const phase = pCfg.phaseOffsets[i];

  const armGroup = new THREE.Group();
  armGroup.position.set(bx, pCfg.ballPivotY, pCfg.zLane);
  course.add(armGroup);

  // Pivot axle pin
  cyl(armGroup, mats.metal, V(0, 0, 0), 0.07, 0.36, 'x');

  // Heavy steel suspension arm (rod/chain)
  cyl(armGroup, mats.metal, V(0, -pCfg.ballArmLength / 2, 0), 0.035, pCfg.ballArmLength, 'y');

  // Completely pure spherical metallic wrecking ball (no rectangular plates or equatorial ribs)
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(pCfg.ballRadius, 32, 32), mats.metal);
  ballMesh.position.set(0, -pCfg.ballArmLength, 0);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  armGroup.add(ballMesh);

  // Heavy top forged steel shackle & clevis pin
  cyl(ballMesh, mats.chrome, V(0, pCfg.ballRadius + 0.08, 0), 0.05, 0.16, 'x');

  swingingPendulums.push({
    x: bx,
    zCenter: pCfg.zLane,
    pivotY: pCfg.ballPivotY,
    armLength: pCfg.ballArmLength,
    ballRadius: pCfg.ballRadius,
    omega: pCfg.swingOmega,
    amplitude: pCfg.swingAmplitude,
    phase,
    armGroup,
    ballMesh,
  });
}

// ---------------------------------------------------------------------------
// CHECKPOINT 7: Motorized Industrial Turntable on Spiral Rooftop Deck (y = 1.45m)
// ---------------------------------------------------------------------------
const ttY = SPIRAL_CONFIG.yTop; // 1.45m (Summit Rooftop Observation Deck)

// 1. Monolithic Stationary Steel Pit Basin & Mounting Collar (Recessed into Rooftop Deck)
// Heavy reinforced concrete pit foundation pad supporting the widened 4.90m turntable
box(course, mats.concretePier, V(TURNTABLE_CENTER.x, ttY - 0.10, TURNTABLE_CENTER.z), V(5.6, 0.20, 5.6));
// Outer machined steel coaming flange ring (outer rim diameter 5.24m, R = 2.62m)
cyl(course, mats.metal, V(TURNTABLE_CENTER.x, ttY + 0.018, TURNTABLE_CENTER.z), 2.62, 0.055, 'y', 64);
// Inner roller-bearing raceway ring
cyl(course, mats.black, V(TURNTABLE_CENTER.x, ttY + 0.012, TURNTABLE_CENTER.z), 2.52, 0.048, 'y', 64);
// Beveled hazard transition rim
cyl(course, mats.yellow, V(TURNTABLE_CENTER.x, ttY + 0.022, TURNTABLE_CENTER.z), 2.68, 0.018, 'y', 64);

// 32 Precision Chrome Roller Bearings seated inside the perimeter raceway trough
const racewayBallGeo = new THREE.SphereGeometry(0.045, 12, 12);
for (let b = 0; b < 32; b++) {
  const theta = (b * Math.PI * 2) / 32;
  const bx = TURNTABLE_CENTER.x + 2.52 * Math.cos(theta);
  const bz = TURNTABLE_CENTER.z + 2.52 * Math.sin(theta);
  const ballMesh = new THREE.Mesh(racewayBallGeo, mats.chrome);
  ballMesh.position.set(bx, ttY + 0.032, bz);
  ballMesh.castShadow = true;
  course.add(ballMesh);
}

// Perimeter 32 alternating yellow and black hazard marking segments on pit rim
for (let h = 0; h < 32; h++) {
  const theta = (h * Math.PI * 2) / 32;
  const hx = TURNTABLE_CENTER.x + 2.65 * Math.cos(theta);
  const hz = TURNTABLE_CENTER.z + 2.65 * Math.sin(theta);
  box(course, h % 2 === 0 ? mats.yellow : mats.black, V(hx, ttY + 0.035, hz), V(0.18, 0.012, 0.48), theta, false);
}

// Heavy electric motor drive pod mounted on stationary coaming (north rim, safely clear of roadway)
box(course, mats.charcoal, V(TURNTABLE_CENTER.x, ttY + 0.22, TURNTABLE_CENTER.z + 2.65), V(0.55, 0.44, 0.45));
cyl(course, mats.metal, V(TURNTABLE_CENTER.x, ttY + 0.12, TURNTABLE_CENTER.z + 2.42), 0.16, 0.18, 'y', 16);
box(course, mats.yellow, V(TURNTABLE_CENTER.x, ttY + 0.46, TURNTABLE_CENTER.z + 2.65), V(0.40, 0.04, 0.35), 0, false);

// 2. Rotating Turntable Platter (inside discGroup)
const discGroup = new THREE.Group();
discGroup.position.set(TURNTABLE_CENTER.x, ttY + 0.025, TURNTABLE_CENTER.z);
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

// 3. Heavy Industrial Center Bearing Spindle Hub (sleek low-profile flush bearing plate)
cyl(discGroup, mats.metal, V(0, 0.024, 0), 0.55, 0.016, 'y', 36);
cyl(discGroup, mats.chrome, V(0, 0.032, 0), 0.38, 0.014, 'y', 32);
cyl(discGroup, mats.wheel, V(0, 0.039, 0), 0.24, 0.012, 'y', 24);
// 16 Chrome hex bolts in bolt circle (R = 0.44m)
for (let b = 0; b < 16; b++) {
  const bt = b * Math.PI / 8;
  cyl(discGroup, mats.metal, V(Math.sin(bt) * 0.44, 0.035, Math.cos(bt) * 0.44), 0.026, 0.014, 'y', 8);
}
// Central rotary slip-ring beacon housing (sleek low profile, flush with deck)
cyl(discGroup, mats.metal, V(0, 0.046, 0), 0.12, 0.016, 'y', 16);
const discCenterBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 16), mats.beaconAmber);
discCenterBeacon.position.set(0, 0.058, 0);
discGroup.add(discCenterBeacon);

// 8 Embedded rotating amber navigation markers at platter perimeter (R = 2.32m)
for (let m = 0; m < 8; m++) {
  const mt = m * Math.PI / 4;
  cyl(discGroup, mats.beaconAmber, V(Math.sin(mt) * 2.32, 0.048, Math.cos(mt) * 2.32), 0.055, 0.022, 'y', 12);
}

// 4. Heavy Structural Pier Bent Anchored to Arena Floor
const discLegHeight = ttY - ARENA_FLOOR_HEIGHT;
// Massive central reinforced concrete support column
cyl(course, mats.concretePier, V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + discLegHeight / 2, TURNTABLE_CENTER.z), 0.75, discLegHeight, 'y', 32);
// Octagonal footing base pad on arena floor
box(course, mats.concretePier, V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + 0.25, TURNTABLE_CENTER.z), V(2.2, 0.5, 2.2));
// 4 Diagonal structural steel outrigger cantilever struts supporting outer pit rim
for (let o = 0; o < 4; o++) {
  const oAngle = o * Math.PI / 2 + Math.PI / 4;
  const oRimX = TURNTABLE_CENTER.x + 2.30 * Math.cos(oAngle);
  const oRimZ = TURNTABLE_CENTER.z + 2.30 * Math.sin(oAngle);
  tubeBetween(V(TURNTABLE_CENTER.x, ARENA_FLOOR_HEIGHT + 0.40, TURNTABLE_CENTER.z), V(oRimX, ttY - 0.08, oRimZ), 0.10, mats.metal);
}

// Solid non-walkable colliders for Turntable structural column and base footing pad
// Vertical envelope: arena floor (-0.33m) to y = 1.57m (height = 1.90m)
// Solid barrier against ground vehicles on Lane 3, while leaving a 1.63m clear air gap below summit deck (3.20m)
const pierColHeight = 1.90;
colliders.push({
  id: 'turntable_pier_footing',
  x: TURNTABLE_CENTER.x,
  z: TURNTABLE_CENTER.z,
  hx: 1.15,
  hz: 1.15,
  y: ARENA_FLOOR_HEIGHT + 0.25,
  height: 0.50,
  rot: 0,
  walkable: false,
});
colliders.push({
  id: 'turntable_pier_footing_diag',
  x: TURNTABLE_CENTER.x,
  z: TURNTABLE_CENTER.z,
  hx: 1.15,
  hz: 1.15,
  y: ARENA_FLOOR_HEIGHT + 0.25,
  height: 0.50,
  rot: Math.PI / 4,
  walkable: false,
});
colliders.push({
  id: 'turntable_pier_column',
  x: TURNTABLE_CENTER.x,
  z: TURNTABLE_CENTER.z,
  hx: 0.82,
  hz: 0.82,
  y: ARENA_FLOOR_HEIGHT + pierColHeight / 2,
  height: pierColHeight,
  rot: 0,
  walkable: false,
});
colliders.push({
  id: 'turntable_pier_column_oct45',
  x: TURNTABLE_CENTER.x,
  z: TURNTABLE_CENTER.z,
  hx: 0.82,
  hz: 0.82,
  y: ARENA_FLOOR_HEIGHT + pierColHeight / 2,
  height: pierColHeight,
  rot: Math.PI / 4,
  walkable: false,
});

// 5. Flush Painted Boundary Edge Lines on Elevated Turntable Rooftop Deck (no blocking side parapets)
box(course, mats.yellow, V(TURNTABLE_CENTER.x, ttY + 0.012, TURNTABLE_CENTER.z + 2.68), V(5.20, 0.014, 0.16), 0, false);
box(course, mats.yellow, V(TURNTABLE_CENTER.x, ttY + 0.012, TURNTABLE_CENTER.z - 2.68), V(5.20, 0.014, 0.16), 0, false);
for (const side of [-1, 1]) {
  const zRet = side * 1.95;
  box(course, mats.fiaRed, V(-1.55, ttY + 0.012, zRet), V(0.16, 0.014, 1.40), 0, false);
  box(course, mats.fiaRed, V(3.55, ttY + 0.012, zRet), V(0.16, 0.014, 1.40), 0, false);
}

// 4D Animated Directional Chasing Chevron Signs along Hairpin Curves
const chevronSignArrows: THREE.Mesh[] = [];

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

// SECTION 3: Natural Boulder Quarry Bed & Rock Field on Lane 1 (Z = 13.50, X in [6.0, 14.5])
const rockPlatDeckY = GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL; // -0.33 + 0.45 = 0.12m

// Monolithic reinforced concrete foundation deck carrying the rock platform above arena floor
box(course, mats.concretePier, V(10.25, rockPlatDeckY - 0.11, 13.50), V(8.50, 0.22, DRIVE_ROUTE_WIDTH));
colliders.push({
  id: 'rock_platform_deck',
  x: 10.25,
  z: 13.50,
  hx: 4.25,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: rockPlatDeckY,
  height: 0.22,
  rot: 0,
  walkable: true,
});

// Monolithic dark crushed aggregate bed eliminating harsh seam cuts and covering asphalt completely
box(course, mats.gravelBed, V(10.25, rockPlatDeckY + 0.025, 13.50), V(8.40, 0.045, DRIVE_ROUTE_WIDTH - 0.15));

// Smooth bevelled crushed stone lead-in and exit ramps
slopedDeck('rock_bed_entrance_ramp', 5.80, 6.40, 13.50, DRIVE_ROUTE_WIDTH - 0.20, GROUND_DECK_HEIGHT, rockPlatDeckY + 0.035, 0.06, mats.gravelBed);
slopedDeck('rock_bed_exit_ramp', 14.20, 14.80, 13.50, DRIVE_ROUTE_WIDTH - 0.20, rockPlatDeckY + 0.035, GROUND_DECK_HEIGHT, 0.06, mats.gravelBed);

// Flush weathered granite & yellow competition boundary stripes along Rock Field platform shoulders (no wall blockers)
const rockCurbMidX = 10.30;
const rockCurbLen = 9.00;
for (const side of [-1, 1]) {
  const zLine = 13.50 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10);
  box(course, mats.yellow, V(rockCurbMidX, rockPlatDeckY + 0.015, zLine), V(rockCurbLen, 0.014, 0.16), 0, false);
}

// Concrete pier bents supporting the rock field viaduct platform above arena floor
const rockPierH = Math.max(0.20, (rockPlatDeckY - 0.22) - ARENA_FLOOR_HEIGHT);
for (const px of [7.5, 10.25, 13.0]) {
  box(course, mats.concretePier, V(px, rockPlatDeckY - 0.22 - 0.12, 13.50), V(0.44, 0.24, DRIVE_ROUTE_WIDTH - 0.4));
  for (const side of [-1, 1]) {
    const colZ = 13.50 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.85);
    cyl(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + rockPierH / 2, colZ), 0.22, rockPierH, 'y', 20);
    box(course, mats.concretePier, V(px, ARENA_FLOOR_HEIGHT + 0.18, colZ), V(0.72, 0.36, 0.72));
  }
}

// 140 Realistic Sculpted Natural Boulders Distributed across the FULL Usable Road Width (z in [11.5, 15.5])
// Eliminates empty side strips and establishes genuine uneven terrain across the entire road envelope
for (let i = 0; i < ROCK_FIELD_STONES.length; i++) {
  const rk = ROCK_FIELD_STONES[i];
  const geo = rockGeos[i % rockGeos.length];
  const mat = rockMats[i % rockMats.length];
  const rockMesh = new THREE.Mesh(geo, mat);
  rockMesh.position.set(rk.x, rk.y + rockPlatDeckY + 0.02, rk.z);
  rockMesh.scale.set(rk.scaleX, rk.scaleY, rk.scaleZ);
  rockMesh.rotation.set(rk.rotX, rk.rotY, rk.rotZ);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  course.add(rockMesh);
}

// 120 Scattered Scree Pebbles & Gravel Clusters across the full road width
const screeRng = createDeterministicRNG(4321);
for (let i = 0; i < 120; i++) {
  const sx = 6.2 + screeRng() * 8.1;
  const sz = 11.50 + screeRng() * 4.0;
  const sSize = 0.025 + screeRng() * 0.038;
  const sMesh = new THREE.Mesh(screeGeo, i % 2 === 0 ? mats.granite : mats.basalt);
  sMesh.position.set(sx, rockPlatDeckY + 0.038 + sSize * 0.4, sz);
  sMesh.scale.set(sSize, sSize * 0.65, sSize);
  sMesh.rotation.set(screeRng() * Math.PI, screeRng() * Math.PI, 0);
  sMesh.castShadow = true;
  course.add(sMesh);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SECTION 6 & 7: MANDATORY FINAL GAUNTLET ON LANE 5 (Z = -13.50)
// STRICT SEQUENCE: FIRE PLATFORM -> HEAT-SHIELD BRIDGE -> DEEP WATER BASIN -> FINISH
// ---------------------------------------------------------------------------

// A. ELEVATED REFRACTORY FIRE HAZARD PLATFORM (X in [-5.0, -1.0], Z = -13.50, y = 0.05m)
const fireLaneZ = -13.50;
const firePlatLen = 4.00;
const firePlatMidX = -3.00;
const firePlatElevY = 0.05; // +0.38m above ground floor (-0.33m)

// Lead-in approach ramp from ground grade (-0.33m) up to fire platform (0.05m)
slopedDeck('fire_leadin_ramp', -5.80, -5.00, fireLaneZ, DRIVE_ROUTE_WIDTH - 0.20, ARENA_FLOOR_HEIGHT, firePlatElevY, 0.12, mats.diamondPlate);

// Primary reinforced concrete deck slab
box(course, mats.concretePier, V(firePlatMidX, firePlatElevY - 0.06, fireLaneZ), V(firePlatLen, 0.12, DRIVE_ROUTE_WIDTH));
box(course, mats.black, V(firePlatMidX, firePlatElevY + 0.015, fireLaneZ), V(firePlatLen - 0.05, 0.03, DRIVE_ROUTE_WIDTH - 0.28));

colliders.push({
  id: 'elevated_fire_platform',
  x: firePlatMidX,
  z: fireLaneZ,
  hx: firePlatLen / 2,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: firePlatElevY,
  height: 0.18,
  rot: 0,
  walkable: true,
});

// Concrete pier bents supporting fire platform above arena floor
const firePierH = firePlatElevY - ARENA_FLOOR_HEIGHT;
for (const fx of [-4.5, -3.0, -1.5]) {
  for (const side of [-1, 1]) {
    cyl(course, mats.concretePier, V(fx, ARENA_FLOOR_HEIGHT + firePierH / 2, fireLaneZ + side * (DRIVE_ROUTE_WIDTH / 2 - 0.55)), 0.22, firePierH, 'y', 20);
  }
}

// Incandescent Magma Fissure Underbed
box(course, mats.magmaBed, V(firePlatMidX, firePlatElevY + 0.022, fireLaneZ), V(firePlatLen - 0.10, 0.018, DRIVE_ROUTE_WIDTH - 0.36), 0, false);

// Flush yellow/orange boundary caution stripes along both fire hearth shoulders (no barrier walls)
for (const side of [-1, 1]) {
  const zCurb = fireLaneZ + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10);
  box(course, mats.yellow, V(firePlatMidX, firePlatElevY + 0.018, zCurb), V(firePlatLen, 0.014, 0.16), 0, false);
  slopedDeck(`fire_leadin_curb_${side}`, -5.80, -5.00, zCurb, 0.16, ARENA_FLOOR_HEIGHT + 0.014, firePlatElevY + 0.014, 0.014, mats.yellow);
}

// 36 Sculpted Basalt Charcoal Rocks with Glowing Lava Fissures
const charRNG = createDeterministicRNG(1984);
for (let c = 0; c < 36; c++) {
  const cx = -4.85 + charRNG() * 3.70;
  const cz = fireLaneZ + (charRNG() - 0.5) * (DRIVE_ROUTE_WIDTH - 0.85);
  const cr = 0.09 + charRNG() * 0.11;
  const rock = new THREE.Mesh(basaltGeo, mats.charcoal);
  rock.position.set(cx, firePlatElevY + 0.03 + cr * 0.45, cz);
  rock.scale.set(cr * (1.1 + charRNG() * 0.5), cr * (0.6 + charRNG() * 0.4), cr * (1.1 + charRNG() * 0.5));
  rock.rotation.set(charRNG() * Math.PI, charRNG() * Math.PI, charRNG() * Math.PI);
  rock.castShadow = true;
  course.add(rock);
}

// Ultra-Realistic Additive Curved Flame Tongues
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
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
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
  const fx = -4.85 + charRNG() * 3.70;
  const fz = fireLaneZ + (charRNG() - 0.5) * (DRIVE_ROUTE_WIDTH - 0.95);
  const flameMesh = new THREE.Mesh(flameGeom, mats.flameTongue);
  flameMesh.position.set(fx, firePlatElevY + 0.08, fz);
  const sY = 0.85 + charRNG() * 0.55;
  const sXZ = 0.80 + charRNG() * 0.45;
  flameMesh.scale.set(sXZ, sY, sXZ);
  flameMesh.rotation.y = charRNG() * Math.PI * 2;
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
  const baseX = -4.85 + charRNG() * 3.70;
  const baseZ = fireLaneZ + (charRNG() - 0.5) * (DRIVE_ROUTE_WIDTH - 1.1);
  const ember: FireEmber = {
    mesh,
    baseX,
    baseZ,
    y: firePlatElevY + 0.12 + charRNG() * 1.8,
    vy: 1.4 + charRNG() * 1.8,
    omega: 3.5 + charRNG() * 4.5,
    swirlRadius: 0.06 + charRNG() * 0.22,
    phase: charRNG() * Math.PI * 2,
  };
  mesh.position.set(baseX, ember.y, baseZ);
  course.add(mesh);
  fireEmbers.push(ember);
}

// Dual Chaotic Dynamic Firelights on Lane 5
const fireLightCore = new THREE.PointLight('#ff7700', 18, 8.5, 1.4);
fireLightCore.position.set(-3.00, firePlatElevY + 1.1, fireLaneZ);
scene.add(fireLightCore);

const fireLightFlicker = new THREE.PointLight('#ff2200', 12, 6.5, 1.6);
fireLightFlicker.position.set(-3.00, firePlatElevY + 1.5, fireLaneZ);
scene.add(fireLightFlicker);

// Dynamic billowing smoke particles on Lane 5
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
  smoke.position.set(-4.85 + i * 0.30, firePlatElevY + 0.95 + (i % 3) * 0.14, fireLaneZ + ((i % 4) - 1.5) * 0.65);
  smoke.scale.set(0.65, 1.05, 1);
  course.add(smoke);
  fireSmoke.push(smoke);
}

// B. HEAT-SHIELD COOLING BRIDGE (Lane 5, Z = -13.50, X in [-1.0, 0.5], y = 0.05m)
box(course, mats.concretePier, V(-0.25, firePlatElevY - 0.06, fireLaneZ), V(1.50, 0.12, DRIVE_ROUTE_WIDTH));
box(course, mats.diamondPlate, V(-0.25, firePlatElevY + 0.015, fireLaneZ), V(1.50, 0.03, DRIVE_ROUTE_WIDTH - 0.24));
colliders.push({
  id: 'cooling_transition_deck',
  x: -0.25,
  z: fireLaneZ,
  hx: 0.75,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: firePlatElevY,
  height: 0.18,
  rot: 0,
  walkable: true,
});
for (const side of [-1, 1]) {
  const zCurb = fireLaneZ + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10);
  box(course, mats.yellow, V(-0.25, firePlatElevY + 0.018, zCurb), V(1.50, 0.014, 0.16), 0, false);
}

// C. DEEP WATER BASIN WITH ARCHIMEDES BUOYANCY (Lane 5, Z = -13.50, X in [0.5, 9.5])
const waterBedY = -0.30;
const waterSurfaceY = 0.16; // 0.46m water depth
const waterTankWallH = 0.72; // Rises to y = 0.42m
const waterLen = 9.0;
const waterMidX = 5.0;

// Concrete foundation pad beneath the basin
box(course, mats.concretePier, V(waterMidX, ARENA_FLOOR_HEIGHT - 0.05, fireLaneZ), V(waterLen + 0.2, 0.12, DRIVE_ROUTE_WIDTH + 0.20));

// Flush stainless basin edge trim & boundary warning lines (ZERO blocking wall colliders)
for (const side of [-1, 1]) {
  const zWall = fireLaneZ + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10);
  box(course, mats.yellow, V(waterMidX, waterSurfaceY + 0.010, zWall), V(waterLen + 0.1, 0.016, 0.18), 0, false);
}

// Entry Ramp (x in [0.5, 2.0], slopes from y = 0.05m down to waterBedY = -0.30m)
slopedDeck('water_pool_entry_ramp', 0.5, 2.0, fireLaneZ, DRIVE_ROUTE_WIDTH - 0.28, 0.05, -0.30, 0.14, mats.diamondPlate);
colliders.push({
  id: 'water_pool_entry_ramp',
  x: 1.25,
  z: fireLaneZ,
  hx: 0.75,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: (0.05 + waterBedY) / 2,
  height: 0.05 - waterBedY + 0.14,
  rot: 0,
  walkable: true,
});

// Deep Central Pool Floor (x in [2.0, 8.0], y = -0.30m, length 6.0m)
box(course, mats.metal, V(5.0, waterBedY - 0.04, fireLaneZ), V(6.05, 0.08, DRIVE_ROUTE_WIDTH - 0.28));
box(course, mats.diamondPlate, V(5.0, waterBedY + 0.01, fireLaneZ - 0.79), V(6.0, 0.02, 0.50), 0, false);
box(course, mats.diamondPlate, V(5.0, waterBedY + 0.01, fireLaneZ + 0.79), V(6.0, 0.02, 0.50), 0, false);
for (let gx = 2.4; gx <= 7.6; gx += 0.50) {
  box(course, mats.metal, V(gx, waterBedY + 0.015, fireLaneZ), V(0.04, 0.012, DRIVE_ROUTE_WIDTH - 0.48), 0, false);
}
colliders.push({
  id: 'water_pool_deep_bed',
  x: 5.0,
  z: fireLaneZ,
  hx: 3.0,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: waterBedY,
  height: 0.14,
  rot: 0,
  walkable: true,
});

// Exit Climb Ramp (x in [8.0, 9.5], slopes from waterBedY = -0.30m up to ARENA_FLOOR_HEIGHT = -0.33m)
slopedDeck('water_pool_exit_ramp', 8.0, 9.5, fireLaneZ, DRIVE_ROUTE_WIDTH - 0.28, -0.30, ARENA_FLOOR_HEIGHT, 0.16, mats.diamondPlate);
colliders.push({
  id: 'water_pool_exit_ramp',
  x: 8.75,
  z: fireLaneZ,
  hx: 0.75,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: (ARENA_FLOOR_HEIGHT + waterBedY) / 2,
  height: 0.20,
  rot: 0,
  walkable: true,
});

// Ultra-Realistic 3D Water Volume & Surface (Tranquil Mirror Surface)
const hazardWaterGeom = new THREE.PlaneGeometry(8.95, DRIVE_ROUTE_WIDTH - 0.28, 24, 16);
const hazardWaterMesh = new THREE.Mesh(hazardWaterGeom, mats.water);
hazardWaterMesh.rotation.x = -Math.PI / 2;
hazardWaterMesh.position.set(5.0, waterSurfaceY, fireLaneZ);
hazardWaterMesh.receiveShadow = true;
course.add(hazardWaterMesh);

// Shoreline froth & meniscus strips
for (const side of [-1, 1]) {
  box(course, mats.waterFoam, V(5.0, waterSurfaceY + 0.005, fireLaneZ + side * (DRIVE_ROUTE_WIDTH / 2 - 0.22)), V(8.9, 0.015, 0.12), 0, false);
}
box(course, mats.waterFoam, V(0.54, waterSurfaceY + 0.005, fireLaneZ), V(0.08, 0.015, DRIVE_ROUTE_WIDTH - 0.36), 0, false);
box(course, mats.waterFoam, V(9.46, waterSurfaceY + 0.005, fireLaneZ), V(0.08, 0.015, DRIVE_ROUTE_WIDTH - 0.36), 0, false);

// Water splash pool
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
for (let i = 0; i < 8; i++) {
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.30, 28), new THREE.MeshBasicMaterial({ color: '#8dd9e8', transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(2.0 + i * 0.85, waterSurfaceY + 0.008, fireLaneZ + (i % 2 ? 0.9 : -0.9));
  course.add(ripple);
  hazardWaterRipples.push(ripple);
}

// SECTION 8: Slippery Polished Steel Sheet Hazard on Lane 2 (Z = 6.75, X in [-14.0, -9.5])
// ---------------------------------------------------------------------------
box(course, mats.concretePier, V(-11.75, ROUTE_DECK_HEIGHT - 0.08, 6.75), V(4.5, 0.18, DRIVE_ROUTE_WIDTH));
box(course, mats.ice, V(-11.75, ROUTE_DECK_HEIGHT + 0.025, 6.75), V(4.45, 0.02, DRIVE_ROUTE_WIDTH - 0.20), 0, false);
for (const edgeX of [-13.92, -9.58]) {
  box(course, mats.yellow, V(edgeX, ROUTE_DECK_HEIGHT + 0.036, 6.75), V(0.12, 0.008, DRIVE_ROUTE_WIDTH - 0.36), 0, false);
}
colliders.push({
  id: 'slippery_steel_sheet',
  x: -11.75,
  z: 6.75,
  hx: 2.25,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: ROUTE_DECK_HEIGHT,
  height: 0.18,
  rot: 0,
  walkable: true,
});

// ---------------------------------------------------------------------------
// SECTION 8: High-Gloss Iridescent Oil Spill Hazard Zone on Lane 3 (Z = 0.00, X in [-12.0, -8.0])
// Clearly demarcated petroleum spill containment bay with caution borders & roadside oil drums
// ---------------------------------------------------------------------------
box(course, mats.concretePier, V(-10.0, ROUTE_DECK_HEIGHT - 0.08, 0.00), V(4.0, 0.18, DRIVE_ROUTE_WIDTH));
box(course, mats.oil, V(-10.0, ROUTE_DECK_HEIGHT + 0.038, 0.00), V(3.96, 0.02, DRIVE_ROUTE_WIDTH - 0.24), 0, false);
for (const edgeX of [-11.94, -8.06]) {
  for (let stripe = -3; stripe <= 3; stripe++) {
    const sMat = (stripe + 3) % 2 === 0 ? mats.yellow : mats.black;
    box(course, sMat, V(edgeX, ROUTE_DECK_HEIGHT + 0.049, stripe * 0.52), V(0.12, 0.006, 0.50), 0, false);
  }
}
for (const side of [-1, 1]) {
  // Galvanized steel spill-tray containment lips inside lane edges
  box(course, mats.metal, V(-10.0, ROUTE_DECK_HEIGHT + 0.052, side * (DRIVE_ROUTE_WIDTH * 0.5 - 0.16)), V(3.98, 0.024, 0.08), 0, false);
  // Roadside leaking oil drum assemblies placed outside parapets (never obstruct road clearance)
  const drumZ = side * (DRIVE_ROUTE_WIDTH * 0.5 + 0.48);
  const drumX = side > 0 ? -11.1 : -8.9;
  const drumMat = side > 0 ? mats.orange : mats.yellow;
  cyl(course, drumMat, V(drumX, ROUTE_DECK_HEIGHT + 0.34, drumZ), 0.22, 0.66, 'y', 16);
  cyl(course, mats.black, V(drumX, ROUTE_DECK_HEIGHT + 0.34, drumZ), 0.23, 0.05, 'y', 16);
  cyl(course, mats.metal, V(drumX, ROUTE_DECK_HEIGHT + 0.67, drumZ), 0.22, 0.02, 'y', 16);
  // Secondary tipped spill barrel beside curb
  const tipX = drumX + (side > 0 ? 0.62 : -0.62);
  cyl(course, mats.black, V(tipX, ROUTE_DECK_HEIGHT + 0.20, drumZ + side * 0.05), 0.19, 0.54, 'z', 14);
}
colliders.push({
  id: 'oil_skid_pad',
  x: -10.0,
  z: 0.00,
  hx: 2.0,
  hz: DRIVE_ROUTE_WIDTH / 2,
  y: ROUTE_DECK_HEIGHT,
  height: 0.18,
  rot: 0,
  walkable: true,
});

// ---------------------------------------------------------------------------
// SECTION 5B: Spread Twin Hanging Bridges (2x Wheel Width) Over Sunken Sand Pit
// Two separated narrow cable-hung plank bridges aligned straight for L & R tracks; empty sand pit below
// ---------------------------------------------------------------------------
const hCfg = HANGING_BRIDGE_CONFIG;
const hPitLen = hCfg.pitXMax - hCfg.pitXMin;
const hPitMidX = (hCfg.pitXMin + hCfg.pitXMax) * 0.5;
const hPitWidthZ = hCfg.pitHalfZ * 2;
const hPitDepth = GROUND_DECK_HEIGHT - HANGING_SAND_PIT_Y; // 0.52m below ground, 1.65m drop from bridges
const hSpanLen = hCfg.xBridgeEast - hCfg.xBridgeWest; // 10.0m
const hMidX = (hCfg.xBridgeEast + hCfg.xBridgeWest) * 0.5; // -4.20m

// 1. Sunken Loose Golden Sand Pit Box directly underneath the separated twin hanging bridges
box(course, mats.sand, V(hPitMidX, HANGING_SAND_PIT_Y - 0.14, hCfg.zLane), V(hPitLen + 0.10, 0.28, hPitWidthZ + 0.10), 0, false);
// Soft sand ripples & drifts across pit bed
for (let sx = hCfg.pitXMin + 0.75; sx <= hCfg.pitXMax - 0.75; sx += 1.45) {
  const rz = hCfg.zLane + Math.sin(sx * 1.9) * 0.75;
  box(course, mats.sand, V(sx, HANGING_SAND_PIT_Y + 0.015, rz), V(1.10, 0.04, 1.85), Math.sin(sx) * 0.25, false);
}
// 4 Vertical Pit Containment Walls lining the sand basin up flush to arena floor (-0.33m)
for (const side of [-1, 1]) {
  const zWall = hCfg.zLane + side * hCfg.pitHalfZ;
  box(course, mats.concretePier, V(hPitMidX, HANGING_SAND_PIT_Y + hPitDepth * 0.5, zWall), V(hPitLen + 0.24, hPitDepth, 0.22));
  box(course, mats.yellow, V(hPitMidX, GROUND_DECK_HEIGHT + 0.004, zWall), V(hPitLen + 0.24, 0.016, 0.20), 0, false);
  colliders.push({
    id: `sand_pit_wall_${side > 0 ? 'south' : 'north'}`,
    x: hPitMidX,
    z: zWall,
    hx: hPitLen / 2,
    hz: 0.12,
    y: HANGING_SAND_PIT_Y + hPitDepth * 0.5,
    height: hPitDepth,
    rot: 0,
    walkable: false,
  });
}
for (const [endId, ex] of [['east', hCfg.pitXMax], ['west', hCfg.pitXMin]] as const) {
  box(course, mats.concretePier, V(ex, HANGING_SAND_PIT_Y + hPitDepth * 0.5, hCfg.zLane), V(0.22, hPitDepth, hPitWidthZ));
  colliders.push({
    id: `sand_pit_end_${endId}`,
    x: ex,
    z: hCfg.zLane,
    hx: 0.12,
    hz: hCfg.pitHalfZ,
    y: HANGING_SAND_PIT_Y + hPitDepth * 0.5,
    height: hPitDepth,
    rot: 0,
    walkable: false,
  });
}

// 2. Curved Cushioned Ascent & Descent Ramps + Aligned Wheel-Lane Guides leading straight onto twin bridges
curvedSlopedDeck('hanging_bridge_ascent_ramp', hCfg.xEntryStart, hCfg.xBridgeEast - 0.05, hCfg.zLane, hCfg.totalDeckWidth, GROUND_DECK_HEIGHT, hCfg.deckY, 0.12, mats.diamondPlate);
buildRampTrimAndFootings('hanging_ascent', hCfg.xEntryStart, hCfg.xBridgeEast - 0.05, hCfg.zLane, hCfg.totalDeckWidth, GROUND_DECK_HEIGHT, hCfg.deckY);
addBridgePortalHeadwalls('hanging_entry', hCfg.xEntryStart, hCfg.totalDeckWidth / 2 + 0.06, 2.06, hCfg.zLane, GROUND_DECK_HEIGHT);

curvedSlopedDeck('hanging_bridge_descent_ramp', hCfg.xBridgeWest + 0.05, hCfg.xExitEnd, hCfg.zLane, hCfg.totalDeckWidth, hCfg.deckY, GROUND_DECK_HEIGHT, 0.12, mats.diamondPlate);
buildRampTrimAndFootings('hanging_descent', hCfg.xExitEnd, hCfg.xBridgeWest + 0.05, hCfg.zLane, hCfg.totalDeckWidth, GROUND_DECK_HEIGHT, hCfg.deckY);
addBridgePortalHeadwalls('hanging_exit', hCfg.xExitEnd, hCfg.totalDeckWidth / 2 + 0.06, 2.06, hCfg.zLane, GROUND_DECK_HEIGHT);

// Paint dead-straight twin wooden alignment lane strips up BOTH ramps aligned identically with PARALLEL_PLANK_CENTERS
for (const sideIdx of [0, 1] as const) {
  const tZ = PARALLEL_PLANK_CENTERS[sideIdx].z;
  curvedSlopedDeck(`hanging_ascent_align_${sideIdx}`, hCfg.xEntryStart, hCfg.xBridgeEast - 0.05, tZ, hCfg.trackWidth, GROUND_DECK_HEIGHT + 0.012, hCfg.deckY + 0.012, 0.008, mats.wood);
  curvedSlopedDeck(`hanging_descent_align_${sideIdx}`, hCfg.xBridgeWest + 0.05, hCfg.xExitEnd, tZ, hCfg.trackWidth, hCfg.deckY + 0.012, GROUND_DECK_HEIGHT + 0.012, 0.008, mats.wood);
}

// 3. 3 Portal A-Frame Suspension Towers at x = 0.8, x = -4.2, x = -9.2 founded inside Sand Pit
const towerXs = [hCfg.xBridgeEast, hCfg.xBridgeMid, hCfg.xBridgeWest];
const towerZNorth = hCfg.zLane + 1.48;
const towerZSouth = hCfg.zLane - 1.48;
const suspensionStrobes: THREE.Mesh[] = [];
const towerTotalH = hCfg.cableTowerHeight - HANGING_SAND_PIT_Y;

for (const tx of towerXs) {
  for (const tz of [towerZSouth, towerZNorth]) {
    cyl(course, mats.metal, V(tx, HANGING_SAND_PIT_Y + towerTotalH * 0.5, tz), 0.11, towerTotalH, 'y');
    box(course, mats.concretePier, V(tx, HANGING_SAND_PIT_Y + 0.25, tz), V(0.42, 0.50, 0.42));
    cyl(course, mats.metal, V(tx, hCfg.cableTowerHeight, tz), 0.14, 0.16, 'x');

    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), mats.beaconAmber);
    s.position.set(tx, hCfg.cableTowerHeight + 0.14, tz);
    course.add(s);
    suspensionStrobes.push(s);

    colliders.push({
      id: `suspension_tower_${tx > -2 ? 'east' : tx > -6 ? 'mid' : 'west'}_${tz > hCfg.zLane ? 'north' : 'south'}`,
      x: tx,
      z: tz,
      hx: 0.22,
      hz: 0.22,
      y: HANGING_SAND_PIT_Y + towerTotalH * 0.5,
      height: towerTotalH,
      rot: 0,
      walkable: false,
    });
  }
  // Overhead tower cross-girder connecting legs far clear above robot (~2.90m high) — ZERO floor bridge across middle void!
  box(course, mats.charcoal, V(tx, hCfg.cableTowerHeight - 0.30, hCfg.zLane), V(0.14, 0.14, towerZNorth - towerZSouth));
  // Portal entry/exit end-sill beam ONLY at ramp thresholds x = 0.80 & x = -9.20
  if (tx !== hCfg.xBridgeMid) {
    box(course, mats.metal, V(tx, hCfg.deckY - 0.08, hCfg.zLane), V(0.14, 0.10, hCfg.totalDeckWidth));
  }
}

// Backstay anchor cables running cleanly outside ramps down to ground deadman piers
for (const cZ of [towerZSouth, towerZNorth]) {
  tubeBetween(V(hCfg.xBridgeEast, hCfg.cableTowerHeight, cZ), V(2.15, GROUND_DECK_HEIGHT + 0.16, cZ), 0.04, mats.metal);
  box(course, mats.concretePier, V(2.15, GROUND_DECK_HEIGHT + 0.08, cZ), V(0.42, 0.24, 0.28));
  tubeBetween(V(hCfg.xBridgeWest, hCfg.cableTowerHeight, cZ), V(-10.55, GROUND_DECK_HEIGHT + 0.16, cZ), 0.04, mats.metal);
  box(course, mats.concretePier, V(-10.55, GROUND_DECK_HEIGHT + 0.08, cZ), V(0.42, 0.24, 0.28));
}

// 4. Spread Twin Narrow Hanging Plank Trackways (2x wheel width = 0.728m world) hanging independently
const beamSupportAnchorY = hCfg.cableTowerHeight - 0.32;
for (const trackIdx of [0, 1] as const) {
  const tZ = PARALLEL_PLANK_CENTERS[trackIdx].z;
  const halfTrackW = hCfg.trackWidth / 2;

  // Individual weathered timber slats spaced along the 10m dual span with subtle organic non-swinging hang tilt
  let plankCounter = 0;
  for (let px = hCfg.xBridgeWest + 0.12; px <= hCfg.xBridgeEast - 0.12; px += 0.30) {
    const py = hangingBridgeTrackHeightAt(px, trackIdx);
    const plank = box(course, mats.wood, V(px, py - 0.022, tZ), V(0.25, 0.044, hCfg.trackWidth - 0.02));
    // Deterministic slight pitch & roll irregularity ("hanging out randomly" without swinging)
    const wobbleRoll = Math.sin(px * 3.7 + trackIdx * 1.9 + plankCounter * 0.7) * 0.026;
    const wobblePitch = Math.cos(px * 2.9 - trackIdx * 2.1) * 0.020;
    plank.rotation.set(wobbleRoll, 0, wobblePitch);
    // Plank-to-cable lash hardware bolts on outer/inner slat edges
    for (const edgeSign of [-1, 1]) {
      const boltZ = tZ + edgeSign * (halfTrackW - 0.045);
      box(course, mats.metal, V(px, py + 0.004, boltZ), V(0.04, 0.014, 0.04), 0, false);
    }
    plankCounter++;
  }

  // Dual suspension cables per narrow bridge: both edges carry bottom bearer cable + overhead catenary cable + hangers
  for (const edgeSign of [-1, 1]) {
    const cableZ = tZ + edgeSign * (halfTrackW + 0.025);
    // Spans East [-4.2, 0.8] & West [-9.2, -4.2]
    for (const xStart of [hCfg.xBridgeEast, hCfg.xBridgeMid]) {
      const stepsPerSpan = 16;
      const overheadSagPeak = trackIdx === 0 ? 1.04 : 1.12;
      for (let s = 0; s < stepsPerSpan; s++) {
        const u0 = s / stepsPerSpan;
        const u1 = (s + 1) / stepsPerSpan;
        const x0 = xStart - u0 * 5.0;
        const x1 = xStart - u1 * 5.0;

        // Under-plank flexible bearer rope tracing exact bridge curve
        const deckY0 = hangingBridgeTrackHeightAt(x0, trackIdx) - 0.055;
        const deckY1 = hangingBridgeTrackHeightAt(x1, trackIdx) - 0.055;
        tubeBetween(V(x0, deckY0, cableZ), V(x1, deckY1, cableZ), 0.022, mats.metal);

        // Overhead catenary suspension cable draping from overhead cross-beam
        const cY0 = beamSupportAnchorY - 4 * overheadSagPeak * u0 * (1 - u0);
        const cY1 = beamSupportAnchorY - 4 * overheadSagPeak * u1 * (1 - u1);
        tubeBetween(V(x0, cY0, cableZ), V(x1, cY1, cableZ), 0.026, mats.charcoal);

        // Vertical chrome hanger drop-wires anchoring the timber bridge edge straight up to catenary cable
        if (s % 2 === 1) {
          tubeBetween(V(x0, cY0, cableZ), V(x0, deckY0 + 0.02, cableZ), 0.013, mats.chrome);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4 WIDE SEMICIRCULAR HAIRPINS CONNECTING PARALLEL VIADUCT LANES
// ---------------------------------------------------------------------------
interface HairpinSpec {
  id: string;
  cx: number;
  cz: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  facingOutDir: number; // 1 for East facing (+X), -1 for West facing (-X)
}

const hairpins: HairpinSpec[] = [
  // Hairpin 1: East Turn (Lane 1 -> Lane 2) around (17.50, 10.125)
  { id: 'hp1', cx: 17.50, cz: 10.125, radius: 3.375, startAngle: Math.PI / 2, endAngle: -Math.PI / 2, facingOutDir: 1 },
  // Hairpin 2: West Turn (Lane 2 -> Lane 3) around (-17.50, 3.375)
  { id: 'hp2', cx: -17.50, cz: 3.375, radius: 3.375, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5, facingOutDir: -1 },
  // Hairpin 3: East Turn (Lane 3 -> Lane 4) around (17.50, -3.375)
  { id: 'hp3', cx: 17.50, cz: -3.375, radius: 3.375, startAngle: Math.PI / 2, endAngle: -Math.PI / 2, facingOutDir: 1 },
  // Hairpin 4: West Turn (Lane 4 -> Lane 5) around (-17.50, -10.125)
  { id: 'hp4', cx: -17.50, cz: -10.125, radius: 3.375, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5, facingOutDir: -1 },
];

for (const hp of hairpins) {
  const steps = 16;
  const dAngle = (hp.endAngle - hp.startAngle) / steps;
  const halfW = DRIVE_ROUTE_WIDTH / 2;
  const hpDeckY = GROUND_DECK_HEIGHT; // -0.33m

  for (let s = 0; s < steps; s++) {
    const theta0 = hp.startAngle + s * dAngle;
    const theta1 = hp.startAngle + (s + 1) * dAngle;
    const midTheta = (theta0 + theta1) / 2;
    const absDTheta = Math.abs(dAngle);
    const tangRot = Math.PI / 2 - midTheta;

    // 1. Flush Outer Competition Boundary Line along Hairpin curves (replaces raised parapet wall)
    const rOut = hp.radius + (halfW - 0.10);
    const ox = hp.cx + rOut * Math.cos(midTheta);
    const oz = hp.cz + rOut * Math.sin(midTheta);
    const outChord = rOut * absDTheta;
    const outLine = box(course, s % 2 === 0 ? mats.yellow : mats.fiaRed, V(ox, hpDeckY + 0.012, oz), V(outChord + 0.06, 0.014, 0.16), tangRot, false);
    outLine.rotation.y = tangRot;

    // 2. Inner apex curved flush rumble stripe
    const rIn = hp.radius - (halfW - 0.10);
    const ix = hp.cx + rIn * Math.cos(midTheta);
    const iz = hp.cz + rIn * Math.sin(midTheta);
    const inChord = rIn * absDTheta;
    const kMat = s % 2 === 0 ? mats.fiaRed : mats.fiaWhite;
    const innerCurb = box(course, kMat, V(ix, hpDeckY + 0.012, iz), V(inChord + 0.04, 0.014, 0.16), tangRot, false);
    innerCurb.rotation.y = tangRot;
  }

  // Central Apex Warning Pylon & Revolving Beacon
  cyl(course, mats.concretePier, V(hp.cx, hpDeckY + 0.05, hp.cz), 0.45, 0.10, 'y', 20);
  cyl(course, mats.yellow, V(hp.cx, hpDeckY + 0.32, hp.cz), 0.18, 0.60, 'y');
  cyl(course, mats.black, V(hp.cx, hpDeckY + 0.64, hp.cz), 0.19, 0.06, 'y');
  const bGroup = new THREE.Group();
  bGroup.position.set(hp.cx, hpDeckY + 1.15, hp.cz);
  cyl(course, mats.metal, V(hp.cx, hpDeckY + 0.55, hp.cz), 0.05, 1.10, 'y');
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12), mats.beaconAmber);
  bGroup.add(dome);
  const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.08), mats.yellow);
  bGroup.add(reflector);
  course.add(bGroup);
  hazardRevolvingBeacons.push(bGroup);

  // 4D Electronic Chasing LED Chevron Signs along the curve
  for (let c = 0; c < 4; c++) {
    const tFrac = (c + 0.5) / 4;
    const theta = hp.startAngle + tFrac * (hp.endAngle - hp.startAngle);
    const cx = hp.cx + (hp.radius + halfW - 0.08) * Math.cos(theta);
    const cz = hp.cz + (hp.radius + halfW - 0.08) * Math.sin(theta);
    cyl(course, mats.metal, V(cx, hpDeckY + 0.44, cz), 0.025, 0.16, 'y');
    box(course, mats.black, V(cx, hpDeckY + 0.55, cz), V(0.08, 0.28, 0.45), theta);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.20, 3), mats.yellow);
    arrow.rotation.z = hp.facingOutDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    arrow.rotation.y = theta;
    arrow.position.set(cx - 0.06 * Math.cos(theta), hpDeckY + 0.55, cz - 0.06 * Math.sin(theta));
    course.add(arrow);
    chevronSignArrows.push(arrow);
  }
}

// ---------------------------------------------------------------------------
// PARAPET SAFETY BARRIERS & DIRECTIONAL CHEVRONS ACROSS ALL 5 LANES
// ---------------------------------------------------------------------------
// Straight lane corridors with clear 2.35m open-air chasms between viaducts
const straightLaneSpecs = [
  { laneId: 1, z: 13.50, xMin: -18.5, xMax: 5.80, dir: 1 as const },   // Lane 1 Approach (Ground)
  { laneId: 1, z: 13.50, xMin: 14.80, xMax: 17.5, dir: 1 as const },  // Lane 1 Exit to HP1 (Ground)
  { laneId: 2, z: 6.75,  xMin: -17.5, xMax: SPEED_BREAKER_CONFIG.deckXMin, dir: -1 as const },  // Lane 2 West Approach (Ground)
  { laneId: 2, z: 6.75,  xMin: SPEED_BREAKER_CONFIG.deckXMax, xMax: HIGH_CLIMB_CONFIG.xExitEnd, dir: -1 as const }, // Lane 2 Mid Section between High Climb & Mega Humps
  { laneId: 2, z: 6.75,  xMin: HIGH_CLIMB_CONFIG.xEntryStart, xMax: 17.5, dir: -1 as const },  // Lane 2 East Entry off Hairpin 1
  { laneId: 3, z: 0.00,  xMin: -17.5, xMax: -5.60, dir: 1 as const },  // Lane 3 Ground Approach
  { laneId: 3, z: 0.00,  xMin: 10.45, xMax: 17.5, dir: 1 as const },   // Lane 3 Landing Exit
  { laneId: 4, z: -6.75, xMin: -17.5, xMax: -10.80, dir: -1 as const }, // Lane 4 West Runway to HP4
  { laneId: 4, z: -6.75, xMin: 2.40,  xMax: 3.80,   dir: -1 as const }, // Lane 4 Gate 08 Connecting Bay (Ground)
  { laneId: 4, z: -6.75, xMin: 17.20, xMax: 17.56,  dir: -1 as const }, // Lane 4 East Approach (Ground)
  { laneId: 5, z: -13.50, xMin: -17.5, xMax: -5.50, dir: 1 as const },  // Lane 5 Approach to Fire
  { laneId: 5, z: -13.50, xMin: 9.50,  xMax: 16.0, dir: 1 as const },  // Lane 5 Finish Straight
];

for (const lane of straightLaneSpecs) {
  const halfW = DRIVE_ROUTE_WIDTH / 2;
  const len = lane.xMax - lane.xMin;
  const midX = (lane.xMin + lane.xMax) / 2;
  const laneDeckY = GROUND_DECK_HEIGHT; // -0.33m

  for (const side of [-1, 1]) {
    const zLine = lane.z + side * (halfW - 0.10);
    // Flush competition track boundary line replacing solid wall barriers
    box(course, mats.yellow, V(midX, laneDeckY + 0.012, zLine), V(len, 0.014, 0.16), 0, false);

    // Alternating red caution out-of-bounds warning ticks outside the painted edge line
    for (let wx = lane.xMin + 1.0; wx <= lane.xMax - 1.0; wx += 2.4) {
      box(course, mats.fiaRed, V(wx, laneDeckY + 0.013, zLine + side * 0.08), V(0.65, 0.012, 0.05), 0, false);
    }
  }
}

// High-mast stadium floodlight towers along the southern perimeter
for (const fx of [-12.0, 0.0, 12.0]) {
  const pz = -16.5;
  cyl(course, mats.metal, V(fx, ARENA_FLOOR_HEIGHT + 3.0, pz), 0.12, 6.0, 'y');
  box(course, mats.concretePier, V(fx, ARENA_FLOOR_HEIGHT + 0.35, pz), V(0.9, 0.7, 0.9));
  box(course, mats.yellow, V(fx, ARENA_FLOOR_HEIGHT + 5.9, pz), V(1.4, 0.18, 0.35), 0, false);
  colliders.push({
    id: `floodlight_base_${fx}`,
    x: fx,
    z: pz,
    hx: 0.48,
    hz: 0.48,
    y: ARENA_FLOOR_HEIGHT + 0.35,
    height: 0.70,
    rot: 0,
    walkable: false,
  });
  const towerLight = new THREE.DirectionalLight('#fff0d4', 0.85);
  towerLight.position.set(fx, ARENA_FLOOR_HEIGHT + 6.0, pz);
  towerLight.target.position.set(fx, ROUTE_DECK_HEIGHT, 0.0);
  scene.add(towerLight);
  scene.add(towerLight.target);
}

// ---------------------------------------------------------------------------
// SECTION 11: Grand Checkered Finish Straight on Lane 5 (Z = -13.50, X in [10.5, 16.5])
// ---------------------------------------------------------------------------
// Pristine Flush Checkered Finish Grid spanning full 4.40m roadway at Gate 12 (x = 12.0)
const finishX0 = 11.00;
const finishTilesX = 8;  // 8 * 0.30m = 2.40m along straight
const finishTilesZ = 14; // 14 * 0.30m = 4.20m across roadway
for (let ix = 0; ix < finishTilesX; ix++) {
  for (let iz = 0; iz < finishTilesZ; iz++) {
    const tileX = finishX0 + (ix + 0.5) * 0.30;
    const tileZ = -13.50 + (iz - (finishTilesZ - 1) / 2) * 0.30;
    box(course, (ix + iz) % 2 ? mats.black : mats.laneStripeWhite, V(tileX, GROUND_DECK_HEIGHT + 0.007, tileZ), V(0.298, 0.006, 0.298), 0, false);
  }
}

// Crisp White Transverse Start & Stop Boundary Limit Bars
box(course, mats.laneStripeWhite, V(finishX0 - 0.04, GROUND_DECK_HEIGHT + 0.008, -13.50), V(0.08, 0.006, 4.25), 0, false);
box(course, mats.laneStripeWhite, V(finishX0 + finishTilesX * 0.30 + 0.04, GROUND_DECK_HEIGHT + 0.008, -13.50), V(0.08, 0.006, 4.25), 0, false);

// Alternating Red & White FIA Kerb Strips along both shoulders (x in [10.5, 16.2])
for (const side of [-1, 1]) {
  const zCurb = -13.50 + side * (DRIVE_ROUTE_WIDTH / 2 - 0.12);
  const kSteps = 18;
  const kW = (16.2 - 10.5) / kSteps;
  for (let k = 0; k < kSteps; k++) {
    const kx = 10.5 + (k + 0.5) * kW;
    box(course, k % 2 === 0 ? mats.fiaRed : mats.fiaWhite, V(kx, GROUND_DECK_HEIGHT + 0.04, zCurb), V(kW - 0.01, 0.08, 0.24), 0, false);
  }
}

// Terminal Run-off Tire Wall Crash Barrier Stack at Track End (x = 16.50, z = -13.50)
const tireRows = 3;
const tireCols = 10;
const tireR = 0.22;
for (let tr = 0; tr < tireRows; tr++) {
  for (let tc = 0; tc < tireCols; tc++) {
    const tx = 16.50 + tr * 0.36;
    const tz = -13.50 + (tc - (tireCols - 1) / 2) * 0.44;
    const ty = GROUND_DECK_HEIGHT + 0.18 + (tr % 2) * 0.16;
    cyl(course, mats.rubber, V(tx, ty, tz), tireR, 0.28, 'y', 16);
    // Yellow hazard cap on top row
    if (tr === tireRows - 1) {
      cyl(course, tc % 2 === 0 ? mats.yellow : mats.black, V(tx, ty + 0.15, tz), tireR - 0.02, 0.04, 'y', 16);
    }
  }
}
colliders.push({
  id: 'lane_5_terminal_tire_wall',
  x: 16.86,
  z: -13.50,
  hx: 0.60,
  hz: DRIVE_ROUTE_WIDTH / 2 + 0.10,
  y: GROUND_DECK_HEIGHT + 0.35,
  height: 0.70,
  rot: 0,
  walkable: false,
});

// -------------------------------------------------------------
// 6. Checkpoint Gates & Recovery Anchors (Ultra-Real 3D Gantries + 4D Laser Scan Lines)
// -------------------------------------------------------------
const checkpointLaserBeams: THREE.Mesh[] = [];
const checkpointBeacons: THREE.Mesh[] = [];

const checkpointMeshes = CHECKPOINTS.map((cp, i) => {
  const g = new THREE.Group();
  const gateY = cp.elevation !== undefined ? cp.elevation : evaluateCourseHeight(cp.x, cp.z);
  g.position.set(cp.x, gateY, cp.z);
  g.rotation.y = cp.yaw;
  course.add(g);

  let beamSpan = 5.0;
  if (i === 4 || i === 5) {
    // Checkpoints 05 (Spiral Summit) and 06 (Spiral Summit Turntable)
    // Low-profile side timing sensor bollards and flush laser scan line across the deck,
    // maintaining 100% open vertical headroom without any overhead crossbars or drop columns!
    beamSpan = (i === 5 ? SPIRAL_CONFIG.deckWidthZ - 0.40 : SPIRAL_CONFIG.roadWidth - 0.10);
    const halfSpan = (i === 5 ? (SPIRAL_CONFIG.deckWidthZ / 2 - 0.10) : (SPIRAL_CONFIG.roadWidth / 2 + 0.08));
    for (const side of [-1, 1]) {
      const px = side * halfSpan;
      box(g, mats.metal, V(px, 0.28, 0), V(0.14, 0.56, 0.14));
      box(g, mats.yellow, V(px, 0.08, 0), V(0.20, 0.16, 0.20), 0, false);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.10, 12), mats.beaconAmber);
      beacon.position.set(px, 0.60, 0);
      g.add(beacon);
      checkpointBeacons.push(beacon);
    }
  } else {
    // 1. Structural Steel Truss Gantry (Left & Right Columns)
    // Standardized proportional gantry spans tailored to exact corridor widths
    // Gates 01, 02, 03, 04, 05, 08, 09, 11 span the 6.0m roadway: 5.4m span
    const gantrySpan = 5.4;
    beamSpan = gantrySpan - 0.4;
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
    const isFinishGate = (i === CHECKPOINTS.length - 1);
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 96;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#111413';
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = isFinishGate ? '#ffd700' : '#f0bd53';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 504, 88);
    if (isFinishGate) {
      // Draw checkered border accents on finish banner
      const cSize = 16;
      for (let cx = 10; cx < 80; cx += cSize) {
        for (let cy = 10; cy < 86; cy += cSize) {
          if ((Math.floor(cx / cSize) + Math.floor(cy / cSize)) % 2 === 0) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx, cy, cSize, cSize);
            ctx.fillRect(512 - 80 + (cx - 10), cy, cSize, cSize);
          }
        }
      }
    }
    ctx.fillStyle = isFinishGate ? '#ffe066' : '#f0bd53';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(isFinishGate ? '🏁 GRAND FINISH 🏁' : cp.label.toUpperCase(), 256, 58);
    const signTex = new THREE.CanvasTexture(cvs);
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.8, gantrySpan - 1.2), 0.52), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    signMesh.position.set(0, towerH, 0);
    g.add(signMesh);
  }

  // 4. Ultra-Realistic Laser Timing Scan Beam across the roadway
  const laserColor = i === 0 ? '#f0bd53' : (i === CHECKPOINTS.length - 1) ? '#ffd700' : '#20e3b2';
  const laserBeamGeo = new THREE.CylinderGeometry(0.016, 0.016, beamSpan, 12);
  laserBeamGeo.rotateZ(Math.PI / 2);
  const bar = new THREE.Mesh(
    laserBeamGeo,
    new THREE.MeshBasicMaterial({ color: laserColor })
  );
  bar.position.set(0, 0.04, 0);
  g.add(bar);

  // Soft vertical laser shimmer curtain (Only on full gantry gates, NEVER across climbing spiral or turntable)
  if (i !== 4 && i !== 5 && i !== 6) {
    const shimmer = new THREE.Mesh(
      new THREE.PlaneGeometry(beamSpan, 0.35),
      new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
    );
    shimmer.position.set(0, 0.18, 0);
    g.add(shimmer);
  }
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
  handPoints: clamp(Number(savedPrefs.handPoints ?? 5), 1, 999),
  scoring: {
    easyPoints: clamp(Number(savedPrefs.scoring?.easyPoints ?? DEFAULT_SCORING_CONFIG.easyPoints), 0, 200),
    mediumPoints: clamp(Number(savedPrefs.scoring?.mediumPoints ?? DEFAULT_SCORING_CONFIG.mediumPoints), 0, 200),
    hardPoints: clamp(Number(savedPrefs.scoring?.hardPoints ?? DEFAULT_SCORING_CONFIG.hardPoints), 0, 300),
    boundaryPenaltyPoints: clamp(Number(savedPrefs.scoring?.boundaryPenaltyPoints ?? DEFAULT_SCORING_CONFIG.boundaryPenaltyPoints), 0, 100),
    boundaryLifelines: clamp(Number(savedPrefs.scoring?.boundaryLifelines ?? DEFAULT_SCORING_CONFIG.boundaryLifelines), 0, 20),
    fallBasePenaltyPoints: clamp(Number(savedPrefs.scoring?.fallBasePenaltyPoints ?? DEFAULT_SCORING_CONFIG.fallBasePenaltyPoints), 0, 100),
  } satisfies ScoringConfig,
};

let remainingHandPoints = config.handPoints;
let scoreState: CompetitionScoreState = createCompetitionScoreState(config.scoring);
let fallStartOrigin = { x: 0, z: 0, y: GROUND_DECK_HEIGHT };
let lastGroundedState = true;
let peakAirborneY = GROUND_DECK_HEIGHT;

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
const CAMERA_LABELS = ['CHASE', 'BUMPER', 'OVERHEAD', 'ORBIT'] as const;
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
let isPointerLocked = false;
let bestTime = Number(localStorage.getItem('robo-race-best-v2') || '0');
let toastTimer = 0;
let recoveryCooldown = 0;
let lastHazardHintTime = -10;
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
    handPoints: config.handPoints,
    scoring: config.scoring,
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
        <div class="pill"><small>SCORE</small><strong id="score">0</strong></div>
        <div class="pill" id="pillLifelines"><small>LINE BUFFERS</small><strong id="lifelines">🛡️ 3 / 3</strong></div>
        <div class="pill"><small>TIME</small><strong id="time">00:00.00</strong></div>
        <div class="pill"><small>GATES</small><strong id="gates">00 / 12</strong></div>
        <div class="pill"><small>SPEED</small><strong id="speed">0.0 <span style="font-size:9px">m/s</span></strong></div>
        <div class="pill" id="pillHandPoints" role="button" tabindex="0" title="Click or press [R] to recover at latest checkpoint using 1 Hand Point"><small>HAND POINTS</small><strong id="handPoints">🖐️ 5 / 5</strong></div>
        <div class="pill" id="pillBat"><small>BATTERY</small><strong id="bat">100%</strong></div>
        <div class="pill" id="pillMot"><small>MOTOR</small><strong id="mot">28°C</strong></div>
        <div class="pill" id="pillHlt"><small>HEALTH</small><strong id="hlt">100%</strong><div class="hlt-track"><div id="hltBar" class="hlt-fill" style="width:100%"></div></div></div>
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
      KEYBOARD&nbsp; <kbd>W</kbd><kbd>S</kbd> DRIVE &nbsp; <kbd>A</kbd> LEFT · <kbd>D</kbd> RIGHT &nbsp; <kbd>SPACE</kbd> BRAKE &nbsp; <kbd>R</kbd> RECOVER &nbsp; <kbd>K</kbd> SKIP GATE &nbsp; <kbd>C</kbd> CAMERA &nbsp; <kbd>ESC</kbd> MENU / RELEASE MOUSE · 360° MOUSE LOOK (CLICK CANVAS)
    </div>
    <div id="floatingSkipContainer" class="floating-skip-container hidden">
      <button id="btnSkipCheckpoint" class="floating-skip-btn" title="Skip to next checkpoint gate (Hotkey: K)">
        <div class="skip-header-row">
          <span class="skip-status-dot"></span>
          <span class="skip-category">TACTICAL ASSIST</span>
          <kbd class="skip-key-badge">K</kbd>
        </div>
        <div class="skip-main-row">
          <span class="skip-icon">⏭</span>
          <span class="skip-text">SKIP CHECKPOINT</span>
        </div>
        <div class="skip-detail-row" id="skipTargetDetail">
          GATE 01 &rarr; GATE 02
        </div>
      </button>
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
      <label>Racing Circuit Track
        <select id="trackSelect">
          <option value="track_b" selected>Track B — Spiral Tower Challenge (Showcase)</option>
          <option value="track_a">Track A — Basic Elevation Challenge</option>
          <option value="track_c">Track C — Advanced Multi-Level Challenge</option>
          <option value="track_d">Track D — Extreme Climbing Challenge</option>
        </select>
      </label>
      <label>Hand Points (Overturn Recovery)
        <select id="handPointsSelect">
          <option value="3">3 Hand Points</option>
          <option value="4">4 Hand Points</option>
          <option value="5" selected>5 Hand Points (Standard)</option>
          <option value="999">Unlimited</option>
        </select>
      </label>
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
      <div class="control-diagram">
        <b>SCORING &amp; BOUNDARY LINE RULES (CUSTOMIZABLE):</b><br>
        Touching painted line (&lt;50% out) is allowed free. Going &ge;50% across the line uses 1 Buffer Lifeline, then deducts custom minus points. Height falls calculate damage/battery &amp; points by height, speed &amp; place.
      </div>
      <div class="tuning-grid">
        <label>Easy Obst. Pts <input id="scoreEasyPts" type="number" min="0" max="200" step="5" value="${config.scoring.easyPoints}"></label>
        <label>Medium Obst. Pts <input id="scoreMedPts" type="number" min="0" max="200" step="5" value="${config.scoring.mediumPoints}"></label>
        <label>Hard / Critical Pts <input id="scoreHardPts" type="number" min="0" max="300" step="5" value="${config.scoring.hardPoints}"></label>
        <label>Line Minus Pts (5/10) <input id="scoreBoundaryPenalty" type="number" min="0" max="100" step="5" value="${config.scoring.boundaryPenaltyPoints}"></label>
        <label>Line Buffer Lifelines <input id="scoreLifelines" type="number" min="0" max="20" step="1" value="${config.scoring.boundaryLifelines}"></label>
        <label>Fall Base Minus Pts <input id="scoreFallPenalty" type="number" min="0" max="100" step="5" value="${config.scoring.fallBasePenaltyPoints}"></label>
      </div>
      <div class="control-diagram">360° MOUSE CAMERA: Click canvas to lock pointer for full 360° mouse look · Move mouse to rotate camera freely around robot · Press ESC or Pause to release mouse cursor for settings · Wheel zooms · Overturning allows limited Hand Points recovery.</div>
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
        Space: Mechanical brake · R: Safe checkpoint recovery (uses 1 Hand Point)
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
  const handPointsPill = $('#pillHandPoints');
  if (handPointsPill) {
    handPointsPill.addEventListener('click', () => {
      recoverVehicle();
      handPointsPill.blur();
    });
    handPointsPill.addEventListener('keydown', e => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        recoverVehicle();
      }
    });
  }
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

  const handPointsSelect = $<HTMLSelectElement>('#handPointsSelect');
  if (handPointsSelect) {
    handPointsSelect.value = String(config.handPoints);
    handPointsSelect.addEventListener('change', e => {
      const val = Number((e.target as HTMLSelectElement).value);
      config.handPoints = val;
      remainingHandPoints = val;
      savePreferences();
      updateHandPointsDisplay();
      displayToast(`HAND POINTS: ${val >= 999 ? 'UNLIMITED' : val}`);
    });
  }

  // Customizable Obstacle Scoring & Boundary Violation Settings
  const bindNumSetting = (id: string, getCur: () => number, setVal: (n: number) => void, onUpdate?: () => void) => {
    const el = document.querySelector<HTMLInputElement>(id);
    if (!el) return;
    el.value = String(getCur());
    el.addEventListener('change', () => {
      const parsed = Math.max(0, Math.round(Number(el.value) || 0));
      el.value = String(parsed);
      setVal(parsed);
      onUpdate?.();
      savePreferences();
    });
  };
  bindNumSetting('#scoreEasyPts', () => config.scoring.easyPoints, v => (config.scoring.easyPoints = v));
  bindNumSetting('#scoreMedPts', () => config.scoring.mediumPoints, v => (config.scoring.mediumPoints = v));
  bindNumSetting('#scoreHardPts', () => config.scoring.hardPoints, v => (config.scoring.hardPoints = v));
  bindNumSetting('#scoreBoundaryPenalty', () => config.scoring.boundaryPenaltyPoints, v => (config.scoring.boundaryPenaltyPoints = v), () => {
    displayToast(`LINE VIOLATION PENALTY SET: -${config.scoring.boundaryPenaltyPoints} PTS`);
  });
  bindNumSetting('#scoreLifelines', () => config.scoring.boundaryLifelines, v => {
    config.scoring.boundaryLifelines = v;
    scoreState.totalLifelines = v;
    scoreState.remainingLifelines = Math.min(scoreState.remainingLifelines, v);
  });
  bindNumSetting('#scoreFallPenalty', () => config.scoring.fallBasePenaltyPoints, v => (config.scoring.fallBasePenaltyPoints = v));

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener('click', () => {
    if (raceState === 'racing' && !isPointerLocked && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
      try {
        void canvas.requestPointerLock();
      } catch {}
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPointerLocked) {
      const scale = 0.0035 * config.cameraSensitivity;
      cameraFreeYaw -= e.movementX * scale;
      cameraFreePitch = clamp(cameraFreePitch + e.movementY * scale, -1.25, 1.25);
      cameraFreeLookIdle = 999999;
    }
  });

  canvas.addEventListener('pointerdown', e => {
    if (isPointerLocked) return;
    if (e.button !== 2 && !(cameraMode === 3 && e.button === 0)) return;
    cameraPointerId = e.pointerId;
    cameraPointerX = e.clientX;
    cameraPointerY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (isPointerLocked || cameraPointerId !== e.pointerId) return;
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

  $('#btnSkipCheckpoint')?.addEventListener('click', skipCurrentCheckpoint);

  showMenu();
}

function showMenu() {
  const o = $<HTMLDivElement>('#overlay');
  const activeTrackId = getActiveTrack().id;
  o.innerHTML = `
    <div class="overlay">
      <div class="game-card">
        <div class="hud-corner tl"></div>
        <div class="hud-corner tr"></div>
        <div class="hud-corner bl"></div>
        <div class="hud-corner br"></div>

        <div class="hub-status-ribbon">
          <div class="hub-live-badge">
            <span class="hub-live-dot"></span>
            <span>TELEMETRY ONLINE</span>
          </div>
          <div class="hub-sim-badge">UGV SIMULATOR v2.4</div>
        </div>

        <div class="hub-header">
          <div class="hub-title-row">
            <h1 class="hub-title">ROBO RACE</h1>
            <span class="hub-edition">3D</span>
          </div>
          <div class="hub-subtitle">ADVANCED ROBOTIC PROVING GROUNDS</div>
          <p class="hub-desc">
            Pilot the high-torque differential tracked rover across 12 rigorous tactical sectors:
            precision slaloms, elevated rock scramble, 540° spiral helix, kinetic swinging pendulums,
            dual hanging suspension bridges, and the mandatory fire & water crucible.
          </p>
        </div>

        <div class="hub-specs-grid">
          <div class="hub-spec-pill"><span class="spec-ico">⚡</span> DIFFERENTIAL SKID-STEER</div>
          <div class="hub-spec-pill"><span class="spec-ico">📐</span> 6-DOF RIGID INERTIA</div>
          <div class="hub-spec-pill"><span class="spec-ico">🔋</span> THERMAL & BATTERY MODEL</div>
          <div class="hub-spec-pill"><span class="spec-ico">🏁</span> 12 CHECKPOINT GATES</div>
        </div>

        <div class="hub-circuits-title">
          <span>CHOOSE PROVING CIRCUIT:</span>
          <small>TAP TO SELECT</small>
        </div>
        <div class="hub-track-grid">
          <div class="track-card ${activeTrackId === 'track_b' ? 'active' : ''}" data-track="track_b" id="cardTrackB">
            <div class="track-card-top">
              <span class="track-tag-badge">★ SHOWCASE</span>
              <span class="track-diff">★★★★★ EXPERT</span>
            </div>
            <div class="track-card-name">TRACK B: SPIRAL TOWER</div>
            <div class="track-card-hazards">540° Helical Climb · Pendulums · Hanging Bridges · Fire/Water</div>
          </div>
          <div class="track-card ${activeTrackId === 'track_a' ? 'active' : ''}" data-track="track_a" id="cardTrackA">
            <div class="track-card-top">
              <span class="track-tag-badge">CIRCUIT</span>
              <span class="track-diff">★★★ MEDIUM</span>
            </div>
            <div class="track-card-name">TRACK A: ELEVATION</div>
            <div class="track-card-hazards">Tabletop Platform · Steel Arch Bridge · Fire/Water Crucible</div>
          </div>
          <div class="track-card ${activeTrackId === 'track_c' ? 'active' : ''}" data-track="track_c" id="cardTrackC">
            <div class="track-card-top">
              <span class="track-tag-badge">CIRCUIT</span>
              <span class="track-diff">★★★★ ADVANCED</span>
            </div>
            <div class="track-card-name">TRACK C: MULTI-LEVEL</div>
            <div class="track-card-hazards">Stepping Platforms · Switchback Ramps · Fire/Water Crucible</div>
          </div>
          <div class="track-card ${activeTrackId === 'track_d' ? 'active' : ''}" data-track="track_d" id="cardTrackD">
            <div class="track-card-top">
              <span class="track-tag-badge">CHALLENGE</span>
              <span class="track-diff">★★★★★ MASTER</span>
            </div>
            <div class="track-card-name">TRACK D: EXTREME CLIMB</div>
            <div class="track-card-hazards">60° Steep Incline · Boulder Scramble · Fire/Water Crucible</div>
          </div>
        </div>

        <div class="hub-controls-strip">
          <div class="hub-keycap-row">
            <div class="hub-keycap-item"><kbd class="hud-k">W</kbd><kbd class="hud-k">S</kbd> DRIVE</div>
            <div class="hub-keycap-item"><kbd class="hud-k">A</kbd><kbd class="hud-k">D</kbd> TURN</div>
            <div class="hub-keycap-item"><kbd class="hud-k">SPACE</kbd> BRAKE</div>
            <div class="hub-keycap-item"><kbd class="hud-k">R</kbd> RECOVER (HOLD: RESET)</div>
            <div class="hub-keycap-item"><kbd class="hud-k">K</kbd> SKIP GATE</div>
          </div>
          <div class="hub-controller-caption">
            🎮 <b>CONTROLLERS:</b> Xbox, PlayStation, RadioMaster Boxer/TX16S & EdgeTX natively supported
          </div>
        </div>

        <button class="hub-hero-cta" id="btnStartRace">
          <span>▶</span> ENGAGE DRIVETRAIN &bull; START RACE
        </button>

        <div class="hub-footer-actions">
          <button class="iconbtn" id="btnMenuCam">📹 CAMERA: ${CAMERA_LABELS[cameraMode] || 'CHASE'}</button>
          <button class="iconbtn" id="btnMenuSettings">⚙ SETTINGS</button>
          <button class="iconbtn" id="btnMenuCalib">🎮 CALIBRATE</button>
        </div>
      </div>
    </div>
  `;
  $('#btnStartRace', o).addEventListener('click', startRace);
  const trackCards = o.querySelectorAll<HTMLDivElement>('.track-card');
  trackCards.forEach(card => {
    card.addEventListener('click', () => {
      const trackId = card.dataset.track as TrackId;
      setActiveTrack(trackId);
      trackCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const select = $('#trackSelect') as HTMLSelectElement | null;
      if (select) select.value = trackId;
      displayToast(`SELECTED: ${getActiveTrack().name.toUpperCase()}`);
    });
  });
  const btnMenuCam = $('#btnMenuCam', o);
  btnMenuCam.addEventListener('click', () => {
    cycleCamera();
    btnMenuCam.innerHTML = `📹 CAMERA: ${CAMERA_LABELS[cameraMode] || 'CHASE'}`;
  });
  $('#btnMenuSettings', o).addEventListener('click', () => $('#settings').classList.toggle('hidden'));
  $('#btnMenuCalib', o).addEventListener('click', () => {
    $('#openCalibBtn')?.click();
  });
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
  $('#btnResume', o).addEventListener('click', () => {
    raceState = 'racing';
    hideOverlays();
    try { void canvas.requestPointerLock(); } catch {}
  });
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
        <div class="eyebrow">COURSE COMPLETE · SCORE ${scoreState.score} PTS · ${checkpointMeshes.length} / ${checkpointMeshes.length} GATES</div>
        <h1>Race Finished!</h1>
        <p class="result-time">${formatTime(elapsed)} <span style="font-size:14px;color:#aeb8a9">+ ${penaltyTime.toFixed(1)}s assist</span></p>
        <p>Competition Score: <b style="color:${scoreState.score >= 0 ? '#6ee787' : '#ff7770'}">${scoreState.score} PTS</b>
           <span style="font-size:12px;color:#aeb8a9">(+${scoreState.pointsEarned} obstacles · -${scoreState.penaltyPoints} penalties)</span><br>
           Line Buffers Left: <b>${scoreState.remainingLifelines} / ${scoreState.totalLifelines}</b> · Out-of-Line Penalties: <b>${scoreState.boundaryViolations}</b> · Height Falls: <b>${scoreState.fallCount}</b><br>
           Adjusted Total: <b style="color:#f0bd53">${formatTime(totalAdj)}</b> · Record: <b style="color:#f0bd53">${formatTime(bestTime)}</b><br>
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
        <p>${reason}. This attempt cannot continue without a restart.</p>
        <p>Competition Score: <b>${scoreState.score} PTS</b> · Height Falls: <b>${scoreState.fallCount}</b><br>
           Time: <b>${formatTime(elapsed)}</b> · Battery: ${subsystems.battery.percentage.toFixed(0)}% · Health: ${subsystems.integrity.chassis.toFixed(0)}%</p>
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
    if (document.pointerLockElement) document.exitPointerLock();
    raceState = 'paused';
    controller.neutralize();
    showPaused();
  } else if (raceState === 'paused') {
    raceState = 'racing';
    hideOverlays();
    try { void canvas.requestPointerLock(); } catch {}
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

function updateHandPointsDisplay() {
  const hp = $<HTMLElement>('#handPoints');
  if (hp) {
    hp.textContent = config.handPoints >= 999 ? '🖐️ ∞' : `🖐️ ${remainingHandPoints} / ${config.handPoints}`;
  }
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
  remainingHandPoints = config.handPoints;
  updateHandPointsDisplay();
  subsystems = createInitialSubsystems();
  scoreState = createCompetitionScoreState(config.scoring);

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

  const startFloorY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
  fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: startFloorY };
  lastGroundedState = true;
  peakAirborneY = startFloorY;

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

  if (config.handPoints < 999 && remainingHandPoints <= 0) {
    tone(200, 0.25, 0.08);
    displayToast('HAND POINTS EXHAUSTED · HOLD [R] TO RESTART');
    return;
  }

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

  if (config.handPoints < 999) {
    remainingHandPoints--;
  }
  updateHandPointsDisplay();

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

  const recGroundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
  fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: recGroundY };
  lastGroundedState = true;
  peakAirborneY = recGroundY;
  pose.lastImpactSpeed = 0;
  scoreState.isOutsideLine = false;

  penaltyTime += config.penalty;
  tone(380, 0.18, 0.05);
  const hpStr = config.handPoints >= 999 ? '∞' : `${remainingHandPoints}/${config.handPoints}`;
  displayToast(`RECOVERED TO ${anchor.label.toUpperCase()} · [${hpStr} HAND POINTS] · +${config.penalty}s`);
}

function skipCurrentCheckpoint() {
  if (raceState !== 'racing' || currentCheckpoint >= checkpointMeshes.length) return;

  const prevGate = currentCheckpoint;
  checkpointMeshes[prevGate].passed = true;
  (checkpointMeshes[prevGate].bar.material as THREE.MeshBasicMaterial).color.set('#f0bd53');

  currentCheckpoint++;
  tone(580, 0.16, 0.05);

  if (currentCheckpoint >= checkpointMeshes.length) {
    displayToast(`GATE ${String(prevGate + 1).padStart(2, '0')} SKIPPED · FINISH REACHED`);
    raceState = 'finished';
    showResults();
    return;
  }

  // Find recovery anchor for the newly targeted checkpoint gate
  const nextTargetAnchor = recoveryAnchors.find(a => a.checkpointIndex === currentCheckpoint)
    || getSafeRecoveryAnchor(currentCheckpoint, recoveryAnchors)
    || recoveryAnchors[0];

  applyRecovery(pose, nextTargetAnchor, worldCourseHeight);
  motionState.x = pose.x;
  motionState.z = pose.z;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.yaw = pose.yaw;
  motionState.angular = 0;
  previousRacePosition = { x: pose.x, z: pose.z };

  const skipGroundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
  fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: skipGroundY };
  lastGroundedState = true;
  peakAirborneY = skipGroundY;
  pose.lastImpactSpeed = 0;
  scoreState.isOutsideLine = false;

  checkpointMeshes.forEach((checkpoint, i) => {
    checkpoint.passed = i < currentCheckpoint;
    (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#f0bd53' : '#88a679');
  });

  penaltyTime += 5.0; // Tactical assist penalty
  displayToast(`⏭ GATE ${String(prevGate + 1).padStart(2, '0')} SKIPPED → TARGET: GATE ${String(currentCheckpoint + 1).padStart(2, '0')} (+5s)`);
}

// Global Key Listeners & R Long-Press Restart Handling
let rKeyPressed = false;
let rHoldDuration = 0;
const R_HOLD_RESTART_THRESHOLD = 1.2; // seconds to hold R to cleanly restart the entire race

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

  if (e.code === 'KeyR' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
    if (!e.repeat) {
      rKeyPressed = true;
      rHoldDuration = 0;
    }
  }

  if (e.repeat) return;
  if (e.code === 'KeyK' && raceState === 'racing' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
    skipCurrentCheckpoint();
  }
  if (e.code === 'Escape') {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    if (diagnosticsModalOpen) {
      diagnosticsModalOpen = false;
      $('#diagnosticsModal').classList.add('hidden');
    } else if (!$('#settings').classList.contains('hidden')) {
      $('#settings').classList.add('hidden');
    } else {
      togglePause();
    }
  }
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

  if (e.code === 'KeyR') {
    if (rKeyPressed) {
      const wasShort = rHoldDuration < R_HOLD_RESTART_THRESHOLD;
      rKeyPressed = false;
      rHoldDuration = 0;
      if (wasShort && raceState === 'racing' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
        recoverVehicle();
      }
    }
  }
});
window.addEventListener('blur', () => {
  rKeyPressed = false;
  rHoldDuration = 0;
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
    // Vertical clearance check with safe tolerance so tilt / pitching never phases through fixed barriers
    if (c.y + c.height / 2 < robotBottom - 0.20 || c.y - c.height / 2 > robotTop + 0.20) continue;
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
(window as unknown as Record<string, unknown>).__setRaceState = (state: string) => {
  raceState = state as any;
  if (state === 'racing') hideOverlays();
};
(window as unknown as Record<string, unknown>).__teleportRobot = (x: number, z: number, yaw: number, targetY?: number) => {
  motionState.x = x;
  motionState.z = z;
  motionState.yaw = yaw;
  motionState.vx = 0;
  motionState.vz = 0;
  motionState.angular = 0;
  pose.x = x;
  pose.z = z;
  pose.yaw = yaw;
  const groundY = evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE, targetY ?? pose.y);
  if (targetY !== undefined) {
    pose.y = targetY;
  } else {
    pose.y = groundY - TRACK_CONTACT_OFFSET;
  }
  const spawnBottomY = pose.y + TRACK_CONTACT_OFFSET;
  const isAirSpawn = targetY !== undefined && spawnBottomY > groundY + 0.15;
  pose.vx = 0;
  pose.vz = 0;
  pose.vy = 0;
  pose.yawRate = 0;
  pose.pitch = 0;
  pose.roll = 0;
  pose.pitchRate = 0;
  pose.rollRate = 0;
  pose.isFlipped = false;
  pose.isGrounded = !isAirSpawn;
  pose.flippedTimer = 0;
  pose.sideDropTime = 0;
  pose.endDropTime = 0;
  pose.lastImpactSpeed = 0;
  previousRacePosition = { x, z };
  fallStartOrigin = { x: x / MAP_SCALE, z: z / MAP_SCALE, y: isAirSpawn ? spawnBottomY : groundY };
  lastGroundedState = !isAirSpawn;
  peakAirborneY = isAirSpawn ? spawnBottomY : groundY;
  scoreState.isOutsideLine = false;
  scoreState.boundaryCooldown = 0;
};

function stepPhysics(dt: number) {
  // Continuous smooth mechanical turntable rotation (configurable by race difficulty)
  const targetTurntableOmega = getTurntableOmega(config.difficulty as 'Beginner' | 'Intermediate' | 'Advanced' | 'Pro');
  turntableCurrentOmega += (targetTurntableOmega - turntableCurrentOmega) * (1 - Math.exp(-dt * 3.5));
  discGroup.rotation.y += turntableCurrentOmega * dt;

  // Continuous R Key Hold for Full Race Restart
  if (rKeyPressed) {
    rHoldDuration += dt;
    if (rHoldDuration >= R_HOLD_RESTART_THRESHOLD) {
      rKeyPressed = false;
      rHoldDuration = 0;
      restartRace();
      tone(660, 0.3, 0.08);
      displayToast('🏁 GAME RESTARTED · READY TO RACE');
    }
  }

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

  // Query true world-meter ground slope and surface at current position (sampling at active vehicle elevation)
  const slope = slopeAt((wx, wz) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y), motionState.x, motionState.z, 0.10);
  const surf = evaluateCourseSurface(motionState.x / MAP_SCALE, motionState.z / MAP_SCALE, pose.y);

  // Difficulty grip multiplier
  const gripMult = config.difficulty === 'Beginner' ? 1.25 : config.difficulty === 'Intermediate' ? 1.0 : config.difficulty === 'Advanced' ? 0.82 : 0.68;
  const effectiveGrip = surf.grip * gripMult;

  // Structural health scales peak drivetrain delivery once heavily damaged (< 75%)
  const healthThrottle = 0.70 + 0.30 * Math.min(1, subsystems.integrity.chassis / 75);

  // Integrate differential drive physics (strictly inertial zero-grip ballistics while airborne)
  const driveResult = integrateDrive(
    motionState,
    effectiveLeft,
    effectiveRight,
    {
      grip: effectiveGrip,
      kineticGrip: surf.kineticGrip !== undefined ? surf.kineticGrip * gripMult : undefined,
      breakawayGrade: surf.breakawayGrade,
      rollingResistance: surf.rollingResistance,
      lateralGripMultiplier: surf.lateralGripMultiplier,
    },
    slope,
    {
      maxSpeed: Math.min(tuning.maxSpeed * config.sensitivity, maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])) * healthThrottle,
      motorTrackSpeed: Math.min(maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])),
      motorAcceleration: Math.min(
        tuning.acceleration,
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[0]),
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[1]),
      ) * subsystems.motors.thermalThrottle * healthThrottle,
      braking: tuning.braking,
      turnRate: tuning.maxRotation,
      turnResponse: tuning.steeringResponse,
      gravity: 9.81,
      coastDeceleration: 2.7,
    },
    dt,
    inputs.brake,
    !pose.isGrounded,
  );

  // Oil Slick Hydroplane Fishtail Instability & Contextual Driving Hints
  if (surf.hazard === 'oil' && !pose.isFlipped && pose.isGrounded) {
    const planSpeed = Math.hypot(motionState.vx, motionState.vz);
    if (planSpeed > 0.65) {
      const steerNoise = Math.sin(elapsed * 5.2 + motionState.x * 0.45) * 0.55;
      motionState.angular += steerNoise * dt * 2.5;
      motionState.yaw += motionState.angular * dt * 0.5;
    }
    if (elapsed - lastHazardHintTime > 5.0 || elapsed < lastHazardHintTime) {
      lastHazardHintTime = elapsed;
      displayToast('OIL SLICK ZONE · LOW GRIP SKID HAZARD');
    }
  } else if (surf.breakawayGrade !== undefined && driveResult.motorSlip > 0.50 && motionState.vx > 0.25 && (elapsed - lastHazardHintTime > 5.0 || elapsed < lastHazardHintTime)) {
    lastHazardHintTime = elapsed;
    displayToast('BELTS SPINNING STRAIGHT · ZIGZAG (W+A / W+D) OR GAIN SPEED!');
  }

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
  // CRITICAL FIX: Only apply when vehicle is actually elevated ON the turntable deck (y >= 1.50m)
  if (!pose.isFlipped && pose.y >= 1.50) {
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

  // Authentic Archimedes Buoyancy, Hydrodynamic Drag, and Track Paddle Propulsion
  const waterBuoyancy = evaluateWaterBuoyancy(
    motionState.x,
    motionState.z,
    pose.y,
    motionState.yaw,
    motionState.vx,
    motionState.vz,
    driveResult.trackSpeedLeft,
    driveResult.trackSpeedRight,
    effectiveGrip,
    MAP_SCALE
  );
  if (waterBuoyancy.inWater) {
    // Apply hydrodynamic drag and track paddle thrust to planar velocities
    motionState.vx += (waterBuoyancy.waterDragX + waterBuoyancy.paddleThrustX) * dt;
    motionState.vz += (waterBuoyancy.waterDragZ + waterBuoyancy.paddleThrustZ) * dt;
    pose.vx = motionState.vx;
    pose.vz = motionState.vz;
  }

  // Synchronize pose with planar motion
  pose.x = motionState.x;
  pose.z = motionState.z;
  pose.yaw = motionState.yaw;
  pose.vx = motionState.vx;
  pose.vz = motionState.vz;

  // -------------------------------------------------------------
  // Authentic Swinging Pendulums Dynamic Motion & Kinetic Collision
  // -------------------------------------------------------------
  const nowSec = performance.now() * 0.001;
  let pendulumStruck = false;

  for (const pend of swingingPendulums) {
    const theta = (pend.amplitude / pend.armLength) * Math.sin(pend.omega * nowSec + pend.phase);
    pend.armGroup.rotation.x = theta;

    // Instantaneous 3D position of the wrecking ball sphere in world space
    const ballWorldY = pend.pivotY - pend.armLength * Math.cos(theta);
    const ballWorldZ = (pend.zCenter + pend.armLength * Math.sin(theta)) * MAP_SCALE;
    const ballWorldX = pend.x * MAP_SCALE;

    // Instantaneous lateral swing velocity (dz/dt in world units)
    const omegaVal = (pend.amplitude / pend.armLength) * pend.omega * Math.cos(pend.omega * nowSec + pend.phase);
    const vBallZ = pend.armLength * Math.cos(theta) * omegaVal * MAP_SCALE;

    // Sphere-to-robot collision check (using effective bounding radii)
    const dx = pose.x - ballWorldX;
    const dy = (pose.y + 0.18) - ballWorldY;
    const dz = pose.z - ballWorldZ;
    const dist = Math.hypot(dx, dy, dz);

    const hitDist = pend.ballRadius * MAP_SCALE + 0.55;
    if (dist < hitDist) {
      // 1. Contact normal from ball center to robot center
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : 0;
      const nz = dist > 0.001 ? dz / dist : 1;
      const overlap = hitDist - dist;

      // 2. Physical solid-body horizontal depenetration (prevents climbing into or glitching through the ball)
      const hDist = Math.hypot(dx, dz);
      const hnx = hDist > 0.001 ? dx / hDist : 0;
      const hnz = hDist > 0.001 ? dz / hDist : (Math.sign(vBallZ) || 1);
      pose.x += hnx * overlap;
      pose.z += hnz * overlap;
      motionState.x = pose.x;
      motionState.z = pose.z;

      // 3. Dynamic momentum transfer & kinetic throw
      if (!pendulumStruck) {
        pendulumStruck = true;

        // Relative lateral speed
        const vRelZ = pose.vz - vBallZ;
        const impactSpeed = Math.abs(vBallZ);

        // Heavy pendulum transfers velocity and flings robot in swing direction
        const throwDirection = Math.sign(vBallZ) || (nz > 0 ? 1 : -1);
        const lateralThrow = throwDirection * Math.max(4.8, impactSpeed * 1.5 + Math.abs(vRelZ) * 0.6);
        const forwardDeflect = hnx * Math.max(1.5, Math.abs(pose.vx) * 0.8);

        pose.vz = lateralThrow;
        pose.vx = forwardDeflect;
        motionState.vz = pose.vz;
        motionState.vx = pose.vx;

        // Clean horizontal lateral fling: zero spurious roll or vertical flip injection
        pose.vy = 0;
        pose.rollRate = 0;
        pose.pitchRate = 0;

        // Horizontal pendulum contact pushes the rover without artificial barrier HP damage
        tone(105, 0.32, 0.14);
        displayToast('PENDULUM IMPACT! STAY WITHIN BOUNDARY LINES!');
      }
    }
  }

  // Track grounded launch origin prior to stepping 3D gravity/ground following
  const localX = pose.x / MAP_SCALE;
  const localZ = pose.z / MAP_SCALE;
  if (pose.isGrounded) {
    const gNow = pose.y + TRACK_CONTACT_OFFSET;
    fallStartOrigin = { x: localX, z: localZ, y: gNow };
    peakAirborneY = gNow;
  }

  // Collision handling against remaining interior structural solids (slalom weave bricks, perimeter walls, piers)
  // Horizontal contact resolves cleanly with ZERO structural HP or barrier score penalties.
  const impactDamage = 0;
  for (let iter = 0; iter < 3; iter++) {
    const hit = collidesWithBarrier(pose.x, pose.z, pose.y);
    if (!hit) break;

    const dot = pose.vx * hit.nx + pose.vz * hit.nz;
    // Resolve the complete overlap along the minimum separating axis each step.
    const separation = hit.depth + 0.005;
    pose.x += hit.nx * separation;
    pose.z += hit.nz * separation;
    motionState.x = pose.x;
    motionState.z = pose.z;
    if (dot < 0) {
      pose.vx -= (1 + 0.08) * dot * hit.nx;
      pose.vz -= (1 + 0.08) * dot * hit.nz;
      motionState.vx = pose.vx;
      motionState.vz = pose.vz;
    }
  }

  // Step 3D Vehicle Dynamics (pitch, roll, ground contour following, rollover)
  // When in deep water, Archimedes buoyant equilibrium prevents vehicle from sinking below waterline
  stepVehicle3D(
    pose,
    (x, z) => {
      const gH = evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE, pose.y);
      if (waterBuoyancy.inWater && waterBuoyancy.isFloating) {
        return Math.max(gH, waterBuoyancy.buoyantWaterlineY + TRACK_CONTACT_OFFSET);
      }
      return gH;
    },
    driveResult.longitudinalSpeed,
    motionState.angular,
    dt,
    9.81,
    false // Broad obstacle reaction yaw torque is handled above via evaluateRockHeight, preserving 100% player steering on ramps and spiral
  );
  if (waterBuoyancy.inWater && waterBuoyancy.isFloating) {
    // Metacentric righting stability while floating in water
    pose.roll *= Math.exp(-dt * 4.0);
    pose.pitch *= Math.exp(-dt * 4.0);
  }

  // Track peak airborne elevation and evaluate multi-factor falls from height
  // (scaled by drop height, landing zone, impact & horizontal speed, and inversion).
  const trackBottomNow = pose.y + TRACK_CONTACT_OFFSET;
  if (!pose.isGrounded) {
    peakAirborneY = Math.max(peakAirborneY, trackBottomNow);
  }
  const justLanded = !lastGroundedState && pose.isGrounded;
  const rawImpactVert = pose.lastImpactSpeed ?? 0;
  if (justLanded || rawImpactVert > 2.30) {
    const dropHeightM = Math.max(0, peakAirborneY - trackBottomNow);
    const landX = pose.x / MAP_SCALE;
    const landZ = pose.z / MAP_SCALE;
    const landingPlace = classifyFallZone(landX, landZ, trackBottomNow);
    const originZone = classifyFallOrigin(fallStartOrigin.x, fallStartOrigin.z, peakAirborneY);
    const horizontalSpeedMps = Math.hypot(pose.vx, pose.vz);
    const fallOutcome = evaluateFallOutcome({
      dropHeightM,
      impactSpeedMps: rawImpactVert,
      horizontalSpeedMps,
      landingPlace,
      originZone,
      isInverted: pose.isFlipped,
    }, config.scoring);

    if (fallOutcome.significantFall) {
      const damageHazard: HazardType = landingPlace === 'sand_pit' ? 'sand' : landingPlace === 'water_basin' ? 'water' : 'none';
      const fallLoss = applyFallImpactDamage(subsystems, fallOutcome.effectiveImpactMps, damageHazard);
      const batShock = applyBatteryShock(subsystems, fallOutcome.batteryShockPct);
      scoreState.fallCount += 1;
      scoreState.penaltyPoints += fallOutcome.pointsPenalty;
      scoreState.score -= fallOutcome.pointsPenalty;
      scoreState.events.push({
        label: `Height Fall (${originZone.replace('_', ' ')})`,
        delta: -fallOutcome.pointsPenalty,
        detail: fallOutcome.summary,
      });
      tone(92, 0.30, 0.13);
      displayToast(`⚠️ FALL (${dropHeightM.toFixed(1)}m · ${landingPlace.replace('_', ' ').toUpperCase()}) · -${Math.max(1, Math.round(fallLoss))}% HP · -${Math.round(batShock)}% BAT · -${fallOutcome.pointsPenalty} PTS`);
    }
    pose.lastImpactSpeed = 0;
    peakAirborneY = trackBottomNow;
    fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: trackBottomNow };
  }
  lastGroundedState = pose.isGrounded;

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

  // Fall Detection & Gate 09 Reset on Lane 4 Narrow Catwalk Bridge
  // Evaluates after 3D fall impact so dropping off the 1.35m catwalk applies true height/battery/point consequences first.
  const inLane4Corridor = Math.abs(localZ - PENDULUM_CONFIG.zLane) <= 2.20;
  if (raceState === 'racing' && !isRobotDestroyed(subsystems) && inLane4Corridor && (currentCheckpoint === 7 || currentCheckpoint === 8)) {
    if (localX >= PENDULUM_CONFIG.xExitEnd && localX <= PENDULUM_CONFIG.xEntryStart) {
      const halfNarrowW = PENDULUM_CONFIG.deckWidth / 2;
      const isOffDeck = Math.abs(localZ - PENDULUM_CONFIG.zLane) > halfNarrowW + 0.08;
      const isBelowElevated = pose.y < (PENDULUM_CONFIG.deckY - 0.35);
      const hitChasmFloor = (pose.y + TRACK_CONTACT_OFFSET) <= ARENA_FLOOR_HEIGHT + 0.12;

      if (isOffDeck && isBelowElevated && (hitChasmFloor || (pose.isFlipped && pose.flippedTimer > 0.35))) {
        const g08Anchor = recoveryAnchors.find(a => a.id === 'north_straight') || recoveryAnchors[0];
        applyRecovery(pose, g08Anchor, worldCourseHeight);
        currentCheckpoint = 7;
        checkpointMeshes.forEach((checkpoint, i) => {
          checkpoint.passed = i < currentCheckpoint;
          (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#f0bd53' : '#88a679');
        });
        motionState.x = pose.x;
        motionState.z = pose.z;
        motionState.vx = 0;
        motionState.vz = 0;
        motionState.yaw = pose.yaw;
        motionState.angular = 0;
        const g08GroundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
        fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: g08GroundY };
        lastGroundedState = true;
        peakAirborneY = g08GroundY;
        scoreState.isOutsideLine = false;
        tone(260, 0.28, 0.08);
        displayToast('FALLEN OFF CATWALK · RESTARTING AT PENDULUM GAUNTLET');
      }
    }
  }

  if (isRobotDestroyed(subsystems)) {
    raceState = 'failed';
    controller.neutralize();
    motionState.vx = 0;
    motionState.vz = 0;
    motionState.angular = 0;
    pose.vx = 0;
    pose.vz = 0;
    pose.yawRate = 0;
    showFailure(subsystems.battery.percentage <= 0 ? 'LiPo battery depleted' : 'Chassis integrity depleted');
  }

  // Update Three.js Robot Rigidbody Position and Rotation (unified rigid structure)
  robot.position.set(pose.x, pose.y, pose.z);
  robot.rotation.y = pose.yaw;
  robotBody.rotation.x = pose.pitch;
  robotBody.rotation.z = pose.roll;
  chassis.rotation.set(0, 0, 0);

  // Position contact shadow on ground beneath vehicle
  const groundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
  const contactPatches = getContactPatches(pose.x, pose.z, pose.yaw);
  const supportGroundY = (
    evaluateCourseHeight(contactPatches.frontLeft.x / MAP_SCALE, contactPatches.frontLeft.z / MAP_SCALE, pose.y)
    + evaluateCourseHeight(contactPatches.frontRight.x / MAP_SCALE, contactPatches.frontRight.z / MAP_SCALE, pose.y)
    + evaluateCourseHeight(contactPatches.rearLeft.x / MAP_SCALE, contactPatches.rearLeft.z / MAP_SCALE, pose.y)
    + evaluateCourseHeight(contactPatches.rearRight.x / MAP_SCALE, contactPatches.rearRight.z / MAP_SCALE, pose.y)
  ) / 4;
  shadow.position.set(pose.x, groundY + 0.015, pose.z);
  shadow.rotation.z = pose.yaw;
  (shadow.material as THREE.MeshBasicMaterial).opacity = pose.isFlipped ? 0.08 : 0.40;

  // Debug hook for automated verification
  (window as unknown as Record<string, unknown>).__gameDebug = {
    track: getActiveTrack().id,
    trackName: getActiveTrack().name,
    setTrack: (id: TrackId) => {
      setActiveTrack(id);
      displayToast(`TRACK: ${getActiveTrack().name.toUpperCase()}`);
    },
    getActiveTrack,
    evaluateCourseHeight: (x: number, z: number, y?: number) => evaluateCourseHeight(x, z, y),
    raceState,
    countdown,
    pose,
    motionState,
    inputs,
    subsystems,
    surface: surf,
    driveResult,
    trackPhase: tracks.map(t => t.phase),
    currentCheckpoint,
    setPose: (newX: number, newZ: number, newYaw?: number) => {
      pose.x = newX;
      pose.z = newZ;
      if (newYaw !== undefined) pose.yaw = newYaw;
      motionState.x = newX;
      motionState.z = newZ;
      if (newYaw !== undefined) motionState.yaw = newYaw;
      previousRacePosition = { x: newX, z: newZ };
    },
    setCurrentCheckpoint: (cp: number) => {
      currentCheckpoint = cp;
      checkpointMeshes.forEach((checkpoint, i) => {
        checkpoint.passed = i < currentCheckpoint;
        (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#f0bd53' : '#88a679');
      });
    },
    getCurrentCheckpoint: () => currentCheckpoint,
    routeClearanceAudit,
    slalomClearanceAudit,
    lastBarrierCollision,
    turntableOmega: turntableCurrentOmega,
    turntableRadius: TURNTABLE_RADIUS,
    waterBuoyancy,
    scoring: {
      scoreState,
      config: config.scoring,
      outOfBoundsFraction: scoreState.lastOutFraction,
      fallOrigin: fallStartOrigin,
      peakAirborneY,
    },
    groundContact: {
      terrainY: evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y),
      supportY: supportGroundY,
      trackBottomY: pose.y + TRACK_CONTACT_OFFSET,
      probes: {
        frontLeft: evaluateCourseHeight(contactPatches.frontLeft.x / MAP_SCALE, contactPatches.frontLeft.z / MAP_SCALE, pose.y),
        frontRight: evaluateCourseHeight(contactPatches.frontRight.x / MAP_SCALE, contactPatches.frontRight.z / MAP_SCALE, pose.y),
        rearLeft: evaluateCourseHeight(contactPatches.rearLeft.x / MAP_SCALE, contactPatches.rearLeft.z / MAP_SCALE, pose.y),
        rearRight: evaluateCourseHeight(contactPatches.rearRight.x / MAP_SCALE, contactPatches.rearRight.z / MAP_SCALE, pose.y),
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

  // Boundary Line Violation Rule (< 50% allowed free; >= 50% uses lifeline buffer first, then minus pts)
  if (raceState === 'racing') {
    const outFraction = computeOutOfBoundsFraction(pose.x, pose.z, pose.yaw, pose.y + TRACK_CONTACT_OFFSET, MAP_SCALE);
    const boundaryStep = stepBoundaryRule(scoreState, outFraction, dt, config.scoring);
    if (boundaryStep.event === 'lifeline_used') {
      tone(330, 0.16, 0.06);
      displayToast(`⚠️ >=50% OUT OF TRACK · LIFELINE USED (${scoreState.remainingLifelines}/${scoreState.totalLifelines} LEFT)`);
    } else if (boundaryStep.event === 'penalty_applied') {
      tone(190, 0.20, 0.08);
      displayToast(`⚠️ BOUNDARY VIOLATION >=50% OUT · -${boundaryStep.pointsDeducted} PTS`);
    }

    // Intra-gate zone award for High-Incline Zigzag Ramp completion on Lane 2
    const hcExitLocalX = pose.x / MAP_SCALE;
    const hcExitLocalZ = pose.z / MAP_SCALE;
    if (
      !scoreState.awardedIds.has('high_climb')
      && previousRacePosition.x / MAP_SCALE > HIGH_CLIMB_CONFIG.xExitEnd - 0.10
      && hcExitLocalX <= HIGH_CLIMB_CONFIG.xExitEnd - 0.10
      && hcExitLocalX >= 6.0
      && Math.abs(hcExitLocalZ - HIGH_CLIMB_CONFIG.laneZ) <= 2.65
      && Math.abs((pose.y + TRACK_CONTACT_OFFSET) - GROUND_DECK_HEIGHT) <= 0.45
    ) {
      const hcPts = awardObstacleZonePoints(scoreState, 'high_climb', config.scoring);
      if (hcPts > 0) {
        tone(640, 0.12, 0.05);
        displayToast(`HIGH-INCLINE ZIGZAG RAMP CLEARED · +${hcPts} PTS [MEDIUM]`);
      }
    }
  }

  // Checkpoint validation
  if (raceState === 'racing' && currentCheckpoint < checkpointMeshes.length) {
    const cp = checkpointMeshes[currentCheckpoint];

    if (crossesCheckpointGate(previousRacePosition, { x: pose.x, z: pose.z }, cp, MAP_SCALE, 1.98, pose.y)) {
      cp.passed = true;
      currentCheckpoint++;
      (cp.bar.material as THREE.MeshBasicMaterial).color.set('#f0bd53');
      tone(620, 0.14, 0.05);
      const gatePts = awardObstacleGatePoints(scoreState, cp.id, config.scoring);
      if (gatePts > 0) {
        displayToast(`GATE ${String(currentCheckpoint).padStart(2, '0')} CLEARED · +${gatePts} PTS`);
      } else {
        displayToast(`GATE ${String(currentCheckpoint).padStart(2, '0')} CLEARED`);
      }

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
  } else if (isPointerLocked) {
    cameraFreeLookIdle = 999999;
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
  const sc = $<HTMLElement>('#score');
  const ll = $<HTMLElement>('#lifelines');
  const t = $<HTMLElement>('#time');
  const g = $<HTMLElement>('#gates');
  const s = $<HTMLElement>('#speed');
  const n = $<HTMLElement>('#next');
  const bat = $<HTMLElement>('#bat');
  const mot = $<HTMLElement>('#mot');
  const hlt = $<HTMLElement>('#hlt');
  const rolloverBanner = $<HTMLElement>('#rolloverAlert');

  if (sc) {
    sc.textContent = String(scoreState.score);
    sc.style.color = scoreState.score < 0 ? '#ff6b6b' : '';
  }
  if (ll) {
    ll.textContent = `🛡️ ${scoreState.remainingLifelines} / ${scoreState.totalLifelines}`;
    const pillLifelines = $<HTMLElement>('#pillLifelines');
    if (pillLifelines) {
      const over50 = raceState === 'racing' && scoreState.lastOutFraction >= 0.50;
      const touching = raceState === 'racing' && scoreState.lastOutFraction > 0.04 && scoreState.lastOutFraction < 0.50;
      pillLifelines.classList.toggle('alert', over50 || scoreState.remainingLifelines === 0);
      pillLifelines.classList.toggle('warn', !over50 && scoreState.remainingLifelines > 0 && touching);
    }
  }
  if (t) t.textContent = formatTime(elapsed);
  if (g) g.textContent = `${String(currentCheckpoint).padStart(2, '0')} / ${checkpointMeshes.length}`;
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

  // Floating Checkpoint Skip Widget State
  const skipContainer = $<HTMLElement>('#floatingSkipContainer');
  const skipTarget = $<HTMLElement>('#skipTargetDetail');
  if (skipContainer) {
    const showSkip = raceState === 'racing' && currentCheckpoint < checkpointMeshes.length;
    skipContainer.classList.toggle('hidden', !showSkip);
    if (showSkip && skipTarget) {
      if (currentCheckpoint < checkpointMeshes.length - 1) {
        skipTarget.innerHTML = `GATE ${String(currentCheckpoint + 1).padStart(2, '0')} &rarr; GATE ${String(currentCheckpoint + 2).padStart(2, '0')}`;
      } else {
        skipTarget.innerHTML = `GATE ${String(currentCheckpoint + 1).padStart(2, '0')} &rarr; FINISH LINE`;
      }
    }
  }

  if (bat) bat.textContent = `${subsystems.battery.percentage.toFixed(0)}%`;
  if (mot) mot.textContent = `${Math.round(Math.max(subsystems.motors.leftTemp, subsystems.motors.rightTemp))}°C`;
  if (hlt) {
    const hPct = Math.round(subsystems.integrity.chassis);
    hlt.textContent = `${hPct}%`;
    const pillHlt = $<HTMLElement>('#pillHlt');
    const hltBar = $<HTMLElement>('#hltBar');
    if (pillHlt) {
      pillHlt.classList.toggle('alert', hPct <= 35);
      pillHlt.classList.toggle('warn', hPct > 35 && hPct <= 70);
    }
    if (hltBar) {
      hltBar.style.width = `${Math.max(0, Math.min(100, hPct))}%`;
      hltBar.style.background = hPct <= 35 ? '#ff5252' : hPct <= 70 ? '#ffb74d' : '#6ee787';
    }
  }

  // Rollover / Sand Pit Trap warning banner & R Long-Press Progress Feedback
  if (rolloverBanner) {
    const lx = pose.x / MAP_SCALE;
    const lz = pose.z / MAP_SCALE;
    const inSandPit = raceState === 'racing'
      && lx >= HANGING_BRIDGE_CONFIG.pitXMin
      && lx <= HANGING_BRIDGE_CONFIG.pitXMax
      && Math.abs(lz - HANGING_BRIDGE_CONFIG.zLane) <= HANGING_BRIDGE_CONFIG.pitHalfZ
      && (pose.y + TRACK_CONTACT_OFFSET) < GROUND_DECK_HEIGHT - 0.15;
    const outOfTrackWarning = raceState === 'racing' && scoreState.lastOutFraction >= 0.50;
    const showBanner = pose.isFlipped || inSandPit || outOfTrackWarning || (rKeyPressed && rHoldDuration > 0.05);
    rolloverBanner.classList.toggle('hidden', !showBanner);
    if (showBanner) {
      if (rKeyPressed && rHoldDuration > 0.05) {
        const pct = Math.min(100, Math.round((rHoldDuration / R_HOLD_RESTART_THRESHOLD) * 100));
        const rem = Math.max(0, R_HOLD_RESTART_THRESHOLD - rHoldDuration).toFixed(1);
        rolloverBanner.textContent = `🔄 RESTARTING GAME IN ${rem}s [${pct}%]... KEEP HOLDING [R]`;
      } else if (pose.isFlipped || inSandPit) {
        if (config.handPoints < 999 && remainingHandPoints <= 0) {
          rolloverBanner.textContent = `⚠️ ${inSandPit ? 'TRAPPED IN SAND PIT' : 'ROBOT OVERTURNED'} · OUT OF HAND POINTS · HOLD [R] TO RESTART`;
        } else {
          const hpMsg = config.handPoints >= 999 ? '∞' : `${remainingHandPoints} LEFT`;
          rolloverBanner.textContent = `⚠️ ${inSandPit ? 'FALLEN IN SAND PIT' : 'ROBOT OVERTURNED'} · TAP [R] OR HAND POINTS TO RECOVER (${hpMsg})`;
        }
      } else if (outOfTrackWarning) {
        const outPct = Math.round(scoreState.lastOutFraction * 100);
        rolloverBanner.textContent = `⚠️ ${outPct}% OUTSIDE BOUNDARY LINES · RETURN INSIDE LANE (${scoreState.remainingLifelines}/${scoreState.totalLifelines} LIFELINES LEFT)`;
      }
    }
  }

  // Telemetry details panel
  if (drivingHudVisible) {
    const tel = $<HTMLElement>('#driveTelemetry');
    if (tel) {
      const inputs = controller.poll();
      tel.innerHTML = `
        SRC: ${inputs.source.toUpperCase()} (${inputs.deviceName})<br>
        SCORE: ${scoreState.score} PTS · OUT-OF-LINE: ${Math.round(scoreState.lastOutFraction * 100)}%<br>
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

  // 1. Dynamic Gerstner Waves on Water (Tranquil, Crystal-Clear Surface)
  // Water remains tranquil; disturbances radiate organically when vehicle tracks plunge in

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
    const h = em.y - (firePlatElevY + 0.12);
    if (h > 1.95) {
      em.y = firePlatElevY + 0.12;
      em.baseX = -4.85 + Math.random() * 3.70;
      em.baseZ = fireLaneZ + (Math.random() - 0.5) * (DRIVE_ROUTE_WIDTH - 1.1);
    } else {
      em.mesh.position.x = em.baseX + Math.sin(em.omega * h + em.phase) * (em.swirlRadius * (1 + h * 0.6));
      em.mesh.position.z = em.baseZ + Math.cos(em.omega * h + em.phase) * (em.swirlRadius * (1 + h * 0.6));
      em.mesh.position.y = em.y;
      const progress = h / 1.95;
      (em.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.95 * (1 - progress * progress));
    }
  }

  // 6. Interactive Vehicle Water Splash Particles on Lane 5
  const inWater = (pose.x / MAP_SCALE >= 0.5 && pose.x / MAP_SCALE <= 9.5 && Math.abs(pose.z / MAP_SCALE - (-13.50)) < DRIVE_ROUTE_WIDTH / 2);
  const robotSpeed = Math.hypot(pose.vx, pose.vz);
  if (inWater && robotSpeed > 0.35) {
    for (let k = 0; k < 2; k++) {
      const p = waterSplashPool.find(drop => drop.life <= 0);
      if (p) {
        const side = k === 0 ? -1 : 1;
        p.mesh.position.set(
          pose.x + (Math.random() - 0.5) * 0.4,
          0.16 * MAP_SCALE,
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
      if (p.life <= 0 || p.mesh.position.y < (-0.30) * MAP_SCALE) {
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
    smoke.position.y = firePlatElevY + 0.55 + phase * 1.35;
    smoke.position.x = -4.85 + i * 0.30 + Math.sin(now * 0.0012 + i) * phase * 0.28;
    smoke.position.z = fireLaneZ + ((i % 4) - 1.5) * 0.65;
    smoke.scale.set(0.42 + phase * 0.52, 0.56 + phase * 0.74, 1);
    (smoke.material as THREE.SpriteMaterial).opacity = 0.42 * (1 - phase);
  }
  for (let i = 0; i < hazardWaterRipples.length; i++) {
    const ripple = hazardWaterRipples[i];
    const phase = (now * 0.0003 + i * 0.21) % 1;
    const size = 0.65 + phase * 0.9;
    ripple.scale.set(size, size, size);
    (ripple.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - phase);
  }

  // 4D Lane 4 Overhead Gantry & Suspension Bridge Flashing Caution Beacons
  const lane4StrobeOn = Math.sin(now * 0.012) > 0.3;
  for (let i = 0; i < gantryStrobes.length; i++) {
    gantryStrobes[i].visible = lane4StrobeOn;
  }
  for (let i = 0; i < suspensionStrobes.length; i++) {
    suspensionStrobes[i].visible = lane4StrobeOn;
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
