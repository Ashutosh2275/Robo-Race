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

// Lane 4 at z = -6.75
export const PARALLEL_PLANK_CENTER_Z = -6.75;
export const PARALLEL_PLANK_SPACING_LOCAL = TRACK_WIDTH / MAP_SCALE;
export const PARALLEL_PLANK_CENTERS = [
  { x: -3.5, z: PARALLEL_PLANK_CENTER_Z - PARALLEL_PLANK_SPACING_LOCAL / 2 },
  { x: -3.5, z: PARALLEL_PLANK_CENTER_Z + PARALLEL_PLANK_SPACING_LOCAL / 2 },
] as const;

// Lane 3 at z = 0.00
export const TURNTABLE_CENTER = { x: -4.0, z: 0.00 } as const;
export const TURNTABLE_RADIUS = 2.45; // 4.90m diameter, >3.2x robot width

/** Road width in course-local metres: 4.40m gives 2.89x robot clearance in world space */
export const DRIVE_ROUTE_WIDTH = 4.40;
export const ARENA_FLOOR_HEIGHT = -0.33;
export const ROUTE_CLEARANCE_HEIGHT = 1.0;
export const ROUTE_DECK_HEIGHT = ARENA_FLOOR_HEIGHT + ROUTE_CLEARANCE_HEIGHT; // 0.67m
export const ROUTE_HEIGHT_OFFSET = ROUTE_DECK_HEIGHT - 0.03;

function circularArc(cx: number, cz: number, radius: number, start: number, end: number, count: number): CoursePoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count;
    return { x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) };
  });
}

