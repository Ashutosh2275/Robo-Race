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
  /** Time a track edge has remained unsupported; filters one-frame terrain seams. */
  sideDropTime?: number;
  endDropTime?: number;
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

export type StaticBarrierFootprint = { x: number; z: number; hx: number; hz: number; rot?: number };

/**
 * Separating-axis collision test between the robot's oriented footprint and
 * a rotated rectangular barrier. Returns the smallest safe depenetration
 * direction, or null when the two shapes are clear.
 */
export function vehicleBarrierPenetration(
  x: number,
  z: number,
  yaw: number,
  barrier: StaticBarrierFootprint,
) {
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const obstacleX = { x: Math.cos(barrier.rot ?? 0), z: -Math.sin(barrier.rot ?? 0) };
  const obstacleZ = { x: Math.sin(barrier.rot ?? 0), z: Math.cos(barrier.rot ?? 0) };
  const dx = x - barrier.x;
  const dz = z - barrier.z;
  let minimumOverlap = Infinity;
  let normalX = 0;
  let normalZ = 0;

  for (const axis of [forward, right, obstacleX, obstacleZ]) {
    const vehicleRadius = Math.abs(axis.x * forward.x + axis.z * forward.z) * ROBOT_HALF_LENGTH
      + Math.abs(axis.x * right.x + axis.z * right.z) * ROBOT_HALF_WIDTH;
    const obstacleRadius = Math.abs(axis.x * obstacleX.x + axis.z * obstacleX.z) * barrier.hx
      + Math.abs(axis.x * obstacleZ.x + axis.z * obstacleZ.z) * barrier.hz;
    const signedDistance = dx * axis.x + dz * axis.z;
    const overlap = vehicleRadius + obstacleRadius - Math.abs(signedDistance);
    if (overlap <= 0) return null;
    if (overlap < minimumOverlap) {
      minimumOverlap = overlap;
      const sign = signedDistance >= 0 ? 1 : -1;
      normalX = axis.x * sign;
      normalZ = axis.z * sign;
    }
  }

  return { nx: normalX, nz: normalZ, depth: minimumOverlap };
}

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
  const rawGroundRoll = Math.atan2(rightH - leftH, TRACK_WIDTH);
  const centerH = heightAt(pose.x, pose.z);
  const rollDifferential = Math.abs(rightH - leftH);
  const pitchDifferential = Math.abs(frontH - rearH);

  // 1. True cliff-edge detection:
  // On continuous slopes and ramps, the terrain smoothly supports both tracks,
  // so the center height matches the midpoint of the tracks: |centerH - avgH| ~ 0.
  // A true cliff edge drop-off has a sharp discontinuous step: one track hangs
  // over empty air while the center remains on the deck.
  const isCliffStep = Math.abs(centerH - (leftH + rightH) * 0.5) > 0.10;
  const isCliffSideDrop = rollDifferential >= 0.70 && (isCliffStep || rollDifferential >= 0.75);
  const isCliffEndDrop = pitchDifferential >= 0.90;

  pose.sideDropTime = isCliffSideDrop ? (pose.sideDropTime ?? 0) + dt : 0;
  pose.endDropTime = isCliffEndDrop ? (pose.endDropTime ?? 0) + dt : 0;
  const sideDropActive = pose.sideDropTime >= 0.20;
  const endDropActive = pose.endDropTime >= 0.20;

  // On continuous slopes and banked terrain, ground roll cleanly matches the terrain.
  const groundRoll = isCliffSideDrop
    ? Math.max(-0.25, Math.min(0.25, rawGroundRoll))
    : rawGroundRoll;

  // Tracked differential vehicles have stiff suspension with subtle turn banking cues.
  const turnBank = Math.max(-0.015, Math.min(0.015, -angularYaw * longitudinalSpeed / gravity * 0.02));

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

  // Edge-drop tipping vs critically damped ground terrain tracking:
  if (sideDropActive) {
    const tipDir = rightH < leftH ? 1 : -1;
    pose.rollRate += tipDir * 4.8 * dt;
    pose.rollRate *= Math.exp(-dt * 0.4);
  } else {
    // Critically damped terrain following (omega_n = 16 rad/s, zeta = 1.0)
    const rollError = groundRoll + turnBank - pose.roll;
    pose.rollRate += (rollError * 32.0 - pose.rollRate * 12.0) * dt;
  }

  if (endDropActive) {
    const tipDir = frontH < rearH ? -1 : 1;
    pose.pitchRate += tipDir * 4.8 * dt;
    pose.pitchRate *= Math.exp(-dt * 0.4);
  } else {
    const pitchError = groundPitch - pose.pitch;
    pose.pitchRate += (pitchError * 32.0 - pose.pitchRate * 12.0) * dt;
  }

  // Integrate pitch and roll
  pose.pitch += pose.pitchRate * dt;
  pose.roll += pose.rollRate * dt;

  // Obstacle Reaction Yaw Torque ("broad twist" on boulders / asymmetric obstacles)
  // When one track encounters higher elevation on a discrete obstacle (rock/boulder), asymmetric ground
  // reaction drag retards that track, causing authentic physical yaw deflection ("broad twist").
  // CRITICAL DISTINCTION: Continuous planar ramps and slopes support both tracks linearly such that
  // centerH matches track midpoint: |centerH - avgH| < 0.012. Only discrete convex bumps (boulders)
  // deviate from planar slope and trigger physical drag deflection.
  const isConvexObstacle = Math.abs(centerH - (leftH + rightH) * 0.5) > 0.012;
  if (!pose.isFlipped && Math.abs(longitudinalSpeed) > 0.15 && rollDifferential > 0.025 && isConvexObstacle && !sideDropActive) {
    const obstacleTwist = -Math.sign(longitudinalSpeed) * (leftH - rightH) * 2.5;
    pose.yawRate = (pose.yawRate ?? 0) + (obstacleTwist - (pose.yawRate ?? 0)) * (1 - Math.exp(-dt * 6.0));
    pose.yaw += obstacleTwist * dt;
  }

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
    // Stage on the lower approach, before the steep entry ramp. This keeps
    // the complete track footprint on one level surface at race start.
    { id: 'start', label: 'Starting Bay', x: -22.3 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 0 },
    // Rewind recovery to the next still-required obstacle section, so a reset
    // cannot teleport past the slalom or its speed breakers.
    { id: 'slalom', label: 'Slalom Entry', x: -17.8 * scale, z: 8.0 * scale, y: -TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 1 },
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
  pose.sideDropTime = 0;
  pose.endDropTime = 0;
  pose.isFlipped = false;
  pose.flippedTimer = 0;
}

