import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_METADATA,
  DYNAMIC_WATER_BED_Y,
  DYNAMIC_WATER_LEVEL_Y,
  HURDLE_CATALOG,
  buildSpiralTowerColliders,
  generateRandomizedCourse,
  sampleHangingBridgeRibbon,
  setActiveGeneratedCourse,
  stepHangingBridgeState,
} from './courseGenerator.ts';
import {
  evaluateCourseHeight,
  evaluateCourseSurface,
  GROUND_DECK_HEIGHT,
  MAP_SCALE,
  type TrackId,
} from './courseLayout.ts';
import {
  DEFAULT_SCORING_CONFIG,
  awardFootballGoalPoints,
  createCompetitionScoreState,
  evaluateFallOutcome,
  evaluatePendulumStrikeDamage,
  isLocalPointWithinBoundaryLines,
} from './scoringRules.ts';
import {
  applyFallImpactDamage,
  applyPendulumImpactDamage,
  createInitialSubsystems,
} from './robotSubsystems.ts';
import {
  TRACK_CONTACT_OFFSET,
  evaluateBarrierCollision,
  evaluateWaterBuoyancy,
  stepVehicle3D,
  type VehiclePose,
} from './vehicleDynamics.ts';

const TRACK_IDS: TrackId[] = ['track_a', 'track_b', 'track_c', 'track_d'];

test('all four proving arenas carry unique non-obstacle-locked names', () => {
  const names = TRACK_IDS.map(id => ARENA_METADATA[id].name);
  assert.equal(new Set(names).size, 4);
  for (const name of names) {
    assert.equal(/spiral|elevation|multi-level/i.test(name), false, `Name ${name} should not lock to a single obstacle`);
  }
});

test('randomized courses contain strictly unique non-repeating hurdles and total between 100 and 150 points', () => {
  let sumTotals = 0;
  let count = 0;
  let footballAppearances = 0;

  for (const tid of TRACK_IDS) {
    for (let s = 1; s <= 15; s++) {
      const course = generateRandomizedCourse(tid, s * 7919 + tid.charCodeAt(6) * 31);
      const types = course.slots.map(slot => slot.type);
      assert.equal(new Set(types).size, types.length, `Duplicate hurdle found in ${tid} seed ${s}: ${types.join(', ')}`);

      const recomputedPts = course.slots.reduce((acc, slot) => acc + HURDLE_CATALOG[slot.type].basePoints, 0);
      assert.equal(course.totalBasePoints, recomputedPts);
      assert.ok(
        course.totalBasePoints >= 100 && course.totalBasePoints <= 150,
        `${tid} seed ${s} generated ${course.totalBasePoints} pts outside [100, 150]`,
      );
      assert.ok(course.hardCount >= 1 && course.mediumCount >= 1 && course.easyCount >= 1, 'all 3 difficulty tiers included');

      if (types.includes('football_arena')) footballAppearances += 1;
      sumTotals += course.totalBasePoints;
      count += 1;
    }
  }

  const avgPts = sumTotals / count;
  assert.ok(avgPts >= 110 && avgPts <= 145, `Average hurdle points (${avgPts.toFixed(1)}) should target ~110-145`);
  assert.ok(footballAppearances / count >= 0.8, `Football arena must appear in most arenas (${footballAppearances}/${count})`);
});

test('hurdle placement randomizes across early, middle, and late track lanes across seeds', () => {
  const seenBridgeLanes = new Set<number>();
  const seenFootballLanes = new Set<number>();

  for (let s = 1; s <= 50; s++) {
    const course = generateRandomizedCourse('track_b', s * 104729);
    for (const slot of course.slots) {
      if (slot.type === 'hanging_bridges' || slot.type === 'seesaw_bridge' || slot.type === 'pendulum_bridge') {
        seenBridgeLanes.add(slot.laneIndex);
      }
      if (slot.type === 'football_arena') {
        seenFootballLanes.add(slot.laneIndex);
      }
    }
  }

  assert.ok(seenBridgeLanes.has(1) || seenBridgeLanes.has(2), `Expected bridge in early lanes: ${[...seenBridgeLanes]}`);
  assert.ok(seenBridgeLanes.has(3), `Expected bridge in mid lane: ${[...seenBridgeLanes]}`);
  assert.ok(seenBridgeLanes.has(4) || seenBridgeLanes.has(5), `Expected bridge in late lanes: ${[...seenBridgeLanes]}`);
  assert.ok(seenFootballLanes.size >= 3, `Football arena should rotate across multiple lanes: ${[...seenFootballLanes]}`);
});

test('every generated course places fire_hearth second-to-last and water_basin last', () => {
  for (const tid of TRACK_IDS) {
    for (let s = 1; s <= 25; s++) {
      const course = generateRandomizedCourse(tid, s * 13007 + tid.charCodeAt(6) * 53);
      assert.ok(course.slots.length >= 4, `${tid} seed ${s} must contain at least 4 slots`);
      const secondLast = course.slots[course.slots.length - 2];
      const last = course.slots[course.slots.length - 1];
      assert.equal(secondLast.type, 'fire_hearth', `${tid} seed ${s} second-to-last slot must be fire_hearth, got ${secondLast.type}`);
      assert.equal(last.type, 'water_basin', `${tid} seed ${s} last slot must be water_basin, got ${last.type}`);
      assert.equal(secondLast.laneIndex, 5);
      assert.equal(last.laneIndex, 5);
      assert.equal(course.waterPools.length, 1, 'exactly one mandatory water pool on final lane');
    }
  }
});

