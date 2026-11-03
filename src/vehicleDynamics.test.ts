import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultRecoveryAnchors,
  getContactPatches,
  getSafeRecoveryAnchor,
  applyRecovery,
  isVehicleInverted,
  stepVehicle3D,
  type VehiclePose,
  TRACK_WIDTH,
  TRACK_CONTACT_OFFSET,
  ROBOT_HALF_WIDTH,
  ROBOT_HALF_LENGTH,
  getFootprintAabbHalfExtents,
  vehicleBarrierPenetration,
  getTurntableOmega,
  applyTurntableSurfaceInteraction,
  evaluateWaterBuoyancy,
} from './vehicleDynamics.ts';

const flatGround = () => 0.03;

function makePose(overrides: Partial<VehiclePose> = {}): VehiclePose {
  return {
    x: 0,
    y: flatGround() - TRACK_CONTACT_OFFSET,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
    isFlipped: false,
    isGrounded: true,
    flippedTimer: 0,
    ...overrides,
  };
}

test('getContactPatches computes symmetric track corners', () => {
  const patches = getContactPatches(0, 0, 0); // facing +Z
  // Left track is at x = -TRACK_WIDTH / 2
  assert.ok(Math.abs(patches.frontLeft.x - (-TRACK_WIDTH / 2)) < 1e-4);
  assert.ok(Math.abs(patches.frontRight.x - (TRACK_WIDTH / 2)) < 1e-4);
  assert.ok(patches.frontLeft.z > 0);
  assert.ok(patches.rearLeft.z < 0);
});

test('collision envelope rotates with the robot rather than remaining a fixed square', () => {
  const facingForward = getFootprintAabbHalfExtents(0);
  const facingRight = getFootprintAabbHalfExtents(Math.PI / 2);
  assert.ok(Math.abs(facingForward.x - ROBOT_HALF_WIDTH) < 1e-8);
  assert.ok(Math.abs(facingForward.z - ROBOT_HALF_LENGTH) < 1e-8);
  assert.ok(Math.abs(facingRight.x - ROBOT_HALF_LENGTH) < 1e-8);
  assert.ok(Math.abs(facingRight.z - ROBOT_HALF_WIDTH) < 1e-8);
});

test('barrier collision uses oriented footprints and returns full depenetration distance', () => {
  const wall = { x: 0, z: 0, hx: 0.1, hz: 1.0, rot: 0 };
  const shallowHit = vehicleBarrierPenetration(0.9, 0, Math.PI / 2, wall);
  assert.ok(shallowHit, 'the front of the robot should contact a thin wall');
  assert.ok(Math.abs(shallowHit.nx - 1) < 1e-6 && Math.abs(shallowHit.nz) < 1e-6,
    'normal should point out from the wall along the shortest separation axis');
  assert.ok(Math.abs(shallowHit.depth - 0.05) < 1e-6, 'return the whole overlap, not a fixed tiny nudge');
  assert.equal(vehicleBarrierPenetration(1.0, 0, Math.PI / 2, wall), null,
    'a robot whose oriented front is clear must not hit the wall');

  const rotatedWall = { x: 0, z: 0, hx: 0.1, hz: 1.0, rot: Math.PI / 2 };
  const sideHit = vehicleBarrierPenetration(0, 0.95, Math.PI / 2, rotatedWall);
  assert.ok(sideHit && sideHit.nz > 0.99, 'rotated barrier geometry must use its actual collider orientation');
});

test('isVehicleInverted detects upright vs inverted angles', () => {
  assert.equal(isVehicleInverted(0, 0), false);
  assert.equal(isVehicleInverted(0.3, 0.4), false);
  // Pitch > 90 degrees (~1.57 rad)
  assert.equal(isVehicleInverted(1.65, 0), true);
  // Roll > 90 degrees
  assert.equal(isVehicleInverted(0, 1.7), true);
  // Negative roll
  assert.equal(isVehicleInverted(0, -1.8), true);
});

