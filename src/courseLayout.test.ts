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
  HILL_EXIT_LINK,
  ARENA_FLOOR_HEIGHT,
  ROUTE_DECK_HEIGHT,
  PARALLEL_PLANK_CENTERS,
  PARALLEL_PLANK_CENTER_Z,
  PARALLEL_PLANK_SPACING_LOCAL,
  MAP_SCALE,
  validateDriveRoute,
  type CourseCollider,
} from './courseLayout.ts';
import { TRACK_WIDTH } from './vehicleDynamics.ts';

test('evaluateCourseHeight returns realistic heights across course features', () => {
  // Flat arena floor
  const floorH = evaluateCourseHeight(0, 0);
  assert.equal(floorH, ROUTE_DECK_HEIGHT);

  // Wooden ramp crest at x = 4.8, z = 8.0
  const rampH = evaluateCourseHeight(4.8, 8.0);
  assert.ok(rampH > 0.8, `expected ramp height > 0.8, got ${rampH}`);

  // Bridge deck at x = 9.6, z = 8.0
  const bridgeH = evaluateCourseHeight(9.6, 8.0);
  assert.ok(bridgeH > 0.55, `expected bridge deck > 0.55, got ${bridgeH}`);

  // Switchback hill crest
  const hillSummitH = evaluateCourseHeight(14.5, -15.9);
  assert.ok(hillSummitH > 4.0, `expected hill summit > 4.0, got ${hillSummitH}`);
});

test('raised bridge and curved ramp ground samples match their full-width physical decks', () => {
  assert.ok(Math.abs(evaluateCourseHeight(7.0, 8.0) - ROUTE_DECK_HEIGHT) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(8.6, 8.0) - (ROUTE_DECK_HEIGHT + 0.59)) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(9.6, 8.0) - (ROUTE_DECK_HEIGHT + 0.59)) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(12.2, 8.0) - ROUTE_DECK_HEIGHT) < 1e-6);
  for (const x of [4.0, 4.8, 5.6]) {
    const center = evaluateCourseHeight(x, 8.0);
    assert.ok(Math.abs(evaluateCourseHeight(x, 6.0) - center) < 1e-6, 'ramp must support the road edge too');
    assert.ok(Math.abs(evaluateCourseHeight(x, 10.0) - center) < 1e-6, 'ramp must support both track edges');
  }
  const rampSlope = Math.atan2(evaluateCourseHeight(4.10, 8.0) - evaluateCourseHeight(4.00, 8.0), 0.10) * 180 / Math.PI;
  assert.ok(rampSlope >= 35 && rampSlope <= 42, `curved ramp peak should be a climbable 35-42°, got ${rampSlope.toFixed(1)}°`);
  const entryRampSlope = Math.atan2(evaluateCourseHeight(-19.9, 8.0) - evaluateCourseHeight(-20.5, 8.0), 0.6) * 180 / Math.PI;
  assert.ok(entryRampSlope >= 34 && entryRampSlope <= 38, `initial climb should be about 35°, got ${entryRampSlope.toFixed(1)}°`);
});

test('road boundaries are raised above a lower arena floor and deep water basin contains water pool', () => {
  assert.equal(evaluateCourseHeight(-19.2, 8.0), ROUTE_DECK_HEIGHT);
  assert.equal(evaluateCourseHeight(-20.9, 8.0), ARENA_FLOOR_HEIGHT, 'the ramp toe must not extend as an invisible elevated pad behind its visible endpoint');
  assert.equal(evaluateCourseHeight(17, 12), ARENA_FLOOR_HEIGHT, 'off-road position must fall to the lower floor');
  assert.equal(evaluateCourseHeight(-7.4, -4.0), -0.30, 'deep water basin floor rests near arena foundation');
  assert.equal(evaluateCourseHeight(-10.4, -4.0), ROUTE_DECK_HEIGHT, 'exit climb ramp reaches elevated viaduct deck');
  assert.ok(evaluateCourseHeight(-9.7, -4.0) > -0.30 && evaluateCourseHeight(-9.7, -4.0) < ROUTE_DECK_HEIGHT, 'exit climb ramp rises continuously from deep pool to viaduct');
  assert.equal(evaluateCourseHeight(-11.4, -4.0), ROUTE_DECK_HEIGHT + 0.02, 'oil remains a thin surface layer');
});

