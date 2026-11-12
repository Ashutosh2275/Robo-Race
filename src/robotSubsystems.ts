export type BatteryState = {
  voltage: number;
  capacityMah: number;
  chargeMah: number;
  percentage: number;
  health: number;
  temperature: number;
  currentAmps: number;
  powerWatts: number;
  estimatedRuntimeSec: number;
};

export type MotorState = {
  leftTemp: number;
  rightTemp: number;
  leftTorque: number;
  rightTorque: number;
  thermalThrottle: number;
};

export type EscState = {
  temperature: number;
  powerDelivery: number;
  overheated: boolean;
};

export type IntegrityState = {
  chassis: number;
  leftTrack: number;
  rightTrack: number;
  driveWheels: number;
  electronicsEnclosure: number;
};

export type HazardType = 'none' | 'fire' | 'water' | 'oil' | 'sand';

export type HardwareFaultId =
  | 'battery_swollen'
  | 'circuit_burnt'
  | 'left_motor_burnt'
  | 'right_motor_burnt'
  | 'left_belt_slipped'
  | 'right_belt_slipped';

export type ComponentFaultState = {
  batterySwollen: boolean;
  circuitBurnt: boolean;
  leftMotorBurnt: boolean;
  rightMotorBurnt: boolean;
  leftBeltSlipped: boolean;
  rightBeltSlipped: boolean;
  faultReasons: Partial<Record<HardwareFaultId, string>>;
};

export type SubsystemsState = {
  battery: BatteryState;
  motors: MotorState;
  esc: EscState;
  integrity: IntegrityState;
  faults: ComponentFaultState;
  activeHazard: HazardType;
  fireExposureSec: number;
};

export const TECHNICAL_TIMEOUT_SECONDS = 30;

export function createInitialFaults(): ComponentFaultState {
  return {
    batterySwollen: false,
    circuitBurnt: false,
    leftMotorBurnt: false,
    rightMotorBurnt: false,
    leftBeltSlipped: false,
    rightBeltSlipped: false,
    faultReasons: {},
  };
}

export function hasAnyHardwareFault(sub: SubsystemsState): boolean {
  const f = sub.faults;
  return (
    f.batterySwollen
    || f.circuitBurnt
    || f.leftMotorBurnt
    || f.rightMotorBurnt
    || f.leftBeltSlipped
    || f.rightBeltSlipped
    || sub.integrity.electronicsEnclosure < 65
  );
}

export function getActiveFaultList(sub: SubsystemsState): HardwareFaultId[] {
  const out: HardwareFaultId[] = [];
  if (sub.faults.batterySwollen) out.push('battery_swollen');
  if (sub.faults.circuitBurnt) out.push('circuit_burnt');
  if (sub.faults.leftMotorBurnt) out.push('left_motor_burnt');
  if (sub.faults.rightMotorBurnt) out.push('right_motor_burnt');
  if (sub.faults.leftBeltSlipped) out.push('left_belt_slipped');
  if (sub.faults.rightBeltSlipped) out.push('right_belt_slipped');
  return out;
}

export const AMBIENT_TEMP = 28.0; // °C

// Gameplay defaults only. The physical robot's pack chemistry/capacity are unknown.
const SIM_BATTERY_CAPACITY_MAH = 5000;

export function createInitialSubsystems(): SubsystemsState {
  const capacityMah = SIM_BATTERY_CAPACITY_MAH;
  return {
    battery: {
      voltage: 16.4,
      capacityMah,
      chargeMah: capacityMah,
      percentage: 100,
      health: 98,
      temperature: AMBIENT_TEMP,
      currentAmps: 1.2,
      powerWatts: 19.6,
      estimatedRuntimeSec: 7200,
    },
    motors: {
      leftTemp: AMBIENT_TEMP,
      rightTemp: AMBIENT_TEMP,
      leftTorque: 0,
      rightTorque: 0,
      thermalThrottle: 1.0,
    },
    esc: {
      temperature: AMBIENT_TEMP,
      powerDelivery: 100,
      overheated: false,
    },
    integrity: {
      chassis: 100,
      leftTrack: 100,
      rightTrack: 100,
      driveWheels: 100,
      electronicsEnclosure: 100,
    },
    faults: createInitialFaults(),
    activeHazard: 'none',
    fireExposureSec: 0,
  };
}

