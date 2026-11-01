import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_PRESETS, keyboardKeysFromCodes, keyboardTrackCommands, mixThrottleSteering, resolveKeyboardAxes, selectInputSource } from './driveControls.ts';
import { integrateDrive, type DriveConfig, type DriveState } from './drivePhysics.ts';

const tune = CONTROL_PRESETS.Medium;
const physics: DriveConfig = { maxSpeed: 7.2, motorAcceleration: 10, braking: 9.2, turnRate: 1.15, turnResponse: 14, gravity: 9.81 };
const surface = { grip: 1.05, rollingResistance: .2 };
const makeState = (): DriveState => ({ x: 0, z: 0, vx: 0, vz: 0, yaw: 0, angular: 0 });
const keys = (forward = false, reverse = false, left = false, right = false) => ({ forward, reverse, left, right });

test('all 16 WASD key states have deterministic, clamped differential outputs', () => {
  for (let bits = 0; bits < 16; bits++) {
    const input = keys(Boolean(bits & 1), Boolean(bits & 2), Boolean(bits & 4), Boolean(bits & 8));
    const axes = resolveKeyboardAxes(input);
    const tracks = keyboardTrackCommands(input, tune);
    assert.ok(tracks.left >= -1 && tracks.left <= 1, `left command out of range for mask ${bits}`);
    assert.ok(tracks.right >= -1 && tracks.right <= 1, `right command out of range for mask ${bits}`);
    if (input.forward && input.reverse) assert.equal(axes.throttle, 0, `W+S conflict mask ${bits}`);
    if (input.left && input.right) assert.equal(axes.steering, 0, `A+D conflict mask ${bits}`);
    if (bits === 15) assert.deepEqual(tracks, { left: 0, right: 0 }, 'all four keys must be neutral');
  }
});

test('eight intended directions produce the expected track differential and real yaw', () => {
  const directions = [
    ['forward', keys(true), 0, 1],
    ['forward-left', keys(true, false, true), 1, 1],
    ['forward-right', keys(true, false, false, true), -1, 1],
    ['left pivot', keys(false, false, true), 1, 0],
    ['right pivot', keys(false, false, false, true), -1, 0],
    ['reverse', keys(false, true), 0, -1],
    ['reverse-left', keys(false, true, true), -1, -1],
    ['reverse-right', keys(false, true, false, true), 1, -1],
  ] as const;
  for (const [name, input, yawSign, moveSign] of directions) {
    const tracks = keyboardTrackCommands(input, tune);
    const s = makeState();
    for (let i = 0; i < 48; i++) integrateDrive(s, tracks.left, tracks.right, surface, { x: 0, z: 0 }, physics, 1 / 120);
    if (yawSign) assert.equal(Math.sign(s.yaw), yawSign, `${name} yaw direction`);
    else assert.equal(Math.abs(s.yaw) < 1e-8, true, `${name} should not turn`);
    if (moveSign) assert.equal(Math.sign(s.z), moveSign, `${name} forward/reverse direction`);
    else assert.ok(Math.abs(s.z) < .001, `${name} pivot should not translate`);
    if (name.includes('left')) assert.ok(name.startsWith('reverse') ? s.yaw < 0 : s.yaw > 0, `${name} must match the keyboard screen-turn convention`);
    if (name.includes('right')) assert.ok(name.startsWith('reverse') ? s.yaw > 0 : s.yaw < 0, `${name} must match the keyboard screen-turn convention`);
  }
});

test('opposed keys cancel only their axis and do not fall through to stale joystick values', () => {
  assert.deepEqual(resolveKeyboardAxes(keys(true, true, true, false)), { throttle: 0, steering: 1 });
  assert.deepEqual(resolveKeyboardAxes(keys(true, false, true, true)), { throttle: 1, steering: 0 });
  assert.deepEqual(keyboardTrackCommands(keys(true, true), tune), { left: 0, right: 0 });
  assert.deepEqual(keyboardTrackCommands(keys(false, false, true, true), tune), { left: 0, right: 0 });
  assert.deepEqual(keyboardTrackCommands(keys(true, false, true, true), tune), { left: 1, right: 1 });
  assert.deepEqual(keyboardTrackCommands(keys(true, true, true, false), tune), { left: tune.pivotSensitivity, right: -tune.pivotSensitivity });
  assert.deepEqual(mixThrottleSteering(0, 0), { left: 0, right: 0 });
});

