import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCourseHeight,
  evaluateCourseSurface,
  generateRockFieldStones,
  validateRouteClearance,
  HILL_NODES,
  HILL_DECK_WIDTH,
  hillHeightAt,
  CHECKPOINTS,
  crossesCheckpointGate,
  SLALOM_BLOCKS,
  validateSlalomClearance,
  SPEED_BREAKER_XS,
  DRIVE_ROUTE,
  DRIVE_ROUTE_WIDTH,
  ARENA_FLOOR_HEIGHT,
  ROUTE_DECK_HEIGHT,
  PARALLEL_PLANK_CENTERS,
  PARALLEL_PLANK_CENTER_Z,
  MAP_SCALE,
  validateDriveRoute,
  type CourseCollider,
} from './courseLayout.ts';
import { TRACK_WIDTH } from './vehicleDynamics.ts';

test('evaluateCourseHeight returns realistic heights across 5-lane course features', () => {
  // Flat deck on Lane 3 (z = 0.00, x = 0.0)
  const floorH = evaluateCourseHeight(0, 0);
  assert.equal(floorH, ROUTE_DECK_HEIGHT);

  // Climbing hill summit crest at x = 10.5, z = 6.75 (Lane 2)
  const summitH = evaluateCourseHeight(10.5, 6.75);
  assert.ok(summitH > 1.80, `expected hill summit > 1.80, got ${summitH}`);

  // Arch bridge crowned deck at x = 10.5, z = -6.75 (Lane 4)
  const bridgeH = evaluateCourseHeight(10.5, -6.75);
  assert.ok(bridgeH > ROUTE_DECK_HEIGHT + 0.50, `expected arch bridge crown > 1.15, got ${bridgeH}`);

  // Start approach climbing ramp at midpoint x = -18.5, z = 13.50 (Lane 1)
  const startRampH = evaluateCourseHeight(-18.5, 13.50);
  assert.ok(startRampH > ARENA_FLOOR_HEIGHT && startRampH < ROUTE_DECK_HEIGHT, `expected start ramp height, got ${startRampH}`);
});

test('raised bridge and ramp ground samples match their full-width physical decks', () => {
  // Arch bridge deck at x in [6.5, 14.5] on Lane 4 (z = -6.75)
  assert.ok(Math.abs(evaluateCourseHeight(6.5, -6.75) - ROUTE_DECK_HEIGHT) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(14.5, -6.75) - ROUTE_DECK_HEIGHT) < 1e-6);
  const midBridgeH = evaluateCourseHeight(10.5, -6.75);
  assert.ok(Math.abs(midBridgeH - (ROUTE_DECK_HEIGHT + 0.59)) < 1e-6);

  // Deck supports road edges
  assert.ok(Math.abs(evaluateCourseHeight(10.5, -6.75 - 1.2) - midBridgeH) < 1e-6, 'bridge must support north track edge');
  assert.ok(Math.abs(evaluateCourseHeight(10.5, -6.75 + 1.2) - midBridgeH) < 1e-6, 'bridge must support south track edge');

  // Start ramp climb slope
  const entryRampSlope = Math.atan2(evaluateCourseHeight(-17.5, 13.50) - evaluateCourseHeight(-19.5, 13.50), 2.0) * 180 / Math.PI;
  assert.ok(entryRampSlope >= 25 && entryRampSlope <= 35, `initial climb should be 25-35°, got ${entryRampSlope.toFixed(1)}°`);
});

