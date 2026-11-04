import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCourseHeight,
  evaluateCourseSurface,
  generateRockFieldStones,
  validateRouteClearance,
  HILL_NODES,
  hillHeightAt,
  CHECKPOINTS,
  crossesCheckpointGate,
  SLALOM_BLOCKS,
  validateSlalomClearance,
  SPEED_BREAKER_XS,
  DRIVE_ROUTE,
  DRIVE_ROUTE_WIDTH,
  ARENA_FLOOR_HEIGHT,
  GROUND_DECK_HEIGHT,
  ROUTE_DECK_HEIGHT,
  ELEVATION_TIER_SMALL,
  ELEVATION_TIER_MEDIUM,
  ELEVATION_TIER_MAJOR,
  SPIRAL_CONFIG,
  evaluateSpiralRamp,
  PARALLEL_PLANK_CENTERS,
  PARALLEL_PLANK_CENTER_Z,
  MAP_SCALE,
  validateDriveRoute,
  validateObstacleSequence,
  validateTrackElevationDistribution,
  TRACK_A,
  TRACK_B,
  TRACK_C,
  TRACK_D,
  getActiveTrack,
  setActiveTrack,
  type CourseCollider,
} from './courseLayout.ts';
import { TRACK_WIDTH } from './vehicleDynamics.ts';

test('mandatory sequence: obstacle[-2] is FIRE and obstacle[-1] is WATER across ALL tracks', () => {
  for (const track of [TRACK_A, TRACK_B, TRACK_C, TRACK_D]) {
    const result = validateObstacleSequence(track.obstacles);
    assert.ok(result.valid, `${track.name} failed mandatory sequence validation: ${result.error}`);

    const secondLast = track.obstacles[track.obstacles.length - 2];
    const last = track.obstacles[track.obstacles.length - 1];
    assert.strictEqual(secondLast.kind, 'fire', `${track.name} second-last obstacle must be fire`);
    assert.strictEqual(last.kind, 'water', `${track.name} last obstacle must be water`);
  }
});

test('mixed elevation distribution: 70-80% ground-level, 20-30% elevated on each track', () => {
  for (const track of [TRACK_A, TRACK_B, TRACK_C, TRACK_D]) {
    const dist = validateTrackElevationDistribution(track);
    assert.ok(dist.valid, `${track.name} elevation stats out of target: ground ${dist.groundRatio}, elevated ${dist.elevatedRatio}`);
    assert.ok(dist.groundRatio >= 0.70 && dist.groundRatio <= 0.80, `${track.name} ground ratio ${dist.groundRatio} outside 70-80%`);
    assert.ok(dist.elevatedRatio >= 0.20 && dist.elevatedRatio <= 0.30, `${track.name} elevated ratio ${dist.elevatedRatio} outside 20-30%`);
  }
});

