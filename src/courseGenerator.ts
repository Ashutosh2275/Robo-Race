import { TRACK_WIDTH, type WaterPoolConfig } from './vehicleDynamics.ts';
import {
  ARENA_FLOOR_HEIGHT,
  GROUND_DECK_HEIGHT,
  DRIVE_ROUTE_WIDTH,
  ELEVATION_TIER_SMALL,
  HANGING_SAND_PIT_Y,
  MAP_SCALE,
  createDeterministicRNG,
  easeCushionedRamp,
  registerDynamicCourseHooks,
  type CheckpointGate,
  type SurfaceProperties,
  type TrackId,
} from './courseLayout.ts';

export type HurdleTier = 'easy' | 'medium' | 'hard';

export type HurdleType =
  | 'brick_slalom'
  | 'rock_scramble'
  | 'roller_logs'
  | 'rumble_washboard'
  | 'fire_hearth'
  | 'water_basin'
  | 'football_arena'
  | 'seesaw_bridge'
  | 'speed_humps_ice'
  | 'high_climb'
  | 'oil_chicane'
  | 'turntable_deck'
  | 'pendulum_bridge'
  | 'hanging_bridges'
  | 'spiral_tower';

export type HurdleMeta = {
  type: HurdleType;
  label: string;
  tier: HurdleTier;
  basePoints: number;
  halfLen: number;
  isFullLane?: boolean;
  halfWidth: number;
  footballBalls?: number;
};

export const HURDLE_CATALOG: Record<HurdleType, HurdleMeta> = {
  brick_slalom: { type: 'brick_slalom', label: 'Brick Wall Slalom', tier: 'easy', basePoints: 10, halfLen: 5.4, halfWidth: 2.2 },
  rock_scramble: { type: 'rock_scramble', label: 'Sculpted Rock Field', tier: 'easy', basePoints: 10, halfLen: 4.8, halfWidth: 2.2 },
  roller_logs: { type: 'roller_logs', label: 'Articulated Roller Logs', tier: 'easy', basePoints: 10, halfLen: 4.6, halfWidth: 2.2 },
  rumble_washboard: { type: 'rumble_washboard', label: 'Chevron Rumble Wash', tier: 'easy', basePoints: 10, halfLen: 4.5, halfWidth: 2.2 },
  fire_hearth: { type: 'fire_hearth', label: 'Refractory Fire Hearth', tier: 'easy', basePoints: 10, halfLen: 3.2, halfWidth: 2.2 },
  water_basin: { type: 'water_basin', label: 'Deep Water Basin', tier: 'easy', basePoints: 10, halfLen: 4.8, halfWidth: 2.2 },
  football_arena: { type: 'football_arena', label: 'Football Goal Arena', tier: 'medium', basePoints: 20, halfLen: 4.5, halfWidth: 3.85, footballBalls: 5 },
  seesaw_bridge: { type: 'seesaw_bridge', label: 'Seesaw Balance Bridge', tier: 'medium', basePoints: 20, halfLen: 5.2, halfWidth: 2.2 },
  speed_humps_ice: { type: 'speed_humps_ice', label: 'Mega Humps & Ice Sheet', tier: 'medium', basePoints: 20, halfLen: 5.8, halfWidth: 2.2 },
  high_climb: { type: 'high_climb', label: 'High-Incline Zigzag Ramp', tier: 'medium', basePoints: 20, halfLen: 5.0, halfWidth: 2.6 },
  oil_chicane: { type: 'oil_chicane', label: 'Oil Slick & Tire Chicane', tier: 'medium', basePoints: 20, halfLen: 5.0, halfWidth: 2.2 },
  turntable_deck: { type: 'turntable_deck', label: 'Rotating Turntable Deck', tier: 'medium', basePoints: 20, halfLen: 5.4, halfWidth: 2.45 },
  pendulum_bridge: { type: 'pendulum_bridge', label: 'Swinging Pendulum Bridge', tier: 'hard', basePoints: 30, halfLen: 6.0, halfWidth: 1.0 },
  hanging_bridges: { type: 'hanging_bridges', label: 'Twin Hanging Bridges', tier: 'hard', basePoints: 30, halfLen: 6.2, halfWidth: 2.2 },
  spiral_tower: { type: 'spiral_tower', label: '540° Spiral Tower Climb', tier: 'hard', basePoints: 30, halfLen: 12.2, isFullLane: true, halfWidth: 3.45 },
};

export type ArenaMetadata = {
  id: TrackId;
  name: string;
  tagline: string;
  tierLabel: string;
  includeFootballChance: number;
  targetMinPts: number;
  targetMaxPts: number;
};

export const ARENA_METADATA: Record<TrackId, ArenaMetadata> = {
  track_b: {
    id: 'track_b',
    name: 'Vanguard Proving Ground',
    tagline: 'Balanced mixed hazards, bridges & football arena',
    tierLabel: 'Balanced',
    includeFootballChance: 1.0,
    targetMinPts: 110,
    targetMaxPts: 145,
  },
  track_a: {
    id: 'track_a',
    name: 'Apex Steelworks',
    tagline: 'Precision weaves, balance bridges & goal arena',
    tierLabel: 'Technical',
    includeFootballChance: 1.0,
    targetMinPts: 100,
    targetMaxPts: 135,
  },
  track_c: {
    id: 'track_c',
    name: 'Helios Gauntlet',
    tagline: 'Aerial bridges, spiral climb & speed runs',
    tierLabel: 'Aerial',
    includeFootballChance: 0.9,
    targetMinPts: 115,
    targetMaxPts: 145,
  },
  track_d: {
    id: 'track_d',
    name: 'Titan Crucible',
    tagline: 'Steep climbs, slick chicanes & heavy crossings',
    tierLabel: 'Intense',
    includeFootballChance: 0.85,
    targetMinPts: 125,
    targetMaxPts: 150,
  },
};