export type DrivetrainModifiers = {
  leftMotorMultiplier: number;
  rightMotorMultiplier: number;
  maxSpeedMultiplier: number;
  accelerationMultiplier: number;
  circuitCutoutActive: boolean;
};

/**
 * Evaluates physical drivetrain impairment caused by burnt motors, swollen LiPo packs,
 * or broken/shorted ESC distribution circuits carried over or triggered mid-run.
 */
export function getEffectiveDrivetrainModifiers(
  sub: SubsystemsState,
  elapsedSec = 0
): DrivetrainModifiers {
  const f = sub.faults;
  const leftMotorMultiplier = (f.leftMotorBurnt ? 0.34 : 1.0) * (f.leftBeltSlipped ? 0.42 : 1.0);
  const rightMotorMultiplier = (f.rightMotorBurnt ? 0.34 : 1.0) * (f.rightBeltSlipped ? 0.42 : 1.0);
  const batteryCap = f.batterySwollen ? 0.72 : 1.0;

  let circuitFactor = sub.esc.powerDelivery / 100;
  let circuitCutoutActive = false;
  if (f.circuitBurnt) {
    // Burnt/broken ESC trace induces deterministic power brownouts and intermittent dropouts
    const pulse = Math.sin(elapsedSec * 5.7) + 0.55 * Math.cos(elapsedSec * 13.1);
    if (pulse < -0.55) {
      circuitFactor = 0.08;
      circuitCutoutActive = true;
    } else {
      circuitFactor = Math.min(circuitFactor, 0.58);
    }
  }

  const maxSpeedMultiplier = Math.max(0.18, batteryCap * (f.circuitBurnt ? 0.74 : 1.0));
  const accelerationMultiplier = Math.max(0.12, sub.motors.thermalThrottle * batteryCap * circuitFactor);

  return {
    leftMotorMultiplier,
    rightMotorMultiplier,
    maxSpeedMultiplier,
    accelerationMultiplier,
    circuitCutoutActive,
  };
}

/** Repair time cost (seconds deducted from the 30s technical timeout pit budget). */
export const FAULT_REPAIR_META: Record<HardwareFaultId, { label: string; symptom: string; pitSec: number }> = {
  battery_swollen: {
    label: '4S LiPo Cell Pack Swollen',
    symptom: 'Puffed pouches venting gas · severe voltage sag (-28% power ceiling)',
    pitSec: 6,
  },
  circuit_burnt: {
    label: 'Main ESC / Power Circuit Burnt',
    symptom: 'Scorched MOSFET stage & loose XT60 bus · intermittent throttle dropouts',
    pitSec: 8,
  },
  left_motor_burnt: {
    label: 'Left 600RPM Motor Winding Burnt',
    symptom: 'Charred stator coils · -66% left track torque (veers strongly left)',
    pitSec: 7,
  },
  right_motor_burnt: {
    label: 'Right 600RPM Motor Winding Burnt',
    symptom: 'Charred stator coils · -66% right track torque (veers strongly right)',
    pitSec: 7,
  },
  left_belt_slipped: {
    label: 'Left Cycle-Tube Belt Off Wheel',
    symptom: 'Curved inner-tube belt slipped off pulley groove · severe traction loss',
    pitSec: 4,
  },
  right_belt_slipped: {
    label: 'Right Cycle-Tube Belt Off Wheel',
    symptom: 'Curved inner-tube belt slipped off pulley groove · severe traction loss',
    pitSec: 4,
  },
};

export type HardwareCarryoverSnapshot = {
  roundNumber: number;
  faults: ComponentFaultState;
  batteryHealth: number;
  electronicsEnclosure: number;
  leftTrack: number;
  rightTrack: number;
  driveWheels: number;
};

export function createCarryoverSnapshot(sub: SubsystemsState, nextRoundNumber: number): HardwareCarryoverSnapshot {
  return {
    roundNumber: nextRoundNumber,
    faults: {
      batterySwollen: sub.faults.batterySwollen,
      circuitBurnt: sub.faults.circuitBurnt,
      leftMotorBurnt: sub.faults.leftMotorBurnt,
      rightMotorBurnt: sub.faults.rightMotorBurnt,
      leftBeltSlipped: sub.faults.leftBeltSlipped,
      rightBeltSlipped: sub.faults.rightBeltSlipped,
      faultReasons: { ...sub.faults.faultReasons },
    },
    batteryHealth: sub.battery.health,
    electronicsEnclosure: sub.integrity.electronicsEnclosure,
    leftTrack: sub.integrity.leftTrack,
    rightTrack: sub.integrity.rightTrack,
    driveWheels: sub.integrity.driveWheels,
  };
}

