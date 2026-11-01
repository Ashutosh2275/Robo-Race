import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mixThrottleSteering,
  resolveKeyboardAxes,
  keyboardKeysFromCodes,
  CONTROL_PRESETS,
} from './driveControls.ts';
import {
  integrateDrive,
  type DriveConfig,
  type DriveState,
  type Surface,
} from './drivePhysics.ts';
import { UniversalController } from './universalController.ts';

const config: DriveConfig = {
  maxSpeed: 7.2,
  motorAcceleration: 10,
  braking: 9.2,
  turnRate: 1.15,
  turnResponse: 14,
  gravity: 9.81,
};

const asphalt: Surface = { grip: 1.05, rollingResistance: 0.2 };
const slickOil: Surface = { grip: 0.25, rollingResistance: 0.1 };

function createState(overrides: Partial<DriveState> = {}): DriveState {
  return { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, angular: 0, ...overrides };
}

function simulateStep(state: DriveState, throttle: number, steering: number, surface: Surface = asphalt, slope = { x: 0, z: 0 }, dt = 0.1) {
  const tracks = mixThrottleSteering(throttle, steering);
  return integrateDrive(state, tracks.left, tracks.right, surface, slope, config, dt);
}

test('Eight-Direction Movement: normalized differential commands obey heading rules', () => {
  // 1. Forward (W): moves +Z, zero yaw change
  {
    const s = createState();
    simulateStep(s, 1, 0);
    assert.ok(s.vz > 0, 'Forward should have positive forward velocity');
    assert.equal(s.yaw, 0, 'Forward should not rotate yaw');
  }

  // 2. Forward-left semantic command: moves +Z and nose rotates left.
  {
    const s = createState();
    simulateStep(s, 1, 1);
    assert.ok(s.vz > 0, 'Forward-left should make forward progress');
    assert.ok(s.yaw < 0, `Forward-left must rotate nose LEFT (negative yaw), got ${s.yaw}`);
  }

  // 3. Forward-right semantic command: moves +Z and nose rotates right.
  {
    const s = createState();
    simulateStep(s, 1, -1);
    assert.ok(s.vz > 0, 'Forward-right should make forward progress');
    assert.ok(s.yaw > 0, `Forward-right must rotate nose RIGHT (positive yaw), got ${s.yaw}`);
  }

  // 4. Backward (S): moves -Z, zero yaw change
  {
    const s = createState();
    simulateStep(s, -1, 0);
    assert.ok(s.vz < 0, 'Reverse should have negative forward velocity');
    assert.equal(s.yaw, 0, 'Reverse should not rotate yaw');
  }

  // 5. Backward-left semantic command: moves -Z and nose rotates left.
  {
    const s = createState();
    simulateStep(s, -1, 1);
    assert.ok(s.vz < 0, 'Backward-left should travel in reverse');
    assert.ok(s.yaw < 0, `Backward-left MUST turn nose LEFT (negative yaw), got ${s.yaw}`);
  }

  // 6. Backward-right semantic command: moves -Z and nose rotates right.
  {
    const s = createState();
    simulateStep(s, -1, -1);
    assert.ok(s.vz < 0, 'Backward-right should travel in reverse');
    assert.ok(s.yaw > 0, `Backward-right MUST turn nose RIGHT (positive yaw), got ${s.yaw}`);
  }

  // 7. Semantic pivot-left command: in-place rotation with nose turning left.
  {
    const s = createState();
    simulateStep(s, 0, 1);
    assert.ok(Math.abs(s.vz) < 0.01 && Math.abs(s.vx) < 0.01, 'Pivot left should stay in place');
    assert.ok(s.yaw < 0, `Pivot left must rotate nose LEFT, got ${s.yaw}`);
  }

  // 8. Semantic pivot-right command: in-place rotation with nose turning right.
  {
    const s = createState();
    simulateStep(s, 0, -1);
    assert.ok(Math.abs(s.vz) < 0.01 && Math.abs(s.vx) < 0.01, 'Pivot right should stay in place');
    assert.ok(s.yaw > 0, `Pivot right must rotate nose RIGHT, got ${s.yaw}`);
  }
});

test('Reverse throttle never flips normalized steering semantics', () => {
  const fwdLeft = createState();
  simulateStep(fwdLeft, 1, 1);

  const revLeft = createState();
  simulateStep(revLeft, -1, 1);

  // Both MUST have negative yaw (nose turns left)
  assert.ok(fwdLeft.yaw < 0, 'normalized forward-left steering must turn the nose left');
  assert.ok(revLeft.yaw < 0, 'normalized reverse-left steering must turn the nose left');
  assert.equal(Math.sign(fwdLeft.yaw), Math.sign(revLeft.yaw), 'Steering sign must be identical forward vs reverse');

  const fwdRight = createState();
  simulateStep(fwdRight, 1, -1);

  const revRight = createState();
  simulateStep(revRight, -1, -1);

  // Both MUST have positive yaw (nose turns right)
  assert.ok(fwdRight.yaw > 0, 'normalized forward-right steering must turn the nose right');
  assert.ok(revRight.yaw > 0, 'normalized reverse-right steering must turn the nose right');
  assert.equal(Math.sign(fwdRight.yaw), Math.sign(revRight.yaw), 'Steering sign must be identical forward vs reverse');
});

