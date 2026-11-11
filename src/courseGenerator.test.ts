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
  type TrackId,
} from './courseLayout.ts';
import {
  DEFAULT_SCORING_CONFIG,
  awardFootballGoalPoints,
  createCompetitionScoreState,
  isLocalPointWithinBoundaryLines,
} from './scoringRules.ts';

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
