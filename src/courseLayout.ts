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

/** Route centreline in course-local metres. The road is built from this path
 * before obstacle modules are placed, so every section has a continuous base. */
// A wider driving envelope keeps the robot's full track covers clear while
// leaving room to steer around the slalom blocks instead of striking their ends.
export const DRIVE_ROUTE_WIDTH = 4.0;
export const ARENA_FLOOR_HEIGHT = -0.33;
export const ROUTE_DECK_HEIGHT = 0.03;
function circularArc(cx: number, cz: number, radius: number, start: number, end: number, count: number, xAxis = 'cos') {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count;
    return xAxis === 'sin'
      ? { x: cx + radius * Math.sin(a), z: cz + radius * Math.cos(a) }
      : { x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) };
  });
}
export const DRIVE_ROUTE: CoursePoint[] = [
  { x: -16.4, z: 8.0 }, // clear staging bay behind the start gantry
  { x: -14.2, z: 8.0 }, // start line
  { x: -11.5, z: 8.0 },
  { x: -0.2, z: 8.0 }, // straight corridor; the staggered barriers create the slalom
  { x: 3.2, z: 8.0 },  // breakers
  { x: 4.4, z: 8.0 },  // ramp checkpoint
  { x: 4.8, z: 8.0 },  // curved ramp
  { x: 9.6, z: 8.0 },  // raised bridge
  { x: 13.2, z: 4.7 }, // marble pit approach
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
  { x: 10.65, z: 0.1 }, { x: 9.8, z: -0.55 }, { x: 8.9, z: -1.35 }, { x: 8.0, z: -2.0 },
];
export const HILL_EXIT_LINK: CoursePoint[] = [
  // Leave the summit landing beyond its edge before descending, so this
  // connector cannot overlap the climbing deck at a conflicting elevation.
  { x: 8.0, z: -13.4 }, { x: 5.8, z: -13.4 }, { x: 3.2, z: -11.5 }, { x: 1.0, z: -10.0 }, { x: -0.4, z: -8.8 }, { x: -0.2, z: -8.0 },
];