export type RockStoneLocal = {
  u: number;
  v: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotY: number;
  paletteIndex: number;
};

export type HurdleSlot = {
  index: number;
  gateId: number;
  laneIndex: number; // 1..5
  laneZ: number;
  centerX: number;
  dir: 1 | -1; // +1 Eastbound, -1 Westbound
  type: HurdleType;
  meta: HurdleMeta;
  halfLen: number;
  entryX: number;
  exitX: number;
  gateX: number;
  rockStones?: RockStoneLocal[];
  footballBallCount?: number;
};

export type GeneratedCourse = {
  trackId: TrackId;
  seed: number;
  arenaName: string;
  slots: HurdleSlot[];
  checkpoints: CheckpointGate[];
  totalBasePoints: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  waterPools: WaterPoolConfig[];
  turntables: { x: number; z: number; radius: number; deckY: number }[];
  seesawStates: Record<number, number>; // slotIndex -> tiltAngle rad (-0.11..+0.11)
};

type LaneCandidateSlot = {
  laneIndex: number;
  laneZ: number;
  centerX: number;
  dir: 1 | -1;
};

const STANDARD_LANE_SLOTS: LaneCandidateSlot[] = [
  // Driving order along serpentine course:
  { laneIndex: 1, laneZ: 13.50, centerX: -8.25, dir: 1 },
  { laneIndex: 1, laneZ: 13.50, centerX: 8.25, dir: 1 },
  { laneIndex: 2, laneZ: 6.75, centerX: 8.25, dir: -1 },
  { laneIndex: 2, laneZ: 6.75, centerX: -8.25, dir: -1 },
  { laneIndex: 3, laneZ: 0.00, centerX: -8.25, dir: 1 },
  { laneIndex: 3, laneZ: 0.00, centerX: 8.25, dir: 1 },
  { laneIndex: 4, laneZ: -6.75, centerX: 8.25, dir: -1 },
  { laneIndex: 4, laneZ: -6.75, centerX: -8.25, dir: -1 },
  { laneIndex: 5, laneZ: -13.50, centerX: -9.50, dir: 1 },
  { laneIndex: 5, laneZ: -13.50, centerX: 3.40, dir: 1 },
];

const ALL_HURDLE_TYPES = Object.keys(HURDLE_CATALOG) as HurdleType[];
const HARD_TYPES = ALL_HURDLE_TYPES.filter(t => HURDLE_CATALOG[t].tier === 'hard');
const MEDIUM_TYPES = ALL_HURDLE_TYPES.filter(t => HURDLE_CATALOG[t].tier === 'medium');
const EASY_TYPES = ALL_HURDLE_TYPES.filter(t => HURDLE_CATALOG[t].tier === 'easy');

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildSlotRocks(seed: number): RockStoneLocal[] {
  const rand = createDeterministicRNG(seed ^ 0x5f3759df);
  const stones: RockStoneLocal[] = [];
  for (let i = 0; i < 82; i++) {
    const u = -3.35 + rand() * 6.70;
    const v = (rand() - 0.5) * 3.85;
    stones.push({
      u,
      v,
      scaleX: 0.24 + rand() * 0.44,
      scaleY: 0.14 + rand() * 0.22,
      scaleZ: 0.22 + rand() * 0.42,
      rotY: rand() * Math.PI * 2,
      paletteIndex: Math.floor(rand() * 4),
    });
  }
  return stones;
}

/**
 * Generates a unique, non-repeating randomized hurdle obstacle sequence for the given arena.
 * Guarantees zero duplicate hurdles, a spatial mix across first/middle/last lanes,
 * presence of Football Arena in most runs, and total points in [100, 150].
 */
