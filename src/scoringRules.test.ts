import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCORING_CONFIG,
  OBSTACLE_SCORE_TIERS,
  createCompetitionScoreState,
  awardObstacleGatePoints,
  awardObstacleZonePoints,
  computeOutOfBoundsFraction,
  stepBoundaryRule,
  evaluateFallOutcome,
  classifyFallZone,
  type ScoringConfig,
} from './scoringRules.ts';
import { MAP_SCALE, GROUND_DECK_HEIGHT, HANGING_SAND_PIT_Y, HIGH_CLIMB_CONFIG, SPIRAL_CONFIG } from './courseLayout.ts';

test('obstacle scoring tiers distinguish easy (10), medium (20), and critical/hard (30) obstacles', () => {
  assert.equal(OBSTACLE_SCORE_TIERS.slalom_hurdles.tier, 'easy');
  assert.equal(OBSTACLE_SCORE_TIERS.rock_field.tier, 'easy');
  assert.equal(OBSTACLE_SCORE_TIERS.fire_hazard.tier, 'easy');
  assert.equal(OBSTACLE_SCORE_TIERS.water_basin.tier, 'easy');

  assert.equal(OBSTACLE_SCORE_TIERS.high_climb.tier, 'medium');
  assert.equal(OBSTACLE_SCORE_TIERS.speed_breakers.tier, 'medium');
  assert.equal(OBSTACLE_SCORE_TIERS.rooftop_turntable.tier, 'medium');

  assert.equal(OBSTACLE_SCORE_TIERS.spiral_tower.tier, 'hard');
  assert.equal(OBSTACLE_SCORE_TIERS.swinging_pendulums.tier, 'hard');
  assert.equal(OBSTACLE_SCORE_TIERS.hanging_bridges.tier, 'hard');

  const state = createCompetitionScoreState(DEFAULT_SCORING_CONFIG);
  assert.equal(awardObstacleGatePoints(state, 2, DEFAULT_SCORING_CONFIG), 10); // Slalom (easy)
  assert.equal(awardObstacleGatePoints(state, 5, DEFAULT_SCORING_CONFIG), 30); // Spiral (hard)
  assert.equal(awardObstacleZonePoints(state, 'high_climb', DEFAULT_SCORING_CONFIG), 20); // High Climb (medium)
  // Duplicate gate/zone cannot double score
  assert.equal(awardObstacleGatePoints(state, 5, DEFAULT_SCORING_CONFIG), 0);
  assert.equal(awardObstacleZonePoints(state, 'high_climb', DEFAULT_SCORING_CONFIG), 0);
  assert.equal(state.score, 60);
});

test('user-customizable scoring points and boundary penalties (5 / 10 / custom) apply cleanly', () => {
  const custom: ScoringConfig = {
    easyPoints: 15,
    mediumPoints: 25,
    hardPoints: 45,
    boundaryPenaltyPoints: 10,
    boundaryLifelines: 2,
    fallBasePenaltyPoints: 12,
  };
  const state = createCompetitionScoreState(custom);
  assert.equal(awardObstacleGatePoints(state, 8, custom), 45);
  assert.equal(awardObstacleGatePoints(state, 3, custom), 15);
  assert.equal(state.remainingLifelines, 2);
  assert.equal(state.score, 60);

  // Two 50%+ line violations consume 2 buffer lifelines with 0 minus points
  const r1 = stepBoundaryRule(state, 0.56, 0.1, custom);
  assert.equal(r1.event, 'lifeline_used');
  assert.equal(state.remainingLifelines, 1);
  assert.equal(state.score, 60);

  // Simulate moving back inside boundary to reset crossing hysteresis
  stepBoundaryRule(state, 0.0, 0.5, custom);

  const r2 = stepBoundaryRule(state, 0.64, 3.0, custom);
  assert.equal(r2.event, 'lifeline_used');
  assert.equal(state.remainingLifelines, 0);
  assert.equal(state.score, 60);

  // Returning inside & crossing >= 50% again after lifelines exhausted triggers -10 penalty
  stepBoundaryRule(state, 0.0, 0.5, custom);
  const r3 = stepBoundaryRule(state, 0.72, 3.0, custom);
  assert.equal(r3.event, 'penalty_applied');
  assert.equal(r3.pointsDeducted, 10);
  assert.equal(state.score, 50);
  assert.equal(state.penaltyPoints, 10);
});