test('Opposing keyboard inputs cancel cleanly without residual steering or throttle', () => {
  // A is left, while T is retained as a right-turn alternate; they cancel.
  const keysAT = keyboardKeysFromCodes(new Set(['KeyA', 'KeyT']));
  const axesAT = resolveKeyboardAxes(keysAT);
  assert.equal(axesAT.steering, 0, 'A+T request opposite steering and cancel');
  assert.equal(axesAT.throttle, 0);

  // A + D
  const keysAD = keyboardKeysFromCodes(new Set(['KeyA', 'KeyD']));
  const axesAD = resolveKeyboardAxes(keysAD);
  assert.equal(axesAD.steering, 0, 'A+D must cancel steering to 0');

  // W + S
  const keysWS = keyboardKeysFromCodes(new Set(['KeyW', 'KeyS']));
  const axesWS = resolveKeyboardAxes(keysWS);
  assert.equal(axesWS.throttle, 0, 'W+S must cancel throttle to 0');
  assert.equal(axesWS.steering, 0);

  // W + S + A + D cancels both axes.
  const keysAll = keyboardKeysFromCodes(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']));
  const axesAll = resolveKeyboardAxes(keysAll);
  assert.equal(axesAll.throttle, 0);
  assert.equal(axesAll.steering, 0);
});

test('Normalized steering stays consistent across terrain slopes and friction', () => {
  // Level ground
  const levelLeft = createState();
  simulateStep(levelLeft, 0.5, 1, asphalt, { x: 0, z: 0 });
  assert.ok(levelLeft.yaw < 0, 'Level ground left turn should have yaw < 0');

  // Downhill slope (+Z is downhill)
  const downhillLeft = createState();
  simulateStep(downhillLeft, 0.5, 1, asphalt, { x: 0, z: -0.3 });
  assert.ok(downhillLeft.yaw < 0, 'Downhill left turn must preserve nose left turn direction');

  // Uphill slope (-Z is downhill)
  const uphillLeft = createState();
  simulateStep(uphillLeft, 0.5, 1, asphalt, { x: 0, z: 0.3 });
  assert.ok(uphillLeft.yaw < 0, 'Uphill left turn must preserve nose left turn direction');

  // Low grip surface (slick oil)
  const slickLeft = createState();
  simulateStep(slickLeft, 0.5, 1, slickOil, { x: 0, z: 0 });
  assert.ok(slickLeft.yaw < 0, 'Slick oil left turn must preserve nose left turn direction');
});

test('UniversalController maps transmitter and gamepad stick left to positive semantic steering', () => {
  const ctrl = new UniversalController();

  // Simulate pushing stick left (raw axis = -1.0 in HTML5 Gamepad)
  const fakeGamepadLeft = {
    id: 'RadioMaster Boxer Joystick (STANDARD GAMEPAD)',
    axes: [-1.0, 0, 0, 0],
    buttons: [{ pressed: false, value: 0 }],
    timestamp: performance.now(),
  };

  const sampleLeft = ctrl.sample(fakeGamepadLeft, performance.now());
  assert.ok(sampleLeft.steering > 0, `Stick LEFT must produce positive semantic steering, got ${sampleLeft.steering}`);
  assert.equal(sampleLeft.source, 'transmitter');

  // Simulate pushing stick right (raw axis = +1.0 in HTML5 Gamepad)
  const fakeGamepadRight = {
    id: 'RadioMaster Boxer Joystick (STANDARD GAMEPAD)',
    axes: [1.0, 0, 0, 0],
    buttons: [{ pressed: false, value: 0 }],
    timestamp: performance.now(),
  };

  const sampleRight = ctrl.sample(fakeGamepadRight, performance.now());
  assert.ok(sampleRight.steering < 0, `Stick RIGHT must produce negative semantic steering, got ${sampleRight.steering}`);

  // Diagnostics check
  const diag = ctrl.getDiagnostics();
  assert.ok(diag.profileName.includes('RadioMaster'), 'Profile name must identify transmitter');
  assert.equal(diag.failsafeActive, false);
});

test('UniversalController keyboard output reaches the drivetrain with requested screen-relative turn directions', () => {
  const cases = [
    { keys: ['KeyA'], yaw: 1, label: 'A counter-clockwise pivot' },
    { keys: ['KeyD'], yaw: -1, label: 'D clockwise pivot' },
    { keys: ['KeyW', 'KeyA'], yaw: 1, label: 'W+A left curve' },
    { keys: ['KeyW', 'KeyD'], yaw: -1, label: 'W+D right curve' },
    { keys: ['KeyS', 'KeyA'], yaw: -1, label: 'S+A reverse clockwise curve' },
    { keys: ['KeyS', 'KeyD'], yaw: 1, label: 'S+D reverse counter-clockwise curve' },
  ] as const;

  for (const item of cases) {
    const controller = new UniversalController();
    for (const code of item.keys) controller.handleKeyDown(code);
    const output = controller.poll();
    const state = createState();
    for (let i = 0; i < 60; i++) integrateDrive(state, output.leftTrack, output.rightTrack, asphalt, { x: 0, z: 0 }, config, 1 / 60);
    assert.equal(Math.sign(state.yaw), item.yaw, `${item.label} through UniversalController.poll()`);
    controller.neutralize();
    assert.equal(controller.poll().leftTrack, 0, `${item.label} release must stop stale track command`);
  }
});
