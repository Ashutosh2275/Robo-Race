import {
  DRIVE_ROUTE_WIDTH,
  GROUND_DECK_HEIGHT,
  HANGING_BRIDGE_CONFIG,
  HIGH_CLIMB_CONFIG,
  PENDULUM_CONFIG,
  SPIRAL_CONFIG,
  TURNTABLE_CENTER,
  TURNTABLE_RADIUS,
} from './courseLayout.ts';
import {
  ROBOT_HALF_LENGTH,
  ROBOT_HALF_WIDTH,
} from './vehicleDynamics.ts';

export type ObstacleDifficultyTier = 'easy' | 'medium' | 'hard';

export type ScoringConfig = {
  easyPoints: number;
  mediumPoints: number;
  hardPoints: number;
  boundaryPenaltyPoints: number;
  boundaryLifelines: number;
  fallBasePenaltyPoints: number;
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  easyPoints: 10,
  mediumPoints: 20,
  hardPoints: 30,
  boundaryPenaltyPoints: 5,
  boundaryLifelines: 3,
  fallBasePenaltyPoints: 10,
};

export type ObstacleScoreMeta = {
  id: string;
  label: string;
  tier: ObstacleDifficultyTier;
  gateId?: number;
};

/**
 * Competition difficulty classification across every obstacle & gate segment:
 * - Easy (10 pts): Brick Slaloms, Rock Field, Fire Hearth, Deep Water Basin
 * - Medium (20 pts): High-Incline Zigzag Climb, Mega Speed Humps & Ice-Steel, Rooftop Turntable, Descent Ramp, Finish Line
 * - Hard / Critical (30 pts): Spiral Tower Climb, Swinging Pendulums Catwalk, Spread Twin Hanging Bridges
 */
export const OBSTACLE_SCORE_TIERS = {
  slalom_hurdles: { id: 'slalom_hurdles', label: 'Brick Wall Slalom', tier: 'easy', gateId: 2 },
  rock_field: { id: 'rock_field', label: 'Sculpted Rock Field', tier: 'easy', gateId: 3 },
  high_climb: { id: 'high_climb', label: 'High-Incline Zigzag Ramp', tier: 'medium' },
  speed_breakers: { id: 'speed_breakers', label: 'Mega Speed Humps & Steel Sheet', tier: 'medium', gateId: 4 },
  spiral_tower: { id: 'spiral_tower', label: 'Spiral Tower Climb', tier: 'hard', gateId: 5 },
  rooftop_turntable: { id: 'rooftop_turntable', label: 'Rooftop Turntable', tier: 'medium', gateId: 6 },
  spiral_descent: { id: 'spiral_descent', label: 'Spiral Descent Viaduct', tier: 'medium', gateId: 7 },
  swinging_pendulums: { id: 'swinging_pendulums', label: 'Swinging Pendulum Catwalk', tier: 'hard', gateId: 8 },
  hanging_bridges: { id: 'hanging_bridges', label: 'Dual Hanging Suspension Bridges', tier: 'hard', gateId: 9 },
  fire_hazard: { id: 'fire_hazard', label: 'Refractory Fire Hearth', tier: 'easy', gateId: 10 },
  water_basin: { id: 'water_basin', label: 'Deep Water Basin', tier: 'easy', gateId: 11 },
  finish_line: { id: 'finish_line', label: 'Grand Finish Completion', tier: 'medium', gateId: 12 },
} as const satisfies Record<string, ObstacleScoreMeta>;

export type ObstacleScoreId = keyof typeof OBSTACLE_SCORE_TIERS;

export function pointsForTier(tier: ObstacleDifficultyTier, config: ScoringConfig): number {
  if (tier === 'easy') return Math.max(0, config.easyPoints);
  if (tier === 'hard') return Math.max(0, config.hardPoints);
  return Math.max(0, config.mediumPoints);
}

export type ScoreEventLog = {
  label: string;
  delta: number;
  detail: string;
};

export type CompetitionScoreState = {
  score: number;
  pointsEarned: number;
  penaltyPoints: number;
  remainingLifelines: number;
  totalLifelines: number;
  boundaryViolations: number;
  fallCount: number;
  isOutsideLine: boolean;
  boundaryCooldown: number;
  lastOutFraction: number;
  awardedIds: Set<string>;
  events: ScoreEventLog[];
};

