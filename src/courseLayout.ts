import { ROBOT_HALF_WIDTH, TRACK_WIDTH } from './vehicleDynamics.ts';

export type SurfaceType = 'concrete' | 'rubber' | 'timber' | 'sand' | 'gravel' | 'turf' | 'ice' | 'steel' | 'oil' | 'water' | 'fire' | 'rockfield';

export type SurfaceProperties = {
  grip: number;
  rollingResistance: number;
  hazard: 'none' | 'fire' | 'water' | 'oil';
};

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

export type CheckpointGate = {
  id: number;
  label: string;
  x: number;
  z: number;
  yaw: number;
  width: number;
};

export type CoursePoint = { x: number; z: number };
export const MAP_SCALE = 1.3;
export const PARALLEL_PLANK_CENTER_Z = -8.0;
export const PARALLEL_PLANK_SPACING_LOCAL = TRACK_WIDTH / MAP_SCALE;
export const PARALLEL_PLANK_CENTERS = [
  { x: -7.35, z: PARALLEL_PLANK_CENTER_Z - PARALLEL_PLANK_SPACING_LOCAL / 2 },
  { x: -7.35, z: PARALLEL_PLANK_CENTER_Z + PARALLEL_PLANK_SPACING_LOCAL / 2 },
] as const;

export const TURNTABLE_CENTER = { x: 10.65, z: 0.1 } as const;
export const TURNTABLE_RADIUS = 2.45; // Enlarged from 1.48m to 2.45m (~4.90m diameter, >3.2x robot width)

/** Route centreline in course-local metres. The road is built from this path
 * before obstacle modules are placed, so every section has a continuous base. */
// A wider driving envelope keeps the robot's full track covers clear while
// leaving room to steer around the slalom blocks instead of striking their ends.
export const DRIVE_ROUTE_WIDTH = 6.0;
export const ARENA_FLOOR_HEIGHT = -0.33;
export const ROUTE_CLEARANCE_HEIGHT = 1.0;
export const ROUTE_DECK_HEIGHT = ARENA_FLOOR_HEIGHT + ROUTE_CLEARANCE_HEIGHT;
export const ROUTE_HEIGHT_OFFSET = ROUTE_DECK_HEIGHT - 0.03;
function circularArc(cx: number, cz: number, radius: number, start: number, end: number, count: number, xAxis = 'cos') {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count;
    return xAxis === 'sin'
      ? { x: cx + radius * Math.sin(a), z: cz + radius * Math.cos(a) }
      : { x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) };
  });
}
export const DRIVE_ROUTE: CoursePoint[] = [
  { x: -20.6, z: 8.0 }, // supported ramp toe after a full approach bay
  { x: -19.2, z: 8.0 }, // start line
  { x: -16.3, z: 8.0 },
  { x: -0.2, z: 8.0 }, // straight corridor; the staggered barriers create the slalom
  { x: 3.2, z: 8.0 },  // breakers
  { x: 4.4, z: 8.0 },  // ramp checkpoint
  { x: 4.8, z: 8.0 },  // curved ramp
  { x: 9.6, z: 8.0 },  // raised bridge
  { x: 12.2, z: 8.0 }, // bridge descent landing toe (flush with route deck)
  { x: 13.2, z: 4.7 }, // marble pit approach / turn shelf
  // The broad turning-shelf points keep the entire track footprint supported
  // while the robot leaves the marble patch and lines up on the disc.
  { x: 13.7, z: 3.5 },
  { x: 13.8, z: 2.2 },
  { x: 13.2, z: 0.9 },
  { x: 12.1, z: 0.1 },
  { x: 10.65, z: 0.1 }, // rotating disc
  { x: 1.4, z: 0.0 },  // mixed terrain
  { x: -3.1, z: -4.0 }, // fire
  { x: -4.8, z: -4.0 }, // short fire-to-water cooling crossing
  { x: -7.0, z: -4.0 }, // narrow raised single-plank bridge
  { x: -10.0, z: -4.0 }, // oil exit
  { x: -13.2, z: -4.0 },
  // Smooth U-turn shelf at radius 2m connects the oil lane to the twin planks.
  ...circularArc(-13.2, -6.0, 2.0, Math.PI / 2, Math.PI * 1.5, 12).slice(1),
  { x: -7.5, z: -8.0 }, // checkpoint 10, crossed eastbound over parallel planks
  { x: -0.2, z: -8.0 },
  // Broad final hairpin, radius 1.9m, followed by a straight finish approach.
  ...circularArc(-0.2, -9.9, 1.9, 0, Math.PI, 12, 'sin').slice(1),
  { x: -13.2, z: -12.0 }, // final checkpoint and straight
  { x: -15.0, z: -12.0 },
];

