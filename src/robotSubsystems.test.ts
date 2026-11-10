import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSubsystems, stepSubsystems, applyFallImpactDamage, AMBIENT_TEMP, isRobotDestroyed } from './robotSubsystems.ts';

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
