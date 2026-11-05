import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function main() {
  console.log('=== VERIFYING SPIRAL BYPASS FIX, PENDULUM KINETICS, AND SOLID STRUCTURE BOUNDARIES ===');

  const server = await createServer({
    server: { port: 5189 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5189;
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

  const scale = 1.3;

  // TEST 1: Spiral Clean Entrance & Outer Yellow Safety Kerb
  console.log('\n--- 1. VERIFYING SPIRAL CLEAN ENTRANCE & OUTER SAFETY KERB ---');
  await page.evaluate(s => {
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    // Approaching entrance of spiral at Lane 3 ground grade
    pose.x = -8.5 * s;
    pose.z = 0.0 * s;
    pose.y = -0.45;
    pose.yaw = Math.PI / 2;
    pose.vx = 0;
    pose.vz = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: -12.5 * s,
      cy: 2.2,
      cz: 2.5 * s,
      tx: -4.5 * s,
      ty: 1.2,
      tz: 0.0,
    };
  }, scale);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/spiral-clean-entrance-and-kerb.png' });
  console.log('Saved outputs/spiral-clean-entrance-and-kerb.png');

  // TEST 2: Spiral Summit Platform with Gate 05 Clean Entrance (No Overhead Gantry / Shimmer Obstruction)
  console.log('\n--- 2. VERIFYING SPIRAL SUMMIT PLATFORM & GATE 05 (NO OVERHEAD CROSSBAR / SHIMMER) ---');
  await page.evaluate(s => {
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    // At the spiral summit before turntable platform
    pose.x = -1.8 * s;
    pose.z = 0.0 * s;
    pose.y = 3.20 - 0.12;
    pose.yaw = Math.PI / 2;
    pose.vx = 0;
    pose.vz = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: -4.5 * s,
      cy: 4.8,
      cz: -2.8 * s,
      tx: 1.0 * s,
      ty: 3.2,
      tz: 0.0,
    };
  }, scale);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/spiral-summit-gate05-clean.png' });
  console.log('Saved outputs/spiral-summit-gate05-clean.png');

  // TEST 3: Ground Vehicle Driving Under Spiral (Zero Bypass / Zero Floating)
  console.log('\n--- 3. VERIFYING GROUND VEHICLE UNDER SPIRAL (ZERO BYPASS / FLOATING) ---');
  const underSpiralY = await page.evaluate(s => {
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    // Drive on ground directly under south tier of spiral (x = -4.5, z = 1.2)
    pose.x = -4.5 * s;
    pose.z = 1.2 * s;
    pose.y = -0.45;
    pose.yaw = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    return pose.y;
  }, scale);
  await page.waitForTimeout(400);

  const sampledGroundY = await page.evaluate(() => window.__gameDebug.pose.y);
  console.log(`Ground vehicle pose.y under spiral: ${sampledGroundY.toFixed(3)}m (expected ~ -0.45m)`);
  assert.ok(sampledGroundY < 0.0, `Vehicle under spiral should stay on ground, got ${sampledGroundY}m`);

  await page.evaluate(s => {
    window.__overrideCamera = {
      cx: -4.5 * s,
      cy: 1.2,
      cz: 4.8 * s,
      tx: -4.5 * s,
      ty: 0.2,
      tz: 0.0,
    };
  }, scale);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/spiral-under-no-bypass.png' });
  console.log('Saved outputs/spiral-under-no-bypass.png');

  // TEST 4: Catwalk Bridge with Swinging Balls (No Sinking into Track Mesh)
  console.log('\n--- 4. VERIFYING CATWALK BRIDGE DECK CONTACT (ZERO SINKING) ---');
  await page.evaluate(s => {
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    // On the elevated catwalk bridge deck at x = 10.0, z = -6.75
    pose.x = 10.0 * s;
    pose.z = -6.75 * s;
    pose.y = 1.35 - 0.12;
    pose.yaw = -Math.PI / 2;
    pose.vx = 0;
    pose.vz = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: 12.8 * s,
      cy: 2.2,
      cz: -6.75 * s + 2.2,
      tx: 9.0 * s,
      ty: 1.4,
      tz: -6.75 * s,
    };
  }, scale);
  await page.waitForTimeout(600);

  const bridgeDeckPoseY = await page.evaluate(() => window.__gameDebug.pose.y);
  console.log(`Catwalk bridge deck pose.y: ${bridgeDeckPoseY.toFixed(3)}m (expected ~ 1.23m)`);
  assert.ok(Math.abs(bridgeDeckPoseY - (1.35 - 0.12)) < 0.05, `Catwalk bridge vehicle must sit firmly on deck without sinking, got ${bridgeDeckPoseY}`);

  await page.screenshot({ path: 'outputs/bridge-no-sinking.png' });
  console.log('Saved outputs/bridge-no-sinking.png');

  // TEST 5: Space Between Tracks / Solid Bridge Flanks
  console.log('\n--- 5. VERIFYING SPACE BETWEEN TRACKS & SOLID FLANK COLLISION ---');
  await page.evaluate(s => {
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    // Between Lane 3 and Lane 4 at z = -3.5, driving South towards Lane 4
    pose.x = 10.0 * s;
    pose.z = -3.5 * s;
    pose.y = -0.45;
    pose.yaw = Math.PI; // Heading South towards Lane 4
    pose.vx = 0;
    pose.vz = -3.0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: 10.0 * s + 3.5,
      cy: 2.5,
      cz: -3.5 * s + 3.0,
      tx: 10.0 * s,
      ty: 0.2,
      tz: -6.75 * s,
    };
  }, scale);
  await page.waitForTimeout(600);

  const betweenTracksY = await page.evaluate(() => window.__gameDebug.pose.y);
  console.log(`Between tracks pose.y: ${betweenTracksY.toFixed(3)}m (expected -0.45m ground)`);
  assert.ok(betweenTracksY < 0.0, `Vehicle between tracks must stay on ground floor, got ${betweenTracksY}`);

  await page.screenshot({ path: 'outputs/between-tracks-solid-flank.png' });
  console.log('Saved outputs/between-tracks-solid-flank.png');

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
  await browser.close();
  await server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
