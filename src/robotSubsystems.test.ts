import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialSubsystems,
  stepSubsystems,
  applyFallImpactDamage,
  AMBIENT_TEMP,
  isRobotDestroyed,
  TECHNICAL_TIMEOUT_SECONDS,
  FAULT_REPAIR_META,
  hasAnyHardwareFault,
  getEffectiveDrivetrainModifiers,
  createCarryoverSnapshot,
  applyCarryoverSnapshot,
  repairComponentFault,
  repairEnclosureSeal,
} from './robotSubsystems.ts';

test('idle current draw is low and full throttle draws significant current', () => {
  const sIdle = createInitialSubsystems();
  stepSubsystems(sIdle, 0, 0, 0, 'none', 0, 1.0);
  assert.ok(sIdle.battery.currentAmps < 2.0);

  const sDrive = createInitialSubsystems();
  stepSubsystems(sDrive, 1.0, 1.0, 0, 'none', 0, 1.0);
  assert.ok(sDrive.battery.currentAmps > 25.0);
  assert.ok(sDrive.battery.chargeMah < sDrive.battery.capacityMah);
});

test('motor slip increases current draw and accelerates motor heating', () => {
  const sGrip = createInitialSubsystems();
  const sSlip = createInitialSubsystems();

  for (let i = 0; i < 30; i++) {
    stepSubsystems(sGrip, 1.0, 1.0, 0, 'none', 0, 0.1);
    stepSubsystems(sSlip, 1.0, 1.0, 0.8, 'none', 0, 0.1);
  }

  assert.ok(sSlip.motors.leftTemp > sGrip.motors.leftTemp);
  assert.ok(sSlip.battery.currentAmps > sGrip.battery.currentAmps);
});

test('fire hazard rapidly raises temperature and damages track integrity', () => {
  const s = createInitialSubsystems();
  const initialIntegrity = s.integrity.leftTrack;

  for (let i = 0; i < 30; i++) {
    stepSubsystems(s, 0.5, 0.5, 0, 'fire', 0, 0.1);
  }

  assert.ok(s.motors.leftTemp > AMBIENT_TEMP + 10);
  assert.ok(s.integrity.leftTrack < initialIntegrity, 'fire should degrade track integrity');
});

test('water hazard actively cools overheated motors and ESC', () => {
  const s = createInitialSubsystems();
  s.motors.leftTemp = 80.0;
  s.motors.rightTemp = 80.0;
  s.esc.temperature = 75.0;

  for (let i = 0; i < 20; i++) {
    stepSubsystems(s, 0.2, 0.2, 0, 'water', 0, 0.1);
  }

  assert.ok(s.motors.leftTemp < 70.0, 'water should rapidly cool motors');
  assert.ok(s.esc.temperature < 65.0, 'water should rapidly cool ESC');
});

test('hard impact reduces chassis and drive wheel integrity', () => {
  const s = createInitialSubsystems();
  stepSubsystems(s, 0, 0, 0, 'none', 15.0, 0.1);

  assert.ok(s.integrity.chassis < 90);
  assert.ok(s.integrity.driveWheels < 95);
});

test('zero chassis integrity is a destroyed state and cannot be repaired by ordinary stepping', () => {
  const s = createInitialSubsystems();
  s.integrity.chassis = 0.1;
  stepSubsystems(s, 1, 1, 0, 'none', 1, 1 / 120);
  assert.equal(s.integrity.chassis, 0);
  assert.equal(isRobotDestroyed(s), true);
  stepSubsystems(s, 0, 0, 0, 'none', 0, 1);
  assert.equal(s.integrity.chassis, 0, 'ordinary recovery/physics updates must not restore health');
});

test('kinetic fall impact makes health a major survival constraint on bridge drops', () => {
  const s = createInitialSubsystems();
  // Minor bump < 2.2 m/s deals 0 damage
  assert.equal(applyFallImpactDamage(s, 1.8, 'none'), 0);
  assert.equal(s.integrity.chassis, 100);

  // Heavy 1.65m bridge fall into sand (~5.69 m/s) deals severe structural health loss (>= 25%)
  const fallDamage1 = applyFallImpactDamage(s, 5.69, 'sand');
  assert.ok(fallDamage1 >= 25 && fallDamage1 <= 50, `bridge drop damage should be serious (~30-45%), got ${fallDamage1.toFixed(1)}`);
  assert.ok(s.integrity.chassis <= 75);
  assert.ok(s.integrity.driveWheels < 90);

  // Repeated falls deplete health completely -> robot destroyed
  applyFallImpactDamage(s, 5.69, 'sand');
  applyFallImpactDamage(s, 5.69, 'sand');
  assert.equal(isRobotDestroyed(s), true, 'three high-bridge plunges into pit must destroy robot chassis integrity');
});

