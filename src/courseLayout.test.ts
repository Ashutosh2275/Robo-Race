import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_LENGTH, TRACK_CONTACT_OFFSET, stepVehicle3D, type VehiclePose } from './vehicleDynamics.ts';
import { integrateDrive, slopeAt } from './drivePhysics.ts';
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
  SPEED_BREAKER_CONFIG,
  HIGH_CLIMB_CONFIG,
  TRACK_B_OBSTACLES,
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
  PENDULUM_CONFIG,
  HANGING_BRIDGE_CONFIG,
  HANGING_SAND_PIT_Y,
  hangingBridgeTrackHeightAt,
  buildHairpinRibbonPath,
  computeRibbonSampleFrame,
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

  // Iridescent Oil Spill Hazard Zone on Lane 3
  const oilSurf = evaluateCourseSurface(-10.0, 0.00);
  assert.equal(oilSurf.hazard, 'oil', 'oil skid pad on Lane 3 must report oil hazard');
  assert.ok(oilSurf.grip <= 0.16, `oil slick must cause severe slip (grip <= 0.16), got ${oilSurf.grip}`);
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

test('slalom hurdles are alternating solid brick walls, spaced for a clear weave and expanded to the center', () => {
  assert.equal(SLALOM_BLOCKS.length, 5);
  assert.equal(SPEED_BREAKER_XS.length, 3);
  for (let i = 0; i < SLALOM_BLOCKS.length; i++) {
    const b = SLALOM_BLOCKS[i];
    assert.ok(b.length > 0 && b.span >= 1.50 && b.height >= 1.0);
    assert.equal(b.span, DRIVE_ROUTE_WIDTH / 2, 'brick width must expand up to the road center');
    const innerEdge = b.side === 'left' ? b.z - b.span / 2 : b.z + b.span / 2;
    assert.ok(Math.abs(innerEdge - 13.50) < 0.001, 'inner edge of brick hurdle must touch the road center (z = 13.50)');
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

test('Lane 4 Swinging Pendulum Gauntlet: comfortable 2.00m catwalk bridge, 1.35m elevated deck, counter-swinging balls with 2.25x bot length gaps, and edge fall-off', () => {
  assert.equal(PENDULUM_CONFIG.deckWidth, 2.00, 'catwalk bridge width should be 2.00m');
  assert.equal(PENDULUM_CONFIG.deckY, 1.35, 'elevated bridge deck height should be 1.35m');
  assert.equal(PENDULUM_CONFIG.ballPositionsX.length, 3, 'should feature 3 swinging pendulum balls');

  // Verify clear gaps between balls are ~2.25 times the bot length (1.70m world / 1.3 = 1.308m course)
  const ballDiameter = PENDULUM_CONFIG.ballRadius * 2;
  const botLengthCourse = TRACK_LENGTH / MAP_SCALE; // ~1.308m
  const gap12 = Math.abs(PENDULUM_CONFIG.ballPositionsX[0] - PENDULUM_CONFIG.ballPositionsX[1]) - ballDiameter;
  const gap23 = Math.abs(PENDULUM_CONFIG.ballPositionsX[1] - PENDULUM_CONFIG.ballPositionsX[2]) - ballDiameter;
  const ratio12 = gap12 / botLengthCourse;
  const ratio23 = gap23 / botLengthCourse;
  assert.ok(Math.abs(ratio12 - 2.25) < 0.05, `gap between Ball 1 & 2 (${gap12.toFixed(2)}m) must be ~2.25x bot length (${(2.25 * botLengthCourse).toFixed(2)}m), got ${ratio12.toFixed(2)}x`);
  assert.ok(Math.abs(ratio23 - 2.25) < 0.05, `gap between Ball 2 & 3 (${gap23.toFixed(2)}m) must be ~2.25x bot length (${(2.25 * botLengthCourse).toFixed(2)}m), got ${ratio23.toFixed(2)}x`);

  // Verify parallel and opposite swing phase: Ball 1 and 3 in phase (parallel), Ball 2 in anti-phase (opposite)
  assert.equal(PENDULUM_CONFIG.phaseOffsets[0], PENDULUM_CONFIG.phaseOffsets[2], 'Ball 1 and Ball 3 must swing parallelly in phase');
  const phaseDiff12 = Math.abs(PENDULUM_CONFIG.phaseOffsets[1] - PENDULUM_CONFIG.phaseOffsets[0]);
  assert.ok(Math.abs(phaseDiff12 - Math.PI) < 0.01, 'Ball 2 (middle) must swing opposite to Ball 1 and 3');

  // Entrance before ascent ramp (x = 16.20, z = -6.75) is ground level
  const hEntry = evaluateCourseHeight(16.20, -6.75);
  assert.ok(Math.abs(hEntry - GROUND_DECK_HEIGHT) < 0.02);

  // Midway up the ascent ramp (x = 15.35, z = -6.75)
  const hAscent = evaluateCourseHeight(15.35, -6.75);
  assert.ok(hAscent > GROUND_DECK_HEIGHT + 0.30 && hAscent < PENDULUM_CONFIG.deckY);

  // Center of elevated catwalk deck (x = 10.00, z = -6.75)
  const hDeckCenter = evaluateCourseHeight(10.00, -6.75, PENDULUM_CONFIG.deckY);
  assert.ok(Math.abs(hDeckCenter - PENDULUM_CONFIG.deckY) < 0.02);

  // Falling off the edge: lateral distance > 1.00m (deckWidth / 2)
  const hFallenOff = evaluateCourseHeight(10.00, -6.75 + 1.15, PENDULUM_CONFIG.deckY);
  assert.equal(hFallenOff, ARENA_FLOOR_HEIGHT, 'drifting beyond 2.00m catwalk bridge deck edge must drop to arena floor');

  // Exit ramp touchdown (x = 3.80, z = -6.75) is ground level
  const hExit = evaluateCourseHeight(3.80, -6.75);
  assert.ok(Math.abs(hExit - GROUND_DECK_HEIGHT) < 0.02);
});

test('Lane 4 Dual Hanging Suspension Bridges: spread 2x-wheel narrow tracks, random non-swinging hang, and open sand pit below', () => {
  // Approach ramp start at ground (x = 2.40, z = -6.75)
  const hRampStart = evaluateCourseHeight(2.40, -6.75);
  assert.ok(Math.abs(hRampStart - GROUND_DECK_HEIGHT) < 0.02);

  // Top of ascent ramp / East tower threshold (x = 0.80, z = -6.75)
  const hEastTower = evaluateCourseHeight(0.80, -6.75);
  assert.ok(Math.abs(hEastTower - HANGING_BRIDGE_CONFIG.deckY) < 0.02);

  // Twin trackways must be double the 0.36m wheel width (~0.728m world) and spread across TRACK_WIDTH
  const plankWorldWidth = HANGING_BRIDGE_CONFIG.trackWidth * MAP_SCALE;
  assert.ok(plankWorldWidth >= 0.70 && plankWorldWidth <= 0.78, `plank width must be ~2x 0.36m wheel (${plankWorldWidth.toFixed(3)}m)`);

  // Each individual spread track supports the vehicle with non-swinging organic random hang variation
  const leftTrackY = evaluateCourseHeight(-1.70, PARALLEL_PLANK_CENTERS[0].z, HANGING_BRIDGE_CONFIG.deckY);
  const rightTrackY = evaluateCourseHeight(-1.70, PARALLEL_PLANK_CENTERS[1].z, HANGING_BRIDGE_CONFIG.deckY);
  assert.ok(leftTrackY <= HANGING_BRIDGE_CONFIG.deckY && leftTrackY >= HANGING_BRIDGE_CONFIG.deckY - 0.16);
  assert.ok(rightTrackY <= HANGING_BRIDGE_CONFIG.deckY && rightTrackY >= HANGING_BRIDGE_CONFIG.deckY - 0.16);
  assert.notEqual(
    hangingBridgeTrackHeightAt(-1.70, 0),
    hangingBridgeTrackHeightAt(-1.70, 1),
    'twin hanging bridges should exhibit subtle asymmetric organic vertical hang rather than identical flat slabs',
  );

  // Center gap between spread tracks AND outer edges have NOTHING below down to sand pit (-0.85m)
  const hCenterGap = evaluateCourseHeight(-1.70, -6.75, HANGING_BRIDGE_CONFIG.deckY);
  assert.equal(hCenterGap, HANGING_SAND_PIT_Y, 'open void between twin narrow bridges must drop directly to the sunken sand pit floor');
  const hOuterVoid = evaluateCourseHeight(-1.70, -6.75 + 1.05, HANGING_BRIDGE_CONFIG.deckY);
  assert.equal(hOuterVoid, HANGING_SAND_PIT_Y, 'straying outside narrow plank trackways must drop into the sand pit');

  // Inside the sunken sand pit surface returns deep loose sand
  const sandSurface = evaluateCourseSurface(-4.20, -6.75, HANGING_SAND_PIT_Y);
  assert.equal(sandSurface.hazard, 'sand');
  assert.ok(sandSurface.rollingResistance >= 2.0, 'deep sand pit floor should exert heavy sand drag');

  // Descent ramp touchdown at ground (x = -10.80, z = -6.75)
  const hExit = evaluateCourseHeight(-10.80, -6.75);
  assert.ok(Math.abs(hExit - GROUND_DECK_HEIGHT) < 0.02);
});

test('turntable pier and base footing colliders provide solid ground barrier while leaving summit deck clear', () => {
  const pierColHeight = 1.90;
  const pierCollider: CourseCollider = {
    id: 'turntable_pier_column',
    x: 1.0,
    z: 0.0,
    hx: 0.82,
    hz: 0.82,
    y: ARENA_FLOOR_HEIGHT + pierColHeight / 2,
    height: pierColHeight,
    rot: 0,
    walkable: false,
  };
  const footingCollider: CourseCollider = {
    id: 'turntable_pier_footing',
    x: 1.0,
    z: 0.0,
    hx: 1.15,
    hz: 1.15,
    y: ARENA_FLOOR_HEIGHT + 0.25,
    height: 0.50,
    rot: 0,
    walkable: false,
  };

  // 1. Neither collider intrudes on any active checkpoint gates
  const clearance = validateRouteClearance([pierCollider, footingCollider]);
  assert.equal(clearance.valid, true, `pier and footing must not intrude on checkpoints: ${clearance.issues.join(', ')}`);

  // 2. Pier column top (1.57m) is below elevated summit deck (3.20m) by >= 1.50m
  const pierTop = pierCollider.y + pierCollider.height / 2;
  assert.ok(pierTop <= SPIRAL_CONFIG.yTop - 1.50, `pier top (${pierTop.toFixed(2)}m) must leave clearance under summit deck (${SPIRAL_CONFIG.yTop}m)`);

  // 3. Ground-level bot contact (y = -0.33m) overlaps vertical barrier envelope of footing and column
  const groundBotBottom = ARENA_FLOOR_HEIGHT - 0.05;
  const groundBotTop = ARENA_FLOOR_HEIGHT + 0.40;
  const footingBottom = footingCollider.y - footingCollider.height / 2;
  const footingTop = footingCollider.y + footingCollider.height / 2;
  assert.ok(footingTop >= groundBotBottom && footingBottom <= groundBotTop, 'ground vehicle must intersect footing vertical collision envelope');
});

test('spiral central core pylon colliders provide snug barriers without intruding into driving curve', () => {
  const pylonRadius = 0.25;
  const pylonTopY = SPIRAL_CONFIG.yTop + 0.25;
  const pylonHeight = pylonTopY - ARENA_FLOOR_HEIGHT;
  const pylonCenterY = ARENA_FLOOR_HEIGHT + pylonHeight / 2;

  const pylonColA: CourseCollider = {
    id: 'spiral_central_pylon_a',
    x: SPIRAL_CONFIG.cx,
    z: SPIRAL_CONFIG.cz,
    hx: 0.19,
    hz: 0.19,
    y: pylonCenterY,
    height: pylonHeight,
    rot: 0,
    walkable: false,
  };
  const pylonColB: CourseCollider = {
    id: 'spiral_central_pylon_b',
    x: SPIRAL_CONFIG.cx,
    z: SPIRAL_CONFIG.cz,
    hx: 0.19,
    hz: 0.19,
    y: pylonCenterY,
    height: pylonHeight,
    rot: Math.PI / 4,
    walkable: false,
  };
  const footingCol: CourseCollider = {
    id: 'spiral_pylon_footing',
    x: SPIRAL_CONFIG.cx,
    z: SPIRAL_CONFIG.cz,
    hx: 0.40,
    hz: 0.40,
    y: ARENA_FLOOR_HEIGHT + 0.175,
    height: 0.35,
    rot: 0,
    walkable: false,
  };

  // 1. None of the pylon colliders intrude on any active checkpoint gates
  const clearance = validateRouteClearance([pylonColA, pylonColB, footingCol]);
  assert.equal(clearance.valid, true, `spiral pylon must not intrude on checkpoints: ${clearance.issues.join(', ')}`);

  // 2. Maximum outer radius of the octagonal pylon prism stays within 0.29m of center
  const maxCornerDistA = Math.hypot(pylonColA.hx, pylonColA.hz);
  const maxCornerDistB = Math.hypot(pylonColB.hx, pylonColB.hz);
  assert.ok(maxCornerDistA <= 0.29, `pylon box A corners (${maxCornerDistA.toFixed(3)}m) must stay inside 0.29m`);
  assert.ok(maxCornerDistB <= 0.29, `pylon box B corners (${maxCornerDistB.toFixed(3)}m) must stay inside 0.29m`);

  // 3. Centerline driving radius (1.35m) leaves >= 1.05m clearance from pylon outer corner
  const drivingClearance = SPIRAL_CONFIG.rCenter - maxCornerDistA;
  assert.ok(drivingClearance >= 1.05, `centerline driving clearance (${drivingClearance.toFixed(2)}m) must be >= 1.05m`);

  // 4. Ground entrance at x = -5.85 leaves >= 0.90m clearance from foundation footing plinth (x = -4.50, hx = 0.40)
  const footingWestEdge = SPIRAL_CONFIG.cx - footingCol.hx; // -4.90m
  const entranceDist = Math.abs(-5.85 - footingWestEdge); // 0.95m
  assert.ok(entranceDist >= 0.90, `ground approach clearance (${entranceDist.toFixed(2)}m) must be >= 0.90m`);
});

test('Lane 1 speed bumps are removed and relocated to Lane 2 as 3 huge passable Mega Speed Hump obstacles', () => {
  // 1. Old Lane 1 coordinates (x = 1.2, 2.2, 3.2 at z = 13.50) must be flat ground level before Gate 02 & Rock Field
  for (const oldX of [1.2, 2.2, 3.2]) {
    assert.equal(evaluateCourseHeight(oldX, 13.50), GROUND_DECK_HEIGHT, `Lane 1 at x=${oldX} must be flat ground without bumps`);
  }

  // 2. Obstacle order in Track B: Rock Field before Mega Speed Humps on Lane 2 (z = 6.75)
  const rockIdx = TRACK_B_OBSTACLES.findIndex(o => o.kind === 'rockfield');
  const speedIdx = TRACK_B_OBSTACLES.findIndex(o => o.kind === 'speed_breakers');
  assert.ok(rockIdx >= 0 && speedIdx > rockIdx, 'speed_breakers obstacle must come AFTER rock_field');
  assert.equal(TRACK_B_OBSTACLES[speedIdx].z, 6.75, 'speed_breakers obstacle must be on Lane 2 (z = 6.75)');

  // 3. 3 massive full-width humps cleanly positioned on Lane 2 after Hairpin 1 and before Slippery Steel Sheet
  assert.equal(SPEED_BREAKER_XS.length, 3);
  assert.equal(SPEED_BREAKER_CONFIG.laneZ, 6.75);
  assert.ok(SPEED_BREAKER_CONFIG.height >= 0.70, `each bump must be very huge (>= 0.70m), got ${SPEED_BREAKER_CONFIG.height}m`);
  assert.ok(SPEED_BREAKER_CONFIG.halfLength >= 1.65, 'broad smooth chord lets robot pitch cleanly without cliff snap');
  for (const bx of SPEED_BREAKER_XS) {
    assert.ok(bx + SPEED_BREAKER_CONFIG.halfLength < 6.50, 'must leave clean separation from Track D switchback hill [6.5, 14.5]');
    assert.ok(bx - SPEED_BREAKER_CONFIG.halfLength > -9.50, 'must leave runway before Slippery Steel Sheet [-14.0, -9.5]');
    const apexH = evaluateCourseHeight(bx, SPEED_BREAKER_CONFIG.laneZ);
    assert.ok(Math.abs((apexH - GROUND_DECK_HEIGHT) - SPEED_BREAKER_CONFIG.height) < 0.005, `apex height at x=${bx} expected +${SPEED_BREAKER_CONFIG.height}m`);
    const surf = evaluateCourseSurface(bx, SPEED_BREAKER_CONFIG.laneZ);
    assert.ok(surf.grip >= 1.00, `mega hump at x=${bx} must offer strong molded traction grip (>= 1.00), got ${surf.grip}`);
  }

  // 4. Live physics simulation: robot drives Westbound along Lane 2 across all 3 mega humps on Pro grip (0.68) without flipping
  const worldH = (wx: number, wz: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE);
  const dt = 1 / 120;
  const startWorldX = 8.0 * MAP_SCALE;
  const laneWorldZ = 6.75 * MAP_SCALE;
  const driveState = { x: startWorldX, z: laneWorldZ, vx: 0, vz: 0, yaw: -Math.PI / 2, angular: 0 };
  const pose: VehiclePose = {
    x: startWorldX,
    z: laneWorldZ,
    y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
    vx: 0,
    vy: 0,
    vz: 0,
    pitch: 0,
    yaw: -Math.PI / 2,
    roll: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
    isFlipped: false,
    isGrounded: true,
    flippedTimer: 0,
  };
  let maxPitch = -Infinity;
  let minPitch = Infinity;
  let maxPoseY = -Infinity;
  for (let step = 0; step < 120 * 10; step++) {
    const lx = driveState.x / MAP_SCALE;
    const lz = driveState.z / MAP_SCALE;
    const slope = slopeAt((sx, sz) => evaluateCourseHeight(sx, sz), lx, lz);
    const surf = evaluateCourseSurface(lx, lz);
    integrateDrive(
      driveState,
      1.0,
      1.0,
      { grip: surf.grip * 0.68, rollingResistance: surf.rollingResistance },
      slope,
      { maxSpeed: 6.8, motorAcceleration: 8.5, braking: 10, turnRate: 1.25, turnResponse: 16, gravity: 9.81 },
      dt,
    );
    pose.x = driveState.x;
    pose.z = driveState.z;
    pose.vx = driveState.vx;
    pose.vz = driveState.vz;
    pose.yaw = driveState.yaw;
    stepVehicle3D(pose, worldH, Math.hypot(driveState.vx, driveState.vz), 0, dt, 9.81, false);
    assert.equal(pose.isFlipped, false, `robot must not flip while traversing mega humps (step=${step}, x=${(pose.x / MAP_SCALE).toFixed(2)})`);
    maxPitch = Math.max(maxPitch, pose.pitch);
    minPitch = Math.min(minPitch, pose.pitch);
    maxPoseY = Math.max(maxPoseY, pose.y);
    if (driveState.x <= -7.5 * MAP_SCALE) break;
  }
  assert.ok(driveState.x <= -7.5 * MAP_SCALE, `robot must successfully pass all 3 mega humps, reached x=${(driveState.x / MAP_SCALE).toFixed(2)}`);
  assert.ok(minPitch < -0.17, `climbing huge humps must pitch nose up meaningfully (< -0.17 rad), got ${minPitch.toFixed(3)}`);
  assert.ok(maxPitch > 0.10, `descending huge humps must pitch nose down (> 0.10 rad), got ${maxPitch.toFixed(3)}`);
  assert.ok((maxPitch - minPitch) > 0.28, `total pitch swing over mega humps expected > 0.28 rad, got ${(maxPitch - minPitch).toFixed(3)}`);
  assert.ok(maxPoseY + TRACK_CONTACT_OFFSET >= GROUND_DECK_HEIGHT + 0.70, 'robot center must rise cleanly over the >= 0.70m crest without sinking inside');
});

test('Lane 4 end-to-end Pro traversal: Pendulum Gauntlet, Gate 08 road bay, and Dual Hanging Suspension Bridges never flip or stall', () => {
  assert.equal(PENDULUM_CONFIG.xRampUpEnd, 14.10);
  assert.equal(PENDULUM_CONFIG.xRampDownStart, 5.90);
  assert.ok(Math.abs(evaluateCourseHeight(3.10, -6.75) - GROUND_DECK_HEIGHT) < 1e-6, 'Gate 08 connecting road bay must be flat at ground grade');

  const dt = 1 / 120;
  const worldH = (wx: number, wz: number, curY = 0) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, curY);
  const runTraversal = (maxSpeed: number) => {
    const startX = 17.4 * MAP_SCALE;
    const laneZ = -6.75 * MAP_SCALE;
    const driveState = { x: startX, z: laneZ, vx: 0, vz: 0, yaw: -Math.PI / 2, angular: 0 };
    const pose: VehiclePose = {
      x: startX,
      z: laneZ,
      y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
      vx: 0,
      vy: 0,
      vz: 0,
      pitch: 0,
      yaw: -Math.PI / 2,
      roll: 0,
      pitchRate: 0,
      yawRate: 0,
      rollRate: 0,
      isFlipped: false,
      isGrounded: true,
      flippedTimer: 0,
    };
    let maxPoseY = -Infinity;
    let reachedConnectingBay = false;
    let reachedBridgeDeck = false;
    for (let step = 0; step < 120 * 24; step++) {
      const lx = driveState.x / MAP_SCALE;
      const lz = driveState.z / MAP_SCALE;
      const slope = slopeAt((wx, wz) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y), driveState.x, driveState.z, 0.10);
      const surf = evaluateCourseSurface(lx, lz, pose.y);
      integrateDrive(
        driveState,
        1.0,
        1.0,
        { grip: surf.grip * 0.68, rollingResistance: surf.rollingResistance },
        slope,
        { maxSpeed, motorAcceleration: 8.5, braking: 10, turnRate: 1.25, turnResponse: 16, gravity: 9.81 },
        dt,
      );
      pose.x = driveState.x;
      pose.z = driveState.z;
      pose.vx = driveState.vx;
      pose.vz = driveState.vz;
      pose.yaw = driveState.yaw;
      stepVehicle3D(pose, (wx, wz) => worldH(wx, wz, pose.y), Math.hypot(driveState.vx, driveState.vz), 0, dt, 9.81, false);
      assert.equal(pose.isFlipped, false, `Lane 4 traversal must never flip (maxSpeed=${maxSpeed}, step=${step}, x=${(pose.x / MAP_SCALE).toFixed(2)})`);
      const groundUnder = pose.y + TRACK_CONTACT_OFFSET;
      maxPoseY = Math.max(maxPoseY, groundUnder);
      const curLocalX = pose.x / MAP_SCALE;
      if (curLocalX <= 3.60 && curLocalX >= 2.55 && Math.abs(groundUnder - GROUND_DECK_HEIGHT) < 0.12) {
        reachedConnectingBay = true;
      }
      if (curLocalX <= -2.0 && curLocalX >= -6.0 && groundUnder >= HANGING_BRIDGE_CONFIG.deckY - 0.14) {
        reachedBridgeDeck = true;
      }
      if (curLocalX <= -12.0) break;
    }
    return { endX: driveState.x / MAP_SCALE, maxPoseY, reachedConnectingBay, reachedBridgeDeck };
  };

  for (const speed of [3.0, 6.8]) {
    const res = runTraversal(speed);
    assert.ok(res.endX <= -12.0, `robot at maxSpeed=${speed} must clear both Lane 4 obstacles under Pro grip, reached x=${res.endX.toFixed(2)}`);
    assert.ok(res.maxPoseY >= PENDULUM_CONFIG.deckY - 0.02, `expected climb onto ${PENDULUM_CONFIG.deckY}m pendulum catwalk (maxSpeed=${speed})`);
    assert.equal(res.reachedConnectingBay, true, `connecting road at Gate 08 must drop smoothly to ground grade (maxSpeed=${speed})`);
    assert.equal(res.reachedBridgeDeck, true, `Suspension Bridge span must carry robot at elevated deck across both narrow tracks (maxSpeed=${speed})`);
  }
});

test('drifting off narrow spread bridge plunges under gravity into sand pit with severe impact velocity', () => {
  const dt = 1 / 120;
  const worldH = (wx: number, wz: number, curY = 0) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, curY);
  // Misalign robot sideways (+0.45m off lane center) so one track slips off the narrow plank into open void
  const pose: VehiclePose = {
    x: -2.0 * MAP_SCALE,
    z: (-6.75 + 0.45) * MAP_SCALE,
    y: HANGING_BRIDGE_CONFIG.deckY - TRACK_CONTACT_OFFSET,
    vx: -2.0,
    vy: 0,
    vz: 0,
    pitch: 0,
    yaw: -Math.PI / 2,
    roll: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
    isFlipped: false,
    isGrounded: true,
    flippedTimer: 0,
  };
  let sawAirborne = false;
  let peakImpactSpeed = 0;
  for (let i = 0; i < 180; i++) {
    pose.x += pose.vx * dt;
    stepVehicle3D(pose, (wx, wz) => worldH(wx, wz, pose.y), 2.0, 0, dt, 9.81, false);
    if (!pose.isGrounded) sawAirborne = true;
    peakImpactSpeed = Math.max(peakImpactSpeed, pose.lastImpactSpeed ?? 0);
  }
  assert.equal(sawAirborne, true, 'losing track support over open bridge chasm must transition into gravity free-fall');
  assert.ok(pose.y + TRACK_CONTACT_OFFSET <= HANGING_SAND_PIT_Y + 0.35, `robot must plunge into sunken sand pit (${HANGING_SAND_PIT_Y}m), ended at ${(pose.y + TRACK_CONTACT_OFFSET).toFixed(2)}m`);
  assert.ok(peakImpactSpeed >= 3.5, `gravity drop from elevated bridge must produce severe impact speed (>= 3.5 m/s), got ${peakImpactSpeed.toFixed(2)}`);
});

