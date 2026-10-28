export type Vec2 = { x: number; z: number };
export type DriveState = { x: number; z: number; vx: number; vz: number; yaw: number; angular: number };
export type DriveConfig = { maxSpeed: number; motorAcceleration: number; braking: number; turnRate: number; turnResponse: number; gravity: number };
export type Surface = { grip: number; rollingResistance: number };

// Positive steering input is a right turn (D / right stick); negative is left (A / left stick).
export function mixDifferentialSteering(left: number, right: number, steerRight: number) {
  return {
    left: Math.max(-1, Math.min(1, left - steerRight * 0.75)),
    right: Math.max(-1, Math.min(1, right + steerRight * 0.75)),
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
) {
  const forward = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
  const rightAxis = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
  const trackMean = (left + right) * 0.5;
  const motorRequest = brake ? 0 : trackMean * config.motorAcceleration;
  const gradeDenom = 1 + slope.x * slope.x + slope.z * slope.z;
  const gravityX = -config.gravity * slope.x / gradeDenom;
  const gravityZ = -config.gravity * slope.z / gradeDenom;
  const normalGravity = config.gravity / Math.sqrt(gradeDenom);
  const tractionLimit = Math.max(0.05, surface.grip * normalGravity);
  const motorForce = Math.max(-tractionLimit, Math.min(tractionLimit, motorRequest));

  state.vx += gravityX * dt;
  state.vz += gravityZ * dt;
  let longitudinal = state.vx * forward.x + state.vz * forward.z;
  let lateral = state.vx * rightAxis.x + state.vz * rightAxis.z;
  longitudinal += motorForce * dt;

  // Tire/track friction opposes lateral drift up to the contact patch's grip limit.
  const lateralDemand = -lateral * 7.5;
  const lateralForce = Math.max(-tractionLimit, Math.min(tractionLimit, lateralDemand));
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

  const angularTarget = (left - right) * config.turnRate;
  const angularBlend = 1 - Math.exp(-config.turnResponse * dt);
  state.angular += (angularTarget - state.angular) * angularBlend;
  state.yaw += state.angular * dt;
  state.x += state.vx * dt;
  state.z += state.vz * dt;

  return {
    longitudinalSpeed: longitudinal,
    lateralSpeed: lateral,
    motorSlip: Math.abs(motorRequest) < 1e-5 ? 0 : 1 - Math.min(1, Math.abs(motorForce / motorRequest)),
    tractionLimit,
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
