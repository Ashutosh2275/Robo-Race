import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Click START RACE
const btn = page.locator('#btnStartRace');
if (await btn.isVisible()) {
  await btn.click();
}
// Wait 3.5 seconds for countdown to finish and state to become 'racing'
await page.waitForTimeout(3500);

// Set camera behind the robot to chase it
async function setChaseCam() {
  await page.evaluate(() => {
    delete (window).__overrideCamera;
  });
}

// 1. Teleport robot to the top crest of the 45-degree descent ramp at (0.50 * 1.3, -1.15 * 1.3)
const startPose = await page.evaluate(() => {
  const tp = (window).__teleportRobot;
  if (tp) {
    tp(0.50 * 1.3, -1.15 * 1.3, -2.25);
  }
  return (window).__gameDebug?.pose;
});
console.log('Teleported to 45-deg descent ramp crest:', startPose);
await page.waitForTimeout(400);

// Set camera behind robot looking down the slope towards fire and water
await page.evaluate(() => {
  (window).__overrideCamera = {
    cx: 2.2, cy: 3.2, cz: 0.2,
    tx: -1.2, ty: 0.1, tz: -2.8
  };
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'outputs/robot-on-45-descent-crest.png' });
console.log('Saved outputs/robot-on-45-descent-crest.png');

// 2. Drive down the 45-degree ramp into the ground-level Fire Zone
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');

const firePose = await page.evaluate(() => {
  return {
    pose: (window).__gameDebug?.pose,
    subsystems: (window).__gameDebug?.subsystems
  };
});
console.log('Pose & thermal state in Fire Zone:', firePose);
await page.screenshot({ path: 'outputs/robot-driving-ground-fire.png' });
console.log('Saved outputs/robot-driving-ground-fire.png');

// 3. Drive into the 0.5m Deep Water Basket (cooling down, touching ground bed)
await page.keyboard.down('KeyW');
await page.waitForTimeout(1400);
await page.keyboard.up('KeyW');

const waterPose = await page.evaluate(() => {
  return {
    pose: (window).__gameDebug?.pose,
    subsystems: (window).__gameDebug?.subsystems
  };
});
console.log('Pose & thermal state in Water Basket:', waterPose);
await page.screenshot({ path: 'outputs/robot-in-still-water-basket.png' });
console.log('Saved outputs/robot-in-still-water-basket.png');

// 4. Drive out of the water basket up the exit climb ramp
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');

const exitPose = await page.evaluate(() => (window).__gameDebug?.pose);
console.log('Pose on exit climb ramp:', exitPose);
await page.screenshot({ path: 'outputs/robot-climbing-out-of-water.png' });
console.log('Saved outputs/robot-climbing-out-of-water.png');

await browser.close();
console.log('Full test drive through 45-degree ramp, ground fire, and water basket completed successfully!');
