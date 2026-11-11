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
  sampleHangingBridgeRibbon,
  stepHangingBridgeState,
  type GeneratedCourse,
  type HangingBridgeState,
  type HurdleSlot,
  type HurdleTier,
} from './courseGenerator.ts';
import {
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
};

export type HangingBridgeRibbonVisual = {
  side: 0 | 1;
  vNominal: number;
  sideSign: -1 | 1;
  planks: THREE.Mesh[];      // 18 slats preserving exact (0.54, 0.08, 0.62) size
  hangers: THREE.Mesh[];     // 18 suspender rods connecting main cable to outer slat edge
  mainCables: THREE.Mesh[];  // 18 overhead main suspension cable segments
  edgeChainsL: THREE.Mesh[]; // 17 carrier chain segments along inner/left slat edge
  edgeChainsR: THREE.Mesh[]; // 17 carrier chain segments along outer/right slat edge
};

export type HangingBridgeRuntime = {
  slotIndex: number;
  slot: HurdleSlot;
  trackSpacingHalf: number;
  ribbons: [HangingBridgeRibbonVisual, HangingBridgeRibbonVisual];
};

export type CourseRuntimeHandles = {
  plan: GeneratedCourse;
  checkpoints: CheckpointMeshRuntime[];
  recoveryAnchors: RecoveryAnchor[];
  turntables: TurntableRuntime[];
  pendulums: PendulumRuntime[];
  seesaws: SeesawRuntime[];
  hangingBridges: HangingBridgeRuntime[];
  footballArenas: FootballArenaRuntime[];
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
  const stepU = 9.0 / segCount;
  const yTowerCable = 2.48;
  const cableRestSag = 0.86;
  const toCX = (u: number) => slot.centerX + slot.dir * u;
  const toCZ = (v: number) => slot.laneZ + slot.dir * v;

  for (const rib of hb.ribbons) {
    const bridgeRestSagAt = (s: number) => 0.14 * 4 * s * (1 - s);
    const sampleMainCable = (s: number) => {
      const sClamped = Math.max(0, Math.min(1, s));
      const ribS = sampleHangingBridgeRibbon(state, rib.side, sClamped);
      const restDeckY = 0.88 - bridgeRestSagAt(sClamped);
      const extraDip = Math.max(-0.08, restDeckY - ribS.y);
      const yMain = yTowerCable - cableRestSag * 4 * sClamped * (1 - sClamped) - extraDip * 0.56;
      const vMain = rib.sideSign * 1.10 + ribS.swayV * 0.65;
      return {
        x: toCX(-4.5 + sClamped * 9.0),
        y: yMain,
        z: toCZ(vMain),
        plank: ribS,
      };
    };

    // 1. Overhead main suspension cable (18 articulated links from tower post to tower post)
    let prevC = sampleMainCable(0);
    for (let k = 0; k < segCount; k++) {
      const nextC = sampleMainCable((k + 1) / segCount);
      alignBridgeSegment(rib.mainCables[k], prevC.x, prevC.y, prevC.z, nextC.x, nextC.y, nextC.z);
      prevC = nextC;
    }

    // 2. Planks & suspender hangers + longitudinal carrier chains
    let prevX = 0;
    let prevY = 0;
    let prevZLeft = 0;
    let prevZRight = 0;

    for (let pi = 0; pi < segCount; pi++) {
      const s0 = pi / segCount;
      const s1 = (pi + 1) / segCount;
      const sMid = (pi + 0.5) / segCount;
      const midCable = sampleMainCable(sMid);
      const r0 = sampleHangingBridgeRibbon(state, rib.side, s0);
      const r1 = sampleHangingBridgeRibbon(state, rib.side, s1);
      const rM = midCable.plank;

      const xM = midCable.x;
      const yM = rM.y;
      const vM = rib.vNominal + rM.swayV;
      const zM = toCZ(vM);

      const plankMesh = rib.planks[pi];
      plankMesh.position.set(xM, yM - 0.04, zM);
      // Pitch plank cleanly along the deformed catenary tangent slope
      plankMesh.rotation.z = Math.atan2(r1.y - r0.y, slot.dir * stepU);
      // Subtle cradle roll angle as cables swing laterally
      plankMesh.rotation.x = rM.swayV * 0.24 * slot.dir;

      // Vertical suspender cable from overhead main chain down to outer plank edge
      const vOuterEdge = rib.vNominal + rib.sideSign * 0.28 + rM.swayV;
      alignBridgeSegment(
        rib.hangers[pi],
        xM,
        yM - 0.01,
        toCZ(vOuterEdge),
        midCable.x,
        midCable.y,
        midCable.z,
      );

      const zEdgeL = toCZ(vM - 0.23);
      const zEdgeR = toCZ(vM + 0.23);
      const yChain = yM - 0.075;
      if (pi > 0) {
        alignBridgeSegment(rib.edgeChainsL[pi - 1], prevX, prevY, prevZLeft, xM, yChain, zEdgeL);
        alignBridgeSegment(rib.edgeChainsR[pi - 1], prevX, prevY, prevZRight, xM, yChain, zEdgeR);
      }
      prevX = xM;
      prevY = yChain;
      prevZLeft = zEdgeL;
      prevZRight = zEdgeR;
    }
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
  ctx.fillStyle = '#c4e412';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(32, 64, 44, -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(96, 64, 44, Math.PI * 0.58, Math.PI * 1.42);
  ctx.stroke();
  return new THREE.CanvasTexture(cvs);
}

let cachedTennisMat: THREE.MeshStandardMaterial | null = null;
let cachedTurfMat: THREE.MeshStandardMaterial | null = null;
let cachedWreckingBallMat: THREE.MeshStandardMaterial | null = null;

function getWreckingBallMat() {
  if (!cachedWreckingBallMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 128;
    const ctx = cvs.getContext('2d')!;
    // Deep forged charcoal cast-iron body
    ctx.fillStyle = '#1e2226';
    ctx.fillRect(0, 0, 256, 128);
    // Subtle forged grain & panel rivets
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect((i * 47) % 252, (i * 31) % 124, 3, 3);
    }
    // High-visibility amber & obsidian industrial hazard chevron band across mid-hemisphere
    ctx.fillStyle = '#f5b82e';
    ctx.fillRect(0, 40, 256, 48);
    ctx.fillStyle = '#121518';
    for (let sx = -32; sx < 288; sx += 32) {
      ctx.beginPath();
      ctx.moveTo(sx, 40);
      ctx.lineTo(sx + 16, 40);
      ctx.lineTo(sx - 4, 88);
      ctx.lineTo(sx - 20, 88);
      ctx.closePath();
      ctx.fill();
    }
    // Brushed steel reinforcing bands & bolt dots
    ctx.fillStyle = '#4c555d';
    ctx.fillRect(0, 35, 256, 5);
    ctx.fillRect(0, 88, 256, 5);
    ctx.fillStyle = '#8b959e';
    for (let rx = 8; rx < 256; rx += 16) {
      ctx.fillRect(rx, 36, 3, 3);
      ctx.fillRect(rx, 89, 3, 3);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    cachedWreckingBallMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.48,
      metalness: 0.48,
    });
  }
  return cachedWreckingBallMat;
}