export function generateRandomizedCourse(trackId: TrackId, seed: number): GeneratedCourse {
  const arena = ARENA_METADATA[trackId] || ARENA_METADATA.track_b;
  const rand = createDeterministicRNG(seed);

  const chosen = new Set<HurdleType>();
  const picked: HurdleType[] = [];

  // 1. Most runs include the Football Goal Arena (4-5 tennis balls, bonus up to +2)
  if (rand() < arena.includeFootballChance) {
    chosen.add('football_arena');
    picked.push('football_arena');
  }

  // 2. Always guarantee at least 2 Easy (10 pts) hurdles so all 3 difficulty tiers mix cleanly
  const easyPool = shuffleInPlace([...EASY_TYPES], rand);
  const baseEasyCount = trackId === 'track_a' ? 3 : 2;
  for (let i = 0; i < baseEasyCount && i < easyPool.length; i++) {
    chosen.add(easyPool[i]);
    picked.push(easyPool[i]);
  }

  // 3. Pick 1-3 Hard (30 pts) hurdles while leaving budget for >= 2 Medium hurdles
  const hardPool = shuffleInPlace([...HARD_TYPES], rand);
  const wantHard = trackId === 'track_d' ? (rand() < 0.55 ? 3 : 2) : trackId === 'track_a' ? (rand() < 0.55 ? 2 : 1) : 2;
  const currentPts = () => picked.reduce((acc, t) => acc + HURDLE_CATALOG[t].basePoints, 0);
  for (let i = 0; i < wantHard && i < hardPool.length; i++) {
    const medCount = picked.filter(t => HURDLE_CATALOG[t].tier === 'medium').length;
    const minMedReserve = Math.max(0, 2 - medCount) * 20;
    if (!chosen.has(hardPool[i]) && currentPts() + 30 + minMedReserve <= 150) {
      chosen.add(hardPool[i]);
      picked.push(hardPool[i]);
    }
  }

  // 4. Pick Medium (20 pts) hurdles up to tier target
  const medPool = shuffleInPlace([...MEDIUM_TYPES], rand);
  const wantMed = trackId === 'track_a' ? 3 : 2 + (rand() < 0.45 ? 1 : 0);
  for (const m of medPool) {
    if (picked.filter(t => HURDLE_CATALOG[t].tier === 'medium').length >= wantMed) break;
    if (!chosen.has(m) && currentPts() + 20 <= 150 && picked.length < 8) {
      chosen.add(m);
      picked.push(m);
    }
  }

  // 5. Fill remaining budget up to target points [100..150] using additional Easy (10 pts) hurdles
  const targetPts = arena.targetMinPts + Math.floor(rand() * (arena.targetMaxPts - arena.targetMinPts + 1));

  for (const e of easyPool) {
    if (currentPts() >= targetPts && currentPts() >= 100) break;
    if (picked.length >= 9) break;
    if (!chosen.has(e) && currentPts() + 10 <= 150) {
      chosen.add(e);
      picked.push(e);
    }
  }

  // Top up if under 100 pts (only possible if randomized target was low)
  for (const m of medPool) {
    if (currentPts() >= 100) break;
    if (!chosen.has(m) && currentPts() + 20 <= 150 && picked.length < 9) {
      chosen.add(m);
      picked.push(m);
    }
  }
  for (const e of easyPool) {
    if (currentPts() >= 100) break;
    if (!chosen.has(e) && currentPts() + 10 <= 150 && picked.length < 9) {
      chosen.add(e);
      picked.push(e);
    }
  }

  // 5. Shuffle hurdle order so bridges, climbs, football, or spirals can land FIRST, MIDDLE, or LAST!
  shuffleInPlace(picked, rand);

  // 6. Assign ordered hurdles cleanly onto driving lane slots along Lanes 1..5
  const hasSpiral = picked.includes('spiral_tower');
  // Choose which full lane (1, 2, 3, or 4) hosts the Spiral Tower if present
  const spiralLane = hasSpiral ? [1, 2, 3, 4][Math.floor(rand() * 4)] : -1;

  // Build ordered slot positions from our 5-lane sequence
  const candidatePositions: Array<{ laneIndex: number; laneZ: number; centerX: number; dir: 1 | -1; forSpiral: boolean }> = [];
  for (const lane of [1, 2, 3, 4, 5]) {
    const laneMeta = STANDARD_LANE_SLOTS.filter(s => s.laneIndex === lane);
    if (lane === spiralLane) {
      // Spiral occupies the entire straight of this lane smoothly
      candidatePositions.push({
        laneIndex: lane,
        laneZ: laneMeta[0].laneZ,
        centerX: 0.0,
        dir: laneMeta[0].dir,
        forSpiral: true,
      });
    } else {
      for (const s of laneMeta) {
        candidatePositions.push({ ...s, forSpiral: false });
      }
    }
  }

  const slots: HurdleSlot[] = [];
  const waterPools: WaterPoolConfig[] = [];
  const turntables: { x: number; z: number; radius: number; deckY: number }[] = [];
  const seesawStates: Record<number, number> = {};

  // Pair Spiral onto full-lane slot and standard hurdles onto ordered standard slots
  const standardPicked = picked.filter(t => t !== 'spiral_tower');
  const standardSlotIndices: number[] = [];
  candidatePositions.forEach((pos, idx) => {
    if (!pos.forSpiral) standardSlotIndices.push(idx);
  });

  // Spread standard hurdles evenly across available standard slots (including early Lane 1 & late Lane 5 slots!)
  const chosenStdSlots = new Set<number>();
  if (standardPicked.length <= standardSlotIndices.length) {
    // Ensure randomized spread across start, middle, and late lanes
    const pool = shuffleInPlace([...standardSlotIndices], rand)
      .slice(0, standardPicked.length)
      .sort((a, b) => a - b);
    for (const i of pool) chosenStdSlots.add(i);
  }

  let stdCursor = 0;
  let gateIdCounter = 2; // Gate 01 is Start straight; last gate is Grand Finish

  candidatePositions.forEach((pos, idx) => {
    let type: HurdleType | null = null;
    if (pos.forSpiral && hasSpiral) {
      type = 'spiral_tower';
    } else if (!pos.forSpiral && chosenStdSlots.has(idx) && stdCursor < standardPicked.length) {
      type = standardPicked[stdCursor++];
    }
    if (!type) return;

    const meta = HURDLE_CATALOG[type];
    const halfLen = meta.halfLen;
    const slotIndex = slots.length;
    const entryX = pos.centerX - pos.dir * halfLen;
    const exitX = pos.centerX + pos.dir * halfLen;
    const gateX = Math.max(-16.2, Math.min(16.2, pos.centerX + pos.dir * (halfLen + 0.65)));

    const slot: HurdleSlot = {
      index: slotIndex,
      gateId: gateIdCounter++,
      laneIndex: pos.laneIndex,
      laneZ: pos.laneZ,
      centerX: pos.centerX,
      dir: pos.dir,
      type,
      meta,
      halfLen,
      entryX,
      exitX,
      gateX,
      ...(type === 'rock_scramble' ? { rockStones: buildSlotRocks(seed + idx * 97) } : {}),
      ...(type === 'football_arena' ? { footballBallCount: rand() < 0.35 ? 4 : 5 } : {}),
    };
    slots.push(slot);

    if (type === 'water_basin') {
      const xA = pos.centerX - 4.4;
      const xB = pos.centerX + 4.4;
      waterPools.push({
        xMin: xA,
        xMax: xB,
        zCenter: pos.laneZ,
        width: DRIVE_ROUTE_WIDTH,
        waterLevelY: 0.16,
        bedLevelY: -0.30,
      });
    } else if (type === 'turntable_deck') {
      turntables.push({
        x: pos.centerX,
        z: pos.laneZ,
        radius: 2.30,
        deckY: 0.92,
      });
    } else if (type === 'spiral_tower') {
      turntables.push({
        x: pos.centerX + pos.dir * 2.20,
        z: pos.laneZ,
        radius: 2.35,
        deckY: 3.20,
      });
    } else if (type === 'seesaw_bridge') {
      seesawStates[slotIndex] = 0.11; // Entry end tilted smoothly down toward approaching robot
    }
  });

  // Build Checkpoints cleanly: Gate 01 (Start) -> 1 gate per placed hurdle -> Grand Finish Gate
  const checkpoints: CheckpointGate[] = [
    { id: 1, label: 'Gate 01 - Start Line', x: -17.5, z: 13.50, yaw: Math.PI / 2, width: 5.6, elevation: -0.33 },
  ];
  for (const s of slots) {
    checkpoints.push({
      id: s.gateId,
      label: `Gate ${String(s.gateId).padStart(2, '0')} - ${s.meta.label}`,
      x: s.gateX,
      z: s.laneZ,
      yaw: s.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      width: s.type === 'high_climb' ? 6.2 : 5.6,
      elevation: -0.33,
    });
  }
  const finishId = gateIdCounter;
  checkpoints.push({
    id: finishId,
    label: `Gate ${String(finishId).padStart(2, '0')} - Grand Finish`,
    x: 13.50,
    z: -13.50,
    yaw: Math.PI / 2,
    width: 5.6,
    elevation: -0.33,
  });

  const easyCount = slots.filter(s => s.meta.tier === 'easy').length;
  const mediumCount = slots.filter(s => s.meta.tier === 'medium').length;
  const hardCount = slots.filter(s => s.meta.tier === 'hard').length;
  const totalBasePoints = slots.reduce((sum, s) => sum + s.meta.basePoints, 0);

  return {
    trackId,
    seed,
    arenaName: arena.name,
    slots,
    checkpoints,
    totalBasePoints,
    easyCount,
    mediumCount,
    hardCount,
    waterPools,
    turntables,
    seesawStates,
  };
}

