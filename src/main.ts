import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  DEFAULT_CAMERA_RETURN_DELAY_SEC,
  stepCameraFreeLook,
  wrapSignedAngleRad,
  type CameraFreeLookState,
} from './cameraControl';
import {
  CYCLE_TUBE_LOOP_LENGTH,
  CYCLE_TUBE_WHEEL_Z,
  createInitialBeltTrackingState,
  sampleCycleTubeLoop,
  stepBeltTrackingState,
  type BeltTrackingState,
  type CycleTubeSampleOptions,
} from './cycleTubeBelt';
import { integrateDrive, slopeAt, type DriveState } from './drivePhysics';
import { CONTROL_PRESETS, type ControlTuning, type VehicleTuning } from './driveControls';
import { DRIVE_SPROCKET_RADIUS_M, MOTOR_SPECIFICATIONS, maxMotorAccelerationMps2, maxTrackSpeedMps } from './drivetrainConfig';
import {
  stepVehicle3D,
  applyRecovery,
  getSafeRecoveryAnchor,
  type RecoveryAnchor,
  type VehiclePose,
  TRACK_WIDTH,
  TRACK_LENGTH,
  TRACK_CONTACT_OFFSET,
  getFootprintAabbHalfExtents,
  getContactPatches,
  evaluateBarrierCollision,
  getTurntableOmega,
  evaluateWaterBuoyancy,
} from './vehicleDynamics';
import {
  createInitialSubsystems,
  stepSubsystems,
  applyFallImpactDamage,
  applyPendulumImpactDamage,
  applyBatteryShock,
  isRobotDestroyed,
  TECHNICAL_TIMEOUT_SECONDS,
  FAULT_REPAIR_META,
  hasAnyHardwareFault,
  getActiveFaultList,
  getEffectiveDrivetrainModifiers,
  createCarryoverSnapshot,
  applyCarryoverSnapshot,
  repairComponentFault,
  repairEnclosureSeal,
  type HardwareFaultId,
  type HardwareCarryoverSnapshot,
  type SubsystemsState,
  type HazardType,
} from './robotSubsystems';
import {
  DEFAULT_SCORING_CONFIG,
  createCompetitionScoreState,
  awardDynamicHurdlePoints,
  awardFootballGoalPoints,
  computeOutOfBoundsFraction,
  stepBoundaryRule,
  evaluateFallOutcome,
  evaluatePendulumStrikeDamage,
  classifyFallZone,
  classifyFallOrigin,
  type ScoringConfig,
  type CompetitionScoreState,
} from './scoringRules';
import {
  UniversalController,
  type AxisCaptureTarget,
  type BindableAction,
  type ControllerConfig,
  type ControllerMode,
  type InputTriggerBinding,
} from './universalController';
import {
  MAP_SCALE,
  ARENA_FLOOR_HEIGHT,
  GROUND_DECK_HEIGHT,
  getActiveTrack,
  setActiveTrack,
  type TrackId,
  evaluateCourseHeight,
  evaluateRockHeight,
  evaluateCourseSurface,
  crossesCheckpointGate,
  type CourseCollider,
} from './courseLayout';
import {
  ARENA_METADATA,
  generateRandomizedCourse,
  setActiveGeneratedCourse,
} from './courseGenerator';
import {
  buildDynamicCourseGroup,
  stepDynamicHurdles,
  type CourseRuntimeHandles,
  type CheckpointMeshRuntime,
  type FootballArenaRuntime,
} from './dynamicCourseBuilder';
import {
  createAsphaltPbrMaps,
  createConcreteSlabPbrMaps,
  createDiamondPlatePbrMaps,
  createFadedPaintPbrMaps,
  createHighClimbPbrMaps,
  createMineralPbrMaps,
  createRoverArmorPbrMaps,
  createRubberTrackPbrMaps,
  createWeatheredWoodPbrMaps,
} from './proceduralTextures';
import './style.css';

const $ = <T extends HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const ui = $<HTMLDivElement>('#ui');
const canvas = $<HTMLCanvasElement>('#game');
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (a: number, b: number, t: number) => a + (b - a) * (1 - Math.exp(-t));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// -------------------------------------------------------------
// 1. Scene, Renderer, Weathered Proving-Ground Lighting & PBR
// -------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#202325');
scene.fog = new THREE.Fog('#202325', 48, 128);

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
renderer.toneMappingExposure = 1.22;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.62;
pmrem.dispose();