test('flat ground smoothly damps any disturbance toward upright', () => {
  const p = makePose({ pitch: 0.15, roll: -0.1 });
  for (let i = 0; i < 60; i++) {
    stepVehicle3D(p, flatGround, 0, 0, 1 / 60);
  }
  assert.ok(Math.abs(p.pitch) < 0.02, `expected pitch near 0, got ${p.pitch}`);
  assert.ok(Math.abs(p.roll) < 0.02, `expected roll near 0, got ${p.roll}`);
  assert.equal(p.isFlipped, false);
});

test('turn banking stays restrained and settles instead of accumulating a hovering swing', () => {
  const p = makePose();
  for (let i = 0; i < 240; i++) stepVehicle3D(p, flatGround, 5.5, 1.4, 1 / 60);
  assert.ok(Math.abs(p.roll) <= 0.17, `turn bank should remain modest, got ${p.roll.toFixed(3)} rad`);
  for (let i = 0; i < 240; i++) stepVehicle3D(p, flatGround, 0, 0, 1 / 60);
  assert.ok(Math.abs(p.roll) < 0.02, `roll should settle after the turn, got ${p.roll.toFixed(3)} rad`);
  assert.ok(Math.abs(p.y - (flatGround() - TRACK_CONTACT_OFFSET)) < 0.002, 'chassis should remain at sampled track contact height');
});

test('track underside sits on the sampled ground height without the previous 0.14 m lift', () => {
  const p = makePose({ y: 2 });
  for (let i = 0; i < 120; i++) stepVehicle3D(p, flatGround, 0, 0, 1 / 120);
  assert.ok(Math.abs(p.y - (flatGround() - TRACK_CONTACT_OFFSET)) < 0.002);
  assert.ok(Math.abs(p.y + TRACK_CONTACT_OFFSET - flatGround()) < 0.002);
});

test('leaving a raised road falls under gravity and settles on the lower arena floor', () => {
  const raisedY = 0.03 - TRACK_CONTACT_OFFSET;
  const lowerGround = -0.33;
  const pose = makePose({ y: raisedY });
  stepVehicle3D(pose, () => lowerGround, 0, 0, 0.05);
  assert.equal(pose.isGrounded, false);
  assert.ok(pose.vy < 0, 'unsupported robot gains downward velocity');
  assert.ok(pose.y < raisedY && pose.y > lowerGround - TRACK_CONTACT_OFFSET, 'falls instead of teleporting to floor');
  for (let i = 0; i < 10; i++) stepVehicle3D(pose, () => lowerGround, 0, 0, 0.05);
  assert.equal(pose.isGrounded, true);
  assert.ok(Math.abs(pose.y - (lowerGround - TRACK_CONTACT_OFFSET)) < 1e-6);
});

test('severe drop on one side triggers rollover to inverted state', () => {
  // Height function where right side of the bridge is floor (0.0), left side is bridge deck (0.8)
  const bridgeDrop = (x: number) => (x > 0 ? 0.0 : 0.8);
  const p = makePose({ x: 0, z: 0, yaw: 0 }); // centered over drop edge
  for (let i = 0; i < 90; i++) {
    stepVehicle3D(p, bridgeDrop, 1.0, 0, 1 / 60);
  }
  assert.ok(p.isFlipped, 'vehicle should flip over after dropping off edge');
  assert.ok(isVehicleInverted(p.pitch, p.roll));
  assert.ok(p.flippedTimer > 0);
});

