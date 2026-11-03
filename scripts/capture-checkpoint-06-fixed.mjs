import { chromium } from 'playwright';
import fs from 'node:fs';

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

// Hide UI for pristine renders
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

// Teleport robot to Gate 06 approach (x=13.0, z=5.8)
await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(13.2, 5.5, Math.PI);
  }
});

// 1. Exact viewpoint matching user screenshot media_1793692365303_71469e76.png
// Looking at Gate 06 and the marble pit from slightly west/southwest elevated
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 10.6, cy: 5.8, cz: 2.2,
    tx: 13.4, ty: 1.0, tz: 4.8
  };
});
await page.waitForTimeout(600);
if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
await page.screenshot({ path: 'outputs/checkpoint-06-exact-view-fixed.png' });
console.log('Saved outputs/checkpoint-06-exact-view-fixed.png');

// 2. High-angle perspective showing the bridge descent into Checkpoint 06
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 11.0, cy: 7.5, cz: 8.5,
    tx: 13.4, ty: 1.0, tz: 4.5
  };
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'outputs/checkpoint-06-aerial-overview.png' });
console.log('Saved outputs/checkpoint-06-aerial-overview.png');

// 3. Ultra-close macro shot of the chrome steel ball bearings and ceramic beads
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 13.0, cy: 1.9, cz: 3.8,
    tx: 13.4, ty: 1.0, tz: 4.5
  };
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'outputs/checkpoint-06-ball-bearings-macro.png' });
console.log('Saved outputs/checkpoint-06-ball-bearings-macro.png');

// 4. Test driving the robot through the marble bed
console.log('Driving robot through Checkpoint 06 pit...');
await page.evaluate(() => {
  delete window.__overrideCamera;
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(13.2, 6.8, Math.PI); // Just before entry ramp
  }
});
await page.waitForTimeout(300);

// Drive forward with 'w'
await page.keyboard.down('KeyW');
await page.waitForTimeout(1800);
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);

// Capture drive state
const driveState = await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  return dbg ? dbg.getTelemetry() : null;
});
console.log('Drive state after passing pit:', JSON.stringify(driveState));

await page.screenshot({ path: 'outputs/checkpoint-06-robot-driven-through.png' });
console.log('Saved outputs/checkpoint-06-robot-driven-through.png');

await browser.close();
console.log('All captures complete!');