export function applyCarryoverSnapshot(sub: SubsystemsState, snap: HardwareCarryoverSnapshot | null): void {
  if (!snap) return;
  sub.faults = {
    batterySwollen: !!snap.faults?.batterySwollen,
    circuitBurnt: !!snap.faults?.circuitBurnt,
    leftMotorBurnt: !!snap.faults?.leftMotorBurnt,
    rightMotorBurnt: !!snap.faults?.rightMotorBurnt,
    leftBeltSlipped: !!snap.faults?.leftBeltSlipped,
    rightBeltSlipped: !!snap.faults?.rightBeltSlipped,
    faultReasons: { ...(snap.faults?.faultReasons ?? {}) },
  };
  sub.battery.health = Math.max(40, Math.min(100, snap.batteryHealth ?? 98));
  if (sub.faults.batterySwollen) {
    sub.battery.voltage = 14.2;
    sub.battery.temperature = AMBIENT_TEMP + 12;
  }
  if (sub.faults.circuitBurnt) {
    sub.esc.powerDelivery = 60;
  }
  sub.integrity.electronicsEnclosure = Math.max(20, Math.min(100, snap.electronicsEnclosure ?? 100));
  sub.integrity.leftTrack = Math.max(45, Math.min(100, snap.leftTrack ?? 100));
  sub.integrity.rightTrack = Math.max(45, Math.min(100, snap.rightTrack ?? 100));
  sub.integrity.driveWheels = Math.max(50, Math.min(100, snap.driveWheels ?? 100));
}

export function repairComponentFault(sub: SubsystemsState, faultId: HardwareFaultId): void {
  if (faultId === 'battery_swollen') {
    sub.faults.batterySwollen = false;
    delete sub.faults.faultReasons.battery_swollen;
    sub.battery.chargeMah = sub.battery.capacityMah;
    sub.battery.percentage = 100;
    sub.battery.health = 98;
    sub.battery.voltage = 16.4;
    sub.battery.temperature = AMBIENT_TEMP;
  } else if (faultId === 'circuit_burnt') {
    sub.faults.circuitBurnt = false;
    delete sub.faults.faultReasons.circuit_burnt;
    sub.esc.temperature = AMBIENT_TEMP;
    sub.esc.powerDelivery = 100;
    sub.esc.overheated = false;
    sub.integrity.electronicsEnclosure = 100;
  } else if (faultId === 'left_motor_burnt') {
    sub.faults.leftMotorBurnt = false;
    delete sub.faults.faultReasons.left_motor_burnt;
    sub.motors.leftTemp = AMBIENT_TEMP;
    sub.motors.thermalThrottle = Math.max(sub.motors.thermalThrottle, 0.9);
    sub.integrity.leftTrack = Math.max(sub.integrity.leftTrack, 85);
  } else if (faultId === 'right_motor_burnt') {
    sub.faults.rightMotorBurnt = false;
    delete sub.faults.faultReasons.right_motor_burnt;
    sub.motors.rightTemp = AMBIENT_TEMP;
    sub.motors.thermalThrottle = Math.max(sub.motors.thermalThrottle, 0.9);
    sub.integrity.rightTrack = Math.max(sub.integrity.rightTrack, 85);
  } else if (faultId === 'left_belt_slipped') {
    sub.faults.leftBeltSlipped = false;
    delete sub.faults.faultReasons.left_belt_slipped;
    sub.integrity.leftTrack = Math.max(sub.integrity.leftTrack, 92);
  } else if (faultId === 'right_belt_slipped') {
    sub.faults.rightBeltSlipped = false;
    delete sub.faults.faultReasons.right_belt_slipped;
    sub.integrity.rightTrack = Math.max(sub.integrity.rightTrack, 92);
  }
}

export function repairEnclosureSeal(sub: SubsystemsState): void {
  sub.integrity.electronicsEnclosure = 100;
  sub.integrity.leftTrack = Math.max(sub.integrity.leftTrack, 92);
  sub.integrity.rightTrack = Math.max(sub.integrity.rightTrack, 92);
  sub.integrity.driveWheels = Math.max(sub.integrity.driveWheels, 92);
}

