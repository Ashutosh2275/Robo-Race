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
  /** Transient vertical impact velocity (m/s) recorded on the frame the robot slams into a surface. */
  lastImpactSpeed?: number;
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

export type VerticalBarrierCollider = {
  id: string;
  x: number;
  z: number;
  hx: number;
  hz: number;
  y: number;
  height: number;
  rot?: number;
  walkable: boolean;
  underDeck?: boolean;
};

/**
 * Evaluates all non-walkable course colliders against the robot's 3D pose.
 * Standard barriers use a 0.20 m lower clearance tolerance so pitched/tilted
 * vehicles cannot clip curbs, whereas under-deck supports (`underDeck: true`)
 * yield once the robot tracks ride on or above the supported ramp/deck surface.
 */
export function evaluateBarrierCollision(
  x: number,
  z: number,
  yaw: number,
  y: number,
  colliders: readonly VerticalBarrierCollider[],
  mapScale: number,
): { id: string; nx: number; nz: number; depth: number } | null {
  const robotBottom = y + TRACK_CONTACT_OFFSET;
  const robotTop = y + ROBOT_COLLISION_HEIGHT;
  for (const c of colliders) {
    if (c.walkable) continue;
    const colliderTop = c.y + c.height / 2;
    const colliderBottom = c.y - c.height / 2;
    const lowerMargin = c.underDeck ? -0.04 : 0.20;
    if (colliderTop < robotBottom - lowerMargin || colliderBottom > robotTop + 0.20) continue;
    const hit = vehicleBarrierPenetration(x, z, yaw, {
      x: c.x * mapScale,
      z: c.z * mapScale,
      hx: c.hx * mapScale,
      hz: c.hz * mapScale,
      rot: c.rot,
    });
    if (hit) {
      return { id: c.id, ...hit };
    }
  }
  return null;
}

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
  gravity = 9.81,
  applyObstacleTwist = true
) {
  pose.lastImpactSpeed = 0;
  const patches = getContactPatches(pose.x, pose.z, pose.yaw);
  const rawFL = heightAt(patches.frontLeft.x, patches.frontLeft.z);
  const rawFR = heightAt(patches.frontRight.x, patches.frontRight.z);
  const rawRL = heightAt(patches.rearLeft.x, patches.rearLeft.z);
  const rawRR = heightAt(patches.rearRight.x, patches.rearRight.z);

  const rawFrontH = (rawFL + rawFR) * 0.5;
  const rawRearH = (rawRL + rawRR) * 0.5;
  const rawLeftH = (rawFL + rawRL) * 0.5;
  const rawRightH = (rawFR + rawRR) * 0.5;
  const centerH = heightAt(pose.x, pose.z);
  const rawRollDiff = Math.abs(rawRightH - rawLeftH);
  const rawPitchDiff = Math.abs(rawFrontH - rawRearH);

  // 1. True cliff-edge detection (evaluated cleanly on raw corner probes vs center belly):
  const isCliffStep = Math.abs(centerH - (rawLeftH + rawRightH) * 0.5) > 0.22;
  const isCliffSideDrop = rawRollDiff >= 0.75 && isCliffStep;
  const isCliffEndStep = Math.abs(centerH - (rawFrontH + rawRearH) * 0.5) > 0.28;
  const isCliffEndDrop = rawPitchDiff >= 1.15 && isCliffEndStep;

  // 2. Multi-station full-width continuous track & wheel envelope contact:
  // Samples 13 stations longitudinally AND across the 0.30m lateral width of each cycle-tube belt
  // so narrow/diagonal bars (rumble washboard, logs, boulders, stair edges) lift the wheel cleanly
  // without slicing into inner/outer tire rims or mid-span belt runs.
  let hFL = rawFL;
  let hFR = rawFR;
  let hRL = rawRL;
  let hRR = rawRR;
  let beltMidMaxL = (rawFL + rawRL) * 0.5;
  let beltMidMaxR = (rawFR + rawRR) * 0.5;
  let beltSamplesL: number[] | null = null;
  let beltSamplesR: number[] | null = null;
  const BELT_STATIONS = 12; // 13 stations (k = 0..12), ~0.14m spacing
  if (!isCliffSideDrop && !isCliffEndDrop) {
    const rightX = Math.cos(pose.yaw);
    const rightZ = -Math.sin(pose.yaw);
    const beltEdgeHalfW = 0.145;
    const sampleBeltWidth = (sx: number, sz: number) => {
      const hMid = heightAt(sx, sz);
      const hIn = heightAt(sx - rightX * beltEdgeHalfW, sz - rightZ * beltEdgeHalfW);
      const hOut = heightAt(sx + rightX * beltEdgeHalfW, sz + rightZ * beltEdgeHalfW);
      let h = hMid;
      // Only include drivable obstacle protrusions (<= 0.42m above belt centerline) so tall side walls do not pull robot upward
      if (hIn > h && hIn - hMid <= 0.42) h = hIn;
      if (hOut > h && hOut - hMid <= 0.42) h = hOut;
      return h;
    };
    const sampleBelt = (rear: { x: number; z: number }, front: { x: number; z: number }) => {
      const arr: number[] = [];
      for (let k = 0; k <= BELT_STATIONS; k++) {
        const f = k / BELT_STATIONS;
        arr.push(sampleBeltWidth(rear.x + (front.x - rear.x) * f, rear.z + (front.z - rear.z) * f));
      }
      const h0 = arr[0];
      const h1 = arr[BELT_STATIONS];
      const endMax = Math.max(h0, h1);
      let effRear = h0;
      let effFront = h1;
      for (let k = BELT_STATIONS - 3; k < BELT_STATIONS; k++) {
        if (arr[k] > endMax + 0.008) effFront = Math.max(effFront, arr[k]);
      }
      for (let k = 1; k <= 3; k++) {
        if (arr[k] > endMax + 0.008) effRear = Math.max(effRear, arr[k]);
      }
      let midRaise = 0;
      for (let k = 1; k < BELT_STATIONS; k++) {
        const f = k / BELT_STATIONS;
        const lineY = effRear + (effFront - effRear) * f;
        if (arr[k] > lineY + 0.004) {
          midRaise = Math.max(midRaise, arr[k] - lineY);
        }
      }
      return { rear: effRear + midRaise, front: effFront + midRaise, midH: arr[BELT_STATIONS / 2], all: arr };
    };

    const leftBelt = sampleBelt(patches.rearLeft, patches.frontLeft);
    const rightBelt = sampleBelt(patches.rearRight, patches.frontRight);
    hRL = leftBelt.rear;
    hFL = leftBelt.front;
    hRR = rightBelt.rear;
    hFR = rightBelt.front;
    beltMidMaxL = leftBelt.midH;
    beltMidMaxR = rightBelt.midH;
    beltSamplesL = leftBelt.all;
    beltSamplesR = rightBelt.all;
  }

  const avgGroundH = (hFL + hFR + hRL + hRR) / 4;
  const frontH = (hFL + hFR) * 0.5;
  const rearH = (hRL + hRR) * 0.5;
  const leftH = (hFL + hRL) * 0.5;
  const rightH = (hFR + hRR) * 0.5;

  const groundPitch = -Math.atan2(frontH - rearH, TRACK_LENGTH);
  const rawGroundRoll = Math.atan2(rightH - leftH, TRACK_WIDTH);
  const rollDifferential = Math.abs(rightH - leftH);
  const pitchDifferential = Math.abs(frontH - rearH);

  // Solid-deck non-penetration: when both the center belly AND at least one full track
  // rest on the same solid deck surface, prevent average-ground interpolation from sinking
  // the chassis straight through the deck when the outer track overhangs air.
  const maxTrackH = Math.max(leftH, rightH);
  const hasSolidDeckUnderCenter = Math.abs(maxTrackH - centerH) <= 0.15;

  // Non-coplanar 3-point rigid chassis support: when one diagonal pair (e.g. a single log corner)
  // rises above the best-fit 4-corner plane, lift center slightly so ZERO belt corner penetrates ground/logs.
  const cornerMaxPenetration = !isCliffSideDrop && !isCliffEndDrop
    ? Math.max(
        0,
        hFL - (avgGroundH + (frontH - rearH) * 0.5 + (leftH - rightH) * 0.5),
        hFR - (avgGroundH + (frontH - rearH) * 0.5 + (rightH - leftH) * 0.5),
        hRL - (avgGroundH + (rearH - frontH) * 0.5 + (leftH - rightH) * 0.5),
        hRR - (avgGroundH + (rearH - frontH) * 0.5 + (rightH - leftH) * 0.5),
      )
    : 0;

  // Continuous track belt support over convex mound/hump crests
  const midSupportH = (beltMidMaxL + beltMidMaxR) * 0.5;
  const isConvexBeltCrest = !isCliffSideDrop && !isCliffEndDrop
    && beltMidMaxL > leftH + 0.015
    && beltMidMaxR > rightH + 0.015;
  let effectiveGroundH = (isConvexBeltCrest ? Math.max(avgGroundH, midSupportH - 0.012) : avgGroundH) + cornerMaxPenetration;
  if (hasSolidDeckUnderCenter && centerH > avgGroundH + 0.12 && (pose.y + TRACK_CONTACT_OFFSET >= centerH - 0.16)) {
    effectiveGroundH = Math.max(effectiveGroundH, centerH - 0.10);
  }

  const seamWait = rollDifferential >= 1.10 ? 0.08 : 0.14;
  pose.sideDropTime = isCliffSideDrop ? (pose.sideDropTime ?? 0) + dt : 0;
  pose.endDropTime = isCliffEndDrop ? (pose.endDropTime ?? 0) + dt : 0;
  const sideDropActive = pose.sideDropTime >= seamWait;
  const endDropActive = pose.endDropTime >= 0.16;

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
    pose.flippedTimer += dt;
    // When upside down, fall under real gravity until roof contacts highest solid deck or floor below
    const invSurfaceH = (hasSolidDeckUnderCenter && centerH > avgGroundH && (pose.y + CHASSIS_HEIGHT >= centerH - 0.12))
      ? Math.max(avgGroundH, centerH)
      : avgGroundH;
    const restingY = invSurfaceH + CHASSIS_HEIGHT - TRACK_CONTACT_OFFSET + 0.05;
    if (pose.y > restingY + 0.04) {
      pose.isGrounded = false;
      pose.vy -= gravity * dt;
      pose.y += pose.vy * dt;
      if (pose.y <= restingY) {
        pose.lastImpactSpeed = Math.abs(pose.vy) * 1.35;
        pose.y = restingY;
        pose.vy = 0;
        pose.isGrounded = true;
      }
    } else {
      pose.isGrounded = true;
      pose.vy = 0;
      pose.y += (restingY - pose.y) * Math.min(1, dt * 10);
    }
    // Damp angular rates while resting on roof
    pose.pitchRate *= Math.exp(-dt * 4);
    pose.rollRate *= Math.exp(-dt * 4);
    pose.pitch += pose.pitchRate * dt;
    pose.roll += pose.rollRate * dt;
    return;
  }

  // Ground-normal contact pitch alignment: when the front or rear track presses into solid terrain
  // (e.g., slamming onto a flat bay from a steep ramp), contact reaction aligns pitch faster without bobbing.
  const pitchErr = groundPitch - pose.pitch;
  const rollErr = groundRoll + turnBank - pose.roll;
  const maxBeltLiftHint = Math.max(0, Math.abs(pitchErr) * (TRACK_LENGTH * 0.5));
  const pitchStiff = (!isCliffEndDrop && maxBeltLiftHint > 0.04) ? 680.0 : 280.0;
  const pitchDamp = (!isCliffEndDrop && maxBeltLiftHint > 0.04) ? 52.0 : 33.5;

  // Edge-drop tipping vs critically damped ground terrain tracking:
  if (sideDropActive) {
    const tipDir = rightH < leftH ? 1 : -1;
    // Rigid-body gravitational overturning torque around supported track edge: alpha ≈ g * (b / I) * cos(roll)
    const tipAlpha = Math.max(4.8, gravity * 0.85 * Math.cos(Math.min(1.35, Math.abs(pose.roll))));
    pose.rollRate += tipDir * tipAlpha * dt;
    pose.rollRate *= Math.exp(-dt * 0.35);
  } else {
    // Critically damped rigid track suspension (omega_n = 16.7 rad/s, zeta = 1.0)
    pose.rollRate += (rollErr * 280.0 - pose.rollRate * 33.5) * dt;
  }

  if (endDropActive) {
    const tipDir = frontH < rearH ? -1 : 1;
    const endAlpha = Math.max(4.8, gravity * 0.85 * Math.cos(Math.min(1.35, Math.abs(pose.pitch))));
    pose.pitchRate += tipDir * endAlpha * dt;
    pose.pitchRate *= Math.exp(-dt * 0.35);
  } else {
    pose.pitchRate += (pitchErr * pitchStiff - pose.pitchRate * pitchDamp) * dt;
  }

  // Integrate pitch and roll
  pose.pitch += pose.pitchRate * dt;
  pose.roll += pose.rollRate * dt;

  // Compute grounded height baseline enforcing strict non-penetration at every wheel, belt & spine station
  let targetY = effectiveGroundH - TRACK_CONTACT_OFFSET;
  if (!isCliffSideDrop && !isCliffEndDrop && beltSamplesL && beltSamplesR) {
    const halfPitchDrop = Math.sin(pose.pitch) * (TRACK_LENGTH * 0.5);
    const halfRollLift = Math.sin(pose.roll) * (TRACK_WIDTH * 0.5);
    let bumpClearLift = 0;
    const isNearDropLip = isCliffSideDrop || isCliffEndDrop
      || (centerH - Math.min(rawFL, rawFR, rawRL, rawRR) > 0.45 && Math.min(rawFL, rawFR, rawRL, rawRR) < -0.50);
    if (!isNearDropLip) {
      for (let k = 0; k <= BELT_STATIONS; k++) {
        const sU = (k / BELT_STATIONS - 0.5) * 2;
        const planeYL = effectiveGroundH - halfPitchDrop * sU - halfRollLift;
        const planeYR = effectiveGroundH - halfPitchDrop * sU + halfRollLift;
        bumpClearLift = Math.max(
          bumpClearLift,
          beltSamplesL[k] - planeYL,
          beltSamplesR[k] - planeYR,
        );
      }
      // Protect central 'I'-frame spine belly (0.27m bottom vs 0.12m belt bottom -> 0.15m clearance) over drivable
      // boulders/logs ONLY when at least one track rests near ground/obstacle level (never hold floating above bridge voids)
      const trackSupportedNearCenter = Math.max(leftH, rightH) >= centerH - 0.38;
      if (trackSupportedNearCenter) {
        const sinYaw = Math.sin(pose.yaw);
        const cosYaw = Math.cos(pose.yaw);
        for (const sU of [-0.55, 0, 0.55]) {
          const dz = sU * (TRACK_LENGTH * 0.5);
          const hSpine = heightAt(pose.x + dz * sinYaw, pose.z + dz * cosYaw);
          const planeYC = effectiveGroundH - halfPitchDrop * sU + 0.15;
          if (hSpine - centerH <= 0.38 && hSpine - Math.min(leftH, rightH) <= 0.38) {
            bumpClearLift = Math.max(bumpClearLift, hSpine - planeYC);
          }
        }
      }
    }
    targetY += bumpClearLift;
  }

  // Obstacle Reaction Yaw Torque ("broad twist" on boulders / asymmetric obstacles)
  // Guard: open voids/chasms below belly (centerH < lowest track) are gaps, never raised boulders.
  const isConvexObstacle = Math.abs(centerH - (leftH + rightH) * 0.5) > 0.035 && centerH >= Math.min(leftH, rightH) - 0.02;
  if (applyObstacleTwist && !pose.isFlipped && Math.abs(longitudinalSpeed) > 0.15 && rollDifferential > 0.025 && rollDifferential < 0.30 && isConvexObstacle && !sideDropActive) {
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
  const isDrivingSlope = !isCliffSideDrop
    && !isCliffEndDrop
    && Math.abs(centerH - avgGroundH) <= 0.14
    && (pitchDifferential >= 0.10 || rollDifferential >= 0.15)
    && Math.abs(longitudinalSpeed) > 0.2;
  const wasAirborne = !pose.isGrounded;
  const dropGap = pose.isGrounded
    ? (isDrivingSlope ? Math.min(0.36, 0.24 + Math.abs(longitudinalSpeed) * 0.025) : 0.16)
    : 0.02;
  if (targetY < pose.y - dropGap) {
    pose.isGrounded = false;
    pose.vy -= gravity * dt;
    pose.y += pose.vy * dt;
    if (pose.y <= targetY) {
      pose.lastImpactSpeed = Math.abs(pose.vy);
      pose.y = targetY;
      pose.vy = 0;
      pose.isGrounded = true;
    }
  } else {
    if (wasAirborne && pose.vy < -0.5) {
      pose.lastImpactSpeed = Math.abs(pose.vy);
    }
    pose.isGrounded = true;
    pose.vy = 0;
    // Solid surface contact: tracks follow continuous ramps rapidly without hovering or sinking
    if (pose.y < targetY) {
      pose.y = targetY;
    } else {
      pose.y += (targetY - pose.y) * Math.min(1, dt * 36);
    }
  }
}