test('elevated sloped viaduct smoothly connects rock field exit directly to fire obstacle', () => {
  // At rock field exit (1.2, 0.0), road is at ROUTE_DECK_HEIGHT (0.67m)
  const topH = evaluateCourseHeight(1.2, 0.0);
  assert.ok(Math.abs(topH - ROUTE_DECK_HEIGHT) < 0.02, `top of viaduct should be at ROUTE_DECK_HEIGHT, got ${topH}`);

  // Along the connecting slope, elevation drops continuously and smoothly to fire entrance (0.38m)
  const midH1 = evaluateCourseHeight(0.40, -1.33);
  const midH2 = evaluateCourseHeight(-0.40, -2.67);
  const botH = evaluateCourseHeight(-1.20, -4.00);

  assert.ok(midH1 < topH && midH1 > midH2, 'viaduct must descend smoothly along segment 1');
  assert.ok(midH2 < midH1 && midH2 > botH, 'viaduct must descend smoothly along segment 2');
  assert.ok(Math.abs(botH - 0.38) < 0.02, `entrance of fire obstacle must meet elevated fire platform at 0.38m, got ${botH}`);

  // Traversable incline
  const dist = Math.hypot(1.20 - (-1.20), 0.00 - (-4.00));
  const grade = Math.abs(topH - botH) / dist;
  assert.ok(grade < 0.15, `connecting slope should be an engineered traversable grade, got ${grade.toFixed(3)}`);
});

test('hill height support ends at the visible platform edge and joins every segment endpoint', () => {
  for (const node of HILL_NODES) {
    const height = hillHeightAt(node.x, node.z);
    assert.ok(height !== null && Math.abs(height - node.y) < 1e-6, `hill node (${node.x}, ${node.z}) should meet its deck`);
  }
  assert.equal(hillHeightAt(8.0, -0.29), null, 'raised analytic ground must not extend beyond the rendered deck');
  assert.ok(Math.abs(evaluateCourseHeight(9.4, -4.5) - HILL_NODES[0].y) < 1e-6, 'lower turn shelf stays level');
  assert.ok(Math.abs(evaluateCourseHeight(13.1, -4.5) - HILL_NODES[1].y) < 1e-6, 'upper turn shelf stays level');
  const climbSlope = Math.atan2(evaluateCourseHeight(11.30, -4.5) - evaluateCourseHeight(11.20, -4.5), 0.10) * 180 / Math.PI;
  assert.ok(climbSlope >= 32 && climbSlope <= 39, `switchback ramp should peak near 35°, got ${climbSlope.toFixed(1)}°`);
  assert.equal(hillHeightAt(11.75, -0.67), null, 'the relocated hill deck must not cover the rotating-disc drive line');
  assert.ok(evaluateCourseHeight(11.75, -0.67) <= ROUTE_DECK_HEIGHT + 0.30,
    'both track sides stay on the disc/main-road level at the formerly failing turn');
  assert.ok(hillHeightAt(11.75, -4.5)! > ROUTE_DECK_HEIGHT + 0.9,
    `the hill still rises only on its own branch, with ${HILL_DECK_WIDTH.toFixed(1)}m deck clearance`);
});