/** Structural integrity at zero permanently ends the current race attempt. */
export function isRobotDestroyed(sub: SubsystemsState): boolean {
  return sub.integrity.chassis <= 0;
}

export function stepSubsystems(
  sub: SubsystemsState,
  leftCmd: number,
  rightCmd: number,
  motorSlip: number,
  hazard: HazardType,
  impactDamage: number,
  dt: number
) {
  sub.activeHazard = hazard;

  // 1. Current demand calculation
  const absL = Math.abs(leftCmd);
  const absR = Math.abs(rightCmd);
  const idleCurrent = 1.2;
  const driveCurrent = (absL + absR) * 16.0;
  const slipCurrent = motorSlip * 22.0;
  const totalCurrent = Math.min(65.0, idleCurrent + driveCurrent + slipCurrent);

  sub.battery.currentAmps = totalCurrent;
  sub.battery.powerWatts = sub.battery.voltage * totalCurrent;

  // 2. Battery discharge & cell voltage curve
  const mahConsumed = (totalCurrent * 1000 / 3600) * dt;
  sub.battery.chargeMah = Math.max(0, sub.battery.chargeMah - mahConsumed);
  sub.battery.percentage = Math.max(0, Math.min(100, (sub.battery.chargeMah / sub.battery.capacityMah) * 100));
  // Generic simulated voltage curve; chemistry, cell count and real voltage limits
  // have not been identified from the reference photographs.
  sub.battery.voltage = 13.0 + (sub.battery.percentage / 100) * 3.8;

  if (totalCurrent > 0.1) {
    sub.battery.estimatedRuntimeSec = (sub.battery.chargeMah / 1000) / totalCurrent * 3600;
  } else {
    sub.battery.estimatedRuntimeSec = 7200;
  }

  // 3. Thermal simulation
  let fireHeat = 0;
  let waterCooling = 1.0;

  if (hazard === 'fire') {
    fireHeat = 18.0; // Rapid external heating in fire
  } else if (hazard === 'water') {
    waterCooling = 4.5; // Rapid conductive cooling in water trench
  }

  // Battery temperature
  const batteryJouleHeating = (totalCurrent * totalCurrent * 0.0035) * dt;
  const batteryAmbientLoss = (sub.battery.temperature - AMBIENT_TEMP) * 0.1 * dt * waterCooling;
  sub.battery.temperature = Math.max(AMBIENT_TEMP, sub.battery.temperature + batteryJouleHeating - batteryAmbientLoss + fireHeat * 0.4 * dt);

  // Motors heating & cooling
  const leftHeat = (absL * absL * 4.2 + motorSlip * 6.0) * dt;
  const rightHeat = (absR * absR * 4.2 + motorSlip * 6.0) * dt;
  const leftAmbientLoss = (sub.motors.leftTemp - AMBIENT_TEMP) * 0.16 * dt * waterCooling;
  const rightAmbientLoss = (sub.motors.rightTemp - AMBIENT_TEMP) * 0.16 * dt * waterCooling;

  sub.motors.leftTemp = Math.max(AMBIENT_TEMP, sub.motors.leftTemp + leftHeat - leftAmbientLoss + fireHeat * dt);
  sub.motors.rightTemp = Math.max(AMBIENT_TEMP, sub.motors.rightTemp + rightHeat - rightAmbientLoss + fireHeat * dt);
  sub.motors.leftTorque = absL * 1.85 * (1 - motorSlip * 0.4);
  sub.motors.rightTorque = absR * 1.85 * (1 - motorSlip * 0.4);

  // Motor thermal throttling: begins at 85°C, down to 30% power at 115°C
  const maxMotorTemp = Math.max(sub.motors.leftTemp, sub.motors.rightTemp);
  if (maxMotorTemp > 85.0) {
    sub.motors.thermalThrottle = Math.max(0.3, 1.0 - (maxMotorTemp - 85.0) / 40.0);
  } else {
    sub.motors.thermalThrottle = 1.0;
  }

  // ESC heating & overheating protection
  const escHeat = (totalCurrent * 0.28) * dt;
  const escLoss = (sub.esc.temperature - AMBIENT_TEMP) * 0.22 * dt * waterCooling;
  sub.esc.temperature = Math.max(AMBIENT_TEMP, sub.esc.temperature + escHeat - escLoss + fireHeat * 0.8 * dt);

  if (sub.esc.temperature > 105.0) {
    sub.esc.overheated = true;
    sub.esc.powerDelivery = 25; // Limp mode
  } else if (sub.esc.temperature < 82.0 && sub.esc.overheated) {
    sub.esc.overheated = false;
    sub.esc.powerDelivery = 100;
  }

  // 4. Integrity and damage
  if (impactDamage > 0) {
    sub.integrity.chassis = Math.max(0, sub.integrity.chassis - impactDamage * 1.2);
    sub.integrity.driveWheels = Math.max(0, sub.integrity.driveWheels - impactDamage * 0.8);
    sub.integrity.leftTrack = Math.max(0, sub.integrity.leftTrack - impactDamage * 0.5);
    sub.integrity.rightTrack = Math.max(0, sub.integrity.rightTrack - impactDamage * 0.5);
  }

  // Fire dwell exposure ramps realistically: quick crisp crossings singe lightly while stalling cooks chassis, belts & seals
  if (hazard === 'fire') {
    sub.fireExposureSec = Math.min(15, (sub.fireExposureSec ?? 0) + dt);
  } else {
    sub.fireExposureSec = Math.max(0, (sub.fireExposureSec ?? 0) - dt * (hazard === 'water' ? 3.0 : 1.5));
  }

  // Thermal track rubber, drive wheel, seal & chassis heat damage during active fire immersion
  if (hazard === 'fire') {
    const heatFactor = 1.0 + Math.min(1.6, sub.fireExposureSec * 0.28);
    const beltDmg = 3.2 * heatFactor * dt;
    sub.integrity.leftTrack = Math.max(0, sub.integrity.leftTrack - beltDmg);
    sub.integrity.rightTrack = Math.max(0, sub.integrity.rightTrack - beltDmg);
    const chassisDmg = (1.6 + Math.min(11.0, sub.fireExposureSec * 1.9)) * dt;
    sub.integrity.chassis = Math.max(0, sub.integrity.chassis - chassisDmg);
    const wheelDmg = (1.2 + Math.min(6.0, sub.fireExposureSec * 1.0)) * dt;
    sub.integrity.driveWheels = Math.max(0, sub.integrity.driveWheels - wheelDmg);
    const sealDmg = (2.0 + Math.min(7.5, sub.fireExposureSec * 1.25)) * dt;
    sub.integrity.electronicsEnclosure = Math.max(0, sub.integrity.electronicsEnclosure - sealDmg);
  }

  // 5. Realistic Component Burnout, Swelling & Short-Circuit Evaluation
  const triggeredFaults: HardwareFaultId[] = [];
  if (!sub.faults.batterySwollen && (sub.battery.temperature >= 62.0 || (sub.battery.percentage <= 18.0 && totalCurrent >= 40.0))) {
    sub.faults.batterySwollen = true;
    sub.faults.faultReasons.battery_swollen = hazard === 'fire'
      ? 'Thermal runaway in Fire Hearth swelled LiPo pouch cells'
      : 'High-C discharge & heat puffed 4S LiPo cells';
    triggeredFaults.push('battery_swollen');
  }
  if (!sub.faults.leftMotorBurnt && sub.motors.leftTemp >= 95.0) {
    sub.faults.leftMotorBurnt = true;
    sub.faults.faultReasons.left_motor_burnt = hazard === 'fire'
      ? 'Fire Hearth overheated left 600RPM stator windings'
      : 'Stall overcurrent burnt left motor coils';
    triggeredFaults.push('left_motor_burnt');
  }
  if (!sub.faults.rightMotorBurnt && sub.motors.rightTemp >= 95.0) {
    sub.faults.rightMotorBurnt = true;
    sub.faults.faultReasons.right_motor_burnt = hazard === 'fire'
      ? 'Fire Hearth overheated right 600RPM stator windings'
      : 'Stall overcurrent burnt right motor coils';
    triggeredFaults.push('right_motor_burnt');
  }
  if (!sub.faults.circuitBurnt && (sub.esc.temperature >= 94.0 || (hazard === 'water' && sub.integrity.electronicsEnclosure < 68))) {
    sub.faults.circuitBurnt = true;
    sub.faults.faultReasons.circuit_burnt = hazard === 'water'
      ? 'Water ingress through cracked enclosure shorted ESC PCB'
      : 'MOSFET over-temperature burnt ESC distribution circuit';
    triggeredFaults.push('circuit_burnt');
  }

  return triggeredFaults;
}

