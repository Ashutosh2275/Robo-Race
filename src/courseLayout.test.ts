import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCourseHeight,
  evaluateCourseSurface,
  generateRockFieldStones,
  validateRouteClearance,
  HILL_NODES,
  CHECKPOINTS,
  crossesCheckpointGate,
  SLALOM_BARRIERS,
  SPEED_BREAKER_XS,
  DRIVE_ROUTE,
  DRIVE_ROUTE_WIDTH,
  validateDriveRoute,
  type CourseCollider,
} from './courseLayout.ts';

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
  const hillSummitH = evaluateCourseHeight(14.5, -7.6);
  assert.ok(hillSummitH > 4.0, `expected hill summit > 4.0, got ${hillSummitH}`);
});

test('evaluateCourseSurface implements mandatory sequence: fire -> water -> oil', () => {
  const fireSurf = evaluateCourseSurface(-2.8, -4.0);
  assert.equal(fireSurf.hazard, 'fire');

  const waterSurf = evaluateCourseSurface(-6.5, -4.0);
  assert.equal(waterSurf.hazard, 'water');
  assert.ok(waterSurf.grip < 0.7);

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
  }
});

test('continuous drive corridor stays in the arena and passes every checkpoint in order', () => {
  const audit = validateDriveRoute();
  assert.equal(audit.valid, true, audit.issues.join('; '));
  assert.ok(DRIVE_ROUTE_WIDTH >= 2.8 && DRIVE_ROUTE_WIDTH <= 3.2, 'road width should fit the robot without oversized empty shoulders');
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
    { x: -7.35, z: -8.49, footprintAllowance: 0.4 }, { x: -7.35, z: -6.91, footprintAllowance: 0.4 },
  ];
  for (const center of requiredCenters) {
    assert.ok(distanceToRoute(center) <= DRIVE_ROUTE_WIDTH / 2 + center.footprintAllowance + 0.15,
      `obstacle at (${center.x}, ${center.z}) falls outside the drive corridor`);
  }
});

test('slalom blocks cross the corridor with a continuous alternating pass width', () => {
  assert.equal(SLALOM_BARRIERS.length, 5);
  assert.equal(SPEED_BREAKER_XS.length, 3);
  for (let i = 0; i < SLALOM_BARRIERS.length; i++) {
    const b = SLALOM_BARRIERS[i];
    assert.ok(b.width > 0 && b.depth > 0 && b.height > 0);
    if (i > 0) {
      assert.ok(SLALOM_BARRIERS[i - 1].x < b.x, 'barriers must be ordered along the driving direction');
      assert.notEqual(Math.sign(SLALOM_BARRIERS[i - 1].z - 8), Math.sign(b.z - 8), 'barriers alternate sides');
    }
  }
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
