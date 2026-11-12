import * as THREE from 'three';
import {
  ARENA_FLOOR_HEIGHT,
  DRIVE_ROUTE_WIDTH,
  ELEVATION_TIER_SMALL,
  GROUND_DECK_HEIGHT,
  HANGING_SAND_PIT_Y,
  MAP_SCALE,
  createDeterministicRNG,
  easeCushionedRamp,
  evaluateCourseHeight,
  type CheckpointGate,
} from './courseLayout.ts';
import {
  DYNAMIC_WATER_BED_Y,
  DYNAMIC_WATER_LEVEL_Y,
  buildSpiralTowerColliders,
  evaluateCamberBankHeightAt,
  evaluateMogulHeightAt,
  evaluateStaircaseHeightAt,
  sampleHangingBridgeRibbon,
  stepHangingBridgeState,
  type GeneratedCourse,
  type HangingBridgeState,
  type HurdleSlot,
  type HurdleTier,
} from './courseGenerator.ts';
import {
  createBrickMasonryPbrMaps,
  createGoalNetTexture,
  createWaterBasinConcretePbrMaps,
  createWaterSurfaceMaps,
} from './proceduralTextures.ts';
import {
  ROBOT_HALF_LENGTH,
  ROBOT_HALF_WIDTH,
  TRACK_CONTACT_OFFSET,
  TRACK_WIDTH,
  applyTurntableSurfaceInteraction,
  getFootprintAabbHalfExtents,
  type RecoveryAnchor,
  type VehiclePose,
  type WaterPoolConfig,
} from './vehicleDynamics.ts';

export type CourseCollider = {
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  y: number;
  height: number;
  rot: number;
  walkable: boolean;
};

export type CourseMaterials = {
  floor: THREE.Material;
  asphalt: THREE.Material;
  concreteCurb: THREE.Material;
  concretePier: THREE.Material;
  metal: THREE.Material;
  chrome: THREE.Material;
  yellow: THREE.Material;
  laneStripeWhite: THREE.Material;
  laneStripeYellow: THREE.Material;
  red: THREE.Material;
  black: THREE.Material;
  slalomBrick: THREE.Material;
  wood: THREE.Material;
  sand: THREE.Material;
  gravel: THREE.Material;
  ice: THREE.Material;
  diamondPlate: THREE.Material;
  beaconAmber: THREE.Material;
  flameTongue: THREE.Material;
  oil: THREE.Material;
  highClimbDeck: THREE.Material;
  water: THREE.Material;
  waterFoam: THREE.Material;
  rubber: THREE.Material;
  magmaBed: THREE.Material;
  charcoal: THREE.Material;
  granite: THREE.Material;
  basalt: THREE.Material;
  riverStone: THREE.Material;
  limestone: THREE.Material;
  beaconRed: THREE.Material;
  orange: THREE.Material;
};

export type CheckpointMeshRuntime = CheckpointGate & {
  worldX: number;
  worldZ: number;
  group: THREE.Group;
  bar: THREE.Mesh;
  passed: boolean;
};

export type PendulumRuntime = {
  slot: HurdleSlot;
  x: number;
  zCenter: number;
  pivotY: number;
  armLength: number;
  amplitude: number;
  omega: number;
  phase: number;
  ballRadius: number;
  armGroup: THREE.Group;
  hitCooldown: number;
};

export type TurntableRuntime = {
  group: THREE.Group;
  x: number;
  z: number;
  radius: number;
  deckY: number;
};

export type SeesawRuntime = {
  slotIndex: number;
  slot: HurdleSlot;
  pivotGroup: THREE.Group;
  tilt: number;
};

export type TennisBallRuntime = {
  x: number; // local course X
  y: number; // local course Y
  z: number; // local course Z
  vx: number;
  vz: number;
  radius: number; // local course radius
  scored: boolean;
  scoredSide?: -1 | 1;
  holder: THREE.Group;
  mesh: THREE.Mesh;
};

export type FootballArenaRuntime = {
  slot: HurdleSlot;
  ballCount: number;
  tier: HurdleTier;
  pitchHalfU: number;
  pitchHalfV: number;
  goalMouthHalfU: number;
  goalDepthV: number;
  goalLeftLedMat: THREE.MeshBasicMaterial;
  goalRightLedMat: THREE.MeshBasicMaterial;
  flashLeftTimer: number;
  flashRightTimer: number;
  goalsScored: number;
  balls: TennisBallRuntime[];
};

export type FlameRuntime = {
  mesh: THREE.Mesh;
  baseScaleY: number;
  baseScaleXZ: number;
  freqLick: number;
  swaySpeed: number;
  phase1: number;
  phase2: number;
  shaderMat?: THREE.ShaderMaterial;
  pointLight?: THREE.PointLight;
  emberBaseY?: number;
  emberBaseX?: number;
  emberBaseZ?: number;
  emberRiseSpeed?: number;
};

export type HangingBridgeRibbonVisual = {
  side: 0 | 1;
  vNominal: number;
  sideSign: -1 | 1;
  planks: THREE.Mesh[];      // 18 slats preserving exact (0.54, 0.08, 0.62) size
  edgeChainsL: THREE.Mesh[]; // 19 under-deck carrier chain segments pinned to entry & exit anchors
  edgeChainsR: THREE.Mesh[]; // 19 under-deck carrier chain segments pinned to entry & exit anchors
};

export type HangingBridgeRuntime = {
  slotIndex: number;
  slot: HurdleSlot;
  trackSpacingHalf: number;
  ribbons: [HangingBridgeRibbonVisual, HangingBridgeRibbonVisual];
};

export type WaterWakeRing = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
};

export type WaterBasinRuntime = {
  slot: HurdleSlot;
  waterMesh: THREE.Mesh;
  waterGeo: THREE.PlaneGeometry;
  basePositions: Float32Array;
  waterY: number;
  wakeRings: WaterWakeRing[];
  wakeCooldown: number;
};

export type SlidingGateRuntime = {
  slot: HurdleSlot;
  u: number;
  amplitude: number;
  omega: number;
  phase: number;
  halfThickU: number;
  halfWidthV: number;
  gateGroup: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
  hitCooldown: number;
};

export type CourseRuntimeHandles = {
  plan: GeneratedCourse;
  checkpoints: CheckpointMeshRuntime[];
  recoveryAnchors: RecoveryAnchor[];
  turntables: TurntableRuntime[];
  pendulums: PendulumRuntime[];
  seesaws: SeesawRuntime[];
  hangingBridges: HangingBridgeRuntime[];
  slidingGates: SlidingGateRuntime[];
  footballArenas: FootballArenaRuntime[];
  waterBasins: WaterBasinRuntime[];
  flames: FlameRuntime[];
  laserBeams: THREE.Mesh[];
  beacons: THREE.Mesh[];
  waterPools: WaterPoolConfig[];
  cameraOccluders: THREE.Object3D[];
};

const _hbUp = new THREE.Vector3(0, 1, 0);
const _hbDir = new THREE.Vector3();

function alignBridgeSegment(
  mesh: THREE.Mesh,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  mesh.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
  mesh.scale.set(1, len, 1);
  _hbDir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(_hbUp, _hbDir);
}

function updateHangingBridgeVisuals(hb: HangingBridgeRuntime, state: HangingBridgeState) {
  const { slot } = hb;
  const segCount = 18;
  const bridgeY = 0.88;
  const stepU = 9.0 / segCount;
  const toCX = (u: number) => slot.centerX + slot.dir * u;
  const toCZ = (v: number) => slot.laneZ + slot.dir * v;

  for (const rib of hb.ribbons) {
    // 1. Planks & under-deck longitudinal carrier chains anchored directly to both ground ramps (no side ropes or barriers)
    const startX = toCX(-4.5);
    const startZLeft = toCZ(rib.vNominal - 0.23);
    const startZRight = toCZ(rib.vNominal + 0.23);
    const anchorY = bridgeY - 0.075;

    let prevX = startX;
    let prevY = anchorY;
    let prevZLeft = startZLeft;
    let prevZRight = startZRight;

    for (let pi = 0; pi < segCount; pi++) {
      const s0 = pi / segCount;
      const s1 = (pi + 1) / segCount;
      const sMid = (pi + 0.5) / segCount;
      const r0 = sampleHangingBridgeRibbon(state, rib.side, s0);
      const r1 = sampleHangingBridgeRibbon(state, rib.side, s1);
      const rM = sampleHangingBridgeRibbon(state, rib.side, sMid);

      const xM = toCX(-4.5 + sMid * 9.0);
      const yM = rM.y;
      const vM = rib.vNominal + rM.swayV;
      const zM = toCZ(vM);

      const plankMesh = rib.planks[pi];
      plankMesh.position.set(xM, yM - 0.04, zM);
      // Pitch plank cleanly along the deformed catenary tangent slope
      plankMesh.rotation.z = Math.atan2(r1.y - r0.y, slot.dir * stepU);
      // Subtle tilt as chains swing laterally
      plankMesh.rotation.x = rM.swayV * 0.24 * slot.dir;

      const zEdgeL = toCZ(vM - 0.23);
      const zEdgeR = toCZ(vM + 0.23);
      const yChain = yM - 0.075;
      alignBridgeSegment(rib.edgeChainsL[pi], prevX, prevY, prevZLeft, xM, yChain, zEdgeL);
      alignBridgeSegment(rib.edgeChainsR[pi], prevX, prevY, prevZRight, xM, yChain, zEdgeR);

      prevX = xM;
      prevY = yChain;
      prevZLeft = zEdgeL;
      prevZRight = zEdgeR;
    }

    // Final chain link segment pinned cleanly to exit ramp anchor lip (s = 1)
    const endX = toCX(4.5);
    const endZLeft = toCZ(rib.vNominal - 0.23);
    const endZRight = toCZ(rib.vNominal + 0.23);
    alignBridgeSegment(rib.edgeChainsL[segCount], prevX, prevY, prevZLeft, endX, anchorY, endZLeft);
    alignBridgeSegment(rib.edgeChainsR[segCount], prevX, prevY, prevZRight, endX, anchorY, endZRight);
  }
}

// Children added to `courseGroup` inherit `course.scale = (MAP_SCALE, 1, MAP_SCALE)`,
// so geometries/positions inside `courseGroup` stay strictly 1:1 local course (X, Z) and 1:1 meter Y.
const toCourse = (v: number) => v;

function makeBox(
  parent: THREE.Object3D,
  mat: THREE.Material,
  pos: THREE.Vector3,
  size: THREE.Vector3,
  rotY = 0,
  shadow = true,
) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(toCourse(size.x), size.y, toCourse(size.z)),
    mat,
  );
  m.position.set(toCourse(pos.x), pos.y, toCourse(pos.z));
  m.rotation.y = rotY;
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

