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
  Low: { forwardSensitivity: .7, reverseSensitivity: .7, steeringSensitivity: .55, pivotSensitivity: .38, acceleration: 7.5, braking: 9, steeringResponse: 12, maxSpeed: 5.2, maxRotation: .8 },
  Medium: { forwardSensitivity: 1, reverseSensitivity: 1, steeringSensitivity: .75, pivotSensitivity: .48, acceleration: 10, braking: 9.2, steeringResponse: 14, maxSpeed: 7.2, maxRotation: 1.15 },
  High: { forwardSensitivity: 1.2, reverseSensitivity: 1.1, steeringSensitivity: .95, pivotSensitivity: .62, acceleration: 12, braking: 12, steeringResponse: 19, maxSpeed: 8.5, maxRotation: 1.6 },
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Keyboard owns both tracks while active; analog input resumes after key release. */
export function selectInputSource(keyboardActive: boolean, analogActive: boolean): InputSource {
  return keyboardActive ? 'keyboard' : analogActive ? 'joystick' : 'neutral';
}

/**
 * Opposing keys cancel on their own axis; they never leak another input source.
 * A always commands LEFT rotation (+1 steering yaw rate).
 * D (and alias B) always commands RIGHT rotation (-1 steering yaw rate).
 * Steering direction NEVER flips in reverse.
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
    // Keep requested D mapping and accept B as a right-turn alias.
    right: codes.has('KeyD') || codes.has('KeyB') || codes.has('ArrowRight'),
  };
}

/**
 * Standard differential mix:
 * vL = v - (omega * b / 2)
 * vR = v + (omega * b / 2)
 *
 * Positive steering (steeringLeft > 0, key 'A') reduces left track speed and increases right track speed,
 * causing the front of the vehicle to rotate LEFT.
 *
 * Negative steering (steeringLeft < 0, key 'D') increases left track speed and reduces right track speed,
 * causing the front of the vehicle to rotate RIGHT.
 *
 * In reverse (throttle < 0), A still keeps vR > vL so the front rotates left, and D keeps vL > vR so the front rotates right.
 * The outputs are normalized when exceeding limits without distorting the differential yaw direction.
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