test('A maps left, D maps right, and opposing A+D inputs cancel', () => {
  const a = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyA'])), tune);
  const t = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyT'])), tune);
  const d = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyD'])), tune);
  const b = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyB'])), tune);

  assert.ok(a.left > 0 && a.right < 0, 'A should rotate counter-clockwise in the chase view');
  assert.ok(t.left < 0 && t.right > 0, 'T should rotate clockwise in the chase view');
  assert.ok(d.left < 0 && d.right > 0, 'D should rotate clockwise in the chase view');
  assert.deepEqual(t, b, 'T and B remain alternate right-turn keys');

  // Opposing steering conflicts must cancel to 0
  const conflictAT = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyA', 'KeyT'])), tune);
  assert.deepEqual(conflictAT, { left: 0, right: 0 }, 'A+T requests opposite directions and must cancel');

  const conflictAD = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyA', 'KeyD'])), tune);
  assert.deepEqual(conflictAD, { left: 0, right: 0 }, 'A+D must cancel steering command to neutral');

  // Opposing throttle conflicts must cancel to 0
  const conflictWS = keyboardTrackCommands(keyboardKeysFromCodes(new Set(['KeyW', 'KeyS'])), tune);
  assert.deepEqual(conflictWS, { left: 0, right: 0 }, 'W+S must cancel throttle command to neutral');
});

test('actual keyboard A rotates counter-clockwise and D clockwise in the rendered heading convention', () => {
  for (const [code, expectedYawSign] of [['KeyA', 1], ['KeyD', -1]] as const) {
    const commands = keyboardTrackCommands(keyboardKeysFromCodes(new Set([code])), tune);
    const state = makeState();
    for (let i = 0; i < 60; i++) integrateDrive(state, commands.left, commands.right, surface, { x: 0, z: 0 }, physics, 1 / 120);
    assert.equal(Math.sign(state.yaw), expectedYawSign, `${code} should turn in the requested opposite direction`);
  }
});

test('keyboard reverse steering follows driving-game path curvature while pivot directions stay fixed', () => {
  const yawAfter = (input: ReturnType<typeof keys>) => {
    const commands = keyboardTrackCommands(input, tune);
    const state = makeState();
    for (let i = 0; i < 60; i++) integrateDrive(state, commands.left, commands.right, surface, { x: 0, z: 0 }, physics, 1 / 120);
    return state.yaw;
  };
  assert.ok(yawAfter(keys(false, true, true)) < 0, 'S+A turns clockwise');
  assert.ok(yawAfter(keys(false, true, false, true)) > 0, 'S+D turns counter-clockwise');
  assert.ok(yawAfter(keys(false, false, true)) > 0, 'A pivot remains counter-clockwise');
  assert.ok(yawAfter(keys(false, false, false, true)) < 0, 'D pivot remains clockwise');
});

test('keyboard source has priority over an active joystick and neutral takes over after release', () => {
  assert.equal(selectInputSource(true, true), 'keyboard');
  assert.equal(selectInputSource(false, true), 'joystick');
  assert.equal(selectInputSource(false, false), 'neutral');
});

test('mix clamps both tracks and all presets contain bounded tunings', () => {
  assert.deepEqual(mixThrottleSteering(1, -1), { left: 1, right: 0 });
  assert.deepEqual(mixThrottleSteering(-1, 1), { left: -1, right: 0 });
  for (const preset of Object.values(CONTROL_PRESETS)) {
    assert.ok(preset.forwardSensitivity > 0 && preset.reverseSensitivity > 0);
    assert.ok(preset.steeringSensitivity > 0 && preset.maxRotation > 0);
  }
});