test('elevated hill return is a continuous supported descent to the course road', () => {
  const start = HILL_EXIT_LINK[0];
  const end = HILL_EXIT_LINK.at(-1)!;
  assert.ok(Math.abs(evaluateCourseHeight(start.x, start.z) - (ROUTE_DECK_HEIGHT + 4.47)) < 1e-6, 'return begins at the summit elevation');
  assert.ok(Math.abs(evaluateCourseHeight(end.x, end.z) - ROUTE_DECK_HEIGHT) < 1e-6, 'return joins the lower road deck');
  let maximumGrade = 0;
  for (let segment = 0; segment < HILL_EXIT_LINK.length - 1; segment++) {
    const a = HILL_EXIT_LINK[segment];
    const b = HILL_EXIT_LINK[segment + 1];
    for (let i = 0; i < 30; i++) {
      const t0 = i / 30;
      const t1 = (i + 1) / 30;
      const h0 = evaluateCourseHeight(a.x + (b.x - a.x) * t0, a.z + (b.z - a.z) * t0);
      const h1 = evaluateCourseHeight(a.x + (b.x - a.x) * t1, a.z + (b.z - a.z) * t1);
      const distance = Math.hypot(b.x - a.x, b.z - a.z) / 30;
      maximumGrade = Math.max(maximumGrade, Math.abs(h1 - h0) / distance);
    }
  }
  assert.ok(maximumGrade < 0.65, `return descent grade should stay traversable, got ${maximumGrade.toFixed(2)}`);
  assert.ok(Math.abs(evaluateCourseHeight(0.8, -9.6) - ROUTE_DECK_HEIGHT) < 1e-6,
    'the final hairpin must stay on the low road with no raised hill collider crossing it');
});

test('evaluateCourseSurface implements mandatory sequence: fire -> water -> oil', () => {
  const fireSurf = evaluateCourseSurface(-2.8, -4.0);
  assert.equal(fireSurf.hazard, 'fire');

  const coolingSurf = evaluateCourseSurface(-4.0, -4.0);
  assert.equal(coolingSurf.hazard, 'none', 'cooling bridge before water pool has safe surface');

  const waterSurf = evaluateCourseSurface(-7.4, -4.0);
  assert.equal(waterSurf.hazard, 'water');
  assert.ok(waterSurf.grip < 0.65, 'water grip reduced');

  const oilSurf = evaluateCourseSurface(-11.4, -4.0);
  assert.equal(oilSurf.hazard, 'oil');
  assert.ok(oilSurf.grip < 0.25, 'oil grip must be very low');
});

