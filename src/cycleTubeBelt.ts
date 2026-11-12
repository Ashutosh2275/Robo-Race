export const CYCLE_TUBE_WHEEL_Z = 0.58;
export const CYCLE_TUBE_WHEEL_Y = 0.32;
export const CYCLE_TUBE_WHEEL_RADIUS = 0.198;
export const CYCLE_TUBE_SPAN_LEN = CYCLE_TUBE_WHEEL_Z * 2;
export const CYCLE_TUBE_LOOP_LENGTH =
  CYCLE_TUBE_SPAN_LEN * 2 + Math.PI * 2 * CYCLE_TUBE_WHEEL_RADIUS;

export type CycleTubeSampleOptions = {
  /** Mid-span catenary sag on the upper return run (meters). Default ~0.042m for curved cycle tube silhouette. */
  upperSagM?: number;
  /** Subtle elastic arch on the lower span between front and rear corner wheels (meters). */
  lowerArchM?: number;
  /** Dynamic elastomeric whip / flutter phase & amplitude while spinning or slipping. */
  whipPhase?: number;
  whipAmpM?: number;
  /** Normalized lateral tracking drift (-1..1 seated; >= 1 slipped off wheel rim). */
  lateralDrift?: number;
  /** True when the cycle-tube belt has come off the corner pulley wheels. */
  derailed?: boolean;
  /** -1 left belt, +1 right belt. */
  sideSign?: -1 | 1;
};

export type CycleTubeSample = {
  x: number;
  y: number;
  z: number;
  ny: number;
  nz: number;
  rotationX: number;
  rollX: number;
};

/**
 * Samples position and surface normal along a curved endless bicycle inner-tube belt
 * wrapped around two exposed corner pulley wheels (z = -0.58 and z = +0.58).
 * Unlike rigid steel tank tracks, the free spans follow a smooth elastomeric curve
 * and physically displace/skew off the wheel seat if the belt slips out of place.
 */
export function sampleCycleTubeLoop(
  distance: number,
  options: CycleTubeSampleOptions = {},
): CycleTubeSample {
  const s = ((distance % CYCLE_TUBE_LOOP_LENGTH) + CYCLE_TUBE_LOOP_LENGTH) % CYCLE_TUBE_LOOP_LENGTH;
  const r = CYCLE_TUBE_WHEEL_RADIUS;
  const wheelY = CYCLE_TUBE_WHEEL_Y;
  const wz = CYCLE_TUBE_WHEEL_Z;
  const arcHalf = Math.PI * r;

  const derailed = !!options.derailed;
  const sideSign = options.sideSign ?? 1;
  const upperSagM = options.upperSagM ?? (derailed ? 0.095 : 0.044);
  const lowerArchM = options.lowerArchM ?? (derailed ? 0.032 : 0.015);
  const whipPhase = options.whipPhase ?? 0;
  const whipAmpM = options.whipAmpM ?? 0;
  const drift = options.lateralDrift ?? 0;

  let y: number;
  let z: number;
  let tangentY: number;
  let tangentZ: number;
  let spanDrop = 0;

  if (s < CYCLE_TUBE_SPAN_LEN) {
    // Top unsupported cycle-tube span (-wz -> +wz): visibly bowed/curved downward
    const u = s / CYCLE_TUBE_SPAN_LEN;
    const bell = Math.sin(Math.PI * u);
    const wave = Math.sin(u * Math.PI * 2 + whipPhase) * whipAmpM * bell;
    const dip = upperSagM * Math.pow(bell, 1.15) - wave;
    // Derivative d(dip)/du for smooth cleat/mesh surface tangent alignment
    const dBellDu = Math.PI * Math.cos(Math.PI * u);
    const dDipDu =
      upperSagM * 1.15 * Math.pow(Math.max(1e-5, bell), 0.15) * dBellDu -
      Math.cos(u * Math.PI * 2 + whipPhase) * Math.PI * 2 * whipAmpM * bell -
      Math.sin(u * Math.PI * 2 + whipPhase) * whipAmpM * dBellDu;
    const dyDz = -dDipDu / CYCLE_TUBE_SPAN_LEN;

    z = -wz + s;
    y = wheelY + r - dip;
    tangentZ = 1;
    tangentY = dyDz;
    spanDrop = bell;
  } else if (s < CYCLE_TUBE_SPAN_LEN + arcHalf) {
    // Front corner pulley wrap
    const angle = Math.PI / 2 - (s - CYCLE_TUBE_SPAN_LEN) / r;
    z = wz + Math.cos(angle) * r;
    y = wheelY + Math.sin(angle) * r;
    tangentY = -Math.cos(angle);
    tangentZ = Math.sin(angle);
  } else if (s < CYCLE_TUBE_SPAN_LEN * 2 + arcHalf) {
    // Bottom span (+wz -> -wz): hugs wheels and flexes softly upward between wheel footprints
    const u = (s - CYCLE_TUBE_SPAN_LEN - arcHalf) / CYCLE_TUBE_SPAN_LEN;
    const bell = Math.sin(Math.PI * u);
    const arch = lowerArchM * bell;
    const dArchDz = -(lowerArchM * Math.PI * Math.cos(Math.PI * u)) / CYCLE_TUBE_SPAN_LEN;

    z = wz - u * CYCLE_TUBE_SPAN_LEN;
    y = wheelY - r + arch;
    tangentZ = -1;
    tangentY = -dArchDz;
    spanDrop = bell * 0.65;
  } else {
    // Rear corner pulley wrap
    const u = s - CYCLE_TUBE_SPAN_LEN * 2 - arcHalf;
    const angle = -Math.PI / 2 - u / r;
    z = -wz + Math.cos(angle) * r;
    y = wheelY + Math.sin(angle) * r;
    tangentY = -Math.cos(angle);
    tangentZ = Math.sin(angle);
  }

  const tLen = Math.hypot(tangentY, tangentZ) || 1;
  tangentY /= tLen;
  tangentZ /= tLen;

  // Normal points outward from belt loop center: rotate (tangentY, tangentZ)
  const ny = tangentZ;
  const nz = -tangentY;

  // Lateral displacement: subtle pulley tracking drift while seated, dramatic walk-off when derailed
  const longitudinalBias = 0.5 + 0.5 * (z / (wz + r));
  let xOffset = drift * 0.045;
  let rollX = drift * 0.06;
  if (derailed) {
    const droop = 0.036 * spanDrop + 0.018 * longitudinalBias;
    xOffset = sideSign * (0.195 + 0.055 * longitudinalBias);
    y = Math.max(0.11, y - droop);
    rollX = sideSign * (0.28 + 0.07 * Math.sin(z * 2.4 + whipPhase));
  }

  return {
    x: xOffset,
    y,
    z,
    ny,
    nz,
    rotationX: Math.atan2(-tangentY, tangentZ),
    rollX,
  };
}