/** Complete 5-lane continuous full-map robotic racing circuit */
export const DRIVE_ROUTE: CoursePoint[] = [
  // Lane 1: South Straight (Z = 13.50, Eastbound)
  { x: -20.5, z: 13.50 }, // Starting Bay on arena floor
  { x: -19.5, z: 13.50 }, // Entry ramp toe
  { x: -17.5, z: 13.50 }, // Gate 01 - Start Straight
  { x: -15.0, z: 13.50 }, // Slalom hurdle 0
  { x: -11.5, z: 13.50 }, // Slalom hurdle 1
  { x: -8.0, z: 13.50 },  // Slalom hurdle 2
  { x: -4.5, z: 13.50 },  // Slalom hurdle 3
  { x: -1.0, z: 13.50 },  // Slalom hurdle 4
  { x: 1.2, z: 13.50 },   // Speed breaker 1
  { x: 2.2, z: 13.50 },   // Speed breaker 2
  { x: 3.2, z: 13.50 },   // Speed breaker 3
  { x: 4.2, z: 13.50 },   // Gate 02 - Slalom Exit
  { x: 6.0, z: 13.50 },   // Gate 03 - Rock Field Entrance
  { x: 10.25, z: 13.50 }, // Rock Field center
  { x: 14.5, z: 13.50 },  // Rock Field exit
  { x: 17.5, z: 13.50 },  // Lane 1 exit to Hairpin 1

  // Hairpin 1: Semicircular Viaduct (connecting Lane 1 to Lane 2 around cx=17.50, cz=10.125, R=3.375)
  ...circularArc(17.50, 10.125, 3.375, Math.PI / 2, -Math.PI / 2, 12).slice(1),

  // Lane 2: Mid-South Straight (Z = 6.75, Westbound)
  { x: 14.5, z: 6.75 },   // Approach to climbing slope
  { x: 11.5, z: 6.75 },   // Gate 04 - Hill Summit
  { x: 9.5, z: 6.75 },    // Summit crest shelf
  { x: 6.5, z: 6.75 },    // Descent ramp to fire platform
  { x: 4.5, z: 6.75 },    // Gate 05 - Fire Hazard
  { x: 2.5, z: 6.75 },    // Fire exit / cooling bridge
  { x: 1.5, z: 6.75 },    // Water basin entry ramp
  { x: 0.0, z: 6.75 },    // Water basin pool floor start
  { x: -3.5, z: 6.75 },   // Gate 06 - Deep Water Basin
  { x: -7.5, z: 6.75 },   // Water pool floor end / exit ramp
  { x: -9.5, z: 6.75 },   // Water exit landing
  { x: -12.0, z: 6.75 },  // Slippery steel sheet
  { x: -17.5, z: 6.75 },  // Lane 2 exit to Hairpin 2

  // Hairpin 2: Semicircular Viaduct (connecting Lane 2 to Lane 3 around cx=-17.50, cz=3.375, R=3.375)
  ...circularArc(-17.50, 3.375, 3.375, Math.PI / 2, Math.PI * 1.5, 12).slice(1),

  // Lane 3: Center Straight (Z = 0.00, Eastbound)
  { x: -12.0, z: 0.00 },  // Approach to oil pad
  { x: -10.0, z: 0.00 },  // Oil skid pad
  { x: -6.5, z: 0.00 },   // Turntable entry apron
  { x: -4.0, z: 0.00 },   // Gate 07 - Rotating Platform
  { x: -1.5, z: 0.00 },   // Turntable exit apron
  { x: 1.0, z: 0.00 },    // Gravel stretch
  { x: 4.0, z: 0.00 },    // Marble pit entrance
  { x: 6.0, z: 0.00 },    // Gate 08 - Mixed Terrain
  { x: 8.5, z: 0.00 },    // Marble pit exit
  { x: 10.5, z: 0.00 },   // Synthetic turf stretch
  { x: 13.0, z: 0.00 },   // Textured rubber stretch
  { x: 17.5, z: 0.00 },   // Lane 3 exit to Hairpin 3

  // Hairpin 3: Semicircular Viaduct (connecting Lane 3 to Lane 4 around cx=17.50, cz=-3.375, R=3.375)
  ...circularArc(17.50, -3.375, 3.375, Math.PI / 2, -Math.PI / 2, 12).slice(1),

  // Lane 4: Mid-North Straight (Z = -6.75, Westbound)
  { x: 14.5, z: -6.75 },  // Approach to steel arch bridge
  { x: 10.5, z: -6.75 },  // Gate 09 - Arch Bridge
  { x: 6.5, z: -6.75 },   // Bridge exit
  { x: 3.5, z: -6.75 },   // Stepping platforms
  { x: 0.5, z: -6.75 },   // Approach to parallel planks
  { x: -3.5, z: -6.75 },  // Gate 10 - Parallel Planks
  { x: -7.5, z: -6.75 },  // Parallel planks exit
  { x: -17.5, z: -6.75 }, // Lane 4 exit to Hairpin 4

  // Hairpin 4: Semicircular Viaduct (connecting Lane 4 to Lane 5 around cx=-17.50, cz=-10.125, R=3.375)
  ...circularArc(-17.50, -10.125, 3.375, Math.PI / 2, Math.PI * 1.5, 12).slice(1),

  // Lane 5: North Finishing Straight (Z = -13.50, Eastbound)
  { x: -12.0, z: -13.50 }, // Lane 5 approach
  { x: -6.0, z: -13.50 },  // Precision technical chicanes
  { x: 0.0, z: -13.50 },   // Chicane exit / acceleration straight
  { x: 6.0, z: -13.50 },   // High speed straightaway
  { x: 12.0, z: -13.50 },  // Gate 11 - Grand Finish
  { x: 16.0, z: -13.50 },  // Deceleration run-off end
];

export const HILL_DECK_WIDTH = 4.40;
export const HILL_ENTRY_LINK: CoursePoint[] = [{ x: 14.5, z: 6.75 }, { x: 11.5, z: 6.75 }];
export const HILL_EXIT_LINK: CoursePoint[] = [{ x: 9.5, z: 6.75 }, { x: 6.5, z: 6.75 }];

