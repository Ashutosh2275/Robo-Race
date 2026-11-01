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

test('track underside sits on the sampled ground height without the previous 0.14 m lift', () => {
  const p = makePose({ y: 2 });
  for (let i = 0; i < 120; i++) stepVehicle3D(p, flatGround, 0, 0, 1 / 120);
  assert.ok(Math.abs(p.y - (flatGround() - TRACK_CONTACT_OFFSET)) < 0.002);
  assert.ok(Math.abs(p.y + TRACK_CONTACT_OFFSET - flatGround()) < 0.002);
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
  assert.equal(latestSafe.id, 'hazard_entry');
  assert.equal(getSafeRecoveryAnchor(0, anchors, () => false), null, 'no blocked location may be selected as a fallback');
});