export type TurntableSurfaceState = {
  centerX: number;
  centerZ: number;
  radius: number;
  omega: number; // rad/s
};

/**
 * Returns rotation speed in rad/s configured by race difficulty.
 */
export function getTurntableOmega(difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Pro'): number {
  switch (difficulty) {
    case 'Beginner': return 0.28;      // ~2.7 RPM (stable, gentle rotation)
    case 'Intermediate': return 0.48;  // ~4.6 RPM (competition standard)
    case 'Advanced': return 0.75;      // ~7.2 RPM (challenging slip)
    case 'Pro': return 1.05;           // ~10.0 RPM (intense drift & centrifugal challenge)
  }
}

/**
 * Genuine physical interaction between the rotating platform and the robot chassis.
 * When on the platform:
 * 1. Deck rotation imparts linear tangential surface velocity via track contact friction.
 * 2. Asymmetric track surface speed creates genuine rotational torque aligning yaw heading.
 * 3. Centrifugal tendency exerts radial outward acceleration allowing authentic drift/slip.
 * 4. Rim bevel smoothly transitions friction coupling onto and off the platform without popping.
 */
export function applyTurntableSurfaceInteraction(
  robotWorldX: number,
  robotWorldZ: number,
  robotVx: number,
  robotVz: number,
  robotYaw: number,
  robotYawRate: number,
  turntable: TurntableSurfaceState,
  effectiveGrip: number,
  dt: number,
  mapScale = 1.3
) {
  const worldCenterX = turntable.centerX * mapScale;
  const worldCenterZ = turntable.centerZ * mapScale;
  const worldRadius = turntable.radius * mapScale;

  const dx = robotWorldX - worldCenterX;
  const dz = robotWorldZ - worldCenterZ;
  const dist = Math.hypot(dx, dz);

  if (dist > worldRadius) {
    return {
      vx: robotVx,
      vz: robotVz,
      yaw: robotYaw,
      yawRate: robotYawRate,
      onTurntable: false,
      surfaceSpeed: 0,
      centrifugalForce: 0,
    };
  }

  // Tangential surface velocity vector of the rotating platter at robot's contact point:
  // v_surf = omega x (p - c)
  // In world axes where +X is East and +Z is South:
  // With +Y rotation, a point at (+dx, +dz) moves with:
  // vSurfX = omega * dz
  // vSurfZ = -omega * dx
  const vSurfX = turntable.omega * dz;
  const vSurfZ = -turntable.omega * dx;
  const surfaceSpeed = Math.hypot(vSurfX, vSurfZ);

  // Smooth edge blend over outer 0.28m of the rim
  const blend = Math.max(0, Math.min(1, (worldRadius - dist) / 0.28));

  // 1. Linear friction drag coupling:
  // Surface friction pulls the robot tracks toward local deck velocity
  const linearCoupling = Math.min(1, 4.8 * effectiveGrip * blend * dt);
  const newVx = robotVx + (vSurfX - robotVx) * linearCoupling;
  const newVz = robotVz + (vSurfZ - robotVz) * linearCoupling;

  // 2. Rotational yaw torque coupling:
  // Rotating deck under the dual track contact patches imparts authentic rotational torque
  const yawCoupling = Math.min(1, 3.8 * effectiveGrip * blend * dt);
  const newYawRate = robotYawRate + (turntable.omega - robotYawRate) * yawCoupling;
  const newYaw = robotYaw + newYawRate * dt;

  // 3. Centrifugal outward radial acceleration:
  let finalVx = newVx;
  let finalVz = newVz;
  let centrifugalForce = 0;
  if (dist > 0.05) {
    const centrifugalA = (turntable.omega * turntable.omega) * dist;
    centrifugalForce = centrifugalA;
    const maxCentripetalA = effectiveGrip * 9.81;
    if (centrifugalA > maxCentripetalA * 0.40) {
      const slipA = (centrifugalA - maxCentripetalA * 0.40) * 0.38 * blend;
      finalVx += (dx / dist) * slipA * dt;
      finalVz += (dz / dist) * slipA * dt;
    }
  }

  return {
    vx: finalVx,
    vz: finalVz,
    yaw: newYaw,
    yawRate: newYawRate,
    onTurntable: true,
    surfaceSpeed,
    centrifugalForce,
  };
}
