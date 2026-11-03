import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const btn = page.locator('#btnStartRace');
if (await btn.isVisible()) {
  await btn.click();
}
await page.waitForTimeout(1000);

// Teleport robot to bridge exit at x=12.6, z=7.2 facing south (yaw = Math.PI)
console.log('Teleporting robot to bridge exit before Gate 06...');
await page.evaluate(() => {
  if (typeof window.__teleportRobot === 'function') {
    window.__teleportRobot(12.6, 7.2, Math.PI);
  }
});
await page.waitForTimeout(400);

const initialTelemetry = await page.evaluate(() => {
  return window.__gameDebug ? {
    pos: { x: window.__gameDebug.pose.x, z: window.__gameDebug.pose.z },
    yaw: window.__gameDebug.pose.yaw,
    currentCheckpoint: window.__gameDebug.raceState.currentCheckpoint
  } : null;
});
console.log('Initial Telemetry at Gate 06 approach:', initialTelemetry);

// Drive forward into the marble pit with W
console.log('Driving forward into pit with W...');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1000);

// Steer right through the turn with W + D
console.log('Turning right through Gate 06 with W + D...');
await page.keyboard.down('KeyD');
await page.waitForTimeout(1400);
await page.keyboard.up('KeyD');

// Continue forward towards turntable
console.log('Driving towards turntable with W...');
await page.waitForTimeout(1000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);

const finalTelemetry = await page.evaluate(() => {
  return window.__gameDebug ? {
    pos: { x: window.__gameDebug.pose.x, z: window.__gameDebug.pose.z },
    yaw: window.__gameDebug.pose.yaw,
    currentCheckpoint: window.__gameDebug.raceState.currentCheckpoint,
    inverted: window.__gameDebug.motionState.inverted
  } : null;
});
console.log('Final Telemetry after Gate 06 turn:', finalTelemetry);

// Screenshot of driven robot
await page.screenshot({ path: 'outputs/checkpoint-06-test-drive-success.png' });
console.log('Saved outputs/checkpoint-06-test-drive-success.png');

await browser.close();
console.log('Test drive finished.');