test('road boundaries are raised above lower arena floor and water basin contains deep pool', () => {
  // Road surface at Lane 1
  assert.equal(evaluateCourseHeight(-17.0, 13.50), ROUTE_DECK_HEIGHT);
  // Off-road toe behind ramp
  assert.equal(evaluateCourseHeight(-21.5, 13.50), ARENA_FLOOR_HEIGHT, 'off-road behind ramp falls to floor');
  // Off-road open chasm between Lane 1 and Lane 2 (z = 10.125)
  assert.equal(evaluateCourseHeight(0.0, 10.125), ARENA_FLOOR_HEIGHT, 'open chasm between viaducts falls to lower floor');
  // Deep water basin floor on Lane 2 (z = 6.75)
  assert.equal(evaluateCourseHeight(-4.0, 6.75), -0.30, 'deep water basin floor rests at -0.30m');
  // Exit climb ramp reaches elevated viaduct deck
  assert.equal(evaluateCourseHeight(-9.5, 6.75), ROUTE_DECK_HEIGHT, 'exit climb ramp reaches viaduct deck');
  assert.ok(evaluateCourseHeight(-8.5, 6.75) > -0.30 && evaluateCourseHeight(-8.5, 6.75) < ROUTE_DECK_HEIGHT, 'exit climb ramp rises continuously');
});

test('climbing hill descent connects smoothly to elevated fire obstacle on Lane 2', () => {
  // Summit crest at x = 9.5 is at 1.85m
  const summitH = evaluateCourseHeight(9.5, 6.75);
  assert.ok(Math.abs(summitH - (ROUTE_DECK_HEIGHT + 1.18)) < 0.02);

  // Mid descent at x = 8.0
  const midH = evaluateCourseHeight(8.0, 6.75);
  assert.ok(midH < summitH && midH > 0.38, 'hill descent descends smoothly');

  // Entrance to fire platform at x = 6.5 meeting 0.38m elevation
  const fireEntranceH = evaluateCourseHeight(6.5, 6.75);
  assert.ok(Math.abs(fireEntranceH - 0.38) < 0.02, `fire entrance meets fire platform at 0.38m, got ${fireEntranceH}`);

  // Grade check
  const grade = Math.abs(summitH - fireEntranceH) / 3.0;
  assert.ok(grade < 0.55, `descent slope should be a traversable grade, got ${grade.toFixed(3)}`);
});

test('hill height support ends at the visible platform edge and joins every segment endpoint', () => {
  for (const node of HILL_NODES) {
    const height = hillHeightAt(node.x, node.z);
    assert.ok(height !== null && Math.abs(height - node.y) < 1e-6, `hill node (${node.x}, ${node.z}) should meet its deck`);
  }
  assert.equal(hillHeightAt(10.0, 10.0), null, 'raised ground must not extend into chasms');
  assert.ok(Math.abs(evaluateCourseHeight(10.5, 6.75) - (ROUTE_DECK_HEIGHT + 1.18)) < 1e-6, 'summit crest stays level');
});

test('evaluateCourseSurface implements mandatory sequence: rock -> hill -> fire -> water -> oil', () => {
  // Rock field on Lane 1
  const rockSurf = evaluateCourseSurface(10.0, 13.50);
  assert.ok(rockSurf.rollingResistance > 1.0, 'rock field has high rolling resistance');

  // Fire zone on Lane 2
  const fireSurf = evaluateCourseSurface(4.5, 6.75);
  assert.equal(fireSurf.hazard, 'fire');

  // Heat-shield cooling bridge before water
  const coolingSurf = evaluateCourseSurface(2.0, 6.75);
  assert.equal(coolingSurf.hazard, 'none');

  // Deep water basin on Lane 2
  const waterSurf = evaluateCourseSurface(-4.0, 6.75);
  assert.equal(waterSurf.hazard, 'water');
  assert.ok(waterSurf.grip < 0.65, 'water grip reduced');

  // Slippery steel sheet on Lane 2
  const slipSurf = evaluateCourseSurface(-11.5, 6.75);
  assert.ok(slipSurf.grip < 0.30, 'slippery sheet has low grip');

  // Oil skid pad on Lane 3
  const oilSurf = evaluateCourseSurface(-10.0, 0.00);
  assert.equal(oilSurf.hazard, 'oil');
  assert.ok(oilSurf.grip < 0.25, 'oil grip must be very low');
});