export function createCompetitionScoreState(config: ScoringConfig): CompetitionScoreState {
  const lifelines = Math.max(0, Math.round(config.boundaryLifelines));
  return {
    score: 0,
    pointsEarned: 0,
    penaltyPoints: 0,
    remainingLifelines: lifelines,
    totalLifelines: lifelines,
    boundaryViolations: 0,
    fallCount: 0,
    isOutsideLine: false,
    boundaryCooldown: 0,
    lastOutFraction: 0,
    awardedIds: new Set<string>(),
    events: [],
  };
}

export function awardObstacleZonePoints(
  state: CompetitionScoreState,
  obstacleId: ObstacleScoreId,
  config: ScoringConfig,
): number {
  if (state.awardedIds.has(obstacleId)) return 0;
  const meta = OBSTACLE_SCORE_TIERS[obstacleId];
  const pts = pointsForTier(meta.tier, config);
  state.awardedIds.add(obstacleId);
  state.pointsEarned += pts;
  state.score += pts;
  state.events.push({ label: meta.label, delta: pts, detail: meta.tier.toUpperCase() });
  return pts;
}

export function awardObstacleGatePoints(
  state: CompetitionScoreState,
  gateId: number,
  config: ScoringConfig,
): number {
  const entry = (Object.values(OBSTACLE_SCORE_TIERS) as ObstacleScoreMeta[]).find(m => m.gateId === gateId);
  if (!entry) return 0;
  return awardObstacleZonePoints(state, entry.id as ObstacleScoreId, config);
}

/**
 * Checks whether a single local course point `(x, z)` at elevation `poseY` lies inside
 * the legal painted boundary lines of any continuous track corridor segment.
 */