function makeCyl(
  parent: THREE.Object3D,
  mat: THREE.Material,
  pos: THREE.Vector3,
  r: number,
  h: number,
  axis: 'x' | 'y' | 'z' = 'y',
  segs = 18,
  rotY = 0,
) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(pos.x, pos.y, pos.z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makeCurvedSlopedDeck(
  parent: THREE.Object3D,
  x0: number,
  x1: number,
  z: number,
  width: number,
  y0: number,
  y1: number,
  thickness: number,
  mat: THREE.Material,
  easeFn: (t: number) => number = easeCushionedRamp,
  segments = 22,
  endWidth = width,
) {
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
    const half = (width + (endWidth - width) * u) * 0.5;
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
    indices.push(o, o + 1, n + 1, o, n + 1, n);
    indices.push(o + 3, n + 2, o + 2, o + 3, n + 3, n + 2);
    indices.push(o, n, n + 3, o, n + 3, o + 3);
    indices.push(o + 1, o + 2, n + 2, o + 1, n + 2, n + 1);
  }
  const end = segments * 4;
  indices.push(0, 3, 2, 0, 2, 1);
  indices.push(end + 1, end + 2, end + 3, end + 1, end + 3, end);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeRouteRibbon(
  parent: THREE.Object3D,
  points: { x: number; z: number }[],
  latOffset: number,
  width: number,
  mat: THREE.Material,
  yOff: number,
  thickness = 0.02,
  solidBase = false,
) {
  if (points.length < 2) return;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let accDist = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    if (i > 0) accDist += Math.hypot(curr.x - prev.x, curr.z - prev.z);
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz;
    const rz = tx;
    const d1 = latOffset - width / 2;
    const d2 = latOffset + width / 2;
    const xL = curr.x + rx * d1;
    const zL = curr.z + rz * d1;
    const xR = curr.x + rx * d2;
    const zR = curr.z + rz * d2;
    const y = GROUND_DECK_HEIGHT + yOff;
    positions.push(xL, y, zL, xR, y, zR);
    if (solidBase) {
      positions.push(xL, y - thickness, zL, xR, y - thickness, zR);
    }
    const vCoord = accDist * 0.25;
    uvs.push(0, vCoord, 1, vCoord);
    if (solidBase) uvs.push(0, vCoord, 1, vCoord);
  }
  const stride = solidBase ? 4 : 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * stride;
    const b = (i + 1) * stride;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
    if (solidBase) {
      indices.push(a + 2, b + 3, a + 3, a + 2, b + 2, b + 3);
      indices.push(a, b, b + 2, a, b + 2, a + 2);
      indices.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = solidBase;
  parent.add(mesh);
}

function createTennisBallTexture(): THREE.CanvasTexture {
  const cvs = document.createElement('canvas');
  cvs.width = 128;
  cvs.height = 128;
  const ctx = cvs.getContext('2d')!;
  // Weathered muted felt wool optic yellow-olive (never glowing plastic)
  ctx.fillStyle = '#8b9440';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(40,44,20,0.14)' : 'rgba(210,214,160,0.10)';
    ctx.fillRect((i * 41) % 126, (i * 67) % 126, 2, 2);
  }
  ctx.strokeStyle = '#c2bfb2';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(32, 64, 44, -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(96, 64, 44, Math.PI * 0.58, Math.PI * 1.42);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let cachedTennisMat: THREE.MeshStandardMaterial | null = null;
let cachedTurfMat: THREE.MeshStandardMaterial | null = null;
let cachedWreckingBallMat: THREE.MeshStandardMaterial | null = null;
let cachedBrickMat: THREE.MeshStandardMaterial | null = null;
let cachedGoalNetMat: THREE.MeshBasicMaterial | null = null;
let cachedChicaneDecalMat: THREE.MeshStandardMaterial | null = null;
let cachedChicaneSignMat: THREE.MeshStandardMaterial | null = null;
let cachedReflectiveTapeMat: THREE.MeshStandardMaterial | null = null;
let cachedHazardStripeMat: THREE.MeshStandardMaterial | null = null;
let cachedChevronBoardMat: THREE.MeshStandardMaterial | null = null;
let cachedPolishedDeckMat: THREE.MeshStandardMaterial | null = null;
let cachedPolishedTurntableMat: THREE.MeshStandardMaterial | null = null;
let cachedWaterBasinConcreteMats: {
  floorMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  wetBandMat: THREE.MeshStandardMaterial;
  depthGaugeMat: THREE.MeshStandardMaterial;
} | null = null;
let cachedWaterSurfaceBundle: {
  surfaceMat: THREE.MeshStandardMaterial;
  causticMat: THREE.MeshBasicMaterial;
  shoreFoamMat: THREE.MeshBasicMaterial;
  waterMap: THREE.CanvasTexture;
  waterBump: THREE.CanvasTexture;
  causticMap: THREE.CanvasTexture;
  wakeFoamMap: THREE.CanvasTexture;
} | null = null;

function getWaterBasinConcreteMats() {
  if (!cachedWaterBasinConcreteMats) {
    const floorMaps = createWaterBasinConcretePbrMaps(4, 2);
    const wallMaps = createWaterBasinConcretePbrMaps(6, 1);

    // Painted industrial concrete wall depth gauge plaque (0.2M / 0.5M / 0.7M markers)
    const gCvs = document.createElement('canvas');
    gCvs.width = 256;
    gCvs.height = 128;
    const gx = gCvs.getContext('2d')!;
    gx.fillStyle = '#384142';
    gx.fillRect(0, 0, 256, 128);
    gx.strokeStyle = '#6c736d';
    gx.lineWidth = 4;
    gx.strokeRect(4, 4, 248, 120);
    // Hazard diagonal stripe along top edge
    gx.fillStyle = '#a6873b';
    for (let sx = 0; sx < 256; sx += 28) {
      gx.beginPath();
      gx.moveTo(sx, 6);
      gx.lineTo(sx + 14, 6);
      gx.lineTo(sx + 6, 22);
      gx.lineTo(sx - 8, 22);
      gx.closePath();
      gx.fill();
    }
    gx.fillStyle = '#cfd4cd';
    gx.font = 'bold 20px monospace';
    gx.fillText('DEPTH 0.70M', 18, 48);
    gx.fillStyle = '#9aa8a4';
    gx.font = 'bold 14px monospace';
    gx.fillText('WADE TANK // BUOYANCY ZONE', 18, 74);
    gx.fillStyle = '#a6873b';
    gx.fillRect(18, 88, 220, 4);
    for (let t = 0; t <= 4; t++) {
      gx.fillRect(18 + t * 54, 92, 3, 14);
    }
    gx.fillStyle = '#b4bbb3';
    gx.font = '12px monospace';
    gx.fillText('0.2M    0.4M    0.6M    0.7M', 18, 118);
    const gTex = new THREE.CanvasTexture(gCvs);
    gTex.colorSpace = THREE.SRGBColorSpace;

    cachedWaterBasinConcreteMats = {
      floorMat: new THREE.MeshStandardMaterial({
        map: floorMaps.map,
        bumpMap: floorMaps.bumpMap,
        bumpScale: 0.032,
        roughness: 0.40,
        metalness: 0.06,
      }),
      wallMat: new THREE.MeshStandardMaterial({
        map: wallMaps.map,
        bumpMap: wallMaps.bumpMap,
        bumpScale: 0.026,
        color: '#8f9694',
        roughness: 0.86,
        metalness: 0.04,
      }),
      wetBandMat: new THREE.MeshStandardMaterial({
        color: '#233031',
        roughness: 0.20,
        metalness: 0.12,
      }),
      depthGaugeMat: new THREE.MeshStandardMaterial({
        map: gTex,
        roughness: 0.72,
        metalness: 0.14,
      }),
    };
  }
  return cachedWaterBasinConcreteMats;
}

function getWaterSurfaceBundle() {
  if (!cachedWaterSurfaceBundle) {
    const maps = createWaterSurfaceMaps();
    const waterMap = maps.map as THREE.CanvasTexture;
    const waterBump = maps.bumpMap as THREE.CanvasTexture;
    const causticMap = maps.causticMap;
    const wakeFoamMap = maps.wakeFoamMap;
    cachedWaterSurfaceBundle = {
      waterMap,
      waterBump,
      causticMap,
      wakeFoamMap,
      surfaceMat: new THREE.MeshStandardMaterial({
        map: waterMap,
        bumpMap: waterBump,
        bumpScale: 0.068,
        color: '#1b4752',
        emissive: '#06181e',
        roughness: 0.14,
        metalness: 0.16,
        transparent: true,
        opacity: 0.54,
        depthWrite: false,
      }),
      causticMat: new THREE.MeshBasicMaterial({
        map: causticMap,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      shoreFoamMat: new THREE.MeshBasicMaterial({
        color: '#9db4b8',
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };
  }
  return cachedWaterSurfaceBundle;
}

let cachedFireHearthMats: {
  emberPitMat: THREE.MeshStandardMaterial;
  castIronMat: THREE.MeshStandardMaterial;
  brassNozzleMat: THREE.MeshStandardMaterial;
  firebrickMat: THREE.MeshStandardMaterial;
  sootCurbMat: THREE.MeshStandardMaterial;
} | null = null;

function getFireHearthMats() {
  if (!cachedFireHearthMats) {
    const colCvs = document.createElement('canvas');
    const emsCvs = document.createElement('canvas');
    const bmpCvs = document.createElement('canvas');
    colCvs.width = emsCvs.width = bmpCvs.width = 512;
    colCvs.height = emsCvs.height = bmpCvs.height = 512;
    const cx = colCvs.getContext('2d')!;
    const ex = emsCvs.getContext('2d')!;
    const bx = bmpCvs.getContext('2d')!;

    // Deep charred foundry cinder ash base
    cx.fillStyle = '#1b1817';
    cx.fillRect(0, 0, 512, 512);
    ex.fillStyle = '#080201';
    ex.fillRect(0, 0, 512, 512);
    bx.fillStyle = '#555555';
    bx.fillRect(0, 0, 512, 512);

    // Cracked ember bed fissures + charcoal clinkers
    for (let i = 0; i < 420; i++) {
      const px = (i * 73 + (i % 19) * 31) % 512;
      const py = (i * 137 + (i % 23) * 19) % 512;
      const rx = 5 + (i % 14);
      const ry = 4 + ((i * 3) % 11);
      // Dark coal/clinker piece
      cx.fillStyle = i % 3 === 0 ? '#241f1d' : '#141110';
      cx.beginPath();
      cx.ellipse(px, py, rx, ry, (i % 7) * 0.4, 0, Math.PI * 2);
      cx.fill();
      bx.fillStyle = i % 2 === 0 ? '#a8a8a8' : '#2e2e2e';
      bx.beginPath();
      bx.ellipse(px, py, rx * 0.85, ry * 0.85, (i % 7) * 0.4, 0, Math.PI * 2);
      bx.fill();

      // Glowing muted deep ember seams between clinkers
      if (i % 3 !== 0) {
        const g = ex.createRadialGradient(px, py, 1, px, py, rx * 1.35);
        g.addColorStop(0, i % 5 === 0 ? 'rgba(235, 112, 24, 0.92)' : 'rgba(175, 48, 10, 0.82)');
        g.addColorStop(0.55, 'rgba(98, 20, 4, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ex.fillStyle = g;
        ex.beginPath();
        ex.arc(px, py, rx * 1.4, 0, Math.PI * 2);
        ex.fill();
      }
    }

    const colorTex = new THREE.CanvasTexture(colCvs);
    const emsTex = new THREE.CanvasTexture(emsCvs);
    const bumpTex = new THREE.CanvasTexture(bmpCvs);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    emsTex.colorSpace = THREE.SRGBColorSpace;

    cachedFireHearthMats = {
      emberPitMat: new THREE.MeshStandardMaterial({
        map: colorTex,
        emissiveMap: emsTex,
        emissive: new THREE.Color('#ff5e18'),
        emissiveIntensity: 1.55,
        bumpMap: bumpTex,
        bumpScale: 0.045,
        roughness: 0.94,
        metalness: 0.08,
      }),
      castIronMat: new THREE.MeshStandardMaterial({
        color: '#25282b',
        roughness: 0.62,
        metalness: 0.82,
      }),
      brassNozzleMat: new THREE.MeshStandardMaterial({
        color: '#735b38',
        roughness: 0.44,
        metalness: 0.78,
      }),
      firebrickMat: new THREE.MeshStandardMaterial({
        color: '#4f3a32',
        roughness: 0.94,
        metalness: 0.05,
      }),
      sootCurbMat: new THREE.MeshStandardMaterial({
        color: '#2b2b29',
        roughness: 0.95,
        metalness: 0.06,
      }),
    };
  }
  return cachedFireHearthMats;
}

function createVolumetricFlameMaterial(seed: number, intensity = 1.0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uSeed;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float lift = pow(clamp(uv.y, 0.0, 1.0), 1.45);
        pos.x += sin(uTime * 3.8 + uSeed + uv.y * 5.2) * 0.095 * lift;
        pos.z += cos(uTime * 3.2 + uSeed * 1.7 + uv.y * 4.4) * 0.065 * lift;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uSeed;
      uniform float uIntensity;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.52;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.04;
          a *= 0.48;
        }
        return v;
      }

      void main() {
        float y = clamp(vUv.y, 0.0, 1.0);
        float x = (vUv.x - 0.5) * 2.0;

        // Turbulent upward-convecting distortion
        vec2 flowUv = vec2(vUv.x * 3.2 + uSeed * 0.37, y * 2.9 - uTime * 2.35 + uSeed * 0.53);
        float n1 = fbm(flowUv);
        float n2 = fbm(flowUv * 1.85 + vec2(4.2, -uTime * 1.7));
        float turb = mix(n1, n2, 0.42);

        // Organic burner plume taper (broad nozzle root -> twisted flickering tongues)
        float halfW = mix(0.68, 0.10, pow(y, 0.78)) + (turb - 0.5) * 0.38 * (0.3 + y);
        float radial = smoothstep(halfW, 0.04, abs(x));
        float verticalEnv = smoothstep(0.0, 0.13, y) * (1.0 - smoothstep(0.45, 0.99, y));

        // Broken wispy flame tongues & upper detached embers/smoke
        float body = radial * verticalEnv * (0.42 + 0.92 * turb);
        float flameMask = smoothstep(0.16, 0.56, body);

        // Smoke mantle near upper plume tips
        float smokeZone = smoothstep(0.42, 0.95, y) * radial * smoothstep(0.09, 0.34, body);

        if (flameMask < 0.01 && smokeZone < 0.01) discard;

        // Muted industrial blackbody temperature palette (avoid washed-out pure white)
        vec3 deepRed = vec3(0.54, 0.13, 0.03);
        vec3 amberOrange = vec3(0.86, 0.34, 0.06);
        vec3 hotGold = vec3(0.96, 0.68, 0.24);
        vec3 smokeCol = vec3(0.17, 0.14, 0.13);

        float temp = clamp(body * (1.18 - y * 0.52) * uIntensity, 0.0, 1.0);
        vec3 flameCol = mix(deepRed, amberOrange, smoothstep(0.12, 0.50, temp));
        flameCol = mix(flameCol, hotGold, smoothstep(0.55, 0.95, temp));

        // Base blue-gas pilot shimmer right at burner nozzle exit (y < 0.14)
        float pilotTint = (1.0 - smoothstep(0.02, 0.15, y)) * smoothstep(0.45, 0.85, radial);
        flameCol = mix(flameCol, vec3(0.32, 0.54, 0.78), pilotTint * 0.38);

        vec3 finalCol = mix(smokeCol, flameCol, clamp(flameMask * 1.15, 0.0, 1.0));
        float alpha = clamp(max(flameMask * 0.88, smokeZone * 0.26), 0.0, 0.90);

        gl_FragColor = vec4(finalCol, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

function getWreckingBallMat() {
  if (!cachedWreckingBallMat) {
    const cvs = document.createElement('canvas');
    const bmp = document.createElement('canvas');
    cvs.width = bmp.width = 256;
    cvs.height = bmp.height = 128;
    const ctx = cvs.getContext('2d')!;
    const bx = bmp.getContext('2d')!;
    // Deep oxidized cast-iron body
    ctx.fillStyle = '#1b1d1f';
    ctx.fillRect(0, 0, 256, 128);
    bx.fillStyle = '#7e7e7e';
    bx.fillRect(0, 0, 256, 128);
    // Casting sand pits & rust patina
    for (let i = 0; i < 260; i++) {
      const px = (i * 47) % 252;
      const py = (i * 31) % 124;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(115,68,42,0.18)' : i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.28)';
      ctx.fillRect(px, py, 3, 3);
      bx.fillStyle = i % 2 === 0 ? 'rgba(42,42,42,0.4)' : 'rgba(195,195,195,0.25)';
      bx.fillRect(px, py, 3, 3);
    }
    // Faded chipped industrial ochre hazard chevron belt around mid-hemisphere
    ctx.fillStyle = '#9c7d36';
    ctx.fillRect(0, 40, 256, 48);
    ctx.fillStyle = '#151718';
    for (let sx = -32; sx < 288; sx += 32) {
      ctx.beginPath();
      ctx.moveTo(sx, 40);
      ctx.lineTo(sx + 16, 40);
      ctx.lineTo(sx - 4, 88);
      ctx.lineTo(sx - 20, 88);
      ctx.closePath();
      ctx.fill();
    }
    // Weather scratches across hazard stripe
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(26,28,30,0.45)';
      ctx.fillRect((i * 53) % 250, 38 + ((i * 19) % 52), 4 + (i % 5), 2);
    }
    // Oxidized steel reinforcing trim bands & bolt studs
    ctx.fillStyle = '#3c4246';
    ctx.fillRect(0, 35, 256, 5);
    ctx.fillRect(0, 88, 256, 5);
    ctx.fillStyle = '#6e757a';
    for (let rx = 8; rx < 256; rx += 16) {
      ctx.fillRect(rx, 36, 3, 3);
      ctx.fillRect(rx, 89, 3, 3);
    }
    const tex = new THREE.CanvasTexture(cvs);
    const bumpTex = new THREE.CanvasTexture(bmp);
    tex.wrapS = bumpTex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedWreckingBallMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: bumpTex,
      bumpScale: 0.03,
      roughness: 0.58,
      metalness: 0.44,
    });
  }
  return cachedWreckingBallMat;
}

function getTennisMat() {
  if (!cachedTennisMat) {
    cachedTennisMat = new THREE.MeshStandardMaterial({
      map: createTennisBallTexture(),
      roughness: 0.90,
      metalness: 0.01,
      emissive: '#222608',
      emissiveIntensity: 0.02,
    });
  }
  return cachedTennisMat;
}

function getTurfMat() {
  if (!cachedTurfMat) {
    const cvs = document.createElement('canvas');
    const bmp = document.createElement('canvas');
    cvs.width = bmp.width = 256;
    cvs.height = bmp.height = 256;
    const ctx = cvs.getContext('2d')!;
    const bx = bmp.getContext('2d')!;
    // Faded natural weathered proving-ground stadium grass stripes
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#2b432d' : '#233725';
      ctx.fillRect(i * 32, 0, 32, 256);
    }
    bx.fillStyle = '#7e7e7e';
    bx.fillRect(0, 0, 256, 256);
    // Natural worn soil scuffs & grass blade texture grain
    for (let i = 0; i < 1600; i++) {
      const gx = (i * 73) % 254;
      const gy = (i * 151 + 29) % 254;
      ctx.fillStyle = i % 7 === 0 ? 'rgba(64, 58, 42, 0.22)' : i % 2 === 0 ? 'rgba(18, 28, 19, 0.22)' : 'rgba(84, 108, 80, 0.14)';
      ctx.fillRect(gx, gy, 2, 2);
      bx.fillStyle = i % 2 === 0 ? 'rgba(205,205,205,0.28)' : 'rgba(55,55,55,0.28)';
      bx.fillRect(gx, gy, 2, 2);
    }
    const tex = new THREE.CanvasTexture(cvs);
    const bumpTex = new THREE.CanvasTexture(bmp);
    tex.wrapS = tex.wrapT = bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedTurfMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: bumpTex,
      bumpScale: 0.02,
      roughness: 0.96,
      metalness: 0.01,
    });
  }
  return cachedTurfMat;
}

function getGoalNetMat() {
  if (!cachedGoalNetMat) {
    cachedGoalNetMat = new THREE.MeshBasicMaterial({
      map: createGoalNetTexture(10, 5),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  return cachedGoalNetMat;
}

function getReflectiveTapeMat() {
  if (!cachedReflectiveTapeMat) {
    cachedReflectiveTapeMat = new THREE.MeshStandardMaterial({
      color: '#d4d5ce',
      emissive: '#3a3b34',
      emissiveIntensity: 0.22,
      roughness: 0.32,
      metalness: 0.28,
    });
  }
  return cachedReflectiveTapeMat;
}

function getChicaneDecalMat() {
  if (!cachedChicaneDecalMat) {
    const W = 1024;
    const H = 448;
    const cvs = document.createElement('canvas');
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    // Coordinate map for 10.0m (u: -5..+5) x 4.24m (v: -2.12..+2.12)
    const toPxX = (u: number) => ((u + 5.0) / 10.0) * W;
    const toPxY = (v: number) => ((v + 2.12) / 4.24) * H;

    // 1. Entry & exit optical amber chevron hazard bars (work-zone speed control)
    ctx.fillStyle = 'rgba(196, 152, 54, 0.78)';
    for (const barU of [-4.65, -4.35, 4.35, 4.65]) {
      const bx = toPxX(barU);
      for (let seg = -3; seg <= 3; seg++) {
        const yTop = toPxY(seg * 0.56 - 0.18);
        const yBot = toPxY(seg * 0.56 + 0.18);
        const slant = seg >= 0 ? 12 : -12;
        ctx.beginPath();
        ctx.moveTo(bx - 10, yTop);
        ctx.lineTo(bx + 10, yTop);
        ctx.lineTo(bx + 10 + slant, yBot);
        ctx.lineTo(bx - 10 + slant, yBot);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 2. Entry "SLOW" stencil & exit arrow facing oncoming driver (+u)
    ctx.save();
    ctx.translate(toPxX(-3.92), toPxY(0));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = 'rgba(202, 162, 66, 0.76)';
    ctx.font = 'bold 54px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SLOW', 0, 0);
    ctx.restore();

    // 3. Yellow/black hazard target exclusion pads directly under the 4 chicane pylons
    const obstacleCoords: Array<[number, number]> = [
      [-2.6, -0.95],
      [-0.8, 0.95],
      [1.0, -0.95],
      [2.8, 0.95],
    ];
    for (const [ou, ov] of obstacleCoords) {
      const px = toPxX(ou);
      const py = toPxY(ov);
      const rad = 46;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(22, 23, 24, 0.80)';
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      ctx.fillStyle = 'rgba(196, 152, 54, 0.80)';
      for (let s = -rad * 2; s < rad * 2; s += 20) {
        ctx.beginPath();
        ctx.moveTo(px + s, py - rad);
        ctx.lineTo(px + s + 10, py - rad);
        ctx.lineTo(px + s - 28, py + rad);
        ctx.lineTo(px + s - 38, py + rad);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(196, 152, 54, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Weaving white directional S-curve chevrons guiding driver around pylons
    const guideArrows: Array<[number, number, number]> = [
      [-2.6, 0.92, -0.35],
      [-0.8, -0.92, 0.42],
      [1.0, 0.92, -0.42],
      [2.8, -0.92, 0.35],
      [3.88, 0.0, 0.0],
    ];
    ctx.strokeStyle = 'rgba(205, 206, 198, 0.68)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [au, av, ang] of guideArrows) {
      ctx.save();
      ctx.translate(toPxX(au), toPxY(av));
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(-18, -22);
      ctx.lineTo(6, 0);
      ctx.lineTo(-18, 22);
      ctx.moveTo(0, -22);
      ctx.lineTo(24, 0);
      ctx.lineTo(0, 22);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Realistic asphalt grain wear-through on thermoplastic road markings
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 650; i++) {
      const sx = (i * 197) % W;
      const sy = (i * 89 + 17) % H;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx, sy, 3 + (i % 6), 2);
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedChicaneDecalMat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      roughness: 0.86,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }
  return cachedChicaneDecalMat;
}

function getChicaneSignMat() {
  if (!cachedChicaneSignMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 256;
    const ctx = cvs.getContext('2d')!;
    // Weathered amber diamond warning sign face
    ctx.fillStyle = '#c4932c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#181a1c';
    ctx.lineWidth = 14;
    ctx.strokeRect(14, 14, 228, 228);

    // Crisp S-curve winding traffic arrow symbol inside sign (oriented after 45deg diamond tilt)
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#181a1c';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 66);
    ctx.bezierCurveTo(36, 34, -36, -12, 0, -48);
    ctx.stroke();
    ctx.fillStyle = '#181a1c';
    ctx.beginPath();
    ctx.moveTo(0, -76);
    ctx.lineTo(-24, -40);
    ctx.lineTo(24, -40);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Fine outdoor patina scratches
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(30,28,22,0.12)' : 'rgba(230,215,175,0.08)';
      ctx.fillRect((i * 47) % 250, (i * 79) % 250, 3, 2);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedChicaneSignMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.48,
      metalness: 0.25,
    });
  }
  return cachedChicaneSignMat;
}

function getHazardStripeMat() {
  if (!cachedHazardStripeMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 256;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#bd8d2c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#181a1c';
    for (let x = -256; x < 512; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x - 128, 256);
      ctx.lineTo(x - 160, 256);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(20,22,24,0.16)' : 'rgba(220,210,180,0.08)';
      ctx.fillRect((i * 53) % 252, (i * 97) % 252, 3, 2);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedHazardStripeMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.62,
      metalness: 0.24,
    });
  }
  return cachedHazardStripeMat;
}

function getChevronBoardMat() {
  if (!cachedChevronBoardMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 192;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#c4932c';
    ctx.fillRect(0, 0, 256, 192);
    ctx.strokeStyle = '#181a1c';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 240, 176);
    ctx.fillStyle = '#181a1c';
    ctx.beginPath();
    ctx.moveTo(46, 28);
    ctx.lineTo(116, 28);
    ctx.lineTo(186, 96);
    ctx.lineTo(116, 164);
    ctx.lineTo(46, 164);
    ctx.lineTo(116, 96);
    ctx.closePath();
    ctx.fill();
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedChevronBoardMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.50,
      metalness: 0.22,
    });
  }
  return cachedChevronBoardMat;
}

function getPolishedDeckMat() {
  if (!cachedPolishedDeckMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#4c5156';
    ctx.fillRect(0, 0, 512, 512);
    // Power-troweled satin epoxy concrete clouds for seamless architectural sheen
    for (let i = 0; i < 42; i++) {
      const rx = (i * 137 + 41) % 512;
      const ry = (i * 211 + 83) % 512;
      const rad = 42 + (i % 4) * 26;
      const g = ctx.createRadialGradient(rx, ry, 4, rx, ry, rad);
      g.addColorStop(0, i % 2 === 0 ? 'rgba(95, 102, 108, 0.08)' : 'rgba(28, 31, 34, 0.08)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedPolishedDeckMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.22,
      metalness: 0.14,
      envMapIntensity: 0.85,
    });
  }
  return cachedPolishedDeckMat;
}

function getPolishedTurntableMat() {
  if (!cachedPolishedTurntableMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 512;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#4f555b';
    ctx.fillRect(0, 0, 512, 512);
    // Concentric machined satin polish sheen rings
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 252);
    g.addColorStop(0, 'rgba(110, 118, 126, 0.14)');
    g.addColorStop(0.75, 'rgba(72, 78, 84, 0.06)');
    g.addColorStop(1, 'rgba(24, 27, 30, 0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle flush painted gauge lines & concentric outer rim (baked directly, zero 3D protruding boards)
    ctx.strokeStyle = 'rgba(182, 148, 72, 0.58)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(256, 256, 240, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(195, 200, 204, 0.26)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(256, 256, 152, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(182, 148, 72, 0.42)';
    ctx.lineWidth = 4;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * 44, 256 + Math.sin(a) * 44);
      ctx.lineTo(256 + Math.cos(a) * 232, 256 + Math.sin(a) * 232);
      ctx.stroke();
    }
    ctx.fillStyle = '#383d42';
    ctx.beginPath();
    ctx.arc(256, 256, 36, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    cachedPolishedTurntableMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.20,
      metalness: 0.16,
      envMapIntensity: 0.90,
    });
  }
  return cachedPolishedTurntableMat;
}

/**
 * Builds a closed solid deck ribbon between dynamic (uMinFn(v), uMaxFn(v)) curved boundaries,
 * enabling flush circular arcs around turntable pockets with zero overlap or step seams.
 */
