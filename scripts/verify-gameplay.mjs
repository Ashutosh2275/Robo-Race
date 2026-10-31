import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

async function main() {
  console.log('--- STARTING E2E GAMEPLAY VERIFICATION ---');

  // 1. Start Vite Server
  const server = await createServer({
    server: { port: 5176 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5176;
  const url = `http://localhost:${port}/`;
  console.log(`Vite server running at ${url}`);

  // 2. Launch Chromium with flags
  const browser = await chromium.launch({
    headless: true,
    args: [
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
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  console.log('Navigating to game...');
  await page.goto(url, { waitUntil: 'networkidle' });

  // 3. Start Race
  const startBtn = await page.$('#btnStartRace');
  if (!startBtn) throw new Error('Start button not found');
  console.log('Clicking START RACE...');
  await startBtn.click();

  // Wait for countdown to finish using waitForFunction
  console.log('Waiting for race to become active...');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });
  console.log('Race is active! (GO!)');

  // Take screenshot of race starting
  fs.mkdirSync('outputs', { recursive: true });
  await page.screenshot({ path: 'outputs/gameplay-start.png' });
  console.log('Saved outputs/gameplay-start.png');

  // Click canvas to ensure active focus
  await page.click('#game');

  // 4. Test W (Forward)
  console.log('Testing W (Forward)...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);

  const debugWhileDriving = await page.evaluate(() => window.__gameDebug);
  const liveSpeed = Math.hypot(debugWhileDriving?.pose?.vx || 0, debugWhileDriving?.pose?.vz || 0);
  console.log(`Vehicle Velocity while holding W: ${liveSpeed.toFixed(2)} m/s (poseX: ${debugWhileDriving?.pose?.x?.toFixed(2)})`);

  const domSpeed = await page.$eval('#speed', el => el.textContent);
  console.log(`DOM Speed HUD: ${domSpeed}`);

  await page.keyboard.up('KeyW');
  await page.waitForTimeout(500);

  // 5. Test A (Rotate Left - yaw should decrease)
  console.log('Testing A (Left pivot)...');
  const yawBeforeA = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(600);
  const yawDuringA = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  console.log(`Yaw before A: ${yawBeforeA.toFixed(3)}, Yaw during A: ${yawDuringA.toFixed(3)} (Delta: ${(yawDuringA - yawBeforeA).toFixed(3)})`);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(300);

  // 6. Test T and D (Rotate Right - yaw should increase)
  console.log('Testing T (Primary right pivot)...');
  const yawBeforeT = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyT');
  await page.waitForTimeout(600);
  const yawDuringT = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  console.log(`Yaw before T: ${yawBeforeT.toFixed(3)}, Yaw during T: ${yawDuringT.toFixed(3)} (Delta: ${(yawDuringT - yawBeforeT).toFixed(3)} -> Right)`);
  await page.keyboard.up('KeyT');
  await page.waitForTimeout(300);

  console.log('Testing D (Right pivot alias)...');
  const yawBeforeD = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  const yawDuringD = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  console.log(`Yaw before D: ${yawBeforeD.toFixed(3)}, Yaw during D: ${yawDuringD.toFixed(3)} (Delta: ${(yawDuringD - yawBeforeD).toFixed(3)} -> Right)`);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300);

  // 6b. Test Opposing Steering Cancellation (A + T and A + D)
  console.log('Testing A + T Opposing Steering Cancellation...');
  const yawBeforeAT = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyT');
  await page.waitForTimeout(500);
  const yawDuringAT = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  const deltaAT = Math.abs(yawDuringAT - yawBeforeAT);
  console.log(`Yaw delta during A+T: ${deltaAT.toFixed(4)} (Expected ~0 rad rotation)`);
  await page.keyboard.up('KeyT');
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(300);

  // 7. Test W+A (Forward-Left Curve) and W+T (Forward-Right Curve)
  console.log('Testing W+A (Forward-Left Curve)...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  console.log('Testing W+T (Forward-Right Curve)...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyT');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyT');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  // 8. Test S+A (Reverse while Front Rotates Left) and S+T (Reverse while Front Rotates Right)
  console.log('Testing S+A (Reverse with Front Left Rotation)...');
  const yawBeforeSA = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyS');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1000);
  const yawDuringSA = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  console.log(`Yaw before S+A: ${yawBeforeSA.toFixed(3)}, Yaw during S+A: ${yawDuringSA.toFixed(3)} (Delta: ${(yawDuringSA - yawBeforeSA).toFixed(3)} -> Left)`);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(300);

  console.log('Testing S+T (Reverse with Front Right Rotation)...');
  const yawBeforeST = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  await page.keyboard.down('KeyS');
  await page.keyboard.down('KeyT');
  await page.waitForTimeout(1000);
  const yawDuringST = await page.evaluate(() => window.__gameDebug?.pose?.yaw || 0);
  console.log(`Yaw before S+T: ${yawBeforeST.toFixed(3)}, Yaw during S+T: ${yawDuringST.toFixed(3)} (Delta: ${(yawDuringST - yawBeforeST).toFixed(3)} -> Right)`);
  await page.keyboard.up('KeyT');
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(300);

  // 9. Test Space (Braking)
  console.log('Testing Space (Braking)...');
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');

  // 10. Test Cutaway View
  console.log('Testing Cutaway View...');
  const cutawayBtn = await page.$('#cutaway');
  if (cutawayBtn) {
    await cutawayBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'outputs/gameplay-cutaway.png' });
    console.log('Saved outputs/gameplay-cutaway.png');
  }

  // 11. Test R (Recovery)
  console.log('Testing R (Recovery)...');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);

  // 12. Check Subsystems HUD Readouts
  const batText = await page.$eval('#bat', el => el.textContent);
  const motText = await page.$eval('#mot', el => el.textContent);
  const hltText = await page.$eval('#hlt', el => el.textContent);
  console.log(`Subsystems status -> Battery: ${batText}, Motor: ${motText}, Health: ${hltText}`);

  // 13. Test Controller Calibration & Diagnostics Modal
  console.log('Testing Controller Calibration & Diagnostics Modal...');
  const settingsBtn = await page.$('#settingsBtn');
  if (settingsBtn) await settingsBtn.click();
  await page.waitForTimeout(300);

  const openCalibBtn = await page.$('#openCalibBtn');
  if (!openCalibBtn) throw new Error('Calibration button not found in Settings');
  await openCalibBtn.click();
  await page.waitForTimeout(400);

  const modalVisible = await page.$eval('#diagnosticsModal', el => !el.classList.contains('hidden'));
  console.log(`Diagnostics modal opened: ${modalVisible}`);
  if (!modalVisible) throw new Error('Diagnostics modal failed to open');

  const diagDevice = await page.$eval('#diagDeviceName', el => el.textContent);
  console.log(`Diagnostics device header: ${diagDevice}`);

  await page.screenshot({ path: 'outputs/gameplay-diagnostics.png' });
  console.log('Saved outputs/gameplay-diagnostics.png');

  const closeCalibBtn = await page.$('#closeCalibBtn');
  if (closeCalibBtn) await closeCalibBtn.click();
  await page.waitForTimeout(300);

  // Close settings panel and diagnostics modal
  await page.evaluate(() => {
    document.getElementById('settings')?.classList.add('hidden');
    document.getElementById('diagnosticsModal')?.classList.add('hidden');
  });
  await page.waitForTimeout(300);

  // Final screenshot
  await page.screenshot({ path: 'outputs/gameplay-final.png' });
  console.log('Saved outputs/gameplay-final.png');

  // Clean up
  await browser.close();
  await server.close();

  if (consoleErrors.length > 0) {
    console.error('Browser console errors encountered:');
    consoleErrors.forEach(err => console.error(' -', err));
    process.exit(1);
  }

  console.log('--- ALL E2E GAMEPLAY TESTS COMPLETED SUCCESSFULLY ---');
}

main().catch(err => {
  console.error('E2E Verification failed:', err);
  process.exit(1);
});