export function isLocalPointWithinBoundaryLines(x: number, z: number, poseY: number): boolean {
  const halfW = DRIVE_ROUTE_WIDTH * 0.5; // 2.20m

  // Elevated Lane 3 Spiral Tower, Approach Bridge, Turntable & Descent Ramp
  if (poseY > 0.30 && x >= -7.0 && x <= 11.0 && Math.abs(z) <= 3.6) {
    const distSpiral = Math.hypot(x - SPIRAL_CONFIG.cx, z - SPIRAL_CONFIG.cz);
    if (distSpiral >= SPIRAL_CONFIG.rInner - 0.05 && distSpiral <= SPIRAL_CONFIG.rOuter + 0.08) return true;
    if (x >= -3.35 && x <= -1.40 && Math.abs(z) <= 1.25) return true;
    const distTurntable = Math.hypot(x - TURNTABLE_CENTER.x, z - TURNTABLE_CENTER.z);
    if (distTurntable <= TURNTABLE_RADIUS + 0.05) return true;
    if (x >= SPIRAL_CONFIG.descentX0 - 0.10 && x <= SPIRAL_CONFIG.descentX1 + 0.15 && Math.abs(z) <= SPIRAL_CONFIG.descentWidth * 0.5 + 0.05) return true;
    return false;
  }

  // Lane 4 Narrow Elevated Obstacles & Sunken Sand Pit
  if (Math.abs(z - (-6.75)) <= halfW + 0.15 && x >= -10.85 && x <= 16.25) {
    // Dropped below deck into the sunken sand pit -> clearly out of track bounds
    if (poseY < GROUND_DECK_HEIGHT - 0.18 && x >= HANGING_BRIDGE_CONFIG.pitXMin && x <= HANGING_BRIDGE_CONFIG.pitXMax) {
      return false;
    }
    // Pendulum Catwalk Bridge & ramps (width = 2.00m -> half = 1.00m)
    if (x >= PENDULUM_CONFIG.xExitEnd && x <= PENDULUM_CONFIG.xEntryStart) {
      return Math.abs(z - PENDULUM_CONFIG.zLane) <= PENDULUM_CONFIG.deckWidth * 0.5 + 0.05;
    }
    // Gate 08 Connecting Road Bay
    if (x >= HANGING_BRIDGE_CONFIG.xEntryStart && x < PENDULUM_CONFIG.xExitEnd) {
      return Math.abs(z - (-6.75)) <= halfW;
    }
    // Hanging Twin Bridges ascent & descent aprons
    if (x > HANGING_BRIDGE_CONFIG.xBridgeEast && x <= HANGING_BRIDGE_CONFIG.xEntryStart) {
      return Math.abs(z - HANGING_BRIDGE_CONFIG.zLane) <= HANGING_BRIDGE_CONFIG.totalDeckWidth * 0.5 + 0.05;
    }
    if (x >= HANGING_BRIDGE_CONFIG.xExitEnd && x < HANGING_BRIDGE_CONFIG.xBridgeWest) {
      return Math.abs(z - HANGING_BRIDGE_CONFIG.zLane) <= HANGING_BRIDGE_CONFIG.totalDeckWidth * 0.5 + 0.05;
    }
    // Spread Twin Hanging Bridges envelope (outer plank edges +-0.90m around laneZ)
    if (x >= HANGING_BRIDGE_CONFIG.xBridgeWest && x <= HANGING_BRIDGE_CONFIG.xBridgeEast) {
      return Math.abs(z - HANGING_BRIDGE_CONFIG.zLane) <= HANGING_BRIDGE_CONFIG.trackOffset + HANGING_BRIDGE_CONFIG.trackWidth * 0.5 + 0.04;
    }
  }

  // Ground-level / High-Climb / Lane corridors
  // Lane 1: South Straight (z = 13.50)
  if (x >= -21.8 && x <= 17.6 && Math.abs(z - 13.50) <= halfW) return true;
  // Hairpin 1 (East 1->2)
  if (x >= 17.45) {
    const r = Math.hypot(x - 17.50, z - 10.125);
    if (r >= 1.175 && r <= 5.575) return true;
  }
  // Lane 2: High-Incline Zigzag Challenge Bowl (wider 5.20m boundary lines on [8.70, 17.00])
  if (x >= HIGH_CLIMB_CONFIG.xExitEnd - 0.05 && x <= HIGH_CLIMB_CONFIG.xEntryStart + 0.05) {
    if (Math.abs(z - HIGH_CLIMB_CONFIG.laneZ) <= HIGH_CLIMB_CONFIG.deckWidth * 0.5) return true;
  }
  // Lane 2 Standard Width
  if (x >= -17.6 && x <= 17.6 && Math.abs(z - 6.75) <= halfW) return true;
  // Hairpin 2 (West 2->3)
  if (x <= -17.45) {
    const r = Math.hypot(x - (-17.50), z - 3.375);
    if (r >= 1.175 && r <= 5.575) return true;
  }
  // Lane 3 Ground Level & Spiral Entrance Apron
  if ((x >= -17.6 && x <= -5.50) || (x >= 10.40 && x <= 17.6)) {
    if (Math.abs(z - 0.00) <= halfW) return true;
  }
  if (poseY <= 0.35 && Math.hypot(x - SPIRAL_CONFIG.cx, z - SPIRAL_CONFIG.cz) <= SPIRAL_CONFIG.rOuter + 0.08 && x <= -2.2) {
    return true;
  }
  // Hairpin 3 (East 3->4)
  if (x >= 17.45) {
    const r = Math.hypot(x - 17.50, z - (-3.375));
    if (r >= 1.175 && r <= 5.575) return true;
  }
  // Lane 4 Ground West/East Approaches
  if ((x >= -17.6 && x <= -10.75) || (x >= 16.15 && x <= 17.6)) {
    if (Math.abs(z - (-6.75)) <= halfW) return true;
  }
  // Hairpin 4 (West 4->5)
  if (x <= -17.45) {
    const r = Math.hypot(x - (-17.50), z - (-10.125));
    if (r >= 1.175 && r <= 5.575) return true;
  }
  // Lane 5 Ground, Fire Hearth, Water Basin & Finish Straight
  if (x >= -17.6 && x <= 16.4 && Math.abs(z - (-13.50)) <= halfW) return true;

  return false;
}

/**
 * Samples a 5x5 uniform grid over the robot's oriented chassis footprint to measure
 * the exact fraction [0..1] of the vehicle that has crossed outside track boundary lines.
 */
