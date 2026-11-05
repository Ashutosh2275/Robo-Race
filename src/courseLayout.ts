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
  elevation?: number;
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

// ---------------------------------------------------------------------------
// LANE 4 OBSTACLE 1: SWINGING PENDULUM GAUNTLET CONFIGURATION (Z = -6.75, X in [3.8, 16.2])
// High-profile catwalk bridge (2.00m wide) with 3 counter-swinging balls spaced at 2.25x bot length
// ---------------------------------------------------------------------------
export const PENDULUM_CONFIG = {
  zLane: -6.75,
  xEntryStart: 16.20,   // Ground entrance before ascent ramp
  xRampUpEnd: 14.50,    // Top of ascent ramp / start of flat bridge deck
  xRampDownStart: 5.50, // End of flat bridge deck / start of descent ramp
  xExitEnd: 3.80,       // Touchdown at ground grade before Gate 08
  deckY: 1.35,          // Higher elevated bridge deck (+1.68m above ground)
  deckWidth: 2.00,      // Comfortable catwalk bridge width (~1.54x robot width, ~24cm clearance left & right, NO guardrails)
  ballPositionsX: [13.65, 10.00, 6.35] as const, // 3 balls spaced 3.65m apart (2.95m clear gap = 2.25x bot length)
  ballRadius: 0.35,     // Heavy metallic sphere radius (diameter 0.70m)
  ballPivotY: 4.45,     // Overhead gantry suspension pivot (hangs at y=1.80m, bottom of ball clears deck at 1.45m)
  ballArmLength: 2.65,  // Pendulum length
  swingAmplitude: 1.55, // Swings +-1.55m across track (well beyond bridge width)
  swingOmega: 2.30,     // Swing frequency in rad/s
  phaseOffsets: [0.0, Math.PI, 0.0] as const, // Ball 1 & 3 swing parallelly, Middle ball swings opposite!
} as const;

// ---------------------------------------------------------------------------
// LANE 4 OBSTACLE 2: DUAL HANGING SUSPENSION BRIDGES CONFIGURATION (Z = -6.75, X in [-10.8, 2.4])
// Heighted ramp climbing to twin suspended trackways with suspension towers & catenary cables
// ---------------------------------------------------------------------------
export const HANGING_BRIDGE_CONFIG = {
  zLane: -6.75,
  xEntryStart: 2.40,    // Ascent ramp start at ground grade after Gate 08
  xBridgeEast: 0.80,    // East suspension tower / deck start
  xBridgeMid: -4.20,    // Center suspension tower
  xBridgeWest: -9.20,   // West suspension tower / deck end
  xExitEnd: -10.80,     // Descent ramp touchdown at ground grade before Gate 09
  deckY: 0.80,          // Elevated deck height (+1.13m above ground)
  trackWidth: 1.05,     // Width of each individual suspended track
  totalDeckWidth: 2.60, // Full width across both tracks and central transom
  cableTowerHeight: 3.20,// Pylon tower height
  catenarySag: 0.04,    // Authentic subtle deck suspension deflection
} as const;

// Lane 3 at z = 0.00 (Turntable on Spiral Rooftop Deck for Track B, or ground platform)
export const TURNTABLE_CENTER = { x: 1.0, z: 0.00 } as const;
export const TURNTABLE_RADIUS = 2.45; // 4.90m diameter, >3.2x robot width

/** Road width in course-local metres: 4.40m gives 2.89x robot clearance in world space */
export const DRIVE_ROUTE_WIDTH = 4.40;

// Arena floor elevation (the foundation of the entire facility)
export const ARENA_FLOOR_HEIGHT = -0.33;

/** Ground-level driving surface (70-80% of racing occurs at ground grade) */
export const GROUND_DECK_HEIGHT = -0.33;

/** Elevated viaduct standard clearance for medium obstacles */
export const ROUTE_CLEARANCE_HEIGHT = 1.0;
export const ROUTE_DECK_HEIGHT = GROUND_DECK_HEIGHT; // Base course deck is ground level (-0.33m)
export const ROUTE_HEIGHT_OFFSET = ROUTE_DECK_HEIGHT - 0.03;

// Standard obstacle elevation tiers
export const ELEVATION_TIER_SMALL = 0.45;  // 0.3 - 0.6m: e.g. Rock field platform (y = 0.12m)
export const ELEVATION_TIER_MEDIUM = 0.95; // 0.7 - 1.2m: e.g. Warren Arch Bridge (y = 0.62m)
export const ELEVATION_TIER_MAJOR = 3.20;  // 3.0 - 4.0m: e.g. Spiral Climbing Tower (y = 3.20m, 3.53m rise above ground)

// ---------------------------------------------------------------------------
// PARKING-GARAGE-STYLE SPIRAL RAMP SPECIFICATIONS
// ---------------------------------------------------------------------------
export const SPIRAL_CONFIG = {
  cx: -4.50,
  cz: 0.00,
  rCenter: 1.35,       // Centerline driving radius ((rInner + rOuter) / 2 = 1.35m)
  roadWidth: 2.30,     // Expanded road width: ~1.51x robot width (1.52m in course units) gives ~39cm clearance on both sides
  rInner: 0.20,        // Single central vertical stake/pole (radius 20cm, not a drum)
  rOuter: 2.50,        // Outer edge radius (rInner + roadWidth = 2.50m)
  turns: 1.50,         // 1.5 revolutions (540 degrees continuous helical climb)
  yGround: ARENA_FLOOR_HEIGHT, // Ground entrance: -0.33m
  yTop: 3.20,          // Large climb to summit elevation (3.53m above ground)
  startAngle: Math.PI, // Enters at west tangent (x = cx - rCenter = -5.85, z = 0.00)
  endAngle: Math.PI + 1.50 * 2 * Math.PI, // 4.0 * Math.PI (exits at east tangent: x = cx + rCenter = -3.15, z = 0.00)
  // Summit Platform & Connecting Bridge to Turntable
  deckX: 1.00,
  deckZ: 0.00,
  deckWidthX: 6.90,    // Spans from x = -3.45 to x = 3.45 at y = 3.20m
  deckWidthZ: 5.20,    // Accommodates the 4.90m diameter turntable flush
  // Connected descending viaduct ramp (from summit deck down to ground runway)
  descentX0: 3.45,
  descentX1: 10.45,    // 7.0m smooth downhill grade back to ground level
  descentZ: 0.00,
  descentWidth: 2.30,  // Expanded matching 2.30m road width
} as const;

/**
 * Calculates height and surface characteristics on the compact cardboard spiral ramp.
 * Incorporates continuous monotonic helical ascent with authentic inward superelevation
 * banking so the robot climbs smoothly without spinning, sliding, or cliff discontinuities.
 */
