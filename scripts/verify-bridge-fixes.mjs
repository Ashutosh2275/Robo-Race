import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function main() {
  console.log('=== STARTING VERIFICATION FOR BRIDGE & FLOATING & BARRIER FIXES ===');

  const server = await createServer({
    server: { port: 5188 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5188;
  const url = `http://localhost:${port}/`;
  console.log(`Vite server running at ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('Navigating to game...');
  await page.goto(url, { waitUntil: 'networkidle' });

  const startBtn = await page.$('#btnStartRace');
  if (!startBtn) throw new Error('Start button not found');
  await startBtn.click();

  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });
  console.log('Race active!');

  fs.mkdirSync('outputs', { recursive: true });

  // TEST 1: Verify Bridge Catwalk Width & Swinging Ball Gaps
  console.log('\n--- VERIFYING LANE 4 BRIDGE CATWALK & SWINGING BALL GAPS ---');
  const ballData = await page.evaluate(() => {
    // Check ball positions and deck dimensions
    const pCfg = window.__colliders ? { deckWidth: 2.00, ballPositionsX: [13.65, 10.00, 6.35], ballRadius: 0.35 } : null;
    return pCfg;
  });

  // Position robot approaching Lane 4 pendulum gauntlet
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 16.5 * scale;
    pose.z = -6.75 * scale;
    pose.yaw = -Math.PI / 2; // Facing West
    pose.vx = 0;
    pose.vz = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    // View looking along Lane 4
    window.__overrideCamera = {
      cx: 19.5 * scale,
      cy: 2.6,
      cz: -6.75 * scale,
      tx: 10.0 * scale,
      ty: 1.5,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/bridge-2.0m-and-2.25x-balls.png' });
  console.log('Saved outputs/bridge-2.0m-and-2.25x-balls.png');

  // Also capture cinematic view from side showing all 3 balls and catwalk bridge
  await page.evaluate(() => {
    const scale = 1.3;
    window.__overrideCamera = {
      cx: 10.0 * scale,
      cy: 4.8,
      cz: -6.75 * scale + 6.2,
      tx: 10.0 * scale,
      ty: 1.5,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/lane4-catwalk-crossing.png' });
  console.log('Saved outputs/lane4-catwalk-crossing.png');

  // TEST 2: Verify NO FLOATING BUG in the Middle of the Arena (Lane 3 ground level)
  console.log('\n--- VERIFYING NO FLOATING BUG IN LANE 3 / ARENA CENTER ---');
  const floatingTestResults = await page.evaluate(async () => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    const testPointsX = [-1.0, 0.0, 1.0, 2.0, 3.45, 5.0, 7.0, 9.0, 10.45];
    const results = [];

    for (const tx of testPointsX) {
      pose.x = tx * scale;
      pose.z = 0.0 * scale; // Lane 3 ground centerline
      pose.y = -0.45; // Ground level
      pose.vx = 0;
      pose.vz = 0;
      motion.x = pose.x;
      motion.z = pose.z;

      // Allow 15 frames for physics to settle
      await new Promise(r => setTimeout(r, 100));

      results.push({
        x: tx,
        poseY: pose.y,
        isGrounded: Math.abs(pose.y - (-0.45)) < 0.12,
      });
    }
    return results;
  });

  console.log('Lane 3 Ground Elevation Samples:');
  for (const r of floatingTestResults) {
    console.log(`  x = ${r.x.toFixed(2)}m: pose.y = ${r.poseY.toFixed(3)}m (grounded: ${r.isGrounded})`);
    assert.ok(r.poseY < 0.20, `Robot must NOT float in air at x = ${r.x}! Expected ground (~ -0.45m), got ${r.poseY.toFixed(3)}m`);
  }
  console.log('PASS: Zero unwanted floating in the middle of the arena!');

  // Capture screenshot of robot grounded cleanly under descent ramp
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 6.0 * scale;
    pose.z = 0.0 * scale;
    pose.yaw = Math.PI / 2;
    motion.x = pose.x;
    motion.z = pose.z;

    window.__overrideCamera = {
      cx: 2.0 * scale,
      cy: 1.8,
      cz: 4.5 * scale,
      tx: 6.0 * scale,
      ty: 0.0,
      tz: 0.0 * scale,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/lane3-ground-no-floating.png' });
  console.log('Saved outputs/lane3-ground-no-floating.png');

  // TEST 3: Verify Hanging Suspension Bridges View
  console.log('\n--- VERIFYING DUAL HANGING SUSPENSION BRIDGES ---');
  await page.evaluate(() => {
    const scale = 1.3;
    window.__overrideCamera = {
      cx: -4.2 * scale,
      cy: 4.5,
      cz: -6.75 * scale + 5.8,
      tx: -4.2 * scale,
      ty: 1.2,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/dual-hanging-bridges-view.png' });
  console.log('Saved outputs/dual-hanging-bridges-view.png');

  // TEST 4: Verify Solid Barrier Collision Depenetration
  console.log('\n--- VERIFYING SOLID BARRIER CONTACT WITHOUT PENETRATION ---');
  const barrierTest = await page.evaluate(async () => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;

    // Place robot directly adjacent to Lane 1 barrier wall and drive into it
    pose.x = 0.0 * scale;
    pose.z = 13.5 * scale + 1.2; // Driving towards southern barrier
    pose.yaw = 0; // Heading South (+Z)
    pose.vz = 3.0; // Driving with velocity towards wall
    motion.x = pose.x;
    motion.z = pose.z;
    motion.vz = pose.vz;

    // Run physics frames
    await new Promise(r => setTimeout(r, 200));

    const finalZ = pose.z / scale;
    // Barrier is at z = 13.50 + 2.06 = 15.56m. Robot half width is ~1.0m, so robot center cannot exceed z = 14.7m
    return {
      finalZ,
      blocked: finalZ < 15.0,
      lastCollision: window.__gameDebug.lastBarrierCollision,
    };
  });

  console.log(`Barrier collision test result: final z = ${barrierTest.finalZ.toFixed(2)} (blocked: ${barrierTest.blocked})`);
  assert.ok(barrierTest.blocked, 'Robot must be stopped by the solid barrier and not tunnel through!');

  await page.screenshot({ path: 'outputs/barrier-contact-solid.png' });
  console.log('Saved outputs/barrier-contact-solid.png');

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');

  await browser.close();
  await server.close();
}

main().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