/**
 * Creates a predefined list of safe recovery anchors along the circuit.
 */
export function createDefaultRecoveryAnchors(scale = 1.3): RecoveryAnchor[] {
  return [
    // 0: Start Bay (before Gate 01)
    { id: 'start', label: 'Starting Bay', x: -20.5 * scale, z: 13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 0 },
    // 1: After Gate 01 / Approaching Slaloms
    { id: 'slalom', label: 'Gate 01 - Start Straight', x: -16.5 * scale, z: 13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 1 },
    // 2: After Gate 02 (Slaloms Cleared) / Approaching Rock Field
    { id: 'speedbreaker_entry', label: 'Gate 02 - Slaloms Cleared', x: 5.0 * scale, z: 13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 2 },
    // 3: After Gate 03 (Rock Field Cleared) / Approaching Hairpin 1
    { id: 'rockfield_entry', label: 'Gate 03 - Rock Field Cleared', x: 15.5 * scale, z: 13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 3 },
    // 4: After Gate 04 (Technical Straight & Steel Cleared) / On Lane 3 approaching spiral
    { id: 'spiral_approach', label: 'Gate 04 - Technical Straight Cleared', x: -11.0 * scale, z: 0.00 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 4 },
    // 5: After Gate 05 (Spiral Summit Cleared) / On Summit Deck entry (y = 3.20m)
    { id: 'summit_entry', label: 'Gate 05 - Spiral Summit Cleared', x: -1.20 * scale, z: 0.00 * scale, y: 3.20 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 5 },
    // 6: After Gate 06 (Turntable Cleared) / At entry to descent ramp (y = 3.20m)
    { id: 'turntable_exit', label: 'Gate 06 - Turntable Cleared', x: 3.80 * scale, z: 0.00 * scale, y: 3.20 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 6 },
    // 7: After Gate 07 (Descent Ramp Cleared) / Lane 4 North Straight before Pendulum Gauntlet
    { id: 'north_straight', label: 'Gate 07 - Lane 4 Pendulum Entry', x: 17.05 * scale, z: -6.75 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: -Math.PI / 2, checkpointIndex: 7 },
    // 8: After Gate 08 (Pendulum Gauntlet Cleared) / Flat connecting bay before Suspension Bridges
    { id: 'suspension_approach', label: 'Gate 08 - Suspension Bridge Entry', x: 3.15 * scale, z: -6.75 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: -Math.PI / 2, checkpointIndex: 8 },
    // 9: After Gate 09 (Suspension Bridges Cleared) / Lane 4 West runway approaching Hairpin 4
    { id: 'fire_approach', label: 'Gate 09 - Suspension Bridges Cleared', x: -12.30 * scale, z: -6.75 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: -Math.PI / 2, checkpointIndex: 9 },
    // 10: After Gate 10 (Fire Hazard Cleared) / On cooling bridge approaching Water
    { id: 'cooling_bridge', label: 'Gate 10 - Fire Hazard Cleared', x: 0.20 * scale, z: -13.50 * scale, y: 0.05 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 10 },
    // 11: After Gate 11 (Deep Water Basin Cleared) / On finishing straight
    { id: 'finish_approach', label: 'Gate 11 - Deep Water Basin Cleared', x: 11.20 * scale, z: -13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 11 },
    // 12: Grand Finish Line
    { id: 'finish_line', label: 'Gate 12 - Grand Finish Line', x: 14.50 * scale, z: -13.50 * scale, y: -0.33 - TRACK_CONTACT_OFFSET, yaw: Math.PI / 2, checkpointIndex: 12 },
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
    case 'Beginner': return 0.20;      // ~1.9 RPM (smooth gentle rotation)
    case 'Intermediate': return 0.28;  // ~2.7 RPM (calibrated balanced drift)
    case 'Advanced': return 0.44;      // ~4.2 RPM (brisk counter-steering test)
    case 'Pro': return 0.90;           // ~8.6 RPM (high-rpm competitive challenge)
  }
}