function makeCurvedBoundaryDeck(
  parent: THREE.Object3D,
  slot: HurdleSlot,
  vBreaks: number[],
  uSegs: number,
  uMinFn: (v: number) => number,
  uMaxFn: (v: number) => number,
  heightAt: (u: number, v: number) => number,
  thickness: number,
  mat: THREE.Material,
) {
  const nu = uSegs + 1;
  const nv = vBreaks.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const toX = (u: number) => slot.centerX + slot.dir * u;
  const toZ = (v: number) => slot.laneZ + slot.dir * v;
  const vMin = vBreaks[0];
  const vMax = vBreaks[nv - 1];

  const topGrid: Array<Array<[number, number, number]>> = [];
  const botGrid: Array<Array<[number, number, number]>> = [];
  for (let iu = 0; iu < nu; iu++) {
    const tu = iu / uSegs;
    const rowT: Array<[number, number, number]> = [];
    const rowB: Array<[number, number, number]> = [];
    for (let iv = 0; iv < nv; iv++) {
      const v = vBreaks[iv];
      const u = uMinFn(v) + tu * (uMaxFn(v) - uMinFn(v));
      const yT = heightAt(u, v);
      rowT.push([toX(u), yT, toZ(v)]);
      rowB.push([toX(u), yT - thickness, toZ(v)]);
    }
    topGrid.push(rowT);
    botGrid.push(rowB);
  }

  // Top & Bottom flat-shaded-isolated vertex grids so curved edges keep sharp outer fascia contrast
  const topBase = 0;
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      const [px, py, pz] = topGrid[iu][iv];
      positions.push(px, py, pz);
      uvs.push(iu / uSegs, (vBreaks[iv] - vMin) / Math.max(1e-3, vMax - vMin));
    }
  }
  const botBase = positions.length / 3;
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      const [px, py, pz] = botGrid[iu][iv];
      positions.push(px, py, pz);
      uvs.push(iu / uSegs, (vBreaks[iv] - vMin) / Math.max(1e-3, vMax - vMin));
    }
  }
  for (let iu = 0; iu < nu - 1; iu++) {
    for (let iv = 0; iv < nv - 1; iv++) {
      const a = topBase + iu * nv + iv;
      const b = a + 1;
      const c = topBase + (iu + 1) * nv + iv;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);

      const ab = botBase + iu * nv + iv;
      const bb = ab + 1;
      const cb = botBase + (iu + 1) * nv + iv;
      const db = cb + 1;
      indices.push(ab, db, bb, ab, cb, db);
    }
  }

  const addSideStrip = (ptsTop: Array<[number, number, number]>, ptsBot: Array<[number, number, number]>, flip: boolean) => {
    const base = positions.length / 3;
    for (let i = 0; i < ptsTop.length; i++) {
      positions.push(...ptsTop[i], ...ptsBot[i]);
      const t = i / Math.max(1, ptsTop.length - 1);
      uvs.push(t * 2, 1, t * 2, 0);
    }
    for (let i = 0; i < ptsTop.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flip) indices.push(a, c, d, a, d, b);
      else indices.push(a, b, d, a, d, c);
    }
  };

  addSideStrip(topGrid.map(r => r[0]), botGrid.map(r => r[0]), true);
  addSideStrip(topGrid.map(r => r[nv - 1]), botGrid.map(r => r[nv - 1]), false);
  addSideStrip(topGrid[0], botGrid[0], false);
  addSideStrip(topGrid[nu - 1], botGrid[nu - 1], true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Builds a single glass-smooth continuous 540° helical ramp ribbon mesh with shared smooth
 * upper-surface normals, clean cylindrical fascia, and zero staircase step seams.
 */
function makeContinuousSpiralHelixMesh(
  parent: THREE.Object3D,
  slot: HurdleSlot,
  spU: number,
  rInner: number,
  rOuter: number,
  yStart: number,
  yTop: number,
  thickness: number,
  mat: THREE.Material,
  segs = 108,
  radSegs = 6,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const toX = (u: number) => slot.centerX + slot.dir * u;
  const toZ = (v: number) => slot.laneZ + slot.dir * v;
  const nr = radSegs + 1;

  // Multi-ring radial subdivision eliminates diagonal Gouraud shading streaks across helicoid twist
  const topRings: Array<Array<[number, number, number]>> = [];
  const botRings: Array<Array<[number, number, number]>> = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const beta = t * 3 * Math.PI;
    const yT = yStart + t * (yTop - yStart);
    const yB = i === 0 ? yStart - 0.14 : yT - thickness;
    const cosB = -Math.cos(beta);
    const sinB = -Math.sin(beta);
    const rowT: Array<[number, number, number]> = [];
    const rowB: Array<[number, number, number]> = [];
    for (let ir = 0; ir <= radSegs; ir++) {
      const fr = ir / radSegs;
      const r = rInner + fr * (rOuter - rInner);
      const px = toX(spU + cosB * r);
      const pz = toZ(sinB * r);
      rowT.push([px, yT, pz]);
      rowB.push([px, yB, pz]);
    }
    topRings.push(rowT);
    botRings.push(rowB);
  }

  // Top helical driving surface (smooth continuous shared vertices)
  for (let i = 0; i <= segs; i++) {
    const tv = (i / segs) * 4.5;
    for (let ir = 0; ir <= radSegs; ir++) {
      positions.push(...topRings[i][ir]);
      uvs.push(ir / radSegs, tv);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let ir = 0; ir < radSegs; ir++) {
      const a = i * nr + ir;
      const b = a + 1;
      const c = (i + 1) * nr + ir;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  // Bottom soffit surface
  const botBase = positions.length / 3;
  for (let i = 0; i <= segs; i++) {
    const tv = (i / segs) * 4.5;
    for (let ir = 0; ir <= radSegs; ir++) {
      positions.push(...botRings[i][ir]);
      uvs.push(ir / radSegs, tv);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let ir = 0; ir < radSegs; ir++) {
      const a = botBase + i * nr + ir;
      const b = a + 1;
      const c = botBase + (i + 1) * nr + ir;
      const d = c + 1;
      indices.push(a, d, c, a, b, d);
    }
  }

  const addFascia = (topPts: Array<[number, number, number]>, botPts: Array<[number, number, number]>, flipOutward: boolean) => {
    const fBase = positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      positions.push(...topPts[i], ...botPts[i]);
      const tv = (i / segs) * 6;
      uvs.push(tv, 1, tv, 0);
    }
    for (let i = 0; i < segs; i++) {
      const a = fBase + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flipOutward) indices.push(a, c, d, a, d, b);
      else indices.push(a, b, d, a, d, c);
    }
  };

  addFascia(topRings.map(r => r[radSegs]), botRings.map(r => r[radSegs]), true);
  addFascia(topRings.map(r => r[0]), botRings.map(r => r[0]), false);

  // Entry cap (i = 0)
  for (let ir = 0; ir < radSegs; ir++) {
    const capBase = positions.length / 3;
    positions.push(...topRings[0][ir], ...topRings[0][ir + 1], ...botRings[0][ir], ...botRings[0][ir + 1]);
    uvs.push(0, 1, 1, 1, 0, 0, 1, 0);
    indices.push(capBase, capBase + 1, capBase + 3, capBase, capBase + 3, capBase + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Builds a closed solid prism conforming exactly to arbitrary (u, v) terrain breakpoints,
 * guaranteeing zero height mismatch between visual geometry and vehicle physics probes.
 */
function makeSlotTerrainSolid(
  parent: THREE.Object3D,
  slot: HurdleSlot,
  uBreaks: number[],
  vBreaks: number[],
  heightAt: (u: number, v: number) => number,
  mat: THREE.Material,
  bottomY = ARENA_FLOOR_HEIGHT,
) {
  const nu = uBreaks.length;
  const nv = vBreaks.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const toX = (u: number) => slot.centerX + slot.dir * u;
  const toZ = (v: number) => slot.laneZ + slot.dir * v;
  const uSpan = Math.max(1e-3, uBreaks[nu - 1] - uBreaks[0]);
  const vSpan = Math.max(1e-3, vBreaks[nv - 1] - vBreaks[0]);

  // Top surface vertices [0 .. nu*nv-1]
  for (let iu = 0; iu < nu; iu++) {
    const u = uBreaks[iu];
    const tu = (u - uBreaks[0]) / uSpan;
    for (let iv = 0; iv < nv; iv++) {
      const v = vBreaks[iv];
      const tv = (v - vBreaks[0]) / vSpan;
      positions.push(toX(u), heightAt(u, v), toZ(v));
      uvs.push(tu * 2.5, tv);
    }
  }
  for (let iu = 0; iu < nu - 1; iu++) {
    for (let iv = 0; iv < nv - 1; iv++) {
      const a = iu * nv + iv;
      const b = a + 1;
      const c = (iu + 1) * nv + iv;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  // Helper to push a vertical skirt wall quad strip along any outer perimeter polyline
  const addSkirtWall = (ptsTop: Array<[number, number, number]>, flip: boolean) => {
    const base = positions.length / 3;
    for (let i = 0; i < ptsTop.length; i++) {
      const [px, py, pz] = ptsTop[i];
      positions.push(px, py, pz, px, bottomY, pz);
      const t = i / Math.max(1, ptsTop.length - 1);
      uvs.push(t * 2, 1, t * 2, 0);
    }
    for (let i = 0; i < ptsTop.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flip) {
        indices.push(a, c, d, a, d, b);
      } else {
        indices.push(a, b, d, a, d, c);
      }
    }
  };

  addSkirtWall(uBreaks.map(u => [toX(u), heightAt(u, vBreaks[0]), toZ(vBreaks[0])]), true);
  addSkirtWall(uBreaks.map(u => [toX(u), heightAt(u, vBreaks[nv - 1]), toZ(vBreaks[nv - 1])]), false);
  addSkirtWall(vBreaks.map(v => [toX(uBreaks[0]), heightAt(uBreaks[0], v), toZ(v)]), false);
  addSkirtWall(vBreaks.map(v => [toX(uBreaks[nu - 1]), heightAt(uBreaks[nu - 1], v), toZ(v)]), true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const _strutUp = new THREE.Vector3(0, 1, 0);
const _strutDir = new THREE.Vector3();
function makeStrutBetween(
  parent: THREE.Object3D,
  mat: THREE.Material,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  segs = 10,
) {
  _strutDir.subVectors(b, a);
  const len = _strutDir.length();
  if (len < 1e-4) return;
  const geom = new THREE.CylinderGeometry(radius, radius, len, segs);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_strutUp, _strutDir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function createBrickTextureMat(_baseMat: THREE.Material) {
  if (!cachedBrickMat) {
    const brickMaps = createBrickMasonryPbrMaps();
    cachedBrickMat = new THREE.MeshStandardMaterial({
      map: brickMaps.map,
      bumpMap: brickMaps.bumpMap,
      bumpScale: 0.048,
      roughnessMap: brickMaps.roughnessMap,
      roughness: 0.94,
      metalness: 0.02,
    });
  }
  return cachedBrickMat;
}

function clearGroupDeep(group: THREE.Group) {
  while (group.children.length > 0) {
    const ch = group.children[0];
    group.remove(ch);
    ch.traverse(obj => {
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
  }
}

export function buildDynamicCourseGroup(
  courseGroup: THREE.Group,
  colliders: CourseCollider[],
  plan: GeneratedCourse,
  mats: CourseMaterials,
): CourseRuntimeHandles {
  clearGroupDeep(courseGroup);
  colliders.length = 0;

  // Build carved base Arena Floor (`mats.floor`) outside sunken Sand Pit & Water Basin cutouts
  const floorCutouts: Array<{ xMin: number; xMax: number; zMin: number; zMax: number }> = [];
  for (const s of plan.slots) {
    if (s.type === 'hanging_bridges') {
      floorCutouts.push({ xMin: s.centerX - 4.75, xMax: s.centerX + 4.75, zMin: s.laneZ - 2.15, zMax: s.laneZ + 2.15 });
    } else if (s.type === 'water_basin') {
      floorCutouts.push({ xMin: s.centerX - 4.46, xMax: s.centerX + 4.46, zMin: s.laneZ - 2.38, zMax: s.laneZ + 2.38 });
    }
  }
  const xSplits = Array.from(new Set([-25, 25, ...floorCutouts.flatMap(c => [c.xMin, c.xMax])])).sort((a, b) => a - b);
  for (let xi = 0; xi < xSplits.length - 1; xi++) {
    const xA = xSplits[xi];
    const xB = xSplits[xi + 1];
    if (xB - xA < 0.05) continue;
    const xMid = (xA + xB) * 0.5;
    const overlapping = floorCutouts.filter(c => xMid > c.xMin && xMid < c.xMax);
    if (overlapping.length === 0) {
      makeBox(courseGroup, mats.floor, new THREE.Vector3(xMid, ARENA_FLOOR_HEIGHT - 0.225, 0), new THREE.Vector3(xB - xA, 0.45, 36), 0, false);
    } else {
      const zSplits = Array.from(new Set([-18, 18, ...overlapping.flatMap(c => [c.zMin, c.zMax])])).sort((a, b) => a - b);
      for (let zi = 0; zi < zSplits.length - 1; zi++) {
        const zA = zSplits[zi];
        const zB = zSplits[zi + 1];
        if (zB - zA < 0.05) continue;
        const zMid = (zA + zB) * 0.5;
        const insideHole = overlapping.some(c => zMid > c.zMin && zMid < c.zMax);
        if (!insideHole) {
          makeBox(courseGroup, mats.floor, new THREE.Vector3(xMid, ARENA_FLOOR_HEIGHT - 0.225, zMid), new THREE.Vector3(xB - xA, 0.45, zB - zA), 0, false);
        }
      }
    }
  }

  // Weathered Concrete Perimeter Barriers, Faded Coping & Corner Floodlight Pylons
  for (const [id, x, z, w, d] of [
    ['wall_north', 0, -17.82, 46, 0.32],
    ['wall_south', 0, 17.82, 46, 0.32],
    ['wall_west', -24.02, 0, 0.32, 36],
    ['wall_east', 24.02, 0, 0.32, 36],
  ] as [string, number, number, number, number][]) {
    makeBox(courseGroup, mats.concretePier, new THREE.Vector3(x, ARENA_FLOOR_HEIGHT + 0.39, z), new THREE.Vector3(w, 0.78, d));
    colliders.push({ id, x, z, hx: w / 2, hz: d / 2, y: ARENA_FLOOR_HEIGHT + 0.39, height: 0.78, rot: 0, walkable: false });
  }
  const wallTopY = ARENA_FLOOR_HEIGHT + 0.78;
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(0, wallTopY + 0.015, -17.82), new THREE.Vector3(46, 0.03, 0.34), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(0, wallTopY + 0.015, 17.82), new THREE.Vector3(46, 0.03, 0.34), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(-24.02, wallTopY + 0.015, 0), new THREE.Vector3(0.34, 0.03, 36), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(24.02, wallTopY + 0.015, 0), new THREE.Vector3(0.34, 0.03, 36), 0, false);
  for (const [lx, lz] of [[-23.6, -17.4], [23.6, -17.4], [-23.6, 17.4], [23.6, 17.4]]) {
    makeCyl(courseGroup, mats.metal, new THREE.Vector3(lx, ARENA_FLOOR_HEIGHT + 3.2, lz), 0.14, 6.4, 'y', 12);
    makeBox(courseGroup, mats.black, new THREE.Vector3(lx, ARENA_FLOOR_HEIGHT + 6.4, lz), new THREE.Vector3(0.75, 0.24, 0.42), 0, false);
  }

  // Start Bay & Finish Tire Stop Wall
  makeBox(courseGroup, mats.asphalt, new THREE.Vector3(-19.5, ARENA_FLOOR_HEIGHT + 0.01, 13.50), new THREE.Vector3(4.0, 0.02, DRIVE_ROUTE_WIDTH), 0, false);
  colliders.push({ id: 'start_bay_floor', x: -19.5, z: 13.50, hx: 2.0, hz: DRIVE_ROUTE_WIDTH / 2, y: ARENA_FLOOR_HEIGHT, height: 0.10, rot: 0, walkable: true });
  for (let tr = 0; tr < 2; tr++) {
    for (let tc = 0; tc < 9; tc++) {
      const tx = 16.58 + (tr % 2) * 0.28;
      const tz = -13.50 + (tc - 4) * 0.44;
      const ty = GROUND_DECK_HEIGHT + 0.18 + (tr % 2) * 0.16;
      makeCyl(courseGroup, mats.rubber, new THREE.Vector3(tx, ty, tz), 0.21, 0.28, 'y', 14);
    }
  }
  colliders.push({ id: 'lane_5_terminal_tire_wall', x: 16.86, z: -13.50, hx: 0.6, hz: DRIVE_ROUTE_WIDTH / 2 + 0.1, y: GROUND_DECK_HEIGHT + 0.35, height: 0.7, rot: 0, walkable: false });

  // Helper to get coordinates in local slot frame
  const toCourseX = (slot: HurdleSlot, u: number) => slot.centerX + slot.dir * u;
  const toCourseZ = (slot: HurdleSlot, v: number) => slot.laneZ + slot.dir * v;

  // Build Base Ground Lanes & Hairpins cleanly (cutting away below-grade cutouts like water_basin / hanging_bridges)
  const laneZValues = [13.50, 6.75, 0.00, -6.75, -13.50];
  for (let li = 0; li < laneZValues.length; li++) {
    const lz = laneZValues[li];
    const laneIdx = li + 1;
    const laneSlots = plan.slots.filter(s => s.laneIndex === laneIdx);
    // Split [-17.5..+17.5] around sunken cutouts (water_basin / hanging_bridges) & widened stadium aprons (football_arena)
    const cutouts: Array<[number, number]> = [];
    for (const s of laneSlots) {
      if (s.type === 'water_basin' || s.type === 'hanging_bridges' || s.type === 'pendulum_bridge' || s.type === 'football_arena') {
        const xA = Math.min(s.entryX, s.exitX);
        const xB = Math.max(s.entryX, s.exitX);
        cutouts.push([xA, xB]);
      }
    }
    cutouts.sort((a, b) => a[0] - b[0]);
    const segments: Array<[number, number]> = [];
    let curX = -17.5;
    for (const [cA, cB] of cutouts) {
      if (cA > curX + 0.1) segments.push([curX, cA]);
      curX = Math.max(curX, cB);
    }
    if (curX < (laneIdx === 5 ? 16.0 : 17.5) - 0.1) {
      segments.push([curX, laneIdx === 5 ? 16.0 : 17.5]);
    }

    for (const [x0, x1] of segments) {
      const pts = [{ x: x0, z: lz }, { x: x1, z: lz }];
      makeRouteRibbon(courseGroup, pts, 0, DRIVE_ROUTE_WIDTH, mats.asphalt, 0.006, 0.12, true);
      makeRouteRibbon(courseGroup, pts, -(DRIVE_ROUTE_WIDTH / 2 - 0.10), 0.08, mats.laneStripeWhite, 0.016);
      makeRouteRibbon(courseGroup, pts, DRIVE_ROUTE_WIDTH / 2 - 0.10, 0.08, mats.laneStripeWhite, 0.016);
      makeRouteRibbon(courseGroup, pts, 0, 0.08, mats.yellow, 0.016);
    }
  }

  // 4 Hairpin Ribbons + FIA Outer Kerbs + Corner Chevrons + Inner Center Apex Island Bollards
  const hairpins: Array<[number, number, number, number]> = [
    [17.50, 10.125, Math.PI / 2, -Math.PI / 2],
    [-17.50, 3.375, Math.PI / 2, Math.PI * 1.5],
    [17.50, -3.375, Math.PI / 2, -Math.PI / 2],
    [-17.50, -10.125, Math.PI / 2, Math.PI * 1.5],
  ];
  for (const [hx, hz, a0, a1] of hairpins) {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = a0 + (a1 - a0) * (i / 24);
      pts.push({ x: hx + 3.375 * Math.cos(a), z: hz + 3.375 * Math.sin(a) });
    }
    makeRouteRibbon(courseGroup, pts, 0, DRIVE_ROUTE_WIDTH, mats.asphalt, 0.006, 0.12, true);
    makeRouteRibbon(courseGroup, pts, -(DRIVE_ROUTE_WIDTH / 2 - 0.10), 0.08, mats.laneStripeWhite, 0.016);
    makeRouteRibbon(courseGroup, pts, DRIVE_ROUTE_WIDTH / 2 - 0.10, 0.08, mats.laneStripeWhite, 0.016);
    makeRouteRibbon(courseGroup, pts, 0, 0.08, mats.yellow, 0.016);

    // Outer apex alternating red/white FIA rumble kerbs along curved turn rim (flush at r = 5.42m)
    const kerbCount = 12;
    for (let ki = 0; ki < kerbCount; ki++) {
      const s0 = 0.14 + 0.72 * (ki / kerbCount);
      const s1 = 0.14 + 0.72 * ((ki + 1) / kerbCount);
      const ka0 = a0 + (a1 - a0) * s0;
      const ka1 = a0 + (a1 - a0) * s1;
      const kMid = (ka0 + ka1) * 0.5;
      const arcLen = 5.44 * Math.abs(ka1 - ka0);
      const kerb = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.026, arcLen * 0.94),
        ki % 2 === 0 ? mats.red : mats.concreteCurb,
      );
      kerb.position.set(hx + 5.44 * Math.cos(kMid), GROUND_DECK_HEIGHT + 0.013, hz + 5.44 * Math.sin(kMid));
      kerb.rotation.y = -kMid;
      kerb.receiveShadow = true;
      courseGroup.add(kerb);
    }

    // 3 Reflective turn chevron warning boards mounted outside turn shoulder (r = 6.02m)
    for (const sFrac of [0.28, 0.50, 0.72]) {
      const ang = a0 + (a1 - a0) * sFrac;
      const sx = hx + 6.02 * Math.cos(ang);
      const sz = hz + 6.02 * Math.sin(ang);
      makeCyl(courseGroup, mats.metal, new THREE.Vector3(sx, GROUND_DECK_HEIGHT + 0.34, sz), 0.038, 0.68, 'y', 10);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.48, 0.04), getChevronBoardMat());
      board.position.set(sx, GROUND_DECK_HEIGHT + 0.68, sz);
      board.lookAt(hx, GROUND_DECK_HEIGHT + 0.68, hz);
      if (a1 < a0) board.rotateZ(Math.PI);
      board.castShadow = true;
      courseGroup.add(board);
    }

    // Inner hairpin eyelet hub: weathered concrete island + stacked tire buffer + amber marker (inside r <= 0.56m, clear of r >= 1.15m track)
    makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(hx, GROUND_DECK_HEIGHT + 0.12, hz), 0.56, 0.24, 'y', 18);
    const hubTire = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.14, 10, 20), mats.rubber);
    hubTire.rotation.x = Math.PI / 2;
    hubTire.position.set(hx, GROUND_DECK_HEIGHT + 0.24, hz);
    hubTire.castShadow = true;
    hubTire.receiveShadow = true;
    courseGroup.add(hubTire);
    makeCyl(courseGroup, mats.yellow, new THREE.Vector3(hx, GROUND_DECK_HEIGHT + 0.44, hz), 0.18, 0.32, 'y', 12);
    makeCyl(courseGroup, mats.beaconAmber, new THREE.Vector3(hx, GROUND_DECK_HEIGHT + 0.64, hz), 0.10, 0.10, 'y', 12);
    colliders.push({ id: `hairpin_hub_${Math.round(hx)}_${Math.round(hz)}`, x: hx, z: hz, hx: 0.56, hz: 0.56, y: GROUND_DECK_HEIGHT + 0.35, height: 0.70, rot: 0, walkable: false });
  }

  // Non-intrusive Infield Median Jersey Barriers between lanes where geometry clearances allow
  for (const mz of [10.125, 3.375, -3.375, -10.125]) {
    for (const mx of [-10.0, 0.0, 10.0]) {
      const blocked = plan.slots.some(s =>
        Math.abs(mx - s.centerX) <= s.halfLen + 1.8 && Math.abs(s.laneZ - mz) <= s.meta.halfWidth + 1.15
      );
      if (blocked) continue;
      makeBox(courseGroup, mats.concreteCurb, new THREE.Vector3(mx, ARENA_FLOOR_HEIGHT + 0.22, mz), new THREE.Vector3(2.1, 0.44, 0.34));
      makeBox(courseGroup, mats.yellow, new THREE.Vector3(mx, ARENA_FLOOR_HEIGHT + 0.45, mz), new THREE.Vector3(2.1, 0.03, 0.20), 0, false);
      colliders.push({ id: `median_jersey_${Math.round(mx)}_${Math.round(mz * 10)}`, x: mx, z: mz, hx: 1.05, hz: 0.17, y: ARENA_FLOOR_HEIGHT + 0.22, height: 0.45, rot: 0, walkable: false });
    }
  }

  // Finish & West Staging Perimeter Tire Clusters (well outside active lane splines)
  for (const [px, pz] of [[19.2, -14.8], [21.0, -13.5], [19.2, -12.2], [-21.6, 15.8], [-21.6, 11.2]]) {
    makeCyl(courseGroup, mats.rubber, new THREE.Vector3(px, ARENA_FLOOR_HEIGHT + 0.18, pz), 0.42, 0.36, 'y', 14);
    makeCyl(courseGroup, mats.rubber, new THREE.Vector3(px + 0.02, ARENA_FLOOR_HEIGHT + 0.48, pz - 0.02), 0.38, 0.26, 'y', 14);
  }

  // Paint Grand Finish Checkered Line at Gate Last (x = 13.50, z = -13.50)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 11; c++) {
      makeBox(
        courseGroup,
        (r + c) % 2 === 0 ? mats.laneStripeWhite : mats.black,
        new THREE.Vector3(13.30 + r * 0.40, GROUND_DECK_HEIGHT + 0.018, -13.50 - 2.0 + c * 0.40),
        new THREE.Vector3(0.40, 0.008, 0.40),
        0,
        false,
      );
    }
  }

  const pendulums: PendulumRuntime[] = [];
  const turntables: TurntableRuntime[] = [];
  const seesaws: SeesawRuntime[] = [];
  const hangingBridges: HangingBridgeRuntime[] = [];
  const slidingGates: SlidingGateRuntime[] = [];
  const footballArenas: FootballArenaRuntime[] = [];
  const waterBasins: WaterBasinRuntime[] = [];
  const flames: FlameRuntime[] = [];
  const cameraOccluders: THREE.Object3D[] = [];
  const stoneMats = [mats.granite, mats.basalt, mats.riverStone, mats.limestone];

  // Build every randomized hurdle slot cleanly at its exact world coordinates & direction
  for (const slot of plan.slots) {
    const cx = slot.centerX;
    const lz = slot.laneZ;
    const d = slot.dir;

    if (slot.type === 'brick_slalom') {
      const uPositions = [-3.9, -1.3, 1.3, 3.9];
      uPositions.forEach((u, idx) => {
        const sideSign = idx % 2 === 0 ? 1 : -1;
        const bx = toCourseX(slot, u);
        const bz = toCourseZ(slot, sideSign * (DRIVE_ROUTE_WIDTH * 0.25));
        const len = 0.62;
        const span = DRIVE_ROUTE_WIDTH * 0.50;
        const h = 1.05;
        makeBox(courseGroup, mats.metal, new THREE.Vector3(bx, GROUND_DECK_HEIGHT + 0.04, bz), new THREE.Vector3(len + 0.08, 0.08, span + 0.08));
        makeBox(courseGroup, createBrickTextureMat(mats.slalomBrick), new THREE.Vector3(bx, GROUND_DECK_HEIGHT + 0.08 + (h - 0.14) / 2, bz), new THREE.Vector3(len, h - 0.14, span));
        makeBox(courseGroup, mats.metal, new THREE.Vector3(bx, GROUND_DECK_HEIGHT + h - 0.03, bz), new THREE.Vector3(len + 0.06, 0.06, span + 0.06));
        colliders.push({
          id: `slalom_${slot.index}_${idx}`,
          x: bx,
          z: bz,
          hx: len / 2,
          hz: span / 2,
          y: GROUND_DECK_HEIGHT + h / 2,
          height: h,
          rot: 0,
          walkable: false,
        });
      });
    } else if (slot.type === 'rock_scramble') {
      const rx0 = toCourseX(slot, -4.2);
      const rx1 = toCourseX(slot, -3.5);
      const rx2 = toCourseX(slot, 3.5);
      const rx3 = toCourseX(slot, 4.2);
      makeCurvedSlopedDeck(courseGroup, rx0, rx1, lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL, 0.16, mats.gravel, t => t, 6);
      makeBox(courseGroup, mats.gravel, new THREE.Vector3(cx, GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL / 2, lz), new THREE.Vector3(7.0, ELEVATION_TIER_SMALL, DRIVE_ROUTE_WIDTH));
      makeCurvedSlopedDeck(courseGroup, rx2, rx3, lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL, GROUND_DECK_HEIGHT, 0.16, mats.gravel, t => t, 6);
      const topY = GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL;
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, topY + 0.015, lz + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10)), new THREE.Vector3(7.0, 0.012, 0.09), 0, false);
      }
      for (const st of slot.rockStones ?? []) {
        const sx = toCourseX(slot, st.u);
        const sz = toCourseZ(slot, st.v);
        const stoneMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 1), stoneMats[st.paletteIndex % 4]);
        stoneMesh.position.set(sx, topY + st.scaleY * 0.22, sz);
        stoneMesh.scale.set(st.scaleX, st.scaleY, st.scaleZ);
        stoneMesh.rotation.set(0.3, st.rotY, 0.2);
        stoneMesh.castShadow = true;
        stoneMesh.receiveShadow = true;
        courseGroup.add(stoneMesh);
      }
    } else if (slot.type === 'roller_logs') {
      const logCenters = [-3.6, -2.15, -0.7, 0.75, 2.2, 3.65];
      logCenters.forEach((lu, idx) => {
        const lx = toCourseX(slot, lu);
        const mode = idx % 3;
        const vMid = mode === 0 ? -0.75 : mode === 1 ? 0.75 : 0;
        const lenZ = mode === 2 ? 3.20 : 2.25;
        makeCyl(courseGroup, idx % 2 === 0 ? mats.wood : mats.metal, new THREE.Vector3(lx, GROUND_DECK_HEIGHT, toCourseZ(slot, vMid)), 0.24, lenZ, 'z', 18);
        makeCyl(courseGroup, mats.yellow, new THREE.Vector3(lx, GROUND_DECK_HEIGHT, toCourseZ(slot, vMid - lenZ / 2 + 0.08)), 0.245, 0.10, 'z', 18);
        makeCyl(courseGroup, mats.yellow, new THREE.Vector3(lx, GROUND_DECK_HEIGHT, toCourseZ(slot, vMid + lenZ / 2 - 0.08)), 0.245, 0.10, 'z', 18);
      });
    } else if (slot.type === 'rumble_washboard') {
      for (let i = 0; i < 8; i++) {
        const u = -3.5 + i * 1.0;
        const rx = toCourseX(slot, u);
        const vOff = (i % 2 === 0 ? -0.55 : 0.55);
        makeBox(courseGroup, i % 2 === 0 ? mats.yellow : mats.concreteCurb, new THREE.Vector3(rx, GROUND_DECK_HEIGHT + 0.06, toCourseZ(slot, vOff)), new THREE.Vector3(0.34, 0.13, 2.75), slot.dir * 0.22 * (i % 2 === 0 ? 1 : -1));
      }
    } else if (slot.type === 'fire_hearth') {
      const fireMats = getFireHearthMats();
      // Approach & exit cast-concrete transitions with dark thermal soot edge bands
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -2.5), toCourseX(slot, -2.0), lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, 0.05, 0.16, mats.concretePier, t => t, 5);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 2.0), toCourseX(slot, 2.5), lz, DRIVE_ROUTE_WIDTH, 0.05, GROUND_DECK_HEIGHT, 0.16, mats.concretePier, t => t, 5);
      makeBox(courseGroup, fireMats.sootCurbMat, new THREE.Vector3(toCourseX(slot, -2.02), 0.052, lz), new THREE.Vector3(0.16, 0.012, DRIVE_ROUTE_WIDTH - 0.12), 0, false);
      makeBox(courseGroup, fireMats.sootCurbMat, new THREE.Vector3(toCourseX(slot, 2.02), 0.052, lz), new THREE.Vector3(0.16, 0.012, DRIVE_ROUTE_WIDTH - 0.12), 0, false);

      // Sunken refractory masonry pan + cracked glowing ember bed below driving grating
      makeBox(courseGroup, mats.concretePier, new THREE.Vector3(cx, -0.21, lz), new THREE.Vector3(4.02, 0.42, DRIVE_ROUTE_WIDTH));
      makeBox(courseGroup, fireMats.emberPitMat, new THREE.Vector3(cx, 0.004, lz), new THREE.Vector3(3.92, 0.014, 3.64), 0, false);

      // Scattered charred clinker stones resting across the sunken ash/ember bed
      for (let ci = 0; ci < 18; ci++) {
        const cu = -1.78 + ((ci * 79) % 356) * 0.01;
        const cv = -1.55 + ((ci * 131) % 310) * 0.01;
        makeBox(
          courseGroup,
          mats.charcoal,
          new THREE.Vector3(toCourseX(slot, cu), 0.014, toCourseZ(slot, cv)),
          new THREE.Vector3(0.12 + (ci % 3) * 0.04, 0.022, 0.10 + (ci % 2) * 0.04),
          ci * 0.65,
          false
        );
      }

      // Outer deck shoulders (top = 0.05) + Slotted Heavy Cast-Iron Hearth Grating spanning pit
      for (const side of [-1, 1] as const) {
        makeBox(courseGroup, fireMats.sootCurbMat, new THREE.Vector3(cx, 0.025, toCourseZ(slot, side * 1.98)), new THREE.Vector3(4.02, 0.052, 0.44));
        makeBox(courseGroup, fireMats.castIronMat, new THREE.Vector3(cx, 0.025, toCourseZ(slot, side * 1.78)), new THREE.Vector3(3.96, 0.054, 0.08));
      }
      for (const vBar of [-1.28, -0.64, 0, 0.64, 1.28]) {
        makeBox(courseGroup, fireMats.castIronMat, new THREE.Vector3(cx, 0.022, toCourseZ(slot, vBar)), new THREE.Vector3(3.94, 0.042, 0.075));
      }
      for (let gi = 0; gi < 14; gi++) {
        const gu = -1.86 + gi * (3.72 / 13);
        makeBox(courseGroup, fireMats.castIronMat, new THREE.Vector3(toCourseX(slot, gu), 0.027, lz), new THREE.Vector3(0.085, 0.048, 3.58));
      }

      // Twin Firebrick Curb Manifolds + Machined Cast-Iron/Brass Burner Nozzles + Volumetric GLSL Plumes
      const flameGeom = new THREE.PlaneGeometry(0.68, 0.95, 2, 10);
      flameGeom.translate(0, 0.475, 0);
      const grateJetGeom = new THREE.PlaneGeometry(0.44, 0.44, 2, 8);
      grateJetGeom.translate(0, 0.22, 0);
      const emberGeom = new THREE.BoxGeometry(0.032, 0.032, 0.032);
      const burnerU = [-1.52, -0.76, 0.0, 0.76, 1.52];

      for (const side of [-1, 1] as const) {
        const bankZ = toCourseZ(slot, side * 1.88);
        // Firebrick plinth base + main iron gas distribution rail
        makeBox(courseGroup, fireMats.firebrickMat, new THREE.Vector3(cx, 0.095, bankZ), new THREE.Vector3(3.76, 0.09, 0.22));
        makeCyl(courseGroup, fireMats.castIronMat, new THREE.Vector3(cx, 0.165, bankZ), 0.042, 3.68, 'x', 12);

        burnerU.forEach((bu, idx) => {
          const bx = toCourseX(slot, bu);
          const nozzleZ = toCourseZ(slot, side * 1.79);
          // Cast-iron burner collar & brass diffuser cap angled slightly inward
          const collar = makeCyl(courseGroup, fireMats.castIronMat, new THREE.Vector3(bx, 0.185, nozzleZ), 0.068, 0.11, 'y', 12);
          collar.rotation.x = -side * 0.24 * slot.dir;
          const cap = makeCyl(courseGroup, fireMats.brassNozzleMat, new THREE.Vector3(bx, 0.23, nozzleZ), 0.052, 0.04, 'y', 12);
          cap.rotation.x = -side * 0.24 * slot.dir;

          const seed = slot.index * 19.3 + idx * 3.7 + (side < 0 ? 0 : 11.1);
          const fMat = createVolumetricFlameMaterial(seed, 1.0);
          for (let p = 0; p < 3; p++) {
            const fm = new THREE.Mesh(flameGeom, fMat);
            fm.position.set(bx, 0.20, nozzleZ);
            fm.rotation.y = (p * Math.PI) / 3 + seed * 0.4;
            fm.rotation.x = -side * 0.14 * slot.dir;
            courseGroup.add(fm);
            flames.push({
              mesh: fm,
              baseScaleY: 0.92 + ((idx + p) % 3) * 0.14,
              baseScaleXZ: 0.90 + (p % 2) * 0.16,
              freqLick: 6 + ((idx + p) % 4),
              swaySpeed: 2.8,
              phase1: seed + p * 0.85,
              phase2: seed * 1.3 + p * 1.2,
              shaderMat: p === 0 ? fMat : undefined,
            });
          }
        });
      }

      // Low recessed pilot flame tongues erupting gently from beneath the slotted floor grating
      [-1.18, 0.0, 1.18].forEach((pu, pIdx) => {
        for (const pv of [-0.62, 0.62]) {
          const seed = slot.index * 31.7 + pIdx * 4.3 + pv * 2.1;
          const gMat = createVolumetricFlameMaterial(seed, 0.85);
          for (let p = 0; p < 2; p++) {
            const gm = new THREE.Mesh(grateJetGeom, gMat);
            gm.position.set(toCourseX(slot, pu), 0.02, toCourseZ(slot, pv));
            gm.rotation.y = (p * Math.PI) / 2 + 0.35;
            courseGroup.add(gm);
            flames.push({
              mesh: gm,
              baseScaleY: 0.85 + (pIdx % 2) * 0.22,
              baseScaleXZ: 0.95,
              freqLick: 7 + (pIdx % 3),
              swaySpeed: 3.4,
              phase1: seed + p,
              phase2: seed * 1.7 + p,
              shaderMat: p === 0 ? gMat : undefined,
            });
          }
        }
      });

      // Rising incandescent ember sparks drifting upward over hearth
      for (let ei = 0; ei < 18; ei++) {
        const eu = -1.6 + ((ei * 67) % 320) * 0.01;
        const ev = -1.55 + ((ei * 97) % 310) * 0.01;
        const ex = toCourseX(slot, eu);
        const ez = toCourseZ(slot, ev);
        const em = new THREE.Mesh(emberGeom, mats.beaconAmber);
        em.position.set(ex, 0.18 + (ei % 5) * 0.16, ez);
        courseGroup.add(em);
        flames.push({
          mesh: em,
          baseScaleY: 1,
          baseScaleXZ: 1,
          freqLick: 4,
          swaySpeed: 2.0,
          phase1: ei * 0.73,
          phase2: ei * 1.19,
          emberBaseX: ex,
          emberBaseY: 0.14,
          emberBaseZ: ez,
          emberRiseSpeed: 0.52 + (ei % 4) * 0.18,
        });
      }

      // Twin flickering warm combustion PointLights illuminating steel grate & robot chassis
      for (const lu of [-0.95, 0.95]) {
        const fLight = new THREE.PointLight(0xd95a18, 2.4, 9.5, 1.5);
        fLight.position.set(toCourseX(slot, lu), 0.82, lz);
        courseGroup.add(fLight);
        flames.push({
          mesh: fLight as unknown as THREE.Mesh,
          baseScaleY: 1,
          baseScaleXZ: 1,
          freqLick: 7.5,
          swaySpeed: 1,
          phase1: lu * 1.4,
          phase2: lu * 2.1,
          pointLight: fLight,
        });
      }
    } else if (slot.type === 'water_basin') {
      const basinConcrete = getWaterBasinConcreteMats();
      const waterBundle = getWaterSurfaceBundle();
      const bedY = DYNAMIC_WATER_BED_Y;
      const waterY = DYNAMIC_WATER_LEVEL_Y;
      const roadY = GROUND_DECK_HEIGHT;
      const halfV = DRIVE_ROUTE_WIDTH * 0.5; // 2.20
      const wallTopY = -0.24;

      // 1. Bridge entry/exit cutout transitions [-4.80..-4.40] and [+4.40..+4.80] at road elevation (-0.33m) + runoff trench grates
      for (const endSign of [-1, 1] as const) {
        const apronMidU = endSign * 4.60;
        const apronX = toCourseX(slot, apronMidU);
        makeBox(courseGroup, mats.asphalt, new THREE.Vector3(apronX, roadY - 0.054, lz), new THREE.Vector3(0.42, 0.12, DRIVE_ROUTE_WIDTH), 0, true);
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(apronX, roadY + 0.014, lz), new THREE.Vector3(0.42, 0.012, 0.08), 0, false);
        for (const side of [-1, 1]) {
          makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(apronX, roadY + 0.014, lz + side * (halfV - 0.10)), new THREE.Vector3(0.42, 0.012, 0.08), 0, false);
        }
        // Concrete threshold curb & transverse slotted runoff grate at tank lip (u = ±4.44)
        const grateX = toCourseX(slot, endSign * 4.44);
        makeBox(courseGroup, basinConcrete.wallMat, new THREE.Vector3(grateX, roadY - 0.06, lz), new THREE.Vector3(0.14, 0.13, DRIVE_ROUTE_WIDTH + 0.16), 0, true);
        makeBox(courseGroup, mats.black, new THREE.Vector3(grateX, roadY + 0.002, lz), new THREE.Vector3(0.08, 0.012, DRIVE_ROUTE_WIDTH - 0.36), 0, false);
        for (let gi = -4; gi <= 4; gi++) {
          makeBox(courseGroup, mats.metal, new THREE.Vector3(grateX, roadY + 0.007, lz + gi * 0.44), new THREE.Vector3(0.09, 0.012, 0.035), 0, false);
        }
        // Solid concrete end bulkhead sealing cutout wall below road apron down to tank foundation
        makeBox(courseGroup, basinConcrete.wallMat, new THREE.Vector3(toCourseX(slot, endSign * 4.44), (roadY + bedY - 0.16) * 0.5, lz), new THREE.Vector3(0.16, roadY - (bedY - 0.16), 4.78), 0, false);
      }

      // 2. Submerged concrete tank foundation & tiled bed slab (-1.08m)
      makeBox(courseGroup, basinConcrete.floorMat, new THREE.Vector3(cx, bedY - 0.12, lz), new THREE.Vector3(8.96, 0.24, 4.76), 0, true);

      // Central submerged floor sump recess & bolted cast-iron drain grate
      makeBox(courseGroup, mats.metal, new THREE.Vector3(cx, bedY + 0.004, lz), new THREE.Vector3(0.92, 0.018, 0.92), 0, false);
      makeBox(courseGroup, mats.black, new THREE.Vector3(cx, bedY + 0.008, lz), new THREE.Vector3(0.74, 0.014, 0.74), 0, false);
      for (let bi = -3; bi <= 3; bi++) {
        makeBox(courseGroup, mats.metal, new THREE.Vector3(cx + bi * 0.105, bedY + 0.013, lz), new THREE.Vector3(0.032, 0.012, 0.76), 0, false);
      }

      // 3. Curved Concrete Entry & Exit Wade Ramps [-4.40..-1.90] & [+1.90..+4.40] + Submerged Traction Cleats
      const rampEase = (t: number) => easeCushionedRamp(t, 0.12);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -4.40), toCourseX(slot, -1.90), lz, DRIVE_ROUTE_WIDTH, roadY, bedY, 0.18, basinConcrete.floorMat, rampEase, 18);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 1.90), toCourseX(slot, 4.40), lz, DRIVE_ROUTE_WIDTH, bedY, roadY, 0.18, basinConcrete.floorMat, rampEase, 18);

      for (const side of [-1, 1]) {
        // Submerged white edge guide stripes across deep floor [-1.95..+1.95]
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, bedY + 0.008, lz + side * (halfV - 0.10)), new THREE.Vector3(3.92, 0.01, 0.075), 0, false);
      }
      // Anti-slip concrete cleats & ramp-following edge stripes along both wade ramps
      for (const endSign of [-1, 1] as const) {
        const segN = 10;
        for (let k = 1; k < segN; k++) {
          const t = k / segN;
          const tPrev = (k - 0.5) / segN;
          const tNext = (k + 0.5) / segN;
          const uPos = endSign < 0 ? (-4.40 + 2.50 * t) : (1.90 + 2.50 * t);
          const e0 = endSign < 0 ? rampEase(tPrev) : (1 - rampEase(tPrev));
          const e1 = endSign < 0 ? rampEase(tNext) : (1 - rampEase(tNext));
          const y0 = roadY + (bedY - roadY) * e0;
          const y1 = roadY + (bedY - roadY) * e1;
          const eMid = endSign < 0 ? rampEase(t) : (1 - rampEase(t));
          const yMid = roadY + (bedY - roadY) * eMid;
          const du = (2.50 / segN) * slot.dir;
          const slopeAng = Math.atan2(y1 - y0, du);
          if (k >= 2 && k <= 8) {
            const cleat = makeBox(courseGroup, basinConcrete.wallMat, new THREE.Vector3(toCourseX(slot, uPos), yMid + 0.008, lz), new THREE.Vector3(0.055, 0.016, DRIVE_ROUTE_WIDTH - 0.44), 0, false);
            cleat.rotation.z = slopeAng;
          }
          for (const side of [-1, 1]) {
            const stripe = makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(toCourseX(slot, uPos), yMid + 0.007, lz + side * (halfV - 0.10)), new THREE.Vector3(0.28, 0.01, 0.075), 0, false);
            stripe.rotation.z = slopeAng;
          }
        }
      }

      // 4. Cast Concrete Retaining Sidewalls, Capstone Coping, Wet Tide Band, Depth Gauges & Corner Bollards
      const wallHeight = wallTopY - (bedY - 0.16);
      const wallCenterY = (wallTopY + (bedY - 0.16)) * 0.5;
      const wetTopY = waterY + 0.045;
      const wetHeight = wetTopY - bedY;
      const wetCenterY = (wetTopY + bedY) * 0.5;

      for (const side of [-1, 1] as const) {
        const wallZ = lz + side * (halfV + 0.14); // ±2.34, cleanly covering cutout [±2.38] without narrowing lane
        // Structural retaining sidewall
        makeBox(courseGroup, basinConcrete.wallMat, new THREE.Vector3(cx, wallCenterY, wallZ), new THREE.Vector3(8.98, wallHeight, 0.28), 0, true);
        // Beveled upper coping curb lip + faded safety stripe
        makeBox(courseGroup, basinConcrete.wallMat, new THREE.Vector3(cx, wallTopY + 0.015, wallZ), new THREE.Vector3(9.02, 0.045, 0.32), 0, false);
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(cx, wallTopY + 0.04, lz + side * (halfV + 0.06)), new THREE.Vector3(8.86, 0.012, 0.07), 0, false);
        // Inner dark wet tide-line staining from bed to waterline +4.5cm
        makeBox(courseGroup, basinConcrete.wetBandMat, new THREE.Vector3(cx, wetCenterY, lz + side * (halfV - 0.002)), new THREE.Vector3(8.78, wetHeight, 0.014), 0, false);
        // Painted depth gauge signs mounted flush on inner wall at mid-tank and entry wade slope
        for (const gaugeU of [-2.4, 0.0]) {
          makeBox(
            courseGroup,
            basinConcrete.depthGaugeMat,
            new THREE.Vector3(toCourseX(slot, gaugeU), waterY + 0.03, lz + side * (halfV - 0.013)),
            new THREE.Vector3(0.76, 0.34, 0.008),
            0,
            false,
          );
        }
        // Subtle shoreline meniscus foam ribbon right against inner concrete wall
        makeBox(courseGroup, waterBundle.shoreFoamMat, new THREE.Vector3(cx, waterY + 0.005, lz + side * (halfV - 0.035)), new THREE.Vector3(8.70, 0.008, 0.055), 0, false);
        // Retaining wall collider strictly outside navigable ±2.20m lane
        colliders.push({
          id: `water_wall_${slot.index}_${side}`,
          x: cx,
          z: wallZ,
          hx: 4.48,
          hz: 0.14,
          y: -0.46,
          height: 0.72,
          rot: 0,
          walkable: false,
        });
        // Corner galvanized perimeter marker stanchions outside corner coping
        for (const cornerU of [-4.40, 4.40]) {
          const postX = toCourseX(slot, cornerU);
          makeCyl(courseGroup, mats.chrome, new THREE.Vector3(postX, wallTopY + 0.19, wallZ), 0.042, 0.36, 'y', 10);
          makeCyl(courseGroup, mats.yellow, new THREE.Vector3(postX, wallTopY + 0.37, wallZ), 0.048, 0.05, 'y', 10);
        }
      }

      // Ramp-to-waterline foam lines across entry & exit wade shores (where ramp intersects waterY = -0.38)
      for (const endSign of [-1, 1] as const) {
        const shoreU = endSign * 3.98;
        makeBox(courseGroup, waterBundle.shoreFoamMat, new THREE.Vector3(toCourseX(slot, shoreU), waterY + 0.005, lz), new THREE.Vector3(0.08, 0.008, DRIVE_ROUTE_WIDTH - 0.08), 0, false);
      }

      // 5. Underwater Drifting Caustic Projection Layer
      const causticPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.56, DRIVE_ROUTE_WIDTH - 0.14), waterBundle.causticMat);
      causticPlane.rotation.x = -Math.PI / 2;
      causticPlane.position.set(cx, bedY + 0.016, lz);
      courseGroup.add(causticPlane);

      // 6. Subdivided Interactive Animated Water Surface (44 x 20 grid for gentle waves + rover wake)
      const waterGeo = new THREE.PlaneGeometry(8.78, DRIVE_ROUTE_WIDTH - 0.04, 44, 20);
      const waterMesh = new THREE.Mesh(waterGeo, waterBundle.surfaceMat);
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.set(cx, waterY, lz);
      courseGroup.add(waterMesh);
      const basePositions = new Float32Array(waterGeo.attributes.position.array);

      // Pooled surface wake rings radiating behind submerged moving rover
      const wakeRings: WaterWakeRing[] = [];
      for (let wi = 0; wi < 8; wi++) {
        const wMat = new THREE.MeshBasicMaterial({
          map: waterBundle.wakeFoamMap,
          color: '#c2d8dc',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const wRing = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.95), wMat);
        wRing.rotation.x = -Math.PI / 2;
        wRing.position.set(cx, waterY + 0.008, lz);
        wRing.visible = false;
        courseGroup.add(wRing);
        wakeRings.push({ mesh: wRing, mat: wMat, life: 0, maxLife: 1.0 });
      }

      waterBasins.push({
        slot,
        waterMesh,
        waterGeo,
        basePositions,
        waterY,
        wakeRings,
        wakeCooldown: 0,
      });
    } else if (slot.type === 'football_arena') {
      const ballCount = slot.footballBallCount ?? 5;
      const turfTopY = GROUND_DECK_HEIGHT + 0.016;
      const pitchHalfU = 2.75; // 5.50 front-to-back along road
      const pitchHalfV = 3.05; // 6.10 wide left-to-right (HORIZONTAL stadium orientation)
      const goalMouthHalfU = 1.55; // 3.10 (~4.0m world) wide full goalpost at BOTH ends!
      const goalDepthV = 0.78;
      const goalH = 1.02;

      // Extruded textured trapezoidal stadium entry/exit aprons [-4.50..-2.75] and [+2.75..+4.50]
      for (const endSign of [-1, 1] as const) {
        const uOuter = endSign * 4.50;
        const uInner = endSign * pitchHalfU;
        const xOuter = toCourseX(slot, uOuter);
        const xInner = toCourseX(slot, uInner);
        const shape = new THREE.Shape();
        if (xOuter < xInner) {
          shape.moveTo(xOuter, -2.20);
          shape.lineTo(xInner, -pitchHalfV);
          shape.lineTo(xInner, pitchHalfV);
          shape.lineTo(xOuter, 2.20);
        } else {
          shape.moveTo(xInner, -pitchHalfV);
          shape.lineTo(xOuter, -2.20);
          shape.lineTo(xOuter, 2.20);
          shape.lineTo(xInner, pitchHalfV);
        }
        shape.closePath();

        const apronGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
        apronGeo.rotateX(-Math.PI / 2);
        const aPos = apronGeo.attributes.position;
        const aUv = apronGeo.attributes.uv;
        for (let i = 0; i < aPos.count; i++) {
          aUv.setXY(i, aPos.getX(i) * 0.25, aPos.getZ(i) * 0.25);
        }
        aUv.needsUpdate = true;
        const apronMesh = new THREE.Mesh(apronGeo, mats.asphalt);
        apronMesh.position.set(0, GROUND_DECK_HEIGHT + 0.006 - 0.12, lz);
        apronMesh.receiveShadow = true;
        courseGroup.add(apronMesh);

        // Centered yellow lead-in line across approach/exit apron stopping at grass threshold
        const yMidU = (uOuter + uInner) * 0.5;
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(toCourseX(slot, yMidU), GROUND_DECK_HEIGHT + 0.015, lz), new THREE.Vector3(Math.abs(uInner - uOuter), 0.008, 0.08), 0, false);

        // Angled white sideline stripes & perimeter concrete apron curbs flaring cleanly (2.20 -> 3.05)
        for (const side of [-1, 1] as const) {
          const zRoadStripe = toCourseZ(slot, side * 2.10);
          const zPitchStripe = toCourseZ(slot, side * (pitchHalfV - 0.05));
          const lenStripe = Math.hypot(xInner - xOuter, zPitchStripe - zRoadStripe);
          const angStripe = Math.atan2(-(zPitchStripe - zRoadStripe), xInner - xOuter);
          makeBox(
            courseGroup,
            mats.laneStripeWhite,
            new THREE.Vector3((xOuter + xInner) * 0.5, GROUND_DECK_HEIGHT + 0.015, (zRoadStripe + zPitchStripe) * 0.5),
            new THREE.Vector3(lenStripe, 0.008, 0.08),
            angStripe,
            false,
          );

          const zRoadEdge = toCourseZ(slot, side * 2.22);
          const zPitchEdge = toCourseZ(slot, side * (pitchHalfV + 0.06));
          const lenEdge = Math.hypot(xInner - xOuter, zPitchEdge - zRoadEdge);
          const angEdge = Math.atan2(-(zPitchEdge - zRoadEdge), xInner - xOuter);
          makeBox(
            courseGroup,
            mats.concreteCurb,
            new THREE.Vector3((xOuter + xInner) * 0.5, GROUND_DECK_HEIGHT + 0.03, (zRoadEdge + zPitchEdge) * 0.5),
            new THREE.Vector3(lenEdge, 0.06, 0.10),
            angEdge,
            false,
          );
        }
      }

      // Horizontal Stadium Striped Green Turf Deck (wider Left-Right than Long!)
      makeBox(courseGroup, getTurfMat(), new THREE.Vector3(cx, GROUND_DECK_HEIGHT - 0.004, lz), new THREE.Vector3(pitchHalfU * 2, 0.04, pitchHalfV * 2), 0, false);

      // White Touchline Perimeter & Midfield Lines
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + 0.004, toCourseZ(slot, side * (pitchHalfV - 0.05))), new THREE.Vector3(pitchHalfU * 2 - 0.08, 0.008, 0.08), 0, false);
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(toCourseX(slot, side * (pitchHalfU - 0.05)), turfTopY + 0.004, lz), new THREE.Vector3(0.08, 0.008, pitchHalfV * 2 - 0.08), 0, false);
      }
      // Halfway Line dividing Left Goal Half & Right Goal Half (runs front-to-back at v=0)
      makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + 0.004, lz), new THREE.Vector3(pitchHalfU * 2 - 0.10, 0.008, 0.08), 0, false);
      const centerRing = new THREE.Mesh(new THREE.RingGeometry(0.76, 0.85, 32), mats.laneStripeWhite);
      centerRing.rotation.x = -Math.PI / 2;
      centerRing.position.set(cx, turfTopY + 0.006, lz);
      courseGroup.add(centerRing);
      const centerSpot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), mats.laneStripeWhite);
      centerSpot.rotation.x = -Math.PI / 2;
      centerSpot.position.set(cx, turfTopY + 0.006, lz);
      courseGroup.add(centerSpot);

      // Build BOTH Realistic Full-Width Stadium Goalposts + Penalty Boxes + Woven Net Canopies
      const ledMats: Record<-1 | 1, THREE.MeshBasicMaterial> = {
        [-1]: new THREE.MeshBasicMaterial({ color: '#b08a42' }),
        [1]: new THREE.MeshBasicMaterial({ color: '#b08a42' }),
      };

      const addNetQuad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) => {
        const ng = new THREE.BufferGeometry();
        const pos = new Float32Array([
          p0.x, p0.y, p0.z,
          p1.x, p1.y, p1.z,
          p2.x, p2.y, p2.z,
          p3.x, p3.y, p3.z,
        ]);
        const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
        ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        ng.setIndex([0, 1, 2, 0, 2, 3]);
        ng.computeVertexNormals();
        courseGroup.add(new THREE.Mesh(ng, getGoalNetMat()));
      };

      for (const side of [-1, 1] as const) {
        const lineV = side * pitchHalfV;
        const roofV = side * (pitchHalfV + goalDepthV * 0.34);
        const backV = side * (pitchHalfV + goalDepthV);
        const midV = side * (pitchHalfV + goalDepthV * 0.5);
        const zLine = toCourseZ(slot, lineV);
        const zRoof = toCourseZ(slot, roofV);
        const zBack = toCourseZ(slot, backV);
        const zMid = toCourseZ(slot, midV);
        const xPostA = toCourseX(slot, -goalMouthHalfU);
        const xPostB = toCourseX(slot, goalMouthHalfU);
        const yTop = turfTopY + goalH;
        const yRoof = turfTopY + goalH * 0.88;
        const yBot = turfTopY + 0.04;

        // Penalty Box (18-yard) & 6-yard Goal Box chalk lines + Penalty Spot
        const penBoxInV = lineV - side * 1.15;
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + 0.004, toCourseZ(slot, penBoxInV)), new THREE.Vector3(3.90, 0.008, 0.07), 0, false);
        for (const puSide of [-1, 1]) {
          makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(toCourseX(slot, puSide * 1.95), turfTopY + 0.004, toCourseZ(slot, (lineV + penBoxInV) * 0.5)), new THREE.Vector3(0.07, 0.008, 1.15), 0, false);
        }
        const sixBoxV = lineV - side * 0.45;
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + 0.004, toCourseZ(slot, sixBoxV)), new THREE.Vector3(goalMouthHalfU * 2 + 0.20, 0.008, 0.06), 0, false);
        const penSpot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), mats.laneStripeWhite);
        penSpot.rotation.x = -Math.PI / 2;
        penSpot.position.set(cx, turfTopY + 0.006, toCourseZ(slot, lineV - side * 1.50));
        courseGroup.add(penSpot);

        // Goalpost Uprights, Crossbar & Rounded Elbow Joints
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(xPostA, turfTopY + goalH * 0.5, zLine), 0.056, goalH, 'y', 14);
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(xPostB, turfTopY + goalH * 0.5, zLine), 0.056, goalH, 'y', 14);
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, yTop, zLine), 0.056, goalMouthHalfU * 2, 'x', 14);
        for (const px of [xPostA, xPostB]) {
          const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 10), mats.laneStripeWhite);
          elbow.position.set(px, yTop, zLine);
          courseGroup.add(elbow);
        }

        // Exact Vector-Connected Rear Stanchions (Roof Depth Bar, Rear Back Bar, Ground Runners & Side Struts)
        const pTopL = new THREE.Vector3(xPostA, yTop, zLine);
        const pTopR = new THREE.Vector3(xPostB, yTop, zLine);
        const pRoofL = new THREE.Vector3(xPostA, yRoof, zRoof);
        const pRoofR = new THREE.Vector3(xPostB, yRoof, zRoof);
        const pBackL = new THREE.Vector3(xPostA, yBot, zBack);
        const pBackR = new THREE.Vector3(xPostB, yBot, zBack);
        const pFrontL = new THREE.Vector3(xPostA, yBot, zLine);
        const pFrontR = new THREE.Vector3(xPostB, yBot, zLine);

        makeStrutBetween(courseGroup, mats.orange, pRoofL, pRoofR, 0.036, 10);
        makeStrutBetween(courseGroup, mats.orange, pBackL, pBackR, 0.042, 10);
        makeStrutBetween(courseGroup, mats.orange, pTopL, pRoofL, 0.036, 10);
        makeStrutBetween(courseGroup, mats.orange, pTopR, pRoofR, 0.036, 10);
        makeStrutBetween(courseGroup, mats.orange, pRoofL, pBackL, 0.036, 10);
        makeStrutBetween(courseGroup, mats.orange, pRoofR, pBackR, 0.036, 10);
        makeStrutBetween(courseGroup, mats.orange, pFrontL, pBackL, 0.040, 10);
        makeStrutBetween(courseGroup, mats.orange, pFrontR, pBackR, 0.040, 10);

        // Woven Knotted Diamond Net Canopy & Pocket Walls
        addNetQuad(pTopL, pTopR, pRoofR, pRoofL);
        addNetQuad(pRoofL, pRoofR, pBackR, pBackL);
        addNetQuad(pTopL, pRoofL, pBackL, pFrontL);
        addNetQuad(pTopR, pRoofR, pBackR, pFrontR);

        // Solid green goal-pocket turf deck & rear concrete curb border
        makeBox(courseGroup, getTurfMat(), new THREE.Vector3(cx, GROUND_DECK_HEIGHT - 0.004, zMid), new THREE.Vector3(goalMouthHalfU * 2 + 0.24, 0.04, goalDepthV + 0.06), 0, false);
        makeBox(courseGroup, mats.concreteCurb, new THREE.Vector3(cx, turfTopY + 0.018, toCourseZ(slot, side * (pitchHalfV + goalDepthV + 0.04))), new THREE.Vector3(goalMouthHalfU * 2 + 0.28, 0.05, 0.09), 0, false);

        // Sleek Stadium Goal Scoreboard Housing + LED Light Strip atop crossbar
        makeBox(courseGroup, mats.black, new THREE.Vector3(cx, yTop + 0.075, zLine), new THREE.Vector3(goalMouthHalfU * 1.92, 0.065, 0.07), 0, false);
        const ledMesh = new THREE.Mesh(
          new THREE.BoxGeometry(goalMouthHalfU * 1.84, 0.038, 0.08),
          ledMats[side],
        );
        ledMesh.position.set(cx, yTop + 0.075, zLine);
        courseGroup.add(ledMesh);

        // Netted Goalpost Colliders (rear wall + two side net posts)
        colliders.push({
          id: `football_goal_back_${slot.index}_${side}`,
          x: cx,
          z: zBack,
          hx: goalMouthHalfU + 0.08,
          hz: 0.12,
          y: turfTopY + goalH * 0.5,
          height: goalH + 0.1,
          rot: 0,
          walkable: false,
        });
        for (const puSide of [-1, 1]) {
          colliders.push({
            id: `football_goal_side_${slot.index}_${side}_${puSide}`,
            x: toCourseX(slot, puSide * goalMouthHalfU),
            z: zMid,
            hx: 0.09,
            hz: goalDepthV * 0.5,
            y: turfTopY + goalH * 0.5,
            height: goalH,
            rot: 0,
            walkable: false,
          });
        }

        // Low stadium touchline ball-retaining curbs outside each goal mouth (|u| in [1.62 .. 2.75])
        for (const wingU of [-1, 1]) {
          const wingCenterU = wingU * ((goalMouthHalfU + pitchHalfU) * 0.5 + 0.04);
          const wingLen = pitchHalfU - goalMouthHalfU - 0.08;
          makeBox(courseGroup, mats.concreteCurb, new THREE.Vector3(toCourseX(slot, wingCenterU), turfTopY + 0.09, zLine), new THREE.Vector3(wingLen, 0.18, 0.12));
          makeBox(courseGroup, mats.yellow, new THREE.Vector3(toCourseX(slot, wingCenterU), turfTopY + 0.19, zLine), new THREE.Vector3(wingLen, 0.03, 0.13), 0, false);
        }
      }

      // 4 or 5 Optic-Yellow Tennis Balls arranged cleanly across the horizontal pitch
      const ballPresets = [
        { u: 0.0, v: 0.0 },
        { u: -1.1, v: -0.95 },
        { u: 1.1, v: -0.95 },
        { u: -1.1, v: 0.95 },
        { u: 1.1, v: 0.95 },
      ];
      const ballR = 0.21;
      const balls: TennisBallRuntime[] = [];
      for (let b = 0; b < ballCount; b++) {
        const bp = ballPresets[b % ballPresets.length];
        const bx = toCourseX(slot, bp.u);
        const bz = toCourseZ(slot, bp.v);
        const bHolder = new THREE.Group();
        bHolder.scale.set(1, MAP_SCALE, 1);
        bHolder.position.set(bx, turfTopY + ballR * MAP_SCALE, bz);
        const bMesh = new THREE.Mesh(new THREE.SphereGeometry(ballR, 18, 14), getTennisMat());
        bMesh.castShadow = true;
        bMesh.receiveShadow = true;
        bHolder.add(bMesh);
        courseGroup.add(bHolder);
        balls.push({
          x: bx,
          y: turfTopY + ballR * MAP_SCALE,
          z: bz,
          vx: 0,
          vz: 0,
          radius: ballR,
          scored: false,
          holder: bHolder,
          mesh: bMesh,
        });
      }
      footballArenas.push({
        slot,
        ballCount,
        tier: slot.meta.tier,
        pitchHalfU,
        pitchHalfV,
        goalMouthHalfU,
        goalDepthV,
        goalLeftLedMat: ledMats[-1],
        goalRightLedMat: ledMats[1],
        flashLeftTimer: 0,
        flashRightTimer: 0,
        goalsScored: 0,
        balls,
      });
    } else if (slot.type === 'seesaw_bridge') {
      makeBox(courseGroup, mats.concretePier, new THREE.Vector3(cx, 0.16, lz), new THREE.Vector3(0.56, 0.32, 2.9));
      makeCyl(courseGroup, mats.metal, new THREE.Vector3(cx, 0.22, lz), 0.11, 3.28, 'z', 14);
      makeCyl(courseGroup, mats.yellow, new THREE.Vector3(cx, 0.22, lz - 1.64), 0.17, 0.08, 'z', 14);
      makeCyl(courseGroup, mats.yellow, new THREE.Vector3(cx, 0.22, lz + 1.64), 0.17, 0.08, 'z', 14);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -4.8), toCourseX(slot, -3.5), lz, 3.0, GROUND_DECK_HEIGHT, 0.04, 0.14, mats.metal, easeCushionedRamp, 10);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 3.5), toCourseX(slot, 4.8), lz, 3.0, 0.04, GROUND_DECK_HEIGHT, 0.14, mats.metal, easeCushionedRamp, 10);
      const pivotGroup = new THREE.Group();
      pivotGroup.position.set(cx, 0.42, lz);
      courseGroup.add(pivotGroup);
      const plankDeck = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.16, 3.0), mats.diamondPlate);
      plankDeck.position.set(0, -0.08, 0);
      plankDeck.castShadow = true;
      plankDeck.receiveShadow = true;
      pivotGroup.add(plankDeck);
      for (const side of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.015, 0.10), mats.yellow);
        stripe.position.set(0, 0.008, side * 1.42);
        pivotGroup.add(stripe);
      }
      const initTilt = 0.11;
      pivotGroup.rotation.z = slot.dir * initTilt;
      plan.seesawStates[slot.index] = initTilt;
      seesaws.push({ slotIndex: slot.index, slot, pivotGroup, tilt: initTilt });
    } else if (slot.type === 'speed_humps_ice') {
      // 2 Mega C1 Convex Arched Speed Humps + Low-Grip Reflective Ice Sheet
      for (const cu of [-3.6, 0.0]) {
        const hx = toCourseX(slot, cu);
        makeCurvedSlopedDeck(
          courseGroup,
          hx - 1.65,
          hx + 1.65,
          lz,
          DRIVE_ROUTE_WIDTH,
          GROUND_DECK_HEIGHT,
          GROUND_DECK_HEIGHT + 0.76,
          0.22,
          mats.yellow,
          u => {
            // u goes from 0..1 across xMin..xMax; peak at center u=0.5 via cos^2
            const dFromCenter = (u - 0.5) * 2;
            const c = Math.cos(dFromCenter * Math.PI * 0.5);
            return c * c;
          },
          28,
        );
      }
      makeBox(courseGroup, mats.ice, new THREE.Vector3(toCourseX(slot, 3.7), GROUND_DECK_HEIGHT + 0.015, lz), new THREE.Vector3(3.4, 0.02, DRIVE_ROUTE_WIDTH - 0.15), 0, false);
    } else if (slot.type === 'high_climb') {
      const yTop = 2.45;
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -4.6), toCourseX(slot, 0.0), lz, 5.20, GROUND_DECK_HEIGHT, yTop, 0.24, mats.highClimbDeck, t => easeCushionedRamp(t, 0.14), 28);
      makeBox(courseGroup, mats.diamondPlate, new THREE.Vector3(toCourseX(slot, 0.3), yTop - 0.12, lz), new THREE.Vector3(0.64, 0.24, 5.20));
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 0.6), toCourseX(slot, 4.8), lz, 5.20, yTop, GROUND_DECK_HEIGHT, 0.24, mats.diamondPlate, t => easeCushionedRamp(t, 0.22), 30);
      // Structural piers beneath summit
      for (const side of [-1, 1]) {
        makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(toCourseX(slot, 0.3), (yTop + ARENA_FLOOR_HEIGHT) / 2, lz + side * 2.15), 0.24, yTop - ARENA_FLOOR_HEIGHT - 0.1, 'y', 16);
      }
      // Flush 5.20m boundary guide lines on plateau
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, GROUND_DECK_HEIGHT + 0.016, lz + side * 2.52), new THREE.Vector3(10.0, 0.012, 0.10), 0, false);
      }
    } else if (slot.type === 'oil_chicane') {
      // 1. Flush weathered thermoplastic traffic lane markings & SLOW/weave chevrons
      const decalGroup = new THREE.Group();
      decalGroup.position.set(cx, GROUND_DECK_HEIGHT + 0.011, lz);
      decalGroup.rotation.y = slot.dir > 0 ? 0 : Math.PI;
      const decalMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(10.0, DRIVE_ROUTE_WIDTH - 0.16),
        getChicaneDecalMat(),
      );
      decalMesh.rotation.x = -Math.PI / 2;
      decalMesh.receiveShadow = true;
      decalMesh.renderOrder = 2;
      decalGroup.add(decalMesh);
      courseGroup.add(decalGroup);

      // 2. Organic glossy crude oil puddle overlay aligned over center 7.4m hazard zone
      const oilGroup = new THREE.Group();
      oilGroup.position.set(cx, GROUND_DECK_HEIGHT + 0.015, lz);
      oilGroup.rotation.y = slot.dir > 0 ? 0 : Math.PI;
      const oilMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(7.35, DRIVE_ROUTE_WIDTH - 0.12),
        mats.oil,
      );
      oilMesh.rotation.x = -Math.PI / 2;
      oilMesh.receiveShadow = true;
      oilMesh.renderOrder = 3;
      oilGroup.add(oilMesh);
      courseGroup.add(oilGroup);

      // 3. Alternating red/white circuit apex kerbs on outer shoulders opposite weave points
      const chicanes = [
        { u: -2.6, v: -0.95 },
        { u: -0.8, v: 0.95 },
        { u: 1.0, v: -0.95 },
        { u: 2.8, v: 0.95 },
      ];
      chicanes.forEach((c, ci) => {
        const apexSide = -Math.sign(c.v);
        const kerbV = apexSide * (DRIVE_ROUTE_WIDTH * 0.5 - 0.14);
        for (let kb = 0; kb < 3; kb++) {
          const ku = c.u + (kb - 1) * 0.44;
          makeBox(
            courseGroup,
            kb % 2 === 0 ? mats.red : mats.concreteCurb,
            new THREE.Vector3(toCourseX(slot, ku), GROUND_DECK_HEIGHT + 0.016, toCourseZ(slot, kerbV)),
            new THREE.Vector3(0.42, 0.032, 0.22),
            0,
            false,
          );
        }

        // 4. Multi-part traffic chicane pylon: octagonal rubber base + stacked toroidal tires + highway cone/barrel
        const tx = toCourseX(slot, c.u);
        const tz = toCourseZ(slot, c.v);
        const pylonGroup = new THREE.Group();
        pylonGroup.position.set(tx, GROUND_DECK_HEIGHT, tz);

        const baseHex = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.37, 0.055, 8), mats.rubber);
        baseHex.position.y = 0.028;
        baseHex.rotation.y = ci * 0.35;
        baseHex.castShadow = true;
        baseHex.receiveShadow = true;
        pylonGroup.add(baseHex);

        for (let t = 0; t < 2; t++) {
          const tire = new THREE.Mesh(new THREE.TorusGeometry(0.24 - t * 0.008, 0.112, 12, 24), mats.rubber);
          tire.rotation.x = Math.PI / 2;
          tire.position.set(t === 1 ? (ci % 2 === 0 ? 0.016 : -0.016) : 0, 0.145 + t * 0.185, t === 1 ? 0.012 : 0);
          tire.castShadow = true;
          tire.receiveShadow = true;
          pylonGroup.add(tire);
        }

        const innerCore = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.40, 16), mats.metal);
        innerCore.position.y = 0.21;
        innerCore.castShadow = true;
        innerCore.receiveShadow = true;
        pylonGroup.add(innerCore);

        const collarBand = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.055, 16), mats.yellow);
        collarBand.position.y = 0.36;
        collarBand.castShadow = true;
        pylonGroup.add(collarBand);

        if (ci % 2 === 0) {
          // Weighted reflector safety traffic cone
          const coneCap = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.21, 0.04, 14), mats.black);
          coneCap.position.y = 0.43;
          coneCap.castShadow = true;
          pylonGroup.add(coneCap);

          const coneBody = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.165, 0.58, 20), mats.orange);
          coneBody.position.y = 0.74;
          coneBody.castShadow = true;
          coneBody.receiveShadow = true;
          pylonGroup.add(coneBody);

          const lowerTape = new THREE.Mesh(new THREE.CylinderGeometry(0.120, 0.143, 0.088, 20), getReflectiveTapeMat());
          lowerTape.position.y = 0.635;
          pylonGroup.add(lowerTape);

          const upperTape = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.109, 0.095, 20), getReflectiveTapeMat());
          upperTape.position.y = 0.825;
          pylonGroup.add(upperTape);
        } else {
          // Striped highway channelizer barrel + amber barricade beacon
          const drumFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.245, 0.045, 18), mats.black);
          drumFoot.position.y = 0.43;
          drumFoot.castShadow = true;
          pylonGroup.add(drumFoot);

          const drumLow = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.226, 0.155, 20), mats.orange);
          drumLow.position.y = 0.53;
          drumLow.castShadow = true;
          drumLow.receiveShadow = true;
          pylonGroup.add(drumLow);

          const drumWhite = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.219, 0.145, 20), getReflectiveTapeMat());
          drumWhite.position.y = 0.68;
          drumWhite.castShadow = true;
          pylonGroup.add(drumWhite);

          const drumTop = new THREE.Mesh(new THREE.CylinderGeometry(0.200, 0.210, 0.145, 20), mats.orange);
          drumTop.position.y = 0.825;
          drumTop.castShadow = true;
          drumTop.receiveShadow = true;
          pylonGroup.add(drumTop);

          const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.06, 12), mats.black);
          lampStem.position.y = 0.925;
          pylonGroup.add(lampStem);

          const lampLens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.075, 12), mats.beaconAmber);
          lampLens.position.y = 0.985;
          pylonGroup.add(lampLens);
        }

        courseGroup.add(pylonGroup);
        colliders.push({ id: `oil_tire_${slot.index}_${ci}`, x: tx, z: tz, hx: 0.36, hz: 0.36, y: GROUND_DECK_HEIGHT + 0.26, height: 0.52, rot: 0, walkable: false });
      });

      // 5. Roadside shoulder Chicane Ahead diamond warning sign (outside +/-2.20m lane shoulder)
      const signX = toCourseX(slot, -4.65);
      const signZ = toCourseZ(slot, -2.42);
      const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 1.32, 10), mats.metal);
      signPost.position.set(signX, GROUND_DECK_HEIGHT + 0.66, signZ);
      signPost.castShadow = true;
      courseGroup.add(signPost);

      const signFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.06, 10), mats.concretePier);
      signFoot.position.set(signX, GROUND_DECK_HEIGHT + 0.03, signZ);
      courseGroup.add(signFoot);

      const signPlateGroup = new THREE.Group();
      signPlateGroup.position.set(signX, GROUND_DECK_HEIGHT + 1.18, signZ);
      // Orient plate facing approaching traffic along -dir on X
      signPlateGroup.rotation.y = slot.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      const signPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.03), getChicaneSignMat());
      signPlate.rotation.z = Math.PI / 4;
      signPlate.castShadow = true;
      signPlateGroup.add(signPlate);
      courseGroup.add(signPlateGroup);
    } else if (slot.type === 'turntable_deck') {
      const deckY = 0.92;
      const rTt = 2.30;
      const rPocket = 2.34;
      const vBreaks: number[] = [];
      for (let i = 0; i <= 16; i++) vBreaks.push(-1.65 + (3.30 * i) / 16);
      makeCurvedBoundaryDeck(
        courseGroup,
        slot,
        vBreaks,
        14,
        () => -5.0,
        v => -Math.sqrt(Math.max(0.01, rPocket * rPocket - v * v)),
        u => {
          const t = Math.max(0, Math.min(1, (u + 5.0) / 2.9));
          return GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t);
        },
        0.20,
        getPolishedDeckMat(),
      );
      makeCurvedBoundaryDeck(
        courseGroup,
        slot,
        vBreaks,
        14,
        v => Math.sqrt(Math.max(0.01, rPocket * rPocket - v * v)),
        () => 5.0,
        u => {
          const t = Math.max(0, Math.min(1, (5.0 - u) / 2.9));
          return GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t);
        },
        0.20,
        getPolishedDeckMat(),
      );
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(cx, (deckY + ARENA_FLOOR_HEIGHT) / 2 - 0.1, lz), 0.55, deckY - ARENA_FLOOR_HEIGHT - 0.15, 'y', 24);
      const ttGroup = new THREE.Group();
      ttGroup.position.set(cx, deckY, lz);
      courseGroup.add(ttGroup);
      const polishedTtMat = getPolishedTurntableMat();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(rTt, rTt, 0.20, 48),
        [mats.metal, polishedTtMat, mats.metal],
      );
      disc.position.y = -0.10;
      disc.castShadow = true;
      disc.receiveShadow = true;
      ttGroup.add(disc);
      turntables.push({ group: ttGroup, x: cx, z: lz, radius: rTt, deckY });
    } else if (slot.type === 'moguls_stagger') {
      const uBreaks: number[] = [];
      for (let i = 0; i <= 36; i++) uBreaks.push(-4.2 + (8.4 * i) / 36);
      const vBreaks = [-2.2, -1.6, -1.0, -0.45, -0.22, 0, 0.22, 0.45, 1.0, 1.6, 2.2];
      makeSlotTerrainSolid(courseGroup, slot, uBreaks, vBreaks, evaluateMogulHeightAt, mats.concreteCurb, ARENA_FLOOR_HEIGHT);

      // Steel traction cleats & crest warning trim on alternating alternating mounds
      for (const [mu, side] of [[-2.45, -1], [0.0, 1], [2.45, -1]] as Array<[number, number]>) {
        const crestH = evaluateMogulHeightAt(mu, side * 1.15);
        for (const barOff of [-0.26, 0.0, 0.26]) {
          makeBox(
            courseGroup,
            mats.diamondPlate,
            new THREE.Vector3(toCourseX(slot, mu + barOff), crestH + 0.012, toCourseZ(slot, side * 1.20)),
            new THREE.Vector3(0.14, 0.02, 1.65),
            0,
            false,
          );
        }
        makeBox(
          courseGroup,
          mats.yellow,
          new THREE.Vector3(toCourseX(slot, mu), crestH + 0.015, toCourseZ(slot, side * 2.12)),
          new THREE.Vector3(1.10, 0.02, 0.10),
          0,
          false,
        );
      }
    } else if (slot.type === 'step_staircase') {
      const uBreaks = [-3.65, -2.85, -2.65, -1.85, -1.65, -0.85, -0.65, 0.65, 0.85, 1.65, 1.85, 2.65, 2.85, 3.65];
      const vBreaks = [-2.20, 0.0, 2.20];
      makeSlotTerrainSolid(courseGroup, slot, uBreaks, vBreaks, (u) => evaluateStaircaseHeightAt(u), mats.concretePier, ARENA_FLOOR_HEIGHT);

      // Steel diamond-plate summit platform & yellow anti-slip step nosings
      const topY = evaluateStaircaseHeightAt(0);
      makeBox(courseGroup, mats.diamondPlate, new THREE.Vector3(cx, topY + 0.012, lz), new THREE.Vector3(1.26, 0.02, DRIVE_ROUTE_WIDTH - 0.16), 0, false);
      for (const stepU of [-2.65, -1.65, -0.65, 0.65, 1.65, 2.65]) {
        const sy = evaluateStaircaseHeightAt(stepU);
        makeBox(
          courseGroup,
          mats.yellow,
          new THREE.Vector3(toCourseX(slot, stepU), sy + 0.014, lz),
          new THREE.Vector3(0.08, 0.018, DRIVE_ROUTE_WIDTH - 0.16),
          0,
          false,
        );
      }
      // Side precast step parapet curbs
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.concreteCurb, new THREE.Vector3(cx, GROUND_DECK_HEIGHT + 0.16, lz + side * 2.22), new THREE.Vector3(7.4, 0.32, 0.12));
      }
    } else if (slot.type === 'camber_bank') {
      const uBreaks: number[] = [];
      for (let i = 0; i <= 32; i++) uBreaks.push(-4.5 + (9.0 * i) / 32);
      const vBreaks: number[] = [];
      for (let j = 0; j <= 10; j++) vBreaks.push(-2.2 + (4.4 * j) / 10);
      makeSlotTerrainSolid(courseGroup, slot, uBreaks, vBreaks, evaluateCamberBankHeightAt, mats.asphalt, ARENA_FLOOR_HEIGHT);

      // Faded yellow center stripe & outer red/white apex camber kerbs conforming to twisted S-bank
      const centerPts: Array<{ u: number; v: number }> = uBreaks.map(u => ({ u, v: 0 }));
      for (let i = 0; i < centerPts.length - 1; i++) {
        const uMid = (centerPts[i].u + centerPts[i + 1].u) * 0.5;
        const ym = evaluateCamberBankHeightAt(uMid, 0);
        const y0 = evaluateCamberBankHeightAt(centerPts[i].u, 0);
        const y1 = evaluateCamberBankHeightAt(centerPts[i + 1].u, 0);
        const pitch = Math.atan2(y1 - y0, centerPts[i + 1].u - centerPts[i].u) * d;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.08), mats.yellow);
        stripe.position.set(toCourseX(slot, uMid), ym + 0.01, lz);
        stripe.rotation.z = pitch;
        courseGroup.add(stripe);

        for (const side of [-1, 1]) {
          const edgeV = side * 2.08;
          const ey0 = evaluateCamberBankHeightAt(centerPts[i].u, edgeV);
          const ey1 = evaluateCamberBankHeightAt(centerPts[i + 1].u, edgeV);
          const ePitch = Math.atan2(ey1 - ey0, centerPts[i + 1].u - centerPts[i].u) * d;
          const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.18), i % 2 === 0 ? mats.red : mats.concreteCurb);
          kerb.position.set(toCourseX(slot, uMid), (ey0 + ey1) * 0.5 + 0.012, toCourseZ(slot, edgeV));
          kerb.rotation.z = ePitch;
          courseGroup.add(kerb);
        }
      }
    } else if (slot.type === 'sliding_gates') {
      // Three synchronized overhead gantry tracks with laterally oscillating hazard barriers
      [-2.6, 0.0, 2.6].forEach((gu, gi) => {
        const gx = toCourseX(slot, gu);
        const railY = GROUND_DECK_HEIGHT + 2.02;

        // Painted floor sweep warning strip beneath each gate rail
        makeBox(courseGroup, getHazardStripeMat(), new THREE.Vector3(gx, GROUND_DECK_HEIGHT + 0.014, lz), new THREE.Vector3(0.46, 0.012, DRIVE_ROUTE_WIDTH - 0.24), 0, false);

        // Twin vertical gantry columns + footings + overhead steel I-beam carrier rail
        for (const side of [-1, 1]) {
          const pz = toCourseZ(slot, side * 2.34);
          makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(gx, GROUND_DECK_HEIGHT + 0.10, pz), 0.16, 0.20, 'y', 10);
          makeBox(courseGroup, mats.metal, new THREE.Vector3(gx, GROUND_DECK_HEIGHT + 1.05, pz), new THREE.Vector3(0.14, 2.10, 0.14));
        }
        makeBox(courseGroup, mats.metal, new THREE.Vector3(gx, railY + 0.06, lz), new THREE.Vector3(0.18, 0.16, 4.90));
        makeBox(courseGroup, mats.chrome, new THREE.Vector3(gx, railY - 0.06, lz), new THREE.Vector3(0.08, 0.06, 4.70));

        // Animated sliding barrier carriage
        const gateGroup = new THREE.Group();
        gateGroup.position.set(gx, GROUND_DECK_HEIGHT, lz);
        courseGroup.add(gateGroup);

        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 1.66), mats.black);
        carriage.position.y = 1.92;
        carriage.castShadow = true;
        gateGroup.add(carriage);

        for (const sOff of [-0.55, 0.55]) {
          const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.92, 10), mats.chrome);
          hanger.position.set(0, 1.44, sOff);
          hanger.castShadow = true;
          gateGroup.add(hanger);
        }

        const shield = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.88, 1.60), getHazardStripeMat());
        shield.position.y = 0.56;
        shield.castShadow = true;
        shield.receiveShadow = true;
        gateGroup.add(shield);

        const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 1.64), mats.rubber);
        bumper.position.y = 0.18;
        bumper.castShadow = true;
        gateGroup.add(bumper);

        const beaconMat = new THREE.MeshBasicMaterial({ color: '#e5a93c' });
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.10, 12), beaconMat);
        beacon.position.y = 1.06;
        gateGroup.add(beacon);

        slidingGates.push({
          slot,
          u: gu,
          amplitude: 1.32,
          omega: 1.45,
          phase: gi * 2.15,
          halfThickU: 0.24,
          halfWidthV: 0.80,
          gateGroup,
          beaconMat,
          hitCooldown: 0,
        });
      });
    } else if (slot.type === 'pendulum_bridge') {
      const deckY = 1.35;
      const wCat = 2.64;
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -6.0), toCourseX(slot, -3.6), lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, deckY, 0.22, mats.diamondPlate, t => easeCushionedRamp(t, 0.14), 22, wCat);
      makeBox(courseGroup, mats.diamondPlate, new THREE.Vector3(cx, deckY - 0.11, lz), new THREE.Vector3(7.2, 0.22, wCat));
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 3.6), toCourseX(slot, 6.0), lz, wCat, deckY, GROUND_DECK_HEIGHT, 0.22, mats.diamondPlate, t => easeCushionedRamp(t, 0.14), 22, DRIVE_ROUTE_WIDTH);
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(cx, deckY + 0.008, lz + side * (wCat / 2 - 0.08)), new THREE.Vector3(7.2, 0.01, 0.08), 0, false);
      }
      [-2.9, 0.0, 2.9].forEach((pu, bi) => {
        const bx = toCourseX(slot, pu);
        const pivotY = 4.00;
        const armLen = 2.08;
        const localBallR = 0.40;
        const worldBallR = localBallR * MAP_SCALE;
        for (const side of [-1, 1]) {
          makeBox(courseGroup, mats.metal, new THREE.Vector3(bx, (pivotY + ARENA_FLOOR_HEIGHT) / 2, lz + side * 1.55), new THREE.Vector3(0.16, pivotY - ARENA_FLOOR_HEIGHT, 0.16));
        }
        makeBox(courseGroup, mats.orange, new THREE.Vector3(bx, pivotY, lz), new THREE.Vector3(0.20, 0.20, 3.30));

        // Metric world-ratio frame so chain & heavy cast-iron wrecking ball are true 1:1 un-squished geometry
        const pendWorldGroup = new THREE.Group();
        pendWorldGroup.position.set(bx, pivotY, lz);
        pendWorldGroup.scale.set(1 / MAP_SCALE, 1, 1 / MAP_SCALE);
        courseGroup.add(pendWorldGroup);

        // Top pivot yoke & axle bearing
        const pivotAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 14), mats.chrome);
        pivotAxle.rotation.z = Math.PI / 2;
        pendWorldGroup.add(pivotAxle);

        const armGroup = new THREE.Group();
        pendWorldGroup.add(armGroup);

        // Core steel cable + alternating forged chain links
        const chainSpan = armLen - worldBallR - 0.08;
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, chainSpan, 8), mats.chrome);
        cable.position.y = -chainSpan * 0.5 - 0.04;
        armGroup.add(cable);
        const linkCount = Math.floor(chainSpan / 0.11);
        const linkGeo = new THREE.TorusGeometry(0.055, 0.017, 7, 12);
        for (let li = 0; li < linkCount; li++) {
          const linkMesh = new THREE.Mesh(linkGeo, mats.chrome);
          linkMesh.position.y = -0.10 - li * 0.11;
          linkMesh.rotation.y = li % 2 === 0 ? 0 : Math.PI / 2;
          linkMesh.castShadow = true;
          armGroup.add(linkMesh);
        }

        // Heavy shackle collar & cast-iron hazard-striped spherical wrecking ball
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.16, 16), mats.chrome);
        collar.position.y = -armLen + worldBallR + 0.03;
        collar.castShadow = true;
        armGroup.add(collar);

        const ball = new THREE.Mesh(new THREE.SphereGeometry(worldBallR, 24, 18), getWreckingBallMat());
        ball.position.y = -armLen;
        ball.rotation.y = bi * 0.9;
        ball.rotation.z = 0.26;
        ball.castShadow = true;
        ball.receiveShadow = true;
        armGroup.add(ball);

        pendulums.push({
          slot,
          x: bx,
          zCenter: lz,
          pivotY,
          armLength: armLen,
          amplitude: 1.72,
          omega: 2.25,
          phase: bi === 1 ? Math.PI : 0,
          ballRadius: localBallR,
          armGroup,
          hitCooldown: 0,
        });
      });
    } else if (slot.type === 'hanging_bridges') {
      const bridgeY = 0.88;
      makeBox(courseGroup, mats.sand, new THREE.Vector3(cx, HANGING_SAND_PIT_Y - 0.12, lz), new THREE.Vector3(9.4, 0.24, 4.2));
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -6.1), toCourseX(slot, -4.5), lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, bridgeY, 0.18, mats.metal, easeCushionedRamp, 14, 2.50);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 4.5), toCourseX(slot, 6.1), lz, 2.50, bridgeY, GROUND_DECK_HEIGHT, 0.18, mats.metal, easeCushionedRamp, 14, DRIVE_ROUTE_WIDTH);

      // Articulated Twin Hanging Chain Bridge Ribbons (only two suspended plank-chain spans; zero overhead/side barricades)
      const trackSpacingHalf = (TRACK_WIDTH / MAP_SCALE) * 0.5;
      const segCount = 18;
      const edgeChainGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
      const plankGeo = new THREE.BoxGeometry(0.54, 0.08, 0.62);

      const ribbons: HangingBridgeRibbonVisual[] = ([0, 1] as const).map(side => {
        const sideSign: -1 | 1 = side === 0 ? -1 : 1;
        const vNominal = sideSign * trackSpacingHalf;
        const planks: THREE.Mesh[] = [];
        const edgeChainsL: THREE.Mesh[] = [];
        const edgeChainsR: THREE.Mesh[] = [];

        // Bolted ground anchor brackets fastening chain ends into both metal approach/exit ramp lips
        for (const anchorU of [-4.5, 4.5]) {
          const ax = toCourseX(slot, anchorU);
          makeBox(courseGroup, mats.metal, new THREE.Vector3(ax, bridgeY - 0.055, toCourseZ(slot, vNominal)), new THREE.Vector3(0.16, 0.09, 0.60), 0, false);
          for (const edgeOff of [-0.23, 0.23]) {
            makeCyl(courseGroup, mats.black, new THREE.Vector3(ax, bridgeY - 0.02, toCourseZ(slot, vNominal + edgeOff)), 0.032, 0.06, 'y', 8);
          }
        }

        for (let i = 0; i < segCount; i++) {
          const plank = new THREE.Mesh(plankGeo, mats.wood);
          plank.castShadow = true;
          plank.receiveShadow = true;
          courseGroup.add(plank);
          planks.push(plank);
        }

        for (let i = 0; i <= segCount; i++) {
          const cL = new THREE.Mesh(edgeChainGeo, mats.chrome);
          const cR = new THREE.Mesh(edgeChainGeo, mats.chrome);
          cL.castShadow = true;
          cR.castShadow = true;
          courseGroup.add(cL);
          courseGroup.add(cR);
          edgeChainsL.push(cL);
          edgeChainsR.push(cR);
        }
        return { side, vNominal, sideSign, planks, edgeChainsL, edgeChainsR };
      });

      const hbRuntime: HangingBridgeRuntime = {
        slotIndex: slot.index,
        slot,
        trackSpacingHalf,
        ribbons: [ribbons[0], ribbons[1]],
      };
      hangingBridges.push(hbRuntime);
      const hbInitState = plan.hangingBridgeStates[slot.index];
      if (hbInitState) {
        updateHangingBridgeVisuals(hbRuntime, hbInitState);
      }
    } else if (slot.type === 'spiral_tower') {
      const spU = -4.20;
      const spX = toCourseX(slot, spU);
      const rInner = 0.76;
      const rOuter = 3.30;
      const yTop = 3.20;
      const ttU = 2.20;
      const ttX = toCourseX(slot, ttU);
      const rTt = 2.35;
      const rPocket = 2.385;
      const polishedDeck = getPolishedDeckMat();

      // Smooth monolithic central structural column (top flush at summit level, zero jagged gaps)
      const pylonH = yTop - ARENA_FLOOR_HEIGHT;
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(spX, ARENA_FLOOR_HEIGHT + 0.03, lz), 0.79, 0.06, 'y', 32);
      makeCyl(courseGroup, mats.metal, new THREE.Vector3(spX, ARENA_FLOOR_HEIGHT + pylonH * 0.5, lz), 0.78, pylonH, 'y', 36);
      const spiralLayout = buildSpiralTowerColliders(slot);
      colliders.push(...spiralLayout.colliders);

      // 1. Continuous Glass-Smooth 540-degree Helical Ribbon (zero staircase steps, zero brackets, zero barricades)
      makeContinuousSpiralHelixMesh(courseGroup, slot, spU, rInner, rOuter, GROUND_DECK_HEIGHT, yTop, 0.22, polishedDeck, 108);

      // Clean continuous architectural plinth beneath Turn 1 overhang strictly below deck soffit
      for (const seg of spiralLayout.skirtSegments) {
        makeBox(courseGroup, mats.concretePier, new THREE.Vector3(seg.x, ARENA_FLOOR_HEIGHT + seg.skirtH * 0.5, seg.z), new THREE.Vector3(seg.oLen, seg.skirtH, 0.14), seg.oAng);
      }

      // 2. Monolithic Flush Polished Summit Apron fitted cleanly from beta=3pi summit seam into circular turntable pocket
      // North side (v in [-1.65..0]) stays clear East of Turn 2 helix (u = -0.90);
      // South side (v in [0..+1.65]) welds flush to beta=3pi (u = -3.44..-0.90) and sweeps tangentially East.
      const vNorth: number[] = [];
      const vSouth: number[] = [];
      for (let i = 0; i <= 10; i++) vNorth.push(-1.65 + (1.65 * i) / 10);
      for (let i = 0; i <= 12; i++) vSouth.push((1.65 * i) / 12);
      const ttWestArc = (v: number) => ttU - Math.sqrt(Math.max(0.01, rPocket * rPocket - v * v));

      makeCurvedBoundaryDeck(
        courseGroup,
        slot,
        vNorth,
        8,
        () => -0.90,
        ttWestArc,
        () => yTop,
        0.22,
        polishedDeck,
      );
      makeCurvedBoundaryDeck(
        courseGroup,
        slot,
        vSouth,
        12,
        v => -3.44 + 1.65 * (1 - Math.sqrt(Math.max(0, 1 - Math.pow(v / 1.65, 2)))),
        ttWestArc,
        () => yTop,
        0.22,
        polishedDeck,
      );

      // 3. Flush Polished Rotating Rooftop Turntable (zero overlapping boards, zero rim barricades)
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(ttX, (yTop + ARENA_FLOOR_HEIGHT) / 2 - 0.1, lz), 0.72, yTop - ARENA_FLOOR_HEIGHT - 0.18, 'y', 28);
      const ttGroup = new THREE.Group();
      ttGroup.position.set(ttX, yTop, lz);
      courseGroup.add(ttGroup);
      const polishedTtMat = getPolishedTurntableMat();
      const ttDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(rTt, rTt, 0.22, 48),
        [mats.metal, polishedTtMat, mats.metal],
      );
      ttDisc.position.y = -0.11;
      ttDisc.castShadow = true;
      ttDisc.receiveShadow = true;
      ttGroup.add(ttDisc);
      turntables.push({ group: ttGroup, x: ttX, z: lz, radius: rTt, deckY: yTop });

      // 4. Single Seamless Polished Descent Viaduct fitted directly onto East circular turntable pocket down to ground grade
      const vFull: number[] = [];
      for (let i = 0; i <= 18; i++) vFull.push(-1.65 + (3.30 * i) / 18);
      makeCurvedBoundaryDeck(
        courseGroup,
        slot,
        vFull,
        36,
        v => ttU + Math.sqrt(Math.max(0.01, rPocket * rPocket - v * v)),
        () => 11.80,
        u => {
          if (u <= 4.40) return yTop;
          const t = Math.max(0, Math.min(1, (u - 4.40) / 7.40));
          return yTop + (GROUND_DECK_HEIGHT - yTop) * easeCushionedRamp(t, 0.16);
        },
        0.22,
        polishedDeck,
      );
      // Clean cylindrical support pier under descent upper bridge head
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(toCourseX(slot, 4.95), (yTop + ARENA_FLOOR_HEIGHT) / 2 - 0.15, lz), 0.36, yTop - ARENA_FLOOR_HEIGHT - 0.25, 'y', 18);
    }
  }

  // Build Checkpoints & Ordered Recovery Anchors
  const laserBeams: THREE.Mesh[] = [];
  const beacons: THREE.Mesh[] = [];
  const checkpoints: CheckpointMeshRuntime[] = plan.checkpoints.map((cp, i) => {
    const g = new THREE.Group();
    const gateY = GROUND_DECK_HEIGHT;
    g.position.set(cp.x, gateY, cp.z);
    g.rotation.y = cp.yaw;
    courseGroup.add(g);

    const gantrySpan = 5.4;
    const beamSpan = gantrySpan - 0.4;
    const halfSpan = gantrySpan / 2;
    const towerH = 2.85;
    for (const side of [-1, 1]) {
      const px = side * (halfSpan - 0.15);
      makeBox(g, mats.yellow, new THREE.Vector3(px, 0.14, 0), new THREE.Vector3(0.42, 0.28, 0.42));
      makeBox(g, mats.metal, new THREE.Vector3(px, towerH / 2, 0), new THREE.Vector3(0.20, towerH, 0.20));
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12), mats.beaconAmber);
      beacon.position.set(px, towerH + 0.08, 0);
      g.add(beacon);
      beacons.push(beacon);
    }
    const crossbar = makeBox(g, mats.metal, new THREE.Vector3(0, towerH, 0), new THREE.Vector3(gantrySpan - 0.10, 0.18, 0.24));
    cameraOccluders.push(crossbar);

    const isFinishGate = i === plan.checkpoints.length - 1;
    const cvs = document.createElement('canvas');
    cvs.width = 512;
    cvs.height = 96;
    const ctx = cvs.getContext('2d')!;
    // Weathered riveted dark-steel signboard with faded brass stencil text
    ctx.fillStyle = '#151718';
    ctx.fillRect(0, 0, 512, 96);
    for (let sp = 0; sp < 140; sp++) {
      ctx.fillStyle = sp % 2 === 0 ? 'rgba(255,250,235,0.03)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect((sp * 53) % 508, (sp * 29) % 92, 4, 2);
    }
    ctx.strokeStyle = isFinishGate ? '#b59445' : '#9c7e42';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = '#53585c';
    for (const [bx, by] of [[14, 14], [498, 14], [14, 82], [498, 82]]) {
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = isFinishGate ? '#c9aa5c' : '#b89a56';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(cp.label.toUpperCase(), 256, 56);
    const signTex = new THREE.CanvasTexture(cvs);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    for (const faceDir of [1, -1] as const) {
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.48), signMat);
      signMesh.position.set(0, towerH, faceDir * 0.13);
      if (faceDir < 0) signMesh.rotation.y = Math.PI;
      g.add(signMesh);
    }

    const laserColor = i === 0 ? '#ad8944' : isFinishGate ? '#b59445' : '#398f76';
    const laserGeo = new THREE.CylinderGeometry(0.016, 0.016, beamSpan, 10);
    laserGeo.rotateZ(Math.PI / 2);
    const bar = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.52 }));
    bar.position.set(0, 0.04, 0);
    g.add(bar);
    laserBeams.push(bar);

    return {
      ...cp,
      worldX: cp.x * MAP_SCALE,
      worldZ: cp.z * MAP_SCALE,
      group: g,
      bar,
      passed: false,
    };
  });

  const recoveryAnchors: RecoveryAnchor[] = [
    {
      id: 'start',
      label: 'Starting Bay',
      x: -20.5 * MAP_SCALE,
      z: 13.50 * MAP_SCALE,
      y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
      yaw: Math.PI / 2,
      checkpointIndex: 0,
    },
  ];
  for (const s of plan.slots) {
    const preX = s.centerX - s.dir * (s.halfLen + 1.0);
    const clampedX = Math.max(-16.8, Math.min(16.8, preX));
    recoveryAnchors.push({
      id: `slot_${s.index}`,
      label: s.meta.label,
      x: clampedX * MAP_SCALE,
      z: s.laneZ * MAP_SCALE,
      y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
      yaw: s.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      checkpointIndex: Math.max(1, s.gateId - 1),
    });
  }

  return {
    plan,
    checkpoints,
    recoveryAnchors,
    turntables,
    pendulums,
    seesaws,
    hangingBridges,
    slidingGates,
    footballArenas,
    waterBasins,
    flames,
    laserBeams,
    beacons,
    waterPools: plan.waterPools,
    cameraOccluders,
  };
}