scene.add(new THREE.HemisphereLight('#cfd7db', '#3c342b', 1.32));
const sun = new THREE.DirectionalLight('#efe3cb', 2.32);
sun.position.set(-12, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.normalBias = 0.022;
sun.shadow.bias = -0.00018;
scene.add(sun);

const fillSun = new THREE.DirectionalLight('#9ab2c4', 0.76);
fillSun.position.set(16, 15, -14);
scene.add(fillSun);

// Balanced overhead industrial high-bay lighting across all five driving lanes
for (const x of [-16, 0, 16]) {
  for (const z of [-11, 11]) {
    const light = new THREE.PointLight('#efe2c8', 24, 38, 1.45);
    light.position.set(x, 12.2, z);
    scene.add(light);
  }
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
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  // Transparent outer boundary so underlying asphalt, yellow line & road texture stay visible
  ctx.clearRect(0, 0, 512, 512);

  // Outer capillary asphalt-absorption oil stain halo
  const stainGrad = ctx.createRadialGradient(252, 256, 65, 252, 256, 244);
  stainGrad.addColorStop(0, 'rgba(9, 10, 12, 0.72)');
  stainGrad.addColorStop(0.58, 'rgba(13, 14, 16, 0.42)');
  stainGrad.addColorStop(1, 'rgba(15, 16, 18, 0)');
  ctx.fillStyle = stainGrad;
  const lobes: Array<[number, number, number, number, number]> = [
    [256, 256, 222, 188, 0.14],
    [164, 186, 124, 92, -0.35],
    [348, 326, 132, 98, 0.28],
    [192, 338, 105, 76, 0.42],
    [325, 178, 108, 72, -0.25],
    [118, 256, 86, 62, 0.08],
    [396, 248, 92, 68, -0.15],
  ];
  for (const [cx, cy, rx, ry, rot] of lobes) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  }

  // Thick glossy dark crude-petroleum core with organic scalloped margins
  ctx.fillStyle = 'rgba(5, 6, 8, 0.92)';
  const coreLobes: Array<[number, number, number, number, number]> = [
    [254, 256, 182, 152, 0.18],
    [168, 188, 96, 70, -0.38],
    [342, 322, 104, 74, 0.30],
    [195, 330, 82, 58, 0.40],
    [322, 184, 80, 54, -0.22],
    [408, 266, 62, 36, 0.10],
  ];
  for (const [cx, cy, rx, ry, rot] of coreLobes) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle realistic hydrocarbon thin-film sheen (soft diffuse gradients, never comic rings)
  const sheens: Array<[number, number, number, string]> = [
    [215, 224, 118, 'rgba(34, 64, 72, 0.18)'],
    [292, 286, 108, 'rgba(72, 54, 34, 0.15)'],
    [250, 270, 92, 'rgba(52, 36, 64, 0.14)'],
    [176, 196, 64, 'rgba(42, 68, 58, 0.14)'],
  ];
  for (const [sx, sy, sr, col] of sheens) {
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, sr);
    g.addColorStop(0, col);
    g.addColorStop(0.55, col.replace(/0\.\d+\)/, '0.07)'));
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Greasy weaving vehicle tire track smears leaving downstream oil drag marks
  ctx.strokeStyle = 'rgba(4, 5, 7, 0.62)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  for (const laneOffset of [-34, 34]) {
    ctx.beginPath();
    ctx.moveTo(46, 256 + laneOffset + 32);
    ctx.bezierCurveTo(160, 256 + laneOffset + 66, 235, 256 + laneOffset - 68, 340, 256 + laneOffset + 54);
    ctx.bezierCurveTo(405, 256 + laneOffset + 36, 458, 256 + laneOffset - 22, 496, 256 + laneOffset - 18);
    ctx.stroke();
  }

  // Scattered small oil splatters & faint meniscus highlights
  ctx.fillStyle = 'rgba(6, 7, 9, 0.84)';
  for (const [dx, dy, dr] of [[78, 336, 11], [435, 165, 13], [442, 376, 9], [96, 148, 10], [468, 294, 7], [58, 212, 8]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(180, 200, 215, 0.12)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(232, 224, 112, -2.55, -1.35);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const flameTexture = generateFlameTexture();
const oilSlickTexture = generateOilSlickTexture();
const floorMaps = createConcreteSlabPbrMaps('#1e2021', 7);
const asphaltMaps = createAsphaltPbrMaps(4);
const yellowPaintMaps = createFadedPaintPbrMaps('#a68b46', '#3c4042', 2);
const chalkPaintMaps = createFadedPaintPbrMaps('#b5b3aa', '#5c5d58', 2);
const brickMaps = createMineralPbrMaps('#7a5b4a', ['#8a6a58', '#684c3e', '#523b30'], 2);
const woodMaps = createWeatheredWoodPbrMaps();
const rubberMaps = createRubberTrackPbrMaps();
const diamondMaps = createDiamondPlatePbrMaps('#404549');
const concretePierMaps = createConcreteSlabPbrMaps('#45494b', 2);
const sandMaps = createMineralPbrMaps('#8b795c', ['#9c8a6c', '#746349', '#665640'], 5);
const gravelMaps = createMineralPbrMaps('#63635d', ['#7a7970', '#50504a', '#42423d'], 4);
const roverArmorMaps = createRoverArmorPbrMaps();
const highClimbMaps = createHighClimbPbrMaps();
const graniteMaps = createMineralPbrMaps('#5e605e', ['#747674', '#494b49', '#383a38'], 2);
const basaltMaps = createMineralPbrMaps('#2a2c2e', ['#37393c', '#1e1f21'], 2);
const riverStoneMaps = createMineralPbrMaps('#6f685c', ['#80786c', '#5c554b'], 2);
const limestoneMaps = createMineralPbrMaps('#8f897b', ['#9e988a', '#787266'], 2);

const mats = {
  floor: new THREE.MeshStandardMaterial({
    map: floorMaps.map,
    bumpMap: floorMaps.bumpMap,
    bumpScale: 0.025,
    roughness: 0.94,
    metalness: 0.04,
  }),
  asphalt: new THREE.MeshStandardMaterial({
    map: asphaltMaps.map,
    bumpMap: asphaltMaps.bumpMap,
    bumpScale: 0.025,
    roughnessMap: asphaltMaps.roughnessMap,
    roughness: 0.92,
    metalness: 0.04,
  }),
  laneStripeWhite: new THREE.MeshStandardMaterial({
    map: chalkPaintMaps.map,
    bumpMap: chalkPaintMaps.bumpMap,
    bumpScale: 0.008,
    roughness: 0.84,
  }),
  laneStripeYellow: new THREE.MeshStandardMaterial({
    map: yellowPaintMaps.map,
    bumpMap: yellowPaintMaps.bumpMap,
    bumpScale: 0.008,
    roughness: 0.86,
  }),
  curbRed: new THREE.MeshStandardMaterial({ color: '#8c3b31', roughness: 0.80 }),
  curbWhite: new THREE.MeshStandardMaterial({ color: '#aba89e', roughness: 0.82 }),
  barrier: new THREE.MeshStandardMaterial({ map: concretePierMaps.map, bumpMap: concretePierMaps.bumpMap, bumpScale: 0.02, color: '#9c988e', roughness: 0.88 }),
  yellow: new THREE.MeshStandardMaterial({
    map: yellowPaintMaps.map,
    bumpMap: yellowPaintMaps.bumpMap,
    bumpScale: 0.015,
    roughness: 0.82,
    metalness: 0.14,
  }),
  slalomMortar: new THREE.MeshStandardMaterial({ color: '#3b3933', roughness: 0.96 }),
  slalomBrick: new THREE.MeshStandardMaterial({
    map: brickMaps.map,
    bumpMap: brickMaps.bumpMap,
    bumpScale: 0.035,
    roughness: 0.94,
  }),
  slalomBrickLight: new THREE.MeshStandardMaterial({
    map: brickMaps.map,
    bumpMap: brickMaps.bumpMap,
    bumpScale: 0.035,
    color: '#a38974',
    roughness: 0.95,
  }),
  orange: new THREE.MeshStandardMaterial({ color: '#965134', roughness: 0.78, metalness: 0.18 }),
  coverYellow: new THREE.MeshStandardMaterial({
    map: roverArmorMaps.map,
    bumpMap: roverArmorMaps.bumpMap,
    bumpScale: 0.02,
    roughnessMap: roverArmorMaps.roughnessMap,
    roughness: 0.78,
    metalness: 0.28,
  }),
  black: new THREE.MeshStandardMaterial({ color: '#181a1c', roughness: 0.80, metalness: 0.22 }),
  rubber: new THREE.MeshStandardMaterial({
    map: rubberMaps.map,
    bumpMap: rubberMaps.bumpMap,
    bumpScale: 0.032,
    roughness: 0.94,
    metalness: 0.04,
  }),
  metal: new THREE.MeshStandardMaterial({ color: '#4d5459', roughness: 0.52, metalness: 0.74 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#959c9f', roughness: 0.30, metalness: 0.82 }),
  wheel: new THREE.MeshStandardMaterial({ color: '#8f8c82', roughness: 0.62, metalness: 0.42 }),
  wood: new THREE.MeshStandardMaterial({
    map: woodMaps.map,
    bumpMap: woodMaps.bumpMap,
    bumpScale: 0.03,
    roughness: 0.90,
    metalness: 0.04,
  }),
  red: new THREE.MeshStandardMaterial({ color: '#8d352d', roughness: 0.72 }),
  green: new THREE.MeshStandardMaterial({ color: '#4a6648', roughness: 0.90 }),
  sand: new THREE.MeshStandardMaterial({
    map: sandMaps.map,
    bumpMap: sandMaps.bumpMap,
    bumpScale: 0.025,
    roughness: 0.98,
  }),
  gravel: new THREE.MeshStandardMaterial({
    map: gravelMaps.map,
    bumpMap: gravelMaps.bumpMap,
    bumpScale: 0.032,
    roughness: 0.96,
  }),
  turf: new THREE.MeshStandardMaterial({ color: '#2b422d', roughness: 0.95 }),
  ice: new THREE.MeshStandardMaterial({ color: '#4c595c', roughness: 0.22, metalness: 0.38, map: generateSurfaceTexture('#4c595c', ['#809094', '#384245'], 'slick') }),
  bridge: new THREE.MeshStandardMaterial({ color: '#535a5e', roughness: 0.56, metalness: 0.58 }),
  diamondPlate: new THREE.MeshStandardMaterial({
    map: diamondMaps.map,
    bumpMap: diamondMaps.bumpMap,
    bumpScale: 0.028,
    roughnessMap: diamondMaps.roughnessMap,
    roughness: 0.56,
    metalness: 0.72,
  }),
  concreteCurb: new THREE.MeshStandardMaterial({
    map: concretePierMaps.map,
    bumpMap: concretePierMaps.bumpMap,
    bumpScale: 0.02,
    color: '#9c9b92',
    roughness: 0.90,
  }),
  fiaRed: new THREE.MeshStandardMaterial({ color: '#8f2924', roughness: 0.78 }),
  fiaWhite: new THREE.MeshStandardMaterial({ color: '#b4b1a7', roughness: 0.78 }),
  trussRed: new THREE.MeshStandardMaterial({ color: '#87332e', roughness: 0.52, metalness: 0.65 }),
  trussWhite: new THREE.MeshStandardMaterial({ color: '#a8aa9e', roughness: 0.54, metalness: 0.50 }),
  concretePier: new THREE.MeshStandardMaterial({
    map: concretePierMaps.map,
    bumpMap: concretePierMaps.bumpMap,
    bumpScale: 0.028,
    roughness: 0.94,
  }),
  cardboard: new THREE.MeshStandardMaterial({
    map: woodMaps.map,
    bumpMap: woodMaps.bumpMap,
    bumpScale: 0.02,
    color: '#9c7e5b',
    roughness: 0.88,
    metalness: 0.04,
    side: THREE.DoubleSide,
  }),
  cardboardEdge: new THREE.MeshStandardMaterial({
    color: '#6e5234',
    roughness: 0.94,
    metalness: 0.04,
    side: THREE.DoubleSide,
  }),
  stakeMetal: new THREE.MeshStandardMaterial({
    color: '#41474c',
    roughness: 0.42,
    metalness: 0.80,
  }),
  oil: new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: oilSlickTexture,
    bumpMap: asphaltMaps.bumpMap,
    bumpScale: 0.014,
    roughness: 0.56,
    metalness: 0.02,
    envMapIntensity: 0.14,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  }),
  highClimbDeck: new THREE.MeshStandardMaterial({
    map: highClimbMaps.map,
    bumpMap: highClimbMaps.bumpMap,
    bumpScale: 0.02,
    roughness: 0.34,
    metalness: 0.36,
  }),
  water: new THREE.MeshStandardMaterial({
    color: '#19454e',
    emissive: '#05151a',
    roughness: 0.08,
    metalness: 0.14,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  waterFoam: new THREE.MeshStandardMaterial({
    color: '#9fb4b8',
    roughness: 0.45,
    transparent: true,
    opacity: 0.50,
    side: THREE.DoubleSide,
  }),
  flameTongue: new THREE.MeshBasicMaterial({
    map: flameTexture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  granite: new THREE.MeshStandardMaterial({
    map: graniteMaps.map,
    bumpMap: graniteMaps.bumpMap,
    bumpScale: 0.03,
    roughness: 0.90,
    metalness: 0.06,
  }),
  basalt: new THREE.MeshStandardMaterial({
    map: basaltMaps.map,
    bumpMap: basaltMaps.bumpMap,
    bumpScale: 0.03,
    roughness: 0.92,
    metalness: 0.12,
  }),
  riverStone: new THREE.MeshStandardMaterial({
    map: riverStoneMaps.map,
    bumpMap: riverStoneMaps.bumpMap,
    bumpScale: 0.025,
    roughness: 0.80,
    metalness: 0.04,
  }),
  limestone: new THREE.MeshStandardMaterial({
    map: limestoneMaps.map,
    bumpMap: limestoneMaps.bumpMap,
    bumpScale: 0.025,
    roughness: 0.88,
    metalness: 0.04,
  }),
  sandstone: new THREE.MeshStandardMaterial({
    map: sandMaps.map,
    bumpMap: sandMaps.bumpMap,
    bumpScale: 0.02,
    color: '#8e7e66',
    roughness: 0.92,
  }),
  gravelBed: new THREE.MeshStandardMaterial({
    map: gravelMaps.map,
    bumpMap: gravelMaps.bumpMap,
    bumpScale: 0.025,
    roughness: 0.95,
  }),
  magmaBed: new THREE.MeshStandardMaterial({
    color: '#190804',
    emissive: '#b83406',
    emissiveIntensity: 2.1,
    roughness: 0.88,
  }),
  fire: new THREE.MeshStandardMaterial({ color: '#b5431c', emissive: '#c4450d', emissiveIntensity: 1.75, roughness: 0.45 }),
  fireCore: new THREE.MeshStandardMaterial({
    color: '#e8dcc2',
    emissive: '#e0c078',
    emissiveIntensity: 2.4,
    roughness: 0.25,
    transparent: true,
    opacity: 0.90,
  }),
  fireMantle: new THREE.MeshStandardMaterial({
    color: '#d45c17',
    emissive: '#c4460c',
    emissiveIntensity: 1.9,
    roughness: 0.35,
    transparent: true,
    opacity: 0.84,
  }),
  fireRuby: new THREE.MeshStandardMaterial({
    color: '#9c1c0b',
    emissive: '#781004',
    emissiveIntensity: 1.4,
    roughness: 0.45,
    transparent: true,
    opacity: 0.74,
  }),
  charcoal: new THREE.MeshStandardMaterial({
    color: '#1a1715',
    emissive: '#9e2608',
    emissiveIntensity: 1.5,
    roughness: 0.94,
  }),
  ember: new THREE.MeshBasicMaterial({
    color: '#c97834',
    transparent: true,
    opacity: 0.88,
  }),
  splashDrop: new THREE.MeshBasicMaterial({
    color: '#85adb5',
    transparent: true,
    opacity: 0.72,
  }),
  laserCyan: new THREE.MeshBasicMaterial({ color: '#398f76', transparent: true, opacity: 0.50, side: THREE.DoubleSide }),
  laserGold: new THREE.MeshBasicMaterial({ color: '#ad8944', transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
  beaconAmber: new THREE.MeshBasicMaterial({ color: '#b57b3c' }),
  beaconRed: new THREE.MeshBasicMaterial({ color: '#9c3e3a' }),
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
// 2. Dynamic Procedural Course Builder & Runtime State
// -------------------------------------------------------------
const colliders: CourseCollider[] = [];
(window as unknown as Record<string, unknown>).__colliders = colliders;

let courseSeedCounter = 1;
function nextCourseSeed(): number {
  courseSeedCounter += 1;
  return (Date.now() ^ Math.imul(courseSeedCounter, 2654435761)) >>> 0;
}

let runtimeCourse: CourseRuntimeHandles;
let checkpointMeshes: CheckpointMeshRuntime[] = [];
let recoveryAnchors: RecoveryAnchor[] = [];
const worldCourseHeight = (x: number, z: number) => evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE);

function disposeCourseChildren(group: THREE.Group) {
  const toRemove = [...group.children];
  for (const child of toRemove) {
    group.remove(child);
  }
}

function buildCourseForTrack(trackId: TrackId, seed = nextCourseSeed()): CourseRuntimeHandles {
  setActiveTrack(trackId);
  const plan = generateRandomizedCourse(trackId, seed);
  setActiveGeneratedCourse(plan);
  disposeCourseChildren(course);
  runtimeCourse = buildDynamicCourseGroup(course, colliders, plan, mats);
  checkpointMeshes = runtimeCourse.checkpoints;
  recoveryAnchors = runtimeCourse.recoveryAnchors;
  const gatesHud = document.querySelector<HTMLElement>("#gates");
  if (gatesHud) gatesHud.textContent = `00 / ${checkpointMeshes.length}`;
  return runtimeCourse;
}

// Initialize showcase circuit with randomized obstacles right at boot
runtimeCourse = buildCourseForTrack(getActiveTrack().id, nextCourseSeed());

(window as unknown as Record<string, unknown>).__gameDebug = {
  get track() { return getActiveTrack().id; },
  get trackName() { return ARENA_METADATA[getActiveTrack().id].name; },
  setTrack: (id: TrackId, seed?: number) => {
    buildCourseForTrack(id, seed);
    if (raceState === 'menu') showMenu();
  },
  reshuffleCourse: (seed?: number) => buildCourseForTrack(getActiveTrack().id, seed),
  get generatedCourse() { return runtimeCourse.plan; },
  get checkpoints() { return checkpointMeshes; },
  get footballArenas() { return runtimeCourse.footballArenas; },
  getActiveTrack,
  evaluateCourseHeight: (x: number, z: number, y?: number) => evaluateCourseHeight(x, z, y),
};

// -------------------------------------------------------------
// 7. Fixed Rigid Robot Model with Realistic Mechatronics (Part 3)
// -------------------------------------------------------------
const robot = new THREE.Group();
robot.rotation.order = 'YXZ';
scene.add(robot);

// RIGID 'I'-FRAME CHASSIS: open-wheel 'I' structure with front & rear cross-arms,
// narrow central spine (zero square tub / zero yellow cover boxes), and 4 corner pulley wheels.
const robotBody = new THREE.Group();
robotBody.rotation.order = 'YXZ';
robot.add(robotBody);

const chassis = new THREE.Group();
robotBody.add(chassis);

// Central longitudinal structural spine (the stem of the 'I', leaving open daylight cutouts on left/right)
box(chassis, mats.black, V(0, 0.35, 0), V(0.44, 0.14, 1.12));
for (const sx of [-0.20, 0.20]) {
  box(chassis, mats.metal, V(sx, 0.44, 0), V(0.042, 0.12, 1.06));
  for (const bz of [-0.42, -0.14, 0.14, 0.42]) {
    cyl(chassis, mats.chrome, V(sx, 0.505, bz), 0.014, 0.018, 'y', 8);
  }
}

// Front & Rear Cross-Arms (top and bottom bars of the 'I' reaching to the 4 corner wheel hubs)
for (const end of [-1, 1]) {
  const armZ = end * CYCLE_TUBE_WHEEL_Z;
  box(chassis, mats.metal, V(0, 0.34, armZ), V(1.38, 0.14, 0.19));
  box(chassis, mats.black, V(0, 0.42, armZ), V(1.16, 0.025, 0.13));
  for (const side of [-1, 1]) {
    // Corner axle pillow-block housing & forged steel stub shaft carrying each corner pulley wheel
    box(chassis, mats.metal, V(side * 0.66, 0.33, armZ), V(0.12, 0.15, 0.21));
    cyl(chassis, mats.chrome, V(side * 0.72, 0.32, armZ), 0.042, 0.24, 'x', 14);
    // Triangular corner gusset plates tying cross-arms cleanly to the central spine
    box(chassis, mats.metal, V(side * 0.26, 0.34, armZ - end * 0.11), V(0.11, 0.09, 0.11));
  }
}
box(chassis, mats.metal, V(0, 0.34, 0.68), V(1.04, 0.10, 0.05));
box(chassis, mats.metal, V(0, 0.34, -0.68), V(1.04, 0.10, 0.05));

// Field-worn Mechatronics neatly mounted along the narrow central 'I' spine:
// 1. 4S LiPo Battery pack centered on spine (mutates visibly if cells swell)
const batteryWrapMat = new THREE.MeshStandardMaterial({ color: '#273b50', roughness: 0.72, metalness: 0.08 });
const batteryLabelMat = new THREE.MeshStandardMaterial({ map: yellowPaintMaps.map, bumpMap: yellowPaintMaps.bumpMap, bumpScale: 0.015, roughness: 0.82, metalness: 0.14 });
const batteryMesh = box(chassis, batteryWrapMat, V(0, 0.49, -0.06), V(0.34, 0.14, 0.54));
const batteryLabelMesh = box(chassis, batteryLabelMat, V(0, 0.565, -0.06), V(0.20, 0.014, 0.30));
const batteryStrapMeshes: THREE.Mesh[] = [];
for (const strapZ of [-0.21, 0.09]) {
  batteryStrapMeshes.push(box(chassis, mats.black, V(0, 0.50, strapZ), V(0.36, 0.155, 0.045)));
}

// 2. Dual Geared 600RPM Drive Motors mounted symmetrically on Rear Cross-Arm
const motorStatorMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] = [
  new THREE.MeshStandardMaterial({ color: '#915538', metalness: 0.72, roughness: 0.44 }),
  new THREE.MeshStandardMaterial({ color: '#915538', metalness: 0.72, roughness: 0.44 }),
];
for (const side of [-1, 1]) {
  const mx = side * 0.46;
  const stMat = motorStatorMats[side < 0 ? 0 : 1];
  cyl(chassis, mats.metal, V(mx, 0.34, -0.58), 0.105, 0.28, 'x');
  cyl(chassis, stMat, V(mx, 0.34, -0.58), 0.09, 0.19, 'x');
  cyl(chassis, mats.black, V(mx - side * 0.145, 0.34, -0.58), 0.082, 0.03, 'x');
}

// 3. Dual ESCs with extruded heat sinks & diagnostic PCB fault beacon on forward spine
const escHeatSinkMats = [
  new THREE.MeshStandardMaterial({ color: '#5b2424', roughness: 0.48, metalness: 0.68 }),
  new THREE.MeshStandardMaterial({ color: '#5b2424', roughness: 0.48, metalness: 0.68 }),
];
for (let ei = 0; ei < 2; ei++) {
  const x = ei === 0 ? -0.105 : 0.105;
  box(chassis, escHeatSinkMats[ei], V(x, 0.47, 0.34), V(0.18, 0.075, 0.22));
  for (let f = -0.065; f <= 0.065; f += 0.032) {
    box(chassis, mats.metal, V(x + f, 0.515, 0.34), V(0.013, 0.035, 0.20));
  }
}
const faultStatusLedMat = new THREE.MeshBasicMaterial({ color: '#42b866' });
cyl(chassis, faultStatusLedMat, V(0, 0.49, 0.47), 0.020, 0.02, 'y', 10);
const circuitSparkLight = new THREE.PointLight(0x7cc4ff, 0, 2.2, 2.0);
circuitSparkLight.position.set(0, 0.56, 0.34);
chassis.add(circuitSparkLight);

// 4. Compact Telemetry Arch, Optical IMU Pod & Dual Spring-Base Whip Antennas on Rear Cross-Arm
const trackCovers: THREE.Mesh[] = []; // Used by Cutaway toggle to hide upper telemetry arch cleanly
for (const sx of [-0.34, 0.34]) {
  trackCovers.push(cyl(chassis, mats.metal, V(sx, 0.55, -0.58), 0.022, 0.26, 'y', 10));
}
trackCovers.push(box(chassis, mats.metal, V(0, 0.68, -0.58), V(0.72, 0.04, 0.04)));
trackCovers.push(box(chassis, mats.black, V(0, 0.725, -0.57), V(0.22, 0.08, 0.10)));
trackCovers.push(cyl(chassis, new THREE.MeshStandardMaterial({ color: '#142026', roughness: 0.18, metalness: 0.75 }), V(0, 0.725, -0.515), 0.028, 0.02, 'z', 14));
cyl(chassis, mats.chrome, V(-0.12, 0.49, -0.42), 0.018, 0.07, 'y');
cyl(chassis, mats.chrome, V(0.12, 0.49, -0.42), 0.018, 0.07, 'y');
cyl(chassis, mats.black, V(-0.12, 0.71, -0.42), 0.011, 0.44, 'y');
cyl(chassis, mats.black, V(0.12, 0.71, -0.42), 0.011, 0.44, 'y');

// 5. Braided silicone power cables and XT60 bus along center spine
cyl(chassis, mats.red, V(-0.035, 0.52, 0.16), 0.013, 0.26, 'z');
cyl(chassis, mats.black, V(0.035, 0.52, 0.16), 0.013, 0.26, 'z');
box(chassis, mats.metal, V(0, 0.52, 0.24), V(0.055, 0.035, 0.065));

// 6. Warm Tungsten-Halogen Armored Projector Headlights integrated on Front Cross-Arm
for (const side of [-1, 1]) {
  const hx = side * 0.34;
  cyl(chassis, mats.metal, V(hx, 0.43, 0.67), 0.055, 0.055, 'z');
  cyl(chassis, new THREE.MeshBasicMaterial({ color: '#e6d0a1' }), V(hx, 0.43, 0.695), 0.040, 0.02, 'z');
  const ringBezel = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.008, 8, 16), mats.chrome);
  ringBezel.position.set(hx, 0.43, 0.702);
  chassis.add(ringBezel);
  const headSpot = new THREE.SpotLight(0xead6aa, 5.5, 9.0, Math.PI / 4.5, 0.45, 1.25);
  headSpot.position.set(hx, 0.43, 0.70);
  headSpot.target.position.set(hx, 0.15, 3.5);
  chassis.add(headSpot);
  chassis.add(headSpot.target);
}

// 7. Heavy Forged Steel Tow Recovery Shackles on Front & Rear Cross-Arms
for (const end of [-1, 1]) {
  const bz = end * 0.70;
  for (const sx of [-0.34, 0.34]) {
    cyl(chassis, mats.metal, V(sx, 0.34, bz), 0.022, 0.055, 'x');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.010, 8, 16), mats.chrome);
    ring.position.set(sx, 0.34, bz + end * 0.036);
    ring.rotation.x = Math.PI / 2;
    chassis.add(ring);
  }
}

// 4 Corner Flanged Pulley Wheels + Dynamic Curved Cycle-Tube Belts (no yellow boxes, no mid rollers)
const CYCLE_TUBE_LOOP_SEGMENTS = 84;
// 6-point rounded tubular belt profile across pulley width [localDx, normalOffset]
const CYCLE_TUBE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.156, 0.002],
  [-0.122, 0.015],
  [0.122, 0.015],
  [0.156, 0.002],
  [0.136, -0.015],
  [-0.136, -0.015],
];

function createDynamicCycleTubeBeltGeometry(sideSign: -1 | 1): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const ringPts = CYCLE_TUBE_PROFILE.length;
  const ringStride = ringPts + 1;
  const vertCount = (CYCLE_TUBE_LOOP_SEGMENTS + 1) * ringStride;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let i = 0; i <= CYCLE_TUBE_LOOP_SEGMENTS; i++) {
    const vCoord = (i / CYCLE_TUBE_LOOP_SEGMENTS) * 4.0;
    for (let k = 0; k <= ringPts; k++) {
      const idx = i * ringStride + k;
      uvs[idx * 2] = k / ringPts;
      uvs[idx * 2 + 1] = vCoord;
    }
  }
  for (let i = 0; i < CYCLE_TUBE_LOOP_SEGMENTS; i++) {
    for (let k = 0; k < ringPts; k++) {
      const a = i * ringStride + k;
      const b = (i + 1) * ringStride + k;
      const c = (i + 1) * ringStride + k + 1;
      const d = i * ringStride + k + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  updateDynamicCycleTubeBeltGeometry(geo, { sideSign });
  return geo;
}

function updateDynamicCycleTubeBeltGeometry(geo: THREE.BufferGeometry, options: CycleTubeSampleOptions) {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const ringPts = CYCLE_TUBE_PROFILE.length;
  const ringStride = ringPts + 1;

  for (let i = 0; i <= CYCLE_TUBE_LOOP_SEGMENTS; i++) {
    const dist = ((i % CYCLE_TUBE_LOOP_SEGMENTS) / CYCLE_TUBE_LOOP_SEGMENTS) * CYCLE_TUBE_LOOP_LENGTH;
    const sample = sampleCycleTubeLoop(dist, options);
    const cosRoll = Math.cos(sample.rollX);
    const sinRoll = Math.sin(sample.rollX);

    for (let k = 0; k <= ringPts; k++) {
      const [dx, dn] = CYCLE_TUBE_PROFILE[k % ringPts];
      // Apply cross-section roll & outward normal offset from curved cycle-tube spine
      const rolledDx = dx * cosRoll;
      const rolledDy = dx * sinRoll;
      const vx = sample.x + rolledDx;
      const vy = sample.y + sample.ny * dn + rolledDy;
      const vz = sample.z + sample.nz * dn;

      const idx3 = (i * ringStride + k) * 3;
      arr[idx3] = vx;
      arr[idx3 + 1] = vy;
      arr[idx3 + 2] = vz;
    }
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
}

const tracks: {
  group: THREE.Group;
  sideSign: -1 | 1;
  beltGeo: THREE.BufferGeometry;
  cleats: THREE.Mesh[];
  wheelSpins: THREE.Group[];
  phase: number;
}[] = [];

for (const side of [-1, 1] as const) {
  const x = side * (TRACK_WIDTH / 2);
  const trackGroup = new THREE.Group();
  trackGroup.position.x = x;
  robotBody.add(trackGroup);

  // Dynamic curved bicycle inner-tube belt looping around the two corner wheels on this side
  const beltGeo = createDynamicCycleTubeBeltGeometry(side);
  const belt = new THREE.Mesh(beltGeo, mats.rubber);
  belt.castShadow = true;
  belt.receiveShadow = true;
  trackGroup.add(belt);

  // Two open flanged pulley wheels per side positioned at the outer corners of the 'I'
  const wheelSpins: THREE.Group[] = [];
  for (const end of [-1, 1]) {
    const isPowered = end < 0; // Rear corner wheels driven by the twin 600RPM rear cross-arm motors
    const spin = new THREE.Group();
    spin.position.set(0, 0.32, end * CYCLE_TUBE_WHEEL_Z);
    trackGroup.add(spin);
    const wheel = cyl(spin, mats.wheel, V(0, 0, 0), DRIVE_SPROCKET_RADIUS_M - 0.004, 0.30, 'x', 24);
    wheel.userData = { role: isPowered ? 'motor-driven corner pulley' : 'passive front corner pulley' };
    // Inner traction drum + open-hub toroidal pulley retention flanges so spokes & lugs remain visible
    cyl(spin, mats.black, V(0, 0, 0), DRIVE_SPROCKET_RADIUS_M + 0.002, 0.25, 'x', 24);
    for (const fx of [-0.156, 0.156]) {
      const flange = new THREE.Mesh(new THREE.TorusGeometry(DRIVE_SPROCKET_RADIUS_M + 0.006, 0.012, 8, 28), mats.chrome);
      flange.position.set(fx, 0, 0);
      flange.rotation.y = Math.PI / 2;
      flange.castShadow = true;
      spin.add(flange);
    }
    cyl(spin, mats.metal, V(side * 0.168, 0, 0), 0.058, 0.038, 'x', 12);
    for (let b = 0; b < 6; b++) {
      const ang = (b * Math.PI) / 3;
      cyl(spin, mats.chrome, V(side * 0.168, Math.sin(ang) * 0.105, Math.cos(ang) * 0.105), 0.013, 0.024, 'x', 8);
    }
    wheelSpins.push(spin);
  }

  // Molded vulcanized rubber grip ribs riding along the curved cycle-tube loop
  const cleats: THREE.Mesh[] = [];
  const cleatGeo = new THREE.BoxGeometry(0.28, 0.020, 0.085);
  for (let i = 0; i < 20; i++) {
    const point = sampleCycleTubeLoop((i / 20) * CYCLE_TUBE_LOOP_LENGTH, { sideSign: side });
    const q = new THREE.Mesh(cleatGeo, mats.black);
    q.position.set(point.x, point.y, point.z);
    q.rotation.x = point.rotationX;
    q.rotation.z = point.rollX;
    q.castShadow = true;
    trackGroup.add(q);
    cleats.push(q);
  }

  tracks.push({ group: trackGroup, sideSign: side, beltGeo, cleats, wheelSpins, phase: 0 });
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
const splashMat = new THREE.MeshBasicMaterial({ color: '#a5bec2', transparent: true, opacity: 0.64, depthWrite: false });
const splashParticles: Array<{ mesh: THREE.Mesh; life: number; vx: number; vy: number; vz: number }> = [];
for (let i = 0; i < 24; i++) {
  const m = new THREE.Mesh(splashGeo, splashMat);
  m.visible = false;
  scene.add(m);
  splashParticles.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
}

// Hardware Fault Smoke & Venting Vapor Particle Pool (for swollen LiPo, burnt motors, shorted ESC)
const faultSmokeGeo = new THREE.SphereGeometry(0.065, 6, 5);
const faultSmokeParticles: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; vx: number; vy: number; vz: number }> = [];
for (let i = 0; i < 20; i++) {
  const mat = new THREE.MeshBasicMaterial({ color: '#2b2826', transparent: true, opacity: 0, depthWrite: false });
  const m = new THREE.Mesh(faultSmokeGeo, mat);
  m.visible = false;
  scene.add(m);
  faultSmokeParticles.push({ mesh: m, mat, life: 0, vx: 0, vy: 0, vz: 0 });
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

const HARDWARE_CARRYOVER_KEY = 'robo-race-hardware-v1';

function loadCarriedHardware(): HardwareCarryoverSnapshot | null {
  try {
    const raw = localStorage.getItem(HARDWARE_CARRYOVER_KEY);
    return raw ? (JSON.parse(raw) as HardwareCarryoverSnapshot) : null;
  } catch {
    return null;
  }
}

function saveCarriedHardware(snap: HardwareCarryoverSnapshot | null) {
  try {
    if (!snap) {
      localStorage.removeItem(HARDWARE_CARRYOVER_KEY);
    } else {
      localStorage.setItem(HARDWARE_CARRYOVER_KEY, JSON.stringify(snap));
    }
  } catch {}
}

let carriedHardware: HardwareCarryoverSnapshot | null = loadCarriedHardware();
let roundNumber = carriedHardware?.roundNumber ?? 1;
let subsystems: SubsystemsState = createInitialSubsystems();
applyCarryoverSnapshot(subsystems, carriedHardware);

let raceState: 'menu' | 'tech_timeout' | 'countdown' | 'racing' | 'paused' | 'finished' | 'failed' = 'menu';
let techTimeoutRemaining = TECHNICAL_TIMEOUT_SECONDS;
let techTimeoutUsedThisRound = false;
let techTimeoutContext: 'pre_round' | 'mid_race' = 'pre_round';
let techTimeoutOnDone: (() => void) | null = null;
let elapsed = 0;
let penaltyTime = 0;
let countdown = 0;

let beltTracking: BeltTrackingState = createInitialBeltTrackingState();
let lastFrameBeltShock = 0;

function syncRobotVisualHardwareState(timeSec: number) {
  const f = subsystems.faults;
  // 1. LiPo battery physical swelling & strained straps on central 'I' spine
  if (f.batterySwollen) {
    batteryMesh.scale.set(1.14, 1.72, 1.06);
    batteryMesh.position.y = 0.54;
    batteryLabelMesh.position.y = 0.665;
    batteryLabelMesh.scale.set(1.06, 1.0, 1.02);
    batteryWrapMat.color.set('#3f3b32');
    batteryWrapMat.roughness = 0.88;
    batteryStrapMeshes.forEach(s => s.scale.set(1.12, 1.55, 1.02));
  } else {
    batteryMesh.scale.set(1, 1, 1);
    batteryMesh.position.y = 0.49;
    batteryLabelMesh.position.y = 0.565;
    batteryLabelMesh.scale.set(1, 1, 1);
    batteryWrapMat.color.set('#273b50');
    batteryWrapMat.roughness = 0.72;
    batteryStrapMeshes.forEach(s => s.scale.set(1, 1, 1));
  }

  // 2. Motor stator charring (-1 side index 0 = left, +1 side index 1 = right)
  motorStatorMats[0].color.set(f.leftMotorBurnt ? '#1c1816' : '#915538');
  motorStatorMats[0].metalness = f.leftMotorBurnt ? 0.18 : 0.72;
  motorStatorMats[0].roughness = f.leftMotorBurnt ? 0.94 : 0.44;
  motorStatorMats[1].color.set(f.rightMotorBurnt ? '#1c1816' : '#915538');
  motorStatorMats[1].metalness = f.rightMotorBurnt ? 0.18 : 0.72;
  motorStatorMats[1].roughness = f.rightMotorBurnt ? 0.94 : 0.44;

  // 3. ESC scorching, status LED & electric arc sparking
  escHeatSinkMats.forEach(m => {
    m.color.set(f.circuitBurnt ? '#201a19' : '#5b2424');
    m.roughness = f.circuitBurnt ? 0.88 : 0.48;
    m.metalness = f.circuitBurnt ? 0.22 : 0.68;
  });
  const faultAny = hasAnyHardwareFault(subsystems);
  if (f.circuitBurnt) {
    const arcPulse = Math.sin(timeSec * 29.0) * Math.cos(timeSec * 41.0);
    faultStatusLedMat.color.set(arcPulse > 0 ? '#ff3b30' : '#4a1412');
    circuitSparkLight.intensity = arcPulse > 0.62 ? 2.4 : 0;
  } else if (faultAny) {
    faultStatusLedMat.color.set(Math.sin(timeSec * 8.0) > 0 ? '#f0b84e' : '#523c15');
    circuitSparkLight.intensity = 0;
  } else {
    faultStatusLedMat.color.set('#42b866');
    circuitSparkLight.intensity = 0;
  }
}
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
function formatTriggerBinding(binding?: InputTriggerBinding): string {
  if (!binding || binding.kind === 'none') return 'Disabled';
  if (binding.kind === 'button') return `Btn ${binding.index}`;
  return `Ch ${binding.index} ${binding.direction === 'high' ? '↑ High' : '↓ Low'}`;
}

function syncSettingsControlsFromController() {
  const ctrlConfig = controller.getConfig();
  config.sensitivity = ctrlConfig.sensitivity;
  config.deadzone = ctrlConfig.deadzone;
  config.expo = ctrlConfig.expo;
  config.controlMode = ctrlConfig.mode;
  const sensEl = document.querySelector<HTMLInputElement>('#sens');
  if (sensEl) sensEl.value = String(config.sensitivity);
  const deadEl = document.querySelector<HTMLInputElement>('#dead');
  if (deadEl) deadEl.value = String(config.deadzone);
  const expoEl = document.querySelector<HTMLInputElement>('#expo');
  if (expoEl) expoEl.value = String(config.expo);
  const modeEl = document.querySelector<HTMLSelectElement>('#controlMode');
  if (modeEl) modeEl.value = config.controlMode;
}

function syncDiagnosticsUI() {
  const profile = controller.getCurrentProfile();
  const ctrlConfig = controller.getConfig();
  const diag = controller.getDiagnostics();
  const devices = controller.getConnectedDevices();

  const devSelect = $<HTMLSelectElement>('#diagDeviceSelect');
  if (devSelect) {
    devSelect.replaceChildren();
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No USB controller connected (Keyboard active)';
      devSelect.appendChild(opt);
    } else {
      if (diag.activeDeviceIndex === null) {
        const detachedOpt = document.createElement('option');
        detachedOpt.value = '';
        detachedOpt.textContent = '-- Controller Detached · Keyboard Active (Scan USB or select below) --';
        devSelect.appendChild(detachedOpt);
      }
      for (const dev of devices) {
        const opt = document.createElement('option');
        opt.value = String(dev.index);
        const tag = dev.type.startsWith('transmitter') ? 'TX' : 'PAD';
        opt.textContent = `[#${dev.index} · ${tag}] ${dev.id} (${dev.axesCount}ch/${dev.buttonsCount}btn)`;
        devSelect.appendChild(opt);
      }
      devSelect.value = diag.activeDeviceIndex !== null ? String(diag.activeDeviceIndex) : '';
    }
  }

  const matchedPreset = ['default_gamepad', 'radiomaster_boxer', 'flysky_fsi6x', 'jumper_tpro'].find(id =>
    profile.type === 'transmitter_radiomaster'
      ? id === 'radiomaster_boxer'
      : profile.type === 'transmitter_flysky'
        ? id === 'flysky_fsi6x'
        : profile.type === 'transmitter_jumper'
          ? id === 'jumper_tpro'
          : id === 'default_gamepad'
  ) ?? 'default_gamepad';

  const profSelect = $<HTMLSelectElement>('#diagProfileSelect');
  if (profSelect) profSelect.value = matchedPreset;
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
  const trigEl = $<HTMLInputElement>('#diagTriggerDrive');
  if (trigEl) trigEl.checked = Boolean(profile.enableTriggerDrive);

  const actions: BindableAction[] = ['brake', 'recover', 'changeCamera', 'techTimeout', 'skipGate', 'togglePause'];
  for (const act of actions) {
    const badge = $<HTMLElement>(`#diagBindVal_${act}`);
    if (badge) badge.textContent = formatTriggerBinding(profile.bindings?.[act]);
  }
}

function toggleDiagnosticsModal(show?: boolean) {
  diagnosticsModalOpen = typeof show === 'boolean' ? show : !diagnosticsModalOpen;
  $<HTMLElement>('#diagnosticsModal').classList.toggle('hidden', !diagnosticsModalOpen);
  $('#diagBackdrop')?.classList.toggle('hidden', !diagnosticsModalOpen);
  if (diagnosticsModalOpen) {
    controller.neutralize();
    syncDiagnosticsUI();
  } else {
    controller.cancelAutoBind();
  }
}

function renderUI() {
  ui.innerHTML = `
    <div class="topbar">
      <div class="brand"><b>●</b> ROBO RACE <span style="color:#aab4a8">/ 3D</span></div>
      <div class="hud">
        <div class="pill" id="pillRound"><small>ROUND</small><strong id="roundNum">01</strong></div>
        <div class="pill"><small>SCORE</small><strong id="score">0</strong></div>
        <div class="pill" id="pillLifelines"><small>LINE BUFFERS</small><strong id="lifelines">🛡️ 3 / 3</strong></div>
        <div class="pill"><small>TIME</small><strong id="time">00:00.00</strong></div>
        <div class="pill"><small>GATES</small><strong id="gates">00 / 12</strong></div>
        <div class="pill"><small>SPEED</small><strong id="speed">0.0 <span style="font-size:9px">m/s</span></strong></div>
        <div class="pill" id="pillHandPoints" role="button" tabindex="0" title="Click or press [R] to recover at latest checkpoint using 1 Hand Point"><small>HAND POINTS</small><strong id="handPoints">🖐️ 5 / 5</strong></div>
        <div class="pill" id="pillPit" role="button" tabindex="0" title="30-Second Competition Technical Timeout [T]"><small>TECH PIT</small><strong id="pitTimerHud">30.0s</strong></div>
        <div class="pill" id="pillBat"><small>BATTERY</small><strong id="bat">100%</strong></div>
        <div class="pill" id="pillMot"><small>MOTOR</small><strong id="mot">28°C</strong></div>
        <div class="pill" id="pillHlt"><small>HEALTH</small><strong id="hlt">100%</strong><div class="hlt-track"><div id="hltBar" class="hlt-fill" style="width:100%"></div></div></div>
      </div>
    </div>
    <div class="progress" id="next">PASS GATE <i>01</i> IN ORDER</div>
    <div id="rolloverAlert" class="rollover-banner hidden">⚠️ ROBOT OVERTURNED · PRESS [R] TO RECOVER</div>
    <div class="toolbar">
      <button class="iconbtn" id="pause">Ⅱ PAUSE</button>
      <button class="iconbtn" id="pitTimeoutBtn" title="Call 30s Technical Timeout (Hotkey: T)">🔧 PIT · T</button>
      <button class="iconbtn" id="camera">◉ CAMERA</button>
      <button class="iconbtn" id="recover">↻ RECOVER · R</button>
      <button class="iconbtn" id="cutaway">⚙ CUTAWAY</button>
      <button class="iconbtn" id="hudCalibBtn" title="USB Controller / RC Transmitter Calibration Studio (F2)">🎮 CTRL · F2</button>
      <button class="iconbtn" id="settingsBtn">⚙ SETTINGS</button>
    </div>
    <div class="controls">
      <span id="hudInputBadge" class="input-source-pill">⌨ KEYBOARD</span>
      KEYBOARD&nbsp; <kbd>W</kbd><kbd>S</kbd> DRIVE &nbsp; <kbd>A</kbd> LEFT · <kbd>D</kbd> RIGHT &nbsp; <kbd>SPACE</kbd> BRAKE &nbsp; <kbd>R</kbd> RECOVER &nbsp; <kbd>T</kbd> 30s TECH PIT &nbsp; <kbd>K</kbd> SKIP GATE &nbsp; <kbd>C</kbd> CAMERA &nbsp; <kbd>ESC</kbd> MENU / RELEASE MOUSE · 360° MOUSE LOOK
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
      <label>Proving Arena
        <select id="trackSelect">
          <option value="track_b" selected>Vanguard Proving Ground (Balanced)</option>
          <option value="track_a">Apex Steelworks (Technical)</option>
          <option value="track_c">Helios Gauntlet (Aerial)</option>
          <option value="track_d">Titan Crucible (Intense)</option>
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
      <div class="control-diagram">360° GOOGLE-MAPS STYLE CAMERA: Click canvas to lock pointer for full 360° mouse loop · Move mouse or wheel to look/zoom freely around robot · Automatically glides back to default view ~2.5s after stopping · Press ESC or Pause to release cursor · Wheel zooms · Overturning allows limited Hand Points recovery.</div>
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
      <button id="openCalibBtn" class="diag-btn" style="width:100%;justify-content:center;margin-top:10px;height:36px;font-size:11.5px;">Open Controller Calibration</button>
    </div>
    <div id="driveTelemetry" class="drive-telemetry hidden"></div>

    <div id="diagBackdrop" class="diag-backdrop hidden"></div>
    <div id="diagnosticsModal" class="diagnostics-modal hidden" role="dialog" aria-labelledby="diagModalTitle">
      <div class="diag-header">
        <div class="diag-title-group">
          <h2 class="diag-title" id="diagModalTitle">Controller &amp; Transmitter Calibration Studio</h2>
          <p class="diag-subtitle">Auto-detect USB controllers (Xbox/PS, FlySky FS-i6X/iBus, RadioMaster Boxer/TX16S, Jumper/FrSky), sweep endpoints, zero centers &amp; bind switches.</p>
        </div>
        <div class="diag-header-actions">
          <div id="diagBanner" class="diag-banner ok"><span class="diag-dot"></span><span id="diagFailsafeState">Connected</span></div>
          <button id="closeCalibBtn" class="diag-close" type="button">Close</button>
        </div>
      </div>

      <div class="diag-device-strip">
        <span id="diagDeviceName">Source: Keyboard / Direct Input</span>
        <span>Priority: Keyboard &gt; Active USB &gt; Touch</span>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">USB Controller / Receiver Manager (Plug &amp; Play)</div>
        <div class="diag-device-row">
          <select id="diagDeviceSelect" aria-label="Detected USB Controller">
            <option value="">No USB controller detected (Keyboard active)</option>
          </select>
          <button id="diagRescanBtn" class="diag-btn subtle" type="button">Scan USB</button>
          <button id="diagRemoveBtn" class="diag-btn danger" type="button">Remove Controller</button>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">Hardware Profile &amp; Control Mode</div>
        <div class="diag-grid-2">
          <label class="diag-field">Hardware Profile
            <select id="diagProfileSelect">
              <option value="default_gamepad">Standard Gamepad (Xbox / PlayStation / Generic)</option>
              <option value="radiomaster_boxer">RadioMaster Boxer / TX16S / Pocket (EdgeTX)</option>
              <option value="flysky_fsi6x">FlySky FS-i6X / FS-i6 / FS-ST8 (iBus/PPM)</option>
              <option value="jumper_tpro">Jumper T-Pro / FrSky Taranis (OpenTX)</option>
            </select>
          </label>
          <label class="diag-field">Drive Mode
            <select id="diagModeSelect">
              <option value="single_stick">Single Stick / Split Stick / Trigger Drive</option>
              <option value="tank_dual_stick">Dual Stick (Independent Left/Right Tracks)</option>
            </select>
          </label>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">Axis Channel Mappings (Ch 0..7), Polarity &amp; Asymmetric Calibration</div>
        <div class="diag-grid-4">
          <label class="diag-field">Steering (Left/Right)
            <select id="diagSteerAxis">
              <option value="0">Axis 0 (Ch 1 / LX)</option>
              <option value="1">Axis 1 (Ch 2 / LY)</option>
              <option value="2">Axis 2 (Ch 3 / RX)</option>
              <option value="3">Axis 3 (Ch 4 / RY)</option>
              <option value="4">Axis 4 (Aux Ch 5)</option>
              <option value="5">Axis 5 (Aux Ch 6)</option>
              <option value="6">Axis 6 (Aux Ch 7)</option>
              <option value="7">Axis 7 (Aux Ch 8)</option>
            </select>
            <button id="diagCapSteerBtn" class="diag-btn subtle mini" type="button">Capture Left</button>
          </label>
          <label class="diag-field">Throttle (Fwd/Rev)
            <select id="diagThrottleAxis">
              <option value="0">Axis 0 (Ch 1 / LX)</option>
              <option value="1">Axis 1 (Ch 2 / LY)</option>
              <option value="2">Axis 2 (Ch 3 / RX)</option>
              <option value="3">Axis 3 (Ch 4 / RY)</option>
              <option value="4">Axis 4 (Aux Ch 5)</option>
              <option value="5">Axis 5 (Aux Ch 6)</option>
              <option value="6">Axis 6 (Aux Ch 7)</option>
              <option value="7">Axis 7 (Aux Ch 8)</option>
            </select>
            <button id="diagCapThrottleBtn" class="diag-btn subtle mini" type="button">Capture Fwd</button>
          </label>
          <label class="diag-field">Left Track (Tank)
            <select id="diagLeftTrackAxis">
              <option value="0">Axis 0 (Ch 1 / LX)</option>
              <option value="1">Axis 1 (Ch 2 / LY)</option>
              <option value="2">Axis 2 (Ch 3 / RX)</option>
              <option value="3">Axis 3 (Ch 4 / RY)</option>
              <option value="4">Axis 4 (Aux Ch 5)</option>
              <option value="5">Axis 5 (Aux Ch 6)</option>
              <option value="6">Axis 6 (Aux Ch 7)</option>
              <option value="7">Axis 7 (Aux Ch 8)</option>
            </select>
            <button id="diagCapLeftTrackBtn" class="diag-btn subtle mini" type="button">Capture L-Fwd</button>
          </label>
          <label class="diag-field">Right Track (Tank)
            <select id="diagRightTrackAxis">
              <option value="0">Axis 0 (Ch 1 / LX)</option>
              <option value="1">Axis 1 (Ch 2 / LY)</option>
              <option value="2">Axis 2 (Ch 3 / RX)</option>
              <option value="3">Axis 3 (Ch 4 / RY)</option>
              <option value="4">Axis 4 (Aux Ch 5)</option>
              <option value="5">Axis 5 (Aux Ch 6)</option>
              <option value="6">Axis 6 (Aux Ch 7)</option>
              <option value="7">Axis 7 (Aux Ch 8)</option>
            </select>
            <button id="diagCapRightTrackBtn" class="diag-btn subtle mini" type="button">Capture R-Fwd</button>
          </label>
        </div>
        <div class="diag-toggle-row">
          <div class="diag-switches">
            <label class="diag-switch"><input type="checkbox" id="diagInvertSteer"><span>Invert Steer</span></label>
            <label class="diag-switch"><input type="checkbox" id="diagInvertThrottle"><span>Invert Throttle</span></label>
            <label class="diag-switch"><input type="checkbox" id="diagTriggerDrive"><span>Triggers (RT/LT)</span></label>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button id="diagCalibCenterBtn" class="diag-btn" type="button">Zero Center</button>
            <button id="diagSweepBtn" class="diag-btn" type="button">Sweep Endpoints</button>
            <button id="diagResetCalibBtn" class="diag-btn subtle" type="button">Reset Defaults</button>
          </div>
        </div>
        <div id="diagWizardStatus" class="diag-wizard-status hidden"></div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">Button &amp; RC Transmitter Switch Bindings</div>
        <div id="diagBindingsGrid" class="diag-bind-grid">
          <div class="diag-bind-row"><span class="diag-bind-label">Brake / Hold</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_brake">Btn 0</span><button class="diag-btn subtle mini" data-bind-action="brake" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="brake" type="button">Off</button></div></div>
          <div class="diag-bind-row"><span class="diag-bind-label">Recover Bot [R]</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_recover">Btn 1</span><button class="diag-btn subtle mini" data-bind-action="recover" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="recover" type="button">Off</button></div></div>
          <div class="diag-bind-row"><span class="diag-bind-label">Cycle Camera [C]</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_changeCamera">Btn 2</span><button class="diag-btn subtle mini" data-bind-action="changeCamera" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="changeCamera" type="button">Off</button></div></div>
          <div class="diag-bind-row"><span class="diag-bind-label">30s Tech Pit [T]</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_techTimeout">Btn 3</span><button class="diag-btn subtle mini" data-bind-action="techTimeout" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="techTimeout" type="button">Off</button></div></div>
          <div class="diag-bind-row"><span class="diag-bind-label">Skip Gate [K]</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_skipGate">Btn 5</span><button class="diag-btn subtle mini" data-bind-action="skipGate" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="skipGate" type="button">Off</button></div></div>
          <div class="diag-bind-row"><span class="diag-bind-label">Pause / Resume</span><div style="display:flex;gap:5px;align-items:center;"><span class="diag-bind-val" id="diagBindVal_togglePause">Btn 9</span><button class="diag-btn subtle mini" data-bind-action="togglePause" type="button">Bind</button><button class="diag-btn subtle mini" data-clear-action="togglePause" type="button">Off</button></div></div>
        </div>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">Live Semantic Signal &amp; Track Telemetry</div>
        <div class="diag-monitor-grid">
          <div class="diag-stick-pad" aria-label="2D stick input indicator">
            <div class="diag-stick-ring"></div>
            <div id="diagStickDot" class="diag-stick-dot"></div>
          </div>
          <div class="diag-metrics-stack">
            <div class="diag-metric">
              <small>Steering</small>
              <strong id="diagPhysicalSteer">CENTER</strong>
              <div class="diag-bar-track"><div id="diagBarSteer" class="diag-bar-fill" style="width:50%"></div></div>
            </div>
            <div class="diag-metric">
              <small>Heading Cmd</small>
              <strong id="diagSemanticSteer">0.00</strong>
            </div>
            <div class="diag-metric">
              <small>Nose Target</small>
              <strong id="diagExpectedNose">STRAIGHT</strong>
            </div>
            <div class="diag-metric">
              <small>Yaw Rate</small>
              <strong id="diagDeltaYaw">0.00 rad/s</strong>
            </div>
            <div class="diag-metric">
              <small>Throttle</small>
              <strong id="diagThrottleLabel">NEUTRAL</strong>
              <div class="diag-bar-track"><div id="diagBarThrottle" class="diag-bar-fill" style="width:50%"></div></div>
            </div>
            <div class="diag-metric">
              <small>Throttle Cmd</small>
              <strong id="diagThrottleValue">+0.00</strong>
            </div>
            <div class="diag-metric">
              <small>Left Track</small>
              <strong id="diagLeftTrack">0.00</strong>
            </div>
            <div class="diag-metric">
              <small>Right Track</small>
              <strong id="diagRightTrack">0.00</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="diag-section" style="margin-bottom:0;">
        <div class="diag-section-title">Live Calibrated Channels (Raw &rarr; Normalized) &amp; Buttons</div>
        <div id="diagRawAxesList" class="diag-axis-cards">
          <span class="diag-axis-pill">Keyboard / Virtual input active</span>
        </div>
        <div id="diagButtonsList" class="diag-btn-leds"></div>
      </div>
    </div>
  `;

  // Attach button events
  $('#pause').addEventListener('click', togglePause);
  $('#pitTimeoutBtn')?.addEventListener('click', () => openTechnicalTimeout('mid_race'));
  $('#pillPit')?.addEventListener('click', () => openTechnicalTimeout('mid_race'));
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

  const trackSelectEl = $<HTMLSelectElement>('#trackSelect');
  if (trackSelectEl) {
    trackSelectEl.value = getActiveTrack().id;
    trackSelectEl.addEventListener('change', e => {
      const tid = (e.target as HTMLSelectElement).value as TrackId;
      buildCourseForTrack(tid, nextCourseSeed());
      if (raceState === 'menu') {
        showMenu();
      } else {
        startRace();
      }
      displayToast(`ARENA RANDOMIZED: ${ARENA_METADATA[tid].name.toUpperCase()}`);
    });
  }

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
        void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
      } catch {}
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPointerLocked) {
      if (e.movementX === 0 && e.movementY === 0) return;
      const scale = 0.0035 * config.cameraSensitivity;
      const freeState: CameraFreeLookState = {
        freeYaw: cameraFreeYaw,
        freePitch: cameraFreePitch,
        distanceOffset: cameraDistanceOffset,
        idleTimer: cameraFreeLookIdle,
      };
      stepCameraFreeLook(freeState, 0, {
        lockedDeltaYaw: -e.movementX * scale,
        lockedDeltaPitch: e.movementY * scale,
      });
      cameraFreeYaw = freeState.freeYaw;
      cameraFreePitch = freeState.freePitch;
      cameraDistanceOffset = freeState.distanceOffset;
      cameraFreeLookIdle = freeState.idleTimer;
    }
  });

  canvas.addEventListener('pointerdown', e => {
    if (e.button === 1) {
      cameraFreeYaw = 0;
      cameraFreePitch = 0;
      cameraDistanceOffset = 0;
      cameraFreeLookIdle = 0;
      e.preventDefault();
      return;
    }
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
    const dx = e.clientX - cameraPointerX;
    const dy = e.clientY - cameraPointerY;
    if (dx === 0 && dy === 0) return;
    const scale = 0.004 * config.cameraSensitivity;
    const freeState: CameraFreeLookState = {
      freeYaw: cameraFreeYaw,
      freePitch: cameraFreePitch,
      distanceOffset: cameraDistanceOffset,
      idleTimer: cameraFreeLookIdle,
    };
    stepCameraFreeLook(freeState, 0, {
      dragDeltaYaw: -dx * scale,
      dragDeltaPitch: dy * scale,
    });
    cameraFreeYaw = freeState.freeYaw;
    cameraFreePitch = freeState.freePitch;
    cameraDistanceOffset = freeState.distanceOffset;
    cameraFreeLookIdle = freeState.idleTimer;
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
  const handleCameraWheel = (e: WheelEvent) => {
    if (!isPointerLocked && e.target !== canvas) return;
    if (e.deltaY === 0) return;
    const freeState: CameraFreeLookState = {
      freeYaw: cameraFreeYaw,
      freePitch: cameraFreePitch,
      distanceOffset: cameraDistanceOffset,
      idleTimer: cameraFreeLookIdle,
    };
    stepCameraFreeLook(freeState, 0, {
      wheelDeltaDistance: Math.sign(e.deltaY) * 0.65,
    });
    cameraDistanceOffset = freeState.distanceOffset;
    cameraFreeLookIdle = freeState.idleTimer;
    e.preventDefault();
  };
  window.addEventListener('wheel', handleCameraWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Diagnostics & Calibration modal events
  controller.onDeviceEvent((event, detail) => {
    syncSettingsControlsFromController();
    if (diagnosticsModalOpen) syncDiagnosticsUI();
    if (event === 'connected') displayToast(`🔌 USB DETECTED: ${detail.slice(0, 38)}`);
    else if (event === 'switched') displayToast(`🎛 CONTROLLER ACTIVE: ${detail.slice(0, 36)}`);
    else if (event === 'calibrated') displayToast(`✓ ${detail.slice(0, 44).toUpperCase()}`);
    else if (event === 'disconnected') displayToast(`⌨ ${detail.slice(0, 44).toUpperCase()}`);
  });

  $('#openCalibBtn').addEventListener('click', () => toggleDiagnosticsModal(true));
  $('#hudCalibBtn')?.addEventListener('click', () => toggleDiagnosticsModal(true));
  $('#closeCalibBtn').addEventListener('click', () => toggleDiagnosticsModal(false));
  $('#diagBackdrop')?.addEventListener('click', () => toggleDiagnosticsModal(false));

  $('#diagDeviceSelect')?.addEventListener('change', e => {
    const val = (e.target as HTMLSelectElement).value;
    if (val !== '') {
      controller.selectDeviceIndex(Number(val));
      syncDiagnosticsUI();
    }
  });
  $('#diagRescanBtn')?.addEventListener('click', () => {
    const found = controller.rescanDevices();
    syncDiagnosticsUI();
    displayToast(found.length > 0 ? `🔌 FOUND ${found.length} USB CONTROLLER(S)` : 'NO USB CONTROLLERS FOUND · KEYBOARD READY');
  });
  $('#diagRemoveBtn')?.addEventListener('click', () => {
    const removed = controller.removeActiveDevice();
    syncDiagnosticsUI();
    if (!removed) displayToast('KEYBOARD MODE ALREADY ACTIVE');
  });

  $('#diagProfileSelect').addEventListener('change', e => {
    controller.selectProfileById((e.target as HTMLSelectElement).value);
    syncSettingsControlsFromController();
    syncDiagnosticsUI();
    displayToast('HARDWARE PROFILE SWITCHED');
  });

  $('#diagModeSelect').addEventListener('change', e => {
    const mode = (e.target as HTMLSelectElement).value as ControllerMode;
    config.controlMode = mode;
    controller.updateConfig({ mode });
    syncSettingsControlsFromController();
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

  const capMap: Array<[string, AxisCaptureTarget]> = [
    ['#diagCapSteerBtn', 'steering_left'],
    ['#diagCapThrottleBtn', 'throttle_fwd'],
    ['#diagCapLeftTrackBtn', 'left_track_fwd'],
    ['#diagCapRightTrackBtn', 'right_track_fwd'],
  ];
  for (const [sel, target] of capMap) {
    document.querySelector(sel)?.addEventListener('click', () => {
      controller.startAxisAutoBind(target);
      displayToast('PUSH CONTROLLER STICK TOWARD TARGET DIRECTION...');
    });
  }

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
  $('#diagTriggerDrive')?.addEventListener('change', e => {
    controller.setTriggerDrive((e.target as HTMLInputElement).checked);
    displayToast(`RT/LT TRIGGER DRIVE: ${(e.target as HTMLInputElement).checked ? 'ON' : 'OFF'}`);
  });
  $('#diagCalibCenterBtn').addEventListener('click', () => {
    const ok = controller.calibrateCenter();
    displayToast(ok ? '✓ CENTER ZERO-POINT CALIBRATED' : 'PLUG USB CONTROLLER FIRST TO ZERO CENTER');
  });
  $('#diagSweepBtn')?.addEventListener('click', () => {
    const active = controller.getDiagnostics().calibrationWizard.activeSweep;
    if (!active) {
      controller.startEndpointCalibration();
      displayToast('MOVE ALL STICKS THROUGH FULL MIN & MAX THEN CLICK FINISH');
    } else {
      const ok = controller.finishEndpointCalibration();
      syncDiagnosticsUI();
      displayToast(ok ? '✓ MIN/MAX ENDPOINTS CALIBRATED & SAVED' : 'NO AXIS SWEEP DETECTED');
    }
  });
  $('#diagResetCalibBtn')?.addEventListener('click', () => {
    controller.resetActiveCalibration();
    syncSettingsControlsFromController();
    syncDiagnosticsUI();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-bind-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.bindAction as BindableAction;
      controller.startActionAutoBind(act);
      displayToast(`PRESS CONTROLLER BUTTON OR FLIP TX SWITCH FOR ${act.toUpperCase()}...`);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-clear-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.clearAction as BindableAction;
      controller.setActionBinding(act, { kind: 'none' });
      syncDiagnosticsUI();
      displayToast(`${act.toUpperCase()} UNBOUND`);
    });
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
  const plan = runtimeCourse.plan;
  const formatCamName = (idx: number) => {
    const raw = CAMERA_LABELS[idx] || 'CHASE';
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  };
  const tracks = [
    { id: 'track_b', domId: 'cardTrackB', name: ARENA_METADATA.track_b.name, level: ARENA_METADATA.track_b.tierLabel, detail: ARENA_METADATA.track_b.tagline },
    { id: 'track_a', domId: 'cardTrackA', name: ARENA_METADATA.track_a.name, level: ARENA_METADATA.track_a.tierLabel, detail: ARENA_METADATA.track_a.tagline },
    { id: 'track_c', domId: 'cardTrackC', name: ARENA_METADATA.track_c.name, level: ARENA_METADATA.track_c.tierLabel, detail: ARENA_METADATA.track_c.tagline },
    { id: 'track_d', domId: 'cardTrackD', name: ARENA_METADATA.track_d.name, level: ARENA_METADATA.track_d.tierLabel, detail: ARENA_METADATA.track_d.tagline },
  ] as const;

  const hurdlePreview = plan.slots.map(s => s.meta.label).join(' → ');
  const activeFaults = getActiveFaultList(subsystems);
  const sealCracked = subsystems.integrity.electronicsEnclosure < 65;
  const faultBannerHtml = (activeFaults.length > 0 || sealCracked)
    ? `<div class="menu-fault-alert" id="menuFaultAlert">
        <b>⚠ PREVIOUS ROUND HARDWARE FAULT${activeFaults.length > 1 ? 'S' : ''} CARRIED OVER</b><br>
        ${activeFaults.map(id => `• ${FAULT_REPAIR_META[id].label} (${subsystems.faults.faultReasons[id] || FAULT_REPAIR_META[id].symptom})`).join('<br>')}
        ${sealCracked ? `<br>• Electronics Enclosure Seal Cracked (${Math.round(subsystems.integrity.electronicsEnclosure)}%) — water ingress short risk` : ''}
        <br><span style="color:#f0bd53;">Starting Round ${String(roundNumber).padStart(2, '0')} opens a mandatory <b>30s Technical Timeout Pit Stop</b> for diagnostics &amp; swaps.</span>
      </div>`
    : '';

  o.innerHTML = `
    <div class="overlay overlay--menu">
      <div class="menu-card" role="dialog" aria-labelledby="menuTitle">
        <header class="menu-head">
          <div class="menu-round-chip">Round ${String(roundNumber).padStart(2, '0')} · 30s Technical Timeout Rule</div>
          <h1 class="menu-title" id="menuTitle">Robo Race 3D</h1>
          <p class="menu-lead">Dynamic ${runtimeCourse.checkpoints.length}-gate randomized robotics proving ground.</p>
        </header>

        ${faultBannerHtml}

        <section class="menu-section" aria-label="Circuit selection">
          <div class="menu-section-head">
            <div class="menu-section-label">Proving arena</div>
            <button type="button" class="menu-shuffle-btn" id="btnMenuShuffle">Reshuffle hurdles</button>
          </div>
          <div class="menu-track-list">
            ${tracks.map(t => `
              <button type="button" class="track-card ${activeTrackId === t.id ? 'active' : ''}" data-track="${t.id}" id="${t.domId}">
                <div class="track-row-main">
                  <span class="track-row-title">${t.name}</span>
                  <span class="track-row-desc">${t.detail}</span>
                </div>
                <span class="track-row-level">${t.level}</span>
              </button>
            `).join('')}
          </div>
          <div class="menu-circuit-summary" id="menuCircuitSummary">
            <div class="menu-summary-top">
              <span>${plan.slots.length} unique hurdles · ${plan.easyCount}E / ${plan.mediumCount}M / ${plan.hardCount}H</span>
              <span class="menu-summary-pts">${plan.totalBasePoints} PTS</span>
            </div>
            <div class="menu-summary-seq">${hurdlePreview}</div>
          </div>
        </section>

        <button class="menu-cta" id="btnStartRace" type="button">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.8v10.4L13 8 4 2.8z"/></svg>
          <span>${hasAnyHardwareFault(subsystems) ? `Inspect & Start Round ${String(roundNumber).padStart(2, '0')}` : `Start Round ${String(roundNumber).padStart(2, '0')}`}</span>
        </button>

        <div class="menu-actions">
          <button class="menu-util-btn" id="btnMenuCam" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            <span class="menu-cam-label">Camera: ${formatCamName(cameraMode)}</span>
          </button>
          <button class="menu-util-btn" id="btnMenuSettings" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Settings</span>
          </button>
          <button class="menu-util-btn" id="btnMenuCalib" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>
            <span>Calibrate</span>
          </button>
        </div>

        <footer class="menu-keys">
          <span><kbd>WASD</kbd> Drive</span>
          <span><kbd>T</kbd> 30s Tech Pit</span>
          <span><kbd>R</kbd> Recover</span>
          <span><kbd>K</kbd> Skip</span>
        </footer>
      </div>
    </div>
  `;
  $('#btnStartRace', o).addEventListener('click', startRace);
  $('#btnMenuShuffle', o).addEventListener('click', () => {
    const tid = getActiveTrack().id;
    buildCourseForTrack(tid, nextCourseSeed());
    showMenu();
    displayToast(`SHUFFLED: ${runtimeCourse.plan.slots.length} HURDLES (${runtimeCourse.plan.totalBasePoints} PTS)`);
  });
  const trackCards = o.querySelectorAll<HTMLElement>('.track-card');
  trackCards.forEach(card => {
    card.addEventListener('click', () => {
      const trackId = card.dataset.track as TrackId;
      buildCourseForTrack(trackId, nextCourseSeed());
      const select = $('#trackSelect') as HTMLSelectElement | null;
      if (select) select.value = trackId;
      showMenu();
      displayToast(`${ARENA_METADATA[trackId].name.toUpperCase()} · ${runtimeCourse.plan.totalBasePoints} PTS`);
    });
  });
  const btnMenuCam = $('#btnMenuCam', o);
  btnMenuCam.addEventListener('click', () => {
    cycleCamera();
    const camLbl = btnMenuCam.querySelector('.menu-cam-label');
    if (camLbl) camLbl.textContent = `Camera: ${formatCamName(cameraMode)}`;
  });
  $('#btnMenuSettings', o).addEventListener('click', () => $('#settings').classList.toggle('hidden'));
  $('#btnMenuCalib', o).addEventListener('click', () => {
    $('#openCalibBtn')?.click();
  });
}

function finishTechnicalTimeout() {
  const cb = techTimeoutOnDone;
  techTimeoutOnDone = null;
  hideOverlays();
  if (techTimeoutContext === 'mid_race') {
    techTimeoutUsedThisRound = true;
    raceState = 'racing';
    try { void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}); } catch {}
    displayToast(hasAnyHardwareFault(subsystems) ? 'RESUMED WITH REMAINING FAULTS' : 'PIT REPAIRS COMPLETE · GO!');
  } else if (cb) {
    cb();
  } else {
    raceState = 'countdown';
    countdown = 3.0;
    displayToast('READY');
  }
}

function renderTechnicalTimeoutOverlay() {
  const o = $<HTMLDivElement>('#overlay');
  if (!o) return;
  const f = subsystems.faults;
  const sealCracked = subsystems.integrity.electronicsEnclosure < 65;
  const rows: Array<{
    key: HardwareFaultId | 'enclosure_seal';
    title: string;
    desc: string;
    faulty: boolean;
    costSec: number;
  }> = [
    {
      key: 'battery_swollen',
      title: '4S LiPo Battery Pack',
      desc: f.batterySwollen ? (f.faultReasons.battery_swollen || FAULT_REPAIR_META.battery_swollen.symptom) : `Nominal ${subsystems.battery.voltage.toFixed(1)}V · ${Math.round(subsystems.battery.temperature)}°C`,
      faulty: f.batterySwollen,
      costSec: FAULT_REPAIR_META.battery_swollen.pitSec,
    },
    {
      key: 'circuit_burnt',
      title: 'Main ESC & Power Circuit',
      desc: f.circuitBurnt ? (f.faultReasons.circuit_burnt || FAULT_REPAIR_META.circuit_burnt.symptom) : `Bus clean · ${Math.round(subsystems.esc.temperature)}°C · 100% delivery`,
      faulty: f.circuitBurnt,
      costSec: FAULT_REPAIR_META.circuit_burnt.pitSec,
    },
    {
      key: 'left_motor_burnt',
      title: 'Left 600 RPM Drive Motor',
      desc: f.leftMotorBurnt ? (f.faultReasons.left_motor_burnt || FAULT_REPAIR_META.left_motor_burnt.symptom) : `Windings intact · ${Math.round(subsystems.motors.leftTemp)}°C`,
      faulty: f.leftMotorBurnt,
      costSec: FAULT_REPAIR_META.left_motor_burnt.pitSec,
    },
    {
      key: 'right_motor_burnt',
      title: 'Right 600 RPM Drive Motor',
      desc: f.rightMotorBurnt ? (f.faultReasons.right_motor_burnt || FAULT_REPAIR_META.right_motor_burnt.symptom) : `Windings intact · ${Math.round(subsystems.motors.rightTemp)}°C`,
      faulty: f.rightMotorBurnt,
      costSec: FAULT_REPAIR_META.right_motor_burnt.pitSec,
    },
    {
      key: 'left_belt_slipped',
      title: 'Left Cycle-Tube Belt',
      desc: f.leftBeltSlipped ? (f.faultReasons.left_belt_slipped || FAULT_REPAIR_META.left_belt_slipped.symptom) : `Seated in corner pulley grooves · ${Math.round(subsystems.integrity.leftTrack)}% rubber`,
      faulty: f.leftBeltSlipped,
      costSec: FAULT_REPAIR_META.left_belt_slipped.pitSec,
    },
    {
      key: 'right_belt_slipped',
      title: 'Right Cycle-Tube Belt',
      desc: f.rightBeltSlipped ? (f.faultReasons.right_belt_slipped || FAULT_REPAIR_META.right_belt_slipped.symptom) : `Seated in corner pulley grooves · ${Math.round(subsystems.integrity.rightTrack)}% rubber`,
      faulty: f.rightBeltSlipped,
      costSec: FAULT_REPAIR_META.right_belt_slipped.pitSec,
    },
    {
      key: 'enclosure_seal',
      title: 'Waterproof Seal & Belt Tension',
      desc: sealCracked ? `Cracked housing (${Math.round(subsystems.integrity.electronicsEnclosure)}%) — water ingress risk!` : `IP67 Sealed (${Math.round(subsystems.integrity.electronicsEnclosure)}%) · Belts ${Math.round(Math.min(subsystems.integrity.leftTrack, subsystems.integrity.rightTrack))}%`,
      faulty: sealCracked,
      costSec: 5,
    },
  ];

  const rem = Math.max(0, techTimeoutRemaining);
  const urgent = rem <= 10;
  const pct = Math.max(0, Math.min(100, (rem / TECHNICAL_TIMEOUT_SECONDS) * 100));
  const anyRemaining = rows.some(r => r.faulty);

  o.innerHTML = `
    <div class="overlay pit-overlay">
      <div class="pit-card" role="dialog" aria-labelledby="pitTitle">
        <div class="pit-head">
          <div>
            <div class="eyebrow">ROUND ${String(roundNumber).padStart(2, '0')} · ${techTimeoutContext === 'pre_round' ? 'PRE-HEAT HARDWARE INSPECTION' : 'MID-RACE TECHNICAL TIMEOUT'}</div>
            <h2 id="pitTitle" style="margin:4px 0 2px;font-size:20px;color:#eff3ea;">Pit Bench Service</h2>
            <p style="margin:0;font-size:11.5px;color:#9ea99c;">Swap burnt/swollen hardware before the 30s timeout clock expires.</p>
          </div>
          <div class="pit-clock-box ${urgent ? 'urgent' : ''}" id="pitClockBox">
            <small>TIMEOUT LEFT</small>
            <strong id="pitClockText">${rem.toFixed(1)}s</strong>
          </div>
        </div>
        <div class="pit-timer-bar"><div class="pit-timer-fill" id="pitTimerFill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="pit-list">
          ${rows.map(r => `
            <div class="pit-row ${r.faulty ? 'faulty' : ''}">
              <div class="pit-row-info">
                <span class="pit-row-title">${r.title}</span>
                <span class="pit-row-desc">${r.desc}</span>
              </div>
              ${r.faulty
                ? `<button type="button" class="pit-fix-btn" data-repair="${r.key}" ${rem < r.costSec - 0.05 ? 'disabled title="Not enough timeout seconds left"' : ''}>SWAP / FIX · -${r.costSec}s</button>`
                : `<span class="pit-ok-tag">NOMINAL</span>`
              }
            </div>
          `).join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;">
          <button type="button" class="action" id="btnPitDeploy" style="flex:1;min-width:170px;">
            ${anyRemaining ? 'DEPLOY WITH FAULTS' : techTimeoutContext === 'mid_race' ? 'RESUME RACE NOW' : 'DEPLOY TO START LINE'}
          </button>
          <button type="button" class="iconbtn" id="btnPitMenu">EXIT TO MENU</button>
        </div>
      </div>
    </div>
  `;

  o.querySelectorAll<HTMLButtonElement>('[data-repair]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.repair as HardwareFaultId | 'enclosure_seal';
      const cost = key === 'enclosure_seal' ? 5 : FAULT_REPAIR_META[key].pitSec;
      if (techTimeoutRemaining < cost - 0.05) {
        tone(180, 0.16, 0.06);
        displayToast('INSUFFICIENT TECHNICAL TIMEOUT SECONDS');
        return;
      }
      techTimeoutRemaining = Math.max(0, techTimeoutRemaining - cost);
      if (key === 'enclosure_seal') {
        repairEnclosureSeal(subsystems);
        beltTracking.leftDrift *= 0.25;
        beltTracking.rightDrift *= 0.25;
      } else {
        repairComponentFault(subsystems, key);
        if (key === 'left_belt_slipped') {
          beltTracking.leftDrift = 0;
          beltTracking.leftDerailed = false;
        } else if (key === 'right_belt_slipped') {
          beltTracking.rightDrift = 0;
          beltTracking.rightDerailed = false;
        }
      }
      saveCarriedHardware(hasAnyHardwareFault(subsystems) ? createCarryoverSnapshot(subsystems, roundNumber) : {
        ...createCarryoverSnapshot(subsystems, roundNumber),
        faults: subsystems.faults,
      });
      syncRobotVisualHardwareState(performance.now() * 0.001);
      tone(740, 0.14, 0.05);
      displayToast(`REPAIRED IN PIT (-${cost}s TIMEOUT)`);
      renderTechnicalTimeoutOverlay();
    });
  });

  $('#btnPitDeploy', o)?.addEventListener('click', finishTechnicalTimeout);
  $('#btnPitMenu', o)?.addEventListener('click', () => {
    techTimeoutOnDone = null;
    raceState = 'menu';
    showMenu();
  });
}

