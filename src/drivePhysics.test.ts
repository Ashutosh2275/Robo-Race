import test from 'node:test';
import assert from 'node:assert/strict';
import { integrateDrive, mixDifferentialSteering, resolveWallVelocity, type DriveConfig, type DriveState } from './drivePhysics.ts';

const config: DriveConfig = { maxSpeed: 7.2, motorAcceleration: 10, braking: 9.2, turnRate: 1.15, turnResponse: 14, gravity: 9.81 };
const asphalt = { grip: 1.05, rollingResistance: .2 };
function state(overrides: Partial<DriveState> = {}): DriveState { return { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, angular: 0, ...overrides }; }

test('opposite track commands turn in place and left track forward turns right', () => {
  const s = state();
  integrateDrive(s, 1, -1, asphalt, { x: 0, z: 0 }, config, .1);
  assert.ok(s.yaw > 0);
  assert.ok(Math.abs(s.x) < .001 && Math.abs(s.z) < .001);
});

test('canonical left and right track commands turn in the intended directions', () => {
  const a = state();
  // Normalized semantic steering remains +1 LEFT and -1 RIGHT.
  const aTracks = mixDifferentialSteering(0, 1);
  integrateDrive(a, aTracks.left, aTracks.right, asphalt, { x: 0, z: 0 }, config, .1);
  assert.ok(a.yaw < 0, `canonical LEFT should produce negative yaw in +Z convention, got ${a.yaw}`);

  const d = state();
  const dTracks = mixDifferentialSteering(0, -1);
  integrateDrive(d, dTracks.left, dTracks.right, asphalt, { x: 0, z: 0 }, config, .1);
  assert.ok(d.yaw > 0, `canonical RIGHT should produce positive yaw in +Z convention, got ${d.yaw}`);
});

test('full throttle plus steering produces a responsive arc instead of a wide drift', () => {
  const s = state();
  // Canonical semantic steering: +1 is LEFT (Key A)
  const tracks = mixDifferentialSteering(1, 1);
  for (let i = 0; i < 60; i++) integrateDrive(s, tracks.left, tracks.right, asphalt, { x: 0, z: 0 }, config, 1 / 120);
  assert.ok(s.yaw < -.3, `expected a clear left arc, got ${s.yaw.toFixed(3)} rad`);
  assert.ok(s.x < 0, 'robot should make forward progress along its left-turning arc');
});

test('gravity accelerates a neutral robot downhill along the ground tangent', () => {
  const s = state({ yaw: -Math.PI / 2 });
  integrateDrive(s, 0, 0, asphalt, { x: .45, z: 0 }, config, .2);
  assert.ok(s.vx < 0);
  assert.ok(s.x < 0);
});

test('neutral input smoothly damps level-ground coasting but steep gravity still wins', () => {
  const level = state({ vx: 5 });
  integrateDrive(level, 0, 0, asphalt, { x: 0, z: 0 }, { ...config, coastDeceleration: 2.7 }, .5);
  assert.ok(level.vx < 4, `neutral level coasting should decay, got ${level.vx.toFixed(2)} m/s`);
  const slope = state({ yaw: Math.PI / 2 });
  integrateDrive(slope, 0, 0, asphalt, { x: .8, z: 0 }, { ...config, coastDeceleration: 2.7 }, .2);
  assert.ok(slope.vx < 0, 'steep downhill gravity must overcome unpowered drivetrain drag');
});

test('a forward-to-reverse command transition is torque-limited, not an instant velocity flip', () => {
  const s = state({ vz: 4 });
  integrateDrive(s, -1, -1, asphalt, { x: 0, z: 0 }, { ...config, coastDeceleration: 2.7 }, .08);
  assert.ok(s.vz > 0, 'short reverse input should first brake forward momentum');
  for (let i = 0; i < 120; i++) integrateDrive(s, -1, -1, asphalt, { x: 0, z: 0 }, config, 1 / 120);
  assert.ok(s.vz < 0, 'continued reverse input should eventually drive backward');
});

test('low grip lets gravity beat the motors uphill and reports track slip', () => {
  const s = state({ yaw: Math.PI / 2 });
  const result = integrateDrive(s, 1, 1, { grip: .22, rollingResistance: .2 }, { x: .8, z: 0 }, config, .1);
  assert.ok(result.motorSlip > .5);
  assert.ok(s.vx < 0);
});

test('each track reports driven belt speed independently of chassis progress', () => {
  const s = state({ yaw: Math.PI / 2 });
  const result = integrateDrive(s, 1, 1, { grip: .12, rollingResistance: .2 }, { x: .8, z: 0 }, config, .1);
  assert.ok(result.trackSpeedLeft > 0 && result.trackSpeedRight > 0);
  assert.ok(result.motorSlip > .5);
  assert.ok(s.vx < 0, 'limited traction should allow the chassis to slide downhill while belts are driven uphill');
  const neutral = integrateDrive(state(), 0, 0, asphalt, { x: .4, z: 0 }, config, .1);
  assert.equal(neutral.trackSpeedLeft, 0);
  assert.equal(neutral.trackSpeedRight, 0);
});

test('limited surface grip also reduces turning authority while the belts keep spinning', () => {
  const asphaltState = state();
  const slickState = state();
  // Canonical semantic steering: +1 is LEFT
  const a = mixDifferentialSteering(0, 1);
  integrateDrive(asphaltState, a.left, a.right, asphalt, { x: 0, z: 0 }, config, .1);
  const slick = integrateDrive(slickState, a.left, a.right, { grip: .18, rollingResistance: .1 }, { x: 0, z: 0 }, config, .1);
  assert.ok(asphaltState.yaw < 0);
  assert.ok(Math.abs(slickState.yaw) < Math.abs(asphaltState.yaw));
  assert.ok(slick.motorSlip > 0);
  assert.ok(slick.trackSpeedLeft < 0 && slick.trackSpeedRight > 0);
});

test('a higher-grip motor can climb a moderate grade', () => {
  const s = state({ yaw: Math.PI / 2 });
  integrateDrive(s, 1, 1, { grip: 1.1, rollingResistance: .2 }, { x: .35, z: 0 }, config, .2);
  assert.ok(s.vx > 0);
});

test('validated ~35 degree switchback ramps remain climbable with the configured timber grip', () => {
  const s = state({ yaw: Math.PI / 2 });
  const slope = Math.tan(35 * Math.PI / 180);
  for (let i = 0; i < 240; i++) {
    integrateDrive(s, 1, 1, { grip: 0.84, rollingResistance: 0.48 }, { x: slope, z: 0 }, config, 1 / 120);
  }
  assert.ok(s.vx > 0.1, `full throttle should climb the validated 35° grade, got ${s.vx.toFixed(2)} m/s`);
});

test('braking counters downhill motion and wall response removes inward velocity', () => {
  const s = state({ yaw: -Math.PI / 2, vx: -2 });
  integrateDrive(s, 0, 0, asphalt, { x: .3, z: 0 }, config, .2, true);
  assert.ok(s.vx > -2);
  const reflected = resolveWallVelocity(-3, 1, 1, 0);
  assert.ok(reflected.vx > 0);
  assert.equal(reflected.vz, 1);
});
