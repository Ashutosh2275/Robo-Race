export type Vec3 = { x: number; y: number; z: number };

export type VehiclePose = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;      // local X tilt: nose up (> 0) / nose down (< 0)
  yaw: number;        // world Y heading: +Z forward, right turns increase yaw
  roll: number;       // local Z tilt: lean right (> 0) / lean left (< 0)
  pitchRate: number;  // rad/s
  yawRate: number;    // rad/s
  rollRate: number;   // rad/s
  isFlipped: boolean;
  isGrounded: boolean;
  flippedTimer: number;
};

export type RecoveryAnchor = {
  id: string;
  label: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
  checkpointIndex: number;
};

export const TRACK_WIDTH = 1.58;   // Center-to-center distance between tracks (meters)
export const TRACK_LENGTH = 1.70;  // Effective wheelbase / contact length (meters)
export const CHASSIS_HEIGHT = 0.52; // Height from ground to top of track covers (meters)
export const ROLLOVER_CRITICAL_ANGLE = 1.25; // ~72 degrees; beyond this, rollover occurs

/**
 * Calculates 4 contact patch locations in world space based on pose.
 */
export function getContactPatches(x: number, z: number, yaw: number) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const halfW = TRACK_WIDTH / 2;
  const halfL = TRACK_LENGTH / 2;

  // Local coordinates: forward is +Z, right is +X
  return {
    frontLeft: {
      x: x - halfW * cos + halfL * sin,
      z: z + halfW * sin + halfL * cos,
    },
    frontRight: {
      x: x + halfW * cos + halfL * sin,
      z: z - halfW * sin + halfL * cos,
    },
    rearLeft: {
      x: x - halfW * cos - halfL * sin,
      z: z + halfW * sin - halfL * cos,
    },
    rearRight: {
      x: x + halfW * cos - halfL * sin,
      z: z - halfW * sin - halfL * cos,
    },
  };
}

/**
 * Evaluates whether vehicle orientation is considered upside down / overturned.
 */
export function isVehicleInverted(pitch: number, roll: number): boolean {
  // If either pitch or roll exceeds 90 degrees (~1.57 rad), the vehicle is upside down
  const p = Math.abs(pitch);
  const r = Math.abs(roll);
  return r > 1.55 || p > 1.55;
}

/**
 * Updates 3D pitch and roll dynamics, accounting for ground slopes, drops, and rollover.
 */
export function stepVehicle3D(
  pose: VehiclePose,
  heightAt: (x: number, z: number) => number,
  longitudinalSpeed: number,
  angularYaw: number,
  dt: number,
  gravity = 9.81
) {
  const patches = getContactPatches(pose.x, pose.z, pose.yaw);
  const hFL = heightAt(patches.frontLeft.x, patches.frontLeft.z);
  const hFR = heightAt(patches.frontRight.x, patches.frontRight.z);
  const hRL = heightAt(patches.rearLeft.x, patches.rearLeft.z);
  const hRR = heightAt(patches.rearRight.x, patches.rearRight.z);

  const avgGroundH = (hFL + hFR + hRL + hRR) / 4;
  const targetY = avgGroundH + 0.14; // resting height above ground

  // Compute terrain slope pitch and roll under the vehicle
  const frontH = (hFL + hFR) * 0.5;
  const rearH = (hRL + hRR) * 0.5;
  const leftH = (hFL + hRL) * 0.5;
  const rightH = (hFR + hRR) * 0.5;

  const groundPitch = -Math.atan2(frontH - rearH, TRACK_LENGTH);
  const groundRoll = Math.atan2(rightH - leftH, TRACK_WIDTH);

  // Check if currently upside down
  const inverted = isVehicleInverted(pose.pitch, pose.roll);
  if (inverted) {
    pose.isFlipped = true;
    pose.flippedTimer += dt;
    // When upside down, vehicle rests on top of chassis / track covers
    const restingY = avgGroundH + CHASSIS_HEIGHT + 0.05;
    pose.y += (restingY - pose.y) * Math.min(1, dt * 10);
    // Damp angular rates while resting on roof
    pose.pitchRate *= Math.exp(-dt * 4);
    pose.rollRate *= Math.exp(-dt * 4);
    pose.pitch += pose.pitchRate * dt;
    pose.roll += pose.rollRate * dt;
    return;
  }

  // Not inverted: check for rollover tipping torques (e.g. driving off a bridge or severe bank)
  const rollDifferential = Math.abs(rightH - leftH);
  const pitchDifferential = Math.abs(frontH - rearH);

  // If one side has dropped off an elevated surface (> 0.38m step)
  if (rollDifferential > 0.38) {
    // Gravitational overturning torque around the supported edge
    const tipDir = rightH < leftH ? 1 : -1;
    pose.rollRate += tipDir * 9.5 * dt;
  } else {
    // Ground springs gently align roll with terrain
    const rollError = groundRoll - pose.roll;
    pose.rollRate += rollError * 22 * dt - pose.rollRate * 9 * dt;
  }

  if (pitchDifferential > 0.72) {
    const tipDir = frontH < rearH ? -1 : 1;
    pose.pitchRate += tipDir * 9.5 * dt;
  } else {
    const pitchError = groundPitch - pose.pitch;
    pose.pitchRate += pitchError * 22 * dt - pose.pitchRate * 9 * dt;
  }

  // Integrate pitch and roll
  pose.pitch += pose.pitchRate * dt;
  pose.roll += pose.rollRate * dt;

  // Centrifugal roll effect during high-speed turns
  const centrifugalRoll = -angularYaw * longitudinalSpeed * 0.022;
  pose.roll += centrifugalRoll * dt * 5;

  // Check again if newly inverted
  if (isVehicleInverted(pose.pitch, pose.roll)) {
    pose.isFlipped = true;
    pose.flippedTimer = 0.01;
  } else {
    pose.isFlipped = false;
    pose.flippedTimer = 0;
  }

  // Normal ground height following
  pose.y += (targetY - pose.y) * Math.min(1, dt * 12);
}

