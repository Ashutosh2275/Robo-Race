import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:assert/strict';
import nodeFs from 'node:fs';

async function main() {
  console.log('--- STARTING LANE 4 OBSTACLES VERIFICATION ---');

  const server = await createServer({
    server: { port: 5177 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5177;
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
  console.log('Clicking START RACE...');
  await startBtn.click();

  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });
  console.log('Race active!');

  nodeFs.mkdirSync('outputs', { recursive: true });

  // 1. Move camera & robot directly to Gate 09 facing West into the Swinging Pendulums Gauntlet
  console.log('Inspecting Gate 09 Swinging Pendulum Gauntlet...');
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 15.5 * scale;
    pose.z = -6.75 * scale;
    pose.yaw = -Math.PI / 2; // Facing West
    pose.vx = 0;
    pose.vz = 0;
    pose.pitch = 0;
    pose.roll = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;
    motion.vx = 0;
    motion.vz = 0;

    // Position camera right behind vehicle looking at the new obstacle
    window.__overrideCamera = {
      cx: 19.0 * scale,
      cy: 2.2,
      cz: -6.75 * scale,
      tx: 10.5 * scale,
      ty: 1.2,
      tz: -6.75 * scale,
    };
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/lane4-gate09-pendulums-approach.png' });
  console.log('Saved outputs/lane4-gate09-pendulums-approach.png');

  // Also take an elevated cinematic overview of the swinging pendulums
  await page.evaluate(() => {
    const scale = 1.3;
    window.__overrideCamera = {
      cx: 10.5 * scale,
      cy: 4.8,
      cz: -6.75 * scale + 5.5,
      tx: 10.5 * scale,
      ty: 1.0,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/lane4-pendulums-cinematic-side.png' });
  console.log('Saved outputs/lane4-pendulums-cinematic-side.png');

  // 2. Drive vehicle onto the narrow deck of the pendulum gauntlet
  console.log('Driving onto narrow deck...');
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 11.5 * scale;
    pose.z = -6.75 * scale;
    pose.yaw = -Math.PI / 2;
    pose.vx = 0;
    pose.vz = 0;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: 14.5 * scale,
      cy: 2.4,
      cz: -6.75 * scale,
      tx: 10.5 * scale,
      ty: 1.0,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(400);
  const deckProbe = await page.evaluate(() => window.__gameDebug.groundContact);
  console.log('On-deck terrain height:', deckProbe.terrainY);
  if (Math.abs(deckProbe.terrainY - 0.85) > 0.05) {
    throw new Error(`Expected deck height ~0.85m, got ${deckProbe.terrainY}`);
  }
  await page.screenshot({ path: 'outputs/lane4-on-narrow-deck.png' });
  console.log('Saved outputs/lane4-on-narrow-deck.png');

  // 3. Inspect Dual Hanging Suspension Bridges
  console.log('Inspecting Dual Hanging Suspension Bridges...');
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 4.8 * scale;
    pose.z = -6.75 * scale;
    pose.yaw = -Math.PI / 2;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    // View looking along the dual hanging bridges
    window.__overrideCamera = {
      cx: 6.5 * scale,
      cy: 2.8,
      cz: -6.75 * scale,
      tx: -2.0 * scale,
      ty: 1.2,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/lane4-dual-hanging-bridges-approach.png' });
  console.log('Saved outputs/lane4-dual-hanging-bridges-approach.png');

  // Side cinematic view of the 11m suspension bridge structure
  await page.evaluate(() => {
    const scale = 1.3;
    window.__overrideCamera = {
      cx: -2.0 * scale,
      cy: 3.5,
      cz: -6.75 * scale + 6.0,
      tx: -2.0 * scale,
      ty: 1.0,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/lane4-dual-hanging-bridges-side.png' });
  console.log('Saved outputs/lane4-dual-hanging-bridges-side.png');

  // Drive across the suspended deck
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = -1.0 * scale;
    pose.z = -6.75 * scale;
    pose.yaw = -Math.PI / 2;
    motion.x = pose.x;
    motion.z = pose.z;
    motion.yaw = pose.yaw;

    window.__overrideCamera = {
      cx: 1.5 * scale,
      cy: 2.2,
      cz: -6.75 * scale,
      tx: -4.0 * scale,
      ty: 1.0,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(400);
  const bridgeProbe = await page.evaluate(() => window.__gameDebug.groundContact);
  console.log('Suspended bridge deck height:', bridgeProbe.terrainY);
  if (Math.abs(bridgeProbe.terrainY - 0.80) > 0.05) {
    throw new Error(`Expected suspension bridge deck height ~0.80m, got ${bridgeProbe.terrainY}`);
  }
  await page.screenshot({ path: 'outputs/lane4-on-hanging-bridge.png' });
  console.log('Saved outputs/lane4-on-hanging-bridge.png');

  console.log('Console errors found:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error('Console errors:', consoleErrors);
    throw new Error('Console errors encountered');
  }

  await browser.close();
  await server.close();
  console.log('--- ALL LANE 4 OBSTACLES VERIFIED SUCCESSFULLY ---');
}

main().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
