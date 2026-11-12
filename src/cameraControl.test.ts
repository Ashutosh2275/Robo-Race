import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA_RETURN_DELAY_SEC,
  stepCameraFreeLook,
  wrapSignedAngleRad,
  type CameraFreeLookState,
} from './cameraControl.ts';

test('wrapSignedAngleRad keeps multi-turn 360-degree camera loops within (-PI, PI]', () => {
  assert.ok(Math.abs(wrapSignedAngleRad(Math.PI * 2)) < 1e-9);
  assert.ok(Math.abs(wrapSignedAngleRad(Math.PI * 1.75) - (-Math.PI * 0.25)) < 1e-9);
  assert.ok(Math.abs(wrapSignedAngleRad(-Math.PI * 3.5) - (Math.PI * 0.5)) < 1e-9);
});

test('pointer-locked mouse look and zoom wait briefly then auto-return to default view along shortest 360 arc', () => {
  const cam: CameraFreeLookState = {
    freeYaw: 0,
    freePitch: 0,
    distanceOffset: 0,
    idleTimer: 0,
  };

  // User rotates ~340 degrees (+5.93 rad) and zooms in (-2.5m) while pointer-locked
  stepCameraFreeLook(cam, 0.016, {
    lockedDeltaYaw: 5.93,
    lockedDeltaPitch: -0.35,
    wheelDeltaDistance: -2.5,
  });

  // Shortest-path wrapped offset should be negative (~ -0.35 rad), not +5.93 rad!
  assert.ok(cam.freeYaw < 0 && cam.freeYaw > -0.5, `expected shortest arc negative yaw, got ${cam.freeYaw}`);
  assert.equal(cam.idleTimer, DEFAULT_CAMERA_RETURN_DELAY_SEC);

  // Zero-movement mouse noise must NOT reset the countdown timer
  for (let i = 0; i < 60; i++) {
    stepCameraFreeLook(cam, 0.02, { lockedDeltaYaw: 0, lockedDeltaPitch: 0 });
  }
  assert.ok(cam.idleTimer < DEFAULT_CAMERA_RETURN_DELAY_SEC - 1.0);
  assert.ok(Math.abs(cam.distanceOffset - (-2.5)) < 1e-6, 'offset stays steady during grace delay');

  // Elapse past the return delay so Google-Maps-style recenter glides cleanly back to default
  for (let i = 0; i < 240; i++) {
    stepCameraFreeLook(cam, 1 / 60);
  }
  assert.equal(cam.freeYaw, 0);
  assert.equal(cam.freePitch, 0);
  assert.equal(cam.distanceOffset, 0);
});

test('zoom out pulls back within bounds and smoothly returns to default distance when idle', () => {
  const cam: CameraFreeLookState = { freeYaw: 0, freePitch: 0, distanceOffset: 0, idleTimer: 0 };
  stepCameraFreeLook(cam, 0.016, { wheelDeltaDistance: 5.2 });
  assert.ok(Math.abs(cam.distanceOffset - 5.2) < 1e-6);

  // Advance through delay + 3.5 seconds of return
  for (let i = 0; i < 360; i++) {
    stepCameraFreeLook(cam, 1 / 60);
  }
  assert.equal(cam.distanceOffset, 0);
});