export function evaluateSpiralRamp(x: number, z: number, poseY = 0): { inSpiral: boolean; height: number; grip: number } {
  // 1. Approach road and entrance apron before spiral perimeter (x <= -6.80, |z| <= 2.50 at ground grade)
  if (poseY < 0.60 && x <= -6.80 && x >= -12.00 && Math.abs(z - SPIRAL_CONFIG.cz) <= 2.50) {
    return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
  }

  // 2. Connected Descending Viaduct Ramp: x in [3.45, 10.45], |z| <= descentWidth / 2 + 0.25
  if (x >= SPIRAL_CONFIG.descentX0 && x <= SPIRAL_CONFIG.descentX1 && Math.abs(z - SPIRAL_CONFIG.descentZ) <= SPIRAL_CONFIG.descentWidth / 2 + 0.25) {
    const u = (x - SPIRAL_CONFIG.descentX0) / (SPIRAL_CONFIG.descentX1 - SPIRAL_CONFIG.descentX0);
    const eased = u * u * (3 - 2 * u);
    const h = SPIRAL_CONFIG.yTop + (SPIRAL_CONFIG.yGround - SPIRAL_CONFIG.yTop) * eased;
    // Ground-level bots driving under the elevated viaduct must stay firmly on the ground (-0.33m)
    if (poseY < 0.60 && poseY < h - 0.50) {
      return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
    }
    return { inSpiral: true, height: h, grip: 1.05 };
  }

  // 3. Compact Helical Spiral Ramp around Single Central Stake (cx = -4.50, cz = 0.00)
  const dx = x - SPIRAL_CONFIG.cx;
  const dz = z - SPIRAL_CONFIG.cz;
  const dist = Math.hypot(dx, dz);

  // 1. Elevated Turntable Platter & Foundation Deck (5.6m x 5.6m centered at x=1.0, z=0.0)
  // Evaluated first for elevated vehicles (poseY > 1.30m) so rotating platter surface is 100% solid and continuous
  const inTurntableEnvelope = Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z) <= (TURNTABLE_RADIUS + 0.80)
    || (x >= -1.60 && x <= 4.20 && Math.abs(z - TURNTABLE_CENTER.z) <= 3.80);
  if (inTurntableEnvelope && poseY > 1.30) {
    return { inSpiral: true, height: SPIRAL_CONFIG.yTop, grip: 1.05 };
  }

  // Elevated Summit Approach Bridge & Flared Transition Apron (x in [-3.55, -1.45])
  // Supports elevated vehicles (poseY > 1.50m) crossing from spiral climb to turntable
  // In the southern quadrant (z >= -0.15m), overrides the lower helical tier (h <= 2.02m) so bridge is 100% solid
  if (poseY > 1.50) {
    if (x >= -2.10 && x < -1.45 && Math.abs(z) <= 1.45) {
      return { inSpiral: true, height: SPIRAL_CONFIG.yTop, grip: 1.05 };
    }
    if (x >= -3.55 && x < -2.10 && z >= -0.15 && z <= 1.45) {
      return { inSpiral: true, height: SPIRAL_CONFIG.yTop, grip: 1.05 };
    }
  }

  // Ground approach lane west of spiral perimeter (x <= -7.00, |z| <= 2.50 at ground grade)
  if (poseY < 0.60 && x <= (SPIRAL_CONFIG.cx - SPIRAL_CONFIG.rOuter) && Math.abs(dz) <= 2.50) {
    return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
  }

  // Generous physical deck catch envelope (supports wheels even if drifting near outer edge)
  const maxElevatedDist = poseY > 0.40 ? (SPIRAL_CONFIG.rOuter + 0.15) : (SPIRAL_CONFIG.rOuter + 0.10);

  if (dist <= maxElevatedDist && dist >= SPIRAL_CONFIG.rInner - 0.08) {
    // Angle along helical progression starting at West (dx < 0, dz = 0) climbing North -> East -> South
    let beta = Math.atan2(-dz, -dx);
    if (beta < 0) beta += 2 * Math.PI;

    let totalBeta: number;
    if (poseY < 0.60 && dx < 0 && beta > Math.PI) {
      // Entrance seam at West: if vehicle is on ground/lower tier (< 0.60m) and slightly south of equator, it is at entrance (t=0)
      totalBeta = 0;
    } else if (dz > 0.0) {
      // Southern half (dz > 0): exactly one tier in [PI, 2*PI] (h in [0.85m, 2.02m])
      totalBeta = beta;
    } else {
      // Northern half and East/West equator (dz <= 0): two tiers cleanly separated by smooth height threshold
      const u = Math.max(-1, Math.min(1, dx / Math.max(1e-6, dist)));
      const threshold = 1.40 + 0.60 * u;
      const isUpperTier = poseY > threshold;
      totalBeta = isUpperTier ? (beta + 2 * Math.PI) : beta;
    }

    // Clamp progress to valid [0, 3*PI] span (t in [0, 1])
    const t = Math.max(0, Math.min(1, totalBeta / (3 * Math.PI)));
    let h = SPIRAL_CONFIG.yGround + t * (SPIRAL_CONFIG.yTop - SPIRAL_CONFIG.yGround);

    // Ground-level bot under the elevated spiral tiers stays firmly on the ground (-0.33m)
    // Only vehicles within active climbing range are supported on the helical ramp
    if (poseY < 0 && poseY < h - 0.50 && h > SPIRAL_CONFIG.yGround + 0.35) {
      return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
    }

    // Smooth inward superelevation banking (outer edge slightly elevated)
    const effectiveDist = Math.max(SPIRAL_CONFIG.rInner, dist);
    const bank = 0.020 * (effectiveDist - SPIRAL_CONFIG.rCenter) / (SPIRAL_CONFIG.roadWidth * 0.5);

    // Outer deck edge beveled transition
    if (dist > SPIRAL_CONFIG.rOuter) {
      const overhang = dist - SPIRAL_CONFIG.rOuter;
      h -= Math.min(0.12, overhang * 0.40);
    }

    return { inSpiral: true, height: h + bank, grip: 1.15 };
  }

  // 4. Ground pavement under the entire spiral footprint (eliminates any holes between inner and outer)
  if (poseY < 0.50 && dist < SPIRAL_CONFIG.rOuter + 0.60) {
    return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
  }

  // 5. Approach Bridge Viaduct (x in [-3.45, -1.45]) and Ground Grade under Turntable
  const isApproachBridge = x >= -3.45 && x < -1.45 && Math.abs(z - SPIRAL_CONFIG.deckZ) <= SPIRAL_CONFIG.roadWidth / 2 + 0.25;
  if (isApproachBridge) {
    if (poseY > 1.30) {
      return { inSpiral: true, height: SPIRAL_CONFIG.yTop, grip: 1.05 };
    }
    return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
  }
  if (inTurntableEnvelope) {
    return { inSpiral: true, height: SPIRAL_CONFIG.yGround, grip: 1.15 };
  }

  return { inSpiral: false, height: ARENA_FLOOR_HEIGHT, grip: 1.0 };
}