test('spiral ramp geometry: continuous helical climb, parking garage gradient, and rooftop deck', () => {
  // Ground entrance at west tangent (x = -5.60, z = 0.0)
  const entrance = evaluateSpiralRamp(-5.60, 0.0, -0.33);
  assert.ok(entrance.inSpiral);
  assert.ok(Math.abs(entrance.height - SPIRAL_CONFIG.yGround) < 0.05, `entrance should match ground elevation -0.33m, got ${entrance.height}`);

  // Quarter-turn at south quadrant (x = -4.5, z = -1.10)
  const quarterTurn = evaluateSpiralRamp(-4.5, -1.10, 0.10);
  assert.ok(quarterTurn.inSpiral);
  assert.ok(quarterTurn.height > SPIRAL_CONFIG.yGround && quarterTurn.height < SPIRAL_CONFIG.yTop);

  // Midway climb at north quadrant (x = -4.5, z = 1.10)
  const midClimb = evaluateSpiralRamp(-4.5, 1.10, 0.60);
  assert.ok(midClimb.inSpiral);
  assert.ok(midClimb.height > quarterTurn.height && midClimb.height < SPIRAL_CONFIG.yTop);

  // Upper rooftop observation deck at x = 1.0, z = 0.0
  const rooftop = evaluateSpiralRamp(1.0, 0.0, 3.20);
  assert.ok(rooftop.inSpiral);
  assert.ok(Math.abs(rooftop.height - SPIRAL_CONFIG.yTop) < 0.01, `rooftop deck should rest at ${SPIRAL_CONFIG.yTop}m, got ${rooftop.height}`);

  // Connected descending ramp midpoint at x = 6.95, z = 0.0
  const midDescent = evaluateSpiralRamp(6.95, 0.0, 1.50);
  assert.ok(midDescent.inSpiral);
  assert.ok(midDescent.height < SPIRAL_CONFIG.yTop && midDescent.height > SPIRAL_CONFIG.yGround);

  // Descent ramp touchdown at ground (x = 10.45, z = 0.0)
  const touchdown = evaluateSpiralRamp(10.45, 0.0, -0.30);
  assert.ok(touchdown.inSpiral);
  assert.ok(Math.abs(touchdown.height - SPIRAL_CONFIG.yGround) < 0.05, `descent ramp must return smoothly to ground -0.33m, got ${touchdown.height}`);

  // Gradient check: steep trial climb where robot power requires zigzag tacking
  const rise = SPIRAL_CONFIG.yTop - SPIRAL_CONFIG.yGround;
  const rampLength = SPIRAL_CONFIG.turns * 2 * Math.PI * SPIRAL_CONFIG.rCenter;
  const gradient = (rise / rampLength) * 100;
  assert.ok(gradient >= 20.0 && gradient <= 45.0, `spiral gradient should reflect steep trial climb requiring zigzag tacking, got ${gradient.toFixed(2)}%`);

  // Clearance check: expanded road width matches ~1.5x bot width (1.75m to 2.60m)
  assert.ok(SPIRAL_CONFIG.roadWidth >= 1.75 && SPIRAL_CONFIG.roadWidth <= 2.60, `road width should match expanded clearance, got ${SPIRAL_CONFIG.roadWidth}`);
});

test('spiral ramp height is strictly monotonic without cliff discontinuities or spin-out jumps', () => {
  // 1. Entrance boundary sensitivity: z crossing near West entrance must have zero height cliffs
  for (const dz of [-0.20, -0.05, 0.0, 0.05, 0.20]) {
    const res = evaluateSpiralRamp(-5.60, dz, -0.33);
    assert.ok(res.inSpiral);
    assert.ok(Math.abs(res.height - SPIRAL_CONFIG.yGround) <= 0.08, `entrance at dz=${dz} should be near ground -0.33m, got ${res.height}`);
  }

  // 2. Full traversal monotonicity from entrance to summit across 36 steps
  let prevH = SPIRAL_CONFIG.yGround - 0.01;
  let simulatedPoseY = SPIRAL_CONFIG.yGround;
  for (let s = 0; s <= 36; s++) {
    const theta = Math.PI + (s / 36) * 3 * Math.PI;
    const x = SPIRAL_CONFIG.cx + SPIRAL_CONFIG.rCenter * Math.cos(theta);
    const z = SPIRAL_CONFIG.cz + SPIRAL_CONFIG.rCenter * Math.sin(theta);
    const res = evaluateSpiralRamp(x, z, simulatedPoseY);
    assert.ok(res.inSpiral, `point at step ${s} must be in spiral`);
    assert.ok(res.height >= prevH - 1e-4, `step ${s} height drop from ${prevH} to ${res.height}`);
    prevH = res.height;
    simulatedPoseY = res.height;
  }
  assert.ok(Math.abs(prevH - SPIRAL_CONFIG.yTop) <= 0.02, `summit must reach yTop 3.20m, got ${prevH}`);

  // 3. Roll differential across track width (0.65m) inside spiral stays subtle (< 0.05m banking)
  for (let s = 0; s <= 24; s++) {
    const theta = Math.PI + (s / 24) * 3 * Math.PI;
    const rIn = SPIRAL_CONFIG.rCenter - 0.32;
    const rOut = SPIRAL_CONFIG.rCenter + 0.32;
    const poseY = SPIRAL_CONFIG.yGround + (s / 24) * (SPIRAL_CONFIG.yTop - SPIRAL_CONFIG.yGround);
    const hIn = evaluateSpiralRamp(SPIRAL_CONFIG.cx + rIn * Math.cos(theta), SPIRAL_CONFIG.cz + rIn * Math.sin(theta), poseY).height;
    const hOut = evaluateSpiralRamp(SPIRAL_CONFIG.cx + rOut * Math.cos(theta), SPIRAL_CONFIG.cz + rOut * Math.sin(theta), poseY).height;
    const rollDiff = Math.abs(hOut - hIn);
    assert.ok(rollDiff <= 0.05, `step ${s} roll differential should be <= 0.05m (gentle banking), got ${rollDiff}`);
  }
});

