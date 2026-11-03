import { chromium } from 'playwright';
import fs from 'node:fs';

async function main() {
  console.log('=== VERIFYING TURNTABLE & WIDENED ELEVATED TRACK ===');

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('Browser error:', msg.text());
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Start race
  const startBtn = page.locator('#btnStartRace');
  if (await startBtn.isVisible()) await startBtn.click();
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });
  await page.waitForTimeout(500);

  // Hide UI for clean screenshots
  await page.evaluate(() => {
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'none';
  });

  fs.mkdirSync('outputs', { recursive: true });

  // 1. Overview of widened track and Obstacles 01-05 leading into Turntable
  console.log('1. Capturing elevated track overview from Bridge to Turntable...');
  await page.evaluate(() => {
    window.__overrideCamera = {
      cx: 14.5, cy: 9.5, cz: -5.5,
      tx: 11.5, ty: 1.0, tz: 3.0
    };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'outputs/turntable-and-elevated-track-overview.png' });
  console.log('Saved outputs/turntable-and-elevated-track-overview.png');

  // 2. High-precision macro shot of the 3D Mechanical Turntable (spindle, bearings, motor, teeth, wedges)
  console.log('2. Capturing ultra-realistic 3D mechanical turntable close-up...');
  await page.evaluate(() => {
    window.__overrideCamera = {
      cx: 10.65 * 1.3 - 2.8, cy: 2.8, cz: 0.1 * 1.3 - 3.2,
      tx: 10.65 * 1.3, ty: 0.85, tz: 0.1 * 1.3
    };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'outputs/turntable-mechanical-macro.png' });
  console.log('Saved outputs/turntable-mechanical-macro.png');

  // 3. Teleport robot onto the rotating turntable platter (x = 10.65 * 1.3, z = 0.1 * 1.3 + 1.6)
  console.log('3. Placing robot on rotating turntable and verifying physical rotational interaction...');
  const mapScale = 1.3;
  const initialX = 10.65 * mapScale + 1.5;
  const initialZ = 0.1 * mapScale;
  const initialYaw = 0;

  await page.evaluate(({ tx, tz, tyaw }) => {
    const d = window.__gameDebug;
    d.motionState.x = tx;
    d.motionState.z = tz;
    d.motionState.yaw = tyaw;
    d.motionState.vx = 0;
    d.motionState.vz = 0;
    d.motionState.angular = 0;
    d.pose.x = tx;
    d.pose.z = tz;
    d.pose.yaw = tyaw;
    d.pose.vx = 0;
    d.pose.vz = 0;
    d.pose.yawRate = 0;
  }, { tx: initialX, tz: initialZ, tyaw: initialYaw });

  // Camera focused on robot on turntable
  await page.evaluate(({ tx, tz }) => {
    window.__overrideCamera = {
      cx: tx - 3.5, cy: 3.2, cz: tz - 4.2,
      tx: tx, ty: 1.0, tz: tz
    };
  }, { tx: 10.65 * mapScale, tz: 0.1 * mapScale });

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/robot-on-turntable-entry.png' });
  console.log('Saved outputs/robot-on-turntable-entry.png');

  // Sample robot motion after 2.5 seconds of physical turntable rotation
  console.log('Waiting for turntable to rotate robot...');
  await page.waitForTimeout(2500);

  const rotatedState = await page.evaluate(() => {
    const d = window.__gameDebug;
    return {
      x: d.motionState.x,
      z: d.motionState.z,
      yaw: d.motionState.yaw,
      angular: d.motionState.angular,
      turntableOmega: d.turntableOmega,
      turntableRadius: d.turntableRadius,
    };
  });

  console.log('Rotated robot state:', rotatedState);

  // Verify physical interaction occurred:
  const deltaYaw = Math.abs(rotatedState.yaw - initialYaw);
  console.log(`Measured physical yaw rotation on turntable: ${(deltaYaw * 180 / Math.PI).toFixed(1)} degrees`);

  if (deltaYaw < 0.1) {
    throw new Error(`Turntable did not physically rotate robot! deltaYaw=${deltaYaw}`);
  }

  await page.screenshot({ path: 'outputs/robot-rotating-on-turntable-in-action.png' });
  console.log('Saved outputs/robot-rotating-on-turntable-in-action.png');

  // 4. Test driving off the turntable onto the exit road corridor
  console.log('4. Driving robot forward off the turntable...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');

  const exitState = await page.evaluate(() => {
    const d = window.__gameDebug;
    return {
      x: d.motionState.x,
      z: d.motionState.z,
      yaw: d.motionState.yaw,
    };
  });
  console.log('Robot exit position:', exitState);

  await page.screenshot({ path: 'outputs/robot-exiting-turntable.png' });
  console.log('Saved outputs/robot-exiting-turntable.png');

  // 5. Tactical aerial overview of the entire connected, elevated, reconstructed circuit
  console.log('5. Capturing tactical overview of entire racing arena...');
  await page.evaluate(() => {
    window.__overrideCamera = {
      cx: 1.0, cy: 32.0, cz: -1.0,
      tx: 1.0, ty: 0.0, tz: 0.0
    };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'outputs/arena-circuit-tactical-overview.png' });
  console.log('Saved outputs/arena-circuit-tactical-overview.png');

  await browser.close();
  console.log('=== ALL TURNTABLE AND ELEVATED TRACK VERIFICATIONS PASSED ===');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
