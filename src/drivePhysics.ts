export type Vec2 = { x: number; z: number };
export type DriveState = { x: number; z: number; vx: number; vz: number; yaw: number; angular: number };
export type DriveConfig = { maxSpeed: number; motorAcceleration: number; braking: number; turnRate: number; turnResponse: number; gravity: number; coastDeceleration?: number; motorTrackSpeed?: number };
export type Surface = {
  grip: number;
  rollingResistance: number;
  lateralGripMultiplier?: number;
  breakawayGrade?: number;
  kineticGrip?: number;
};

/**
 * Canonical differential-track mixing:
 * - Positive semantic steering (+1) is a LEFT turn.
 * - Negative semantic steering (-1) is a RIGHT turn.
 *
 * Formula:
 * vL = throttle - (steering * k)
 * vR = throttle + (steering * k)
 */
export function mixDifferentialSteering(
  arg1: number,
  arg2: number,
  arg3?: number
): { left: number; right: number } {
  let throttle: number;
  let steering: number;
  const k = 0.75;

  if (typeof arg3 === 'number') {
    // Called as (leftThrottle, rightThrottle, steering)
    throttle = (arg1 + arg2) * 0.5;
    steering = arg3;
  } else {
    // Called as (throttle, steering)
    throttle = arg1;
    steering = arg2;
  }

  let l = throttle - steering * k;
  let r = throttle + steering * k;
  const maxMag = Math.max(1, Math.abs(l), Math.abs(r));
  return {
    left: Math.max(-1, Math.min(1, l / maxMag)),
    right: Math.max(-1, Math.min(1, r / maxMag)),
  };
}

export function slopeAt(heightAt: (x: number, z: number) => number, x: number, z: number, step = 0.08): Vec2 {
  return {
    x: (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step),
    z: (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step),
  };
}