test('spiral ramp ascending and descending paths have zero physical overlap', () => {
  // Ascending helix is contained within x in [-9.6, -1.2]
  // Descending ramp is contained within x in [3.75, 12.50]
  // They are completely separated horizontally
  assert.ok(SPIRAL_CONFIG.descentX0 > SPIRAL_CONFIG.cx + SPIRAL_CONFIG.rInner);
  assert.ok(SPIRAL_CONFIG.descentX1 > SPIRAL_CONFIG.descentX0);
});

test('ground-level roads sit on arena floor and raised obstacles provide authentic elevations', () => {
  // Lane 1 start bay is on ground
  assert.equal(evaluateCourseHeight(-20.5, 13.50), GROUND_DECK_HEIGHT);

  // Lane 1 Slalom corridor is on ground
  assert.equal(evaluateCourseHeight(-11.5, 13.50), GROUND_DECK_HEIGHT);

  // Rock field platform is elevated +0.45m tier
  const rockH = evaluateCourseHeight(10.25, 13.50);
  assert.ok(rockH > GROUND_DECK_HEIGHT + 0.40, `rock field platform should be elevated, got ${rockH}`);

  // Spiral Rooftop Deck is elevated +3.53m tier (y = 3.20m)
  const deckH = evaluateCourseHeight(1.0, 0.0, 3.20);
  assert.ok(Math.abs(deckH - 3.20) < 0.02, `rooftop deck height expected 3.20m, got ${deckH}`);

  // Lane 5 Fire hazard hearth is at y = 0.05m (+0.38m above ground)
  const fireH = evaluateCourseHeight(-3.0, -13.50);
  assert.ok(Math.abs(fireH - 0.05) < 0.02, `fire hazard hearth should be at 0.05m, got ${fireH}`);

  // Lane 5 Deep water basin bed is submerged at y = -0.30m
  const waterBedH = evaluateCourseHeight(5.0, -13.50);
  assert.ok(Math.abs(waterBedH - (-0.30)) < 0.02, `water basin bed should be at -0.30m, got ${waterBedH}`);

  // Lane 5 Grand finish straight is on ground
  assert.equal(evaluateCourseHeight(12.0, -13.50), GROUND_DECK_HEIGHT);
});

test('evaluateCourseSurface implements mandatory sequence: spiral -> fire -> water', () => {
  // Spiral ramp high traction
  const spiralSurf = evaluateCourseSurface(-4.5, 1.10, 0.60);
  assert.ok(spiralSurf.grip >= 1.05, 'spiral ramp has high traction surface');

  // Fire hazard on Lane 5
  const fireSurf = evaluateCourseSurface(-3.0, -13.50);
  assert.equal(fireSurf.hazard, 'fire');

  // Heat-shield cooling bridge before water
  const coolingSurf = evaluateCourseSurface(0.0, -13.50);
  assert.equal(coolingSurf.hazard, 'none');

  // Deep water basin on Lane 5
  const waterSurf = evaluateCourseSurface(5.0, -13.50);
  assert.equal(waterSurf.hazard, 'water');
  assert.ok(waterSurf.grip < 0.60, 'water grip reduced');

  // Slippery steel sheet on Lane 2
  const slipSurf = evaluateCourseSurface(-11.5, 6.75);
  assert.ok(slipSurf.grip < 0.30, 'slippery sheet has low grip');
});

test('generateRockFieldStones produces deterministic stones distributed across full usable road width', () => {
  const stones1 = generateRockFieldStones(20261027);
  const stones2 = generateRockFieldStones(20261027);
  assert.equal(stones1.length, 140, 'stone count should be 140 for full-width coverage');
  assert.equal(stones1.length, stones2.length);
  assert.deepEqual(stones1[0], stones2[0]);

  let leftFlankCount = 0;
  let rightFlankCount = 0;
  for (const st of stones1) {
    assert.ok(st.x >= 6.50 && st.x <= 14.00, `stone x ${st.x} out of bounds`);
    assert.ok(st.z >= 11.50 && st.z <= 15.50, `stone z ${st.z} out of bounds`);
    assert.ok(st.scaleX > 0 && st.scaleY > 0 && st.scaleZ > 0);
    if (st.z < 12.80) leftFlankCount++;
    if (st.z > 14.20) rightFlankCount++;
  }
  assert.ok(leftFlankCount >= 30, `expected at least 30 stones on left flank, got ${leftFlankCount}`);
  assert.ok(rightFlankCount >= 30, `expected at least 30 stones on right flank, got ${rightFlankCount}`);
});

