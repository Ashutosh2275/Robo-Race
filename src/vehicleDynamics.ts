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
// The vehicle root is positioned at the centre of its four contact probes.
// Visual belt geometry extends 0.12 m below that root; its lower skin is the
// actual support plane on flat ground, not a cosmetic shadow offset.
export const TRACK_CONTACT_OFFSET = 0.12;
export const ROBOT_HALF_WIDTH = TRACK_WIDTH / 2 + 0.20; // includes yellow cover envelope
export const ROBOT_HALF_LENGTH = TRACK_LENGTH / 2;
export const ROBOT_COLLISION_HEIGHT = 1.06; // conservative top envelope incl. antenna

/** World-axis half extents for the oriented robot footprint. */
export function getFootprintAabbHalfExtents(yaw: number) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return {
    x: ROBOT_HALF_WIDTH * c + ROBOT_HALF_LENGTH * s,
    z: ROBOT_HALF_WIDTH * s + ROBOT_HALF_LENGTH * c,
  };
}
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
  const targetY = avgGroundH - TRACK_CONTACT_OFFSET;

  // Compute terrain slope pitch and roll under the vehicle
  const frontH = (hFL + hFR) * 0.5;
  const rearH = (hRL + hRR) * 0.5;
  const leftH = (hFL + hRL) * 0.5;
  const rightH = (hFR + hRR) * 0.5;

  const groundPitch = -Math.atan2(frontH - rearH, TRACK_LENGTH);
  const groundRoll = Math.atan2(rightH - leftH, TRACK_WIDTH);
  // A tracked chassis has very little suspension roll. Keep only a barely
  // perceptible lateral load cue; the former 0.16 rad bank made it look like
  // the robot was hovering and swinging like an aircraft during pivots.
  const turnBank = Math.max(-0.025, Math.min(0.025, -angularYaw * longitudinalSpeed / gravity * 0.035));

  // Check if currently upside down
  const inverted = isVehicleInverted(pose.pitch, pose.roll);
  if (inverted) {
    pose.isFlipped = true;
    pose.isGrounded = true;
    pose.vy = 0;
    pose.flippedTimer += dt;
    // When upside down, vehicle rests on top of chassis / track covers
    const restingY = avgGroundH + CHASSIS_HEIGHT - TRACK_CONTACT_OFFSET + 0.05;
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
    const rollError = groundRoll + turnBank - pose.roll;
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

  // Check again if newly inverted
  if (isVehicleInverted(pose.pitch, pose.roll)) {
    pose.isFlipped = true;
    pose.flippedTimer = 0.01;
  } else {
    pose.isFlipped = false;
    pose.flippedTimer = 0;
  }

  // Follow ramps smoothly while supported. Leaving a raised road produces a
  // real gravity-driven drop to the lower arena floor instead of snapping the
  // chassis directly to the next sampled height.
  if (targetY < pose.y - 0.06) {
    pose.isGrounded = false;
    pose.vy -= gravity * dt;
    pose.y += pose.vy * dt;
    if (pose.y <= targetY) {
      pose.y = targetY;
      pose.vy = 0;
      pose.isGrounded = true;
    }
  } else {
    pose.isGrounded = true;
    pose.vy = 0;
    pose.y += (targetY - pose.y) * Math.min(1, dt * 12);
  }
}

/**
 * Creates a predefined list of safe recovery anchors along the circuit.
 */
export function createDefaultRecoveryAnchors(scale = 1.3): RecoveryAnchor[] {
  return [
    // Stage behind the gantry, so the frame does not sit between the chase
    // camera and the robot when the race begins.
    { id: 'start', label: 'Starting Bay', x: -16.4 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 0 },
    // Rewind recovery to the next still-required obstacle section, so a reset
    // cannot teleport past the slalom or its speed breakers.
    { id: 'slalom', label: 'Slalom Entry', x: -12.0 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 1 },
    { id: 'speedbreaker_entry', label: 'Speed Breaker Entry', x: -0.5 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 2 },
    { id: 'ramp_entry', label: 'Ramp Approach', x: 3.4 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 3 },
    { id: 'bridge_entry', label: 'Bridge Approach', x: 7.2 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 4 },
    { id: 'bridge_exit', label: 'Bridge Landing', x: 13.0 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.atan2(3.6, -3.3), checkpointIndex: 5 },
    { id: 'disc_exit', label: 'Platform Transition', x: 11.8 * scale, z: 3.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.atan2(-2.55, -4.6), checkpointIndex: 6 },
    { id: 'mixed_terrain', label: 'Mixed Terrain Run', x: 2.0 * scale, z: 0.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: -Math.PI / 2, checkpointIndex: 7 },
    { id: 'hazard_entry', label: 'Technical Hazard Approach', x: -1.6 * scale, z: -2.4 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.atan2(-4.5, -4.0), checkpointIndex: 8 },
    { id: 'hairpins', label: 'Parallel Plank Entry', x: -12.6 * scale, z: -8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 9 },
    { id: 'finish_straight', label: 'Final Straight', x: -8.0 * scale, z: -11.9 * scale, y: -TRACK_CONTACT_OFFSET, yaw: -Math.PI / 2, checkpointIndex: 10 },
  ];
}

/**
 * Finds the most relevant recovery anchor for the vehicle's progress.
 */
export function getSafeRecoveryAnchor(
  checkpointIndex: number,
  anchors: RecoveryAnchor[],
  isClear: (anchor: RecoveryAnchor) => boolean = () => true,
): RecoveryAnchor | null {
  // Find the latest checkpoint anchor that also has an unobstructed footprint.
  for (let i = anchors.length - 1; i >= 0; i--) {
    const anchor = anchors[i];
    if (anchor.checkpointIndex <= checkpointIndex && isClear(anchor)) return anchor;
  }
  return null;
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
  pose.y = groundY - TRACK_CONTACT_OFFSET;
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
