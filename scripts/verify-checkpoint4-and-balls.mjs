import { chromium } from 'playwright';
import { createServer } from 'vite';
import nodeFs from 'node:fs';

async function run() {
  console.log('--- STARTING CHECKPOINT 4 & PURE SPHERICAL BALLS VERIFICATION ---');

  const server = await createServer({
    server: { port: 5179 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5179;
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

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.error('[Browser Error]', msg.text());
    }
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Click START RACE
  const startBtn = await page.$('#btnStartRace');
  if (startBtn) {
    await startBtn.click();
  }
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });
  console.log('Race active!');

  nodeFs.mkdirSync('outputs', { recursive: true });

  // 1. TEST CHECKPOINT 4 NAVIGATION WITHOUT FALSE RESPAWN
  console.log('Testing Checkpoint 4 (Gate 04) crossing on Lane 2...');
  const cp4Result = await page.evaluate(async () => {
    const scale = 1.3;
    // Simulate clearing checkpoints 1, 2, 3 so currentCheckpoint is 3 (awaiting Gate 04)
    window.__gameDebug.setCurrentCheckpoint(3);

    // Place robot just East of Gate 04 on Lane 2 (x = 15.2, z = 6.75) facing West (-PI/2)
    window.__gameDebug.setPose(15.2 * scale, 6.75 * scale, -Math.PI / 2);

    // Camera following robot
    window.__overrideCamera = {
      cx: 18.0 * scale,
      cy: 2.2,
      cz: 6.75 * scale,
      tx: 13.0 * scale,
      ty: 0.5,
      tz: 6.75 * scale,
    };

    return { initialCp: window.__gameDebug.getCurrentCheckpoint() };
  });

  console.log('Initial CP before crossing:', cp4Result.initialCp);
  await page.waitForTimeout(200);

  // Move robot across Gate 04 (x = 14.5 * scale) to x = 13.5 * scale (into Lane 2)
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 13.5 * scale;
    motion.x = pose.x;
  });

  // Wait 1 second for game loop to process checkpoint crossing & fall detection
  await page.waitForTimeout(1000);

  // Drive further along Lane 2 into [6.5, 12.0]
  await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    pose.x = 10.0 * scale;
    motion.x = pose.x;
  });
  await page.waitForTimeout(500);

  const cpAfterDrive = await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const localX = pose.x / scale;
    const localZ = pose.z / scale;
    const cp = window.__gameDebug.getCurrentCheckpoint();
    return { cp, localX, localZ, poseY: pose.y };
  });

  console.log('After driving across Checkpoint 4:', cpAfterDrive);

  await page.screenshot({ path: 'outputs/checkpoint4-cleared-lane2.png' });
  console.log('Saved outputs/checkpoint4-cleared-lane2.png');

  // Verify that CP is 4 (Gate 04 cleared, awaiting Gate 05), NOT reset to 8 or 9 or 10!
  if (cpAfterDrive.cp !== 4) {
    throw new Error(`Expected currentCheckpoint to be 4 after clearing Gate 04, but got ${cpAfterDrive.cp}!`);
  }
  // Verify robot is still on Lane 2 (z ~ 6.75) and has not been teleported to Lane 4 (z = -6.75)
  if (Math.abs(cpAfterDrive.localZ - 6.75) > 0.5) {
    throw new Error(`Robot was teleported off Lane 2! localZ = ${cpAfterDrive.localZ}`);
  }
  console.log('SUCCESS: Gate 04 cleared smoothly with ZERO false respawns!');

  // 2. CLOSE-UP INSPECTION OF PURE SPHERICAL WRECKING BALLS WITH 1.5x GAP
  console.log('Inspecting pure spherical wrecking balls on Lane 4...');
  await page.evaluate(() => {
    const scale = 1.3;
    // Position camera close up to the center wrecking ball (x = 10.5, z = -6.75)
    window.__overrideCamera = {
      cx: 10.5 * scale + 1.2,
      cy: 2.0,
      cz: -6.75 * scale + 2.2,
      tx: 10.5 * scale,
      ty: 1.6,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/pure-spherical-ball-closeup.png' });
  console.log('Saved outputs/pure-spherical-ball-closeup.png');

  // 3. OVERVIEW SHOWING ALL 3 BALLS AND 1.5x GAP
  console.log('Capturing overview of 3 balls with 1.5x gaps...');
  await page.evaluate(() => {
    const scale = 1.3;
    window.__overrideCamera = {
      cx: 10.5 * scale,
      cy: 4.8,
      cz: -6.75 * scale + 4.8,
      tx: 10.5 * scale,
      ty: 1.6,
      tz: -6.75 * scale,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'outputs/lane4-balls-1.5x-gap-overview.png' });
  console.log('Saved outputs/lane4-balls-1.5x-gap-overview.png');

  await browser.close();
  await server.close();
  console.log('--- ALL VERIFICATIONS COMPLETED SUCCESSFULLY ---');
}

run().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