export function stepDynamicHurdles(
  runtime: CourseRuntimeHandles,
  pose: VehiclePose,
  motionState: { x: number; z: number; vx: number; vz: number; yaw: number; angular: number },
  turntableOmega: number,
  effectiveGrip: number,
  nowSec: number,
  dt: number,
  onPendulumImpact: (relSpeedMps: number) => void,
  onFootballGoal: (arena: FootballArenaRuntime, goalIndex: number) => void,
  onSlidingGateImpact?: (relSpeedMps: number) => void,
) {
  // 1. Rotate Turntable platters & apply tangential deck velocity when above matching deck height
  for (const tt of runtime.turntables) {
    tt.group.rotation.y += turntableOmega * dt;
    const robotDeckDist = Math.abs((pose.y + TRACK_CONTACT_OFFSET) - tt.deckY);
    if (!pose.isFlipped && robotDeckDist <= 0.55) {
      const res = applyTurntableSurfaceInteraction(
        motionState.x,
        motionState.z,
        motionState.vx,
        motionState.vz,
        motionState.yaw,
        motionState.angular,
        { centerX: tt.x, centerZ: tt.z, radius: tt.radius, omega: turntableOmega },
        effectiveGrip,
        dt,
        MAP_SCALE,
      );
      if (res.onTurntable) {
        motionState.vx = res.vx;
        motionState.vz = res.vz;
        motionState.yaw = res.yaw;
        motionState.angular = res.yawRate;
        pose.vx = res.vx;
        pose.vz = res.vz;
        pose.yaw = res.yaw;
        pose.yawRate = res.yawRate;
      }
    }
  }

  // 2. Swing Pendulums & resolve solid-body depenetration
  let struck = false;
  for (const pend of runtime.pendulums) {
    pend.hitCooldown = Math.max(0, pend.hitCooldown - dt);
    const theta = (pend.amplitude / pend.armLength) * Math.sin(pend.omega * nowSec + pend.phase);
    // Negative X rotation maps local (0, -L, 0) to z = +L * sin(theta), matching world ballZ
    pend.armGroup.rotation.x = -theta;
    const ballY = pend.pivotY - pend.armLength * Math.cos(theta);
    const ballZ = pend.zCenter * MAP_SCALE + pend.armLength * Math.sin(theta);
    const ballX = pend.x * MAP_SCALE;
    const omegaVal = (pend.amplitude / pend.armLength) * pend.omega * Math.cos(pend.omega * nowSec + pend.phase);
    const vBallZ = pend.armLength * Math.cos(theta) * omegaVal;

    const dx = pose.x - ballX;
    const dy = (pose.y + 0.18) - ballY;
    const dz = pose.z - ballZ;
    const dist = Math.hypot(dx, dy, dz);
    const hitDist = pend.ballRadius * MAP_SCALE + 0.56;
    if (dist < hitDist) {
      const overlap = (hitDist - dist) * 0.65;
      const hDist = Math.hypot(dx, dz);
      const hnx = hDist > 0.001 ? dx / hDist : 0;
      const hnz = hDist > 0.001 ? dz / hDist : (Math.sign(vBallZ) || 1);
      pose.x += hnx * overlap * 0.5;
      pose.z += hnz * overlap;
      motionState.x = pose.x;
      motionState.z = pose.z;
      if (!struck && pend.hitCooldown <= 0) {
        struck = true;
        pend.hitCooldown = 0.85;
        const relSpeed = Math.hypot(pose.vx, pose.vz - vBallZ);
        const pushDirZ = Math.sign(vBallZ) || hnz;
        pose.vz = pushDirZ * Math.max(0.65, Math.min(1.10, Math.abs(vBallZ) * 0.28));
        pose.vx *= 0.72;
        motionState.vx = pose.vx;
        motionState.vz = pose.vz;
        onPendulumImpact(relSpeed);
      }
    }
  }

  // 3. Dynamic Seesaw Balance Planks
  const rx = pose.x / MAP_SCALE;
  const rz = pose.z / MAP_SCALE;
  for (const ss of runtime.seesaws) {
    const u = ss.slot.dir * (rx - ss.slot.centerX);
    const v = ss.slot.dir * (rz - ss.slot.laneZ);
    let targetTilt = ss.tilt;
    if (Math.abs(u) <= 3.6 && Math.abs(v) <= 1.65) {
      // Shift smoothly from +0.11 (entry-down) when u < -0.25 to -0.11 (exit-down) once past fulcrum
      targetTilt = u > 0.25 ? -0.11 : u < -0.25 ? 0.11 : ss.tilt;
    } else if (u < -4.2) {
      targetTilt = 0.11;
    }
    ss.tilt += (targetTilt - ss.tilt) * Math.min(1, dt * 4.2);
    runtime.plan.seesawStates[ss.slotIndex] = ss.tilt;
    ss.pivotGroup.rotation.z = ss.slot.dir * ss.tilt;
  }

  // 3B. Dynamic Twin Chain Hanging Bridges (load stretch, asymmetric bounce, left-right sway + deck traction coupling)
  const roverSpeed = Math.hypot(pose.vx, pose.vz);
  const roverYLocal = pose.y + TRACK_CONTACT_OFFSET;
  for (const hb of runtime.hangingBridges) {
    const hbState = runtime.plan.hangingBridgeStates[hb.slotIndex];
    if (!hbState) continue;
    const hbRes = stepHangingBridgeState(
      hbState,
      hb.slot,
      rx,
      rz,
      roverYLocal,
      pose.roll,
      pose.yawRate,
      roverSpeed,
      dt,
    );
    updateHangingBridgeVisuals(hb, hbState);
    if (!pose.isFlipped && pose.isGrounded && hbState.onBridge) {
      if (Math.abs(hbRes.deltaMeanSwayV) > 1e-6) {
        pose.z += hb.slot.dir * hbRes.deltaMeanSwayV * MAP_SCALE;
        motionState.z = pose.z;
      }
      if (Math.abs(hbRes.twistTorque) > 1e-4) {
        const dYaw = hbRes.twistTorque * dt * 0.42;
        pose.yaw += dYaw;
        motionState.yaw = pose.yaw;
      }
    }
  }

  // 4. Dynamic Horizontal Dual-Goal Football Arenas (4-5 Tennis Balls + Both-End Full Goalposts)
  const roverHalfL = ROBOT_HALF_LENGTH / MAP_SCALE + 0.04;
  const roverHalfW = ROBOT_HALF_WIDTH / MAP_SCALE + 0.03;
  const pitchFloorY = GROUND_DECK_HEIGHT + 0.016;
  const postRadius = 0.065;
  const substeps = 3;
  const subDt = dt / substeps;
  const fwdX = Math.sin(pose.yaw);
  const fwdZ = Math.cos(pose.yaw);
  const rightX = Math.cos(pose.yaw);
  const rightZ = -Math.sin(pose.yaw);

  for (const arena of runtime.footballArenas) {
    if (arena.flashLeftTimer > 0) {
      arena.flashLeftTimer = Math.max(0, arena.flashLeftTimer - dt);
      if (arena.flashLeftTimer === 0) arena.goalLeftLedMat.color.set('#b08a42');
    }
    if (arena.flashRightTimer > 0) {
      arena.flashRightTimer = Math.max(0, arena.flashRightTimer - dt);
      if (arena.flashRightTimer === 0) arena.goalRightLedMat.color.set('#b08a42');
    }

    const rvx = pose.vx / MAP_SCALE;
    const rvz = pose.vz / MAP_SCALE;
    const roverSpeed = Math.hypot(rvx, rvz);

    for (let stepIdx = 0; stepIdx < substeps; stepIdx++) {
      for (let i = 0; i < arena.balls.length; i++) {
        const b = arena.balls[i];
        if (!b.scored) {
          // Oriented Robot Chassis Bumper (OBB) -> Ball Circle collision
          const relX = b.x - rx;
          const relZ = b.z - rz;
          const locFwd = relX * fwdX + relZ * fwdZ;
          const locSide = relX * rightX + relZ * rightZ;
          const clampFwd = Math.max(-roverHalfL, Math.min(roverHalfL, locFwd));
          const clampSide = Math.max(-roverHalfW, Math.min(roverHalfW, locSide));
          const closestX = rx + fwdX * clampFwd + rightX * clampSide;
          const closestZ = rz + fwdZ * clampFwd + rightZ * clampSide;
          const dx = b.x - closestX;
          const dz = b.z - closestZ;
          const d = Math.hypot(dx, dz);
          if (d < b.radius) {
            let nx: number;
            let nz: number;
            let pen = b.radius - d;
            if (d > 1e-4) {
              nx = dx / d;
              nz = dz / d;
            } else {
              // Inside chassis OBB: push out cleanly toward nearest bumper face
              const toFwd = roverHalfL - Math.abs(locFwd);
              const toSide = roverHalfW - Math.abs(locSide);
              if (toFwd < toSide) {
                const sgn = locFwd >= 0 ? 1 : -1;
                nx = fwdX * sgn;
                nz = fwdZ * sgn;
                pen = toFwd + b.radius;
              } else {
                const sgn = locSide >= 0 ? 1 : -1;
                nx = rightX * sgn;
                nz = rightZ * sgn;
                pen = toSide + b.radius;
              }
            }
            b.x += nx * (pen + 0.015);
            b.z += nz * (pen + 0.015);
            const relVn = rvx * nx + rvz * nz - (b.vx * nx + b.vz * nz);
            if (relVn > -0.25) {
              const kickSpeed = Math.max(1.65, relVn * 1.45 + roverSpeed * 0.52);
              b.vx = rvx * 0.45 + nx * kickSpeed;
              b.vz = rvz * 0.45 + nz * kickSpeed;
            }
          }
        }

        // Ball -> Ball elastic collisions
        for (let j = i + 1; j < arena.balls.length; j++) {
          const b2 = arena.balls[j];
          const dx = b2.x - b.x;
          const dz = b2.z - b.z;
          const dist = Math.hypot(dx, dz);
          const sumR = b.radius + b2.radius;
          if (dist < sumR && dist > 1e-4) {
            const nx = dx / dist;
            const nz = dz / dist;
            const sep = (sumR - dist) * 0.5;
            b.x -= nx * sep;
            b.z -= nz * sep;
            b2.x += nx * sep;
            b2.z += nz * sep;
            const vRel = (b2.vx - b.vx) * nx + (b2.vz - b.vz) * nz;
            if (vRel < 0) {
              const jImp = -0.92 * vRel;
              b.vx -= jImp * nx;
              b.vz -= jImp * nz;
              b2.vx += jImp * nx;
              b2.vz += jImp * nz;
            }
          }
        }

        // Integrate substep velocity & realistic turf rolling drag
        b.x += b.vx * subDt;
        b.z += b.vz * subDt;
        const drag = Math.exp(-(b.scored ? 3.8 : 1.15) * subDt);
        b.vx *= drag;
        b.vz *= drag;

        // Convert into slot local (u, v) for goalpost deflection, goal scoring, and pocket settling
        let nextU = arena.slot.dir * (b.x - arena.slot.centerX);
        let nextV = arena.slot.dir * (b.z - arena.slot.laneZ);
        let vu = arena.slot.dir * b.vx;
        let vv = arena.slot.dir * b.vz;

        if (!b.scored) {
          // Physical circular collision against the 4 upright goalposts at (±goalMouthHalfU, ±pitchHalfV)
          for (const gSide of [-1, 1] as const) {
            const postV = gSide * arena.pitchHalfV;
            for (const pSide of [-1, 1] as const) {
              const postU = pSide * arena.goalMouthHalfU;
              const pdU = nextU - postU;
              const pdV = nextV - postV;
              const pDist = Math.hypot(pdU, pdV);
              const minPostDist = b.radius + postRadius;
              if (pDist < minPostDist && pDist > 1e-4) {
                const pnx = pdU / pDist;
                const pnz = pdV / pDist;
                nextU = postU + pnx * (minPostDist + 0.005);
                nextV = postV + pnz * (minPostDist + 0.005);
                const vn = vu * pnx + vv * pnz;
                if (vn < 0) {
                  vu -= 1.65 * vn * pnx;
                  vv -= 1.65 * vn * pnz;
                }
              }
            }
          }

          // Confine balls cleanly between Left/Right stadium approach lines along u
          const maxU = arena.pitchHalfU - b.radius;
          if (nextU < -maxU) { nextU = -maxU; vu = Math.abs(vu) * 0.72; }
          if (nextU > maxU) { nextU = maxU; vu = -Math.abs(vv === 0 ? vu : vu) * 0.72; }

          // Check whether ball is inside the unobstructed goal opening vs hitting side touchline curbs
          const inGoalMouthU = Math.abs(nextU) <= arena.goalMouthHalfU - b.radius * 0.25;
          if (inGoalMouthU) {
            // Goal opening is completely free: roll unobstructed across ±pitchHalfV into the pocket!
            const scoredLeft = nextV <= -(arena.pitchHalfV + b.radius * 0.10);
            const scoredRight = nextV >= (arena.pitchHalfV + b.radius * 0.10);
            if (scoredLeft || scoredRight) {
              const gSide: -1 | 1 = scoredLeft ? -1 : 1;
              b.scored = true;
              b.scoredSide = gSide;
              arena.goalsScored += 1;
              if (gSide === -1) {
                arena.goalLeftLedMat.color.set('#4e9e61');
                arena.flashLeftTimer = 1.25;
              } else {
                arena.goalRightLedMat.color.set('#4e9e61');
                arena.flashRightTimer = 1.25;
              }
              onFootballGoal(arena, arena.goalsScored);
            }
          } else {
            // Bounce off touchline retaining curbs outside the goalposts
            const maxCurbV = arena.pitchHalfV - b.radius - 0.06;
            if (nextV < -maxCurbV) { nextV = -maxCurbV; vv = Math.abs(vv) * 0.72; }
            if (nextV > maxCurbV) { nextV = maxCurbV; vv = -Math.abs(vv) * 0.72; }
          }
        } else {
          // Ball is inside the netted goal pocket: stay cleanly contained against side nets & back bar
          const gSide = b.scoredSide ?? 1;
          const uMin = -arena.goalMouthHalfU + b.radius + 0.05;
          const uMax = arena.goalMouthHalfU - b.radius - 0.05;
          const vMin = gSide === -1
            ? -(arena.pitchHalfV + arena.goalDepthV) + b.radius + 0.05
            : arena.pitchHalfV + b.radius * 0.10;
          const vMax = gSide === -1
            ? -arena.pitchHalfV - b.radius * 0.10
            : arena.pitchHalfV + arena.goalDepthV - b.radius - 0.05;
          if (nextU < uMin) { nextU = uMin; vu = Math.abs(vu) * 0.35; }
          if (nextU > uMax) { nextU = uMax; vu = -Math.abs(vu) * 0.35; }
          if (nextV < vMin) { nextV = vMin; vv = Math.abs(vv) * 0.35; }
          if (nextV > vMax) { nextV = vMax; vv = -Math.abs(vv) * 0.35; }
        }

        b.x = arena.slot.centerX + arena.slot.dir * nextU;
        b.z = arena.slot.laneZ + arena.slot.dir * nextV;
        b.vx = arena.slot.dir * vu;
        b.vz = arena.slot.dir * vv;
        b.holder.position.set(b.x, pitchFloorY + b.radius * MAP_SCALE, b.z);
        b.mesh.rotation.z -= (b.vx / Math.max(0.05, b.radius)) * subDt;
        b.mesh.rotation.x += (b.vz / Math.max(0.05, b.radius)) * subDt;
      }
    }
  }

  // 5. Animate Water Basin Surface Waves, Caustics & Live Rover Bow/Track Wake
  if (runtime.waterBasins.length > 0) {
    const waterBundle = getWaterSurfaceBundle();
    waterBundle.waterMap.offset.x = (waterBundle.waterMap.offset.x + dt * 0.028) % 1;
    waterBundle.waterMap.offset.y = (waterBundle.waterMap.offset.y - dt * 0.019) % 1;
    waterBundle.waterBump.offset.x = (waterBundle.waterBump.offset.x - dt * 0.042) % 1;
    waterBundle.waterBump.offset.y = (waterBundle.waterBump.offset.y + dt * 0.031) % 1;
    waterBundle.causticMap.offset.x = (waterBundle.causticMap.offset.x + dt * 0.036) % 1;
    waterBundle.causticMap.offset.y = (waterBundle.causticMap.offset.y + dt * 0.024) % 1;

    const roverSpeed = Math.hypot(pose.vx, pose.vz);
    for (const wb of runtime.waterBasins) {
      const uRel = (rx - wb.slot.centerX) * wb.slot.dir;
      const vRel = (rz - wb.slot.laneZ) * wb.slot.dir;
      const roverOverPool = Math.abs(uRel) <= 4.35 && Math.abs(vRel) <= 2.15 && (pose.y + TRACK_CONTACT_OFFSET) <= wb.waterY + 0.14;
      const localRoverX = rx - wb.slot.centerX;
      const localRoverZ = rz - wb.slot.laneZ;

      const posAttr = wb.waterGeo.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const base = wb.basePositions;
      const halfSpanX = 4.39;
      const halfSpanZ = (DRIVE_ROUTE_WIDTH - 0.04) * 0.5;
      const wakeStrength = roverOverPool ? Math.min(1.0, 0.25 + roverSpeed / 4.2) : 0;

      for (let i = 0; i < posAttr.count; i++) {
        const ix = i * 3;
        const bx = base[ix];
        const by = base[ix + 1]; // maps to -Z relative to slot center
        const bz = base[ix + 2];
        const wallFadeX = Math.max(0, Math.min(1, (halfSpanX - Math.abs(bx)) / 0.45));
        const wallFadeZ = Math.max(0, Math.min(1, (halfSpanZ - Math.abs(by)) / 0.35));
        const edgeFade = wallFadeX * wallFadeZ;

        // Ambient multi-octave proving tank ripple
        let wave = (Math.sin(bx * 1.45 + nowSec * 1.85) * 0.008
          + Math.cos(by * 2.10 - nowSec * 1.40) * 0.006
          + Math.sin((bx + by) * 2.4 - nowSec * 2.2) * 0.005) * edgeFade;

        // Interactive radial bow/track wake displaced right around the rover inside tank
        if (wakeStrength > 0.01) {
          const wz = -by;
          const distR = Math.hypot(bx - localRoverX, wz - localRoverZ);
          if (distR < 2.2) {
            const damp = (1 - distR / 2.2);
            wave += Math.sin(distR * 7.5 - nowSec * 9.5) * 0.024 * wakeStrength * damp * damp * edgeFade;
          }
        }
        arr[ix + 2] = bz + wave;
      }
      posAttr.needsUpdate = true;
      wb.waterGeo.computeVertexNormals();

      // Update & spawn surface foam wake rings behind moving tracks
      wb.wakeCooldown = Math.max(0, wb.wakeCooldown - dt);
      if (roverOverPool && (roverSpeed > 0.35 || Math.abs(pose.yawRate) > 0.25) && wb.wakeCooldown <= 0) {
        const ring = wb.wakeRings.find(r => r.life <= 0);
        if (ring) {
          wb.wakeCooldown = 0.18;
          ring.life = ring.maxLife = 0.78;
          ring.mesh.visible = true;
          ring.mesh.position.set(rx, wb.waterY + 0.01, rz);
          ring.mesh.rotation.z = Math.random() * Math.PI * 2;
          ring.mesh.scale.set(0.75, 0.75, 1);
          ring.mat.opacity = 0.34;
        }
      }
      for (const ring of wb.wakeRings) {
        if (ring.life <= 0) continue;
        ring.life -= dt;
        const progress = 1 - Math.max(0, ring.life / ring.maxLife);
        const s = 0.75 + progress * 2.1;
        ring.mesh.scale.set(s, s, 1);
        ring.mat.opacity = Math.max(0, (1 - progress) * 0.34);
        if (ring.life <= 0) ring.mesh.visible = false;
      }
    }
  }

  // 6. Animate & depenetrate Synchronized Pneumatic Sliding Traffic Gates
  if (runtime.slidingGates.length > 0) {
    const fp = getFootprintAabbHalfExtents(pose.yaw);
    const botHx = fp.x / MAP_SCALE;
    const botHz = fp.z / MAP_SCALE;
    const onGroundBand = Math.abs((pose.y + TRACK_CONTACT_OFFSET) - GROUND_DECK_HEIGHT) <= 0.72;
    for (const sg of runtime.slidingGates) {
      sg.hitCooldown = Math.max(0, sg.hitCooldown - dt);
      const vGate = sg.amplitude * Math.sin(sg.omega * nowSec + sg.phase);
      const vvGate = sg.slot.dir * sg.amplitude * sg.omega * Math.cos(sg.omega * nowSec + sg.phase);
      sg.gateGroup.position.z = sg.slot.laneZ + sg.slot.dir * vGate;
      sg.beaconMat.color.setHex(Math.sin(nowSec * 9.0 + sg.phase) > 0 ? 0xe5a93c : 0x5c3c12);

      if (!onGroundBand) continue;
      const uBot = sg.slot.dir * (rx - sg.slot.centerX);
      const vBot = sg.slot.dir * (rz - sg.slot.laneZ);
      const du = uBot - sg.u;
      const dv = vBot - vGate;
      const ovU = (botHx + sg.halfThickU) - Math.abs(du);
      const ovV = (botHz + sg.halfWidthV) - Math.abs(dv);
      if (ovU > 0 && ovV > 0) {
        if (ovU < ovV) {
          const pushX = sg.slot.dir * (du >= 0 ? 1 : -1) * (ovU + 0.015) * MAP_SCALE;
          pose.x += pushX;
          motionState.x = pose.x;
          pose.vx *= 0.35;
          motionState.vx = pose.vx;
        } else {
          const pushZ = sg.slot.dir * (dv >= 0 ? 1 : -1) * (ovV + 0.015) * MAP_SCALE;
          pose.z += pushZ;
          motionState.z = pose.z;
          pose.vz = vvGate * MAP_SCALE * 0.55;
          motionState.vz = pose.vz;
        }
        const relSpeed = Math.hypot(pose.vx, pose.vz - vvGate * MAP_SCALE);
        if (sg.hitCooldown <= 0 && relSpeed > 1.35) {
          sg.hitCooldown = 0.85;
          onSlidingGateImpact?.(relSpeed);
        }
      }
    }
  }
}