test('extreme fire/thermal stress triggers swollen battery, burnt motors, and shorted circuit carrying into next round and repairable within 30s timeout', () => {
  const round1 = createInitialSubsystems();
  // Lingering stationary at high slip over intense fire triggers thermal burnout & LiPo cell swelling
  for (let i = 0; i < 65; i++) {
    stepSubsystems(round1, 1.0, 1.0, 0.9, 'fire', 0, 0.1);
  }
  assert.equal(round1.faults.leftMotorBurnt, true, 'sustained over-temp should burn left motor');
  assert.equal(round1.faults.rightMotorBurnt, true, 'sustained over-temp should burn right motor');
  assert.equal(round1.faults.circuitBurnt, true, 'sustained over-temp should burn ESC circuit');
  assert.equal(round1.faults.batterySwollen, true, 'sustained heat should swell LiPo cells');
  assert.equal(hasAnyHardwareFault(round1), true);

  // Compromised drivetrain noticeably degrades torque & speed
  const mods = getEffectiveDrivetrainModifiers(round1, 0.4);
  assert.ok(mods.leftMotorMultiplier < 0.5);
  assert.ok(mods.rightMotorMultiplier < 0.5);
  assert.ok(mods.maxSpeedMultiplier < 0.75);
  assert.ok(mods.accelerationMultiplier < 0.5);

  // Faults carry forward cleanly into Round 2 until repaired during the 30s Technical Timeout
  const carrySnap = createCarryoverSnapshot(round1, 2);
  const round2 = createInitialSubsystems();
  applyCarryoverSnapshot(round2, carrySnap);
  assert.equal(hasAnyHardwareFault(round2), true);
  assert.equal(round2.faults.batterySwollen, true);
  assert.equal(round2.faults.circuitBurnt, true);

  // Repair all four faulty components within the 30s technical timeout pit budget
  let timeoutBudget = TECHNICAL_TIMEOUT_SECONDS;
  for (const fid of ['battery_swollen', 'circuit_burnt', 'left_motor_burnt', 'right_motor_burnt'] as const) {
    timeoutBudget -= FAULT_REPAIR_META[fid].pitSec;
    repairComponentFault(round2, fid);
  }
  repairEnclosureSeal(round2);
  assert.ok(timeoutBudget >= 0, `total component swap time should fit within 30s timeout, remaining=${timeoutBudget}`);
  assert.equal(hasAnyHardwareFault(round2), false);
});

test('cracked electronics enclosure shorts ESC circuit when entering deep water hazard', () => {
  const s = createInitialSubsystems();
  s.integrity.electronicsEnclosure = 55;
  const triggered = stepSubsystems(s, 0.5, 0.5, 0, 'water', 0, 0.1);
  assert.equal(s.faults.circuitBurnt, true);
  assert.ok(triggered.includes('circuit_burnt'));
});

test('fire hazard applies progressive thermal damage: fast crossings survive while lingering destroys chassis & belts', () => {
  // Fast 1.0s pass across the fire hearth leaves chassis > 94% and belts intact
  const quick = createInitialSubsystems();
  for (let i = 0; i < 10; i++) {
    stepSubsystems(quick, 1.0, 1.0, 0.1, 'fire', 0, 0.1);
  }
  assert.ok(quick.integrity.chassis >= 94, `Quick fire pass should preserve >=94% chassis, got ${quick.integrity.chassis}`);
  assert.equal(isRobotDestroyed(quick), false);

  // Prolonged stall (~12s) in intense fire progressively destroys chassis, belts, drive wheels & enclosure
  const stalled = createInitialSubsystems();
  for (let i = 0; i < 120; i++) {
    stepSubsystems(stalled, 0.4, 0.4, 0.2, 'fire', 0, 0.1);
  }
  assert.ok(stalled.integrity.leftTrack < 65, 'Fire exposure must scorch left cycle-tube belt');
  assert.ok(stalled.integrity.rightTrack < 65, 'Fire exposure must scorch right cycle-tube belt');
  assert.ok(stalled.integrity.driveWheels < 75, 'Fire exposure must degrade corner drive wheels');
  assert.ok(stalled.integrity.electronicsEnclosure < 75, 'Fire exposure must degrade enclosure seals');
  assert.equal(isRobotDestroyed(stalled), true, 'Prolonged fire dwell must thermally destroy robot chassis');

  // Exiting fire onto water quenches fireExposureSec fast
  const cooled = createInitialSubsystems();
  for (let i = 0; i < 30; i++) stepSubsystems(cooled, 0.8, 0.8, 0, 'fire', 0, 0.1);
  const peakExposure = cooled.fireExposureSec;
  assert.ok(peakExposure > 2.5);
  for (let i = 0; i < 15; i++) stepSubsystems(cooled, 0.5, 0.5, 0, 'water', 0, 0.1);
  assert.equal(cooled.fireExposureSec, 0, 'Water immersion must rapidly quench accumulated thermal exposure');
});
