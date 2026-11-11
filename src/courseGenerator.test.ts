import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_METADATA,
  HURDLE_CATALOG,
  generateRandomizedCourse,
  setActiveGeneratedCourse,
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