test('a brief board-edge height seam does not throw the robot into a false rollover', () => {
  const bridgeDrop = (x: number) => (x > 0 ? 0.0 : 0.8);
  const p = makePose({ x: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 6; i++) stepVehicle3D(p, bridgeDrop, 1.0, 0, 1 / 60);
  for (let i = 0; i < 30; i++) stepVehicle3D(p, flatGround, 1.0, 0, 1 / 60);
  assert.equal(p.isFlipped, false, 'short support-probe transitions must not count as falling off the board');
  assert.ok(Math.abs(p.roll) < 0.2, `robot should settle upright on the supported board, got ${p.roll.toFixed(3)} rad`);
});

test('inverted vehicle remains upside down until recovered', () => {
  const p = makePose({ pitch: 0, roll: Math.PI, isFlipped: true });
  for (let i = 0; i < 60; i++) {
    stepVehicle3D(p, flatGround, 0, 0, 1 / 60);
  }
  assert.ok(p.isFlipped, 'must not automatically snap upright');
  assert.ok(Math.abs(p.roll) > 1.55);
});

test('applyRecovery restores upright orientation and clears velocities', () => {
  const anchors = createDefaultRecoveryAnchors();
  const anchor = getSafeRecoveryAnchor(3, anchors);
  const p = makePose({
    x: 99,
    z: 99,
    vx: 12,
    pitch: 0.5,
    roll: Math.PI,
    pitchRate: 2,
    rollRate: -3,
    isFlipped: true,
  });

  applyRecovery(p, anchor, flatGround);

  assert.equal(p.isFlipped, false);
  assert.equal(p.pitch, 0);
  assert.equal(p.roll, 0);
  assert.equal(p.vx, 0);
  assert.equal(p.vz, 0);
  assert.equal(p.pitchRate, 0);
  assert.equal(p.rollRate, 0);
  assert.equal(p.x, anchor.x);
  assert.equal(p.z, anchor.z);
});

test('recovery chooses the latest safe anchor and falls back from a blocked one', () => {
  const anchors = createDefaultRecoveryAnchors();
  const latestSafe = getSafeRecoveryAnchor(8, anchors, anchor => anchor.id !== 'mixed_terrain');
  assert.equal(latestSafe.id, 'turntable');
  assert.equal(getSafeRecoveryAnchor(0, anchors, () => false), null, 'no blocked location may be selected as a fallback');
});

test('rotating vehicle in place does not introduce gyroscopic pitch/roll twisting or rollover', () => {
  // Test 360-degree rotation on flat ground: pitch and roll must stay strictly ~0
  const poseFlat = makePose({ x: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 180; i++) {
    // 3 seconds of pivoting in place at 2.1 rad/s
    poseFlat.yaw += 2.1 * (1 / 60);
    stepVehicle3D(poseFlat, flatGround, 0, 2.1, 1 / 60);
    assert.equal(poseFlat.isFlipped, false, 'pivot turning must never flip on flat ground');
    assert.ok(Math.abs(poseFlat.pitch) < 0.01, `pitch must not twist out during turn, got ${poseFlat.pitch}`);
    assert.ok(Math.abs(poseFlat.roll) < 0.01, `roll must not twist out during turn, got ${poseFlat.roll}`);
  }

  // Test rotation on a 15-degree continuous slope: pitch/roll smoothly track ground without runaway
  const slopeGround = (_x: number, z: number) => z * Math.tan(15 * Math.PI / 180);
  const poseSlope = makePose({ x: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 240; i++) {
    poseSlope.yaw += 1.8 * (1 / 60);
    stepVehicle3D(poseSlope, slopeGround, 0.5, 1.8, 1 / 60);
    assert.equal(poseSlope.isFlipped, false, 'turning on a normal slope must never flip the vehicle');
    assert.ok(Math.abs(poseSlope.pitch) <= 0.35, `pitch on 15 deg slope must stay within physical bound, got ${poseSlope.pitch}`);
    assert.ok(Math.abs(poseSlope.roll) <= 0.35, `roll on 15 deg slope must stay within physical bound, got ${poseSlope.roll}`);
  }
});

test('climbing an asymmetric rock obstacle exerts physical reaction yaw twist (broad twist)', () => {
  // Ground with a raised rock on the left side: left track climbs h=0.15m, right track stays on 0m
  const rockGroundLeft = (x: number, _z: number) => (x < 0 ? 0.15 : 0.0);
  const pose = makePose({ x: 0, z: 0, yaw: 0 });
  const initialYaw = pose.yaw;

  // Move forward at 1.5 m/s over the asymmetric rock
  for (let i = 0; i < 30; i++) {
    stepVehicle3D(pose, rockGroundLeft, 1.5, 0, 1 / 60);
  }

  // Left track climbs rock -> left track retarded -> robot nose twists right (-yaw in Three.js)
  assert.ok(pose.yaw < initialYaw, `expected nose to twist right (yaw < 0), got ${pose.yaw}`);
  assert.ok(Math.abs(pose.yaw - initialYaw) > 0.04, `expected broad twist magnitude > 0.04 rad, got ${Math.abs(pose.yaw - initialYaw)}`);
  assert.ok(pose.roll < 0, `left side up produces negative roll, got ${pose.roll}`);

  // Ground with a raised rock on the right side: right track climbs h=0.15m
  const rockGroundRight = (x: number, _z: number) => (x > 0 ? 0.15 : 0.0);
  const pose2 = makePose({ x: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 30; i++) {
    stepVehicle3D(pose2, rockGroundRight, 1.5, 0, 1 / 60);
  }

  // Right track climbs rock -> right track retarded -> robot nose twists left (+yaw in Three.js)
  assert.ok(pose2.yaw > 0, `expected nose to twist left (yaw > 0), got ${pose2.yaw}`);
  assert.ok(pose2.yaw > 0.04, `expected broad twist magnitude > 0.04 rad, got ${pose2.yaw}`);
});

test('getTurntableOmega returns ascending angular rotation speeds across difficulty tiers', () => {
  const b = getTurntableOmega('Beginner');
  const i = getTurntableOmega('Intermediate');
  const a = getTurntableOmega('Advanced');
  const p = getTurntableOmega('Pro');

  assert.ok(b < i, 'Beginner speed must be slower than Intermediate');
  assert.ok(i < a, 'Intermediate speed must be slower than Advanced');
  assert.ok(a < p, 'Advanced speed must be slower than Pro');
  assert.ok(b >= 0.20 && b <= 0.35, 'Beginner must provide stable, gentle rotation');
  assert.ok(p >= 0.90 && p <= 1.20, 'Pro must provide high-rpm competitive challenge');
});

test('applyTurntableSurfaceInteraction applies physical tangential dragging and yaw torque when on turntable', () => {
  const turntable = {
    centerX: 10.65,
    centerZ: 0.1,
    radius: 2.45,
    omega: 0.50, // rad/s CCW
  };
  const scale = 1.3;
  const worldCenterX = turntable.centerX * scale;
  const worldCenterZ = turntable.centerZ * scale;

  // 1. Robot stationary on the eastern sector of the turntable (+X from center)
  // At (+dx, 0): deck surface moves south (-Z in Three.js convention: vSurfZ = -omega * dx)
  const robotX = worldCenterX + 1.2;
  const robotZ = worldCenterZ;
  let vx = 0;
  let vz = 0;
  let yaw = 0;
  let yawRate = 0;

  // Step 30 frames at 60Hz
  for (let step = 0; step < 30; step++) {
    const res = applyTurntableSurfaceInteraction(
      robotX, robotZ, vx, vz, yaw, yawRate,
      turntable, 0.95, 1 / 60, scale
    );
    assert.equal(res.onTurntable, true);
    vx = res.vx;
    vz = res.vz;
    yaw = res.yaw;
    yawRate = res.yawRate;
  }

  // Robot must have acquired negative Z tangential velocity and positive yaw rate
  assert.ok(vz < -0.20, `expected negative Z tangential drag, got vz=${vz}`);
  assert.ok(yawRate > 0.20, `expected positive yawRate coupling from CCW turntable, got ${yawRate}`);
  assert.ok(yaw > 0.05, `expected positive yaw advancement from CCW rotation, got ${yaw}`);

  // 2. Robot located outside the turntable radius: must remain completely unaffected
  const outsideX = worldCenterX + 10.0;
  const outsideZ = worldCenterZ;
  const outsideRes = applyTurntableSurfaceInteraction(
    outsideX, outsideZ, 1.5, 0.0, 0.2, 0.0,
    turntable, 0.95, 1 / 60, scale
  );
  assert.equal(outsideRes.onTurntable, false);
  assert.equal(outsideRes.vx, 1.5);
  assert.equal(outsideRes.vz, 0.0);
  assert.equal(outsideRes.yaw, 0.2);
  assert.equal(outsideRes.yawRate, 0.0);
});

test('turntable road envelope provides >= 2.5x robot width clearance', () => {
  const turntableRadius = 2.45;
  const scale = 1.3;
  const worldDiameter = turntableRadius * 2 * scale;
  const robotWidth = ROBOT_HALF_WIDTH * 2;

  const clearanceRatio = worldDiameter / robotWidth;
  assert.ok(
    clearanceRatio >= 2.5 && clearanceRatio <= 3.5,
    `turntable clearance ratio should be 2.5-3.5x robot width, got ${clearanceRatio.toFixed(2)}x`
  );
});

test('evaluateWaterBuoyancy computes authentic Archimedes buoyancy, floating equilibrium, and paddle thrust', () => {
  const scale = 1.3;
  // Deep water pool center on Lane 2: x = -4.0, z = 6.75
  const poolWorldX = -4.0 * scale;
  const poolWorldZ = 6.75 * scale;

  // 1. Outside water bounds (e.g. at start line)
  const outside = evaluateWaterBuoyancy(0, 0, 0.67, 0, 1.0, 0, 1.0, 1.0, 1.0, scale);
  assert.equal(outside.inWater, false);
  assert.equal(outside.buoyantForce, 0);
  assert.equal(outside.normalForceRatio, 1.0);
  assert.equal(outside.isFloating, false);

  // 2. Shallow entry into water pool (immersion ~ 0.10m)
  // Water level is 0.16m. With worldY = 0.06 - TRACK_CONTACT_OFFSET, immersion ~ 0.10m
  const shallowY = 0.16 - 0.10 - TRACK_CONTACT_OFFSET;
  const shallow = evaluateWaterBuoyancy(poolWorldX, poolWorldZ, shallowY, 0, 1.0, 0, 1.0, 1.0, 1.0, scale);
  assert.equal(shallow.inWater, true);
  assert.ok(shallow.immersionDepth > 0.08 && shallow.immersionDepth < 0.12);
  assert.ok(shallow.buoyantForce > 500 && shallow.buoyantForce < 1500, `expected buoyant force ~1000N, got ${shallow.buoyantForce}`);
  assert.equal(shallow.isFloating, false, 'shallow immersion should not float');
  assert.ok(shallow.normalForceRatio > 0.65 && shallow.normalForceRatio < 0.90);

  // 3. Deep pool immersion (immersion ~ 0.35m)
  const deepY = 0.16 - 0.35 - TRACK_CONTACT_OFFSET;
  const deep = evaluateWaterBuoyancy(poolWorldX, poolWorldZ, deepY, -Math.PI / 2, 1.0, 0, 2.0, 2.0, 0.52, scale);
  assert.equal(deep.inWater, true);
  assert.ok(deep.isFloating, 'vehicle should reach buoyant floating equilibrium');
  assert.ok(deep.buoyantForce >= 3800, `expected buoyant force >= 3800N, got ${deep.buoyantForce}`);
  assert.ok(deep.normalForceRatio <= 0.10, 'normal ground force should drop sharply when floating');
  assert.ok(deep.effectiveGrip < 0.08, 'ground traction should drop significantly in deep water');

  // 4. Hydrodynamic water drag opposes horizontal motion
  assert.ok(deep.waterDragX < 0, `water drag should oppose positive vx, got ${deep.waterDragX}`);

  // 5. Track paddle thrust: spinning tracks forward provides forward propulsion along heading
  // For heading yaw = -PI/2 (Westbound, -X), forward paddle thrust should push in -X direction
  assert.ok(deep.paddleThrustX < -0.5, `forward track spin should produce Westbound (-X) paddle thrust, got ${deep.paddleThrustX}`);
});