/** Physical connectors for the optional elevated switchback training branch. */
export const HILL_ENTRY_LINK: CoursePoint[] = [
  // The hill now starts on a dedicated south branch. The former toe at z=-2
  // overlapped the main disc approach: the height query put one side of a
  // turning robot on the raised hill while the opposite side stayed on road.
  { x: 10.65, z: 0.1 }, { x: 9.8, z: -1.1 }, { x: 8.9, z: -2.8 }, { x: 8.0, z: -4.5 },
];
export const HILL_EXIT_LINK: CoursePoint[] = [
  // Return around the outside perimeter, then descend north of the hill and
  // merge with the main bridge approach. This avoids crossing the hill legs or
  // the low final hairpin.
  { x: 14.5, z: -15.9 }, { x: 19.5, z: -15.9 }, { x: 19.5, z: 5.5 }, { x: 13.2, z: 4.7 },
];

export const HILL_DECK_WIDTH = 3.2;

function rampedLinkHeightAt(x: number, z: number, points: CoursePoint[], width: number, startY: number, endY: number, startFlatDistance = 0): number | null {
  const first = points[0], last = points[points.length - 1];
  if (Math.hypot(x - first.x, z - first.z) < 1e-6) return startY;
  if (Math.hypot(x - last.x, z - last.z) < 1e-6) return endY;
  const lengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    lengths.push(length);
    totalLength += length;
  }
  let closestDist = Infinity;
  let linkDistance = 0;
  let prefix = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const rawT = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
    // Ground support must follow the actual rendered segment footprint.
    // Clamping projections on interior segments creates invisible flat pads
    // before/after bends, which can hold the robot up beside the visible road.
    if (rawT < 0 || rawT > 1) {
      prefix += lengths[i];
      continue;
    }
    const t = Math.max(0, Math.min(1, rawT));
    const dist = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (dist < closestDist) {
      closestDist = dist;
      linkDistance = prefix + lengths[i] * t;
    }
    prefix += lengths[i];
  }
  if (closestDist > width / 2) return null;
  const u = Math.max(0, Math.min(1, (linkDistance - startFlatDistance) / (totalLength - startFlatDistance)));
  const eased = u * u * (3 - 2 * u);
  return startY + (endY - startY) * eased;
}

function supportsRoadAt(x: number, z: number, points: CoursePoint[], width: number): boolean {
  const halfWidth = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const rawT = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
    // Do not extend behind the first segment start or past the last segment end
    if (i === 0 && rawT < 0) continue;
    if (i === points.length - 2 && rawT > 1) continue;
    // On interior segments, allow corner fillet margin so turning nodes meet seamlessly without holes
    if (rawT < -0.20 || rawT > 1.20) continue;
    const t = Math.max(0, Math.min(1, rawT));
    if (Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)) <= halfWidth) return true;
  }
  return false;
}