test('touching boundary line (< 50% outside) is allowed with zero lifeline loss or minus points', () => {
  // Lane 1 center z = 13.50, boundary line at z = 13.50 + 2.20 = 15.70 (course)
  const centerOut = computeOutOfBoundsFraction(-10.0 * MAP_SCALE, 13.50 * MAP_SCALE, Math.PI / 2, GROUND_DECK_HEIGHT, MAP_SCALE);
  assert.equal(centerOut, 0, 'centered robot must report 0% outside boundary');

  // Slight edge touch: robot center at 15.10 -> halfWidth 0.76m extends slightly over 15.70 (~20-35% out)
  const edgeTouchOut = computeOutOfBoundsFraction(-10.0 * MAP_SCALE, 15.10 * MAP_SCALE, Math.PI / 2, GROUND_DECK_HEIGHT, MAP_SCALE);
  assert.ok(edgeTouchOut > 0 && edgeTouchOut < 0.50, `touching line must measure >0% and <50% out, got ${(edgeTouchOut * 100).toFixed(1)}%`);

  const state = createCompetitionScoreState(DEFAULT_SCORING_CONFIG);
  const res = stepBoundaryRule(state, edgeTouchOut, 0.1, DEFAULT_SCORING_CONFIG);
  assert.equal(res.event, 'none', 'minor line touch (<50%) must not consume lifeline or deduct points');
  assert.equal(state.remainingLifelines, DEFAULT_SCORING_CONFIG.boundaryLifelines);
  assert.equal(state.score, 0);

  // Over 50% out: center moved well outside boundary line (15.85 -> >50% of body out)
  const halfPlusOut = computeOutOfBoundsFraction(-10.0 * MAP_SCALE, 15.85 * MAP_SCALE, Math.PI / 2, GROUND_DECK_HEIGHT, MAP_SCALE);
  assert.ok(halfPlusOut >= 0.50, `robot straddling >= 50% across boundary line must report >= 0.50, got ${halfPlusOut.toFixed(2)}`);

  // Elevated High Climb (5.20m bowl -> halfW 2.60m, outer line at z = 9.35) and Hanging Twin Bridges
  const climbInsideOut = computeOutOfBoundsFraction(14.0 * MAP_SCALE, (HIGH_CLIMB_CONFIG.laneZ + 1.80) * MAP_SCALE, -Math.PI / 2, 1.20, MAP_SCALE);
  assert.equal(climbInsideOut, 0, 'zigzagging inside High Climb lane (outer edge at 9.31 < 9.35) must read 0% out');
  const climbTouchOut = computeOutOfBoundsFraction(14.0 * MAP_SCALE, (HIGH_CLIMB_CONFIG.laneZ + 2.00) * MAP_SCALE, -Math.PI / 2, 1.20, MAP_SCALE);
  assert.ok(climbTouchOut > 0 && climbTouchOut < 0.50, `touching High Climb line should stay <50%, got ${climbTouchOut}`);
  const bridgeCenterOut = computeOutOfBoundsFraction(-4.20 * MAP_SCALE, -6.75 * MAP_SCALE, -Math.PI / 2, 1.35, MAP_SCALE);
  assert.equal(bridgeCenterOut, 0, 'crossing centered across twin hanging bridges must read 0% out of bounds');
  const spiralTopOut = computeOutOfBoundsFraction(-4.50 * MAP_SCALE, (SPIRAL_CONFIG.rCenter) * MAP_SCALE, 0, 1.60, MAP_SCALE);
  assert.equal(spiralTopOut, 0, 'riding centered along spiral track must read 0% out of bounds');
});

test('multi-factor fall evaluation ignores minor curb drops and scales damage/battery/points by height, speed & place', () => {
  // 1. Small 0.17m flat-road curb drop -> zero damage, zero battery shock, zero points penalty
  const minor = evaluateFallOutcome({
    dropHeightM: 0.17,
    impactSpeedMps: 1.8,
    horizontalSpeedMps: 4.5,
    landingPlace: 'arena_floor',
    originZone: 'track_edge',
    isInverted: false,
  }, DEFAULT_SCORING_CONFIG);
  assert.equal(minor.significantFall, false);
  assert.equal(minor.chassisDamageFactor, 0);
  assert.equal(minor.batteryShockPct, 0);
  assert.equal(minor.pointsPenalty, 0);

  // 2. Elevated fall from Hanging Bridge into soft Sand Pit vs high 3.2m Spiral/Climb drop onto hard concrete arena floor
  const bridgeSandFall = evaluateFallOutcome({
    dropHeightM: 2.20,
    impactSpeedMps: 5.8,
    horizontalSpeedMps: 2.5,
    landingPlace: 'sand_pit',
    originZone: 'hanging_bridge',
    isInverted: false,
  }, DEFAULT_SCORING_CONFIG);

  const highFloorFall = evaluateFallOutcome({
    dropHeightM: 3.35,
    impactSpeedMps: 7.4,
    horizontalSpeedMps: 6.0,
    landingPlace: 'arena_floor',
    originZone: 'high_climb',
    isInverted: true,
  }, DEFAULT_SCORING_CONFIG);

  assert.equal(bridgeSandFall.significantFall, true);
  assert.equal(highFloorFall.significantFall, true);
  assert.ok(bridgeSandFall.batteryShockPct >= 3 && highFloorFall.batteryShockPct > bridgeSandFall.batteryShockPct, 'higher/harder inverted fall must jolt battery harder');
  assert.ok(highFloorFall.pointsPenalty > bridgeSandFall.pointsPenalty, 'higher fall on hard concrete at speed must deduct more points');
  assert.ok(highFloorFall.effectiveImpactMps > bridgeSandFall.effectiveImpactMps);

  // Place classifier sanity checks
  assert.equal(classifyFallZone(-4.0, -6.75, HANGING_SAND_PIT_Y), 'sand_pit');
  assert.equal(classifyFallZone(5.0, -13.50, -0.30), 'water_basin');
  assert.equal(classifyFallZone(14.0, 2.0, -0.50), 'arena_floor');
});