test('football arena goal scoring equals hurdle points across base goals and caps extra bonus at +2', () => {
  // 5-ball arena (medium = 20 pts, baseGoals = 3 -> 6+6+8=20, extra goals 4 & 5 give +1 each = +2 max)
  const state5 = createCompetitionScoreState(DEFAULT_SCORING_CONFIG);
  const g1 = awardFootballGoalPoints(state5, 1, 5, 'medium', DEFAULT_SCORING_CONFIG);
  const g2 = awardFootballGoalPoints(state5, 2, 5, 'medium', DEFAULT_SCORING_CONFIG);
  const g3 = awardFootballGoalPoints(state5, 3, 5, 'medium', DEFAULT_SCORING_CONFIG);
  assert.equal(g1.delta + g2.delta + g3.delta, 20);
  assert.equal(g1.isBonus || g2.isBonus || g3.isBonus, false);

  const g4 = awardFootballGoalPoints(state5, 4, 5, 'medium', DEFAULT_SCORING_CONFIG);
  const g5 = awardFootballGoalPoints(state5, 5, 5, 'medium', DEFAULT_SCORING_CONFIG);
  const g6 = awardFootballGoalPoints(state5, 6, 5, 'medium', DEFAULT_SCORING_CONFIG);
  assert.deepEqual([g4.delta, g5.delta, g6.delta], [1, 1, 0]);
  assert.equal(g4.isBonus, true);
  assert.equal(g5.isBonus, true);
  assert.equal(g6.isBonus, false);
  assert.equal(state5.score, 22);

  // 4-ball arena (medium = 20 pts, baseGoals = 2 -> 10+10=20, extra goals 3 & 4 give +1 each = +2 max)
  const state4 = createCompetitionScoreState(DEFAULT_SCORING_CONFIG);
  const b1 = awardFootballGoalPoints(state4, 1, 4, 'medium', DEFAULT_SCORING_CONFIG);
  const b2 = awardFootballGoalPoints(state4, 2, 4, 'medium', DEFAULT_SCORING_CONFIG);
  const b3 = awardFootballGoalPoints(state4, 3, 4, 'medium', DEFAULT_SCORING_CONFIG);
  const b4 = awardFootballGoalPoints(state4, 4, 4, 'medium', DEFAULT_SCORING_CONFIG);
  assert.equal(b1.delta + b2.delta, 20);
  assert.equal(b3.delta + b4.delta, 2);
  assert.equal(state4.score, 22);
});

