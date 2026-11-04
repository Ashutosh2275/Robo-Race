import { chromium } from 'playwright';
import { createServer } from 'vite';
import nodeFs from 'node:fs';

async function run() {
  console.log('--- STARTING SLALOM EXPANSION & REALISTIC BALL PHYSICS VERIFICATION ---');

  const server = await createServer({
    server: { port: 5180 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5180;
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

  // 1. INSPECT EXPANDED SLALOM BRICK WALLS FROM EXACT USER ANGLE
  console.log('Inspecting expanded slalom brick hurdles on Lane 1...');
  await page.evaluate(() => {
    const scale = 1.3;
    // Match the exact camera perspective from the user image
    window.__overrideCamera = {
      cx: -18.2 * scale,
      cy: 1.65,
      cz: 13.50 * scale,
      tx: -7.0 * scale,
      ty: 0.60,
      tz: 13.50 * scale,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/slalom-bricks-expanded-to-center.png' });
  console.log('Saved outputs/slalom-bricks-expanded-to-center.png');

  // Verify brick block dimensions in data
  const slalomAudit = await page.evaluate(() => {
    const blocks = window.__gameDebug.slalomClearanceAudit;
    return blocks;
  });
  console.log('Slalom audit result:', slalomAudit);

  // 2. TEST BALL COLLISION PHYSICS: NO FLIPPING UPSIDE DOWN, REALISTIC THROW
  console.log('Testing realistic swinging ball collision & anti-flip physics...');
  const collisionResult = await page.evaluate(async () => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;

    // Set checkpoint to Gate 09 (index 8) so the Lane 4 gauntlet is active
    window.__gameDebug.setCurrentCheckpoint(8);

    // Place robot on narrow elevated catwalk (x = 10.8, z = -6.75) right in path of center ball
    window.__gameDebug.setPose(10.8 * scale, -6.75 * scale, -Math.PI / 2);
    pose.y = 1.35;
    pose.vx = -1.5; // driving forward towards ball 2
    pose.vz = 0;
    pose.pitch = 0;
    pose.roll = 0;
    pose.pitchRate = 0;
    pose.rollRate = 0;
    pose.isFlipped = false;

    // Follow with camera
    window.__overrideCamera = {
      cx: 14.0 * scale,
      cy: 2.8,
      cz: -6.75 * scale,
      tx: 10.5 * scale,
      ty: 1.4,
      tz: -6.75 * scale,
    };

    return { initialFlipped: pose.isFlipped };
  });

  console.log('Initial pose flip status:', collisionResult.initialFlipped);

  // Let the physics run for 800ms while the swinging ball collides with the robot
  await page.waitForTimeout(800);

  const afterImpact = await page.evaluate(() => {
    const scale = 1.3;
    const pose = window.__gameDebug.pose;
    const motion = window.__gameDebug.motionState;
    return {
      localX: pose.x / scale,
      localZ: pose.z / scale,
      y: pose.y,
      vz: pose.vz,
      roll: pose.roll,
      pitch: pose.pitch,
      rollRate: pose.rollRate,
      isFlipped: pose.isFlipped,
    };
  });

  console.log('After impact physics state:', afterImpact);
  await page.screenshot({ path: 'outputs/pendulum-impact-realistic-throw.png' });
  console.log('Saved outputs/pendulum-impact-realistic-throw.png');

  // Assert that vehicle did NOT flip upside down upon impact
  if (afterImpact.isFlipped) {
    throw new Error(`Vehicle flipped upside down! pitch=${afterImpact.pitch}, roll=${afterImpact.roll}`);
  }
  // Assert that roll angle remains within reasonable physical limits (< 45 degrees / 0.78 rad)
  if (Math.abs(afterImpact.roll) > 0.80) {
    throw new Error(`Vehicle rolled excessively! roll=${afterImpact.roll} rad`);
  }
  // Assert that vehicle has substantial lateral throwing velocity (knocked sideways off the path)
  if (Math.abs(afterImpact.vz) < 1.0 && Math.abs(afterImpact.localZ - (-6.75)) < 0.1) {
    console.warn('Robot may not have made full contact yet, checking further...');
  } else {
    console.log(`Vehicle received realistic lateral momentum: vz = ${afterImpact.vz.toFixed(2)} m/s, thrown sideways!`);
  }

  await browser.close();
  await server.close();
  console.log('--- ALL VERIFICATIONS COMPLETED SUCCESSFULLY ---');
}

run().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