export function computeOutOfBoundsFraction(
  worldX: number,
  worldZ: number,
  yaw: number,
  poseY: number,
  mapScale: number,
): number {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let outCount = 0;
  const steps = [-1, -0.5, 0, 0.5, 1];
  for (const u of steps) {
    const fwdDist = u * ROBOT_HALF_LENGTH;
    for (const v of steps) {
      const rightDist = v * ROBOT_HALF_WIDTH;
      const wx = worldX + sin * fwdDist + cos * rightDist;
      const wz = worldZ + cos * fwdDist - sin * rightDist;
      if (!isLocalPointWithinBoundaryLines(wx / mapScale, wz / mapScale, poseY)) {
        outCount++;
      }
    }
  }
  return outCount / 25;
}

export type BoundaryStepResult = {
  event: 'none' | 'lifeline_used' | 'penalty_applied';
  outFraction: number;
  touchingLine: boolean;
  pointsDeducted: number;
};

/**
 * Applies the competition 50%-out-of-track boundary rule with lifeline buffer and cooldown hysteresis:
 * - Touching / crossing < 50%: completely permitted (0 lifelines lost, 0 minus points).
 * - Crossing >= 50% outside boundary line: uses 1 buffer lifeline first, then deducts custom boundary points.
 */
export function stepBoundaryRule(
  state: CompetitionScoreState,
  outFraction: number,
  dt: number,
  config: ScoringConfig,
): BoundaryStepResult {
  state.lastOutFraction = outFraction;
  if (state.boundaryCooldown > 0) {
    state.boundaryCooldown = Math.max(0, state.boundaryCooldown - dt);
  }

  // Return strictly inside (<25% out) clears active crossing lock so future excursions are evaluated cleanly
  if (outFraction <= 0.25) {
    state.isOutsideLine = false;
  }

  if (outFraction >= 0.50 && !state.isOutsideLine && state.boundaryCooldown <= 0) {
    state.isOutsideLine = true;
    state.boundaryCooldown = 2.5;
    if (state.remainingLifelines > 0) {
      state.remainingLifelines -= 1;
      state.events.push({
        label: 'Boundary Line >=50% Out',
        delta: 0,
        detail: `LIFELINE USED (${state.remainingLifelines} LEFT)`,
      });
      return {
        event: 'lifeline_used',
        outFraction,
        touchingLine: true,
        pointsDeducted: 0,
      };
    }

    const pts = Math.max(0, config.boundaryPenaltyPoints);
    state.boundaryViolations += 1;
    state.penaltyPoints += pts;
    state.score -= pts;
    state.events.push({
      label: 'Boundary Violation >=50% Out',
      delta: -pts,
      detail: 'NO LIFELINES LEFT',
    });
    return {
      event: 'penalty_applied',
      outFraction,
      touchingLine: true,
      pointsDeducted: pts,
    };
  }

  return {
    event: 'none',
    outFraction,
    touchingLine: outFraction > 0.04,
    pointsDeducted: 0,
  };
}

export type FallLandingPlace = 'sand_pit' | 'water_basin' | 'arena_floor' | 'lower_track' | 'elevated_deck';
export type FallOriginZone = 'spiral_tower' | 'high_climb' | 'pendulum_bridge' | 'hanging_bridge' | 'track_edge';

export function classifyFallZone(localX: number, localZ: number, localY: number): FallLandingPlace {
  if (
    Math.abs(localZ - HANGING_BRIDGE_CONFIG.zLane) <= HANGING_BRIDGE_CONFIG.pitHalfZ + 0.15
    && localX >= HANGING_BRIDGE_CONFIG.pitXMin
    && localX <= HANGING_BRIDGE_CONFIG.pitXMax
    && localY < GROUND_DECK_HEIGHT - 0.12
  ) {
    return 'sand_pit';
  }
  if (Math.abs(localZ - (-13.50)) <= DRIVE_ROUTE_WIDTH * 0.5 + 0.15 && localX >= 0.5 && localX <= 9.5 && localY < 0.05) {
    return 'water_basin';
  }
  if (localY > GROUND_DECK_HEIGHT + 0.25) return 'elevated_deck';
  if (localY >= GROUND_DECK_HEIGHT - 0.12) return 'lower_track';
  return 'arena_floor';
}