function getTennisMat() {
  if (!cachedTennisMat) {
    cachedTennisMat = new THREE.MeshStandardMaterial({
      map: createTennisBallTexture(),
      roughness: 0.78,
      metalness: 0.02,
      emissive: '#3b4a04',
      emissiveIntensity: 0.08,
    });
  }
  return cachedTennisMat;
}

function getTurfMat() {
  if (!cachedTurfMat) {
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 256;
    const ctx = cvs.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#16612b' : '#104d21';
      ctx.fillRect(i * 32, 0, 32, 256);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    cachedTurfMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.90, metalness: 0.02 });
  }
  return cachedTurfMat;
}

function createBrickTextureMat(baseMat: THREE.Material) {
  return baseMat;
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
      floorCutouts.push({ xMin: s.centerX - 4.45, xMax: s.centerX + 4.45, zMin: s.laneZ - 2.25, zMax: s.laneZ + 2.25 });
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

  // Stadium Perimeter Barriers & Yellow Coping
  for (const [id, x, z, w, d] of [
    ['wall_north', 0, -17.82, 46, 0.32],
    ['wall_south', 0, 17.82, 46, 0.32],
    ['wall_west', -24.02, 0, 0.32, 36],
    ['wall_east', 24.02, 0, 0.32, 36],
  ] as [string, number, number, number, number][]) {
    makeBox(courseGroup, mats.black, new THREE.Vector3(x, ARENA_FLOOR_HEIGHT + 0.39, z), new THREE.Vector3(w, 0.78, d));
    colliders.push({ id, x, z, hx: w / 2, hz: d / 2, y: ARENA_FLOOR_HEIGHT + 0.39, height: 0.78, rot: 0, walkable: false });
  }
  const wallTopY = ARENA_FLOOR_HEIGHT + 0.78;
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(0, wallTopY + 0.015, -17.82), new THREE.Vector3(46, 0.03, 0.34), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(0, wallTopY + 0.015, 17.82), new THREE.Vector3(46, 0.03, 0.34), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(-24.02, wallTopY + 0.015, 0), new THREE.Vector3(0.34, 0.03, 36), 0, false);
  makeBox(courseGroup, mats.yellow, new THREE.Vector3(24.02, wallTopY + 0.015, 0), new THREE.Vector3(0.34, 0.03, 36), 0, false);

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
    // Split [-17.5..+17.5] around sunken cutouts (water_basin / hanging_bridges)
    const cutouts: Array<[number, number]> = [];
    for (const s of laneSlots) {
      if (s.type === 'water_basin' || s.type === 'hanging_bridges' || s.type === 'pendulum_bridge') {
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

  // 4 Hairpin Ribbons
  const hairpins: Array<[number, number, number, number]> = [
    [17.50, 10.125, Math.PI / 2, -Math.PI / 2],
    [-17.50, 3.375, Math.PI / 2, Math.PI * 1.5],
    [17.50, -3.375, Math.PI / 2, -Math.PI / 2],
    [-17.50, -10.125, Math.PI / 2, Math.PI * 1.5],
  ];
  for (const [cx, cz, a0, a1] of hairpins) {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = a0 + (a1 - a0) * (i / 24);
      pts.push({ x: cx + 3.375 * Math.cos(a), z: cz + 3.375 * Math.sin(a) });
    }
    makeRouteRibbon(courseGroup, pts, 0, DRIVE_ROUTE_WIDTH, mats.asphalt, 0.006, 0.12, true);
    makeRouteRibbon(courseGroup, pts, -(DRIVE_ROUTE_WIDTH / 2 - 0.10), 0.08, mats.laneStripeWhite, 0.016);
    makeRouteRibbon(courseGroup, pts, DRIVE_ROUTE_WIDTH / 2 - 0.10, 0.08, mats.laneStripeWhite, 0.016);
    makeRouteRibbon(courseGroup, pts, 0, 0.08, mats.yellow, 0.016);
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
  const footballArenas: FootballArenaRuntime[] = [];
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
        makeCyl(courseGroup, idx % 2 === 0 ? mats.wood : mats.metal, new THREE.Vector3(lx, GROUND_DECK_HEIGHT + 0.04, toCourseZ(slot, vMid)), 0.22, lenZ, 'z', 14);
        makeCyl(courseGroup, mats.yellow, new THREE.Vector3(lx, GROUND_DECK_HEIGHT + 0.04, toCourseZ(slot, vMid - lenZ / 2 + 0.08)), 0.23, 0.10, 'z', 14);
        makeCyl(courseGroup, mats.yellow, new THREE.Vector3(lx, GROUND_DECK_HEIGHT + 0.04, toCourseZ(slot, vMid + lenZ / 2 - 0.08)), 0.23, 0.10, 'z', 14);
      });
    } else if (slot.type === 'rumble_washboard') {
      for (let i = 0; i < 8; i++) {
        const u = -3.5 + i * 1.0;
        const rx = toCourseX(slot, u);
        const vOff = (i % 2 === 0 ? -0.55 : 0.55);
        makeBox(courseGroup, i % 2 === 0 ? mats.yellow : mats.concreteCurb, new THREE.Vector3(rx, GROUND_DECK_HEIGHT + 0.06, toCourseZ(slot, vOff)), new THREE.Vector3(0.34, 0.13, 2.75), slot.dir * 0.22 * (i % 2 === 0 ? 1 : -1));
      }
    } else if (slot.type === 'fire_hearth') {
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -2.5), toCourseX(slot, -2.0), lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, 0.05, 0.16, mats.concretePier, t => t, 5);
      makeBox(courseGroup, mats.concretePier, new THREE.Vector3(cx, 0.05 - 0.18, lz), new THREE.Vector3(4.0, 0.38, DRIVE_ROUTE_WIDTH));
      makeBox(courseGroup, mats.magmaBed, new THREE.Vector3(cx, 0.045, lz), new THREE.Vector3(3.85, 0.03, DRIVE_ROUTE_WIDTH - 0.45), 0, false);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 2.0), toCourseX(slot, 2.5), lz, DRIVE_ROUTE_WIDTH, 0.05, GROUND_DECK_HEIGHT, 0.16, mats.concretePier, t => t, 5);
      for (let f = 0; f < 16; f++) {
        const fu = -1.7 + (f % 8) * 0.48;
        const fv = f < 8 ? -1.45 : 1.45;
        const fm = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 7), mats.flameTongue);
        fm.position.set(toCourseX(slot, fu), 0.32, toCourseZ(slot, fv));
        courseGroup.add(fm);
        flames.push({ mesh: fm, baseScaleY: 1.0, baseScaleXZ: 1.0, freqLick: 7 + (f % 5), swaySpeed: 3.1, phase1: f * 0.9, phase2: f * 1.4 });
      }
    } else if (slot.type === 'water_basin') {
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -4.4), toCourseX(slot, -3.0), lz, DRIVE_ROUTE_WIDTH, GROUND_DECK_HEIGHT, -0.30, 0.14, mats.concreteCurb, easeCushionedRamp, 12);
      makeBox(courseGroup, mats.concreteCurb, new THREE.Vector3(cx, -0.33, lz), new THREE.Vector3(6.2, 0.06, DRIVE_ROUTE_WIDTH));
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 3.0), toCourseX(slot, 4.4), lz, DRIVE_ROUTE_WIDTH, -0.30, GROUND_DECK_HEIGHT, 0.14, mats.concreteCurb, easeCushionedRamp, 12);
      const wPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.6, DRIVE_ROUTE_WIDTH - 0.1), mats.water);
      wPlane.rotation.x = -Math.PI / 2;
      wPlane.position.set(cx, 0.16, lz);
      courseGroup.add(wPlane);
      for (const side of [-1, 1]) {
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, 0.17, lz + side * (DRIVE_ROUTE_WIDTH / 2 - 0.10)), new THREE.Vector3(8.8, 0.012, 0.09), 0, false);
      }
    } else if (slot.type === 'football_arena') {
      const ballCount = slot.footballBallCount ?? 5;
      const turfTopY = GROUND_DECK_HEIGHT + 0.016;
      const pitchHalfU = 2.75; // 5.50 front-to-back along road
      const pitchHalfV = 3.05; // 6.10 wide left-to-right (HORIZONTAL stadium orientation)
      const goalMouthHalfU = 1.55; // 3.10 (~4.0m world) wide full goalpost at BOTH ends!
      const goalDepthV = 0.78;
      const goalH = 1.05;

      // Flared asphalt side aprons smoothly widening lane (2.20 -> 3.05) into pitch & tapering back
      for (const endSign of [-1, 1] as const) {
        const uOuter = endSign * 4.50;
        const uInner = endSign * pitchHalfU;
        for (const side of [-1, 1] as const) {
          const zRoad = toCourseZ(slot, side * 2.20);
          const zPitch = toCourseZ(slot, side * pitchHalfV);
          const xO = toCourseX(slot, uOuter);
          const xI = toCourseX(slot, uInner);
          const wingGeo = new THREE.BufferGeometry();
          const verts = new Float32Array([
            xO, GROUND_DECK_HEIGHT, zRoad,
            xI, GROUND_DECK_HEIGHT, zRoad,
            xI, GROUND_DECK_HEIGHT, zPitch,
          ]);
          wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          wingGeo.setIndex(endSign * side > 0 ? [0, 1, 2] : [0, 2, 1]);
          wingGeo.computeVertexNormals();
          const wingMesh = new THREE.Mesh(wingGeo, mats.asphalt);
          wingMesh.receiveShadow = true;
          courseGroup.add(wingMesh);
        }
      }

      // Horizontal Stadium Striped Green Turf Deck (wider Left-Right than Long!)
      makeBox(courseGroup, getTurfMat(), new THREE.Vector3(cx, GROUND_DECK_HEIGHT - 0.004, lz), new THREE.Vector3(pitchHalfU * 2, 0.04, pitchHalfV * 2), 0, false);

      // White Touchline Perimeter & Midfield Lines
      for (const side of [-1, 1]) {
        // Side touchlines along Left (-v) and Right (+v) goal lines
        makeBox(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + 0.004, toCourseZ(slot, side * (pitchHalfV - 0.05))), new THREE.Vector3(pitchHalfU * 2 - 0.08, 0.008, 0.08), 0, false);
        // Entry & exit end sidelines along u = +/- pitchHalfU
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

      // Build BOTH Realistic Full-Width Stadium Goalposts + Penalty Boxes + Low Side Containment Curbs
      const ledMats: Record<-1 | 1, THREE.MeshBasicMaterial> = {
        [-1]: new THREE.MeshBasicMaterial({ color: '#f0bd53' }),
        [1]: new THREE.MeshBasicMaterial({ color: '#f0bd53' }),
      };

      for (const side of [-1, 1] as const) {
        const lineV = side * pitchHalfV;
        const backV = side * (pitchHalfV + goalDepthV);
        const midV = side * (pitchHalfV + goalDepthV * 0.5);
        const zLine = toCourseZ(slot, lineV);
        const zBack = toCourseZ(slot, backV);
        const zMid = toCourseZ(slot, midV);
        const xPostA = toCourseX(slot, -goalMouthHalfU);
        const xPostB = toCourseX(slot, goalMouthHalfU);

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

        // Authentic Full Goalpost Uprights + Crossbar + Rear Frame + Angled Stanchions + Net Shell
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(xPostA, turfTopY + goalH * 0.5, zLine), 0.065, goalH, 'y', 14);
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(xPostB, turfTopY + goalH * 0.5, zLine), 0.065, goalH, 'y', 14);
        makeCyl(courseGroup, mats.laneStripeWhite, new THREE.Vector3(cx, turfTopY + goalH, zLine), 0.065, goalMouthHalfU * 2 + 0.12, 'x', 14);

        // Rear bottom ground bar & upper net tension rod
        makeCyl(courseGroup, mats.orange, new THREE.Vector3(cx, turfTopY + 0.04, zBack), 0.045, goalMouthHalfU * 2, 'x', 10);
        makeCyl(courseGroup, mats.orange, new THREE.Vector3(cx, turfTopY + goalH * 0.88, toCourseZ(slot, lineV + side * (goalDepthV * 0.85))), 0.04, goalMouthHalfU * 2, 'x', 10);
        for (const px of [xPostA, xPostB]) {
          // Side ground runners
          makeCyl(courseGroup, mats.orange, new THREE.Vector3(px, turfTopY + 0.04, zMid), 0.04, goalDepthV, 'z', 10);
          // Diagonal rear stanchion braces
          const braceLen = Math.hypot(goalDepthV, goalH * 0.86);
          const brace = makeBox(courseGroup, mats.orange, new THREE.Vector3(px, turfTopY + goalH * 0.52, zMid), new THREE.Vector3(0.065, 0.065, braceLen));
          brace.rotation.x = (side * slot.dir > 0 ? 1 : -1) * Math.atan2(goalH * 0.86, goalDepthV);
        }

        // Solid green goal-pocket turf deck extending to rear stanchion so net floor is supported at deck level
        makeBox(courseGroup, getTurfMat(), new THREE.Vector3(cx, GROUND_DECK_HEIGHT - 0.004, zMid), new THREE.Vector3(goalMouthHalfU * 2 + 0.24, 0.04, goalDepthV + 0.08), 0, false);

        // Woven Net Shell (wireframe net + subtle translucent pocket)
        const netShell = new THREE.Mesh(
          new THREE.BoxGeometry(goalMouthHalfU * 2, goalH * 0.94, goalDepthV),
          new THREE.MeshBasicMaterial({ color: '#eef4ef', transparent: true, opacity: 0.42, wireframe: true }),
        );
        netShell.position.set(cx, turfTopY + goalH * 0.47, zMid);
        courseGroup.add(netShell);

        // Goal Confirmation LED Crossbar Strip
        const ledMesh = new THREE.Mesh(
          new THREE.BoxGeometry(goalMouthHalfU * 1.9, 0.085, 0.09),
          ledMats[side],
        );
        ledMesh.position.set(cx, turfTopY + goalH + 0.10, zLine);
        courseGroup.add(ledMesh);

        // Netted Goalpost Colliders (rear wall + two side net posts so robot cannot drive through back of net)
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
            hx: 0.10,
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
      makeBox(courseGroup, mats.oil, new THREE.Vector3(cx, GROUND_DECK_HEIGHT + 0.015, lz), new THREE.Vector3(7.4, 0.02, DRIVE_ROUTE_WIDTH - 0.25), 0, false);
      const chicanes = [
        { u: -2.6, v: -0.95 },
        { u: -0.8, v: 0.95 },
        { u: 1.0, v: -0.95 },
        { u: 2.8, v: 0.95 },
      ];
      chicanes.forEach((c, ci) => {
        const tx = toCourseX(slot, c.u);
        const tz = toCourseZ(slot, c.v);
        makeCyl(courseGroup, mats.rubber, new THREE.Vector3(tx, GROUND_DECK_HEIGHT + 0.26, tz), 0.36, 0.52, 'y', 16);
        makeCyl(courseGroup, mats.orange, new THREE.Vector3(tx, GROUND_DECK_HEIGHT + 0.56, tz), 0.22, 0.14, 'y', 14);
        colliders.push({ id: `oil_tire_${slot.index}_${ci}`, x: tx, z: tz, hx: 0.36, hz: 0.36, y: GROUND_DECK_HEIGHT + 0.26, height: 0.52, rot: 0, walkable: false });
      });
    } else if (slot.type === 'turntable_deck') {
      const deckY = 0.92;
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -5.0), toCourseX(slot, -2.1), lz, 3.3, GROUND_DECK_HEIGHT, deckY, 0.20, mats.diamondPlate, easeCushionedRamp, 18);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 2.1), toCourseX(slot, 5.0), lz, 3.3, deckY, GROUND_DECK_HEIGHT, 0.20, mats.diamondPlate, easeCushionedRamp, 18);
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(cx, (deckY + ARENA_FLOOR_HEIGHT) / 2 - 0.1, lz), 0.55, deckY - ARENA_FLOOR_HEIGHT - 0.15, 'y', 24);
      const ttGroup = new THREE.Group();
      ttGroup.position.set(cx, deckY, lz);
      courseGroup.add(ttGroup);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.30, 2.30, 0.16, 36), mats.diamondPlate);
      disc.position.y = -0.08;
      disc.castShadow = true;
      disc.receiveShadow = true;
      ttGroup.add(disc);
      for (let sp = 0; sp < 8; sp++) {
        const ang = (sp * Math.PI) / 4;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.015, 0.12), mats.yellow);
        bar.position.y = 0.008;
        bar.rotation.y = ang;
        ttGroup.add(bar);
      }
      turntables.push({ group: ttGroup, x: cx, z: lz, radius: 2.30, deckY });
    } else if (slot.type === 'pendulum_bridge') {
      const deckY = 1.35;
      const wCat = 2.00;
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -6.0), toCourseX(slot, -3.6), lz, wCat, GROUND_DECK_HEIGHT, deckY, 0.22, mats.diamondPlate, t => easeCushionedRamp(t, 0.14), 22);
      makeBox(courseGroup, mats.diamondPlate, new THREE.Vector3(cx, deckY - 0.11, lz), new THREE.Vector3(7.2, 0.22, wCat));
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 3.6), toCourseX(slot, 6.0), lz, wCat, deckY, GROUND_DECK_HEIGHT, 0.22, mats.diamondPlate, t => easeCushionedRamp(t, 0.14), 22);
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
          makeBox(courseGroup, mats.metal, new THREE.Vector3(bx, (pivotY + ARENA_FLOOR_HEIGHT) / 2, lz + side * 1.45), new THREE.Vector3(0.16, pivotY - ARENA_FLOOR_HEIGHT, 0.16));
        }
        makeBox(courseGroup, mats.orange, new THREE.Vector3(bx, pivotY, lz), new THREE.Vector3(0.20, 0.20, 3.10));

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
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, -6.1), toCourseX(slot, -4.5), lz, 2.50, GROUND_DECK_HEIGHT, bridgeY, 0.18, mats.metal, easeCushionedRamp, 14);
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 4.5), toCourseX(slot, 6.1), lz, 2.50, bridgeY, GROUND_DECK_HEIGHT, 0.18, mats.metal, easeCushionedRamp, 14);
      for (const tu of [-4.5, 4.5]) {
        const tx = toCourseX(slot, tu);
        for (const side of [-1, 1]) {
          makeCyl(courseGroup, mats.metal, new THREE.Vector3(tx, 1.35, lz + side * 1.15), 0.11, 4.6, 'y', 12);
        }
        makeBox(courseGroup, mats.orange, new THREE.Vector3(tx, 2.55, lz), new THREE.Vector3(0.16, 0.14, 2.50));
      }

      // Articulated Twin Hanging Chain Bridge Ribbons (exact spacing = TRACK_WIDTH / MAP_SCALE, exact 0.54 x 0.08 x 0.62 slats)
      const trackSpacingHalf = (TRACK_WIDTH / MAP_SCALE) * 0.5;
      const segCount = 18;
      const mainCableGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
      const hangerGeo = new THREE.CylinderGeometry(0.013, 0.013, 1, 7);
      const edgeChainGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 7);
      const plankGeo = new THREE.BoxGeometry(0.54, 0.08, 0.62);

      const ribbons: HangingBridgeRibbonVisual[] = ([0, 1] as const).map(side => {
        const sideSign: -1 | 1 = side === 0 ? -1 : 1;
        const vNominal = sideSign * trackSpacingHalf;
        const planks: THREE.Mesh[] = [];
        const hangers: THREE.Mesh[] = [];
        const mainCables: THREE.Mesh[] = [];
        const edgeChainsL: THREE.Mesh[] = [];
        const edgeChainsR: THREE.Mesh[] = [];

        for (let i = 0; i < segCount; i++) {
          const plank = new THREE.Mesh(plankGeo, mats.wood);
          plank.castShadow = true;
          plank.receiveShadow = true;
          courseGroup.add(plank);
          planks.push(plank);

          const hMesh = new THREE.Mesh(hangerGeo, mats.chrome);
          hMesh.castShadow = true;
          courseGroup.add(hMesh);
          hangers.push(hMesh);

          const cMesh = new THREE.Mesh(mainCableGeo, mats.black);
          cMesh.castShadow = true;
          courseGroup.add(cMesh);
          mainCables.push(cMesh);

          if (i < segCount - 1) {
            const cL = new THREE.Mesh(edgeChainGeo, mats.chrome);
            const cR = new THREE.Mesh(edgeChainGeo, mats.chrome);
            cL.castShadow = true;
            cR.castShadow = true;
            courseGroup.add(cL);
            courseGroup.add(cR);
            edgeChainsL.push(cL);
            edgeChainsR.push(cR);
          }
        }
        return { side, vNominal, sideSign, planks, hangers, mainCables, edgeChainsL, edgeChainsR };
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
      const rInner = 1.00;
      const rOuter = 3.30;
      const yTop = 3.20;
      const ttU = 2.20;
      const ttX = toCourseX(slot, ttU);

      // Central structural steel pylon + smooth circular inner core guard drum
      const pylonH = yTop + 0.35 - ARENA_FLOOR_HEIGHT;
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(spX, ARENA_FLOOR_HEIGHT + 0.18, lz), 0.94, 0.36, 'y', 24);
      makeCyl(courseGroup, mats.metal, new THREE.Vector3(spX, ARENA_FLOOR_HEIGHT + pylonH / 2, lz), 0.72, pylonH, 'y', 24);
      for (let k = 0; k < 8; k++) {
        const ka = (k * Math.PI) / 4;
        const kx = spX + Math.cos(ka) * 0.80;
        const kz = lz + Math.sin(ka) * 0.80;
        colliders.push({ id: `spiral_core_${slot.index}_${k}`, x: kx, z: kz, hx: 0.34, hz: 0.10, y: ARENA_FLOOR_HEIGHT + pylonH / 2, height: pylonH, rot: -ka + Math.PI / 2, walkable: false });
      }

      // 540-degree helical spiral ramp ribbon + outer safety guardrail + low-wedge retaining skirt
      const spSegs = 54;
      for (let s = 0; s < spSegs; s++) {
        const t0 = s / spSegs;
        const t1 = (s + 1) / spSegs;
        const beta0 = t0 * 3 * Math.PI;
        const beta1 = t1 * 3 * Math.PI;
        const y0 = GROUND_DECK_HEIGHT + t0 * (yTop - GROUND_DECK_HEIGHT);
        const y1 = GROUND_DECK_HEIGHT + t1 * (yTop - GROUND_DECK_HEIGHT);
        const yMid = (y0 + y1) * 0.5;
        const midBeta = (beta0 + beta1) * 0.5;
        const rMid = (rInner + rOuter) * 0.5;
        const du = -Math.cos(midBeta) * rMid;
        const dv = -Math.sin(midBeta) * rMid;
        const p0x = toCourseX(slot, spU - Math.cos(beta0) * rMid);
        const p0z = toCourseZ(slot, -Math.sin(beta0) * rMid);
        const p1x = toCourseX(slot, spU - Math.cos(beta1) * rMid);
        const p1z = toCourseZ(slot, -Math.sin(beta1) * rMid);
        const segLen = Math.hypot(p1x - p0x, p1z - p0z) + 0.14;
        const px = toCourseX(slot, spU + du);
        const pz = toCourseZ(slot, dv);
        const ang = Math.atan2(-(p1z - p0z), p1x - p0x);
        makeBox(courseGroup, mats.asphalt, new THREE.Vector3(px, yMid - 0.10, pz), new THREE.Vector3(segLen, 0.20, rOuter - rInner), ang);

        // Outer painted curb & containment guardrail wall (leaves entry s<2 and summit bridge merge s>=47 open)
        const duOut = -Math.cos(midBeta) * (rOuter - 0.08);
        const dvOut = -Math.sin(midBeta) * (rOuter - 0.08);
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(toCourseX(slot, spU + duOut), yMid + 0.008, toCourseZ(slot, dvOut)), new THREE.Vector3(segLen * 1.04, 0.014, 0.09), ang, false);

        if (s >= 2 && s <= 49) {
          const rRail = rOuter + 0.06;
          const o0x = toCourseX(slot, spU - Math.cos(beta0) * rRail);
          const o0z = toCourseZ(slot, -Math.sin(beta0) * rRail);
          const o1x = toCourseX(slot, spU - Math.cos(beta1) * rRail);
          const o1z = toCourseZ(slot, -Math.sin(beta1) * rRail);
          const oLen = Math.hypot(o1x - o0x, o1z - o0z) + 0.08;
          const oAng = Math.atan2(-(o1z - o0z), o1x - o0x);
          const rx = toCourseX(slot, spU - Math.cos(midBeta) * rRail);
          const rz = toCourseZ(slot, -Math.sin(midBeta) * rRail);
          makeBox(courseGroup, mats.metal, new THREE.Vector3(rx, yMid + 0.17, rz), new THREE.Vector3(oLen, 0.34, 0.12), oAng);
          makeBox(courseGroup, mats.yellow, new THREE.Vector3(rx, yMid + 0.36, rz), new THREE.Vector3(oLen, 0.05, 0.13), oAng, false);
          colliders.push({
            id: `spiral_rail_${slot.index}_${s}`,
            x: rx,
            z: rz,
            hx: oLen * 0.5,
            hz: 0.08,
            y: yMid + 0.20,
            height: 0.44,
            rot: oAng,
            walkable: false,
          });

          // Solid retaining skirt beneath low-clearance Turn 1 overhang so ground vehicles cannot clip inside/under ramp
          if (s <= 24 && yMid > ARENA_FLOOR_HEIGHT + 0.08) {
            const skirtH = yMid - ARENA_FLOOR_HEIGHT;
            makeBox(courseGroup, mats.concretePier, new THREE.Vector3(rx, ARENA_FLOOR_HEIGHT + skirtH * 0.5 - 0.04, rz), new THREE.Vector3(oLen, skirtH, 0.14), oAng);
            colliders.push({
              id: `spiral_skirt_${slot.index}_${s}`,
              x: rx,
              z: rz,
              hx: oLen * 0.5,
              hz: 0.09,
              y: ARENA_FLOOR_HEIGHT + skirtH * 0.5,
              height: skirtH + 0.12,
              rot: oAng,
              walkable: false,
            });
          }
        }
      }

      // Upper Summit Approach Bridge + Side Guardrails + Rotating Rooftop Turntable + Downhill Descent Ramp
      makeBox(courseGroup, mats.asphalt, new THREE.Vector3(toCourseX(slot, -0.80), yTop - 0.11, lz), new THREE.Vector3(2.1, 0.22, 2.70));
      for (const side of [-1, 1]) {
        // Keep North (-1) rail clear of the arriving upper helix road (starts past helix intersection u=-1.18)
        const minU = side < 0 ? -1.18 : -1.85;
        const maxU = 0.22;
        const bLen = maxU - minU;
        const bx = toCourseX(slot, (minU + maxU) * 0.5);
        const bz = toCourseZ(slot, side * 1.40);
        makeBox(courseGroup, mats.metal, new THREE.Vector3(bx, yTop + 0.17, bz), new THREE.Vector3(bLen, 0.34, 0.12));
        makeBox(courseGroup, mats.yellow, new THREE.Vector3(bx, yTop + 0.36, bz), new THREE.Vector3(bLen, 0.05, 0.13), 0, false);
        colliders.push({
          id: `spiral_bridge_rail_${slot.index}_${side}`,
          x: bx,
          z: bz,
          hx: bLen * 0.5,
          hz: 0.08,
          y: yTop + 0.20,
          height: 0.44,
          rot: 0,
          walkable: false,
        });
      }
      makeCyl(courseGroup, mats.concretePier, new THREE.Vector3(ttX, (yTop + ARENA_FLOOR_HEIGHT) / 2 - 0.1, lz), 0.72, yTop - ARENA_FLOOR_HEIGHT - 0.18, 'y', 24);
      colliders.push({ id: `spiral_tt_pier_${slot.index}`, x: ttX, z: lz, hx: 0.72, hz: 0.72, y: ARENA_FLOOR_HEIGHT + 1.5, height: 3.0, rot: 0, walkable: false });
      const ttGroup = new THREE.Group();
      ttGroup.position.set(ttX, yTop, lz);
      courseGroup.add(ttGroup);
      const ttDisc = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 0.18, 36), mats.diamondPlate);
      ttDisc.position.y = -0.09;
      ttDisc.castShadow = true;
      ttDisc.receiveShadow = true;
      ttGroup.add(ttDisc);
      for (let sp = 0; sp < 8; sp++) {
        const ang = (sp * Math.PI) / 4;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.015, 0.12), mats.yellow);
        bar.position.y = 0.009;
        bar.rotation.y = ang;
        ttGroup.add(bar);
      }
      turntables.push({ group: ttGroup, x: ttX, z: lz, radius: 2.35, deckY: yTop });
      // Stationary North & South curved safety curbs around rotating turntable (leaving West/East mouths wide open)
      for (const side of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const a = side * (Math.PI * 0.5) + (k - 2) * 0.28;
          const cr = 2.42;
          const cxRim = ttX + Math.cos(a) * cr;
          const czRim = lz + Math.sin(a) * cr;
          const rimAng = Math.atan2(-Math.cos(a), -Math.sin(a));
          makeBox(courseGroup, mats.metal, new THREE.Vector3(cxRim, yTop + 0.17, czRim), new THREE.Vector3(0.72, 0.34, 0.12), rimAng);
          makeBox(courseGroup, mats.yellow, new THREE.Vector3(cxRim, yTop + 0.36, czRim), new THREE.Vector3(0.72, 0.05, 0.13), rimAng, false);
          colliders.push({
            id: `spiral_tt_rim_${slot.index}_${side}_${k}`,
            x: cxRim,
            z: czRim,
            hx: 0.36,
            hz: 0.08,
            y: yTop + 0.20,
            height: 0.44,
            rot: rimAng,
            walkable: false,
          });
        }
      }
      // Descent Viaduct Ramp back down to ground + smooth sloped side guardrails
      makeCurvedSlopedDeck(courseGroup, toCourseX(slot, 4.40), toCourseX(slot, 11.80), lz, 3.20, yTop, GROUND_DECK_HEIGHT, 0.24, mats.asphalt, t => easeCushionedRamp(t, 0.16), 34);
      for (const side of [-1, 1]) {
        for (let ds = 0; ds < 12; ds++) {
          const du0 = 4.42 + ds * 0.61;
          const du1 = du0 + 0.61;
          const t0d = (du0 - 4.40) / 7.40;
          const t1d = (du1 - 4.40) / 7.40;
          const dy0 = yTop + (GROUND_DECK_HEIGHT - yTop) * easeCushionedRamp(t0d, 0.16);
          const dy1 = yTop + (GROUND_DECK_HEIGHT - yTop) * easeCushionedRamp(t1d, 0.16);
          const dym = (dy0 + dy1) * 0.5;
          const segDx = (du1 - du0) * slot.dir;
          const segDy = dy1 - dy0;
          const segHyp = Math.hypot(segDx, segDy) + 0.04;
          const slopeRotZ = Math.atan2(segDy, segDx);
          const rxD = toCourseX(slot, (du0 + du1) * 0.5);
          const rzD = toCourseZ(slot, side * 1.66);
          const railMesh = makeBox(courseGroup, mats.metal, new THREE.Vector3(rxD, dym + 0.14, rzD), new THREE.Vector3(segHyp, 0.28, 0.10));
          railMesh.rotation.z = slopeRotZ;
          const capMesh = makeBox(courseGroup, mats.yellow, new THREE.Vector3(rxD, dym + 0.29, rzD), new THREE.Vector3(segHyp, 0.045, 0.11), 0, false);
          capMesh.rotation.z = slopeRotZ;
          colliders.push({
            id: `spiral_desc_rail_${slot.index}_${side}_${ds}`,
            x: rxD,
            z: rzD,
            hx: 0.36,
            hz: 0.07,
            y: dym + 0.16,
            height: 0.36,
            rot: 0,
            walkable: false,
          });
        }
      }
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
    ctx.fillStyle = '#111413';
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = isFinishGate ? '#ffd700' : '#f0bd53';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = isFinishGate ? '#ffe066' : '#f0bd53';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(cp.label.toUpperCase(), 256, 58);
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 0.52),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs), side: THREE.DoubleSide }),
    );
    signMesh.position.set(0, towerH, 0);
    g.add(signMesh);

    const laserColor = i === 0 ? '#f0bd53' : isFinishGate ? '#ffd700' : '#20e3b2';
    const laserGeo = new THREE.CylinderGeometry(0.016, 0.016, beamSpan, 10);
    laserGeo.rotateZ(Math.PI / 2);
    const bar = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: laserColor, transparent: true, opacity: 0.75 }));
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
    footballArenas,
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
      const overlap = hitDist - dist;
      const hDist = Math.hypot(dx, dz);
      const hnx = hDist > 0.001 ? dx / hDist : 0;
      const hnz = hDist > 0.001 ? dz / hDist : (Math.sign(vBallZ) || 1);
      pose.x += hnx * overlap;
      pose.z += hnz * overlap;
      motionState.x = pose.x;
      motionState.z = pose.z;
      if (!struck && pend.hitCooldown <= 0) {
        struck = true;
        pend.hitCooldown = 0.85;
        const relSpeed = Math.hypot(pose.vx, pose.vz - vBallZ);
        const pushDirZ = Math.sign(vBallZ) || hnz;
        pose.vz = pushDirZ * Math.max(1.35, Math.min(2.6, Math.abs(vBallZ) * 0.45));
        pose.vx = hnx * Math.max(0.65, Math.min(1.5, Math.abs(pose.vx) * 0.5 + 0.6));
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
  const robotR = 0.72; // effective rover push radius (local m)
  const pitchFloorY = GROUND_DECK_HEIGHT + 0.016;
  for (const arena of runtime.footballArenas) {
    if (arena.flashLeftTimer > 0) {
      arena.flashLeftTimer = Math.max(0, arena.flashLeftTimer - dt);
      if (arena.flashLeftTimer === 0) arena.goalLeftLedMat.color.set('#f0bd53');
    }
    if (arena.flashRightTimer > 0) {
      arena.flashRightTimer = Math.max(0, arena.flashRightTimer - dt);
      if (arena.flashRightTimer === 0) arena.goalRightLedMat.color.set('#f0bd53');
    }

    // Sub-step balls for crisp bouncing & zero tunneling
    for (let i = 0; i < arena.balls.length; i++) {
      const b = arena.balls[i];
      if (!b.scored) {
        // Check Robot -> Ball push impulse
        const rvx = pose.vx / MAP_SCALE;
        const rvz = pose.vz / MAP_SCALE;
        const dx = b.x - rx;
        const dz = b.z - rz;
        const d = Math.hypot(dx, dz);
        const minD = robotR + b.radius;
        if (d < minD && d > 1e-4) {
          const nx = dx / d;
          const nz = dz / d;
          b.x = rx + nx * (minD + 0.01);
          b.z = rz + nz * (minD + 0.01);
          const relVn = rvx * nx + rvz * nz - (b.vx * nx + b.vz * nz);
          const kickSpeed = Math.max(1.85, relVn * 1.38 + Math.hypot(rvx, rvz) * 0.55);
          b.vx += nx * kickSpeed;
          b.vz += nz * kickSpeed;
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

      // Integrate velocity & turf rolling drag
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const drag = Math.exp(-(b.scored ? 4.5 : 1.25) * dt);
      b.vx *= drag;
      b.vz *= drag;

      // Convert into slot local (u, v) to bounce cleanly inside horizontal pitch & check EITHER Goalpost mouth
      const u = arena.slot.dir * (b.x - arena.slot.centerX);
      const v = arena.slot.dir * (b.z - arena.slot.laneZ);
      let nextU = u;
      let nextV = v;
      let vu = arena.slot.dir * b.vx;
      let vv = arena.slot.dir * b.vz;

      if (b.scored) {
        // Confine scored ball gently inside the netted Goal Shell pocket on its scored side
        const gSide = b.scoredSide ?? 1;
        const uMin = -arena.goalMouthHalfU + b.radius + 0.04;
        const uMax = arena.goalMouthHalfU - b.radius - 0.04;
        const vMin = gSide === -1
          ? -(arena.pitchHalfV + arena.goalDepthV) + b.radius + 0.04
          : arena.pitchHalfV + b.radius + 0.02;
        const vMax = gSide === -1
          ? -arena.pitchHalfV - b.radius - 0.02
          : arena.pitchHalfV + arena.goalDepthV - b.radius - 0.04;
        if (nextU < uMin) { nextU = uMin; vu = Math.abs(vu) * 0.4; }
        if (nextU > uMax) { nextU = uMax; vu = -Math.abs(vu) * 0.4; }
        if (nextV < vMin) { nextV = vMin; vv = Math.abs(vv) * 0.4; }
        if (nextV > vMax) { nextV = vMax; vv = -Math.abs(vv) * 0.4; }
      } else {
        // Keep active balls within entry/exit pitch bounds along driving direction (u)
        const maxU = arena.pitchHalfU - b.radius;
        if (nextU < -maxU) { nextU = -maxU; vu = Math.abs(vu) * 0.72; }
        if (nextU > maxU) { nextU = maxU; vu = -Math.abs(vu) * 0.72; }

        // Check EITHER Left Goal (v <= -pitchHalfV) or Right Goal (v >= +pitchHalfV) within goal mouth
        const inGoalMouthU = Math.abs(nextU) <= arena.goalMouthHalfU - b.radius * 0.45;
        const crossedLeft = nextV <= -arena.pitchHalfV + 0.06;
        const crossedRight = nextV >= arena.pitchHalfV - 0.06;
        if (inGoalMouthU && (crossedLeft || crossedRight)) {
          const gSide: -1 | 1 = crossedLeft ? -1 : 1;
          b.scored = true;
          b.scoredSide = gSide;
          arena.goalsScored += 1;
          if (gSide === -1) {
            arena.goalLeftLedMat.color.set('#39e75f');
            arena.flashLeftTimer = 1.25;
          } else {
            arena.goalRightLedMat.color.set('#39e75f');
            arena.flashRightTimer = 1.25;
          }
          onFootballGoal(arena, arena.goalsScored);
        } else {
          // Bounce off side touchline containment curbs outside goal mouths
          const maxV = arena.pitchHalfV - b.radius;
          if (nextV < -maxV) { nextV = -maxV; vv = Math.abs(vv) * 0.72; }
          if (nextV > maxV) { nextV = maxV; vv = -Math.abs(vv) * 0.72; }
        }
      }

      b.x = arena.slot.centerX + arena.slot.dir * nextU;
      b.z = arena.slot.laneZ + arena.slot.dir * nextV;
      b.vx = arena.slot.dir * vu;
      b.vz = arena.slot.dir * vv;
      b.holder.position.set(b.x, pitchFloorY + b.radius * MAP_SCALE, b.z);
      b.mesh.rotation.z -= (b.vx / Math.max(0.05, b.radius)) * dt;
      b.mesh.rotation.x += (b.vz / Math.max(0.05, b.radius)) * dt;
    }
  }

  // Guard unused helper warning if footprint helper wasn't needed
  void getFootprintAabbHalfExtents;
}