test('Lane 2 High-Incline Zigzag Challenge Ramp stalls straight climbs (spinning belts sliding down) yet clears via diagonal zigzagging', () => {
  assert.equal(HIGH_CLIMB_CONFIG.laneZ, 6.75);
  assert.ok(HIGH_CLIMB_CONFIG.ySummit - HIGH_CLIMB_CONFIG.yGround >= 3.0, 'towering ramp rise must be >= 3.0m');
  assert.ok(HIGH_CLIMB_CONFIG.xExitEnd >= 8.60, 'must land cleanly before courseLayout horizontal Mega Hump test start');

  const worldH = (wx: number, wz: number, curY = 0) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, curY);
  const dt = 1 / 120;

  // 1. Straight-up attempt under default Intermediate grip (1.0): stalls before summit, belts keep rotating, chassis slides downslope
  const straightState = { x: 16.95 * MAP_SCALE, z: 6.75 * MAP_SCALE, vx: 0, vz: 0, yaw: -Math.PI / 2, angular: 0 };
  const straightPose: VehiclePose = {
    x: straightState.x,
    z: straightState.z,
    y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
    vx: 0,
    vy: 0,
    vz: 0,
    pitch: 0,
    yaw: -Math.PI / 2,
    roll: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
    isFlipped: false,
    isGrounded: true,
    flippedTimer: 0,
  };
  let minStraightX = straightState.x / MAP_SCALE;
  let maxBeltSpeedWhileSliding = 0;
  let maxDownhillSlideVx = 0;
  for (let s = 0; s < 120 * 5; s++) {
    const lx = straightState.x / MAP_SCALE;
    const lz = straightState.z / MAP_SCALE;
    const slope = slopeAt((wx, wz) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, straightPose.y), straightState.x, straightState.z, 0.10);
    const surf = evaluateCourseSurface(lx, lz, straightPose.y);
    const res = integrateDrive(
      straightState,
      1.0,
      1.0,
      {
        grip: surf.grip * 1.0,
        kineticGrip: surf.kineticGrip !== undefined ? surf.kineticGrip * 1.0 : undefined,
        breakawayGrade: surf.breakawayGrade,
        rollingResistance: surf.rollingResistance,
        lateralGripMultiplier: surf.lateralGripMultiplier,
      },
      slope,
      { maxSpeed: 6.8, motorTrackSpeed: 5.34, motorAcceleration: 8.5, braking: 10, turnRate: 1.25, turnResponse: 16, gravity: 9.81 },
      dt,
    );
    straightPose.x = straightState.x;
    straightPose.z = straightState.z;
    straightPose.vx = straightState.vx;
    straightPose.vz = straightState.vz;
    straightPose.yaw = straightState.yaw;
    stepVehicle3D(straightPose, (wx, wz) => worldH(wx, wz, straightPose.y), res.longitudinalSpeed, 0, dt, 9.81, false);
    minStraightX = Math.min(minStraightX, straightState.x / MAP_SCALE);
    if (straightState.vx > 0.15) {
      maxDownhillSlideVx = Math.max(maxDownhillSlideVx, straightState.vx);
      maxBeltSpeedWhileSliding = Math.max(maxBeltSpeedWhileSliding, Math.min(res.trackSpeedLeft, res.trackSpeedRight));
    }
  }
  assert.ok(minStraightX > HIGH_CLIMB_CONFIG.xSummitEast, `straight climb must stall below summit (${HIGH_CLIMB_CONFIG.xSummitEast}), reached x=${minStraightX.toFixed(2)}`);
  assert.ok(maxDownhillSlideVx > 0.5, `stalled straight climb must slide backwards downhill, got maxVx=${maxDownhillSlideVx.toFixed(2)}`);
  assert.ok(maxBeltSpeedWhileSliding > 2.0, `belts must stay continuously rotating forward while sliding down, got ${maxBeltSpeedWhileSliding.toFixed(2)}`);

  // 2. Diagonal Zigzag Switchback climb across both Intermediate (1.0) and Expert (0.68) clears summit and descends cleanly
  for (const gripMult of [1.0, 0.68]) {
    const zigState = { x: 17.20 * MAP_SCALE, z: 6.75 * MAP_SCALE, vx: 0, vz: 0, yaw: -Math.PI / 2, angular: 0 };
    const zigPose: VehiclePose = {
      x: zigState.x,
      z: zigState.z,
      y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
      vx: 0,
      vy: 0,
      vz: 0,
      pitch: 0,
      yaw: -Math.PI / 2,
      roll: 0,
      pitchRate: 0,
      yawRate: 0,
      rollRate: 0,
      isFlipped: false,
      isGrounded: true,
      flippedTimer: 0,
    };
    let zigDir = 1; // +1 zig south (+Z), -1 zag north (-Z)
    let maxSummitY = -Infinity;
    const halfInner = (HIGH_CLIMB_CONFIG.deckWidth * 0.5 - 1.65);
    for (let s = 0; s < 120 * 24; s++) {
      const lx = zigState.x / MAP_SCALE;
      const lz = zigState.z / MAP_SCALE;
      // Switch diagonal tack near lane edges while ascending, then straighten over summit & descent
      let targetYaw = -Math.PI / 2;
      if (lx > HIGH_CLIMB_CONFIG.xSummitEast - 0.10) {
        if (lz > HIGH_CLIMB_CONFIG.laneZ + halfInner) zigDir = -1;
        if (lz < HIGH_CLIMB_CONFIG.laneZ - halfInner) zigDir = 1;
        const tackAngle = gripMult < 0.8 ? 0.80 : 0.78; // Diagonal zigzags keep tread load below breakawayGrade on all tiers
        targetYaw = -Math.PI / 2 + zigDir * tackAngle; // +Z South for zigDir=+1, -Z North for zigDir=-1
      }
      const err = Math.atan2(Math.sin(targetYaw - zigState.yaw), Math.cos(targetYaw - zigState.yaw));
      const steer = Math.max(-0.90, Math.min(0.90, err * 2.2));
      const slope = slopeAt((wx, wz) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, zigPose.y), zigState.x, zigState.z, 0.10);
      const surf = evaluateCourseSurface(lx, lz, zigPose.y);
      // Differential zigzag steering (mirrors real track drive + pivot/arc switchbacks at walls)
      const baseThrottle = Math.abs(err) > 0.55 ? 0.45 : 1.0;
      const lCmd = Math.max(-1, Math.min(1, baseThrottle - steer));
      const rCmd = Math.max(-1, Math.min(1, baseThrottle + steer));
      const res = integrateDrive(
        zigState,
        lCmd,
        rCmd,
        {
          grip: surf.grip * gripMult,
          kineticGrip: surf.kineticGrip !== undefined ? surf.kineticGrip * gripMult : undefined,
          breakawayGrade: surf.breakawayGrade,
          rollingResistance: surf.rollingResistance,
          lateralGripMultiplier: surf.lateralGripMultiplier,
        },
        slope,
        { maxSpeed: 6.8, motorTrackSpeed: 5.34, motorAcceleration: 8.5, braking: 10, turnRate: 1.5, turnResponse: 16, gravity: 9.81 },
        dt,
      );
      zigPose.x = zigState.x;
      zigPose.z = zigState.z;
      zigPose.vx = zigState.vx;
      zigPose.vz = zigState.vz;
      zigPose.yaw = zigState.yaw;
      stepVehicle3D(zigPose, (wx, wz) => worldH(wx, wz, zigPose.y), res.longitudinalSpeed, zigState.angular, dt, 9.81, false);
      assert.equal(zigPose.isFlipped, false, `zigzag climb & steep descent must not flip (gripMult=${gripMult}, x=${lx.toFixed(2)}, pitch=${zigPose.pitch.toFixed(2)})`);
      maxSummitY = Math.max(maxSummitY, zigPose.y + TRACK_CONTACT_OFFSET);
      if (lx <= 8.20) break;
    }
    assert.ok(maxSummitY >= HIGH_CLIMB_CONFIG.ySummit - 0.05, `zigzag must reach ${HIGH_CLIMB_CONFIG.ySummit}m summit (gripMult=${gripMult}), reached ${maxSummitY.toFixed(2)}`);
    assert.ok(zigState.x / MAP_SCALE <= 8.35, `robot must descend past High Climb exit onto Hump runway (gripMult=${gripMult}), ended at x=${(zigState.x / MAP_SCALE).toFixed(2)}`);
  }
});