test('all checkpoints are defined in sequential order and span road corridor', () => {
  assert.equal(CHECKPOINTS.length, 12);
  for (let i = 0; i < CHECKPOINTS.length; i++) {
    assert.equal(CHECKPOINTS[i].id, i + 1);
    assert.ok(CHECKPOINTS[i].width >= DRIVE_ROUTE_WIDTH + 0.3, 'gate posts must sit outside the road corridor');
  }
});

test('continuous drive corridor stays in the arena and passes every checkpoint in order', () => {
  const audit = validateDriveRoute();
  assert.equal(audit.valid, true, audit.issues.join('; '));
  assert.ok(DRIVE_ROUTE_WIDTH >= 4.0 && DRIVE_ROUTE_WIDTH <= 5.0, 'road width accommodates ~3x robot width');
  let previousIndex = -1;
  for (const gate of CHECKPOINTS) {
    const index = DRIVE_ROUTE.findIndex(p => Math.hypot(p.x - gate.x, p.z - gate.z) < 0.05);
    assert.ok(index > previousIndex, `checkpoint ${gate.id} (${gate.label}) must be on the connected road in order`);
    previousIndex = index;
  }
});

test('paired plank support spacing matches both robot track contact lines', () => {
  const worldSpacing = Math.abs(PARALLEL_PLANK_CENTERS[1].z - PARALLEL_PLANK_CENTERS[0].z) * MAP_SCALE;
  assert.ok(Math.abs(worldSpacing - TRACK_WIDTH) < 1e-6, 'each track should align over one plank');
});

test('slalom hurdles are alternating solid brick walls, spaced for a clear weave', () => {
  assert.equal(SLALOM_BLOCKS.length, 5);
  assert.equal(SPEED_BREAKER_XS.length, 3);
  for (let i = 0; i < SLALOM_BLOCKS.length; i++) {
    const b = SLALOM_BLOCKS[i];
    assert.ok(b.length > 0 && b.span >= 1.50 && b.height >= 1.0);
    if (i > 0) {
      assert.ok(SLALOM_BLOCKS[i - 1].x < b.x);
      assert.ok(b.x - SLALOM_BLOCKS[i - 1].x >= 3.0);
      assert.notEqual(SLALOM_BLOCKS[i - 1].side, b.side);
    }
  }
});

test('each slalom hurdle leaves a physically passable opening for the robot envelope', () => {
  const audit = validateSlalomClearance();
  assert.equal(audit.valid, true, audit.issues.join('; '));
});

test('checkpoint gates require a forward crossing through the opening', () => {
  const gate = CHECKPOINTS[0];
  const gx = gate.x * MAP_SCALE;
  const gz = gate.z * MAP_SCALE;
  assert.equal(crossesCheckpointGate({ x: gx - 1, z: gz }, { x: gx + 1, z: gz }, gate), true);
  assert.equal(crossesCheckpointGate({ x: gx + 1, z: gz }, { x: gx - 1, z: gz }, gate), false);
});

test('validateRouteClearance catches any collider placed inside a checkpoint gate', () => {
  const dummyColliders: CourseCollider[] = [
    { id: 'safe_wall', x: 20, z: 20, hx: 1, hz: 1, y: 0.5, height: 1, rot: 0, walkable: false },
  ];
  const clearResult = validateRouteClearance(dummyColliders);
  assert.equal(clearResult.valid, true);

  const blockedColliders: CourseCollider[] = [
    { id: 'rogue_barrier', x: CHECKPOINTS[0].x, z: CHECKPOINTS[0].z, hx: 0.5, hz: 0.5, y: 0.5, height: 1, rot: 0, walkable: false },
  ];
  const blockedResult = validateRouteClearance(blockedColliders);
  assert.equal(blockedResult.valid, false);
});
