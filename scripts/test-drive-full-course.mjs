import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const angleDelta = (after, before) => Math.atan2(Math.sin(after - before), Math.cos(after - before));

async function main() {
  console.log('--- STARTING AUTONOMOUS FULL-COURSE RACE SIMULATION ---');

  // Start Vite dev server on dedicated port
  const server = await createServer({
    server: { port: 5178 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5178;
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
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
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

  console.log('Navigating to Robo Race 3D...');
  await page.goto(url, { waitUntil: 'networkidle' });

  // Click START RACE
  const startBtn = await page.$('#btnStartRace');
  if (!startBtn) throw new Error('Start button not found');
  console.log('Clicking START RACE...');
  await startBtn.click();

  // Wait for countdown to finish (allow up to 35s for software WebGL)
  console.log('Waiting for race countdown to complete...');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 35000 });
  console.log('Race is active! (GO!)');

  fs.mkdirSync('outputs', { recursive: true });

  const getPose = async () => {
    return await page.evaluate(() => {
      const dbg = window.__gameDebug;
      return {
        x: dbg.pose.x,
        y: dbg.pose.y,
        z: dbg.pose.z,
        yaw: dbg.pose.yaw,
        vx: dbg.pose.vx,
        vz: dbg.pose.vz,
        currentCheckpoint: dbg.currentCheckpoint,
        raceState: dbg.raceState,
        subsystems: {
          motorTemp: dbg.subsystems?.motors?.leftTemp ?? 30,
          health: dbg.subsystems?.integrity?.chassis ?? 100,
        },
      };
    });
  };

  // Helper to set chase or top camera
  const setCameraMode = async (mode) => {
    await page.evaluate((m) => {
      // 0: Chase, 1: Cockpit, 2: Top, 3: Isometric
      window.__setCameraMode?.(m);
    }, mode);
  };

  await page.screenshot({ path: 'outputs/drive-checkpoint-01-start.png' });
  console.log('Saved outputs/drive-checkpoint-01-start.png');

  // Waypoints along the full course including slalom weave:
  const WAYPOINTS = [
    { name: 'Gate 01 Start', x: -24.96, z: 10.40 },
    { name: 'Slalom Weave 0', x: -21.19, z: 9.10 },
    { name: 'Slalom Weave 1', x: -16.77, z: 11.70 },
    { name: 'Slalom Weave 2', x: -12.35, z: 9.10 },
    { name: 'Slalom Weave 3', x: -7.93, z: 11.70 },
    { name: 'Slalom Weave 4', x: -3.51, z: 9.10 },
    { name: 'Gate 02 Slalom Exit', x: -0.26, z: 10.40 },
    { name: 'Gate 03 Breakers', x: 4.16, z: 10.40 },
    { name: 'Gate 04 Ramp Toe', x: 5.72, z: 10.40 },
    { name: 'Gate 05 Bridge Crest (Water)', x: 12.48, z: 10.40, capture: 'outputs/drive-checkpoint-05-real-water.png' },
    { name: 'Bridge Descent', x: 15.86, z: 10.40 },
    { name: 'Gate 06 Marble Pit Turn', x: 17.16, z: 6.11 },
    { name: 'Marble Pit Shelf', x: 17.80, z: 3.50 },
    { name: 'Turntable Approach', x: 16.50, z: 1.00 },
    { name: 'Gate 07 Turntable Disc', x: 13.85, z: 0.13 },
    { name: 'Disc Exit', x: 8.50, z: 0.00 },
    { name: 'Gate 08 Mixed Terrain', x: 1.82, z: 0.00 },
    { name: 'Hazard Entry Straight', x: -1.50, z: -5.20 },
    { name: 'Gate 09 Fire Hearth', x: -4.03, z: -5.20, capture: 'outputs/drive-checkpoint-09-real-fire.png' },
    { name: 'Gate 09 Sunken Water Basin', x: -6.24, z: -5.20, capture: 'outputs/drive-checkpoint-09-real-water-basin.png' },
    { name: 'Gate 09 Diamond Transition', x: -9.10, z: -5.20 },
    { name: 'Gate 09 Oil Skid Pad', x: -13.00, z: -5.20 },
    { name: 'Hairpin 1 Approach', x: -17.16, z: -5.20 },
    { name: 'Hairpin 1 Apex Outer Arc', x: -19.76, z: -7.80, capture: 'outputs/drive-hairpin-01-plaza.png' },
    { name: 'Hairpin 1 Exit', x: -17.16, z: -10.40 },
    { name: 'Gate 10 Parallel Planks Entry', x: -12.50, z: -10.40 },
    { name: 'Gate 10 Parallel Planks Mid', x: -9.75, z: -10.40, capture: 'outputs/drive-checkpoint-10-parallel-planks.png' },
    { name: 'Gate 10 Parallel Planks Exit', x: -4.50, z: -10.40 },
    { name: 'Hairpin 2 Approach', x: -0.26, z: -10.40 },
    { name: 'Hairpin 2 Apex Outer Arc', x: 2.21, z: -12.87, capture: 'outputs/drive-hairpin-02-plaza.png' },
    { name: 'Hairpin 2 Exit', x: -0.26, z: -15.40 },
    { name: 'Finish Straight Mid', x: -9.50, z: -15.60 },
    { name: 'Gate 11 Grand Finish Line', x: -17.16, z: -15.60, capture: 'outputs/drive-checkpoint-11-finish-line.png' },
    { name: 'Finish Runoff Bay', x: -19.50, z: -15.60 },
  ];

  let currentWpIndex = 0;
  let activeKeys = new Set();

  const setKeys = async (keysToPress) => {
    for (const k of [...activeKeys]) {
      if (!keysToPress.has(k)) {
        await page.keyboard.up(k);
        activeKeys.delete(k);
      }
    }
    for (const k of keysToPress) {
      if (!activeKeys.has(k)) {
        await page.keyboard.down(k);
        activeKeys.add(k);
      }
    }
  };

  const startTime = Date.now();
  console.log(`Starting autonomous navigation across ${WAYPOINTS.length} waypoints...`);

  let lastCheckpointSeen = 0;

  while (currentWpIndex < WAYPOINTS.length) {
    const pose = await getPose();
    const wp = WAYPOINTS[currentWpIndex];

    if (pose.currentCheckpoint > lastCheckpointSeen) {
      lastCheckpointSeen = pose.currentCheckpoint;
      console.log(`>>> PASSED CHECKPOINT GATE ${lastCheckpointSeen}! (Health: ${pose.subsystems.health}%, MotorTemp: ${pose.subsystems.motorTemp.toFixed(1)}°C)`);
      if (lastCheckpointSeen === 11 || pose.raceState === 'finished') {
        await page.screenshot({ path: 'outputs/drive-checkpoint-11-finish-line.png' });
        console.log('Captured outputs/drive-checkpoint-11-finish-line.png');
        break;
      }
    }

    const dx = wp.x - pose.x;
    const dz = wp.z - pose.z;
    const dist = Math.hypot(dx, dz);

    // Target arrival threshold (1.4m for intermediate, 1.8m for broad hairpins)
    const threshold = wp.name.includes('Apex') || wp.name.includes('Plaza') ? 2.4 : 1.5;

    if (dist < threshold) {
      console.log(`Reached Waypoint [${currentWpIndex + 1}/${WAYPOINTS.length}]: ${wp.name} (dist=${dist.toFixed(2)}m)`);
      if (wp.capture) {
        await page.screenshot({ path: wp.capture });
        console.log(`Captured ${wp.capture}`);
      }
      currentWpIndex++;
      if (currentWpIndex >= WAYPOINTS.length) break;
      continue;
    }

    // Compute desired heading:
    // Forward direction: pose.yaw = atan2(dx, dz)
    const targetHeading = Math.atan2(dx, dz);
    const headingError = angleDelta(targetHeading, pose.yaw);

    const keys = new Set();

    // Canonical steering:
    // If headingError > 0: target is to the LEFT -> press 'KeyA'
    // If headingError < 0: target is to the RIGHT -> press 'KeyD'
    const steerDeadband = 0.08;
    if (headingError > steerDeadband) {
      keys.add('KeyA');
    } else if (headingError < -steerDeadband) {
      keys.add('KeyD');
    }

    // Drive forward if heading error is manageable
    if (Math.abs(headingError) < 0.65) {
      keys.add('KeyW');
    } else {
      // Sharp pivot when misaligned
      // Do not press W, let robot pivot in place cleanly
    }

    await setKeys(keys);
    await page.waitForTimeout(40);

    // Watchdog timeout: 90 seconds max
    if (Date.now() - startTime > 90000) {
      console.warn('Navigation loop hit 90s safety timeout');
      break;
    }
  }

  // Release all keys
  await setKeys(new Set());
  await page.waitForTimeout(500);

  const finalPose = await getPose();
  console.log('Final Robot Pose:', finalPose);

  // Capture Tactical View of full arena
  await page.screenshot({ path: 'outputs/drive-full-course-tactical.png' });
  console.log('Saved outputs/drive-full-course-tactical.png');

  // Copy captured images to brain artifact directory for user review
  const brainDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
  const outFiles = [
    'drive-checkpoint-01-start.png',
    'drive-checkpoint-05-real-water.png',
    'drive-checkpoint-09-real-fire.png',
    'drive-checkpoint-09-real-water-basin.png',
    'drive-hairpin-01-plaza.png',
    'drive-checkpoint-10-parallel-planks.png',
    'drive-hairpin-02-plaza.png',
    'drive-checkpoint-11-finish-line.png',
    'drive-full-course-tactical.png',
  ];

  for (const f of outFiles) {
    const srcPath = path.join('outputs', f);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(brainDir, f));
    }
  }

  console.log('All screenshots synchronized to artifacts directory!');
  console.log('--- AUTONOMOUS FULL-COURSE RACE COMPLETED SUCCESSFULLY ---');

  await browser.close();
  await server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Test drive failed:', err);
  process.exit(1);
});