function rampedLinkHeightAt(x: number, z: number, points: CoursePoint[], width: number, startY: number, endY: number, startFlatDistance = 0): number | null {
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
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq));
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
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq));
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
    if (Math.abs(p.x) + minWidth / 2 > 19.5 || Math.abs(p.z) + minWidth / 2 > 15.5) {
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

export const SLALOM_BARRIERS = Array.from({ length: 5 }, (_, i) => ({
  id: `slalom_barrier_${i}`,
  x: -10.4 + i * 2.25,
  z: 8.0 + (i % 2 === 0 ? 1.72 : -1.72),
  width: 0.34,
  depth: 0.82,
  height: 0.92,
}));
export const SPEED_BREAKER_XS = [0, 1.05, 2.1] as const;

/** Checks that every staggered slalom barrier leaves a robot-width opening. */
export function validateSlalomClearance(
  barriers = SLALOM_BARRIERS,
  corridorWidth = DRIVE_ROUTE_WIDTH,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minimumOpening = ROBOT_HALF_WIDTH * 2 / MAP_SCALE + 0.45;
  const minimumCenterlineGap = 0.25;
  const halfCorridor = corridorWidth / 2;
  for (const barrier of barriers) {
    const sign = Math.sign(barrier.z - 8.0) || 1;
    const innerEdge = barrier.z - sign * barrier.depth / 2;
    // The open passage is the entire corridor from the far boundary to the
    // near edge of the staggered block. This is the space the robot actually
    // steers through, not the apparent gap between the block and centerline.
    const opening = halfCorridor + Math.abs(innerEdge - 8.0);
    if (opening < minimumOpening) {
      issues.push(`${barrier.id} leaves only ${opening.toFixed(2)}m-local clearance for a ${minimumOpening.toFixed(2)}m robot passage`);
    }
    const centerlineGap = Math.abs(innerEdge - 8.0) * MAP_SCALE - ROBOT_HALF_WIDTH;
    if (centerlineGap < minimumCenterlineGap) {
      issues.push(`${barrier.id} intrudes ${Math.max(0, -centerlineGap).toFixed(2)}m into the robot's straight-route envelope`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// Switchback Hill Nodes with wide turning landings
export const HILL_NODES: HillNode[] = [
  { x: 8.0, z: -2.0, y: 0.03 },    // Base entry
  { x: 14.5, z: -2.0, y: 1.50 },   // Leg 1 crest
  { x: 14.5, z: -5.8, y: 1.50 },   // Landing 1 (3.8m shelf, no platform overlap)
  { x: 8.0, z: -5.8, y: 3.00 },    // Leg 2 crest
  { x: 8.0, z: -9.6, y: 3.00 },    // Landing 2
  { x: 14.5, z: -9.6, y: 4.50 },   // Leg 3 crest
  { x: 14.5, z: -13.4, y: 4.50 },  // Summit landing
  { x: 8.0, z: -13.4, y: 3.00 },   // Descending switchback leg
];

export const HILL_SEGMENTS: HillSegment[] = [];
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  HILL_SEGMENTS.push({
    a: HILL_NODES[i],
    b: HILL_NODES[i + 1],
    width: 3.4, // matches the rendered deck and leaves a wide, measurable vehicle envelope
  });
}

/**
 * Height lookup for the switchback hill.
 */
export function hillHeightAt(x: number, z: number): number | null {
  // Square landing decks bridge the mitered path at every turn. Their spacing
  // is validated so shelves cannot overlap at different heights.
  for (const node of HILL_NODES) {
    if (Math.abs(x - node.x) <= 1.7 && Math.abs(z - node.z) <= 1.7) return node.y;
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

/**
 * Evaluates course ground height at unscaled world coordinates.
 */
export function evaluateCourseHeight(x: number, z: number): number {
  // Check switchback hill
  const hHill = hillHeightAt(x, z);
  if (hHill !== null) return hHill;

  // The summit return is a real descending road deck. Interpolate its
  // elevation over the connector length so the visuals and ground contact
  // share one continuous ramp rather than snapping to the arena floor.
  const hillExitHeight = rampedLinkHeightAt(x, z, HILL_EXIT_LINK, 3.4, 3.0, ROUTE_DECK_HEIGHT, 1.9);
  if (hillExitHeight !== null) return hillExitHeight;

  // Rotating disc platform at x = 10.65, z = 0.1
  const discR = Math.hypot(x - 10.65, z - 0.1);
  if (discR < 1.35) {
    const t = Math.max(0, Math.min(1, (discR - 1.0) / 0.35));
    return 0.28 * (1 - t * t * (3 - 2 * t));
  }

  // Curved timber ramp at x = 4.8, z = 8.0 (smooth 40° peak slope, 0.88m crest)
  if (Math.abs(z - 8.0) <= DRIVE_ROUTE_WIDTH / 2 && x >= 3.3 && x <= 6.3) {
    const t = (x - 3.3) / 3.0;
    const u = t <= 0.5 ? t * 2 : (1 - t) * 2;
    const smoothCurve = u * u * (3 - 2 * u);
    return 0.03 + 0.85 * smoothCurve;
  }

  // Raised bridge ramps and deck at z = 8.0 (x = 7.8 to 11.4, bridge deck at 9.6, height = 0.62)
  if (Math.abs(z - 8.0) <= DRIVE_ROUTE_WIDTH / 2 && x >= 7.0 && x <= 12.2) {
    const tAscent = Math.max(0, Math.min(1, (x - 7.0) / 1.6));
    const tDescent = Math.max(0, Math.min(1, (12.2 - x) / 1.6));
    return 0.03 + 0.59 * Math.min(tAscent, tDescent);
  }

  // Speed breakers at x = 0.0, 1.05, 2.1 at z = 8.0, after the slalom.
  if (Math.abs(z - 8.0) < 1.85) {
    let bump = 0;
    for (const bx of SPEED_BREAKER_XS) {
      const d = Math.abs(x - bx);
      if (d < 0.45) {
        bump = Math.max(bump, 0.03 + 0.09 * Math.cos((d / 0.45) * Math.PI * 0.5) ** 2);
      }
    }
    if (bump > 0) return bump;
  }

  // Parallel plank bridge centered on the actual route; world-space spacing
  // matches the robot's track centre spacing after course scaling.
  if (x >= -9.4 && x <= -5.3) {
    const onLeftPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[0].z) < 0.38;
    const onRightPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[1].z) < 0.38;
    if (onLeftPlank || onRightPlank) {
      return 0.30;
    }
  }

  // Short ramp-to-plank-to-ramp crossing before the oil patch.
  if (Math.abs(z - (-4.0)) <= 1.2 && x >= -7.95 && x <= -6.05) {
    if (x < -7.7) return 0.03 + 0.19 * ((x + 7.95) / 0.25);
    if (x > -6.3) return 0.22 - 0.19 * ((x + 6.3) / 0.25);
    return 0.22;
  }

  // Sand / Marble pit recess at x in [11.9, 15.0], z in [2.9, 6.2]
  if (x >= 11.9 && x <= 15.0 && z >= 2.9 && z <= 6.2) {
    return 0.08;
  }

  // Deep enough for the tracks to enter the immediately following water basin.
  if (x >= -5.8 && x <= -3.8 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return -0.12;
  }

  // Oil is a very thin surface treatment, not a floating physics layer.
  if (x >= -10.5 && x <= -8.0 && Math.abs(z - (-4.0)) < DRIVE_ROUTE_WIDTH / 2) {
    return 0.05;
  }

  // The road is an elevated supported deck; leaving its boundaries drops the
  // robot to the lower arena floor instead of keeping it on an invisible plane.
  if (supportsRoadAt(x, z, DRIVE_ROUTE, DRIVE_ROUTE_WIDTH)
    || supportsRoadAt(x, z, HILL_ENTRY_LINK, 3.4)
    || supportsRoadAt(x, z, HILL_EXIT_LINK, 3.4)) return ROUTE_DECK_HEIGHT;

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

  // Rotating disc
  if (Math.hypot(x - 10.65, z - 0.1) < 1.35) {
    return { grip: 0.82, rollingResistance: 0.42, hazard: 'none' };
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
  { id: 1, label: 'Gate 01 - Start Straight', x: -11.5, z: 8.0, yaw: Math.PI / 2, width: 4.4 },
  // Placed just beyond the final staggered barrier so the vehicle can fully
  // clear the slalom before the checkpoint trigger is considered passed.
  { id: 2, label: 'Gate 02 - Slalom Exit', x: -0.2, z: 8.0, yaw: Math.PI / 2, width: 4.4 },
  { id: 3, label: 'Gate 03 - Breakers Clear', x: 3.2, z: 8.0, yaw: Math.PI / 2, width: 4.4 },
  { id: 4, label: 'Gate 04 - Ramp Approach', x: 4.4, z: 8.0, yaw: Math.PI / 2, width: 4.4 },
  { id: 5, label: 'Gate 05 - Bridge Crest', x: 9.6, z: 8.0, yaw: Math.PI / 2, width: 4.4 },
  { id: 6, label: 'Gate 06 - Marble Pit Turn', x: 13.2, z: 4.7, yaw: Math.atan2(3.6, -3.3), width: 4.4 },
  { id: 7, label: 'Gate 07 - Rotating Platform', x: 10.65, z: 0.1, yaw: Math.atan2(-2.55, -4.6), width: 4.4 },
  { id: 8, label: 'Gate 08 - Mixed Terrain', x: 1.4, z: 0.0, yaw: -Math.PI / 2, width: 4.4 },
  { id: 9, label: 'Gate 09 - Hazard Sequence', x: -3.1, z: -4.0, yaw: Math.atan2(-4.5, -4.0), width: 4.4 },
  { id: 10, label: 'Gate 10 - Hairpin Complex', x: -7.5, z: -8.0, yaw: Math.PI / 2, width: 4.4 },
  { id: 11, label: 'Gate 11 - Final Straight', x: -13.2, z: -12.0, yaw: -Math.PI / 2, width: 4.4 },
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