test('dynamic course hooks evaluate slot terrain height, surface, and boundary lines cleanly when active', () => {
  const course = generateRandomizedCourse('track_a', 9876543);
  assert.ok(course.slots.length >= 4);
  try {
    setActiveGeneratedCourse(course);
    for (const slot of course.slots) {
      const hEntry = evaluateCourseHeight(slot.entryX, slot.laneZ);
      assert.ok(Number.isFinite(hEntry));
      const hMid = evaluateCourseHeight(slot.centerX, slot.laneZ);
      assert.ok(Number.isFinite(hMid));
      const surf = evaluateCourseSurface(slot.centerX, slot.laneZ, hMid);
      assert.ok(surf.grip > 0);
      if (slot.type === 'oil_chicane') {
        assert.ok(surf.grip <= 0.30, `Oil chicane center grip should be slick, got ${surf.grip}`);
      }
      if (slot.type === 'seesaw_bridge') {
        assert.ok(hEntry <= 0.15, `Seesaw entry should rest tilted smoothly down at start (${hEntry})`);
      }
    }
    assert.equal(isLocalPointWithinBoundaryLines(-17.5, 13.5, 0), true);
    assert.equal(isLocalPointWithinBoundaryLines(0, 18.0, 0), false);
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('spiral tower helix climbs monotonically across 540 degrees without dropping through ramp mid-climb', () => {
  // Find a seed containing spiral_tower
  let spiralCourse = null;
  for (let s = 1; s <= 40; s++) {
    const c = generateRandomizedCourse('track_b', s * 9973);
    if (c.slots.some(sl => sl.type === 'spiral_tower')) {
      spiralCourse = c;
      break;
    }
  }
  assert.ok(spiralCourse, 'Expected spiral_tower to appear within 40 seeds');
  const sp = spiralCourse.slots.find(sl => sl.type === 'spiral_tower')!;

  try {
    setActiveGeneratedCourse(spiralCourse);
    const spU = -4.20;
    const rMid = 2.15;
    let prevH = -10;
    for (let deg = 5; deg <= 535; deg += 5) {
      const beta = (deg * Math.PI) / 180;
      const u = spU - Math.cos(beta) * rMid;
      const v = -Math.sin(beta) * rMid;
      const x = sp.centerX + sp.dir * u;
      const z = sp.laneZ + sp.dir * v;
      // Simulate climbing vehicle with front lookahead where pose.y trails slightly behind front contact patch
      const expectedH = -0.33 + (beta / (3 * Math.PI)) * (3.20 - (-0.33));
      const poseY = expectedH - 0.12 - 0.15;
      const sampledH = evaluateCourseHeight(x, z, poseY);
      assert.ok(
        Math.abs(sampledH - expectedH) < 0.08,
        `Spiral drop/jump at ${deg} deg: expected ${expectedH.toFixed(3)}, got ${sampledH.toFixed(3)}`,
      );
      assert.ok(sampledH >= prevH - 0.01, `Height must increase smoothly along helix (${prevH} -> ${sampledH})`);
      prevH = sampledH;
    }

    // Ground-level vehicle beneath high Turn 2 overhang remains at ground grade
    const groundUnderX = sp.centerX + sp.dir * (-4.20);
    const groundUnderZ = sp.laneZ + sp.dir * 2.15;
    assert.equal(evaluateCourseHeight(groundUnderX, groundUnderZ, -0.45), -0.33);
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('horizontal football arena exposes dual full-width goal pockets within boundary lines', () => {
  let fbCourse = null;
  for (let s = 1; s <= 40; s++) {
    const c = generateRandomizedCourse('track_b', s * 4099);
    if (c.slots.some(sl => sl.type === 'football_arena')) {
      fbCourse = c;
      break;
    }
  }
  assert.ok(fbCourse, 'Expected football_arena in seed sweep');
  const fb = fbCourse.slots.find(sl => sl.type === 'football_arena')!;
  try {
    setActiveGeneratedCourse(fbCourse);
    // Wide left-to-right horizontal pitch (v up to +/-3.05) and both netted goal pockets (|v| up to 3.75)
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ, 0), true);
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ - 2.95, 0), true);
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ + 2.95, 0), true);
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ - 3.45, 0), true);
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ + 3.45, 0), true);
    // Out-of-bounds beyond behind goal rear net
    assert.equal(isLocalPointWithinBoundaryLines(fb.centerX, fb.laneZ + 4.10, 0), false);
    assert.ok(Math.abs(evaluateCourseHeight(fb.centerX, fb.laneZ + 3.45, -0.1) - (GROUND_DECK_HEIGHT + 0.016)) < 1e-6);
    assert.equal(evaluateCourseHeight(fb.centerX + fb.dir * 3.8, fb.laneZ, -0.1), GROUND_DECK_HEIGHT);
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('long ramp descents (spiral viaduct and high climb) follow slope continuously without auto-falling', () => {
  let spCourse = null;
  let hcCourse = null;
  for (let s = 1; s <= 50; s++) {
    const c = generateRandomizedCourse('track_b', s * 6133);
    if (!spCourse && c.slots.some(sl => sl.type === 'spiral_tower')) spCourse = c;
    if (!hcCourse && c.slots.some(sl => sl.type === 'high_climb')) hcCourse = c;
    if (spCourse && hcCourse) break;
  }
  assert.ok(spCourse && hcCourse, 'Expected both spiral_tower and high_climb slots in seed sweep');

  const testRampDescent = (course: typeof spCourse, startLocalX: number, startLocalZ: number, speedMps: number, dir: 1 | -1, durationSec: number) => {
    setActiveGeneratedCourse(course);
    const groundAtStart = evaluateCourseHeight(startLocalX, startLocalZ, 2.6);
    const pose: VehiclePose = {
      x: startLocalX * MAP_SCALE,
      y: groundAtStart - TRACK_CONTACT_OFFSET,
      z: startLocalZ * MAP_SCALE,
      vx: dir * speedMps,
      vy: 0,
      vz: 0,
      yaw: dir > 0 ? 0 : Math.PI,
      yawRate: 0,
      roll: 0,
      pitch: 0,
      rollRate: 0,
      pitchRate: 0,
      isGrounded: true,
      isFlipped: false,
      flippedTimer: 0,
      lastImpactSpeed: 0,
    };
    const worldHeight = (wx: number, wz: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y);
    const dt = 1 / 60;
    let airborneFrames = 0;
    let maxImpact = 0;
    const steps = Math.round(durationSec / dt);
    for (let i = 0; i < steps; i++) {
      pose.vx = dir * speedMps;
      pose.x += pose.vx * dt;
      stepVehicle3D(pose, worldHeight, speedMps, 0, dt);
      if (!pose.isGrounded) airborneFrames += 1;
      maxImpact = Math.max(maxImpact, pose.lastImpactSpeed ?? 0);
    }
    assert.equal(airborneFrames, 0, `Expected continuous grounded slope tracking without auto-fall, got ${airborneFrames} airborne frames`);
    assert.ok(maxImpact <= 2.5, `Expected gentle continuous slope contact, got maxImpact ${maxImpact.toFixed(2)}`);
  };

  try {
    const sp = spCourse!.slots.find(sl => sl.type === 'spiral_tower')!;
    testRampDescent(spCourse!, sp.centerX + sp.dir * 4.5, sp.laneZ, 5.2, sp.dir, 2.0);

    const hc = hcCourse!.slots.find(sl => sl.type === 'high_climb')!;
    testRampDescent(hcCourse!, hc.centerX + hc.dir * 0.4, hc.laneZ, 4.8, hc.dir, 1.5);
  } finally {
    setActiveGeneratedCourse(null);
  }

  // Soft ramp touch-down near bottom must produce zero cliff fall penalties
  const slopeLanding = evaluateFallOutcome({
    dropHeightM: 0.45,
    impactSpeedMps: 2.8,
    horizontalSpeedMps: 4.0,
    landingPlace: 'lower_track',
    originZone: 'spiral_tower',
    isInverted: false,
    slopeGx: 0.35,
    slopeGz: 0,
    vx: 4.0,
    vz: 0,
  }, DEFAULT_SCORING_CONFIG);
  assert.equal(slopeLanding.significantFall, false);
  assert.equal(slopeLanding.pointsPenalty, 0);
});

test('pendulum wrecking ball collision and moderate bridge drop apply calibrated non-wipeout damage', () => {
  const subs = createInitialSubsystems();
  const hitLoss = applyPendulumImpactDamage(subs, 4.2);
  const strikeScore = evaluatePendulumStrikeDamage(4.2, DEFAULT_SCORING_CONFIG);
  assert.ok(hitLoss >= 10 && hitLoss <= 24, `Direct pendulum strike loss should be calibrated 10-24%, got ${hitLoss.toFixed(1)}%`);
  assert.ok(strikeScore.pointsPenalty >= 4 && strikeScore.pointsPenalty <= 10);

  // Even following up with a fall from the 1.35m bridge onto arena floor (-0.33m) must not exceed 80% total wipeout in one hit
  const subsFall = createInitialSubsystems();
  const bridgeDropLoss = applyFallImpactDamage(subsFall, 6.2, 'none');
  assert.ok(bridgeDropLoss < 60, `Moderate bridge drop damage should stay below 60%, got ${bridgeDropLoss.toFixed(1)}%`);
});

