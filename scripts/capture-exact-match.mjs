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

// Teleport robot to Gate 06 exit (x=12.2, z=2.4) facing turntable
await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(12.2, 2.5, -2.4);
  }
});

// Exact camera setup matching media_1793692365303_71469e76.png
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 11.0, cy: 5.2, cz: 1.4,
    tx: 13.6, ty: 0.9, tz: 4.8
  };
});
await page.waitForTimeout(700);

if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
await page.screenshot({ path: 'outputs/checkpoint-06-exact-user-angle.png' });
console.log('Saved outputs/checkpoint-06-exact-user-angle.png');

// Slightly higher perspective showing the entire transition from bridge to pit
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 10.2, cy: 6.5, cz: 0.8,
    tx: 13.6, ty: 0.8, tz: 4.8
  };
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/checkpoint-06-transition-view.png' });
console.log('Saved outputs/checkpoint-06-transition-view.png');

// Macro close-up of ball bearings inside the steel coaming
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 12.8, cy: 2.2, cz: 3.4,
    tx: 13.5, ty: 0.8, tz: 4.6
  };
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/checkpoint-06-ultra-macro.png' });
console.log('Saved outputs/checkpoint-06-ultra-macro.png');

await browser.close();
console.log('Done captures.');
