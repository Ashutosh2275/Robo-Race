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
  SLALOM_BARRIERS,
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
  assert.equal(floorH, 0.03);

  // Wooden ramp crest at x = 4.8, z = 8.0
  const rampH = evaluateCourseHeight(4.8, 8.0);
  assert.ok(rampH > 0.8, `expected ramp height > 0.8, got ${rampH}`);

  // Bridge deck at x = 9.6, z = 8.0
  const bridgeH = evaluateCourseHeight(9.6, 8.0);
  assert.ok(bridgeH > 0.55, `expected bridge deck > 0.55, got ${bridgeH}`);

  // Switchback hill crest
  const hillSummitH = evaluateCourseHeight(14.5, -9.6);
  assert.ok(hillSummitH > 4.0, `expected hill summit > 4.0, got ${hillSummitH}`);
});

test('raised bridge and curved ramp ground samples match their full-width physical decks', () => {
  assert.ok(Math.abs(evaluateCourseHeight(7.0, 8.0) - 0.03) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(8.6, 8.0) - 0.62) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(9.6, 8.0) - 0.62) < 1e-6);
  assert.ok(Math.abs(evaluateCourseHeight(12.2, 8.0) - 0.03) < 1e-6);
  for (const x of [4.0, 4.8, 5.6]) {
    const center = evaluateCourseHeight(x, 8.0);
    assert.ok(Math.abs(evaluateCourseHeight(x, 6.0) - center) < 1e-6, 'ramp must support the road edge too');
    assert.ok(Math.abs(evaluateCourseHeight(x, 10.0) - center) < 1e-6, 'ramp must support both track edges');
  }
  const rampSlope = Math.atan2(evaluateCourseHeight(4.10, 8.0) - evaluateCourseHeight(4.00, 8.0), 0.10) * 180 / Math.PI;
  assert.ok(rampSlope >= 35 && rampSlope <= 42, `curved ramp peak should be a climbable 35-42°, got ${rampSlope.toFixed(1)}°`);
});

test('road boundaries are raised above a lower arena floor and the water/plank hazards have separate heights', () => {
  assert.equal(evaluateCourseHeight(-14.2, 8.0), ROUTE_DECK_HEIGHT);
  assert.equal(evaluateCourseHeight(17, 12), ARENA_FLOOR_HEIGHT, 'off-road position must fall to the lower floor');
  assert.equal(evaluateCourseHeight(-4.8, -4.0), -0.12, 'water crossing lowers the robot into the pool');
  assert.equal(evaluateCourseHeight(-7.0, -4.0), 0.22, 'single plank is independently raised');
  assert.equal(evaluateCourseHeight(-9.2, -4.0), 0.05, 'oil remains a thin surface layer');
});

test('hill height support ends at the visible platform edge and joins every segment endpoint', () => {
  for (const node of HILL_NODES) {
    const height = hillHeightAt(node.x, node.z);
    assert.ok(height !== null && Math.abs(height - node.y) < 1e-6, `hill node (${node.x}, ${node.z}) should meet its deck`);
  }
  assert.equal(hillHeightAt(8.0, -0.29), null, 'raised analytic ground must not extend beyond the rendered deck');
  assert.ok(Math.abs(evaluateCourseHeight(9.4, -2.0) - HILL_NODES[0].y) < 1e-6, 'lower turn shelf stays level');
  assert.ok(Math.abs(evaluateCourseHeight(13.1, -2.0) - HILL_NODES[1].y) < 1e-6, 'upper turn shelf stays level');
  const climbSlope = Math.atan2(evaluateCourseHeight(11.30, -2.0) - evaluateCourseHeight(11.20, -2.0), 0.10) * 180 / Math.PI;
  assert.ok(climbSlope >= 32 && climbSlope <= 39, `switchback ramp should peak near 35°, got ${climbSlope.toFixed(1)}°`);
});

test('elevated hill return is a continuous supported descent to the course road', () => {
  const start = HILL_EXIT_LINK[0];
  const end = HILL_EXIT_LINK.at(-1)!;
  assert.ok(Math.abs(evaluateCourseHeight(start.x, start.z) - 4.5) < 1e-6, 'return begins at the summit elevation');
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

  const waterSurf = evaluateCourseSurface(-4.8, -4.0);
  assert.equal(waterSurf.hazard, 'water');
  assert.ok(waterSurf.grip < 0.7);

  assert.equal(evaluateCourseSurface(-7.0, -4.0).hazard, 'none', 'single plank is a separate timber obstacle');

  const oilSurf = evaluateCourseSurface(-9.2, -4.0);
  assert.equal(oilSurf.hazard, 'oil');
  assert.ok(oilSurf.grip < 0.25, 'oil grip must be very low');
});