test('hanging chain bridges stretch down under weight, sway left-right asymmetrically, and keep tracks supported', () => {
  let hbCourse = null;
  for (let s = 1; s <= 50; s++) {
    const c = generateRandomizedCourse('track_b', s * 7919);
    if (c.slots.some(sl => sl.type === 'hanging_bridges')) {
      hbCourse = c;
      break;
    }
  }
  assert.ok(hbCourse, 'Expected hanging_bridges in seed sweep');
  const hb = hbCourse!.slots.find(sl => sl.type === 'hanging_bridges')!;
  const state = hbCourse!.hangingBridgeStates[hb.index];
  assert.ok(state, 'Expected initialized HangingBridgeState on generated course');

  try {
    setActiveGeneratedCourse(hbCourse);
    const startX = hb.centerX + hb.dir * (-4.4);
    const startH = evaluateCourseHeight(startX, hb.laneZ - 0.60, 0.88);
    const pose: VehiclePose = {
      x: startX * MAP_SCALE,
      y: startH - TRACK_CONTACT_OFFSET,
      z: hb.laneZ * MAP_SCALE,
      vx: hb.dir * 2.6,
      vy: 0,
      vz: 0,
      yaw: hb.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      yawRate: 0,
      roll: 0,
      pitch: 0,
      rollRate: 0,
      pitchRate: 0,
      isGrounded: true,
      isFlipped: false,
      flippedTimer: 0,
      lastImpactSpeed: 0,
    };

    const dt = 1 / 60;
    const worldHeight = (wx: number, wz: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y);
    let minMidY = 99;
    let maxAbsSwayL = 0;
    let maxAbsSwayR = 0;
    let seenPosSway = false;
    let seenNegSway = false;
    let maxRoll = 0;
    let maxSwayDiff = 0;
    let maxAsymVert = 0;
    let dropFailures = 0;

    // Cross full 9m local span (~11.7m world at 2.6 m/s => ~4.4s)
    for (let i = 0; i < 240; i++) {
      const rx = pose.x / MAP_SCALE;
      const rz = pose.z / MAP_SCALE;
      const stepRes = stepHangingBridgeState(
        state,
        hb,
        rx,
        rz,
        pose.y + TRACK_CONTACT_OFFSET,
        pose.roll,
        pose.yawRate,
        2.6,
        dt,
      );
      if (state.onBridge) {
        pose.z += hb.dir * stepRes.deltaMeanSwayV * MAP_SCALE;
      }
      pose.x += hb.dir * 2.6 * dt;
      stepVehicle3D(pose, worldHeight, 2.6, 0, dt);

      // Anchor towers at s=0 and s=1 must stay strictly pinned at 0.88m with 0 sway
      const anchor0L = sampleHangingBridgeRibbon(state, 0, 0);
      const anchor1R = sampleHangingBridgeRibbon(state, 1, 1);
      assert.ok(Math.abs(anchor0L.y - 0.88) < 1e-6 && Math.abs(anchor0L.swayV) < 1e-6);
      assert.ok(Math.abs(anchor1R.y - 0.88) < 1e-6 && Math.abs(anchor1R.swayV) < 1e-6);

      if (state.onBridge) {
        const sBot = state.smoothBotS;
        const rL = sampleHangingBridgeRibbon(state, 0, sBot);
        const rR = sampleHangingBridgeRibbon(state, 1, sBot);
        minMidY = Math.min(minMidY, rL.y, rR.y);
        maxAbsSwayL = Math.max(maxAbsSwayL, Math.abs(rL.swayV));
        maxAbsSwayR = Math.max(maxAbsSwayR, Math.abs(rR.swayV));
        if (rL.swayV > 0.05) seenPosSway = true;
        if (rL.swayV < -0.05) seenNegSway = true;
        maxSwayDiff = Math.max(maxSwayDiff, Math.abs(state.left.sway - state.right.sway));
        maxAsymVert = Math.max(maxAsymVert, Math.abs(rL.y - rR.y));
        maxRoll = Math.max(maxRoll, Math.abs(pose.roll));
        if (pose.y + TRACK_CONTACT_OFFSET < 0.0) dropFailures += 1;
      }
    }

    assert.equal(dropFailures, 0, `Rover dropped off moving planks unexpectedly ${dropFailures} times`);
    assert.ok(minMidY < 0.48, `Expected loaded chain bridge to stretch noticeably low (< 0.48m), got minMidY=${minMidY.toFixed(3)}m`);
    assert.ok(maxAbsSwayL >= 0.09 && maxAbsSwayR >= 0.09, `Expected active left-right sway, got L=${maxAbsSwayL.toFixed(3)}, R=${maxAbsSwayR.toFixed(3)}`);
    assert.ok(seenPosSway && seenNegSway, 'Expected alternating left-right motion across both positive and negative directions');
    assert.ok(maxAsymVert >= 0.04, `Expected asymmetric left vs right vertical deflection, got ${maxAsymVert.toFixed(3)}m`);
    assert.ok(maxRoll >= 0.02, `Expected physical roll response across independent planks, got ${maxRoll.toFixed(3)} rad`);
    assert.ok(maxSwayDiff <= 0.241, `Inner bridge collision safety violated: diff=${maxSwayDiff.toFixed(3)}m`);

    // Parking stationary at constant mid-bridge position (speed = 0, yawRate = 0):
    // bridge must damp any residual sway to zero instead of swinging endlessly on a preset loop
    for (let i = 0; i < 240; i++) {
      stepHangingBridgeState(state, hb, hb.centerX, hb.laneZ, 0.45, 0, 0, 0, dt);
    }
    assert.ok(Math.abs(state.left.sway) < 0.005 && Math.abs(state.right.sway) < 0.005, `Stationary bridge must settle sway to 0, got L=${state.left.sway}, R=${state.right.sway}`);
    assert.ok(Math.abs(state.left.swayVel) < 0.008 && Math.abs(state.right.swayVel) < 0.008, 'Stationary bridge sway velocity must decay cleanly to rest');
    assert.ok(sampleHangingBridgeRibbon(state, 0, 0.5).y < 0.48, 'Static weight sag must still remain deflected under parked bot');

    // After unloading, chains smoothly spring back toward resting catenary (0.74m at midspan) with 0 wind wobble
    for (let i = 0; i < 240; i++) {
      stepHangingBridgeState(state, hb, null, null, 0, 0, 0, 0, dt);
    }
    const unloadedMid = sampleHangingBridgeRibbon(state, 0, 0.5);
    assert.ok(Math.abs(unloadedMid.y - 0.74) < 0.015, `Unloaded chain should settle cleanly at static resting sag (0.74m), got ${unloadedMid.y.toFixed(3)}m`);
    assert.ok(Math.abs(unloadedMid.swayV) < 1e-4, `Unloaded bridge sway must decay to zero, got ${unloadedMid.swayV}`);
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('diagonal and turning maneuvers across steep continuous high_climb ramp never trigger false rollover', () => {
  let climbCourse = null;
  for (let s = 1; s <= 60; s++) {
    const c = generateRandomizedCourse('track_d', s * 6151);
    if (c.slots.some(sl => sl.type === 'high_climb')) {
      climbCourse = c;
      break;
    }
  }
  assert.ok(climbCourse, 'Expected high_climb to appear within 60 seeds');
  const slot = climbCourse!.slots.find(sl => sl.type === 'high_climb')!;

  try {
    setActiveGeneratedCourse(climbCourse);
    const startU = -6.8;
    const startX = slot.centerX + slot.dir * startU;
    const startH = evaluateCourseHeight(startX, slot.laneZ, GROUND_DECK_HEIGHT);
    const pose: VehiclePose = {
      x: startX * MAP_SCALE,
      y: startH - TRACK_CONTACT_OFFSET,
      z: slot.laneZ * MAP_SCALE,
      vx: slot.dir * 3.0,
      vy: 0,
      vz: 0,
      yaw: slot.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      yawRate: 0,
      roll: 0,
      pitch: 0,
      rollRate: 0,
      pitchRate: 0,
      isGrounded: true,
      isFlipped: false,
      flippedTimer: 0,
      lastImpactSpeed: 0,
    };
    const dt = 1 / 60;
    const worldHeight = (wx: number, wz: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y);

    for (let i = 0; i < 360; i++) {
      // Swerve diagonally within the continuous steep ramp corridor (0.55 rad sway without driving off the side cliff)
      const desiredYaw = (slot.dir > 0 ? Math.PI / 2 : -Math.PI / 2) + 0.42 * Math.sin(i * 0.08);
      pose.yaw = desiredYaw;
      const spd = 3.2;
      pose.x += Math.sin(pose.yaw) * spd * dt;
      pose.z += Math.cos(pose.yaw) * spd * dt;
      stepVehicle3D(pose, worldHeight, spd, Math.cos(i * 0.08) * 0.65, dt);
      assert.equal(pose.isFlipped, false, `False rollover triggered during diagonal climb at step ${i}`);
      const u = (pose.x / MAP_SCALE - slot.centerX) * slot.dir;
      if (u > 6.8) break;
    }
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('flared pendulum/hanging ramps and 540-degree spiral summit exit prevent edge-seam height drops', () => {
  const findCourseWith = (hurdleType: string) => {
    for (const trackId of TRACK_IDS) {
      for (let s = 1; s <= 60; s++) {
        const c = generateRandomizedCourse(trackId, s * 4099 + trackId.charCodeAt(trackId.length - 1));
        const slot = c.slots.find(sl => sl.type === hurdleType);
        if (slot) return { course: c, slot };
      }
    }
    throw new Error(`Expected ${hurdleType} within seed sweep`);
  };

  try {
    const { course: pendCourse, slot: pend } = findCourseWith('pendulum_bridge');
    setActiveGeneratedCourse(pendCourse);
    const pendEntryH = evaluateCourseHeight(
      pend.centerX + pend.dir * (-4.8),
      pend.laneZ + pend.dir * 1.60,
      GROUND_DECK_HEIGHT + 0.5,
    );
    const pendExitH = evaluateCourseHeight(
      pend.centerX + pend.dir * 4.8,
      pend.laneZ + pend.dir * (-1.60),
      GROUND_DECK_HEIGHT + 0.5,
    );
    assert.ok(pendEntryH > GROUND_DECK_HEIGHT + 0.15, `Flared pendulum entry ramp should support v=+1.60, got ${pendEntryH}`);
    assert.ok(pendExitH > GROUND_DECK_HEIGHT + 0.15, `Flared pendulum exit ramp should support v=-1.60, got ${pendExitH}`);

    const { course: hbCourse, slot: hb } = findCourseWith('hanging_bridges');
    setActiveGeneratedCourse(hbCourse);
    const hbEntryH = evaluateCourseHeight(
      hb.centerX + hb.dir * (-5.2),
      hb.laneZ + hb.dir * 1.60,
      GROUND_DECK_HEIGHT + 0.5,
    );
    assert.ok(hbEntryH > GROUND_DECK_HEIGHT + 0.15, `Flared hanging bridge entry ramp should support v=+1.60, got ${hbEntryH}`);

    const { course: spCourse, slot: sp } = findCourseWith('spiral_tower');
    setActiveGeneratedCourse(spCourse);
    const summitSeamH = evaluateCourseHeight(
      sp.centerX + sp.dir * (-4.20 + 2.15),
      sp.laneZ + sp.dir * 0.25,
      3.20 - TRACK_CONTACT_OFFSET,
    );
    assert.ok(summitSeamH >= 3.15, `Spiral 540-deg East summit seam (v=+0.25) must stay at 3.20m roof instead of dropping to Turn 1, got ${summitSeamH}`);
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('overhanging an elevated +1.35m bridge deck keeps upright and inverted chassis above solid deck without phasing', () => {
  const edgeWorldHeight = (_wx: number, wz: number) => (wz < 0.35 ? 1.35 : -0.33);
  const dt = 1 / 60;

  // Upright overhang: center + left track on +1.35m slab, right track overhanging -0.33m drop
  const upright: VehiclePose = {
    x: 0,
    y: 1.35 - TRACK_CONTACT_OFFSET,
    z: 0.0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI / 2,
    yawRate: 0,
    roll: 0,
    pitch: 0,
    rollRate: 0,
    pitchRate: 0,
    isGrounded: true,
    isFlipped: false,
    flippedTimer: 0,
    lastImpactSpeed: 0,
  };
  for (let i = 0; i < 60; i++) {
    stepVehicle3D(upright, edgeWorldHeight, 0, 0, dt);
  }
  assert.ok(
    upright.y + TRACK_CONTACT_OFFSET >= 1.15,
    `Upright overhanging chassis phased into +1.35m slab: ${upright.y + TRACK_CONTACT_OFFSET}`,
  );

  // Inverted overhang: even upside down on top of the solid slab, restingY must NOT sink below centerH
  const inverted: VehiclePose = {
    ...upright,
    y: 1.35 + 0.35,
    roll: Math.PI,
    isFlipped: true,
    flippedTimer: 0.5,
  };
  for (let i = 0; i < 60; i++) {
    stepVehicle3D(inverted, edgeWorldHeight, 0, 0, dt);
  }
  assert.ok(
    inverted.y >= 1.35,
    `Inverted chassis phased down through solid +1.35m deck slab: y=${inverted.y}`,
  );
});

test('recessed water basin tank sits below ground grade with smooth concrete wade ramps and Archimedes flotation', () => {
  const wbCourse = generateRandomizedCourse('track_a', 17321);
  const wb = wbCourse.slots.find(s => s.type === 'water_basin');
  assert.ok(wb, 'Expected mandatory water_basin slot in generated course');
  const pool = wbCourse.waterPools[0];
  assert.ok(pool, 'Expected matching WaterPoolConfig');
  assert.equal(pool.waterLevelY, DYNAMIC_WATER_LEVEL_Y);
  assert.equal(pool.bedLevelY, DYNAMIC_WATER_BED_Y);
  assert.ok(pool.waterLevelY < GROUND_DECK_HEIGHT, 'Water surface must sit recessed below road grade inside tank');
  assert.ok(pool.bedLevelY <= GROUND_DECK_HEIGHT - 0.70, 'Tank floor must be excavated >= 0.70m below road grade');

  try {
    setActiveGeneratedCourse(wbCourse);
    const entryApronH = evaluateCourseHeight(wb.centerX + wb.dir * (-4.5), wb.laneZ, GROUND_DECK_HEIGHT);
    const midSlopeH = evaluateCourseHeight(wb.centerX + wb.dir * (-3.15), wb.laneZ, GROUND_DECK_HEIGHT);
    const deepBedH = evaluateCourseHeight(wb.centerX, wb.laneZ, DYNAMIC_WATER_BED_Y);
    const exitSlopeH = evaluateCourseHeight(wb.centerX + wb.dir * 3.15, wb.laneZ, GROUND_DECK_HEIGHT);
    const exitApronH = evaluateCourseHeight(wb.centerX + wb.dir * 4.5, wb.laneZ, GROUND_DECK_HEIGHT);

    assert.equal(entryApronH, GROUND_DECK_HEIGHT);
    assert.ok(midSlopeH < GROUND_DECK_HEIGHT - 0.15 && midSlopeH > DYNAMIC_WATER_BED_Y + 0.15, `Wade entry ramp should slope smoothly, got ${midSlopeH}`);
    assert.equal(deepBedH, DYNAMIC_WATER_BED_Y);
    assert.ok(exitSlopeH < GROUND_DECK_HEIGHT - 0.15 && exitSlopeH > DYNAMIC_WATER_BED_Y + 0.15, `Wade exit ramp should climb smoothly, got ${exitSlopeH}`);
    assert.equal(exitApronH, GROUND_DECK_HEIGHT);

    // Dry entry lip vs submerged tank center buoyancy
    const drySurf = evaluateCourseSurface(wb.centerX + wb.dir * (-4.32), wb.laneZ, GROUND_DECK_HEIGHT);
    const wetSurf = evaluateCourseSurface(wb.centerX, wb.laneZ, DYNAMIC_WATER_BED_Y);
    assert.equal(drySurf.hazard, 'none');
    assert.equal(wetSurf.hazard, 'water');

    const submergedPoseY = DYNAMIC_WATER_LEVEL_Y - 0.35 - TRACK_CONTACT_OFFSET;
    const buoy = evaluateWaterBuoyancy(
      wb.centerX * MAP_SCALE,
      wb.laneZ * MAP_SCALE,
      submergedPoseY,
      wb.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      wb.dir * 1.5,
      0,
      2.0,
      2.0,
      0.56,
      MAP_SCALE,
      wbCourse.waterPools,
    );
    assert.equal(buoy.inWater, true);
    assert.equal(buoy.isFloating, true);
    assert.ok(buoy.buoyantWaterlineY + TRACK_CONTACT_OFFSET > DYNAMIC_WATER_BED_Y + 0.25, 'Floating rover must clear deep submerged concrete floor');
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('courses densely populate lane slots and include new technical hurdles across arenas', () => {
  const seen = new Set<string>();
  let totalSlots = 0;
  let runs = 0;

  for (const tid of TRACK_IDS) {
    for (let s = 1; s <= 25; s++) {
      const c = generateRandomizedCourse(tid, s * 11003 + tid.charCodeAt(6) * 19);
      totalSlots += c.slots.length;
      runs += 1;
      for (const sl of c.slots) seen.add(sl.type);
    }
  }

  const avgSlots = totalSlots / runs;
  assert.ok(avgSlots >= 8.0, `Expected dense lane occupancy (>= 8.0 slots avg), got ${avgSlots.toFixed(2)}`);
  for (const newType of ['moguls_stagger', 'step_staircase', 'camber_bank', 'sliding_gates']) {
    assert.ok(seen.has(newType), `Expected new obstacle ${newType} to appear across randomized courses`);
  }
});

test('robot negotiates moguls_stagger, step_staircase, and camber_bank cleanly without rollover', () => {
  const driveAcrossSlot = (hurdleType: 'moguls_stagger' | 'step_staircase' | 'camber_bank') => {
    let targetCourse = null;
    for (let s = 1; s <= 60; s++) {
      const c = generateRandomizedCourse('track_b', s * 7717);
      if (c.slots.some(sl => sl.type === hurdleType)) {
        targetCourse = c;
        break;
      }
    }
    assert.ok(targetCourse, `Expected ${hurdleType} within seed sweep`);
    const slot = targetCourse.slots.find(sl => sl.type === hurdleType)!;

    try {
      setActiveGeneratedCourse(targetCourse);
      const startX = (slot.centerX - slot.dir * 5.2) * MAP_SCALE;
      const startZ = slot.laneZ * MAP_SCALE;
      const pose: VehiclePose = {
        x: startX,
        y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
        z: startZ,
        vx: slot.dir * 2.8,
        vy: 0,
        vz: 0,
        pitch: 0,
        yaw: slot.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        roll: 0,
        pitchRate: 0,
        yawRate: 0,
        rollRate: 0,
        isFlipped: false,
        isGrounded: true,
        flippedTimer: 0,
        lastImpactSpeed: 0,
      };
      let peakHeight = GROUND_DECK_HEIGHT;
      let maxAbsRoll = 0;
      const dt = 1 / 60;
      const steps = 260;
      const worldHeight = (wx: number, wz: number, curY?: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, curY);
      for (let i = 0; i < steps; i++) {
        pose.vx = slot.dir * 2.8;
        pose.vz = 0;
        pose.x += pose.vx * dt;
        stepVehicle3D(pose, worldHeight, 2.8, 0, dt);
        assert.equal(pose.isFlipped, false, `Unexpected rollover traversing ${hurdleType} at step ${i} (roll=${pose.roll.toFixed(3)}, pitch=${pose.pitch.toFixed(3)})`);
        peakHeight = Math.max(peakHeight, pose.y + TRACK_CONTACT_OFFSET);
        maxAbsRoll = Math.max(maxAbsRoll, Math.abs(pose.roll));
      }
      assert.ok(peakHeight > GROUND_DECK_HEIGHT + 0.15, `${hurdleType} did not physically elevate the robot (peak=${peakHeight.toFixed(3)})`);
      if (hurdleType === 'moguls_stagger' || hurdleType === 'camber_bank') {
        assert.ok(maxAbsRoll > 0.04, `${hurdleType} should engage realistic lateral roll articulation (maxRoll=${maxAbsRoll.toFixed(3)})`);
      }
    } finally {
      setActiveGeneratedCourse(null);
    }
  };

  driveAcrossSlot('moguls_stagger');
  driveAcrossSlot('step_staircase');
  driveAcrossSlot('camber_bank');
});

test('roller_logs tracks stay cleanly above staggered and center logs across all belt stations', () => {
  let rlCourse = null;
  for (let s = 1; s <= 60; s++) {
    const c = generateRandomizedCourse('track_b', s * 3313);
    if (c.slots.some(sl => sl.type === 'roller_logs')) {
      rlCourse = c;
      break;
    }
  }
  assert.ok(rlCourse, 'Expected roller_logs within seed sweep');
  const slot = rlCourse.slots.find(sl => sl.type === 'roller_logs')!;

  try {
    setActiveGeneratedCourse(rlCourse);
    const dt = 1 / 60;
    const pose: VehiclePose = {
      x: (slot.centerX - slot.dir * 4.8) * MAP_SCALE,
      y: GROUND_DECK_HEIGHT - TRACK_CONTACT_OFFSET,
      z: slot.laneZ * MAP_SCALE,
      vx: slot.dir * 2.6,
      vy: 0,
      vz: 0,
      pitch: 0,
      yaw: slot.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      roll: 0,
      pitchRate: 0,
      yawRate: 0,
      rollRate: 0,
      isFlipped: false,
      isGrounded: true,
      flippedTimer: 0,
      lastImpactSpeed: 0,
    };
    const worldHeight = (wx: number, wz: number) => evaluateCourseHeight(wx / MAP_SCALE, wz / MAP_SCALE, pose.y);

    let sawLift = false;
    let sawRoll = false;
    for (let step = 0; step < 260; step++) {
      pose.vx = slot.dir * 2.6;
      pose.vz = 0;
      pose.x += pose.vx * dt;
      stepVehicle3D(pose, worldHeight, 2.6, 0, dt);
      assert.equal(pose.isFlipped, false, `Unexpected rollover on roller_logs step ${step}`);
      const trackBottomCenter = pose.y + TRACK_CONTACT_OFFSET;
      if (trackBottomCenter > GROUND_DECK_HEIGHT + 0.08) sawLift = true;
      if (Math.abs(pose.roll) > 0.03) sawRoll = true;

      // Verify rigid track corners & belt stations stay flush or above terrain beneath both tracks
      const fwdX = Math.sin(pose.yaw);
      const fwdZ = Math.cos(pose.yaw);
      const rightX = Math.cos(pose.yaw);
      const rightZ = -Math.sin(pose.yaw);
      for (const side of [-1, 1]) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const locFwd = (t - 0.5) * 1.70;
          const locRight = side * 0.79;
          const px = pose.x + fwdX * locFwd + rightX * locRight;
          const pz = pose.z + fwdZ * locFwd + rightZ * locRight;
          const terrainY = worldHeight(px, pz);
          // Chassis underside height at local (locFwd, locRight) under current roll/pitch
          const beltBottomY = trackBottomCenter - Math.sin(pose.pitch) * locFwd + Math.sin(pose.roll) * locRight;
          assert.ok(
            beltBottomY >= terrainY - 0.04,
            `Belt sank into log at step ${step} side=${side} t=${t}: beltY=${beltBottomY.toFixed(3)} < logY=${terrainY.toFixed(3)}`,
          );
        }
      }
    }
    assert.ok(sawLift, 'Robot must physically climb over roller logs');
    assert.ok(sawRoll, 'Staggered half-logs must articulate left/right suspension roll');
  } finally {
    setActiveGeneratedCourse(null);
  }
});

test('spiral tower colliders produce zero phantom barrier hits across full 540-degree climb and summit', () => {
  const spiralCourses = [];
  for (let s = 1; s <= 40 && spiralCourses.length < 2; s++) {
    const c = generateRandomizedCourse('track_b', s * 9973);
    const sp = c.slots.find(sl => sl.type === 'spiral_tower');
    if (sp) spiralCourses.push({ c, sp });
  }
  assert.ok(spiralCourses.length >= 1, 'Expected at least one spiral_tower course');

  for (const { sp } of spiralCourses) {
    const { colliders: spColliders } = buildSpiralTowerColliders(sp);
    const spU = -4.20;
    const yTop = 3.20;

    // 1. Continuous 540° helical sweep across inner-to-outer drivable track corridor:
    //    r >= 1.60 tangent-aligned (inner edge 0.84m > 0.78m column) and r in [1.75..2.90] with +-0.35 rad steering
    const helixChecks: Array<{ r: number; yaws: number[] }> = [
      { r: 1.60, yaws: [0] },
      { r: 1.75, yaws: [-0.35, 0, 0.35] },
      { r: 2.00, yaws: [-0.35, 0, 0.35] },
      { r: 2.15, yaws: [-0.35, 0, 0.35] },
      { r: 2.45, yaws: [-0.35, 0, 0.35] },
      { r: 2.70, yaws: [-0.35, 0, 0.35] },
      { r: 2.90, yaws: [-0.35, 0, 0.35] },
    ];
    for (const { r, yaws } of helixChecks) {
      for (let deg = 0; deg <= 540; deg += 5) {
        const t = deg / 540;
        const beta = t * 3 * Math.PI;
        const u = spU - Math.cos(beta) * r;
        const v = -Math.sin(beta) * r;
        const h = GROUND_DECK_HEIGHT + t * (yTop - GROUND_DECK_HEIGHT);
        const lx = sp.centerX + sp.dir * u;
        const lz = sp.laneZ + sp.dir * v;
        const baseYaw = Math.atan2(sp.dir * Math.sin(beta), sp.dir * (-Math.cos(beta)));
        for (const dyaw of yaws) {
          const hit = evaluateBarrierCollision(lx * MAP_SCALE, lz * MAP_SCALE, baseYaw + dyaw, h - 0.12, spColliders, MAP_SCALE);
          assert.equal(
            hit,
            null,
            `Unexpected phantom barrier '${hit?.id}' on spiral helix at r=${r}, deg=${deg}, dyaw=${dyaw}`,
          );
        }
      }
    }

    // 2. Summit apron (u >= -0.90 full width, plus South exit transition u in [-2.5..-0.9] for v >= 0.8), turntable & descent viaduct sweep
    for (let u = -0.90; u <= 11.8; u += 0.4) {
      for (const v of [-1.0, 0, 1.0]) {
        let h = yTop;
        if (u >= 4.4) {
          const dt = Math.max(0, Math.min(1, (u - 4.4) / 7.4));
          h = yTop + (GROUND_DECK_HEIGHT - yTop) * dt * dt * (3 - 2 * dt);
        }
        const lx = sp.centerX + sp.dir * u;
        const lz = sp.laneZ + sp.dir * v;
        const yaw = sp.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        const hit = evaluateBarrierCollision(lx * MAP_SCALE, lz * MAP_SCALE, yaw, h - 0.12, spColliders, MAP_SCALE);
        assert.equal(hit, null, `Unexpected phantom barrier '${hit?.id}' on summit/descent at u=${u}, v=${v}`);
      }
    }
    for (let u = -2.5; u < -0.90; u += 0.4) {
      for (const v of [0.8, 1.0]) {
        const lx = sp.centerX + sp.dir * u;
        const lz = sp.laneZ + sp.dir * v;
        const yaw = sp.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        const hit = evaluateBarrierCollision(lx * MAP_SCALE, lz * MAP_SCALE, yaw, yTop - 0.12, spColliders, MAP_SCALE);
        assert.equal(hit, null, `Unexpected phantom barrier '${hit?.id}' on summit exit apron at u=${u}, v=${v}`);
      }
    }

    // 3. True central steel pylon (r=0.78m) still blocks direct impact while staying inscribed inside 0.78m
    const hitCenterCore = evaluateBarrierCollision(
      (sp.centerX + sp.dir * (spU - 1.30)) * MAP_SCALE,
      sp.laneZ * MAP_SCALE,
      Math.PI / 2,
      0.50 - 0.12,
      spColliders,
      MAP_SCALE,
    );
    assert.ok(hitCenterCore && hitCenterCore.id.startsWith('spiral_core_'), 'Central column must remain a solid barrier on real impact');
  }
});