function supportsRoadAt(x: number, z: number, points: CoursePoint[], width: number): boolean {
  const halfWidth = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const rawT = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
    if (i === 0 && rawT < 0) continue;
    if (i === points.length - 2 && rawT > 1) continue;
    if (rawT < -0.15 || rawT > 1.15) continue;
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
  const span = 1.60;
  const sign = side === 'left' ? 1 : -1;
  const laneZ = 13.50;
  return {
    id: `slalom_block_${i}`,
    x: -15.0 + i * 3.50,
    side,
    z: laneZ + sign * (DRIVE_ROUTE_WIDTH / 2 - span / 2),
    length: 0.62,
    span,
    height: 1.05,
  };
});

export const SPEED_BREAKER_XS = [1.2, 2.2, 3.2] as const;

/** Checks that alternating slalom blocks leave enough width for the robot to weave through. */
export function validateSlalomClearance(
  blocks = SLALOM_BLOCKS,
  corridorWidth = DRIVE_ROUTE_WIDTH,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minimumOpening = ROBOT_HALF_WIDTH * 2 / MAP_SCALE + 0.45;
  const halfCorridor = corridorWidth / 2;
  const laneZ = 13.50;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sign = block.side === 'left' ? 1 : -1;
    const innerEdge = block.z - sign * block.span / 2;
    const opening = block.side === 'left'
      ? innerEdge - (laneZ - halfCorridor)
      : (laneZ + halfCorridor) - innerEdge;
    if (opening < minimumOpening) {
      issues.push(`${block.id} leaves only ${opening.toFixed(2)}m-local clearance for a ${minimumOpening.toFixed(2)}m robot passage`);
    }
    if (block.span <= 0 || block.length <= 0 || block.height <= 0) issues.push(`${block.id} has invalid physical dimensions`);
    if (i > 0) {
      const previous = blocks[i - 1];
      if (previous.side === block.side) issues.push(`${block.id} does not alternate sides`);
      if (previous.x + previous.length / 2 >= block.x - block.length / 2) issues.push(`${block.id} overlaps the previous hurdle`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// Section 4 Climbing Hill Nodes on Lane 2 (z = 6.75)
export const HILL_NODES: HillNode[] = [
  { x: 14.5, z: 6.75, y: ROUTE_DECK_HEIGHT },
  { x: 11.5, z: 6.75, y: ROUTE_DECK_HEIGHT + 1.18 },
  { x: 9.5, z: 6.75, y: ROUTE_DECK_HEIGHT + 1.18 },
  { x: 6.5, z: 6.75, y: 0.38 },
];

export const HILL_SEGMENTS: HillSegment[] = [];
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  HILL_SEGMENTS.push({
    a: HILL_NODES[i],
    b: HILL_NODES[i + 1],
    width: HILL_DECK_WIDTH,
  });
}

/**
 * Height lookup for the climbing section on Lane 2.
 */
export function hillHeightAt(x: number, z: number): number | null {
  if (Math.abs(z - 6.75) > HILL_DECK_WIDTH / 2) return null;
  if (x > 14.5 || x < 6.5) return null;

  // Incline ascent: x in [11.5, 14.5]
  if (x >= 11.5 && x <= 14.5) {
    const u = (14.5 - x) / 3.0;
    const eased = u * u * (3 - 2 * u);
    return ROUTE_DECK_HEIGHT + 1.18 * eased;
  }
  // Summit shelf: x in [9.5, 11.5]
  if (x >= 9.5 && x < 11.5) {
    return ROUTE_DECK_HEIGHT + 1.18;
  }
  // Descent ramp: x in [6.5, 9.5] down to fire platform at 0.38m
  if (x >= 6.5 && x < 9.5) {
    const u = (x - 6.5) / 3.0;
    const eased = u * u * (3 - 2 * u);
    return 0.38 + (ROUTE_DECK_HEIGHT + 1.18 - 0.38) * eased;
  }

  return null;
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
 * Generates stones distributed across the entire usable width of the rock platform on Lane 1.
 * Eliminates side empty strips by seeding stones in left, center, and right bands as well
 * as across the general field, ensuring realistic, varied irregular geometry and passable paths.
 */
export function generateRockFieldStones(seed = 20261027): StoneData[] {
  const rng = createDeterministicRNG(seed);
  const stones: StoneData[] = [];

  // Total 140 boulders distributed across usable width on Lane 1:
  // x in [6.5, 14.0], z in [11.5, 15.5] (centered on z = 13.50, full width 4.0m across 4.4m road)
  const zoneSpecs = [
    { count: 35, zMin: 11.50, zMax: 12.80 },
    { count: 40, zMin: 12.70, zMax: 14.30 },
    { count: 35, zMin: 14.20, zMax: 15.50 },
    { count: 30, zMin: 11.50, zMax: 15.50 },
  ];

  for (const zone of zoneSpecs) {
    for (let i = 0; i < zone.count; i++) {
      const x = 6.5 + rng() * 7.5;
      const z = zone.zMin + rng() * (zone.zMax - zone.zMin);
      const sizeCategory = rng();
      let s = 0.08;
      if (sizeCategory > 0.72) {
        s = 0.18 + rng() * 0.09; // large anchor boulder
      } else if (sizeCategory > 0.35) {
        s = 0.12 + rng() * 0.05; // medium obstacle stone
      } else {
        s = 0.06 + rng() * 0.04; // small embedded stone
      }

      stones.push({
        x,
        y: 0.035 + s * 0.35,
        z,
        scaleX: s * (0.8 + rng() * 0.4),
        scaleY: s * (0.6 + rng() * 0.5),
        scaleZ: s * (0.8 + rng() * 0.4),
        rotX: rng() * Math.PI,
        rotY: rng() * Math.PI * 2,
        rotZ: rng() * Math.PI,
      });
    }
  }

  return stones;
}

export const ROCK_FIELD_STONES: StoneData[] = generateRockFieldStones(20261027);

/**
 * Evaluates the physical contact elevation profile of boulders in the rock field on Lane 1.
 */
export function evaluateRockHeight(x: number, z: number): number {
  if (x < 6.0 || x > 14.5 || Math.abs(z - 13.50) > 2.20) return 0;
  let maxH = 0;
  for (let i = 0; i < ROCK_FIELD_STONES.length; i++) {
    const s = ROCK_FIELD_STONES[i];
    const rx = s.scaleX * 1.15;
    const rz = s.scaleZ * 1.15;
    const dx = (x - s.x) / rx;
    const dz = (z - s.z) / rz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1.0) {
      const h = (s.y + s.scaleY * 0.95) * (1 - d2);
      if (h > maxH) maxH = h;
    }
  }
  return maxH;
}

/**
 * Evaluates course ground height at unscaled world coordinates across all 5 lanes and 4 hairpins.
 */
export function evaluateCourseHeight(x: number, z: number): number {
  const halfW = DRIVE_ROUTE_WIDTH / 2; // 2.20m

  // ---------------------------------------------------------------------------
  // LANE 1: South Straight (Z = 13.50, Eastbound)
  // ---------------------------------------------------------------------------
  if (Math.abs(z - 13.50) <= halfW) {
    // Start bay on arena floor: x < -19.5
    if (x < -19.5) {
      return ARENA_FLOOR_HEIGHT;
    }
    // Start approach climbing ramp: x in [-19.5, -17.5]
    if (x >= -19.5 && x <= -17.5) {
      const t = Math.max(0, Math.min(1, (x - (-19.5)) / 2.0));
      return ARENA_FLOOR_HEIGHT + (ROUTE_DECK_HEIGHT - ARENA_FLOOR_HEIGHT) * t;
    }
    // Speed breakers at x in [0.8, 3.6]
    if (x >= 0.8 && x <= 3.6) {
      let bump = 0;
      for (const bx of SPEED_BREAKER_XS) {
        const d = Math.abs(x - bx);
        if (d < 0.45) {
          bump = Math.max(bump, ROUTE_DECK_HEIGHT + 0.09 * Math.cos((d / 0.45) * Math.PI * 0.5) ** 2);
        }
      }
      if (bump > 0) return bump;
    }
    // Rock Field platform: x in [6.0, 14.5]
    if (x >= 6.0 && x <= 14.5) {
      return ROUTE_DECK_HEIGHT + evaluateRockHeight(x, z);
    }
    // Main deck for Lane 1: x in [-17.5, 17.5]
    if (x >= -17.5 && x <= 17.5) {
      return ROUTE_DECK_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // HAIRPIN 1: Semicircular Viaduct (cx = 17.50, cz = 10.125, R = 3.375)
  // ---------------------------------------------------------------------------
  if (x >= 17.0 && z >= 6.5 && z <= 13.7) {
    const r = Math.hypot(x - 17.50, z - 10.125);
    if (r >= 1.15 && r <= 5.60) return ROUTE_DECK_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // LANE 2: Mid-South Straight (Z = 6.75, Westbound)
  // ---------------------------------------------------------------------------
  if (Math.abs(z - 6.75) <= halfW) {
    // Climbing Section / Hill: x in [6.5, 14.5]
    const hClimb = hillHeightAt(x, z);
    if (hClimb !== null) return hClimb;

    // Elevated Fire-Resistant Platform & Cooling Bridge: x in [1.5, 6.5]
    if (x >= 1.5 && x <= 6.5) {
      return 0.38;
    }

    // Deep Water Basin: x in [-9.5, 1.5]
    // 1. Entry ramp: x in [0.0, 1.5] (slopes smoothly from 0.38m down to -0.30m)
    if (x >= 0.0 && x < 1.5) {
      const u = Math.max(0, Math.min(1, (1.5 - x) / 1.5));
      const eased = u * u * (3 - 2 * u);
      return 0.38 + (-0.30 - 0.38) * eased;
    }
    // 2. Deep pool bed: x in [-7.5, 0.0] (water surface at 0.16m => 0.46m depth)
    if (x >= -7.5 && x < 0.0) {
      return -0.30;
    }
    // 3. Exit climb ramp: x in [-9.5, -7.5] (slopes from -0.30m up to 0.67m)
    if (x >= -9.5 && x < -7.5) {
      const u = Math.max(0, Math.min(1, (-7.5 - x) / 2.0));
      const eased = u * u * (3 - 2 * u);
      return -0.30 + (ROUTE_DECK_HEIGHT - (-0.30)) * eased;
    }

    // Slippery Sheet and viaduct straightaway: x in [-17.5, 17.5]
    if (x >= -17.5 && x <= 17.5) {
      return ROUTE_DECK_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // HAIRPIN 2: Semicircular Viaduct (cx = -17.50, cz = 3.375, R = 3.375)
  // ---------------------------------------------------------------------------
  if (x <= -17.0 && z >= -0.2 && z <= 7.0) {
    const r = Math.hypot(x - (-17.50), z - 3.375);
    if (r >= 1.15 && r <= 5.60) return ROUTE_DECK_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // LANE 3: Center Straight (Z = 0.00, Eastbound)
  // ---------------------------------------------------------------------------
  if (Math.abs(z - 0.00) <= halfW) {
    // Rotating industrial turntable platform at x = -4.0, z = 0.0
    const discR = Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z);
    if (discR <= TURNTABLE_RADIUS + 0.08) {
      return ROUTE_DECK_HEIGHT + 0.04;
    }
    // Sand / Marble pit recess at x in [3.0, 9.0]
    if (x >= 3.0 && x <= 9.0) {
      return ROUTE_DECK_HEIGHT - 0.015;
    }
    // Viaduct straightaway: x in [-17.5, 17.5]
    if (x >= -17.5 && x <= 17.5) {
      return ROUTE_DECK_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // HAIRPIN 3: Semicircular Viaduct (cx = 17.50, cz = -3.375, R = 3.375)
  // ---------------------------------------------------------------------------
  if (x >= 17.0 && z >= -7.0 && z <= 0.2) {
    const r = Math.hypot(x - 17.50, z - (-3.375));
    if (r >= 1.15 && r <= 5.60) return ROUTE_DECK_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // LANE 4: Mid-North Straight (Z = -6.75, Westbound)
  // ---------------------------------------------------------------------------
  if (Math.abs(z - (-6.75)) <= halfW) {
    // Warren Steel Arch Bridge at x in [6.5, 14.5] (crowned arch)
    if (x >= 6.5 && x <= 14.5) {
      const t = (x - 6.5) / 8.0;
      const u = t <= 0.5 ? t * 2 : (1 - t) * 2;
      const smoothCurve = u * u * (3 - 2 * u);
      return ROUTE_DECK_HEIGHT + 0.59 * smoothCurve;
    }
    // Stepping platforms at x in [1.5, 5.5]
    if (x >= 1.5 && x <= 5.5) {
      return ROUTE_DECK_HEIGHT + 0.18;
    }
    // Parallel Plank Bridge centered on z = -6.75, x in [-7.5, 0.5]
    if (x >= -7.5 && x <= 0.5) {
      const onLeftPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[0].z) < 0.35;
      const onRightPlank = Math.abs(z - PARALLEL_PLANK_CENTERS[1].z) < 0.35;
      if (onLeftPlank || onRightPlank) {
        return ROUTE_DECK_HEIGHT + 0.27;
      }
      return ROUTE_DECK_HEIGHT;
    }
    // Viaduct straightaway: x in [-17.5, 17.5]
    if (x >= -17.5 && x <= 17.5) {
      return ROUTE_DECK_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // HAIRPIN 4: Semicircular Viaduct (cx = -17.50, cz = -10.125, R = 3.375)
  // ---------------------------------------------------------------------------
  if (x <= -17.0 && z >= -13.7 && z <= -6.5) {
    const r = Math.hypot(x - (-17.50), z - (-10.125));
    if (r >= 1.15 && r <= 5.60) return ROUTE_DECK_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // LANE 5: North Finishing Straight (Z = -13.50, Eastbound)
  // ---------------------------------------------------------------------------
  if (Math.abs(z - (-13.50)) <= halfW) {
    if (x >= -17.5 && x <= 16.0) {
      return ROUTE_DECK_HEIGHT;
    }
  }

  // Fallback route check
  if (supportsRoadAt(x, z, DRIVE_ROUTE, DRIVE_ROUTE_WIDTH)) {
    return ROUTE_DECK_HEIGHT;
  }

  // Off-road / Open-air chasms drop to arena floor
  return ARENA_FLOOR_HEIGHT;
}

/**
 * Returns surface properties including traction, rolling resistance, and hazard triggers.
 */
export function evaluateCourseSurface(x: number, z: number): SurfaceProperties {
  const halfW = DRIVE_ROUTE_WIDTH / 2;

  // 1. Mandatory Hazard Sequence on Lane 2 (z = 6.75):
  if (Math.abs(z - 6.75) <= halfW) {
    // Fire Zone: Elevated refractory hearth at x in [2.5, 6.5]
    if (x >= 2.5 && x <= 6.5) {
      return { grip: 0.90, rollingResistance: 0.35, hazard: 'fire' };
    }
    // Heat-Shield Cooling Bridge: x in [1.5, 2.5]
    if (x >= 1.5 && x < 2.5) {
      return { grip: 0.88, rollingResistance: 0.32, hazard: 'none' };
    }
    // Deep Water Basin: x in [-9.5, 1.5]
    if (x >= -9.5 && x < 1.5) {
      return { grip: 0.52, rollingResistance: 0.75, hazard: 'water' };
    }
    // Slippery Metal / Ice Sheet: x in [-14.0, -9.5]
    if (x >= -14.0 && x < -9.5) {
      return { grip: 0.22, rollingResistance: 0.15, hazard: 'none' };
    }
  }

  // 2. Technical Hazards on Lane 3 (z = 0.00):
  if (Math.abs(z - 0.00) <= halfW) {
    // High-Gloss Iridescent Oil Skid Pad: x in [-12.0, -8.0]
    if (x >= -12.0 && x <= -8.0) {
      return { grip: 0.18, rollingResistance: 0.12, hazard: 'oil' };
    }
    // Rotating mechanical turntable disc: x = -4.0, z = 0.0
    if (Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z) <= TURNTABLE_RADIUS) {
      return { grip: 0.92, rollingResistance: 0.35, hazard: 'none' };
    }
    // Mixed Terrain Stretch:
    if (x >= 3.0 && x <= 9.0) return { grip: 0.45, rollingResistance: 1.85, hazard: 'none' }; // Sand & Marble pit
    if (x > 9.0 && x <= 12.0) return { grip: 0.82, rollingResistance: 0.70, hazard: 'none' }; // Turf
    if (x > 12.0 && x <= 14.5) return { grip: 1.15, rollingResistance: 0.40, hazard: 'none' }; // Rubber mat
  }

  // 3. Rock Field on Lane 1 (z = 13.50):
  if (Math.abs(z - 13.50) <= halfW && x >= 6.0 && x <= 14.5) {
    return { grip: 0.65, rollingResistance: 1.50, hazard: 'none' };
  }

  // 4. Bridges and timber sections:
  if (Math.abs(z - (-6.75)) <= halfW && x >= -7.5 && x <= 14.5) {
    return { grip: 0.88, rollingResistance: 0.40, hazard: 'none' };
  }

  // Default clean arena concrete floor
  return { grip: 1.05, rollingResistance: 0.30, hazard: 'none' };
}

/**
 * 11 Ordered Checkpoints along the 5-lane primary racing circuit.
 */
export const CHECKPOINTS: CheckpointGate[] = [
  { id: 1, label: 'Gate 01 - Start Straight', x: -17.5, z: 13.50, yaw: Math.PI / 2, width: 5.6 },
  { id: 2, label: 'Gate 02 - Slalom Exit', x: 4.2, z: 13.50, yaw: Math.PI / 2, width: 5.6 },
  { id: 3, label: 'Gate 03 - Rock Field', x: 6.0, z: 13.50, yaw: Math.PI / 2, width: 5.6 },
  { id: 4, label: 'Gate 04 - Hill Summit', x: 11.5, z: 6.75, yaw: -Math.PI / 2, width: 5.6 },
  { id: 5, label: 'Gate 05 - Fire Hazard', x: 4.5, z: 6.75, yaw: -Math.PI / 2, width: 5.6 },
  { id: 6, label: 'Gate 06 - Deep Water Basin', x: -3.5, z: 6.75, yaw: -Math.PI / 2, width: 5.6 },
  { id: 7, label: 'Gate 07 - Rotating Platform', x: -4.0, z: 0.00, yaw: Math.PI / 2, width: 5.6 },
  { id: 8, label: 'Gate 08 - Mixed Terrain', x: 6.0, z: 0.00, yaw: Math.PI / 2, width: 5.6 },
  { id: 9, label: 'Gate 09 - Arch Bridge', x: 10.5, z: -6.75, yaw: -Math.PI / 2, width: 5.6 },
  { id: 10, label: 'Gate 10 - Parallel Planks', x: -3.5, z: -6.75, yaw: -Math.PI / 2, width: 5.6 },
  { id: 11, label: 'Gate 11 - Grand Finish', x: 12.0, z: -13.50, yaw: Math.PI / 2, width: 5.6 },
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