/**
 * Creates a predefined list of safe recovery anchors along the circuit.
 */
export function createDefaultRecoveryAnchors(scale = 1.3): RecoveryAnchor[] {
  return [
    { id: 'start', label: 'Starting Gate', x: -14.2 * scale, z: 8.0 * scale, y: 0.14, yaw: Math.PI / 2, checkpointIndex: 0 },
    { id: 'slalom', label: 'Post-Slalom Apron', x: -3.5 * scale, z: 8.0 * scale, y: 0.14, yaw: Math.PI / 2, checkpointIndex: 2 },
    { id: 'ramp_exit', label: 'Ramp Descent Landing', x: 6.8 * scale, z: 8.0 * scale, y: 0.14, yaw: Math.PI / 2, checkpointIndex: 3 },
    { id: 'bridge_entry', label: 'Bridge Approach', x: 7.2 * scale, z: 8.0 * scale, y: 0.14, yaw: Math.PI / 2, checkpointIndex: 4 },
    { id: 'bridge_exit', label: 'Bridge Landing', x: 12.3 * scale, z: 8.0 * scale, y: 0.14, yaw: Math.PI / 2, checkpointIndex: 5 },
    { id: 'disc_exit', label: 'Platform Transition', x: 8.5 * scale, z: 0.0 * scale, y: 0.14, yaw: -Math.PI / 2, checkpointIndex: 6 },
    { id: 'mixed_terrain', label: 'Mixed Terrain Run', x: 2.0 * scale, z: 0.0 * scale, y: 0.14, yaw: -Math.PI / 2, checkpointIndex: 7 },
    { id: 'hazard_entry', label: 'Technical Hazard Zone', x: -3.5 * scale, z: -4.0 * scale, y: 0.14, yaw: -Math.PI / 2, checkpointIndex: 8 },
    { id: 'hairpins', label: 'Hairpin Entry', x: -7.5 * scale, z: -6.0 * scale, y: 0.14, yaw: -Math.PI / 2, checkpointIndex: 9 },
    { id: 'finish_straight', label: 'Final Straight', x: -8.0 * scale, z: -12.0 * scale, y: 0.14, yaw: -Math.PI / 2, checkpointIndex: 10 },
  ];
}

/**
 * Finds the most relevant recovery anchor for the vehicle's progress.
 */
export function getSafeRecoveryAnchor(
  checkpointIndex: number,
  anchors: RecoveryAnchor[]
): RecoveryAnchor {
  // Find the anchor corresponding to the latest cleared checkpoint
  let chosen = anchors[0];
  for (const anchor of anchors) {
    if (anchor.checkpointIndex <= checkpointIndex) {
      chosen = anchor;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Recovers the vehicle to a safe upright state at the chosen anchor.
 */
export function applyRecovery(
  pose: VehiclePose,
  anchor: RecoveryAnchor,
  heightAt: (x: number, z: number) => number
) {
  const groundY = heightAt(anchor.x, anchor.z);
  pose.x = anchor.x;
  pose.z = anchor.z;
  pose.y = groundY + 0.14;
  pose.yaw = anchor.yaw;
  pose.pitch = 0;
  pose.roll = 0;
  pose.vx = 0;
  pose.vy = 0;
  pose.vz = 0;
  pose.pitchRate = 0;
  pose.yawRate = 0;
  pose.rollRate = 0;
  pose.isFlipped = false;
  pose.flippedTimer = 0;
}