// ---------------------------------------------------------------------------
// Active Generated Course Global Hook (null preserves default static layout)
// ---------------------------------------------------------------------------
let activeGeneratedCourse: GeneratedCourse | null = null;

export function setActiveGeneratedCourse(course: GeneratedCourse | null): void {
  activeGeneratedCourse = course;
  if (course) {
    registerDynamicCourseHooks({
      evaluateHeight: evaluateDynamicCourseHeight,
      evaluateSurface: evaluateDynamicCourseSurface,
      evaluateRock: evaluateDynamicRockHeight,
      isWithinBoundary: isWithinDynamicBoundaryLines,
      classifyFallZone: classifyDynamicFallZone,
      classifyFallOrigin: classifyDynamicFallOrigin,
    });
  } else {
    registerDynamicCourseHooks(null);
  }
}

export function getActiveGeneratedCourse(): GeneratedCourse | null {
  return activeGeneratedCourse;
}

// ---------------------------------------------------------------------------
// Parameterized Local Evaluators for Any Placed Hurdle Slot
// ---------------------------------------------------------------------------
function evalSlotLocal(
  slot: HurdleSlot,
  x: number,
  z: number,
  poseY: number,
  seesawTiltRad: number,
): { matched: boolean; height: number; rockOffset: number; surface?: SurfaceProperties } {
  const u = slot.dir * (x - slot.centerX); // [-halfLen..+halfLen] along driving direction
  const v = slot.dir * (z - slot.laneZ);   // lateral offset relative to heading
  const halfW = DRIVE_ROUTE_WIDTH * 0.5;   // 2.20m

  if (Math.abs(u) > slot.halfLen + 0.35 || Math.abs(v) > slot.meta.halfWidth + 0.45) {
    return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
  }

  switch (slot.type) {
    case 'brick_slalom':
    case 'oil_chicane': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      if (slot.type === 'oil_chicane' && Math.abs(u) <= 3.7) {
        return {
          matched: true,
          height: GROUND_DECK_HEIGHT,
          rockOffset: 0,
          surface: { grip: 0.14, rollingResistance: 0.08, hazard: 'oil', lateralGripMultiplier: 0.72 },
        };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'rock_scramble': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      let baseY = GROUND_DECK_HEIGHT;
      if (u >= -4.2 && u <= 4.2) {
        if (u < -3.5) baseY += ELEVATION_TIER_SMALL * ((u + 4.2) / 0.7);
        else if (u <= 3.5) baseY += ELEVATION_TIER_SMALL;
        else baseY += ELEVATION_TIER_SMALL * ((4.2 - u) / 0.7);
      }
      let rockMax = 0;
      if (slot.rockStones && u >= -3.5 && u <= 3.5) {
        for (const st of slot.rockStones) {
          const du = u - st.u;
          const dv = v - st.v;
          const rx = st.scaleX * 0.72;
          const rz = st.scaleZ * 0.72;
          const d2 = (du * du) / (rx * rx + 1e-6) + (dv * dv) / (rz * rz + 1e-6);
          if (d2 < 1.0) {
            const mound = Math.cos(Math.sqrt(d2) * Math.PI * 0.5) * st.scaleY * 0.65;
            if (mound > rockMax) rockMax = mound;
          }
        }
      }
      return {
        matched: true,
        height: baseY + rockMax,
        rockOffset: rockMax,
        surface: { grip: 0.68, rollingResistance: 1.45, hazard: 'none' },
      };
    }

    case 'roller_logs': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      const logCenters = [-3.6, -2.15, -0.7, 0.75, 2.2, 3.65];
      let logLift = 0;
      for (let i = 0; i < logCenters.length; i++) {
        const spanType = i % 3; // 0: left half, 1: right half, 2: full staggered center
        const covered = spanType === 0 ? v <= 0.8 : spanType === 1 ? v >= -0.8 : Math.abs(v) <= 1.65;
        if (!covered) continue;
        const dist = Math.abs(u - logCenters[i]);
        if (dist < 0.28) {
          const lift = Math.sqrt(Math.max(0, 0.28 * 0.28 - dist * dist)) * 0.76;
          if (lift > logLift) logLift = lift;
        }
      }
      return {
        matched: true,
        height: GROUND_DECK_HEIGHT + logLift,
        rockOffset: logLift,
        surface: { grip: 0.85, rollingResistance: 0.75, hazard: 'none' },
      };
    }

    case 'rumble_washboard': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      if (Math.abs(u) <= 3.7) {
        const phase = u * 2.35 + Math.sign(v || 1) * 0.65;
        const rib = Math.max(0, Math.sin(phase)) * 0.14;
        return {
          matched: true,
          height: GROUND_DECK_HEIGHT + rib,
          rockOffset: rib * 0.5,
          surface: { grip: 0.88, rollingResistance: 0.65, hazard: 'none' },
        };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'fire_hearth': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      let y = GROUND_DECK_HEIGHT;
      let isFire = false;
      if (u >= -2.5 && u <= 2.5) {
        isFire = Math.abs(u) <= 2.0;
        if (u < -2.0) y += 0.38 * ((u + 2.5) / 0.5);
        else if (u <= 2.0) y = 0.05;
        else y += 0.38 * ((2.5 - u) / 0.5);
      }
      return {
        matched: true,
        height: y,
        rockOffset: 0,
        surface: isFire ? { grip: 0.92, rollingResistance: 0.35, hazard: 'fire' } : { grip: 1.0, rollingResistance: 0.3, hazard: 'none' },
      };
    }

    case 'water_basin': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      if (Math.abs(u) <= 4.4) {
        let y = -0.30;
        if (u < -3.0) {
          const t = (u + 4.4) / 1.4;
          y = GROUND_DECK_HEIGHT + (-0.30 - GROUND_DECK_HEIGHT) * (t * t * (3 - 2 * t));
        } else if (u > 3.0) {
          const t = (4.4 - u) / 1.4;
          y = GROUND_DECK_HEIGHT + (-0.30 - GROUND_DECK_HEIGHT) * (t * t * (3 - 2 * t));
        }
        return {
          matched: true,
          height: y,
          rockOffset: 0,
          surface: { grip: 0.52, rollingResistance: 0.75, hazard: 'water' },
        };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'football_arena': {
      // Horizontal dual-goal pitch widened laterally to [-3.05..+3.05] over [-2.75..+2.75], with flared entry/exit aprons
      const absU = Math.abs(u);
      const absV = Math.abs(v);
      const allowedHalfV = absU <= 2.75
        ? 3.05
        : absU <= 4.50
          ? 2.20 + (3.05 - 2.20) * ((4.50 - absU) / 1.75)
          : halfW;
      const inGoalPocket = absU <= 1.58 && absV > 3.05 && absV <= 3.85;
      if (absV > allowedHalfV + 0.05 && !inGoalPocket) {
        return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      }
      const inTurf = absU <= 2.75 && (absV <= 3.05 || inGoalPocket);
      return {
        matched: true,
        height: inTurf ? GROUND_DECK_HEIGHT + 0.016 : GROUND_DECK_HEIGHT,
        rockOffset: 0,
        surface: { grip: inTurf ? 0.96 : 1.05, rollingResistance: inTurf ? 0.38 : 0.30, hazard: 'none' },
      };
    }

    case 'seesaw_bridge': {
      if (Math.abs(v) > 1.55) {
        if (Math.abs(u) <= 4.8 && Math.abs(v) <= halfW && poseY <= 0.1) return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
        return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      }
      // Solid entry ramp [-4.8..-3.5] rising to pivot rim height (0.42m), dynamic plank [-3.5..+3.5] pivoting around y=0.42m
      const pivotH = 0.42;
      if (u < -3.5) {
        const t = Math.max(0, (u + 4.8) / 1.3);
        const targetTipY = pivotH + (-3.5) * Math.tan(seesawTiltRad);
        return {
          matched: true,
          height: GROUND_DECK_HEIGHT + (targetTipY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t),
          rockOffset: 0,
          surface: { grip: 1.08, rollingResistance: 0.28, hazard: 'none' },
        };
      }
      if (u <= 3.5) {
        return {
          matched: true,
          height: pivotH + u * Math.tan(seesawTiltRad),
          rockOffset: 0,
          surface: { grip: 1.06, rollingResistance: 0.25, hazard: 'none' },
        };
      }
      const tExit = Math.max(0, (4.8 - u) / 1.3);
      const exitTipY = pivotH + 3.5 * Math.tan(seesawTiltRad);
      return {
        matched: true,
        height: GROUND_DECK_HEIGHT + (exitTipY - GROUND_DECK_HEIGHT) * easeCushionedRamp(tExit),
        rockOffset: 0,
        surface: { grip: 1.08, rollingResistance: 0.28, hazard: 'none' },
      };
    }

    case 'speed_humps_ice': {
      if (Math.abs(v) > halfW) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      const centers = [-3.6, 0.0];
      let maxRise = 0;
      for (const cu of centers) {
        const d = Math.abs(u - cu);
        if (d < 1.65) {
          const c = Math.cos((d / 1.65) * Math.PI * 0.5);
          const rise = 0.76 * c * c;
          if (rise > maxRise) maxRise = rise;
        }
      }
      const onIcePad = u >= 2.0 && u <= 5.4;
      return {
        matched: true,
        height: GROUND_DECK_HEIGHT + maxRise,
        rockOffset: 0,
        surface: onIcePad
          ? { grip: 0.22, rollingResistance: 0.14, hazard: 'none' }
          : { grip: 1.02, rollingResistance: 0.34, hazard: 'none' },
      };
    }

    case 'high_climb': {
      if (Math.abs(v) > 2.65) return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      const yTop = 2.45;
      if (u >= -4.6 && u < 0.0) {
        const t = (u + 4.6) / 4.6;
        return {
          matched: true,
          height: GROUND_DECK_HEIGHT + (yTop - GROUND_DECK_HEIGHT) * easeCushionedRamp(t, 0.14),
          rockOffset: 0,
          surface: { grip: 0.78, kineticGrip: 0.36, breakawayGrade: 0.46, rollingResistance: 0.12, hazard: 'none', lateralGripMultiplier: 1.55 },
        };
      }
      if (u >= 0.0 && u <= 0.6) {
        return {
          matched: true,
          height: yTop,
          rockOffset: 0,
          surface: { grip: 1.18, rollingResistance: 0.40, hazard: 'none', lateralGripMultiplier: 1.50 },
        };
      }
      if (u > 0.6 && u <= 4.8) {
        const t = (4.8 - u) / 4.2;
        return {
          matched: true,
          height: GROUND_DECK_HEIGHT + (yTop - GROUND_DECK_HEIGHT) * easeCushionedRamp(t, 0.22),
          rockOffset: 0,
          surface: { grip: 1.22, rollingResistance: 0.42, hazard: 'none', lateralGripMultiplier: 1.50 },
        };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'turntable_deck': {
      const rDisc = 2.30;
      const distDisc = Math.hypot(u, v);
      const deckY = 0.92;
      if (Math.abs(u) <= 2.4 && distDisc <= rDisc + 0.08 && poseY > 0.25) {
        return { matched: true, height: deckY, rockOffset: 0, surface: { grip: 0.92, rollingResistance: 0.32, hazard: 'none' } };
      }
      if (u >= -5.0 && u <= -2.1 && Math.abs(v) <= 1.65) {
        const t = Math.min(1, (u + 5.0) / 2.9);
        return { matched: true, height: GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t), rockOffset: 0 };
      }
      if (u >= 2.1 && u <= 5.0 && Math.abs(v) <= 1.65) {
        const t = Math.min(1, (5.0 - u) / 2.9);
        return { matched: true, height: GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t), rockOffset: 0 };
      }
      if (Math.abs(u) <= 2.4 && distDisc <= rDisc + 0.08) {
        return { matched: true, height: deckY, rockOffset: 0, surface: { grip: 0.92, rollingResistance: 0.32, hazard: 'none' } };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'pendulum_bridge': {
      const catW = 1.00;
      const deckY = 1.35;
      if (Math.abs(v) <= catW) {
        if (u >= -6.0 && u < -3.6) {
          const t = (u + 6.0) / 2.4;
          return { matched: true, height: GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t, 0.14), rockOffset: 0, surface: { grip: 1.12, rollingResistance: 0.25, hazard: 'none' } };
        }
        if (u >= -3.6 && u <= 3.6) {
          return { matched: true, height: deckY, rockOffset: 0, surface: { grip: 1.12, rollingResistance: 0.25, hazard: 'none' } };
        }
        if (u > 3.6 && u <= 6.0) {
          const t = (6.0 - u) / 2.4;
          return { matched: true, height: GROUND_DECK_HEIGHT + (deckY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t, 0.14), rockOffset: 0, surface: { grip: 1.12, rollingResistance: 0.25, hazard: 'none' } };
        }
      }
      if (poseY > GROUND_DECK_HEIGHT + 0.15) return { matched: true, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'hanging_bridges': {
      const bridgeY = 0.88;
      const pitHalfZ = 2.05;
      const inPit = Math.abs(u) <= 4.7 && Math.abs(v) <= pitHalfZ;
      const trackSpacingHalf = (TRACK_WIDTH / MAP_SCALE) * 0.5;
      const plankHalfW = 0.32;
      if (u >= -6.1 && u < -4.5 && Math.abs(v) <= 1.25) {
        if (poseY < GROUND_DECK_HEIGHT - 0.15 && inPit) return { matched: true, height: HANGING_SAND_PIT_Y, rockOffset: 0, surface: { grip: 0.42, rollingResistance: 2.25, hazard: 'sand' } };
        const t = Math.min(1, (u + 6.1) / 1.6);
        return { matched: true, height: GROUND_DECK_HEIGHT + (bridgeY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t), rockOffset: 0 };
      }
      if (u > 4.5 && u <= 6.1 && Math.abs(v) <= 1.25) {
        if (poseY < GROUND_DECK_HEIGHT - 0.15 && inPit) return { matched: true, height: HANGING_SAND_PIT_Y, rockOffset: 0, surface: { grip: 0.42, rollingResistance: 2.25, hazard: 'sand' } };
        const t = Math.min(1, (6.1 - u) / 1.6);
        return { matched: true, height: GROUND_DECK_HEIGHT + (bridgeY - GROUND_DECK_HEIGHT) * easeCushionedRamp(t), rockOffset: 0 };
      }
      if (u >= -4.5 && u <= 4.5) {
        if (poseY >= GROUND_DECK_HEIGHT - 0.15 && (Math.abs(v - trackSpacingHalf) <= plankHalfW || Math.abs(v + trackSpacingHalf) <= plankHalfW)) {
          const spanU = (u + 4.5) / 9.0;
          const sag = 0.14 * 4 * spanU * (1 - spanU);
          return { matched: true, height: bridgeY - sag, rockOffset: 0, surface: { grip: 0.96, rollingResistance: 0.34, hazard: 'none' } };
        }
        return {
          matched: true,
          height: inPit ? HANGING_SAND_PIT_Y : GROUND_DECK_HEIGHT,
          rockOffset: 0,
          surface: inPit ? { grip: 0.42, rollingResistance: 2.25, hazard: 'sand' } : undefined,
        };
      }
      return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
    }

    case 'spiral_tower': {
      // Spiral center at u = -4.20, rInner = 1.00, rOuter = 3.30; Turntable at u = +2.20, r = 2.35; Descent [4.40..11.20]
      const spU = -4.20;
      const rInner = 1.00;
      const rOuter = 3.30;
      const yTop = 3.20;
      const ttU = 2.20;
      const rTt = 2.35;
      const dx = u - spU;
      const dist = Math.hypot(dx, v);
      const trackBottomY = poseY + 0.12;

      // Smooth long cushioned Descent Viaduct Ramp [4.40..11.80]
      if (u >= 4.40 && u <= 11.80 && Math.abs(v) <= 1.65) {
        if (trackBottomY > GROUND_DECK_HEIGHT + 0.85 || u >= 7.00) {
          const t = (u - 4.40) / 7.40;
          return { matched: true, height: yTop + (GROUND_DECK_HEIGHT - yTop) * easeCushionedRamp(t, 0.16), rockOffset: 0, surface: { grip: 1.12, rollingResistance: 0.34, hazard: 'none' } };
        }
      }
      // Elevated Turntable
      if (Math.hypot(u - ttU, v) <= rTt + 0.08 && trackBottomY > 1.85) {
        return { matched: true, height: yTop, rockOffset: 0, surface: { grip: 0.90, rollingResistance: 0.35, hazard: 'none' } };
      }
      // Upper bridge from spiral to turntable (connects cleanly at 540° summit without cutting into <540° North arc)
      if (u >= -2.05 && u <= 0.25 && Math.abs(v) <= 1.45 && (u >= -1.15 || v >= -0.12) && trackBottomY > 2.00) {
        return { matched: true, height: yTop, rockOffset: 0, surface: { grip: 1.05, rollingResistance: 0.28, hazard: 'none' } };
      }
      // Helix climb (540 deg = 1.5 turns starting at West tangent du=-rMid, dv=0 climbing North -> East -> South -> West -> Summit)
      if (dist <= rOuter + 0.22 && dist >= rInner - 0.18) {
        let beta = Math.atan2(-v, -dx);
        if (beta < 0) beta += 2 * Math.PI;
        let totalBeta: number;
        if (trackBottomY < GROUND_DECK_HEIGHT + 0.72 && dx < 0 && beta > Math.PI) totalBeta = 0;
        else if (v > 0.0) totalBeta = beta;
        else {
          const ratio = Math.max(-1, Math.min(1, dx / Math.max(1e-6, dist)));
          const threshold = 1.65 + 0.65 * ratio;
          totalBeta = trackBottomY > threshold ? beta + 2 * Math.PI : beta;
        }
        const t = Math.max(0, Math.min(1, totalBeta / (3 * Math.PI)));
        const h = GROUND_DECK_HEIGHT + t * (yTop - GROUND_DECK_HEIGHT);
        // Only treat as driving underneath Turn 2 overhang when clearly on ground under elevated loop
        if (trackBottomY < GROUND_DECK_HEIGHT + 0.45 && h > GROUND_DECK_HEIGHT + 1.25 && trackBottomY < h - 0.95) {
          return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
        }
        return { matched: true, height: h, rockOffset: 0, surface: { grip: 1.15, rollingResistance: 0.28, hazard: 'none' } };
      }
      // Ground runway beneath/leading to spiral
      if (Math.abs(v) <= halfW && Math.abs(u) <= slot.halfLen) {
        return { matched: true, height: GROUND_DECK_HEIGHT, rockOffset: 0 };
      }
      return { matched: false, height: ARENA_FLOOR_HEIGHT, rockOffset: 0 };
    }
  }
}

export function evaluateDynamicCourseHeight(x: number, z: number, poseY = 0): number | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    const tilt = activeGeneratedCourse.seesawStates[slot.index] ?? -0.11;
    const res = evalSlotLocal(slot, x, z, poseY, tilt);
    if (res.matched) return res.height;
  }
  // Standard flat lanes & hairpins
  const halfW = DRIVE_ROUTE_WIDTH * 0.5;
  if (x >= -22.0 && x <= -17.5 && Math.abs(z - 13.50) <= halfW) return GROUND_DECK_HEIGHT;
  for (const lz of [13.50, 6.75, 0.00, -6.75, -13.50]) {
    if (Math.abs(z - lz) <= halfW && x >= -17.5 && x <= 17.5) return GROUND_DECK_HEIGHT;
  }
  // 4 Hairpins
  for (const [cx, cz, isEast] of [
    [17.50, 10.125, true],
    [-17.50, 3.375, false],
    [17.50, -3.375, true],
    [-17.50, -10.125, false],
  ] as [number, number, boolean][]) {
    if ((isEast && x >= 17.0) || (!isEast && x <= -17.0)) {
      const r = Math.hypot(x - cx, z - cz);
      if (r >= 1.15 && r <= 5.60) return GROUND_DECK_HEIGHT;
    }
  }
  return ARENA_FLOOR_HEIGHT;
}

export function evaluateDynamicCourseSurface(x: number, z: number, poseY = 0): SurfaceProperties | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    const tilt = activeGeneratedCourse.seesawStates[slot.index] ?? -0.11;
    const res = evalSlotLocal(slot, x, z, poseY, tilt);
    if (res.matched && res.surface) return res.surface;
  }
  return { grip: 1.05, rollingResistance: 0.30, hazard: 'none' };
}

