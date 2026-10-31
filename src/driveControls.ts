export type KeyboardKeys = {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
};

export type TrackCommands = { left: number; right: number };
export type InputSource = 'keyboard' | 'joystick' | 'neutral';

export type ControlTuning = {
  forwardSensitivity: number;
  reverseSensitivity: number;
  steeringSensitivity: number;
  pivotSensitivity: number;
};

export type VehicleTuning = ControlTuning & {
  acceleration: number;
  braking: number;
  steeringResponse: number;
  maxSpeed: number;
  maxRotation: number;
};

export const CONTROL_PRESETS: Record<'Low' | 'Medium' | 'High', VehicleTuning> = {
  Low: { forwardSensitivity: 0.7, reverseSensitivity: 0.7, steeringSensitivity: 0.55, pivotSensitivity: 0.40, acceleration: 8.0, braking: 9.5, steeringResponse: 14, maxSpeed: 5.5, maxRotation: 0.9 },
  Medium: { forwardSensitivity: 1.0, reverseSensitivity: 1.0, steeringSensitivity: 0.65, pivotSensitivity: 0.50, acceleration: 10.5, braking: 10.0, steeringResponse: 16, maxSpeed: 7.2, maxRotation: 1.25 },
  High: { forwardSensitivity: 1.2, reverseSensitivity: 1.1, steeringSensitivity: 0.85, pivotSensitivity: 0.62, acceleration: 13.0, braking: 12.0, steeringResponse: 20, maxSpeed: 8.8, maxRotation: 1.65 },
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function selectInputSource(keyboardActive: boolean, analogActive: boolean): InputSource {
  return keyboardActive ? 'keyboard' : analogActive ? 'joystick' : 'neutral';
}

/**
 * Resolves keyboard input axes:
 * throttle: +1 for W (Forward), -1 for S (Reverse), 0 if opposing or neither.
 * steering: +1 for A (Turn Front Left), -1 for D/B (Turn Front Right), 0 if opposing or neither.
 * Opposing keys on either axis cancel each other out safely.
 */
export function resolveKeyboardAxes(keys: KeyboardKeys) {
  return {
    throttle: keys.forward === keys.reverse ? 0 : keys.forward ? 1 : -1,
    steering: keys.left === keys.right ? 0 : keys.left ? 1 : -1,
  };
}

export function keyboardKeysFromCodes(codes: ReadonlySet<string>): KeyboardKeys {
  return {
    forward: codes.has('KeyW') || codes.has('ArrowUp'),
    reverse: codes.has('KeyS') || codes.has('ArrowDown'),
    left: codes.has('KeyA') || codes.has('ArrowLeft'),
    right: codes.has('KeyD') || codes.has('KeyB') || codes.has('ArrowRight'),
  };
}

/**
 * Physical differential track mix:
 *
 * In the engine's coordinate system (where looking forward down heading shows +yaw turning LEFT):
 * - To turn the front LEFT: left track is accelerated forward relative to right track (vL > vR).
 * - To turn the front RIGHT: right track is accelerated forward relative to left track (vL < vR).
 *
 * This holds universally for:
 * - Forward (W+A: left arc, W+D: right arc)
 * - Reverse (S+A: reverse while nose turns left, S+D: reverse while nose turns right)
 * - In-place pivot (A alone: pivot left, D alone: pivot right)
 */
export function mixThrottleSteering(throttle: number, steeringLeft: number): TrackCommands {
  let left = throttle - steeringLeft;
  let right = throttle + steeringLeft;
  const maxMag = Math.max(1, Math.abs(left), Math.abs(right));
  return {
    left: clamp(left / maxMag),
    right: clamp(right / maxMag),
  };
}

export function keyboardTrackCommands(keys: KeyboardKeys, tuning: ControlTuning): TrackCommands {
  const { throttle, steering } = resolveKeyboardAxes(keys);
  const scaledThrottle = throttle * (throttle < 0 ? tuning.reverseSensitivity : tuning.forwardSensitivity);
  const isPivot = throttle === 0 && steering !== 0;
  const steerSensitivity = isPivot ? tuning.pivotSensitivity : tuning.steeringSensitivity;
  return mixThrottleSteering(scaledThrottle, steering * steerSensitivity);
}

export function pivotTrackCommands(turnRight: boolean, tuning: ControlTuning): TrackCommands {
  const steer = turnRight ? -tuning.pivotSensitivity : tuning.pivotSensitivity;
  return mixThrottleSteering(0, steer);
}