/**
 * Genuine physical interaction between the rotating platform and the robot chassis.
 * When on the platform:
 * 1. Deck rotation imparts controlled tangential surface drift without stalling active track drive.
 * 2. Asymmetric track surface contact creates gentle rotational yaw torque matching turntable omega.
 * 3. Mild centrifugal outward drift occurs only under high-RPM offset rotation.
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

  // Smooth edge blend over outer 0.30m of the rim
  const blend = Math.max(0, Math.min(1, (worldRadius - dist) / 0.30));

  // 1. Controlled tangential friction carry without killing forward longitudinal velocity
  const linearCoupling = Math.min(1, 1.45 * effectiveGrip * blend * dt);
  const newVx = robotVx + (vSurfX - robotVx) * linearCoupling;
  const newVz = robotVz + (vSurfZ - robotVz) * linearCoupling;

  // 2. Smooth rotational yaw torque coupling
  const yawCoupling = Math.min(1, 1.65 * effectiveGrip * blend * dt);
  const newYawRate = robotYawRate + (turntable.omega - robotYawRate) * yawCoupling;
  const newYaw = robotYaw + newYawRate * dt;

  // 3. Gentler centrifugal outward radial drift (only noticeable at high omega / outer rim)
  let finalVx = newVx;
  let finalVz = newVz;
  let centrifugalForce = 0;
  if (dist > 0.05) {
    const centrifugalA = (turntable.omega * turntable.omega) * dist;
    centrifugalForce = centrifugalA;
    const maxCentripetalA = effectiveGrip * 9.81;
    if (centrifugalA > maxCentripetalA * 0.65) {
      const slipA = (centrifugalA - maxCentripetalA * 0.65) * 0.16 * blend;
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

export interface WaterPoolConfig {
  xMin: number;
  xMax: number;
  zCenter: number;
  width: number;
  waterLevelY: number; // 0.16m
  bedLevelY: number;   // -0.30m
}

export const WATER_POOLS: WaterPoolConfig[] = [
  // Lane 5: Mandatory Final Water Basin
  {
    xMin: 0.5,
    xMax: 9.5,
    zCenter: -13.50,
    width: 4.40,
    waterLevelY: 0.16,
    bedLevelY: -0.30,
  },
];

export const WATER_POOL_CONFIG: WaterPoolConfig = WATER_POOLS[0];

export interface WaterBuoyancyResult {
  inWater: boolean;
  immersionDepth: number;   // Submerged depth of tracks/hull in metres
  displacedVolume: number;  // Displaced water volume in m^3
  buoyantForce: number;     // Archimedes upward force in Newtons
  normalForceRatio: number; // Normal force scaling (0.06 to 1.0)
  isFloating: boolean;      // True when buoyant force offsets vehicle gravity
  effectiveGrip: number;    // Reduced traction due to flotation
  waterDragX: number;       // Hydrodynamic drag in X
  waterDragZ: number;       // Hydrodynamic drag in Z
  paddleThrustX: number;    // Track paddle wheel forward propulsion in X
  paddleThrustZ: number;    // Track paddle wheel forward propulsion in Z
  buoyantWaterlineY: number;// Floating equilibrium height
}

/**
 * Computes authentic Archimedes buoyancy, hydrodynamic drag, and track paddle thrust
 * when the vehicle enters and navigates the deep water basin.
 */