export function classifyFallOrigin(localX: number, localZ: number, peakY: number): FallOriginZone {
  if (peakY > 0.50 && Math.abs(localZ) <= 3.5 && localX >= -7.0 && localX <= 10.5) return 'spiral_tower';
  if (peakY > 0.30 && Math.abs(localZ - HIGH_CLIMB_CONFIG.laneZ) <= 3.2 && localX >= 8.5 && localX <= 17.2) return 'high_climb';
  if (peakY > 0.30 && Math.abs(localZ - PENDULUM_CONFIG.zLane) <= 2.5 && localX >= 3.5 && localX <= 16.5) return 'pendulum_bridge';
  if (peakY > 0.20 && Math.abs(localZ - HANGING_BRIDGE_CONFIG.zLane) <= 2.5 && localX >= -11.0 && localX <= 2.6) return 'hanging_bridge';
  return 'track_edge';
}

export type FallEvaluationInput = {
  dropHeightM: number;
  impactSpeedMps: number;
  horizontalSpeedMps: number;
  landingPlace: FallLandingPlace;
  originZone: FallOriginZone;
  isInverted: boolean;
};

export type FallOutcome = {
  significantFall: boolean;
  effectiveImpactMps: number;
  chassisDamageFactor: number;
  batteryShockPct: number;
  pointsPenalty: number;
  summary: string;
};

/**
 * Evaluates multi-factor fall consequences from height, landing place, impact & slide speed, and inversion.
 * Ground-level step-offs (< 0.40m drop & <= 2.3 m/s vertical landing velocity) incur zero damage or penalty.
 */
export function evaluateFallOutcome(input: FallEvaluationInput, config: ScoringConfig): FallOutcome {
  if (input.dropHeightM < 0.40 && input.impactSpeedMps <= 2.30) {
    return {
      significantFall: false,
      effectiveImpactMps: input.impactSpeedMps,
      chassisDamageFactor: 0,
      batteryShockPct: 0,
      pointsPenalty: 0,
      summary: 'minor step',
    };
  }

  const placeDamageMult: Record<FallLandingPlace, number> = {
    arena_floor: 1.12,
    lower_track: 1.00,
    elevated_deck: 0.95,
    sand_pit: 0.78,
    water_basin: 0.48,
  };
  const placePointMult: Record<FallLandingPlace, number> = {
    arena_floor: 1.15,
    lower_track: 1.00,
    elevated_deck: 0.90,
    sand_pit: 0.80,
    water_basin: 0.65,
  };

  const gravityRefSpeed = Math.sqrt(2 * 9.81 * Math.max(0, input.dropHeightM));
  const combinedVert = Math.max(input.impactSpeedMps, gravityRefSpeed * 0.85);
  const speedMult = 1.0 + Math.min(0.45, Math.max(0, input.horizontalSpeedMps) / 11.0) + (input.isInverted ? 0.25 : 0);
  const effectiveImpactMps = combinedVert * Math.sqrt(placeDamageMult[input.landingPlace] * speedMult);

  const batteryWaterMult = input.landingPlace === 'water_basin' ? 1.55 : 1.0;
  const batteryShockPct = Math.min(
    25,
    (input.dropHeightM * 2.6 + Math.max(0, combinedVert - 2.2) * 1.4)
      * batteryWaterMult
      * (input.isInverted ? 1.25 : 1.0),
  );

  const baseFallPts = Math.max(0, config.fallBasePenaltyPoints);
  const heightMult = 0.55 + Math.min(2.2, input.dropHeightM * 0.50);
  const originBonus = input.originZone === 'spiral_tower' || input.originZone === 'hanging_bridge' || input.originZone === 'pendulum_bridge' ? 1.15 : 1.0;
  const pointsPenalty = Math.round(baseFallPts * heightMult * placePointMult[input.landingPlace] * originBonus * (1 + Math.min(0.40, input.horizontalSpeedMps / 12.0)));

  return {
    significantFall: true,
    effectiveImpactMps,
    chassisDamageFactor: placeDamageMult[input.landingPlace] * speedMult,
    batteryShockPct,
    pointsPenalty,
    summary: `${input.dropHeightM.toFixed(1)}m @ ${combinedVert.toFixed(1)}m/s (${input.landingPlace.replace('_', ' ')})`,
  };
}
