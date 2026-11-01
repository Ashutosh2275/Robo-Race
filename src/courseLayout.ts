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

// Map scale constant matching scene
export const MAP_SCALE = 1.3;

export const SLALOM_BARRIERS = Array.from({ length: 5 }, (_, i) => ({
  id: `slalom_barrier_${i}`,
  x: -10.4 + i * 2.25,
  z: 8.0 + (i % 2 === 0 ? 1.1 : -1.1),
  width: 0.36,
  depth: 1.8,
  height: 0.78,
}));
export const SPEED_BREAKER_XS = [0, 1.05, 2.1] as const;

// Switchback Hill Nodes with wide turning landings
export const HILL_NODES: HillNode[] = [
  { x: 8.0, z: -2.0, y: 0.03 },    // Base entry
  { x: 14.5, z: -2.0, y: 1.50 },   // Leg 1 crest
  { x: 14.5, z: -4.8, y: 1.50 },   // Landing 1
  { x: 8.0, z: -4.8, y: 3.00 },    // Leg 2 crest
  { x: 8.0, z: -7.6, y: 3.00 },    // Landing 2
  { x: 14.5, z: -7.6, y: 4.50 },   // Leg 3 crest
  { x: 14.5, z: -10.4, y: 4.50 },  // Summit landing
  { x: 8.0, z: -10.4, y: 2.25 },   // Descent leg 1
  { x: 8.0, z: -12.5, y: 0.03 },   // Descent exit
];

export const HILL_SEGMENTS: HillSegment[] = [];
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  HILL_SEGMENTS.push({
    a: HILL_NODES[i],
    b: HILL_NODES[i + 1],
    width: 2.8, // 2.8m wide path (ample clearance for 1.9m total vehicle width)
  });
}

/**
 * Height lookup for the switchback hill.
 */
export function hillHeightAt(x: number, z: number): number | null {
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

    if (dist <= seg.width * 0.55 && dist < closestDist) {
      closestDist = dist;
      computedH = seg.a.y + (seg.b.y - seg.a.y) * t;
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

  // Rotating disc platform at x = 10.65, z = 0.1
  const discR = Math.hypot(x - 10.65, z - 0.1);
  if (discR < 1.35) {
    const t = Math.max(0, Math.min(1, (discR - 1.0) / 0.35));
    return 0.28 * (1 - t * t * (3 - 2 * t));
  }

  // Curved timber ramp at x = 4.8, z = 8.0 (length = 3.0, width = 2.8, height = 0.88)
  if (Math.abs(z - 8.0) < 1.45 && x >= 3.3 && x <= 6.3) {
    const t = (x - 3.3) / 3.0;
    const smoothCurve = Math.min(
      Math.sin(Math.min(1, t * 2) * Math.PI * 0.5),
      Math.sin(Math.min(1, (1 - t) * 2) * Math.PI * 0.5)
    );
    return 0.88 * smoothCurve;
  }

  // Raised bridge ramps and deck at z = 8.0 (x = 7.8 to 11.4, bridge deck at 9.6, height = 0.62)
  if (Math.abs(z - 8.0) < 1.35 && x >= 7.0 && x <= 12.2) {
    const tAscent = Math.max(0, Math.min(1, (x - 7.0) / 1.6));
    const tDescent = Math.max(0, Math.min(1, (12.2 - x) / 1.6));
    return 0.62 * Math.min(tAscent, tDescent);
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

  // Corrected parallel plank bridges at z = -7.7 ± 0.79 (x = -7.35 to -3.25, height 0.30)
  // Track 1 plank: centered at z = -8.49; Track 2 plank: centered at z = -6.91
  if (x >= -9.4 && x <= -5.3) {
    const onLeftPlank = Math.abs(z - (-8.49)) < 0.38;
    const onRightPlank = Math.abs(z - (-6.91)) < 0.38;
    if (onLeftPlank || onRightPlank) {
      return 0.30;
    }
  }

  // Single plank bridge at x = -7.7, z = -4.0 (width 2.4, height 0.22)
  if (x >= -9.55 && x <= -5.85 && Math.abs(z - (-4.0)) < 1.2) {
    return 0.22;
  }

  // Sand / Marble pit recess at x in [11.9, 15.0], z in [2.9, 6.2]
  if (x >= 11.9 && x <= 15.0 && z >= 2.9 && z <= 6.2) {
    return 0.08;
  }

  // Water hazard shallow cooling basin at x in [-7.5, -5.5], z in [-4.8, -3.2]
  if (x >= -7.5 && x <= -5.5 && Math.abs(z - (-4.0)) < 1.1) {
    return 0.05; // Slightly recessed pool
  }

  return 0.03; // Default arena floor level
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
  if (x >= -3.8 && x <= -1.8 && Math.abs(z - (-4.0)) < 1.1) {
    return { grip: 0.90, rollingResistance: 0.35, hazard: 'fire' };
  }

  // 2. Water Zone: x in [-7.5, -5.5], z in [-4.8, -3.2]
  if (x >= -7.5 && x <= -5.5 && Math.abs(z - (-4.0)) < 1.1) {
    return { grip: 0.58, rollingResistance: 0.65, hazard: 'water' };
  }

  // 3. Oil Slicks: x in [-10.5, -8.0], z in [-4.8, -3.2]
  if (x >= -10.5 && x <= -8.0 && Math.abs(z - (-4.0)) < 1.2) {
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
  { id: 1, label: 'Gate 01 - Start Straight', x: -11.5, z: 8.0, yaw: Math.PI / 2, width: 3.4 },
  // Placed just beyond the final staggered barrier so the vehicle can fully
  // clear the slalom before the checkpoint trigger is considered passed.
  { id: 2, label: 'Gate 02 - Slalom Exit', x: -0.2, z: 8.0, yaw: Math.PI / 2, width: 3.4 },
  { id: 3, label: 'Gate 03 - Breakers Clear', x: 3.2, z: 8.0, yaw: Math.PI / 2, width: 3.4 },
  { id: 4, label: 'Gate 04 - Ramp Approach', x: 4.4, z: 8.0, yaw: Math.PI / 2, width: 3.4 },
  { id: 5, label: 'Gate 05 - Bridge Crest', x: 9.6, z: 8.0, yaw: Math.PI / 2, width: 3.4 },
  { id: 6, label: 'Gate 06 - Marble Pit Turn', x: 13.2, z: 4.7, yaw: Math.atan2(3.6, -3.3), width: 3.4 },
  { id: 7, label: 'Gate 07 - Rotating Platform', x: 10.65, z: 0.1, yaw: Math.atan2(-2.55, -4.6), width: 3.4 },
  { id: 8, label: 'Gate 08 - Mixed Terrain', x: 1.4, z: 0.0, yaw: -Math.PI / 2, width: 3.4 },
  { id: 9, label: 'Gate 09 - Hazard Sequence', x: -3.1, z: -4.0, yaw: Math.atan2(-4.5, -4.0), width: 3.4 },
  { id: 10, label: 'Gate 10 - Hairpin Complex', x: -7.5, z: -7.7, yaw: Math.atan2(-4.4, -3.7), width: 3.4 },
  { id: 11, label: 'Gate 11 - Final Straight', x: -13.2, z: -12.0, yaw: Math.atan2(-5.7, -4.3), width: 3.4 },
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
