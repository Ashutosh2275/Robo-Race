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

export type HazardType = 'none' | 'fire' | 'water' | 'oil';

export type SubsystemsState = {
  battery: BatteryState;
  motors: MotorState;
  esc: EscState;
  integrity: IntegrityState;
  activeHazard: HazardType;
};

export const AMBIENT_TEMP = 28.0; // °C

export function createInitialSubsystems(): SubsystemsState {
  const capacityMah = 5000;
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
    activeHazard: 'none',
  };
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
  // 4S LiPo discharge curve from 16.8V (full) to 13.0V (empty)
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

  // Fire damage over time
  if (hazard === 'fire') {
    sub.integrity.leftTrack = Math.max(0, sub.integrity.leftTrack - 2.5 * dt);
    sub.integrity.rightTrack = Math.max(0, sub.integrity.rightTrack - 2.5 * dt);
    sub.integrity.chassis = Math.max(0, sub.integrity.chassis - 1.2 * dt);
  }
}