test('generateRockFieldStones produces deterministic stones bounded inside designated rock area', () => {
  const stones1 = generateRockFieldStones(12345);
  const stones2 = generateRockFieldStones(12345);
  assert.equal(stones1.length, stones2.length);
  assert.deepEqual(stones1[0], stones2[0]);

  // Check bounds
  for (const st of stones1) {
    assert.ok(st.x >= 1.5 && st.x <= 4.5, `stone x ${st.x} out of bounds`);
    assert.ok(st.z >= -1.2 && st.z <= 1.2, `stone z ${st.z} out of bounds`);
    assert.ok(st.scaleX > 0 && st.scaleY > 0 && st.scaleZ > 0);
  }
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
  assert.ok(DRIVE_ROUTE_WIDTH >= 3.8 && DRIVE_ROUTE_WIDTH <= 4.2, 'road width should leave steering clearance around slalom obstacles');
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

test('required obstacles sit on or within the road corridor rather than on detached pads', () => {
  const distanceToRoute = (point: { x: number; z: number }) => Math.min(...DRIVE_ROUTE.slice(1).map((b, i) => {
    const a = DRIVE_ROUTE[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
  }));
  const requiredCenters = [
    ...SLALOM_BARRIERS.map(b => ({ x: b.x, z: b.z, footprintAllowance: b.depth / 2 })),
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
    assert.equal(evaluateCourseHeight(plank.x, plank.z), 0.3, 'plank top must be a continuous supported surface');
  }
  const centerGapHeight = evaluateCourseHeight(PARALLEL_PLANK_CENTERS[0].x, PARALLEL_PLANK_CENTER_Z);
  assert.equal(centerGapHeight, 0.03, 'the gap between planks should remain a real gap');
});

test('slalom blocks cross the corridor with a continuous alternating pass width', () => {
  assert.equal(SLALOM_BARRIERS.length, 5);
  assert.equal(SPEED_BREAKER_XS.length, 3);
  for (let i = 0; i < SLALOM_BARRIERS.length; i++) {
    const b = SLALOM_BARRIERS[i];
    assert.ok(b.width > 0 && b.depth > 0 && b.height > 0);
    assert.ok(b.width >= 1.3 && b.depth <= 0.7, 'barriers should be elongated lane modules rather than cube placeholders');
    assert.ok(b.height >= 0.8, 'barrier shell must remain visible and physically substantial');
    if (i > 0) {
      assert.ok(SLALOM_BARRIERS[i - 1].x < b.x, 'barriers must be ordered along the driving direction');
      assert.ok(SLALOM_BARRIERS[i - 1].x + SLALOM_BARRIERS[i - 1].width / 2 < b.x - b.width / 2,
        'neighboring barrier modules must not overlap along the route');
      assert.notEqual(Math.sign(SLALOM_BARRIERS[i - 1].z - 8), Math.sign(b.z - 8), 'barriers alternate sides');
    }
  }
});

test('each slalom block leaves a physically passable opening for the robot envelope', () => {
  const audit = validateSlalomClearance();
  assert.equal(audit.valid, true, audit.issues.join('; '));
  for (const barrier of SLALOM_BARRIERS) {
    assert.ok(barrier.height >= 0.8, `${barrier.id} must be clearly visible above the track surface`);
  }
});

test('slalom clearance audit rejects the former blind block intruding into the straight route', () => {
  const formerBlindBlock = [{ id: 'former_blind_block', x: -10.4, z: 9.1, width: 0.36, depth: 1.8, height: 0.78 }];
  const audit = validateSlalomClearance(formerBlindBlock);
  assert.equal(audit.valid, false, 'a block that overlaps the robot envelope on the route must fail validation');
  assert.ok(audit.issues.some(issue => issue.includes('straight-route envelope')));
});

test('checkpoint gates require a forward crossing through the opening', () => {
  const gate = CHECKPOINTS[0];
  const gx = gate.x * 1.3;
  const gz = gate.z * 1.3;
  assert.equal(crossesCheckpointGate({ x: gx - 1, z: gz }, { x: gx + 1, z: gz }, gate), true);
  assert.equal(crossesCheckpointGate({ x: gx + 1, z: gz }, { x: gx - 1, z: gz }, gate), false, 'reverse travel cannot validate a gate');
  assert.equal(crossesCheckpointGate({ x: gx - 1, z: gz + 3 }, { x: gx + 1, z: gz + 3 }, gate), false, 'the robot must pass within the gate width');
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