function openTechnicalTimeout(context: 'pre_round' | 'mid_race', onDone?: () => void) {
  if (context === 'mid_race') {
    if (raceState !== 'racing') return;
    if (techTimeoutUsedThisRound || techTimeoutRemaining <= 0.5) {
      tone(190, 0.18, 0.07);
      displayToast('TECHNICAL TIMEOUT ALREADY EXHAUSTED THIS ROUND');
      return;
    }
  }
  if (document.pointerLockElement) document.exitPointerLock();
  controller.neutralize();
  techTimeoutContext = context;
  techTimeoutOnDone = onDone ?? null;
  raceState = 'tech_timeout';
  renderTechnicalTimeoutOverlay();
}

function showPaused() {
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow">RACE PAUSED · ROUND ${String(roundNumber).padStart(2, '0')}</div>
        <h1>Take a breath.</h1>
        <p>Timer and vehicle state are safely paused. Resume your run or reset.</p>
        <button class="action" id="btnResume">RESUME RACE</button>
        <div class="subactions">
          <button class="iconbtn" id="btnRestart">NEXT ROUND (CARRY HARDWARE)</button>
          <button class="iconbtn" id="btnMainMenu">MAIN MENU</button>
        </div>
      </div>
    </div>
  `;
  $('#btnResume', o).addEventListener('click', () => {
    raceState = 'racing';
    hideOverlays();
    try { void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}); } catch {}
  });
  $('#btnRestart', o).addEventListener('click', restartRace);
  $('#btnMainMenu', o).addEventListener('click', () => { raceState = 'menu'; showMenu(); });
}

function commitEndOfRoundCarryover() {
  const nextSnap = createCarryoverSnapshot(subsystems, roundNumber + 1);
  carriedHardware = nextSnap;
  saveCarriedHardware(nextSnap);
}

function showResults() {
  const totalAdj = elapsed + penaltyTime;
  if (!bestTime || totalAdj < bestTime) {
    bestTime = totalAdj;
    localStorage.setItem('robo-race-best-v2', String(bestTime));
  }
  commitEndOfRoundCarryover();
  const activeFaults = getActiveFaultList(subsystems);
  const dmgNotice = (activeFaults.length > 0 || subsystems.integrity.electronicsEnclosure < 65)
    ? `<p style="padding:8px 10px;border-radius:8px;background:rgba(168,42,32,0.22);border:1px solid rgba(255,119,112,0.38);color:#ffc4be;font-size:11.5px;">
        <b>Hardware Carried to Round ${String(roundNumber + 1).padStart(2, '0')}:</b>
        ${activeFaults.map(id => FAULT_REPAIR_META[id].label).join(' · ') || 'Enclosure Seal Weakened'}<br>
        Use the 30s Technical Timeout in the next round to swap burnt/swollen parts.
       </p>`
    : '';
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow">ROUND ${String(roundNumber).padStart(2, '0')} COMPLETE · SCORE ${scoreState.score} PTS · ${checkpointMeshes.length} / ${checkpointMeshes.length} GATES</div>
        <h1>Race Finished!</h1>
        <p class="result-time">${formatTime(elapsed)} <span style="font-size:14px;color:#aeb8a9">+ ${penaltyTime.toFixed(1)}s assist</span></p>
        <p>Competition Score: <b style="color:${scoreState.score >= 0 ? '#6ee787' : '#ff7770'}">${scoreState.score} PTS</b>
           <span style="font-size:12px;color:#aeb8a9">(+${scoreState.pointsEarned} obstacles · -${scoreState.penaltyPoints} penalties)</span><br>
           Line Buffers Left: <b>${scoreState.remainingLifelines} / ${scoreState.totalLifelines}</b> · Out-of-Line Penalties: <b>${scoreState.boundaryViolations}</b> · Height Falls: <b>${scoreState.fallCount}</b><br>
           Adjusted Total: <b style="color:#f0bd53">${formatTime(totalAdj)}</b> · Record: <b style="color:#f0bd53">${formatTime(bestTime)}</b><br>
           Battery Remaining: ${subsystems.battery.percentage.toFixed(0)}% · Chassis Integrity: ${subsystems.integrity.chassis.toFixed(0)}%
        </p>
        ${dmgNotice}
        <button class="action" id="btnAgain">START ROUND ${String(roundNumber + 1).padStart(2, '0')}</button>
        <div class="subactions">
          <button class="iconbtn" id="btnMenu">MAIN MENU</button>
        </div>
      </div>
    </div>
  `;
  $('#btnAgain', o).addEventListener('click', restartRace);
  $('#btnMenu', o).addEventListener('click', () => {
    roundNumber += 1;
    applyCarryoverSnapshot(subsystems, carriedHardware);
    syncRobotVisualHardwareState(performance.now() * 0.001);
    raceState = 'menu';
    showMenu();
  });
}

