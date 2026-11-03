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

// Hide UI
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

// Teleport robot right at the entrance of the marble pit (x=13.3, z=6.4), facing south towards the pit
await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(13.3, 6.4, Math.PI * 0.95);
  }
});

// 1. Third-person chase cam looking over the robot as it enters the industrial ball-bearing bed
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 13.1, cy: 2.1, cz: 7.7,
    tx: 13.4, ty: 0.9, tz: 4.8
  };
});
await page.waitForTimeout(700);
if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
await page.screenshot({ path: 'outputs/checkpoint-06-first-person-driving.png' });
console.log('Saved outputs/checkpoint-06-first-person-driving.png');

// 2. Low-angle macro shot of the chrome ball bearings and ceramic spheres
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 14.2, cy: 1.15, cz: 5.6,
    tx: 13.4, ty: 0.72, tz: 4.5
  };
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/checkpoint-06-macro-bearings.png' });
console.log('Saved outputs/checkpoint-06-macro-bearings.png');

await browser.close();
console.log('Done captures.');
