import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CYCLE_TUBE_SPAN_LEN,
  CYCLE_TUBE_WHEEL_RADIUS,
  CYCLE_TUBE_WHEEL_Y,
  createInitialBeltTrackingState,
  sampleCycleTubeLoop,
  stepBeltTrackingState,
} from './cycleTubeBelt.ts';

test('cycle-tube belt path forms a visible curve along mid-spans instead of flat straight plates', () => {
  const endSample = sampleCycleTubeLoop(0);
  const midUpperSample = sampleCycleTubeLoop(CYCLE_TUBE_SPAN_LEN * 0.5);
  const topWheelCrownY = CYCLE_TUBE_WHEEL_Y + CYCLE_TUBE_WHEEL_RADIUS;

  assert.ok(Math.abs(endSample.y - topWheelCrownY) < 1e-6, 'belt touches top of rear corner wheel');
  assert.ok(
    topWheelCrownY - midUpperSample.y >= 0.03,
    `cycle-tube mid-span must visibly sag/curve downward, got dip ${(topWheelCrownY - midUpperSample.y).toFixed(4)}m`,
  );

  // When derailed, the belt visibly slides laterally off the corner wheels while drooping deeper
  const derailedSample = sampleCycleTubeLoop(CYCLE_TUBE_SPAN_LEN * 0.5, {
    derailed: true,
    sideSign: -1,
    lateralDrift: -1.05,
  });
  assert.ok(derailedSample.x < -0.12, `derailed left belt must shift off wheel rim, got x=${derailedSample.x}`);
  assert.ok(derailedSample.y < midUpperSample.y - 0.03, 'derailed belt must sag lower than seated belt');
  assert.ok(Math.abs(derailedSample.rollX) > 0.15, 'derailed belt must visibly tilt off pulley flange');
});

test('normal driving keeps crowned cycle-tube belts seated while harsh impacts/snags derail a belt', () => {
  const healthy = createInitialBeltTrackingState();
  for (let i = 0; i < 300; i++) {
    const res = stepBeltTrackingState(healthy, {
      leftTrackSpeed: 4.5,
      rightTrackSpeed: 4.4,
      motorSlip: 0.05,
      asymmetricRockDiffM: 0.01,
      lateralSpeedMps: 0.2,
      impactImpulse: 0,
      leftTrackIntegrity: 100,
      rightTrackIntegrity: 100,
      waterDepthM: 0,
    }, 1 / 60);
    assert.equal(res.newlyDerailed.length, 0);
  }
  assert.equal(healthy.leftDerailed, false);
  assert.equal(healthy.rightDerailed, false);

  // Sustained extreme rock snag + wet slip + sharp lateral slam pops a belt off
  const stressed = createInitialBeltTrackingState();
  let sawDerail = false;
  for (let i = 0; i < 120; i++) {
    const res = stepBeltTrackingState(stressed, {
      leftTrackSpeed: 6.0,
      rightTrackSpeed: -5.5,
      motorSlip: 0.85,
      asymmetricRockDiffM: 0.45,
      lateralSpeedMps: 3.2,
      impactImpulse: i === 25 ? 10.5 : 0,
      leftTrackIntegrity: 70,
      rightTrackIntegrity: 70,
      waterDepthM: 0.2,
    }, 1 / 60);
    if (res.newlyDerailed.length > 0) sawDerail = true;
  }
  assert.equal(sawDerail, true, 'extreme lateral scrub and hard asymmetric rock shock should push belt out of place');
  assert.equal(stressed.leftDerailed || stressed.rightDerailed, true);
});