export type BeltTrackingState = {
  leftDrift: number;
  rightDrift: number;
  leftDerailed: boolean;
  rightDerailed: boolean;
  derailStressCooldown: number;
};

export function createInitialBeltTrackingState(): BeltTrackingState {
  return {
    leftDrift: 0,
    rightDrift: 0,
    leftDerailed: false,
    rightDerailed: false,
    derailStressCooldown: 0,
  };
}

export type BeltTrackingStepInput = {
  leftTrackSpeed: number;
  rightTrackSpeed: number;
  motorSlip: number;
  asymmetricRockDiffM: number;
  lateralSpeedMps: number;
  impactImpulse: number;
  leftTrackIntegrity: number;
  rightTrackIntegrity: number;
  waterDepthM: number;
};

/**
 * Advances lateral cycle-tube belt tracking drift on front/rear pulleys.
 * Normal smooth driving self-centers on crowned pulleys; severe rock snags,
 * heavy slams, extreme lateral spin scrub, or heat-weakened tubes can walk a belt off its wheel.
 */
export function stepBeltTrackingState(
  state: BeltTrackingState,
  input: BeltTrackingStepInput,
  dt: number,
): { newlyDerailed: ('left' | 'right')[] } {
  const newlyDerailed: ('left' | 'right')[] = [];
  const safeDt = Math.max(0, Math.min(0.1, dt));
  state.derailStressCooldown = Math.max(0, state.derailStressCooldown - safeDt);

  const avgSpeed = 0.5 * Math.abs(input.leftTrackSpeed + input.rightTrackSpeed);
  const diffCmd = input.leftTrackSpeed - input.rightTrackSpeed;
  const pivotSpin = Math.abs(diffCmd);

  // Lateral scrub factor increases with high differential speed, side slide, wet/muddy belts, and low integrity
  const wetFactor = input.waterDepthM > 0.08 ? 1.35 : 1.0;
  const scrubForce =
    Math.max(0, Math.abs(input.lateralSpeedMps) - 1.35) * 0.24 +
    Math.max(0, pivotSpin - 4.2) * 0.14 +
    Math.max(0, Math.abs(input.asymmetricRockDiffM) - 0.10) * 1.15;

  const updateSide = (side: 'left' | 'right', trackSpeed: number, integrity: number, sideShockBias: number) => {
    const isDerailed = side === 'left' ? state.leftDerailed : state.rightDerailed;
    if (isDerailed) return;

    let drift = side === 'left' ? state.leftDrift : state.rightDrift;
    const integrityFactor = 1.0 + Math.max(0, 88 - integrity) * 0.032;

    // Straight smooth rolling gently re-centers crowned pulley belts
    const selfCenterRate = avgSpeed > 0.2 && scrubForce < 0.08 ? 0.55 : 0.12;
    drift *= Math.exp(-safeDt * selfCenterRate);

    // Cumulative lateral force from cornering scrub, rock tilt, motor slip & sharp impacts
    const steerPush = (side === 'left' ? 1 : -1) * Math.sign(diffCmd || 1) * (scrubForce + input.motorSlip * 0.18);
    const impactPush = input.impactImpulse > 4.0 ? sideShockBias * (input.impactImpulse - 4.0) * 0.11 : 0;

    drift += (steerPush * wetFactor * integrityFactor * safeDt) + impactPush * integrityFactor;

    // Slight natural damping when no shock occurred
    if (trackSpeed === 0 && input.impactImpulse <= 0) {
      drift *= Math.exp(-safeDt * 0.35);
    }

    if (Math.abs(drift) >= 1.0 && state.derailStressCooldown <= 0) {
      drift = Math.sign(drift) * 1.05;
      if (side === 'left') state.leftDerailed = true;
      else state.rightDerailed = true;
      state.derailStressCooldown = 1.5;
      newlyDerailed.push(side);
    }

    if (side === 'left') state.leftDrift = drift;
    else state.rightDrift = drift;
  };

  const rockBiasLeft = input.asymmetricRockDiffM >= 0 ? 1 : -0.6;
  const rockBiasRight = input.asymmetricRockDiffM < 0 ? -1 : 0.6;

  updateSide('left', input.leftTrackSpeed, input.leftTrackIntegrity, rockBiasLeft);
  updateSide('right', input.rightTrackSpeed, input.rightTrackIntegrity, rockBiasRight);

  return { newlyDerailed };
}