// ---------------------------------------------------------------------------
// TRACK CLASSIFICATION & MANDATORY SEQUENCE ARCHITECTURE
// ---------------------------------------------------------------------------
export type TrackId = 'track_a' | 'track_b' | 'track_c' | 'track_d';

export type ObstacleKind =
  | 'start'
  | 'slalom'
  | 'speed_breakers'
  | 'rockfield'
  | 'spiral'
  | 'climbing_hill'
  | 'bridge'
  | 'stepping_platforms'
  | 'planks'
  | 'turntable'
  | 'mixed_terrain'
  | 'oil'
  | 'fire'
  | 'water'
  | 'finish';

export interface TrackObstacle {
  id: string;
  name: string;
  kind: ObstacleKind;
  x: number;
  z: number;
  elevation: number;
}

export interface TrackConfig {
  id: TrackId;
  name: string;
  shortName: string;
  subtitle: string;
  description: string;
  hasSpiral: boolean;
  driveRoute: CoursePoint[];
  checkpoints: CheckpointGate[];
  obstacles: TrackObstacle[];
  elevationStats: {
    groundRatio: number;   // 70 - 80% ground
    elevatedRatio: number; // 20 - 30% elevated
    maxElevation: number;
  };
  evaluateHeight: (x: number, z: number, poseY?: number) => number;
  evaluateSurface: (x: number, z: number, poseY?: number) => SurfaceProperties;
}

/**
 * Mandatory Sequence Validation:
 * The second-last obstacle must always be FIRE, and the last obstacle must always be WATER.
 */
export function validateObstacleSequence(obstacles: TrackObstacle[]): { valid: boolean; error?: string } {
  if (obstacles.length < 3) {
    return { valid: false, error: 'Track must contain at least 3 obstacles' };
  }
  const secondLast = obstacles[obstacles.length - 2];
  const last = obstacles[obstacles.length - 1];
  if (secondLast.kind !== 'fire') {
    return { valid: false, error: `Mandatory sequence violation: obstacle[-2] must be FIRE, got "${secondLast.kind}"` };
  }
  if (last.kind !== 'water') {
    return { valid: false, error: `Mandatory sequence violation: obstacle[-1] must be WATER, got "${last.kind}"` };
  }
  return { valid: true };
}

/**
 * Validates elevation distribution: 70-80% ground level, 20-30% elevated.
 */
export function validateTrackElevationDistribution(track: TrackConfig): { valid: boolean; groundRatio: number; elevatedRatio: number } {
  const g = track.elevationStats.groundRatio;
  const e = track.elevationStats.elevatedRatio;
  const valid = g >= 0.68 && g <= 0.82 && e >= 0.18 && e <= 0.32;
  return { valid, groundRatio: g, elevatedRatio: e };
}

function circularArc(cx: number, cz: number, radius: number, start: number, end: number, count: number): CoursePoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count;
    return { x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) };
  });
}

// ---------------------------------------------------------------------------
// TRACK B: SPIRAL TOWER CHALLENGE (PRIMARY SHOWCASE TRACK)
// Features: Ground circuit -> Rock platform -> Spiral Tower (1.78m) -> Rooftop Turntable -> Descent Ramp -> Fire -> Water -> Finish
// ---------------------------------------------------------------------------
export const TRACK_B_ROUTE: CoursePoint[] = [
  // Lane 1: South Straight (Z = 13.50, Eastbound) - Ground Level
  { x: -20.5, z: 13.50 }, // Start Bay (Ground: -0.33m)
  { x: -17.5, z: 13.50 }, // Gate 01 - Start Straight
  { x: -15.0, z: 13.50 }, // Slalom hurdle 0
  { x: -11.5, z: 13.50 }, // Slalom hurdle 1
  { x: -8.0, z: 13.50 },  // Slalom hurdle 2
  { x: -4.5, z: 13.50 },  // Slalom hurdle 3
  { x: -1.0, z: 13.50 },  // Slalom hurdle 4
  { x: 1.2, z: 13.50 },   // Speed breaker 1
  { x: 3.2, z: 13.50 },   // Speed breaker 3
  { x: 4.2, z: 13.50 },   // Gate 02 - Slaloms Cleared (Exit of slaloms & speed breakers)
  { x: 6.0, z: 13.50 },   // Rock Field Entrance (Platform +0.45m)
  { x: 10.25, z: 13.50 }, // Rock Field center
  { x: 14.5, z: 13.50 },  // Rock Field exit descent
  { x: 14.8, z: 13.50 },  // Gate 03 - Rock Field Cleared (Immediately after rock field)
  { x: 17.5, z: 13.50 },  // Lane 1 exit to Hairpin 1

  // Hairpin 1: Ground-Level Semicircular Viaduct
  ...circularArc(17.50, 10.125, 3.375, Math.PI / 2, -Math.PI / 2, 12).slice(1),

  // Lane 2: Mid-South Straight (Z = 6.75, Westbound) - Ground Level
  { x: 14.5, z: 6.75 },   // Technical straight entry
  { x: 7.5, z: 6.75 },    // Technical straight mid
  { x: 0.0, z: 6.75 },    // Mid-corridor
  { x: -7.5, z: 6.75 },   // Slippery sheet entry
  { x: -12.0, z: 6.75 },  // Slippery steel sheet
  { x: -14.8, z: 6.75 },  // Gate 04 - Technical Straight & Steel Sheet Cleared
  { x: -17.5, z: 6.75 },  // Lane 2 exit to Hairpin 2

  // Hairpin 2: Ground-Level Semicircular Viaduct
  ...circularArc(-17.50, 3.375, 3.375, Math.PI / 2, Math.PI * 1.5, 12).slice(1),

  // Lane 3: Compact Spiral Tower Approach & Climb (Center: cx = -4.50, cz = 0.00)
  { x: -12.0, z: 0.00 },  // Approach to Spiral Entrance
  { x: -10.50, z: 0.00 }, // Spiral Approach Gantry
  { x: -5.85, z: 0.00 },  // Compact Spiral Ground Entrance (y = -0.33m)
  // Helical climb around central stake (R = 1.35m, 1.5 turns, climb to y = 3.20m)
  ...circularArc(-4.50, 0.0, 1.35, Math.PI, Math.PI * 2.5, 12).slice(1),
  ...circularArc(-4.50, 0.0, 1.35, Math.PI * 2.5, Math.PI * 4.0, 12).slice(1),
  { x: -1.40, z: 0.00 },  // Gate 05 - Spiral Summit Cleared (Immediately after helical climb on summit deck)
  { x: 1.00, z: 0.00 },   // Summit Turntable center (y = 3.20m)
  { x: 3.65, z: 0.00 },   // Gate 06 - Turntable Cleared (Immediately after turntable on summit deck)
  { x: 6.95, z: 0.00 },   // Downhill viaduct ramp midpoint
  { x: 10.45, z: 0.00 },  // Descent ramp touchdown
  { x: 11.20, z: 0.00 },  // Gate 07 - Descent Ramp Cleared (Immediately after touchdown at ground grade)
  { x: 14.00, z: 0.00 },  // Ground runway
  { x: 17.50, z: 0.00 },  // Lane 3 exit to Hairpin 3

  // Hairpin 3: Ground-Level Semicircular Viaduct
  ...circularArc(17.50, -3.375, 3.375, Math.PI / 2, -Math.PI / 2, 12).slice(1),

  // Lane 4: Mid-North Straight (Z = -6.75, Westbound) - Ground Level
  { x: 16.20, z: -6.75 }, // Lane 4 Entry / Ascent Ramp
  { x: 13.65, z: -6.75 }, // Ball 1
  { x: 10.00, z: -6.75 }, // Ball 2
  { x: 6.35, z: -6.75 },  // Ball 3
  { x: 3.80, z: -6.75 },  // Pendulum ramp touchdown
  { x: 3.20, z: -6.75 },  // Gate 08 - Pendulum Gauntlet Cleared (Immediately after descending pendulum catwalk)
  { x: 0.80, z: -6.75 },  // Suspension Bridge East Tower
  { x: -4.20, z: -6.75 }, // Suspension Bridge Mid
  { x: -9.20, z: -6.75 }, // Suspension Bridge West Tower
  { x: -10.80, z: -6.75 },// Suspension Bridge touchdown
  { x: -11.50, z: -6.75 },// Gate 09 - Suspension Bridges Cleared (Immediately after descending suspension bridge)
  { x: -17.50, z: -6.75 },// Lane 4 exit to Hairpin 4

  // Hairpin 4: Ground-Level Semicircular Viaduct
  ...circularArc(-17.50, -10.125, 3.375, Math.PI / 2, Math.PI * 1.5, 12).slice(1),

  // Lane 5: North Finishing Straight (Z = -13.50, Eastbound) - MANDATORY SEQUENCE: FIRE -> WATER -> FINISH
  { x: -12.0, z: -13.50 }, // Lane 5 approach (ground)
  { x: -5.0, z: -13.50 },  // Fire Hazard Entrance
  { x: -1.0, z: -13.50 },  // Fire Hazard Exit
  { x: -0.20, z: -13.50 }, // Gate 10 - Fire Hazard Cleared (Immediately after fire hearth platform)
  { x: 0.5, z: -13.50 },   // Deep Water Basin Entrance
  { x: 5.0, z: -13.50 },   // Water pool submerged center
  { x: 9.5, z: -13.50 },   // Water Exit Ramp touchdown
  { x: 10.50, z: -13.50 }, // Gate 11 - Deep Water Basin Cleared (Immediately after emerging from water basin)
  { x: 13.50, z: -13.50 }, // Gate 12 - Grand Finish Line (Grand finish line)
  { x: 16.0, z: -13.50 },  // Deceleration run-off end
];