test('Hairpin turn ribbons join straight lane ends with exact horizontal tangents and zero edge seam gap', () => {
  const hairpins: Array<[number, number, number, number, number, number]> = [
    [17.5, 10.125, Math.PI / 2, -Math.PI / 2, 13.5, 6.75],
    [-17.5, 3.375, Math.PI / 2, 1.5 * Math.PI, 6.75, 0.0],
    [17.5, -3.375, Math.PI / 2, -Math.PI / 2, 0.0, -6.75],
    [-17.5, -10.125, Math.PI / 2, 1.5 * Math.PI, -6.75, -13.5],
  ];
  for (const [hx, hz, a0, a1, zStart, zEnd] of hairpins) {
    const { points, tangents } = buildHairpinRibbonPath(hx, hz, a0, a1, 48);
    assert.equal(points.length, 49);
    assert.equal(tangents.length, 49);
    for (const [idx, expectedZ] of [[0, zStart], [48, zEnd]] as const) {
      assert.ok(Math.abs(points[idx].x - hx) < 1e-9, `endpoint x must match straight lane edge ${hx}`);
      assert.ok(Math.abs(points[idx].z - expectedZ) < 1e-9, `endpoint z must match straight lane ${expectedZ}`);
      // Analytical tangent at hairpin joint must be horizontal (tz == 0, |tx| == 1)
      assert.ok(Math.abs(tangents[idx].tz) < 1e-9, `endpoint tz must be 0, got ${tangents[idx].tz}`);
      assert.ok(Math.abs(Math.abs(tangents[idx].tx) - 1) < 1e-9);
      const frame = computeRibbonSampleFrame(points, idx, 0, DRIVE_ROUTE_WIDTH, tangents);
      assert.ok(Math.abs(frame.xL - hx) < 1e-9 && Math.abs(frame.xR - hx) < 1e-9, 'both outer/inner ribbon corners must lie flush on x = +/-17.5');
      assert.ok(Math.abs(Math.abs(frame.zL - frame.zR) - DRIVE_ROUTE_WIDTH) < 1e-9, 'joint cross-section width must match full lane width');
    }
  }
});