export function integrateDrive(
  state: DriveState,
  left: number,
  right: number,
  surface: Surface,
  slope: Vec2,
  config: DriveConfig,
  dt: number,
  brake = false,
  airborne = false,
) {
  const forward = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
  const rightAxis = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };

  // Pure Newtonian free-fall ballistics while airborne: zero horizontal ground traction, zero air steering.
  if (airborne) {
    const longitudinal = state.vx * forward.x + state.vz * forward.z;
    const lateral = state.vx * rightAxis.x + state.vz * rightAxis.z;
    state.angular *= Math.exp(-2.0 * dt);
    state.yaw += state.angular * dt;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    return {
      longitudinalSpeed: longitudinal,
      lateralSpeed: lateral,
      motorSlip: (Math.abs(left) + Math.abs(right)) * 0.5,
      tractionLimit: 0,
      trackSpeedLeft: brake ? 0 : left * (config.motorTrackSpeed ?? config.maxSpeed),
      trackSpeedRight: brake ? 0 : right * (config.motorTrackSpeed ?? config.maxSpeed),
    };
  }

  const trackMean = (left + right) * 0.5;
  const motorRequest = brake ? 0 : trackMean * config.motorAcceleration;
  const gradeDenom = 1 + slope.x * slope.x + slope.z * slope.z;
  const gravityX = -config.gravity * slope.x / gradeDenom;
  const gravityZ = -config.gravity * slope.z / gradeDenom;
  const normalGravity = config.gravity / Math.sqrt(gradeDenom);
  const uphillSinRatio = (slope.x * forward.x + slope.z * forward.z) / Math.sqrt(gradeDenom);
  const isBreakawaySlip = surface.breakawayGrade !== undefined
    && surface.kineticGrip !== undefined
    && uphillSinRatio > surface.breakawayGrade
    && trackMean > 0.15;
  const activeGrip = isBreakawaySlip ? surface.kineticGrip! : surface.grip;
  const tractionLimit = Math.max(0.05, activeGrip * normalGravity);
  // Each track has its own torque request and traction ceiling. A single weak
  // contact patch therefore slips without granting the other track unlimited grip.
  const leftRequest = brake ? 0 : left * config.motorAcceleration;
  const rightRequest = brake ? 0 : right * config.motorAcceleration;
  const leftForce = Math.max(-tractionLimit, Math.min(tractionLimit, leftRequest));
  const rightForce = Math.max(-tractionLimit, Math.min(tractionLimit, rightRequest));
  const motorForce = (leftForce + rightForce) * 0.5;

  state.vx += gravityX * dt;
  state.vz += gravityZ * dt;
  let longitudinal = state.vx * forward.x + state.vz * forward.z;
  let lateral = state.vx * rightAxis.x + state.vz * rightAxis.z;
  longitudinal += motorForce * dt;

  // The unpowered drive train and rubber tracks resist coasting. Keep this a
  // distinct, grip-limited force so a steep enough slope can still pull the
  // robot downhill and neutral input does not masquerade as a parking brake.
  if (!brake && Math.abs(left) + Math.abs(right) < 1e-5) {
    const coastLimit = Math.min(config.coastDeceleration ?? 2.7, tractionLimit);
    longitudinal += Math.max(-coastLimit, Math.min(coastLimit, -longitudinal)) * dt;
  }

  // Tire/track friction opposes lateral drift; tracked grouser edges may offer directional hold.
  const latMult = surface.lateralGripMultiplier ?? 1.0;
  const lateralTractionLimit = Math.max(0.05, surface.grip * latMult * normalGravity);
  const lateralDemand = -lateral * (7.5 * latMult);
  const lateralForce = Math.max(-lateralTractionLimit, Math.min(lateralTractionLimit, lateralDemand));
  lateral += lateralForce * dt;

  if (brake) {
    const velocity = Math.hypot(longitudinal, lateral);
    const brakeStep = Math.min(velocity, config.braking * dt);
    if (velocity > 1e-5) {
      longitudinal -= longitudinal / velocity * brakeStep;
      lateral -= lateral / velocity * brakeStep;
    }
  }

  const rolling = Math.max(0, surface.rollingResistance);
  const coastFactor = Math.exp(-rolling * dt);
  longitudinal *= coastFactor;
  lateral *= coastFactor;
  const maxSpeed = brake ? config.maxSpeed : config.maxSpeed;
  longitudinal = Math.max(-maxSpeed, Math.min(maxSpeed, longitudinal));
  state.vx = forward.x * longitudinal + rightAxis.x * lateral;
  state.vz = forward.z * longitudinal + rightAxis.z * lateral;

  // Canonical steering convention:
  // When the right belt is faster (rightForce > leftForce), the chassis rotates
  // ANTICLOCKWISE (nose turns left, yaw increases: +Delta yaw).
  // When the left belt is faster (leftForce > rightForce), the chassis rotates
  // CLOCKWISE (nose turns right, yaw decreases: -Delta yaw).
  // Yaw follows actual traction-limited force difference, so low-grip surfaces lose authority naturally.
  const angularLeftForce = isBreakawaySlip
    ? Math.max(-Math.max(0.05, surface.grip * normalGravity), Math.min(Math.max(0.05, surface.grip * normalGravity), leftRequest))
    : leftForce;
  const angularRightForce = isBreakawaySlip
    ? Math.max(-Math.max(0.05, surface.grip * normalGravity), Math.min(Math.max(0.05, surface.grip * normalGravity), rightRequest))
    : rightForce;
  const angularTarget = config.motorAcceleration > 0
    ? (angularRightForce - angularLeftForce) / config.motorAcceleration * config.turnRate
    : 0;
  const angularBlend = 1 - Math.exp(-config.turnResponse * dt);
  state.angular += (angularTarget - state.angular) * angularBlend;
  state.yaw += state.angular * dt;
  state.x += state.vx * dt;
  state.z += state.vz * dt;

  return {
    longitudinalSpeed: longitudinal,
    lateralSpeed: lateral,
    motorSlip: Math.max(
      Math.abs(leftRequest) < 1e-5 ? 0 : 1 - Math.min(1, Math.abs(leftForce / leftRequest)),
      Math.abs(rightRequest) < 1e-5 ? 0 : 1 - Math.min(1, Math.abs(rightForce / rightRequest)),
      Math.abs(motorRequest) < 1e-5 ? 0 : 1 - Math.min(1, Math.abs(motorForce / motorRequest)),
    ),
    tractionLimit,
    // Belt speed is motor-side speed, so it remains visible while the chassis
    // slips under a torque/traction limit. A locked neutral drivetrain leaves
    // the belts stationary even if the hull is sliding down a slope.
    trackSpeedLeft: brake ? 0 : left * (config.motorTrackSpeed ?? config.maxSpeed),
    trackSpeedRight: brake ? 0 : right * (config.motorTrackSpeed ?? config.maxSpeed),
  };
}

export function resolveWallVelocity(vx: number, vz: number, nx: number, nz: number, restitution = 0.08) {
  const intoWall = vx * nx + vz * nz;
  if (intoWall < 0) {
    vx -= (1 + restitution) * intoWall * nx;
    vz -= (1 + restitution) * intoWall * nz;
  }
  return { vx, vz };
}