/**
 * Applies sudden battery charge & thermal jolt caused by heavy height falls or hard inverted impacts.
 */
export function applyBatteryShock(
  sub: SubsystemsState,
  shockPct: number,
  tempRise = 1.8,
): number {
  if (shockPct <= 0 || isRobotDestroyed(sub)) return 0;
  const mahDrop = (shockPct / 100) * sub.battery.capacityMah;
  sub.battery.chargeMah = Math.max(0, sub.battery.chargeMah - mahDrop);
  sub.battery.percentage = Math.max(0, Math.min(100, (sub.battery.chargeMah / sub.battery.capacityMah) * 100));
  sub.battery.voltage = 13.0 + (sub.battery.percentage / 100) * 3.8;
  sub.battery.temperature = Math.min(85, sub.battery.temperature + tempRise);
  if (!sub.faults.batterySwollen && (shockPct >= 14 || sub.battery.temperature >= 62)) {
    sub.faults.batterySwollen = true;
    sub.faults.faultReasons.battery_swollen = 'High-G impact deformed and swelled 4S LiPo cells';
  }
  return shockPct;
}

/**
 * Applies kinetic fall-impact shock damage to robot structural health when landing
 * vertically above the safe suspension tolerance threshold (2.2 m/s ~ 0.25m free drop).
 * Soft loose sand absorbs 22% of peak impulse compared to rigid concrete/steel.
 */