export function evaluateWaterBuoyancy(
  worldX: number,
  worldZ: number,
  worldY: number,
  yaw: number,
  vx: number,
  vz: number,
  leftTrackSpeed: number,
  rightTrackSpeed: number,
  baseGrip: number,
  mapScale = 1.3,
  pools: WaterPoolConfig[] = WATER_POOLS,
  hullMode: 'sealed' | 'open_rover' = 'sealed'
): WaterBuoyancyResult {
  const courseX = worldX / mapScale;
  const courseZ = worldZ / mapScale;

  let matchedPool: WaterPoolConfig | null = null;
  for (const pool of pools) {
    if (courseX >= pool.xMin && courseX <= pool.xMax && Math.abs(courseZ - pool.zCenter) <= pool.width / 2) {
      matchedPool = pool;
      break;
    }
  }

  if (!matchedPool) {
    return {
      inWater: false,
      immersionDepth: 0,
      displacedVolume: 0,
      buoyantForce: 0,
      normalForceRatio: 1.0,
      isFloating: false,
      effectiveGrip: baseGrip,
      waterDragX: 0,
      waterDragZ: 0,
      paddleThrustX: 0,
      paddleThrustZ: 0,
      buoyantWaterlineY: -999,
    };
  }

  // Immersion depth: distance from water surface down to track underside
  const trackUndersideY = worldY + TRACK_CONTACT_OFFSET;
  const immersionDepth = Math.max(0, matchedPool.waterLevelY - trackUndersideY);

  if (immersionDepth <= 0.01) {
    return {
      inWater: true,
      immersionDepth: 0,
      displacedVolume: 0,
      buoyantForce: 0,
      normalForceRatio: 1.0,
      isFloating: false,
      effectiveGrip: baseGrip,
      waterDragX: 0,
      waterDragZ: 0,
      paddleThrustX: 0,
      paddleThrustZ: 0,
      buoyantWaterlineY: -999,
    };
  }

  // Robot physical parameters
  const robotMass = 420; // kg
  const g = 9.81;
  const totalWeight = robotMass * g; // ~4120 N
  const isOpenRover = hullMode === 'open_rover';
  // Open-chassis rover only displaces sealed housings (~0.21 m^3) so it stays submerged inside the basin
  // rather than floating dry above the water surface; sealed hulls float at ~0.32m immersion.
  const sealedHullVolume = isOpenRover ? 0.21 : 0.58; // m^3

  // Displaced volume according to Archimedes principle: V = sealedVolume * (immersion / hullHeight)^1.15
  const immersionRatio = Math.min(1.0, immersionDepth / (isOpenRover ? 0.64 : 0.44));
  const displacedVolume = sealedHullVolume * Math.pow(immersionRatio, 1.15);

  // Buoyant upward force F_b = rho * V_disp * g (rho_water = 1000 kg/m^3)
  const buoyantForce = 1000 * displacedVolume * g;

  // Open rover stays negatively buoyant inside the tank and swims along the submerged floor & wade cleats
  const isFloating = !isOpenRover && buoyantForce >= totalWeight * 0.92;
  const buoyantWaterlineY = isFloating
    ? matchedPool.waterLevelY - 0.32 - TRACK_CONTACT_OFFSET
    : -999;

  // Normal force on bottom: F_N = max(0, totalWeight - buoyantForce)
  const effectiveNormal = Math.max(0, totalWeight - buoyantForce);
  const normalForceRatio = isOpenRover
    ? Math.max(0.50, effectiveNormal / totalWeight)
    : Math.max(0.06, effectiveNormal / totalWeight);

  // Submerged tracks experience reduced ground traction as weight is borne by water buoyancy
  const effectiveGrip = isOpenRover
    ? Math.max(0.46, baseGrip * (0.72 + 0.28 * normalForceRatio))
    : baseGrip * normalForceRatio;

  // Hydrodynamic viscous drag opposing horizontal velocity
  const speed = Math.hypot(vx, vz);
  const frontalArea = (isOpenRover ? 1.42 : 1.58) * Math.min(isOpenRover ? 0.68 : 0.44, immersionDepth);
  const cd = isOpenRover ? 0.96 : 0.85;
  const dragMagnitude = 0.5 * 1000 * cd * frontalArea * speed * speed + 1000 * 0.08 * speed;
  const waterDragX = speed > 0.01 ? -(vx / speed) * (dragMagnitude / robotMass) : 0;
  const waterDragZ = speed > 0.01 ? -(vz / speed) * (dragMagnitude / robotMass) : 0;

  // Track paddle thrust: spinning tracks in water displace water rearwards, generating forward paddle propulsion
  const avgTrackSpeed = 0.5 * (leftTrackSpeed + rightTrackSpeed);
  // Heading vector: in vehicle dynamics coordinates, forward is (sin(yaw), cos(yaw))
  const headingX = Math.sin(yaw);
  const headingZ = Math.cos(yaw);
  // Paddle thrust acceleration (submerged open-hull rover churns strong swimming thrust to climb out!)
  const paddleScale = isOpenRover ? 2.45 : 1.85;
  const paddleThrustMag = Math.sign(avgTrackSpeed) * Math.pow(Math.abs(avgTrackSpeed), 1.4) * paddleScale * Math.min(1.0, immersionDepth / 0.22);
  const paddleThrustX = headingX * paddleThrustMag;
  const paddleThrustZ = headingZ * paddleThrustMag;

  return {
    inWater: true,
    immersionDepth,
    displacedVolume,
    buoyantForce,
    normalForceRatio,
    isFloating,
    effectiveGrip,
    waterDragX,
    waterDragZ,
    paddleThrustX,
    paddleThrustZ,
    buoyantWaterlineY,
  };
}
