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

await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

// Teleport robot right next to the pit at (12.3, 4.5), facing into the pit
await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(12.3, 4.5, -Math.PI / 2);
  }
});

// Macro view looking directly into the bed of chrome ball bearings, ceramic beads, and agate marbles
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 14.6, cy: 2.2, cz: 5.8,
    tx: 13.4, ty: 0.7, tz: 4.5
  };
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/checkpoint-06-ultra-real-bed-macro.png' });
console.log('Saved outputs/checkpoint-06-ultra-real-bed-macro.png');

// Direct overhead view of the full basin
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 13.4, cy: 6.2, cz: 4.5,
    tx: 13.4, ty: 0.65, tz: 4.49
  };
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/checkpoint-06-topdown-plan-view.png' });
console.log('Saved outputs/checkpoint-06-topdown-plan-view.png');

await browser.close();
console.log('Done captures.');
