import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER:', msg.text()));

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  // Click START RACE
  const startBtn = await page.$('button#btn-start-race');
  if (startBtn) {
    await startBtn.click();
    console.log('Clicked Start Race');
  }
  await page.waitForTimeout(500);

  // Set race state to racing immediately for verification testing
  await page.evaluate(() => {
    if (window.__setRaceState) window.__setRaceState('racing');
  });

  // 1. Verify Ground-Level Pier Collision:
  // TURNTABLE_CENTER is at x = 1.0, z = 0.0 (world coords: x = 1.30, z = 0.0)
  // Position robot at ground level (x = 3.8, z = 0.0, yaw = -Math.PI / 2 [facing -X directly toward pier])
  console.log('Testing ground-level turntable pier collision...');
  await page.evaluate(() => {
    if (window.__setRaceState) window.__setRaceState('racing');
    // Teleport robot to ground floor East of the turntable pier, facing West (-X)
    window.__teleportRobot(3.8, 0.0, -Math.PI / 2);
    // Point camera at the turntable pier base
    window.__setCameraPose(3.5, 1.2, 3.2, 1.3, 0.2, 0.0);
  });
  await page.waitForTimeout(500);

  // Drive forward into the pier for 2.5 seconds
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(500);

  // Check robot position after attempting to drive through the pier
  const pierTest = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    const pose = dbg.pose;
    const scale = 1.3;
    const pierX = 1.0 * scale; // 1.30
    const pierZ = 0.0 * scale; // 0.0
    const distToCenter = Math.hypot(pose.x - pierX, pose.z - pierZ);
    return {
      x: pose.x,
      z: pose.z,
      y: pose.y,
      distToCenter,
      stoppedOutside: distToCenter >= 1.60,
    };
  });

  console.log('Ground Pier Test Result:', JSON.stringify(pierTest));

  const artifactPath = path.resolve('C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a/turntable-pier-solid-collision.png');
  await page.screenshot({ path: artifactPath });
  console.log('Saved screenshot to:', artifactPath);

  // 2. Verify Elevated Driving on Turntable Platter (y = 3.20m):
  console.log('Testing elevated driving across turntable platter...');
  await page.evaluate(() => {
    if (window.__setRaceState) window.__setRaceState('racing');
    // Teleport robot to summit entrance (Gate 05 area) at elevated height facing East (+X)
    window.__teleportRobot(-1.8, 0.0, Math.PI / 2, 3.20);
    window.__setCameraPose(-2.0, 5.0, 4.5, 1.3, 3.2, 0.0);
  });
  await page.waitForTimeout(500);

  // Drive across the turntable
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(500);

  const summitTest = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    const pose = dbg.pose;
    return {
      x: pose.x,
      z: pose.z,
      y: pose.y,
      advancedAcross: pose.x > 0.0,
      stayedElevated: pose.y >= 3.0,
    };
  });
  console.log('Elevated Turntable Test Result:', JSON.stringify(summitTest));

  const summitArtifactPath = path.resolve('C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a/turntable-summit-smooth-drive.png');
  await page.screenshot({ path: summitArtifactPath });
  console.log('Saved summit screenshot to:', summitArtifactPath);

  await browser.close();
  console.log('All verification steps completed!');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
