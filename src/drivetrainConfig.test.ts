import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DRIVE_WHEEL_LAYOUT,
  MOTOR_SPECIFICATIONS,
  configureDriveWheelLayout,
  drivetrainTopology,
  maxMotorAccelerationMps2,
  maxTrackSpeedMps,
} from './drivetrainConfig.ts';

test('robot topology has exactly four wheels, two independent 600 RPM motors and two belts', () => {
  const topology = drivetrainTopology();
  assert.equal(topology.wheels.length, 4);
  assert.equal(topology.motors.length, 2);
  assert.equal(topology.beltCount, 2);
  assert.deepEqual(topology.motors.map((m) => m.ratedRpm), [600, 600]);
  assert.deepEqual(topology.poweredWheels, ['left-front', 'right-rear']);
  assert.deepEqual(topology.passiveWheels, ['left-rear', 'right-front']);
});

test('wheel drive layout can be changed as one diagonal pair without creating more motors', () => {
  const alternate = configureDriveWheelLayout('left-rear-right-front');
  assert.deepEqual(alternate.map((m) => m.poweredWheel), ['left-rear', 'right-front']);
  assert.equal(alternate.length, 2);
  assert.equal(DEFAULT_DRIVE_WHEEL_LAYOUT, 'left-front-right-rear');
});

test('600 RPM is converted through gearbox, sprocket circumference and efficiency', () => {
  const motor = MOTOR_SPECIFICATIONS[0];
  const expected = (2 * Math.PI * motor.sprocketRadiusM) * (motor.ratedRpm / motor.gearboxRatio) / 60 * motor.efficiency;
  assert.ok(Math.abs(maxTrackSpeedMps(motor) - expected) < 1e-10);
  assert.ok(maxMotorAccelerationMps2(motor) > 0);
});