function showFailure(reason: string) {
  commitEndOfRoundCarryover();
  const activeFaults = getActiveFaultList(subsystems);
  const o = $<HTMLDivElement>('#overlay');
  o.innerHTML = `
    <div class="overlay">
      <div class="card">
        <div class="eyebrow" style="color:#ff7770">ROUND ${String(roundNumber).padStart(2, '0')} FAILED · ROBOT DISABLED</div>
        <h1>Run ended.</h1>
        <p>${reason}. ${activeFaults.length > 0 ? `Detected: ${activeFaults.map(id => FAULT_REPAIR_META[id].label).join(', ')}. ` : ''}Damaged hardware carries into Round ${String(roundNumber + 1).padStart(2, '0')} for 30s Technical Timeout service.</p>
        <p>Competition Score: <b>${scoreState.score} PTS</b> · Height Falls: <b>${scoreState.fallCount}</b><br>
           Time: <b>${formatTime(elapsed)}</b> · Battery: ${subsystems.battery.percentage.toFixed(0)}% · Health: ${subsystems.integrity.chassis.toFixed(0)}%</p>
        <button class="action" id="btnRestartFailed">NEXT ROUND · 30s PIT BAY</button>
        <div class="subactions"><button class="iconbtn" id="btnFailedMenu">MAIN MENU</button></div>
      </div>
    </div>
  `;
  $('#btnRestartFailed', o).addEventListener('click', restartRace);
  $('#btnFailedMenu', o).addEventListener('click', () => {
    roundNumber += 1;
    applyCarryoverSnapshot(subsystems, carriedHardware);
    syncRobotVisualHardwareState(performance.now() * 0.001);
    raceState = 'menu';
    showMenu();
  });
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
    try { void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}); } catch {}
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
  displayToast(cutawayMode ? "OPEN 'I'-CHASSIS CUTAWAY VIEW" : 'ROBOT EXTERIOR VIEW');
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
  techTimeoutRemaining = TECHNICAL_TIMEOUT_SECONDS;
  techTimeoutUsedThisRound = false;
  beltTracking = createInitialBeltTrackingState();
  lastFrameBeltShock = 0;
  subsystems = createInitialSubsystems();
  applyCarryoverSnapshot(subsystems, carriedHardware);
  beltTracking.leftDerailed = subsystems.faults.leftBeltSlipped;
  beltTracking.rightDerailed = subsystems.faults.rightBeltSlipped;
  syncRobotVisualHardwareState(performance.now() * 0.001);
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

  if (hasAnyHardwareFault(subsystems)) {
    openTechnicalTimeout('pre_round', () => {
      raceState = 'countdown';
      countdown = 3.0;
      hideOverlays();
      displayToast(`ROUND ${String(roundNumber).padStart(2, '0')} READY`);
    });
    return;
  }

  raceState = 'countdown';
  countdown = 3.0;
  hideOverlays();
  displayToast(`ROUND ${String(roundNumber).padStart(2, '0')} READY`);
}