test('generateRockFieldStones produces deterministic stones distributed across full usable road width', () => {
  const stones1 = generateRockFieldStones(12345);
  const stones2 = generateRockFieldStones(12345);
  assert.equal(stones1.length, 140, 'stone count should be 140 for full-width coverage');
  assert.equal(stones1.length, stones2.length);
  assert.deepEqual(stones1[0], stones2[0]);

  // Check bounds and ensure stones span both left, center, and right flanks
  let leftFlankCount = 0;
  let rightFlankCount = 0;
  for (const st of stones1) {
    assert.ok(st.x >= 1.40 && st.x <= 4.60, `stone x ${st.x} out of bounds`);
    assert.ok(st.z >= -2.70 && st.z <= 2.70, `stone z ${st.z} out of bounds`);
    assert.ok(st.scaleX > 0 && st.scaleY > 0 && st.scaleZ > 0);
    if (st.z < -1.0) leftFlankCount++;
    if (st.z > 1.0) rightFlankCount++;
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
  assert.ok(DRIVE_ROUTE_WIDTH >= 5.8 && DRIVE_ROUTE_WIDTH <= 6.2, 'road width should leave a recovery margin outside the slalom weave');
  let previousIndex = -1;
  for (const gate of CHECKPOINTS) {
    const index = DRIVE_ROUTE.findIndex(p => Math.hypot(p.x - gate.x, p.z - gate.z) < 0.01);
    assert.ok(index > previousIndex, `checkpoint ${gate.id} must be on the connected road in order`);
    previousIndex = index;
  }
  for (let i = 1; i < DRIVE_ROUTE.length; i++) {
    const length = Math.hypot(DRIVE_ROUTE[i].x - DRIVE_ROUTE[i - 1].x, DRIVE_ROUTE[i].z - DRIVE_ROUTE[i - 1].z);
    assert.ok(length >= 0.15, `route segment ${i - 1} is disconnected`);
  }
});

test('bridge-to-disc connector has a supported turning shelf instead of a straight cut across the road edge', () => {
  const shelf = DRIVE_ROUTE.filter(point => point.x >= 10.5 && point.x <= 14.0 && point.z >= 0 && point.z <= 5.0);
  assert.ok(shelf.length >= 5, 'the connector should provide multiple waypoints around the turn');
  for (let i = 1; i < shelf.length; i++) {
    assert.ok(Math.hypot(shelf[i].x - shelf[i - 1].x, shelf[i].z - shelf[i - 1].z) < 2.0,
      'the turning shelf should not contain an abrupt corner-spanning segment');
  }
  for (const point of shelf) {
    assert.ok(evaluateCourseHeight(point.x, point.z) >= ROUTE_DECK_HEIGHT,
      `turning point (${point.x}, ${point.z}) must have visible elevated-road support`);
  }
  assert.ok(DRIVE_ROUTE.findIndex(point => point.x === 10.65 && point.z === 0.1)
    > DRIVE_ROUTE.findIndex(point => point.x === 13.2 && point.z === 4.7),
  'the disc checkpoint must remain downstream of the marble-pit turn');
});

test('required obstacles sit on or within the road corridor rather than on detached pads', () => {
  const distanceToRoute = (point: { x: number; z: number }) => Math.min(...DRIVE_ROUTE.slice(1).map((b, i) => {
    const a = DRIVE_ROUTE[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
  }));
  const requiredCenters = [
    ...SLALOM_BLOCKS.map(b => ({ x: b.x, z: b.z, footprintAllowance: b.span / 2 })),
    ...SPEED_BREAKER_XS.map(x => ({ x, z: 8, footprintAllowance: 0 })),
    { x: 4.8, z: 8, footprintAllowance: 0 }, { x: 9.6, z: 8, footprintAllowance: 0 }, { x: 13.45, z: 4.55, footprintAllowance: 0 },
    { x: 10.65, z: 0.1, footprintAllowance: 0 }, { x: 2.8, z: 0, footprintAllowance: 0 }, { x: -2.8, z: -4, footprintAllowance: 0 },
    { x: -6.5, z: -4, footprintAllowance: 0 }, { x: -9.25, z: -4, footprintAllowance: 0 }, { x: -7.7, z: -4, footprintAllowance: 0 },
    ...PARALLEL_PLANK_CENTERS.map(plank => ({ x: plank.x, z: plank.z, footprintAllowance: 0.4 })),
  ];
  for (const center of requiredCenters) {
    assert.ok(distanceToRoute(center) <= DRIVE_ROUTE_WIDTH / 2 + center.footprintAllowance + 0.15,
      `obstacle at (${center.x}, ${center.z}) falls outside the drive corridor`);
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
    assert.ok(b.length > 0 && b.span >= 2.35 && b.span <= 2.45 && b.height >= 1.0,
      'walls must remain substantial while their ends leave room for the robot to realign between hurdles');
    if (i > 0) {
      assert.ok(SLALOM_BLOCKS[i - 1].x < b.x, 'hurdles must be ordered along the driving direction');
      assert.ok(b.x - SLALOM_BLOCKS[i - 1].x >= 3.39, 'give the robot turning room between walls');
      assert.ok(SLALOM_BLOCKS[i - 1].x + SLALOM_BLOCKS[i - 1].length / 2 < b.x - b.length / 2,
        'neighboring hurdles must remain separate');
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

test('slalom clearance audit rejects an overlong wall that blocks the opposite-side passage', () => {
  const formerBlindBlock = [{ id: 'former_blind_block', x: -10.4, z: 9.4, side: 'left' as const, length: 0.62, span: 5.1, height: 1.05 }];
  const audit = validateSlalomClearance(formerBlindBlock);
  assert.equal(audit.valid, false, 'a block that overlaps the robot envelope on the route must fail validation');
  assert.ok(audit.issues.some(issue => issue.includes('clearance')));
});

test('checkpoint gates require a forward crossing through the opening', () => {
  const gate = CHECKPOINTS[0];
  const gx = gate.x * 1.3;
  const gz = gate.z * 1.3;
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