export function evaluateDynamicRockHeight(x: number, z: number): number | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    if (slot.type === 'rock_scramble' || slot.type === 'roller_logs' || slot.type === 'rumble_washboard') {
      const res = evalSlotLocal(slot, x, z, 0, 0);
      if (res.matched) return res.rockOffset;
    }
  }
  return 0;
}

export function isWithinDynamicBoundaryLines(x: number, z: number, poseY: number): boolean | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    const u = slot.dir * (x - slot.centerX);
    const v = slot.dir * (z - slot.laneZ);
    if (Math.abs(u) <= slot.halfLen + 0.1 && Math.abs(v) <= slot.meta.halfWidth + 0.25) {
      if (slot.type === 'high_climb') return Math.abs(v) <= 2.60;
      if (slot.type === 'pendulum_bridge') {
        return Math.abs(v) <= 1.02;
      }
      if (slot.type === 'hanging_bridges') {
        if (poseY < GROUND_DECK_HEIGHT - 0.18 && Math.abs(u) <= 4.7) return false;
        if (Math.abs(u) <= 4.5) return Math.abs(v) <= (TRACK_WIDTH / MAP_SCALE) * 0.5 + 0.36;
        return Math.abs(v) <= 1.30;
      }
      if (slot.type === 'football_arena') {
        const absU = Math.abs(u);
        const absV = Math.abs(v);
        const allowedHalfV = absU <= 2.75
          ? 3.05
          : 2.20 + (3.05 - 2.20) * ((4.50 - Math.min(4.50, absU)) / 1.75);
        return absV <= allowedHalfV || (absU <= 1.55 && absV <= 3.78);
      }
      if (slot.type === 'spiral_tower') {
        if (poseY > 0.30) {
          const spDist = Math.hypot(u - (-4.20), v);
          if (spDist >= 0.96 && spDist <= 3.38) return true;
          if (Math.hypot(u - 2.20, v) <= 2.40) return true;
          if (u >= -2.05 && u <= 0.25 && Math.abs(v) <= 1.45) return true;
          if (u >= 4.4 && u <= 11.8 && Math.abs(v) <= 1.65) return true;
          return false;
        }
      }
    }
  }

  const halfW = DRIVE_ROUTE_WIDTH * 0.5;
  if (x >= -21.8 && x <= 17.6 && Math.abs(z - 13.50) <= halfW) return true;
  for (const lz of [6.75, 0.00, -6.75, -13.50]) {
    if (x >= -17.6 && x <= 17.6 && Math.abs(z - lz) <= halfW) return true;
  }
  for (const [cx, cz, isEast] of [
    [17.50, 10.125, true],
    [-17.50, 3.375, false],
    [17.50, -3.375, true],
    [-17.50, -10.125, false],
  ] as [number, number, boolean][]) {
    if ((isEast && x >= 17.45) || (!isEast && x <= -17.45)) {
      const r = Math.hypot(x - cx, z - cz);
      if (r >= 1.175 && r <= 5.575) return true;
    }
  }
  return false;
}

