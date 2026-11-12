export const DEFAULT_CAMERA_RETURN_DELAY_SEC = 2.5;
export const CAMERA_RETURN_RATE = 3.2;

export type CameraFreeLookState = {
  freeYaw: number;
  freePitch: number;
  distanceOffset: number;
  idleTimer: number;
};

export type CameraFreeLookStepInput = {
  lockedDeltaYaw?: number;
  lockedDeltaPitch?: number;
  dragDeltaYaw?: number;
  dragDeltaPitch?: number;
  wheelDeltaDistance?: number;
  keyDeltaYaw?: number;
  keyDeltaPitch?: number;
  keyDeltaDistance?: number;
  immediateReset?: boolean;
};

/** Wrap any angle in radians into (-PI, PI] so 360-degree camera loops return via the shortest arc. */
export function wrapSignedAngleRad(angle: number): number {
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function clampValue(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Steps Google-Maps-style 360-degree camera free-look and zoom offsets.
 * Both pointer-locked mouse look and wheel zoom temporarily offset the view around the robot,
 * then smoothly glide back to the default camera orientation after `DEFAULT_CAMERA_RETURN_DELAY_SEC`
 * of no look/zoom input.
 */
export function stepCameraFreeLook(
  state: CameraFreeLookState,
  dt: number,
  input: CameraFreeLookStepInput = {},
): CameraFreeLookState {
  if (input.immediateReset) {
    state.freeYaw = 0;
    state.freePitch = 0;
    state.distanceOffset = 0;
    state.idleTimer = 0;
    return state;
  }

  const dYaw = (input.lockedDeltaYaw ?? 0) + (input.dragDeltaYaw ?? 0) + (input.keyDeltaYaw ?? 0);
  const dPitch = (input.lockedDeltaPitch ?? 0) + (input.dragDeltaPitch ?? 0) + (input.keyDeltaPitch ?? 0);
  const dDist = (input.wheelDeltaDistance ?? 0) + (input.keyDeltaDistance ?? 0);

  const hasUserLookInput = Math.abs(dYaw) > 1e-7 || Math.abs(dPitch) > 1e-7 || Math.abs(dDist) > 1e-7;

  if (hasUserLookInput) {
    state.freeYaw = wrapSignedAngleRad(state.freeYaw + dYaw);
    state.freePitch = clampValue(state.freePitch + dPitch, -1.25, 1.25);
    state.distanceOffset = clampValue(state.distanceOffset + dDist, -4.2, 8.0);
    state.idleTimer = DEFAULT_CAMERA_RETURN_DELAY_SEC;
    return state;
  }

  const safeDt = Math.max(0, dt);
  if (state.idleTimer > 0) {
    state.idleTimer = Math.max(0, state.idleTimer - safeDt);
    return state;
  }

  // Shortest-arc auto-return back to default camera yaw, pitch, and zoom distance
  const decay = Math.exp(-safeDt * CAMERA_RETURN_RATE);
  state.freeYaw = wrapSignedAngleRad(state.freeYaw) * decay;
  state.freePitch *= decay;
  state.distanceOffset *= decay;

  if (Math.abs(state.freeYaw) < 0.0005) state.freeYaw = 0;
  if (Math.abs(state.freePitch) < 0.0005) state.freePitch = 0;
  if (Math.abs(state.distanceOffset) < 0.001) state.distanceOffset = 0;

  return state;
}
