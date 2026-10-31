export type KeyboardKeys = {
  forward: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
};

export type TrackCommands = { left: number; right: number };
export type InputSource = 'keyboard' | 'joystick' | 'gamepad' | 'transmitter' | 'touch' | 'mouse' | 'neutral';

/**
 * Authoritative Canonical Drive Input Standard across all input devices:
 * - throttle: -1.0 (full reverse) to +1.0 (full forward), 0 neutral.
 * - steering: +1.0 (full LEFT) to -1.0 (full RIGHT), 0 neutral.
 * - brake: 0.0 (released) to 1.0 (fully engaged).
 */
export interface NormalizedDriveInput {
  throttle: number;       // -1 reverse, +1 forward
  steering: number;       // -1 right, +1 left
  brake: number;          // 0 to 1
  emergencyStop: boolean;
  source: InputSource;
  deviceName: string;
  valid: boolean;
}

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
 * Resolves keyboard input axes to canonical semantic values:
 * - throttle: +1 for W / ArrowUp (Forward), -1 for S / ArrowDown (Reverse), 0 if opposing (W+S) or neither.
 * - steering: +1 for A / ArrowLeft (Turn Front Left), -1 for T / D / B / ArrowRight (Turn Front Right), 0 if opposing (A+T, A+D) or neither.
 * Opposing keys on either axis cancel each other out safely to neutral.
 */
export function resolveKeyboardAxes(keys: KeyboardKeys) {
  return {
    throttle: keys.forward === keys.reverse ? 0 : keys.forward ? 1 : -1,
    steering: keys.left === keys.right ? 0 : keys.left ? 1 : -1,
  };
}

/**
 * Maps raw physical keyboard scan codes to driving keys:
 * - W, ArrowUp: Forward
 * - S, ArrowDown: Reverse
 * - A, ArrowLeft: Turn front LEFT
 * - T: Turn front RIGHT (primary required key)
 * - D, KeyB, ArrowRight: Turn front RIGHT (compatibility aliases)
 */
export function keyboardKeysFromCodes(codes: ReadonlySet<string>): KeyboardKeys {
  return {
    forward: codes.has('KeyW') || codes.has('ArrowUp'),
    reverse: codes.has('KeyS') || codes.has('ArrowDown'),
    left: codes.has('KeyA') || codes.has('ArrowLeft'),
    right: codes.has('KeyT') || codes.has('KeyD') || codes.has('KeyB') || codes.has('ArrowRight'),
  };
}

/**
 * Canonical differential-track mixing:
 * vL = v - (s * k)
 * vR = v + (s * k)
 *
 * Where:
 * - v = signed throttle (-1 reverse to +1 forward)
 * - s = canonical semantic steering (+1 LEFT, -1 RIGHT)
 * - k = steering mixing strength
 *
 * Physical behaviour:
 * - s > 0 (LEFT): vL < vR. Right track is faster forward (or less reverse), rotating the front LEFT.
 * - s < 0 (RIGHT): vL > vR. Left track is faster forward (or less reverse), rotating the front RIGHT.
 * - In reverse (v < 0): Front still rotates in the requested steering direction without inversion!
 */
export function mixThrottleSteering(throttle: number, semanticSteering: number, mixStrength = 1.0): TrackCommands {
  let left = throttle - semanticSteering * mixStrength;
  let right = throttle + semanticSteering * mixStrength;
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
  return mixThrottleSteering(scaledThrottle, steering, steerSensitivity);
}

export function pivotTrackCommands(turnRight: boolean, tuning: ControlTuning): TrackCommands {
  const steer = turnRight ? -1 : 1;
  return mixThrottleSteering(0, steer, tuning.pivotSensitivity);
}