export const TRACK_B_CHECKPOINTS: CheckpointGate[] = [
  { id: 1, label: 'Gate 01 - Start Straight', x: -17.5, z: 13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 2, label: 'Gate 02 - Slaloms Cleared', x: 4.2, z: 13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 3, label: 'Gate 03 - Rock Field Cleared', x: 14.8, z: 13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 4, label: 'Gate 04 - Technical Straight Cleared', x: -14.8, z: 6.75, yaw: -Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 5, label: 'Gate 05 - Spiral Summit Cleared', x: -1.40, z: 0.00, yaw: Math.PI / 2, width: 5.2, elevation: 3.20 },
  { id: 6, label: 'Gate 06 - Turntable Cleared', x: 3.65, z: 0.00, yaw: Math.PI / 2, width: 5.2, elevation: 3.20 },
  { id: 7, label: 'Gate 07 - Descent Ramp Cleared', x: 11.20, z: 0.00, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 8, label: 'Gate 08 - Pendulum Gauntlet Cleared', x: 3.20, z: -6.75, yaw: -Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 9, label: 'Gate 09 - Suspension Bridges Cleared', x: -11.50, z: -6.75, yaw: -Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 10, label: 'Gate 10 - Fire Hazard Cleared', x: -0.20, z: -13.50, yaw: Math.PI / 2, width: 5.6, elevation: 0.05 },
  { id: 11, label: 'Gate 11 - Deep Water Basin Cleared', x: 10.50, z: -13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  { id: 12, label: 'Gate 12 - Grand Finish Line', x: 13.50, z: -13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
];

export const TRACK_B_OBSTACLES: TrackObstacle[] = [
  { id: 'start_bay', name: 'Starting Bay', kind: 'start', x: -20.5, z: 13.50, elevation: 0.0 },
  { id: 'slalom_hurdles', name: 'Precision Slaloms', kind: 'slalom', x: -8.0, z: 13.50, elevation: 0.0 },
  { id: 'speed_breakers', name: 'Speed Breakers', kind: 'speed_breakers', x: 2.2, z: 13.50, elevation: 0.0 },
  { id: 'rock_field', name: 'Sculpted Rock Field', kind: 'rockfield', x: 10.25, z: 13.50, elevation: ELEVATION_TIER_SMALL },
  { id: 'spiral_tower', name: 'Compact Cardboard Spiral Stake', kind: 'spiral', x: -4.50, z: 0.00, elevation: ELEVATION_TIER_MAJOR },
  { id: 'rooftop_turntable', name: 'Rooftop Turntable Platform', kind: 'turntable', x: 1.0, z: 0.00, elevation: ELEVATION_TIER_MAJOR },
  { id: 'swinging_pendulums', name: 'Swinging Pendulums Gauntlet', kind: 'bridge', x: 10.0, z: -6.75, elevation: ELEVATION_TIER_MEDIUM },
  { id: 'hanging_bridges', name: 'Dual Hanging Suspension Bridges', kind: 'planks', x: -4.2, z: -6.75, elevation: ELEVATION_TIER_MEDIUM },
  { id: 'fire_hazard', name: 'Refractory Fire Hearth', kind: 'fire', x: -3.0, z: -13.50, elevation: 0.38 },
  { id: 'water_basin', name: 'Deep Water Testing Basin', kind: 'water', x: 5.0, z: -13.50, elevation: -0.30 },
];

// ---------------------------------------------------------------------------
// TRACK DEFINITIONS A, B, C, D
// ---------------------------------------------------------------------------
export const TRACK_A: TrackConfig = {
  id: 'track_a',
  name: 'Track A — Basic Elevation Challenge',
  shortName: 'Basic Elevation',
  subtitle: 'Gentle Grades & Standard Bridges',
  description: 'Ground-level circuit featuring a short raised tabletop platform, Warren steel arch bridge, moderate descent, and the mandatory fire-water gauntlet.',
  hasSpiral: false,
  driveRoute: TRACK_B_ROUTE,
  checkpoints: TRACK_B_CHECKPOINTS,
  obstacles: [
    { id: 'start', name: 'Start Bay', kind: 'start', x: -20.5, z: 13.50, elevation: 0.0 },
    { id: 'slalom', name: 'Slalom Weave', kind: 'slalom', x: -8.0, z: 13.50, elevation: 0.0 },
    { id: 'tabletop', name: 'Raised Platform', kind: 'rockfield', x: 10.25, z: 13.50, elevation: ELEVATION_TIER_SMALL },
    { id: 'arch_bridge', name: 'Steel Arch Bridge', kind: 'bridge', x: 0.0, z: 0.0, elevation: ELEVATION_TIER_MEDIUM },
    { id: 'fire_hazard', name: 'Fire Obstacle', kind: 'fire', x: -3.0, z: -13.50, elevation: 0.38 },
    { id: 'water_basin', name: 'Water Obstacle', kind: 'water', x: 5.0, z: -13.50, elevation: -0.30 },
  ],
  elevationStats: { groundRatio: 0.78, elevatedRatio: 0.22, maxElevation: 0.95 },
  evaluateHeight: (x, z) => evaluateTrackHeight('track_a', x, z),
  evaluateSurface: (x, z) => evaluateTrackSurface('track_a', x, z),
};

export const TRACK_B: TrackConfig = {
  id: 'track_b',
  name: 'Track B — Spiral Tower Challenge',
  shortName: 'Spiral Tower',
  subtitle: 'Parking-Garage Multi-Level Climb',
  description: 'Ground-level circuit with large 450° spiral climbing ramp, elevated rooftop observation deck (+1.78m), connected downhill viaduct ramp, and final fire-water sequence.',
  hasSpiral: true,
  driveRoute: TRACK_B_ROUTE,
  checkpoints: TRACK_B_CHECKPOINTS,
  obstacles: TRACK_B_OBSTACLES,
  elevationStats: { groundRatio: 0.74, elevatedRatio: 0.26, maxElevation: 1.78 },
  evaluateHeight: (x, z, poseY) => evaluateTrackHeight('track_b', x, z, poseY),
  evaluateSurface: (x, z, poseY) => evaluateTrackSurface('track_b', x, z, poseY),
};

export const TRACK_C: TrackConfig = {
  id: 'track_c',
  name: 'Track C — Advanced Multi-Level Challenge',
  shortName: 'Multi-Level',
  subtitle: 'Multi-Tier Elevated Engineering',
  description: 'Several raised platforms, steep climbing ramp, multi-level spiral tower, elevated narrow bridge, and technical downhill return to ground.',
  hasSpiral: true,
  driveRoute: TRACK_B_ROUTE,
  checkpoints: TRACK_B_CHECKPOINTS,
  obstacles: [
    { id: 'start', name: 'Start Bay', kind: 'start', x: -20.5, z: 13.50, elevation: 0.0 },
    { id: 'rock_platform', name: 'Rock Platform', kind: 'rockfield', x: 10.25, z: 13.50, elevation: ELEVATION_TIER_SMALL },
    { id: 'spiral_tower', name: 'Multi-Level Spiral', kind: 'spiral', x: -3.5, z: 0.00, elevation: ELEVATION_TIER_MAJOR },
    { id: 'elevated_bridge', name: 'Narrow Viaduct Bridge', kind: 'bridge', x: 6.5, z: -6.75, elevation: ELEVATION_TIER_MEDIUM },
    { id: 'fire_hazard', name: 'Fire Hazard', kind: 'fire', x: -3.0, z: -13.50, elevation: 0.38 },
    { id: 'water_basin', name: 'Water Hazard', kind: 'water', x: 5.0, z: -13.50, elevation: -0.30 },
  ],
  elevationStats: { groundRatio: 0.72, elevatedRatio: 0.28, maxElevation: 1.78 },
  evaluateHeight: (x, z, poseY) => evaluateTrackHeight('track_c', x, z, poseY),
  evaluateSurface: (x, z, poseY) => evaluateTrackSurface('track_c', x, z, poseY),
};

export const TRACK_D: TrackConfig = {
  id: 'track_d',
  name: 'Track D — Extreme Climbing Challenge',
  shortName: 'Extreme Climb',
  subtitle: 'Switchback Ascents & Steep Descents',
  description: 'Challenging switchback climbs, elevated stepping platforms, large spiral structure with rooftop deck, steep gravity-accelerated descents, and fire-water climax.',
  hasSpiral: true,
  driveRoute: TRACK_B_ROUTE,
  checkpoints: TRACK_B_CHECKPOINTS,
  obstacles: [
    { id: 'start', name: 'Start Bay', kind: 'start', x: -20.5, z: 13.50, elevation: 0.0 },
    { id: 'switchback', name: 'Switchback Climb', kind: 'climbing_hill', x: 10.5, z: 6.75, elevation: 1.18 },
    { id: 'spiral_tower', name: 'Mega Spiral Structure', kind: 'spiral', x: -3.5, z: 0.00, elevation: ELEVATION_TIER_MAJOR },
    { id: 'stepping_planks', name: 'Elevated Stepping Planks', kind: 'planks', x: -3.5, z: -6.75, elevation: ELEVATION_TIER_MEDIUM },
    { id: 'fire_hazard', name: 'Fire Hazard', kind: 'fire', x: -3.0, z: -13.50, elevation: 0.38 },
    { id: 'water_basin', name: 'Water Hazard', kind: 'water', x: 5.0, z: -13.50, elevation: -0.30 },
  ],
  elevationStats: { groundRatio: 0.71, elevatedRatio: 0.29, maxElevation: 1.78 },
  evaluateHeight: (x, z, poseY) => evaluateTrackHeight('track_d', x, z, poseY),
  evaluateSurface: (x, z, poseY) => evaluateTrackSurface('track_d', x, z, poseY),
};

export const TRACK_DEFINITIONS: Record<TrackId, TrackConfig> = {
  track_a: TRACK_A,
  track_b: TRACK_B,
  track_c: TRACK_C,
  track_d: TRACK_D,
};

let currentActiveTrackId: TrackId = 'track_b';

export function getActiveTrack(): TrackConfig {
  return TRACK_DEFINITIONS[currentActiveTrackId] || TRACK_B;
}

export function setActiveTrack(id: TrackId): void {
  if (TRACK_DEFINITIONS[id]) {
    currentActiveTrackId = id;
  }
}

// ---------------------------------------------------------------------------
// TRACK-SPECIFIC EVALUATORS
// ---------------------------------------------------------------------------
export function evaluateTrackHeight(trackId: TrackId, x: number, z: number, poseY = 0): number {
  const halfW = DRIVE_ROUTE_WIDTH / 2; // 2.20m

  // 1. Check Spiral Ramp if present on this track (Track B, C, D)
  const track = TRACK_DEFINITIONS[trackId] || TRACK_B;
  if (track.hasSpiral) {
    const spiral = evaluateSpiralRamp(x, z, poseY);
    if (spiral.inSpiral) {
      return spiral.height;
    }
  }

  // 2. LANE 1: South Straight (Z = 13.50, Eastbound)
  if (Math.abs(z - 13.50) <= halfW) {
    // Start bay and approach on ground: -0.33m
    if (x < 5.80) {
      // Speed breakers: subtle bumps at ground level
      if (x >= 0.8 && x <= 3.6) {
        let bump = 0;
        for (const bx of SPEED_BREAKER_XS) {
          const d = Math.abs(x - bx);
          if (d < 0.45) bump = Math.max(bump, GROUND_DECK_HEIGHT + 0.09 * Math.cos((d / 0.45) * Math.PI * 0.5) ** 2);
        }
        if (bump > 0) return bump;
      }
      return GROUND_DECK_HEIGHT;
    }

    // Rock Field Platform (Elevated +0.45m tier with entry/exit ramps): x in [5.8, 14.8]
    if (x >= 5.80 && x <= 14.80) {
      // Entry ramp: x in [5.8, 6.4]
      if (x < 6.40) {
        const u = (x - 5.80) / 0.60;
        return GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL * u;
      }
      // Exit ramp: x in [14.2, 14.8]
      if (x > 14.20) {
        const u = (14.80 - x) / 0.60;
        return GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL * u;
      }
      // Platform top with boulders
      return GROUND_DECK_HEIGHT + ELEVATION_TIER_SMALL + evaluateRockHeight(x, z);
    }

    // Lane 1 straightaway to Hairpin 1: ground level
    if (x > 14.80 && x <= 17.50) {
      return GROUND_DECK_HEIGHT;
    }
  }

  // 3. HAIRPIN 1: Ground-level Semicircular Viaduct
  if (x >= 17.0 && z >= 6.5 && z <= 13.7) {
    const r = Math.hypot(x - 17.50, z - 10.125);
    if (r >= 1.15 && r <= 5.60) return GROUND_DECK_HEIGHT;
  }

  // 4. LANE 2: Mid-South Straight (Z = 6.75, Westbound)
  if (Math.abs(z - 6.75) <= halfW) {
    if (trackId === 'track_d') {
      // Switchback climb on Track D: x in [6.5, 14.5]
      const hClimb = hillHeightAt(x, z);
      if (hClimb !== null) return hClimb;
    }
    // Ground level driving corridor
    if (x >= -17.5 && x <= 17.5) {
      return GROUND_DECK_HEIGHT;
    }
  }

  // 5. HAIRPIN 2: Ground-level Semicircular Viaduct
  if (x <= -17.0 && z >= -0.2 && z <= 7.0) {
    const r = Math.hypot(x - (-17.50), z - 3.375);
    if (r >= 1.15 && r <= 5.60) return GROUND_DECK_HEIGHT;
  }

  // 6. LANE 3: Center Straight (Z = 0.00, Eastbound)
  if (Math.abs(z - 0.00) <= halfW) {
    if (!track.hasSpiral) {
      // Track A: Arch bridge crowned deck
      if (x >= -6.0 && x <= 6.0) {
        const u = Math.abs(x) / 6.0;
        return GROUND_DECK_HEIGHT + ELEVATION_TIER_MEDIUM * (1 - u * u);
      }
    }
    if (x >= -17.5 && x <= 17.5) {
      return GROUND_DECK_HEIGHT;
    }
  }

  // 7. HAIRPIN 3: Ground-level Semicircular Viaduct
  if (x >= 17.0 && z >= -7.0 && z <= 0.2) {
    const r = Math.hypot(x - 17.50, z - (-3.375));
    if (r >= 1.15 && r <= 5.60) return GROUND_DECK_HEIGHT;
  }

  // 8. LANE 4: Mid-North Straight (Z = -6.75, Westbound)
  if (Math.abs(z - (-6.75)) <= halfW) {
    // A. Obstacle 1: Swinging Pendulums Gauntlet (x in [6.5, 14.5])
    if (x >= PENDULUM_CONFIG.xExitEnd && x <= PENDULUM_CONFIG.xEntryStart) {
      const halfTrackW = PENDULUM_CONFIG.deckWidth / 2; // 1.00m (2.00m comfortable catwalk bridge)
      const inNarrowCorridor = Math.abs(z - PENDULUM_CONFIG.zLane) <= halfTrackW;

      if (inNarrowCorridor) {
        // Ascent ramp (East side, x in [14.50, 16.20]): Westbound vehicle climbs up from ground -0.33 to 1.35m
        if (x > PENDULUM_CONFIG.xRampUpEnd) {
          const u = (PENDULUM_CONFIG.xEntryStart - x) / (PENDULUM_CONFIG.xEntryStart - PENDULUM_CONFIG.xRampUpEnd);
          const eased = u * u * (3 - 2 * u);
          return GROUND_DECK_HEIGHT + (PENDULUM_CONFIG.deckY - GROUND_DECK_HEIGHT) * eased;
        }
        // Descent ramp (West side, x in [3.80, 5.50]): Westbound vehicle descends from 1.35m to ground -0.33m
        if (x < PENDULUM_CONFIG.xRampDownStart) {
          const u = (x - PENDULUM_CONFIG.xExitEnd) / (PENDULUM_CONFIG.xRampDownStart - PENDULUM_CONFIG.xExitEnd);
          const eased = u * u * (3 - 2 * u);
          return GROUND_DECK_HEIGHT + (PENDULUM_CONFIG.deckY - GROUND_DECK_HEIGHT) * eased;
        }
        // Elevated catwalk bridge deck: x in [5.50, 14.50]
        if (poseY < 0 && poseY < PENDULUM_CONFIG.deckY - 0.50) {
          return GROUND_DECK_HEIGHT;
        }
        return PENDULUM_CONFIG.deckY;
      }

      // If robot is outside catwalk bridge deck while elevated: it falls down into the cutaway chasm / arena floor!
      if (poseY > GROUND_DECK_HEIGHT + 0.15) {
        return ARENA_FLOOR_HEIGHT;
      }
      return GROUND_DECK_HEIGHT;
    }

    // B. Ground transition link between obstacles: x in [2.40, 3.80]
    if (x > HANGING_BRIDGE_CONFIG.xEntryStart && x < PENDULUM_CONFIG.xExitEnd) {
      return GROUND_DECK_HEIGHT;
    }

    // C. Obstacle 2: Dual Hanging Suspension Bridges (x in [-10.80, 2.40])
    if (x >= HANGING_BRIDGE_CONFIG.xExitEnd && x <= HANGING_BRIDGE_CONFIG.xEntryStart) {
      const halfBridgeW = HANGING_BRIDGE_CONFIG.totalDeckWidth / 2; // 1.30m corridor width
      const inBridgeCorridor = Math.abs(z - HANGING_BRIDGE_CONFIG.zLane) <= halfBridgeW;

      if (inBridgeCorridor) {
        // Ascent ramp (East side, x in [0.80, 2.40]): Westbound vehicle climbs up from ground -0.33 to 0.80
        if (x > HANGING_BRIDGE_CONFIG.xBridgeEast) {
          const u = (HANGING_BRIDGE_CONFIG.xEntryStart - x) / (HANGING_BRIDGE_CONFIG.xEntryStart - HANGING_BRIDGE_CONFIG.xBridgeEast);
          const eased = u * u * (3 - 2 * u);
          return GROUND_DECK_HEIGHT + (HANGING_BRIDGE_CONFIG.deckY - GROUND_DECK_HEIGHT) * eased;
        }
        // Descent ramp (West side, x in [-10.80, -9.20]): Westbound vehicle descends from 0.80 to ground -0.33
        if (x < HANGING_BRIDGE_CONFIG.xBridgeWest) {
          const u = (x - HANGING_BRIDGE_CONFIG.xExitEnd) / (HANGING_BRIDGE_CONFIG.xBridgeWest - HANGING_BRIDGE_CONFIG.xExitEnd);
          const eased = u * u * (3 - 2 * u);
          return GROUND_DECK_HEIGHT + (HANGING_BRIDGE_CONFIG.deckY - GROUND_DECK_HEIGHT) * eased;
        }
        // Dual Suspended Deck Spans: x in [-9.20, 0.80] (Length 10.0m)
        if (poseY < 0 && poseY < HANGING_BRIDGE_CONFIG.deckY - 0.50) {
          return GROUND_DECK_HEIGHT;
        }
        const spanMid = x >= HANGING_BRIDGE_CONFIG.xBridgeMid
          ? (HANGING_BRIDGE_CONFIG.xBridgeEast + HANGING_BRIDGE_CONFIG.xBridgeMid) / 2
          : (HANGING_BRIDGE_CONFIG.xBridgeMid + HANGING_BRIDGE_CONFIG.xBridgeWest) / 2;
        const spanHalfLen = 2.50;
        const normDist = Math.min(1, Math.abs(x - spanMid) / spanHalfLen);
        const deflection = HANGING_BRIDGE_CONFIG.catenarySag * (1 - normDist * normDist);
        return HANGING_BRIDGE_CONFIG.deckY - deflection;
      }

      // If driven off bridge edge: falls to ground
      if (poseY > GROUND_DECK_HEIGHT + 0.15 && x >= HANGING_BRIDGE_CONFIG.xBridgeWest && x <= HANGING_BRIDGE_CONFIG.xBridgeEast) {
        return ARENA_FLOOR_HEIGHT;
      }
      return GROUND_DECK_HEIGHT;
    }

    // D. Ground runway approaching Hairpin 4: x in [-17.5, 17.5]
    if (x >= -17.5 && x <= 17.5) {
      return GROUND_DECK_HEIGHT;
    }
  }

  // 9. HAIRPIN 4: Ground-level Semicircular Viaduct
  if (x <= -17.0 && z >= -13.7 && z <= -6.5) {
    const r = Math.hypot(x - (-17.50), z - (-10.125));
    if (r >= 1.15 && r <= 5.60) return GROUND_DECK_HEIGHT;
  }

  // 10. LANE 5: North Finishing Straight (Z = -13.50, Eastbound) - MANDATORY SEQUENCE: FIRE -> WATER -> FINISH
  if (Math.abs(z - (-13.50)) <= halfW) {
    // Approach: ground level
    if (x < -5.50) return GROUND_DECK_HEIGHT;

    // A. Fire Hazard (Elevated refractory hearth): x in [-5.0, -1.0]
    if (x >= -5.0 && x <= -1.0) {
      return 0.05; // Raised refractory bed (+0.38m above ground)
    }

    // B. Heat-Shield Cooling Bridge: x in [-1.0, 0.5]
    if (x > -1.0 && x < 0.5) {
      return 0.05;
    }

    // C. Deep Water Basin: x in [0.5, 9.5]
    // Entry ramp: x in [0.5, 2.0] slopes from 0.05m down to -0.30m
    if (x >= 0.5 && x < 2.0) {
      const u = (x - 0.5) / 1.5;
      const eased = u * u * (3 - 2 * u);
      return 0.05 + (-0.30 - 0.05) * eased;
    }
    // Submerged pool floor: x in [2.0, 8.0]
    if (x >= 2.0 && x <= 8.0) {
      return -0.30;
    }
    // Exit ramp: x in [8.0, 9.5] slopes from -0.30m to ground -0.33m
    if (x > 8.0 && x <= 9.5) {
      const u = (x - 8.0) / 1.5;
      return -0.30 + (GROUND_DECK_HEIGHT - (-0.30)) * u;
    }

    // Finishing straight and run-off: ground level
    if (x > 9.5 && x <= 16.5) {
      return GROUND_DECK_HEIGHT;
    }
  }

  // Off-road / chasm falls to arena floor
  return ARENA_FLOOR_HEIGHT;
}

export function evaluateTrackSurface(trackId: TrackId, x: number, z: number, poseY = 0): SurfaceProperties {
  const halfW = DRIVE_ROUTE_WIDTH / 2;

  // 1. Spiral Ramp surface
  const track = TRACK_DEFINITIONS[trackId] || TRACK_B;
  if (track.hasSpiral) {
    const spiral = evaluateSpiralRamp(x, z, poseY);
    if (spiral.inSpiral) {
      return { grip: spiral.grip, rollingResistance: 0.28, hazard: 'none' };
    }
  }

  // 2. Final Mandatory Sequence on Lane 5 (Z = -13.50):
  if (Math.abs(z - (-13.50)) <= halfW) {
    // Fire Hazard: x in [-5.0, -1.0]
    if (x >= -5.0 && x <= -1.0) {
      return { grip: 0.92, rollingResistance: 0.35, hazard: 'fire' };
    }
    // Cooling Bridge: x in [-1.0, 0.5]
    if (x > -1.0 && x < 0.5) {
      return { grip: 0.90, rollingResistance: 0.32, hazard: 'none' };
    }
    // Deep Water Basin: x in [0.5, 9.5]
    if (x >= 0.5 && x <= 9.5) {
      return { grip: 0.52, rollingResistance: 0.75, hazard: 'water' };
    }
  }

  // 3. Lane 1 Rock Field
  if (Math.abs(z - 13.50) <= halfW && x >= 5.8 && x <= 14.8) {
    return { grip: 0.65, rollingResistance: 1.50, hazard: 'none' };
  }

  // 4. Lane 2 Slippery Steel
  if (Math.abs(z - 6.75) <= halfW && x >= -14.0 && x <= -9.5) {
    return { grip: 0.22, rollingResistance: 0.15, hazard: 'none' };
  }

  // 5. Lane 4 Elevated Obstacles (Swinging Pendulum Steel Deck & Dual Hanging Bridge)
  if (Math.abs(z - (-6.75)) <= halfW) {
    if (x >= PENDULUM_CONFIG.xExitEnd && x <= PENDULUM_CONFIG.xEntryStart) {
      return { grip: 1.05, rollingResistance: 0.28, hazard: 'none' };
    }
    if (x >= HANGING_BRIDGE_CONFIG.xExitEnd && x <= HANGING_BRIDGE_CONFIG.xEntryStart) {
      return { grip: 0.95, rollingResistance: 0.32, hazard: 'none' };
    }
  }

  // Default clean arena ground concrete
  return { grip: 1.05, rollingResistance: 0.30, hazard: 'none' };
}

// ---------------------------------------------------------------------------
// GLOBAL COMPATIBILITY WRAPPERS
// ---------------------------------------------------------------------------
export function evaluateCourseHeight(x: number, z: number, poseY = 0): number {
  return evaluateTrackHeight(currentActiveTrackId, x, z, poseY);
}

export function evaluateCourseSurface(x: number, z: number, poseY = 0): SurfaceProperties {
  return evaluateTrackSurface(currentActiveTrackId, x, z, poseY);
}

// Dynamic properties reflecting the active track
export const DRIVE_ROUTE: CoursePoint[] = TRACK_B_ROUTE;
export const CHECKPOINTS: CheckpointGate[] = TRACK_B_CHECKPOINTS;

// ---------------------------------------------------------------------------
// SLALOM, SPEED BREAKERS, ROCK FIELD STONES & HILL NODES
// ---------------------------------------------------------------------------
export const SLALOM_BLOCKS = Array.from({ length: 5 }, (_, i) => {
  const side = i % 2 === 0 ? 'left' as const : 'right' as const;
  const span = DRIVE_ROUTE_WIDTH / 2; // 2.20m: expands width of all 5 brick hurdles up to the road center
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

export const HILL_DECK_WIDTH = 4.40;
export const HILL_ENTRY_LINK: CoursePoint[] = [{ x: 14.5, z: 6.75 }, { x: 11.5, z: 6.75 }];
export const HILL_EXIT_LINK: CoursePoint[] = [{ x: 9.5, z: 6.75 }, { x: 6.5, z: 6.75 }];

export const HILL_NODES: HillNode[] = [
  { x: 14.5, z: 6.75, y: GROUND_DECK_HEIGHT },
  { x: 11.5, z: 6.75, y: GROUND_DECK_HEIGHT + 1.18 },
  { x: 9.5, z: 6.75, y: GROUND_DECK_HEIGHT + 1.18 },
  { x: 6.5, z: 6.75, y: GROUND_DECK_HEIGHT },
];

export const HILL_SEGMENTS: HillSegment[] = [];
for (let i = 0; i < HILL_NODES.length - 1; i++) {
  HILL_SEGMENTS.push({
    a: HILL_NODES[i],
    b: HILL_NODES[i + 1],
    width: HILL_DECK_WIDTH,
  });
}

export function hillHeightAt(x: number, z: number): number | null {
  if (Math.abs(z - 6.75) > HILL_DECK_WIDTH / 2) return null;
  if (x > 14.5 || x < 6.5) return null;

  if (x >= 11.5 && x <= 14.5) {
    const u = (14.5 - x) / 3.0;
    const eased = u * u * (3 - 2 * u);
    return GROUND_DECK_HEIGHT + 1.18 * eased;
  }
  if (x >= 9.5 && x < 11.5) {
    return GROUND_DECK_HEIGHT + 1.18;
  }
  if (x >= 6.5 && x < 9.5) {
    const u = (x - 6.5) / 3.0;
    const eased = u * u * (3 - 2 * u);
    return GROUND_DECK_HEIGHT + 1.18 * eased;
  }
  return null;
}

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

export function generateRockFieldStones(seed = 20261027): StoneData[] {
  const rng = createDeterministicRNG(seed);
  const stones: StoneData[] = [];

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
        s = 0.18 + rng() * 0.09;
      } else if (sizeCategory > 0.35) {
        s = 0.12 + rng() * 0.05;
      } else {
        s = 0.06 + rng() * 0.04;
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
  return { valid: issues.length === 0, issues };
}

export function crossesCheckpointGate(
  previous: CoursePoint,
  current: CoursePoint,
  gate: CheckpointGate,
  worldScale = MAP_SCALE,
  vehicleWidth = 1.98,
  poseY?: number,
): boolean {
  if (gate.elevation !== undefined && poseY !== undefined) {
    if (Math.abs(poseY - gate.elevation) > 1.25) {
      return false;
    }
  }
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

export function validateRouteClearance(colliders: CourseCollider[], robotWidth = 1.9): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const cp of CHECKPOINTS) {
    const cpX = cp.x * MAP_SCALE;
    const cpZ = cp.z * MAP_SCALE;
    for (const c of colliders) {
      if (c.walkable) continue;
      // 3D vertical elevation clearance: under-deck piers or ground objects below an elevated gate do not obstruct it
      if (cp.elevation !== undefined) {
        const gateBottom = cp.elevation - 0.20;
        const gateTop = cp.elevation + 2.00;
        const colliderBottom = c.y - c.height / 2;
        const colliderTop = c.y + c.height / 2;
        if (colliderTop < gateBottom || colliderBottom > gateTop) continue;
      }
      const dx = cpX - c.x * MAP_SCALE;
      const dz = cpZ - c.z * MAP_SCALE;
      const dist = Math.hypot(dx, dz);
      if (dist < (robotWidth * 0.5 + 0.3) * MAP_SCALE) {
        issues.push(`Collider "${c.id}" intrudes on checkpoint ${cp.label} at distance ${dist.toFixed(2)}m`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}