test('generateRockFieldStones produces deterministic stones distributed across full usable road width', () => {
  const stones1 = generateRockFieldStones(20261027);
  const stones2 = generateRockFieldStones(20261027);
  assert.equal(stones1.length, 140, 'stone count should be 140 for full-width coverage');
  assert.equal(stones1.length, stones2.length);
  assert.deepEqual(stones1[0], stones2[0]);

  // Check bounds on Lane 1: x in [6.5, 14.0], z in [11.5, 15.5]
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

test('all 11 checkpoints are defined in sequential order', () => {
  assert.equal(CHECKPOINTS.length, 11);
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
  for (let i = 1; i < DRIVE_ROUTE.length; i++) {
    const length = Math.hypot(DRIVE_ROUTE[i].x - DRIVE_ROUTE[i - 1].x, DRIVE_ROUTE[i].z - DRIVE_ROUTE[i - 1].z);
    assert.ok(length >= 0.15, `route segment ${i - 1} is disconnected`);
  }
});

test('paired plank support spacing matches both robot track contact lines', () => {
  const worldSpacing = Math.abs(PARALLEL_PLANK_CENTERS[1].z - PARALLEL_PLANK_CENTERS[0].z) * MAP_SCALE;
  assert.ok(Math.abs(worldSpacing - TRACK_WIDTH) < 1e-6, 'each track should align over one plank');
  for (const plank of PARALLEL_PLANK_CENTERS) {
    assert.equal(evaluateCourseHeight(plank.x, plank.z), ROUTE_DECK_HEIGHT + 0.27, 'plank top must be a continuous supported surface');
  }
  const centerGapHeight = evaluateCourseHeight(PARALLEL_PLANK_CENTERS[0].x, PARALLEL_PLANK_CENTER_Z);
  assert.equal(centerGapHeight, ROUTE_DECK_HEIGHT, 'the gap between planks should remain a real gap');
});

test('slalom hurdles are alternating solid brick walls, spaced for a clear weave', () => {
  assert.equal(SLALOM_BLOCKS.length, 5);
  assert.equal(SPEED_BREAKER_XS.length, 3);
  for (let i = 0; i < SLALOM_BLOCKS.length; i++) {
    const b = SLALOM_BLOCKS[i];
    assert.ok(b.length > 0 && b.span >= 1.50 && b.height >= 1.0,
      'walls must remain substantial while their ends leave room for the robot to realign between hurdles');
    if (i > 0) {
      assert.ok(SLALOM_BLOCKS[i - 1].x < b.x, 'hurdles must be ordered along the driving direction');
      assert.ok(b.x - SLALOM_BLOCKS[i - 1].x >= 3.0, 'give the robot turning room between walls');
      assert.notEqual(SLALOM_BLOCKS[i - 1].side, b.side, 'hurdles alternate from left then right');
    }
  }
});

test('each slalom hurdle leaves a physically passable opening for the robot envelope', () => {
  const audit = validateSlalomClearance();
  assert.equal(audit.valid, true, audit.issues.join('; '));
  for (const obstacle of SLALOM_BLOCKS) {
    assert.ok(obstacle.height >= 0.9, `${obstacle.id} must be clearly visible above the track surface`);
  }
});

test('checkpoint gates require a forward crossing through the opening', () => {
  const gate = CHECKPOINTS[0];
  const gx = gate.x * MAP_SCALE;
  const gz = gate.z * MAP_SCALE;
  assert.equal(crossesCheckpointGate({ x: gx - 1, z: gz }, { x: gx + 1, z: gz }, gate), true);
  assert.equal(crossesCheckpointGate({ x: gx + 1, z: gz }, { x: gx - 1, z: gz }, gate), false, 'reverse travel cannot validate a gate');
  assert.equal(crossesCheckpointGate({ x: gx - 1, z: gz + 4 }, { x: gx + 1, z: gz + 4 }, gate), false, 'the robot must pass within the gate width');
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
  assert.ok(blockedResult.issues.length > 0);
});