function restartRace() {
  if (raceState !== 'menu') {
    const nextSnap = createCarryoverSnapshot(subsystems, roundNumber + 1);
    carriedHardware = nextSnap;
    saveCarriedHardware(nextSnap);
    roundNumber += 1;
  }
  buildCourseForTrack(getActiveTrack().id, nextCourseSeed());
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
    (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#ad8944' : '#5b7355');
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
  (checkpointMeshes[prevGate].bar.material as THREE.MeshBasicMaterial).color.set('#ad8944');

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
    (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#ad8944' : '#5b7355');
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
    cameraFreeLookIdle = DEFAULT_CAMERA_RETURN_DELAY_SEC;
  }
  controller.handleKeyDown(e.code);

  if (e.code === 'KeyR' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
    if (!e.repeat) {
      rKeyPressed = true;
      rHoldDuration = 0;
    }
  }

  if (e.repeat) return;
  if (e.code === 'KeyT' && raceState === 'racing' && $('#settings').classList.contains('hidden') && !diagnosticsModalOpen) {
    openTechnicalTimeout('mid_race');
  }
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
      $('#diagBackdrop')?.classList.add('hidden');
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
    $('#diagBackdrop')?.classList.toggle('hidden', !diagnosticsModalOpen);
    if (diagnosticsModalOpen) {
      controller.neutralize();
      syncDiagnosticsUI();
    } else {
      controller.cancelAutoBind();
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
  const hit = evaluateBarrierCollision(x, z, pose.yaw, y, colliders, MAP_SCALE);
  lastBarrierCollision = hit ? hit.id : null;
  return hit ? { nx: hit.nx, nz: hit.nz, depth: hit.depth } : null;
}

// Debug hooks for automated verification & visual capture
(window as unknown as Record<string, unknown>).__setCameraPose = (cx: number | null, cy?: number, cz?: number, tx?: number, ty?: number, tz?: number) => {
  if (cx === null) {
    delete (window as unknown as Record<string, unknown>).__overrideCamera;
    return;
  }
  (window as unknown as Record<string, unknown>).__overrideCamera = { cx, cy: cy ?? 0, cz: cz ?? 0, tx: tx ?? 0, ty: ty ?? 0, tz: tz ?? 0 };
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

  if (raceState === 'tech_timeout') {
    techTimeoutRemaining = Math.max(0, techTimeoutRemaining - dt);
    const clockEl = $<HTMLElement>('#pitClockText');
    const fillEl = $<HTMLElement>('#pitTimerFill');
    const boxEl = $<HTMLElement>('#pitClockBox');
    if (clockEl) clockEl.textContent = `${techTimeoutRemaining.toFixed(1)}s`;
    if (fillEl) fillEl.style.width = `${Math.max(0, (techTimeoutRemaining / TECHNICAL_TIMEOUT_SECONDS) * 100).toFixed(1)}%`;
    if (boxEl) boxEl.classList.toggle('urgent', techTimeoutRemaining <= 10);
    if (techTimeoutRemaining <= 0) {
      finishTechnicalTimeout();
    }
    return;
  }

  if (raceState === 'countdown') {
    countdown -= dt;
    if (countdown <= 0) {
      raceState = 'racing';
      displayToast('GO!');
    }
    return;
  }

  if (raceState !== 'racing') {
    if (raceState === 'paused') {
      const pauseInputs = controller.poll();
      if (pauseInputs.togglePause) togglePause();
    }
    for (const tt of runtimeCourse.turntables) {
      tt.group.rotation.y += turntableCurrentOmega * dt;
    }
    return;
  }

  elapsed += dt;
  if (recoveryCooldown > 0) recoveryCooldown -= dt;

  // Poll Universal Controller outputs
  const inputs = controller.poll();
  if (inputs.recover) recoverVehicle();
  if (inputs.changeCamera) cycleCamera();
  if (inputs.togglePause) togglePause();
  if (inputs.skipGate) skipCurrentCheckpoint();
  if (inputs.techTimeout) openTechnicalTimeout('mid_race');

  // Hardware faults realistically restrict drivetrain output (burnt motors pull sideways, swollen LiPo caps speed, burnt circuit stutters)
  const hwMods = getEffectiveDrivetrainModifiers(subsystems, elapsed);
  const effectiveLeft = pose.isFlipped ? 0 : inputs.leftTrack * hwMods.leftMotorMultiplier;
  const effectiveRight = pose.isFlipped ? 0 : inputs.rightTrack * hwMods.rightMotorMultiplier;

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
      maxSpeed: Math.min(tuning.maxSpeed * config.sensitivity, maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])) * healthThrottle * hwMods.maxSpeedMultiplier,
      motorTrackSpeed: Math.min(maxTrackSpeedMps(MOTOR_SPECIFICATIONS[0]), maxTrackSpeedMps(MOTOR_SPECIFICATIONS[1])),
      motorAcceleration: Math.min(
        tuning.acceleration,
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[0]),
        maxMotorAccelerationMps2(MOTOR_SPECIFICATIONS[1]),
      ) * hwMods.accelerationMultiplier * healthThrottle,
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

  // Submerged Open-Chassis Rover Hydrodynamics: enters deep water tank to swim along submerged floor & exit ramp
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
    MAP_SCALE,
    runtimeCourse.waterPools,
    'open_rover'
  );
  if (waterBuoyancy.inWater) {
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

  // Dynamic Procedural Hurdles Step (Turntables, Swinging Pendulums, Seesaws, Football Goal Arena)
  const nowSec = performance.now() * 0.001;
  stepDynamicHurdles(
    runtimeCourse,
    pose,
    motionState,
    turntableCurrentOmega,
    effectiveGrip,
    nowSec,
    dt,
    (relSpeedMps: number) => {
      pose.vy = 0;
      pose.rollRate = 0;
      pose.pitchRate = 0;
      lastFrameBeltShock = Math.max(lastFrameBeltShock, relSpeedMps * 1.45);
      const hpLoss = applyPendulumImpactDamage(subsystems, relSpeedMps);
      const pendPenalty = evaluatePendulumStrikeDamage(relSpeedMps, config.scoring);
      applyBatteryShock(subsystems, pendPenalty.batteryShockPct);
      if (pendPenalty.pointsPenalty > 0) {
        scoreState.penaltyPoints += pendPenalty.pointsPenalty;
        scoreState.score -= pendPenalty.pointsPenalty;
        scoreState.events.push({
          label: 'Pendulum Strike',
          delta: -pendPenalty.pointsPenalty,
          detail: `Kinetic wrecking ball impact (${relSpeedMps.toFixed(1)} m/s, -${Math.round(hpLoss)}% HP)`,
        });
      }
      tone(105, 0.28, 0.12);
      displayToast(`💥 PENDULUM HIT (-${Math.round(hpLoss)}% HP · -${pendPenalty.pointsPenalty} PTS)`);
    },
    (arena: FootballArenaRuntime, goalIndex: number) => {
      const award = awardFootballGoalPoints(scoreState, goalIndex, arena.ballCount, arena.tier, config.scoring);
      if (award.delta > 0) {
        tone(award.isBonus ? 860 : 720, 0.16, 0.07);
        const baseGoals = Math.max(2, arena.ballCount - 2);
        if (award.isBonus) {
          displayToast(`⚽ BONUS GOAL ${goalIndex}! +${award.delta} PT EXTRA BONUS`);
        } else {
          displayToast(`⚽ GOAL ${goalIndex}/${baseGoals}! +${award.delta} PTS`);
        }
      } else {
        tone(540, 0.12, 0.05);
        displayToast(`⚽ GOAL ${goalIndex} SCORED (MAX +2 EXTRA BONUS REACHED)`);
      }
    },
    (relSpeedMps: number) => {
      const minorHp = Math.min(subsystems.integrity.chassis, Math.min(9, 2.5 + relSpeedMps * 1.4));
      subsystems.integrity.chassis = Math.max(0, subsystems.integrity.chassis - minorHp);
      tone(145, 0.18, 0.08);
      displayToast(`🚧 TRAFFIC GATE BUMP (-${Math.round(minorHp)}% HP)`);
    },
  );

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
  // Submerged open-chassis rover tracks the real underwater basin floor & concrete exit wade ramp
  stepVehicle3D(
    pose,
    (x, z) => evaluateCourseHeight(x / MAP_SCALE, z / MAP_SCALE, pose.y),
    driveResult.longitudinalSpeed,
    motionState.angular,
    dt,
    9.81,
    false // Broad obstacle reaction yaw torque is handled above via evaluateRockHeight, preserving 100% player steering on ramps and spiral
  );
  if (waterBuoyancy.inWater && waterBuoyancy.immersionDepth > 0.04) {
    // Hydrodynamic roll/pitch viscous damping while wading submerged through deep water
    pose.roll *= Math.exp(-dt * 2.2);
    pose.pitch *= Math.exp(-dt * 1.1);
  } else if (Math.abs(pose.roll) > 0.58 && (pose.y + TRACK_CONTACT_OFFSET) > GROUND_DECK_HEIGHT + 0.35) {
    // Real gravitational overhang fulcrum slip: once tipped steeply (>33 deg) over an elevated ledge drop,
    // slide laterally off the deck edge toward the chasm rather than wedging half-over the bridge slab.
    const tipPatches = getContactPatches(pose.x, pose.z, pose.yaw);
    const tipLeftH = (evaluateCourseHeight(tipPatches.frontLeft.x / MAP_SCALE, tipPatches.frontLeft.z / MAP_SCALE, pose.y)
      + evaluateCourseHeight(tipPatches.rearLeft.x / MAP_SCALE, tipPatches.rearLeft.z / MAP_SCALE, pose.y)) * 0.5;
    const tipRightH = (evaluateCourseHeight(tipPatches.frontRight.x / MAP_SCALE, tipPatches.frontRight.z / MAP_SCALE, pose.y)
      + evaluateCourseHeight(tipPatches.rearRight.x / MAP_SCALE, tipPatches.rearRight.z / MAP_SCALE, pose.y)) * 0.5;
    if (Math.abs(tipLeftH - tipRightH) >= 0.65) {
      const slideSign = tipRightH < tipLeftH ? 1 : -1;
      const rightX = Math.cos(pose.yaw);
      const rightZ = -Math.sin(pose.yaw);
      const slideStep = slideSign * Math.sin(Math.min(1.4, Math.abs(pose.roll))) * 2.8 * dt;
      pose.x += rightX * slideStep;
      pose.z += rightZ * slideStep;
      motionState.x = pose.x;
      motionState.z = pose.z;
    }
  }

  // Track peak airborne elevation and evaluate multi-factor falls from height
  // vs gentle on-track ramp sliding / crest-hopping damage control.
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
    const rawLandingPlace = classifyFallZone(landX, landZ, trackBottomNow);
    const originZone = classifyFallOrigin(fallStartOrigin.x, fallStartOrigin.z, peakAirborneY);
    // Driving down the official concrete basin wade ramp into buoyancy is an on-track water entry, not a crash fall.
    const landingPlace = (
      rawLandingPlace === 'water_basin'
      && originZone === 'track_edge'
      && peakAirborneY <= GROUND_DECK_HEIGHT + 0.25
    ) ? 'lower_track' : rawLandingPlace;
    const horizontalSpeedMps = Math.hypot(pose.vx, pose.vz);
    const landSlope = slopeAt((wx, wz) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y), pose.x, pose.z, 0.12);
    const spiralSlot = runtimeCourse.plan.slots.find(s => s.type === 'spiral_tower');
    let onSpiralDescentSlope = false;
    let inSpiralZone = false;
    if (spiralSlot) {
      const su = spiralSlot.dir * (landX - spiralSlot.centerX);
      const sv = Math.abs(landZ - spiralSlot.laneZ);
      inSpiralZone = Math.hypot(landX - (spiralSlot.centerX - spiralSlot.dir * 4.5), landZ - spiralSlot.laneZ) <= 5.2 || sv <= 3.6;
      onSpiralDescentSlope = su >= 4.0 && su <= 12.6 && sv <= 2.15;
    }
    const isOverhangPlunge = (originZone === 'spiral_tower' || inSpiralZone)
      && peakAirborneY >= 1.20
      && trackBottomNow <= 0.15
      && dropHeightM >= 1.50
      && !onSpiralDescentSlope;

    const fallOutcome = evaluateFallOutcome({
      dropHeightM,
      impactSpeedMps: rawImpactVert,
      horizontalSpeedMps,
      landingPlace,
      originZone,
      isInverted: pose.isFlipped,
      slopeGx: landSlope.x,
      slopeGz: landSlope.z,
      vx: pose.vx,
      vz: pose.vz,
      isOverhangPlunge,
    }, config.scoring);

    if (fallOutcome.significantFall) {
      lastFrameBeltShock = Math.max(lastFrameBeltShock, fallOutcome.effectiveImpactMps * 1.15);
      const damageHazard: HazardType = landingPlace === 'sand_pit' ? 'sand' : landingPlace === 'water_basin' ? 'water' : 'none';
      const batShock = applyBatteryShock(subsystems, fallOutcome.batteryShockPct);
      const fallLoss = applyFallImpactDamage(subsystems, fallOutcome.effectiveImpactMps, damageHazard);
      if (fallOutcome.isOnTrackDescent) {
        if (fallOutcome.pointsPenalty > 0) {
          scoreState.penaltyPoints += fallOutcome.pointsPenalty;
          scoreState.score -= fallOutcome.pointsPenalty;
          scoreState.events.push({
            label: 'Heavy Track Landing',
            delta: -fallOutcome.pointsPenalty,
            detail: fallOutcome.summary,
          });
        }
        if (Math.round(fallLoss) >= 1) {
          tone(160, 0.14, 0.05);
          displayToast(`MINOR TRACK JOLT · -${Math.round(fallLoss)}% HP${fallOutcome.pointsPenalty > 0 ? ` · -${fallOutcome.pointsPenalty} PTS` : ''}`);
        }
      } else {
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
    }
    pose.lastImpactSpeed = 0;
    peakAirborneY = trackBottomNow;
    fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: trackBottomNow };
  }
  lastGroundedState = pose.isGrounded;

  // Keep planar motion state in strict lockstep with 3D pose yaw
  motionState.yaw = pose.yaw;

  // Step Mechatronics & Subsystems (Battery, Motors, ESC, Thermal, Hazards, Faults)
  const newFaults = stepSubsystems(
    subsystems,
    effectiveLeft,
    effectiveRight,
    driveResult.motorSlip,
    surf.hazard,
    impactDamage,
    dt
  );
  if (newFaults.length > 0 && raceState === 'racing') {
    tone(140, 0.28, 0.10);
    const label = newFaults.map(id => FAULT_REPAIR_META[id].label).join(' · ');
    displayToast(`🔧 HARDWARE FAULT: ${label} · PRESS [T] FOR 30s TECH PIT`);
  }

  // Step curved bicycle inner-tube belt lateral tracking & derailment simulation
  beltTracking.leftDerailed = subsystems.faults.leftBeltSlipped;
  beltTracking.rightDerailed = subsystems.faults.rightBeltSlipped;
  const rightVecX = Math.cos(pose.yaw);
  const rightVecZ = -Math.sin(pose.yaw);
  const lateralSpeedMps = rightVecX * pose.vx + rightVecZ * pose.vz;
  const beltStep = stepBeltTrackingState(
    beltTracking,
    {
      leftTrackSpeed: driveResult.trackSpeedLeft,
      rightTrackSpeed: driveResult.trackSpeedRight,
      motorSlip: driveResult.motorSlip,
      asymmetricRockDiffM: rockDiffH,
      lateralSpeedMps,
      impactImpulse: lastFrameBeltShock,
      leftTrackIntegrity: subsystems.integrity.leftTrack,
      rightTrackIntegrity: subsystems.integrity.rightTrack,
      waterDepthM: waterBuoyancy.immersionDepth,
    },
    dt,
  );
  lastFrameBeltShock = 0;
  for (const sideName of beltStep.newlyDerailed) {
    if (sideName === 'left') {
      subsystems.faults.leftBeltSlipped = true;
      subsystems.faults.faultReasons.left_belt_slipped = 'Lateral snag pushed left cycle-tube belt off corner pulley wheels';
    } else {
      subsystems.faults.rightBeltSlipped = true;
      subsystems.faults.faultReasons.right_belt_slipped = 'Lateral snag pushed right cycle-tube belt off corner pulley wheels';
    }
    if (raceState === 'racing') {
      tone(155, 0.26, 0.10);
      displayToast(`⚠️ ${sideName.toUpperCase()} CYCLE-TUBE BELT SLIPPED OFF WHEEL · PRESS [T] TO RESEAT`);
    }
  }

  // Fall Detection & Slot Entry Reset on Narrow Elevated Pendulum Catwalk Bridge
  // Evaluates after 3D fall impact so dropping off the 1.35m catwalk applies true height/battery/point consequences first.
  const pendSlot = runtimeCourse.plan.slots.find(s => s.type === 'pendulum_bridge');
  if (raceState === 'racing' && !isRobotDestroyed(subsystems) && pendSlot && Math.abs(localZ - pendSlot.laneZ) <= 2.30) {
    const pu = pendSlot.dir * (localX - pendSlot.centerX);
    if (pu >= -5.6 && pu <= 5.6) {
      const isOffDeck = Math.abs(localZ - pendSlot.laneZ) > 1.00;
      const isBelowElevated = pose.y < 1.15;
      const hitChasmFloor = (pose.y + TRACK_CONTACT_OFFSET) <= ARENA_FLOOR_HEIGHT + 0.14;

      if ((isOffDeck && isBelowElevated && hitChasmFloor) || (pose.isFlipped && pose.flippedTimer > 0.40 && (isOffDeck || isBelowElevated))) {
        const entryAnchor = recoveryAnchors.find(a => a.id === `slot_${pendSlot.index}`) || recoveryAnchors[0];
        applyRecovery(pose, entryAnchor, worldCourseHeight);
        motionState.x = pose.x;
        motionState.z = pose.z;
        motionState.vx = 0;
        motionState.vz = 0;
        motionState.yaw = pose.yaw;
        motionState.angular = 0;
        const recGroundY = evaluateCourseHeight(pose.x / MAP_SCALE, pose.z / MAP_SCALE, pose.y);
        fallStartOrigin = { x: pose.x / MAP_SCALE, z: pose.z / MAP_SCALE, y: recGroundY };
        lastGroundedState = true;
        peakAirborneY = recGroundY;
        scoreState.isOutsideLine = false;
        tone(260, 0.28, 0.08);
        displayToast('FALLEN OFF CATWALK · RESTARTING AT PENDULUM ENTRY');
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
    trackName: ARENA_METADATA[getActiveTrack().id].name,
    setTrack: (id: TrackId, seed?: number) => {
      buildCourseForTrack(id, seed);
      displayToast(`ARENA: ${ARENA_METADATA[id].name.toUpperCase()}`);
    },
    reshuffleCourse: (seed?: number) => buildCourseForTrack(getActiveTrack().id, seed),
    get generatedCourse() { return runtimeCourse.plan; },
    get checkpoints() { return checkpointMeshes; },
    get footballArenas() { return runtimeCourse.footballArenas; },
    getActiveTrack,
    evaluateCourseHeight: (x: number, z: number, y?: number) => evaluateCourseHeight(x, z, y),
    raceState,
    roundNumber,
    techTimeoutRemaining,
    techTimeoutUsedThisRound,
    forceFault: (faultId: HardwareFaultId, reason = 'Simulated stress fault') => {
      if (faultId === 'battery_swollen') subsystems.faults.batterySwollen = true;
      if (faultId === 'circuit_burnt') subsystems.faults.circuitBurnt = true;
      if (faultId === 'left_motor_burnt') subsystems.faults.leftMotorBurnt = true;
      if (faultId === 'right_motor_burnt') subsystems.faults.rightMotorBurnt = true;
      if (faultId === 'left_belt_slipped') {
        subsystems.faults.leftBeltSlipped = true;
        beltTracking.leftDerailed = true;
        beltTracking.leftDrift = -1.05;
      }
      if (faultId === 'right_belt_slipped') {
        subsystems.faults.rightBeltSlipped = true;
        beltTracking.rightDerailed = true;
        beltTracking.rightDrift = 1.05;
      }
      subsystems.faults.faultReasons[faultId] = reason;
      syncRobotVisualHardwareState(performance.now() * 0.001);
      saveCarriedHardware(createCarryoverSnapshot(subsystems, roundNumber));
    },
    get beltTracking() { return beltTracking; },
    get cameraFreeLook() {
      return {
        freeYaw: cameraFreeYaw,
        freePitch: cameraFreePitch,
        distanceOffset: cameraDistanceOffset,
        idleTimer: cameraFreeLookIdle,
        isPointerLocked,
      };
    },
    setCameraFreeLookOffset: (yawDeltaRad: number, pitchDeltaRad = 0, distanceOffset = 0, resetIdle = true) => {
      cameraFreeYaw = wrapSignedAngleRad(cameraFreeYaw + yawDeltaRad);
      cameraFreePitch = clamp(cameraFreePitch + pitchDeltaRad, -1.25, 1.25);
      cameraDistanceOffset = clamp(cameraDistanceOffset + distanceOffset, -4.2, 8.0);
      if (resetIdle) cameraFreeLookIdle = DEFAULT_CAMERA_RETURN_DELAY_SEC;
    },
    triggerTechTimeout: () => openTechnicalTimeout('mid_race'),
    commitRoundAndNext: () => {
      commitEndOfRoundCarryover();
      restartRace();
    },
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
        (checkpoint.bar.material as THREE.MeshBasicMaterial).color.set(checkpoint.passed ? '#ad8944' : '#5b7355');
      });
    },
    getCurrentCheckpoint: () => currentCheckpoint,
    controller,
    getControllerDiagnostics: () => controller.getDiagnostics(),
    getControllerProfile: () => controller.getCurrentProfile(),
    toggleCalibrationModal: (open?: boolean) => toggleDiagnosticsModal(open),
    get lastBarrierCollision() { return lastBarrierCollision; },
    turntableOmega: turntableCurrentOmega,
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

  // Animate curved cycle-tube belts, cleats, and 4 corner pulley wheels independently for left and right sides
  for (let side = 0; side < tracks.length; side++) {
    const tr = tracks[side];
    const isLeft = side === 0;
    const beltSpeed = isLeft ? driveResult.trackSpeedLeft : driveResult.trackSpeedRight;
    const derailed = isLeft ? subsystems.faults.leftBeltSlipped : subsystems.faults.rightBeltSlipped;
    const drift = isLeft ? beltTracking.leftDrift : beltTracking.rightDrift;
    const rubberIntegrity = isLeft ? subsystems.integrity.leftTrack : subsystems.integrity.rightTrack;
    tr.phase = (tr.phase + beltSpeed * dt + CYCLE_TUBE_LOOP_LENGTH) % CYCLE_TUBE_LOOP_LENGTH;

    const beltOptions: CycleTubeSampleOptions = {
      sideSign: tr.sideSign,
      derailed,
      lateralDrift: drift,
      upperSagM:
        (derailed ? 0.095 : 0.044)
        + Math.max(0, 100 - rubberIntegrity) * 0.00045
        + Math.min(0.016, driveResult.motorSlip * 0.015),
      lowerArchM: derailed ? 0.032 : 0.015,
      whipPhase: nowSec * 14.0 + tr.phase * 3.5,
      whipAmpM: derailed
        ? 0.015
        : Math.min(0.010, Math.abs(beltSpeed) * 0.0011 + driveResult.motorSlip * 0.006),
    };
    updateDynamicCycleTubeBeltGeometry(tr.beltGeo, beltOptions);

    for (let i = 0; i < tr.cleats.length; i++) {
      const point = sampleCycleTubeLoop((i / tr.cleats.length) * CYCLE_TUBE_LOOP_LENGTH + tr.phase, beltOptions);
      const q = tr.cleats[i];
      q.position.set(point.x, point.y, point.z);
      q.rotation.x = point.rotationX;
      q.rotation.z = point.rollX;
    }

    for (const w of tr.wheelSpins) {
      // Corner pulley wheels spin solidly on the 'I' axles even if a loose belt slips sideways
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
  const inWaterZone = waterBuoyancy.inWater || surf.hazard === 'water';
  const splashRate = inWaterZone ? dt * (4 + waterMotion * 2.1 + Math.abs(motionState.angular) * 16) : 0;
  if (splashRate > 0 && Math.random() < splashRate) {
    const p = splashParticles.find(drop => drop.life <= 0);
    if (p) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const rightX = Math.cos(pose.yaw);
      const rightZ = -Math.sin(pose.yaw);
      const poolSurfaceY = runtimeCourse.waterPools[0]?.waterLevelY ?? -0.38;
      const spawnY = Math.max(pose.y + 0.16, poolSurfaceY - 0.02);
      p.life = 0.42 + Math.random() * 0.22;
      p.mesh.visible = true;
      p.mesh.position.set(pose.x + rightX * side * 0.78, spawnY, pose.z + rightZ * side * 0.78);
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

  // Hardware Fault Smoke & Venting Gas Particles (swollen LiPo / burnt motors / burnt circuit)
  const faultAnyNow = hasAnyHardwareFault(subsystems);
  if (faultAnyNow && Math.random() < dt * 14) {
    const sp = faultSmokeParticles.find(p => p.life <= 0);
    if (sp) {
      const f = subsystems.faults;
      const rightX = Math.cos(pose.yaw), rightZ = -Math.sin(pose.yaw);
      const fwdX = Math.sin(pose.yaw), fwdZ = Math.cos(pose.yaw);
      let lx = 0, lz = 0;
      if (f.leftMotorBurnt) { lx = -0.46; lz = -0.48; sp.mat.color.set('#22201e'); }
      else if (f.rightMotorBurnt) { lx = 0.46; lz = -0.48; sp.mat.color.set('#22201e'); }
      else if (f.circuitBurnt) { lx = 0; lz = 0.42; sp.mat.color.set('#55483a'); }
      else { lx = -0.24; lz = -0.05; sp.mat.color.set('#7a7d79'); }
      sp.life = 0.72 + Math.random() * 0.35;
      sp.mesh.visible = true;
      sp.mesh.position.set(
        pose.x + rightX * lx + fwdX * lz + (Math.random() - 0.5) * 0.14,
        pose.y + 0.62,
        pose.z + rightZ * lx + fwdZ * lz + (Math.random() - 0.5) * 0.14
      );
      sp.vx = pose.vx * 0.15 + (Math.random() - 0.5) * 0.25;
      sp.vy = 0.75 + Math.random() * 0.55;
      sp.vz = pose.vz * 0.15 + (Math.random() - 0.5) * 0.25;
      sp.mesh.scale.setScalar(0.5);
      sp.mat.opacity = 0.55;
    }
  }
  for (const sp of faultSmokeParticles) {
    if (sp.life <= 0) continue;
    sp.life -= dt;
    sp.mesh.position.x += sp.vx * dt;
    sp.mesh.position.y += sp.vy * dt;
    sp.mesh.position.z += sp.vz * dt;
    sp.mesh.scale.multiplyScalar(1 + dt * 1.45);
    sp.mat.opacity = Math.max(0, sp.life * 0.52);
    if (sp.life <= 0) sp.mesh.visible = false;
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

  }

  // Checkpoint validation & dynamic hurdle point awards
  if (raceState === 'racing' && currentCheckpoint < checkpointMeshes.length) {
    const cp = checkpointMeshes[currentCheckpoint];

    if (crossesCheckpointGate(previousRacePosition, { x: pose.x, z: pose.z }, cp, MAP_SCALE, 1.98, pose.y)) {
      cp.passed = true;
      currentCheckpoint++;
      (cp.bar.material as THREE.MeshBasicMaterial).color.set('#ad8944');
      tone(620, 0.14, 0.05);
      const matchedSlot = runtimeCourse.plan.slots.find(s => s.gateId === cp.id);
      if (matchedSlot && matchedSlot.type !== 'football_arena') {
        const gatePts = awardDynamicHurdlePoints(
          scoreState,
          `${matchedSlot.type}_${matchedSlot.index}`,
          matchedSlot.meta.label,
          matchedSlot.meta.tier,
          config.scoring,
        );
        displayToast(`${matchedSlot.meta.label.toUpperCase()} CLEARED · +${gatePts} PTS [${matchedSlot.meta.tier.toUpperCase()}]`);
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
  const freeState: CameraFreeLookState = {
    freeYaw: cameraFreeYaw,
    freePitch: cameraFreePitch,
    distanceOffset: cameraDistanceOffset,
    idleTimer: cameraFreeLookIdle,
  };
  stepCameraFreeLook(freeState, dt, {
    keyDeltaYaw: -yawKey * 1.35 * dt,
    keyDeltaPitch: pitchKey * 0.9 * dt,
    keyDeltaDistance: zoomKey * 3.0 * dt,
  });
  cameraFreeYaw = freeState.freeYaw;
  cameraFreePitch = freeState.freePitch;
  cameraDistanceOffset = freeState.distanceOffset;
  cameraFreeLookIdle = freeState.idleTimer;

  let homeYaw: number;
  let homePitch: number;
  let homeDistance: number;
  let lookTarget: THREE.Vector3;

  if (raceState === 'tech_timeout') {
    homeYaw = pose.yaw + Math.PI - 0.52;
    homePitch = 0.72;
    homeDistance = 2.95;
    // Shift look target toward camera-left so the damaged robot sits cleanly in the open right viewport beside the pit card
    const leftX = -Math.cos(homeYaw);
    const leftZ = Math.sin(homeYaw);
    lookTarget = V(pose.x + leftX * 0.78, pose.y + 0.46, pose.z + leftZ * 0.78);
  } else if (cameraMode === 0) {
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
  cameraRaycaster.intersectObjects(runtimeCourse.cameraOccluders, false, cameraRayHits);
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
  const roundEl = $<HTMLElement>('#roundNum');
  const pitHudEl = $<HTMLElement>('#pitTimerHud');
  const pillPit = $<HTMLElement>('#pillPit');
  const bat = $<HTMLElement>('#bat');
  const mot = $<HTMLElement>('#mot');
  const pillBat = $<HTMLElement>('#pillBat');
  const pillMot = $<HTMLElement>('#pillMot');
  const hlt = $<HTMLElement>('#hlt');
  const rolloverBanner = $<HTMLElement>('#rolloverAlert');

  if (roundEl) roundEl.textContent = String(roundNumber).padStart(2, '0');
  if (pitHudEl) {
    pitHudEl.textContent = techTimeoutUsedThisRound ? 'USED' : `${Math.max(0, techTimeoutRemaining).toFixed(1)}s`;
  }
  if (pillPit) {
    pillPit.classList.toggle('warn', hasAnyHardwareFault(subsystems) && !techTimeoutUsedThisRound);
  }
  if (pillBat) pillBat.classList.toggle('alert', subsystems.faults.batterySwollen);
  if (pillMot) pillMot.classList.toggle('alert', subsystems.faults.leftMotorBurnt || subsystems.faults.rightMotorBurnt || subsystems.faults.circuitBurnt);

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
      raceState === 'tech_timeout' ? `🔧 30s TECHNICAL TIMEOUT · <i>${Math.max(0, techTimeoutRemaining).toFixed(1)}s</i> LEFT` :
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
    const hbSlot = runtimeCourse.plan.slots.find(s => s.type === 'hanging_bridges');
    const inSandPit = raceState === 'racing'
      && !!hbSlot
      && Math.abs(lx - hbSlot.centerX) <= 4.6
      && Math.abs(lz - hbSlot.laneZ) <= 2.35
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

  // Live active input source pill on bottom bar (never calls poll() during race so edge triggers are preserved)
  const hudBadge = document.querySelector<HTMLElement>('#hudInputBadge');
  if (hudBadge) {
    if (raceState !== 'racing' && !diagnosticsModalOpen) {
      controller.poll();
    }
    const dNow = controller.getDiagnostics();
    if (dNow.source === 'transmitter') {
      hudBadge.className = 'input-source-pill tx';
      hudBadge.textContent = `📡 TX: ${dNow.profileName.slice(0, 22).toUpperCase()}`;
    } else if (dNow.source === 'gamepad') {
      hudBadge.className = 'input-source-pill gp';
      hudBadge.textContent = `🎮 PAD: ${dNow.profileName.slice(0, 20).toUpperCase()}`;
    } else if (dNow.source === 'touch') {
      hudBadge.className = 'input-source-pill';
      hudBadge.textContent = '✋ TOUCH JOYSTICK';
    } else {
      hudBadge.className = 'input-source-pill';
      hudBadge.textContent = dNow.connectedDevices.length > 0 ? '⌨ KEYBOARD (USB STANDBY)' : '⌨ KEYBOARD';
    }
  }

  // Telemetry details panel
  if (drivingHudVisible) {
    const tel = $<HTMLElement>('#driveTelemetry');
    if (tel) {
      const diagNow = controller.getDiagnostics();
      tel.innerHTML = `
        SRC: ${diagNow.source.toUpperCase()} (${diagNow.deviceName})<br>
        SCORE: ${scoreState.score} PTS · OUT-OF-LINE: ${Math.round(scoreState.lastOutFraction * 100)}%<br>
        THR: ${Math.round(diagNow.semanticThrottle * 100)}% · STR: ${Math.round(diagNow.semanticSteering * 100)}%<br>
        L TRACK: ${diagNow.leftTrackCommand.toFixed(2)} · R TRACK: ${diagNow.rightTrackCommand.toFixed(2)}<br>
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
    if (raceState !== 'racing') controller.poll();
    const diag = controller.getDiagnostics();
    const prof = controller.getCurrentProfile();
    const banner = $<HTMLElement>('#diagBanner');
    if (banner) {
      banner.className = `diag-banner ${diag.failsafeActive ? 'alert' : 'ok'}`;
    }
    const devName = $<HTMLElement>('#diagDeviceName');
    if (devName) {
      devName.textContent = `${diag.deviceName} · ${diag.source.toUpperCase()} · ${diag.profileName}`;
    }
    const failState = $<HTMLElement>('#diagFailsafeState');
    if (failState) {
      failState.textContent = diag.failsafeActive
        ? 'Disconnected'
        : diag.activeDeviceIndex !== null
          ? 'USB Synced'
          : diag.connectedDevices.length > 0
            ? 'Detached · Keyboard'
            : 'Keyboard Ready';
    }

    const sweepBtn = $<HTMLElement>('#diagSweepBtn');
    if (sweepBtn) {
      const sweeping = diag.calibrationWizard.activeSweep;
      sweepBtn.classList.toggle('active', sweeping);
      sweepBtn.textContent = sweeping ? 'Finish Sweep (Save)' : 'Sweep Endpoints';
    }

    const wizardEl = $<HTMLElement>('#diagWizardStatus');
    if (wizardEl) {
      const wiz = diag.calibrationWizard;
      if (wiz.activeSweep) {
        wizardEl.classList.remove('hidden');
        wizardEl.textContent = 'STEP ACTIVE: Move all transmitter gimbals / sticks slowly to full corners, release to center, then click "Finish Sweep (Save)".';
      } else if (wiz.waitingAxisTarget) {
        wizardEl.classList.remove('hidden');
        wizardEl.textContent = `LISTENING FOR STICK AXIS (${wiz.waitingAxisTarget.replace(/_/g, ' ').toUpperCase()})... Push stick toward target direction.`;
      } else if (wiz.waitingBindingAction) {
        wizardEl.classList.remove('hidden');
        wizardEl.textContent = `LISTENING FOR BUTTON / TX SWITCH (${wiz.waitingBindingAction.toUpperCase()})... Press gamepad button or flip 2/3-pos transmitter switch.`;
      } else {
        wizardEl.classList.add('hidden');
      }
    }

    const stickDot = $<HTMLElement>('#diagStickDot');
    if (stickDot) {
      const dotX = Math.max(12, Math.min(88, 50 - diag.semanticSteering * 36));
      const dotY = Math.max(12, Math.min(88, 50 - diag.semanticThrottle * 36));
      stickDot.style.left = `${dotX}%`;
      stickDot.style.top = `${dotY}%`;
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
      barSteer.style.background = diag.semanticSteering > 0.05 ? '#7cc4fa' : diag.semanticSteering < -0.05 ? '#f6b75e' : '#f0bd53';
    }
    const semSteer = $<HTMLElement>('#diagSemanticSteer');
    if (semSteer) {
      semSteer.textContent = `${diag.semanticSteering >= 0 ? '+' : ''}${diag.semanticSteering.toFixed(2)} (${diag.directionLabel})`;
    }
    const expNose = $<HTMLElement>('#diagExpectedNose');
    if (expNose) {
      expNose.textContent = diag.semanticSteering > 0.05 ? 'NOSE LEFT' : diag.semanticSteering < -0.05 ? 'NOSE RIGHT' : 'STRAIGHT';
      expNose.className = diag.semanticSteering > 0.05 ? 'left' : diag.semanticSteering < -0.05 ? 'right' : '';
    }
    const deltaYawEl = $<HTMLElement>('#diagDeltaYaw');
    if (deltaYawEl) {
      const dYaw = motionState.yaw - lastReportedYaw;
      deltaYawEl.textContent = `${motionState.angular.toFixed(2)} rad/s (d ${dYaw.toFixed(3)})`;
    }

    const thrLabel = $<HTMLElement>('#diagThrottleLabel');
    if (thrLabel) {
      thrLabel.textContent = diag.throttleLabel;
      thrLabel.className = diag.throttleLabel === 'FORWARD' ? 'forward' : diag.throttleLabel === 'REVERSE' ? 'reverse' : '';
    }
    const barThr = $<HTMLElement>('#diagBarThrottle');
    if (barThr) {
      const pct = Math.max(0, Math.min(100, (diag.semanticThrottle + 1) * 50));
      barThr.style.width = `${pct}%`;
      barThr.style.background = diag.semanticThrottle > 0.05 ? '#7be393' : diag.semanticThrottle < -0.05 ? '#f4847e' : '#f0bd53';
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
        rawList.innerHTML = diag.rawAxes.slice(0, 8).map((raw, idx) => {
          const cal = diag.calibratedAxes[idx] ?? raw;
          const lim = prof.axisCalibrations?.[idx] ?? { min: -1, center: 0, max: 1 };
          const pct = Math.max(0, Math.min(100, (cal + 1) * 50));
          return `
            <div class="diag-axis-card">
              <div class="diag-axis-card-head"><span>Ch ${idx}</span><strong>${cal >= 0 ? '+' : ''}${cal.toFixed(2)}</strong></div>
              <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
              <div class="diag-axis-card-sub">r:${raw >= 0 ? '+' : ''}${raw.toFixed(2)} [${lim.min.toFixed(2)}/${lim.center.toFixed(2)}/${lim.max.toFixed(2)}]</div>
            </div>
          `;
        }).join('');
      } else {
        rawList.innerHTML = `<span class="diag-axis-pill">Source: ${diag.source.toUpperCase()} (Plug USB controller or click Scan USB)</span>`;
      }
    }

    const btnList = $<HTMLElement>('#diagButtonsList');
    if (btnList) {
      if (diag.rawButtons.length > 0) {
        btnList.innerHTML = diag.rawButtons.slice(0, 16).map((pressed, idx) => {
          const v = diag.rawButtonValues[idx] ?? (pressed ? 1 : 0);
          const lit = pressed || v > 0.15;
          return `<span class="diag-btn-led ${lit ? 'on' : ''}">B${idx}${v > 0.05 && v < 0.99 ? `:${v.toFixed(1)}` : ''}</span>`;
        }).join('');
      } else {
        btnList.innerHTML = '';
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
  const rawElapsedSec = clamp((now - lastFrameTime) / 1000, 0, 0.5);
  const frameTime = Math.min(0.05, rawElapsedSec);
  lastFrameTime = now;

  accumulator += frameTime;
  while (accumulator >= FIXED_DT) {
    stepPhysics(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  const tSec = now * 0.001;
  syncRobotVisualHardwareState(tSec);

  // Volumetric Shader Flame Plumes, Flickering PointLights & Rising Sparks across Fire Hearth
  for (let f = 0; f < runtimeCourse.flames.length; f++) {
    const fl = runtimeCourse.flames[f];
    if (fl.shaderMat) {
      fl.shaderMat.uniforms.uTime.value = tSec;
    }
    if (fl.pointLight) {
      fl.pointLight.intensity = 2.35 + 0.65 * Math.sin(tSec * 7.8 + fl.phase1) + 0.35 * Math.cos(tSec * 14.3 + fl.phase2);
    } else if (fl.emberBaseY !== undefined && fl.emberBaseX !== undefined && fl.emberBaseZ !== undefined) {
      const cycle = ((tSec * (fl.emberRiseSpeed ?? 0.6) + fl.phase1) % 1.0);
      fl.mesh.position.set(
        fl.emberBaseX + Math.sin(tSec * 2.4 + fl.phase2) * 0.14,
        fl.emberBaseY + cycle * 1.15,
        fl.emberBaseZ + Math.cos(tSec * 2.1 + fl.phase1) * 0.12
      );
      const emberScale = Math.max(0.15, 1.0 - cycle * 0.85);
      fl.mesh.scale.setScalar(emberScale);
    } else {
      const lick = 1.0 + 0.14 * Math.sin(tSec * fl.freqLick + fl.phase1) + 0.08 * Math.cos(tSec * (fl.freqLick * 1.45) + fl.phase2);
      const flickerXZ = 1.0 + 0.09 * Math.sin(tSec * (fl.freqLick * 1.1) + fl.phase2);
      fl.mesh.scale.set(fl.baseScaleXZ * flickerXZ, fl.baseScaleY * lick, fl.baseScaleXZ * flickerXZ);
    }
  }

  // Magma Hearth Underbed & Charcoal Breathing Glow (muted deep cinder tones so clinkers stay dark & grounded)
  mats.magmaBed.emissiveIntensity = 1.65 + 0.45 * Math.sin(tSec * 4.5) + 0.20 * Math.cos(tSec * 9.2);
  mats.charcoal.emissiveIntensity = 0.42 + 0.18 * Math.sin(tSec * 5.2) + 0.10 * Math.cos(tSec * 11.4);

  // Checkpoint & Dynamic Gantry Laser Beams + Caution Beacons
  const cpStrobeOn = Math.sin(now * 0.008) > 0.3;
  for (let i = 0; i < runtimeCourse.beacons.length; i++) {
    runtimeCourse.beacons[i].visible = cpStrobeOn;
  }
  for (let i = 0; i < runtimeCourse.laserBeams.length; i++) {
    const beam = runtimeCourse.laserBeams[i];
    const cp = checkpointMeshes[i];
    const pulse = 0.45 + 0.35 * Math.sin(now * 0.006 + i * 0.7);
    (beam.material as THREE.MeshBasicMaterial).opacity = cp?.passed ? 0.30 : pulse;
  }

  const dbg = (window as unknown as Record<string, any>).__gameDebug;
  if (dbg) {
    dbg.raceState = raceState;
    dbg.roundNumber = roundNumber;
    dbg.techTimeoutRemaining = techTimeoutRemaining;
    dbg.techTimeoutUsedThisRound = techTimeoutUsedThisRound;
    dbg.subsystems = subsystems;
    dbg.pose = pose;
  }

  updateCamera(rawElapsedSec);
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
syncRobotVisualHardwareState(0);
camera.fov = config.cameraFov;
camera.updateProjectionMatrix();
$<HTMLInputElement>('#cameraFov').value = String(config.cameraFov);
$<HTMLInputElement>('#cameraSens').value = String(config.cameraSensitivity);
$<HTMLSelectElement>('#quality').value = config.quality;
setGraphicsQuality(config.quality);
animate();
