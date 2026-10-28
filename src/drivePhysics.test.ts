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

test('A maps to a left turn and D maps to a right turn', () => {
  const a = state();
  const aTracks = mixDifferentialSteering(0, 0, -1);
  integrateDrive(a, aTracks.left, aTracks.right, asphalt, { x: 0, z: 0 }, config, .1);
  assert.ok(a.yaw > 0);

  const d = state();
  const dTracks = mixDifferentialSteering(0, 0, 1);
  integrateDrive(d, dTracks.left, dTracks.right, asphalt, { x: 0, z: 0 }, config, .1);
  assert.ok(d.yaw < 0);
});

test('full throttle plus steering produces a responsive arc instead of a wide drift', () => {
  const s = state();
  const tracks = mixDifferentialSteering(1, 1, -1);
  for (let i = 0; i < 60; i++) integrateDrive(s, tracks.left, tracks.right, asphalt, { x: 0, z: 0 }, config, 1 / 120);
  assert.ok(s.yaw > .3, `expected a clear left arc, got ${s.yaw.toFixed(3)} rad`);
  assert.ok(s.x > 0, 'robot should still make forward progress while turning');
});

test('gravity accelerates a neutral robot downhill along the ground tangent', () => {
  const s = state({ yaw: -Math.PI / 2 });
  integrateDrive(s, 0, 0, asphalt, { x: .45, z: 0 }, config, .2);
  assert.ok(s.vx < 0);
  assert.ok(s.x < 0);
});

test('low grip lets gravity beat the motors uphill and reports track slip', () => {
  const s = state({ yaw: Math.PI / 2 });
  const result = integrateDrive(s, 1, 1, { grip: .22, rollingResistance: .2 }, { x: .8, z: 0 }, config, .1);
  assert.ok(result.motorSlip > .5);
  assert.ok(s.vx < 0);
});

test('a higher-grip motor can climb a moderate grade', () => {
  const s = state({ yaw: Math.PI / 2 });
  integrateDrive(s, 1, 1, { grip: 1.1, rollingResistance: .2 }, { x: .35, z: 0 }, config, .2);
  assert.ok(s.vx > 0);
});

test('braking counters downhill motion and wall response removes inward velocity', () => {
  const s = state({ yaw: -Math.PI / 2, vx: -2 });
  integrateDrive(s, 0, 0, asphalt, { x: .3, z: 0 }, config, .2, true);
  assert.ok(s.vx > -2);
  const reflected = resolveWallVelocity(-3, 1, 1, 0);
  assert.ok(reflected.vx > 0);
  assert.equal(reflected.vz, 1);
});