export function applyFallImpactDamage(
  sub: SubsystemsState,
  impactSpeedMps: number,
  hazard: HazardType = 'none',
): number {
  const safeThresholdMps = 2.2;
  if (impactSpeedMps <= safeThresholdMps || isRobotDestroyed(sub)) return 0;

  const rawExcess = impactSpeedMps - safeThresholdMps;
  // Softly compress catastrophic excess above 3.5 m/s so a single bridge fall doesn't exceed ~55% HP
  const excess = rawExcess <= 3.5 ? rawExcess : 3.5 + (rawExcess - 3.5) * 0.28;
  const surfaceFactor = hazard === 'sand' ? 0.78 : 1.0;
  const chassisLoss = Math.min(sub.integrity.chassis, excess * excess * 3.8 * surfaceFactor);
  const wheelLoss = excess * excess * 2.85 * surfaceFactor;
  const trackLoss = excess * excess * 1.75 * surfaceFactor;

  sub.integrity.chassis = Math.max(0, sub.integrity.chassis - chassisLoss);
  sub.integrity.driveWheels = Math.max(0, sub.integrity.driveWheels - wheelLoss);
  sub.integrity.leftTrack = Math.max(0, sub.integrity.leftTrack - trackLoss);
  sub.integrity.rightTrack = Math.max(0, sub.integrity.rightTrack - trackLoss);
  sub.integrity.electronicsEnclosure = Math.max(0, sub.integrity.electronicsEnclosure - chassisLoss * 0.5);
  if (!sub.faults.circuitBurnt && sub.integrity.electronicsEnclosure < 62) {
    sub.faults.circuitBurnt = true;
    sub.faults.faultReasons.circuit_burnt = 'Hard landing fractured electronics bay & shorted ESC bus';
  }
  return chassisLoss;
}

/**
 * Applies calibrated structural & drive damage from a swinging wrecking ball impact.
 * Scales smoothly from ~8% to 24% HP per collision rather than wiping >80% health at once.
 */
export function applyPendulumImpactDamage(
  sub: SubsystemsState,
  relSpeedMps: number,
): number {
  if (relSpeedMps <= 0.75 || isRobotDestroyed(sub)) return 0;
  const excess = Math.max(0, relSpeedMps - 0.75);
  const chassisLoss = Math.min(sub.integrity.chassis, Math.min(24, 6.0 + excess * 4.2));
  sub.integrity.chassis = Math.max(0, sub.integrity.chassis - chassisLoss);
  sub.integrity.driveWheels = Math.max(0, sub.integrity.driveWheels - chassisLoss * 0.65);
  sub.integrity.electronicsEnclosure = Math.max(0, sub.integrity.electronicsEnclosure - chassisLoss * 0.40);
  return chassisLoss;
}