/** Basic layout validation used by tests and the in-game route audit. */
export function validateDriveRoute(route: CoursePoint[] = DRIVE_ROUTE, minWidth = DRIVE_ROUTE_WIDTH) {
  const issues: string[] = [];
  if (route.length < 2) issues.push('Route needs at least two points');
  if (!(minWidth > 0)) issues.push('Route width must be positive');
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) issues.push(`Route point ${i} is not finite`);
    if (Math.abs(p.x) + minWidth / 2 > 24.0 || Math.abs(p.z) + minWidth / 2 > 17.5) {
      issues.push(`Route point ${i} exceeds the arena drive bounds`);
    }
    if (i > 0 && Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) < 0.15) {
      issues.push(`Route segment ${i - 1} is zero length`);
    }
  }
  const orient = (a: CoursePoint, b: CoursePoint, c: CoursePoint) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < route.length - 1; i++) {
    for (let j = i + 2; j < route.length - 1; j++) {
      const a = route[i], b = route[i + 1], c = route[j], d = route[j + 1];
      if (orient(a, b, c) * orient(a, b, d) < -1e-8 && orient(c, d, a) * orient(c, d, b) < -1e-8) {
        issues.push(`Route segments ${i} and ${j} cross each other`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

/** True only when the vehicle centre crosses a gate plane in its forward direction. */
export function crossesCheckpointGate(
  previous: CoursePoint,
  current: CoursePoint,
  gate: CheckpointGate,
  worldScale = MAP_SCALE,
  vehicleWidth = 1.98,
): boolean {
  const gx = gate.x * worldScale;
  const gz = gate.z * worldScale;
  const fx = Math.sin(gate.yaw);
  const fz = Math.cos(gate.yaw);
  const d0 = (previous.x - gx) * fx + (previous.z - gz) * fz;
  const d1 = (current.x - gx) * fx + (current.z - gz) * fz;
  if (!(d0 < 0 && d1 >= 0)) return false;

  const t = d0 / (d0 - d1);
  const crossX = previous.x + (current.x - previous.x) * t;
  const crossZ = previous.z + (current.z - previous.z) * t;
  const rx = Math.cos(gate.yaw);
  const rz = -Math.sin(gate.yaw);
  const lateral = Math.abs((crossX - gx) * rx + (crossZ - gz) * rz);
  const halfOpening = gate.width * worldScale * 0.5 - vehicleWidth * 0.5;
  return lateral <= halfOpening;
}

export type HillNode = {
  x: number;
  z: number;
  y: number;
};

export type HillSegment = {
  a: HillNode;
  b: HillNode;
  width: number;
};

export const SLALOM_BLOCKS = Array.from({ length: 5 }, (_, i) => {
  const side = i % 2 === 0 ? 'left' as const : 'right' as const;
  // Shorter walls preserve the alternating centre weave while leaving a broad
  // opening for the full track-cover envelope, not just the chassis centre.
  // Keep each brick wall substantial while preserving enough track-cover
  // clearance at the center weave. A short-lived overlap with the old 2.7 m
  // spans repeatedly caught the robot's outer tread before it could align.
  const span = DRIVE_ROUTE_WIDTH / 2 - 0.60;
  const sign = side === 'left' ? 1 : -1;
  const weaveLaneWidth = DRIVE_ROUTE_WIDTH;
  return {
  id: `slalom_block_${i}`,
  // 3.4 m pitch leaves a real transition window for the full robot footprint
  // to weave from one opening to the next. The previous 2.6 m pitch left less
  // than 0.7 m after wall clearance and caused edge rollovers.
  // Leave a full body-length to turn after Gate 01. The old 1.3 m gate-to-wall
  // approach forced a pivot with the robot's front corner already overlapping
  // the brick, making the chassis twist against the collision resolver.
  x: -16.3 + i * 3.40,
  side,
  z: 8.0 + sign * (weaveLaneWidth / 2 - span / 2),
  length: 0.62, // thickness along the direction of travel
  span, // solid wall section from the road edge just past its centre
  height: 1.05,
  };
});
export const SPEED_BREAKER_XS = [0, 1.05, 2.1] as const;

/** Checks that alternating slalom blocks leave enough width for the robot to weave through. */
export function validateSlalomClearance(
  blocks = SLALOM_BLOCKS,
  corridorWidth = DRIVE_ROUTE_WIDTH,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minimumOpening = ROBOT_HALF_WIDTH * 2 / MAP_SCALE + 0.45;
  const halfCorridor = corridorWidth / 2;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sign = block.side === 'left' ? 1 : -1;
    const innerEdge = block.z - sign * block.span / 2;
    // The open passage is the entire corridor from the far boundary to the
    // near edge of the staggered block. This is the space the robot actually
    // steers through, not the apparent gap between the block and centerline.
    const opening = block.side === 'left'
      ? innerEdge - (8.0 - halfCorridor)
      : (8.0 + halfCorridor) - innerEdge;
    if (opening < minimumOpening) {
      issues.push(`${block.id} leaves only ${opening.toFixed(2)}m-local clearance for a ${minimumOpening.toFixed(2)}m robot passage`);
    }
    if (block.span <= 0 || block.length <= 0 || block.height <= 0) issues.push(`${block.id} has invalid physical dimensions`);
    if (Math.abs(innerEdge - 8.0) > 0.65) issues.push(`${block.id} does not reach the centre weave zone`);
    if (i > 0) {
      const previous = blocks[i - 1];
      if (previous.side === block.side) issues.push(`${block.id} does not alternate sides`);
      if (previous.x + previous.length / 2 >= block.x - block.length / 2) issues.push(`${block.id} overlaps the previous hurdle`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// Switchback Hill Nodes with wide turning landings
export const HILL_NODES: HillNode[] = [
  // Shift the optional climbing branch away from the main course's disc and
  // return road. It stays inside the arena wall with a small, visible buffer.
  { x: 8.0, z: -4.5, y: ROUTE_DECK_HEIGHT },                 // Base entry at raised course elevation
  { x: 14.5, z: -4.5, y: ROUTE_HEIGHT_OFFSET + 1.50 },       // Leg 1 crest
  { x: 14.5, z: -8.3, y: ROUTE_HEIGHT_OFFSET + 1.50 },       // Landing 1
  { x: 8.0, z: -8.3, y: ROUTE_HEIGHT_OFFSET + 3.00 },        // Leg 2 crest
  { x: 8.0, z: -12.1, y: ROUTE_HEIGHT_OFFSET + 3.00 },       // Landing 2
  { x: 14.5, z: -12.1, y: ROUTE_HEIGHT_OFFSET + 4.50 },      // Leg 3 crest
  { x: 14.5, z: -15.9, y: ROUTE_HEIGHT_OFFSET + 4.50 },      // Summit landing
];

export const HILL_SEGMENTS: HillSegment[] = [];
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  HILL_SEGMENTS.push({
    a: HILL_NODES[i],
    b: HILL_NODES[i + 1],
    width: HILL_DECK_WIDTH, // broad vehicle envelope, separated from the main road
  });
}

/**
 * Height lookup for the switchback hill.
 */
export function hillHeightAt(x: number, z: number): number | null {
  // Square landing decks bridge the mitered path at every turn. Their spacing
  // is validated so shelves cannot overlap at different heights.
  for (const node of HILL_NODES) {
    if (Math.abs(x - node.x) <= HILL_DECK_WIDTH / 2 && Math.abs(z - node.z) <= HILL_DECK_WIDTH / 2) return node.y;
  }

  let closestDist = Infinity;
  let computedH: number | null = null;

  for (const seg of HILL_SEGMENTS) {
    const dx = seg.b.x - seg.a.x;
    const dz = seg.b.z - seg.a.z;
    const lenSq = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - seg.a.x) * dx + (z - seg.a.z) * dz) / lenSq));
    const px = seg.a.x + t * dx;
    const pz = seg.a.z + t * dz;
    const dist = Math.hypot(x - px, z - pz);

    // Keep the analytic ground support inside the rendered platform. Flatten
    // each turn shelf by half a deck width, then ease the incline between the
    // shelves. This makes adjacent switchbacks meet at one shared elevation.
    if (dist <= seg.width / 2 && dist < closestDist) {
      closestDist = dist;
      const length = Math.sqrt(lenSq);
      const flat = Math.min(seg.width / 2, length * 0.25);
      const inclineLength = Math.max(0.001, length - flat * 2);
      const u = Math.max(0, Math.min(1, (t * length - flat) / inclineLength));
      const eased = u * u * (3 - 2 * u);
      computedH = seg.a.y + (seg.b.y - seg.a.y) * eased;
    }
  }

  return computedH;
}

/**
 * Deterministic PRNG for stone field and obstacles.
 */
export function createDeterministicRNG(seed = 20261027) {
  let n = seed >>> 0;
  return () => {
    n += 0x6D2B79F5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StoneData = {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
};

/**
 * Generates stones bounded STRICTLY within designated rock field regions.
 */
export function generateRockFieldStones(seed = 20261027): StoneData[] {
  const rng = createDeterministicRNG(seed);
  const stones: StoneData[] = [];

  // Designated rock field bounds: x in [1.5, 4.5], z in [-1.2, 1.2]
  const count = 75;
  for (let i = 0; i < count; i++) {
    const x = 1.6 + rng() * 2.8;
    const z = -1.1 + rng() * 2.2;
    const sizeCategory = rng();
    let s = 0.08;
    if (sizeCategory > 0.7) {
      s = 0.18 + rng() * 0.08; // large
    } else if (sizeCategory > 0.35) {
      s = 0.12 + rng() * 0.05; // medium
    } else {
      s = 0.06 + rng() * 0.04; // small
    }

    stones.push({
      x,
      y: 0.04 + s * 0.35,
      z,
      scaleX: s * (0.8 + rng() * 0.4),
      scaleY: s * (0.6 + rng() * 0.5),
      scaleZ: s * (0.8 + rng() * 0.4),
      rotX: rng() * Math.PI,
      rotY: rng() * Math.PI * 2,
      rotZ: rng() * Math.PI,
    });
  }

  return stones;
}

export const ROCK_FIELD_STONES: StoneData[] = generateRockFieldStones(20261027);

/**
 * Evaluates the physical contact elevation profile of boulders in the rock field.
 * Returns smooth parabolic dome height above route deck level at (x, z).
 */
export function evaluateRockHeight(x: number, z: number): number {
  if (x < 1.45 || x > 4.55 || z < -1.25 || z > 1.25) return 0;
  let maxH = 0;
  for (let i = 0; i < ROCK_FIELD_STONES.length; i++) {
    const s = ROCK_FIELD_STONES[i];
    const rx = s.scaleX * 1.15;
    const rz = s.scaleZ * 1.15;
    const dx = (x - s.x) / rx;
    const dz = (z - s.z) / rz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1.0) {
      // Parabolic dome profile matching natural boulder curvature
      const h = (s.y + s.scaleY * 0.95) * (1 - d2);
      if (h > maxH) maxH = h;
    }
  }
  return maxH;
}

/**
 * Evaluates course ground height at unscaled world coordinates.
 */
export function evaluateCourseHeight(x: number, z: number): number {
  // Natural Rock Field obstacle at x in [1.45, 4.55], z in [-1.25, 1.25]
  // Physical boulder heights create real roll tilt, pitch rise, and asymmetric drag yaw twist
  if (x >= 1.45 && x <= 4.55 && Math.abs(z) <= 1.25) {
    const rockH = evaluateRockHeight(x, z);
    return ROUTE_DECK_HEIGHT + rockH;
  }

  // The entrance is a real ramp from the arena floor to the one-metre-raised
  // race deck. The lower start approach leads to the ramp toe and gantry.
  if (Math.abs(z - 8.0) <= DRIVE_ROUTE_WIDTH / 2 && x >= -20.6 && x <= -19.2) {
    // A short, steep 35.5-degree opening climb reaches the raised deck, then
    // holds level to the start gate.
    const t = Math.max(0, Math.min(1, (x + 20.6) / 1.4));
    return ARENA_FLOOR_HEIGHT + (ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT) * t;
  }

  // Check switchback hill
  const hHill = hillHeightAt(x, z);
  if (hHill !== null) return hHill;

  // The summit return is a real descending road deck. Interpolate its
  // elevation over the connector length so the visuals and ground contact
  // share one continuous ramp rather than snapping to the arena floor.
  const hillExitHeight = rampedLinkHeightAt(x, z, HILL_EXIT_LINK, HILL_DECK_WIDTH, ROUTE_HEIGHT_OFFSET + 4.5, ROUTE_DECK_HEIGHT, 11.0);
  if (hillExitHeight !== null) return hillExitHeight;

  // Rotating industrial turntable platform at x = 10.65, z = 0.1
  // Monolithic level platter (flush with road deck) with smooth perimeter bevel
  const discR = Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z);
  if (discR <= TURNTABLE_RADIUS + 0.08) {
    if (discR > TURNTABLE_RADIUS - 0.14) {
      const t = (discR - (TURNTABLE_RADIUS - 0.14)) / 0.22;
      return (ROUTE_DECK_HEIGHT + 0.04) * (1 - t) + ROUTE_DECK_HEIGHT * t;
    }
    return ROUTE_DECK_HEIGHT + 0.04;
  }

  // Curved timber ramp at x = 4.8, z = 8.0 (smooth 40° peak slope, 0.88m crest)
  if (Math.abs(z - 8.0) <= DRIVE_ROUTE_WIDTH / 2 && x >= 3.3 && x <= 6.3) {
    const t = (x - 3.3) / 3.0;
    const u = t <= 0.5 ? t * 2 : (1 - t) * 2;
    const smoothCurve = u * u * (3 - 2 * u);
    return ROUTE_DECK_HEIGHT + 0.85 * smoothCurve;
  }

  // Raised bridge ramps and deck at z = 8.0 (x = 7.8 to 11.4, bridge deck at 9.6, height = 0.62)
  if (Math.abs(z - 8.0) <= DRIVE_ROUTE_WIDTH / 2 && x >= 7.0 && x <= 12.2) {
    const tAscent = Math.max(0, Math.min(1, (x - 7.0) / 1.6));
    const tDescent = Math.max(0, Math.min(1, (12.2 - x) / 1.6));
    return ROUTE_DECK_HEIGHT + 0.59 * Math.min(tAscent, tDescent);
  }

  // Speed breakers at x = 0.0, 1.05, 2.1 at z = 8.0, after the slalom.
  if (Math.abs(z - 8.0) < 1.85) {
    let bump = 0;
    for (const bx of SPEED_BREAKER_XS) {
      const d = Math.abs(x - bx);
      if (d < 0.45) {
        bump = Math.max(bump, ROUTE_DECK_HEIGHT + 0.09 * Math.cos((d / 0.45) * Math.PI * 0.5) ** 2);
      }
    }
    if (bump > 0) return bump;
  }

  // Parallel plank bridge centered on the actual route; world-space spacing
  // matches the robot's track centre spacing after course scaling.
  // Smooth approach and exit transition bevels ensure the robot climbs and descends cleanly.
  if (x >= -9.8 && x <= -4.9) {
    const onLeftPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[0].z) < 0.38;
    const onRightPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[1].z) < 0.38;
    if (onLeftPlank || onRightPlank) {
      if (x > -5.3) {
        // Entry wedge ramp from x = -4.9 to -5.3
        const t = (x + 4.9) / (-5.3 + 4.9);
        return ROUTE_DECK_HEIGHT + 0.27 * Math.max(0, Math.min(1, t));
      }
      if (x < -9.4) {
        // Exit wedge ramp from x = -9.4 to -9.8
        const t = (x + 9.8) / (-9.4 + 9.8);
        return ROUTE_DECK_HEIGHT + 0.27 * Math.max(0, Math.min(1, t));
      }
      return ROUTE_DECK_HEIGHT + 0.27;
    }
  }

  // ---------------------------------------------------------------------------
  // 45-DEGREE DESCENT RAMP: From elevated rock field exit to ground-level hazards
  // ---------------------------------------------------------------------------
  // Connects the high-elevation viaduct (ROUTE_DECK_HEIGHT) to the arena floor (ARENA_FLOOR_HEIGHT).
  // Real physics (gravity acceleration, pitch tilt, normal traction) applies on this steep slope.
  {
    // Direction vector from rock field exit (1.4, 0.0) to fire approach (-1.8, -4.0)
    const ax = 1.4, az = 0.0;
    const bx = -1.8, bz = -4.0;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const s = (x - ax) * ux + (z - az) * uz;
    const dLat = Math.abs((x - ax) * (-uz) + (z - az) * ux);

    if (dLat <= DRIVE_ROUTE_WIDTH / 2) {
      if (s >= 1.40 && s <= 2.45) {
        // 45-degree descent ramp zone (length 1.05m, vertical drop 1.00m => ~45 degree peak grade)
        const u = (s - 1.40) / 1.05;
        const eased = u * u * (3 - 2 * u);
        return ROUTE_DECK_HEIGHT + (ARENA_FLOOR_HEIGHT - ROUTE_DECK_HEIGHT) * eased;
      }
      if (s > 2.45 && x > -1.8) {
        // Bottom landing before fire zone on ground
        return ARENA_FLOOR_HEIGHT;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // GROUND-LEVEL HAZARDS: Fire zone & Water basket touching the arena floor
  // ---------------------------------------------------------------------------
  // 1. Fire Zone on the ground: x in [-3.8, -1.8], z in [-4.0 - width/2, -4.0 + width/2]
  if (x >= -3.8 && x <= -1.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return ARENA_FLOOR_HEIGHT + 0.02;
  }

  // 2. Water Basket on the ground: x in [-5.8, -3.8], z in [-4.0 - width/2, -4.0 + width/2]
  // Deep 0.5m industrial containment basket touching the ground bed; robot tracks roll firmly on floor
  if (x >= -5.8 && x <= -3.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return ARENA_FLOOR_HEIGHT + 0.02;
  }

  // 3. Exit Climb Ramp out of Water Basket: x in [-7.0, -5.8]
  // Climbs from ground-level water bed up to elevated viaduct deck (ROUTE_DECK_HEIGHT)
  if (x >= -7.0 && x < -5.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    const u = Math.max(0, Math.min(1, (-5.8 - x) / 1.20));
    const eased = u * u * (3 - 2 * u);
    return (ARENA_FLOOR_HEIGHT + 0.02) + (ROUTE_DECK_HEIGHT - (ARENA_FLOOR_HEIGHT + 0.02)) * eased;
  }

  // Sand / Marble pit recess at x in [11.9, 15.0], z in [2.9, 6.2]
  if (x >= 11.9 && x <= 15.0 && z >= 2.9 && z <= 6.2) {
    return ROUTE_DECK_HEIGHT + 0.02;
  }

  // Oil is a very thin surface treatment, not a floating physics layer.
  if (x >= -10.5 && x <= -8.0 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return ROUTE_DECK_HEIGHT + 0.02;
  }

  // Continuous solid turning apron connecting bridge descent (Checkpoint 5)
  // to marble pit (Checkpoint 6) and rotating disc platform (Checkpoint 7).
  // Prevents inside-apex wheel drops and vehicle rollover.
  if (x >= 9.8 && x <= 14.2 && z >= -0.2 && z <= 8.2) {
    return ROUTE_DECK_HEIGHT;
  }

  // West Hairpin Plaza (connecting oil hazard lane to parallel planks)
  // Seamless solid turning deck preventing wheel drops and rollover.
  if (x >= -18.0 && x <= -10.5 && z >= -10.5 && z <= -1.5) {
    return ROUTE_DECK_HEIGHT;
  }

  // East Hairpin Plaza (connecting parallel planks to finish straight)
  // Seamless solid turning deck preventing wheel drops and rollover.
  if (x >= -2.5 && x <= 4.5 && z >= -14.5 && z <= -5.5) {
    return ROUTE_DECK_HEIGHT;
  }

  // The road is an elevated supported deck; leaving its boundaries drops the
  // robot to the lower arena floor instead of keeping it on an invisible plane.
  if (supportsRoadAt(x, z, DRIVE_ROUTE, DRIVE_ROUTE_WIDTH)
    || supportsRoadAt(x, z, HILL_ENTRY_LINK, HILL_DECK_WIDTH)
    || supportsRoadAt(x, z, HILL_EXIT_LINK, HILL_DECK_WIDTH)) return ROUTE_DECK_HEIGHT;

  return ARENA_FLOOR_HEIGHT;
}

/**
 * Returns surface properties including traction, rolling resistance, and hazard triggers.
 */
export function evaluateCourseSurface(x: number, z: number): SurfaceProperties {
  // Switchback hill (timber incline)
  if (hillHeightAt(x, z) !== null) {
    return { grip: 0.84, rollingResistance: 0.48, hazard: 'none' };
  }

  // Mandatory Environmental Hazard Sequence: Fire -> Transition -> Water -> Oil
  // 1. Fire Zone: x in [-3.8, -1.8], z in [-4.8, -3.2]
  if (x >= -3.8 && x <= -1.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return { grip: 0.90, rollingResistance: 0.35, hazard: 'fire' };
  }

  // 2. Water Zone: immediately after the fire, spanning the full driving lane.
  if (x >= -5.8 && x <= -3.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return { grip: 0.58, rollingResistance: 0.65, hazard: 'water' };
  }

  if (x >= -7.95 && x <= -6.05 && Math.abs(z - (-4.0)) <= 1.2) {
    return { grip: 0.82, rollingResistance: 0.52, hazard: 'none' };
  }

  // 3. Oil Slicks: x in [-10.5, -8.0], z in [-4.8, -3.2]
  if (x >= -10.5 && x <= -8.0 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return { grip: 0.18, rollingResistance: 0.12, hazard: 'oil' };
  }

  // Ice / Polished sheet
  if (x >= -5.5 && x <= -0.7 && Math.abs(z + 4.05) < 1.45) {
    return { grip: 0.22, rollingResistance: 0.15, hazard: 'none' };
  }

  // Sand / Marble pit
  if (x >= 11.7 && x <= 15.2 && z >= 2.75 && z <= 6.4) {
    return { grip: 0.45, rollingResistance: 1.85, hazard: 'none' };
  }

  // Rotating mechanical turntable disc (high-traction steel diamond plate)
  if (Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z) <= TURNTABLE_RADIUS) {
    return { grip: 0.92, rollingResistance: 0.35, hazard: 'none' };
  }

  // Mixed terrain stretch at z ~ 0
  if (Math.abs(z) < 1.5) {
    if (x > 4.0 && x < 6.5) return { grip: 0.42, rollingResistance: 2.1, hazard: 'none' }; // Sand
    if (x > 1.55 && x <= 4.0) return { grip: 0.64, rollingResistance: 1.4, hazard: 'none' }; // Gravel / Rock
    if (x > -0.9 && x <= 1.55) return { grip: 0.82, rollingResistance: 0.7, hazard: 'none' }; // Turf
    if (x >= -3.35 && x <= -0.9) return { grip: 1.15, rollingResistance: 0.4, hazard: 'none' }; // Rubber mat
  }

  // Ramp and bridge timber
  if (Math.abs(z - 8.0) < 1.45 && x >= 3.1 && x <= 12.4) {
    return { grip: 0.88, rollingResistance: 0.40, hazard: 'none' };
  }

  // Default clean arena concrete floor
  return { grip: 1.05, rollingResistance: 0.30, hazard: 'none' };
}

/**
 * 11 Ordered Checkpoints along the primary racing route.
 */
export const CHECKPOINTS: CheckpointGate[] = [
  // Put the first gate on the end of the start climb, leaving a full approach
  // shelf between the gate and the first brick wall for the robot to align.
  { id: 1, label: 'Gate 01 - Start Straight', x: -19.2, z: 8.0, yaw: Math.PI / 2, width: 6.4 },
  // Placed just beyond the final staggered barrier so the vehicle can fully
  // clear the slalom before the checkpoint trigger is considered passed.
  { id: 2, label: 'Gate 02 - Slalom Exit', x: -0.2, z: 8.0, yaw: Math.PI / 2, width: 6.4 },
  { id: 3, label: 'Gate 03 - Breakers Clear', x: 3.2, z: 8.0, yaw: Math.PI / 2, width: 6.4 },
  { id: 4, label: 'Gate 04 - Ramp Approach', x: 4.4, z: 8.0, yaw: Math.PI / 2, width: 6.4 },
  { id: 5, label: 'Gate 05 - Bridge Crest', x: 9.6, z: 8.0, yaw: Math.PI / 2, width: 6.4 },
  { id: 6, label: 'Gate 06 - Marble Pit Turn', x: 13.2, z: 4.7, yaw: Math.atan2(1.5, -4.5), width: 7.0 },
  { id: 7, label: 'Gate 07 - Rotating Platform', x: 10.65, z: 0.1, yaw: -Math.PI / 2, width: 7.2 },
  { id: 8, label: 'Gate 08 - Mixed Terrain', x: 1.4, z: 0.0, yaw: -Math.PI / 2, width: 6.4 },
  { id: 9, label: 'Gate 09 - Hazard Sequence', x: -3.1, z: -4.0, yaw: -Math.PI / 2, width: 6.4 },
  { id: 10, label: 'Gate 10 - Hairpin Complex', x: -7.5, z: -8.0, yaw: Math.PI / 2, width: 6.4 },
  { id: 11, label: 'Gate 11 - Final Straight', x: -13.2, z: -12.0, yaw: -Math.PI / 2, width: 6.4 },
];

/**
 * Audits corridor clearance: ensures no barriers obstruct the driving route.
 */
export function validateRouteClearance(colliders: CourseCollider[], robotWidth = 1.9): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const cp of CHECKPOINTS) {
    const cpX = cp.x * MAP_SCALE;
    const cpZ = cp.z * MAP_SCALE;

    for (const c of colliders) {
      if (c.walkable) continue;
      const dx = cpX - c.x * MAP_SCALE;
      const dz = cpZ - c.z * MAP_SCALE;
      const dist = Math.hypot(dx, dz);

      // Gate clearance radius
      if (dist < (robotWidth * 0.5 + 0.3) * MAP_SCALE) {
        issues.push(`Collider "${c.id}" intrudes on checkpoint ${cp.label} at distance ${dist.toFixed(2)}m`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