export function classifyDynamicFallZone(
  localX: number,
  localZ: number,
  localY: number,
): 'sand_pit' | 'water_basin' | 'arena_floor' | 'lower_track' | 'elevated_deck' | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    const u = slot.dir * (localX - slot.centerX);
    const v = slot.dir * (localZ - slot.laneZ);
    if (slot.type === 'hanging_bridges' && Math.abs(u) <= 4.75 && Math.abs(v) <= 2.15 && localY < GROUND_DECK_HEIGHT - 0.12) {
      return 'sand_pit';
    }
    if (slot.type === 'water_basin' && Math.abs(u) <= 4.45 && Math.abs(v) <= DRIVE_ROUTE_WIDTH * 0.5 + 0.15 && localY < 0.05) {
      return 'water_basin';
    }
  }
  if (isWithinDynamicBoundaryLines(localX, localZ, localY)) {
    return localY > GROUND_DECK_HEIGHT + 0.25 ? 'elevated_deck' : 'lower_track';
  }
  return 'arena_floor';
}

export function classifyDynamicFallOrigin(
  localX: number,
  localZ: number,
  peakY: number,
): 'spiral_tower' | 'high_climb' | 'pendulum_bridge' | 'hanging_bridge' | 'track_edge' | null {
  if (!activeGeneratedCourse) return null;
  for (const slot of activeGeneratedCourse.slots) {
    const u = slot.dir * (localX - slot.centerX);
    const v = slot.dir * (localZ - slot.laneZ);
    if (slot.type === 'spiral_tower' && peakY > 0.45 && Math.abs(u) <= 12.2 && Math.abs(v) <= 3.6) {
      return 'spiral_tower';
    }
    if (slot.type === 'high_climb' && peakY > 0.30 && Math.abs(u) <= 5.2 && Math.abs(v) <= 2.8) {
      return 'high_climb';
    }
    if (slot.type === 'pendulum_bridge' && peakY > 0.30 && Math.abs(u) <= 6.2 && Math.abs(v) <= 2.4) {
      return 'pendulum_bridge';
    }
    if (slot.type === 'hanging_bridges' && peakY > 0.20 && Math.abs(u) <= 6.4 && Math.abs(v) <= 2.4) {
      return 'hanging_bridge';
    }
  }
  return 'track_edge';
}
