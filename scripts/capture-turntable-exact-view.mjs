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

// Hide UI for pristine render
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

// Teleport robot to Gate 06 approach (x=13.0, z=4.8) matching user screenshot
await page.evaluate(() => {
  const dbg = window.__ROBO_RACE_DEBUG__;
  if (dbg && dbg.teleport) {
    dbg.teleport(13.0, 4.8, -1.8);
  }
});

// Position camera exactly as in user screenshot media_1793692283894_075b7b92.png
// The camera looks from above the chicane towards the turntable at x=10.65, z=0.1
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 14.5, cy: 5.6, cz: 6.2,
    tx: 8.5, ty: 1.0, tz: -0.2
  };
});
await page.waitForTimeout(600);

await page.screenshot({ path: 'outputs/turntable-exact-view-fixed.png' });
console.log('Saved outputs/turntable-exact-view-fixed.png');

// Also capture close-up of the rotating turntable
await page.evaluate(() => {
  window.__overrideCamera = {
    cx: 12.5, cy: 3.2, cz: 2.2,
    tx: 10.65, ty: 1.1, tz: 0.1
  };
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'outputs/turntable-close-polished.png' });
console.log('Saved outputs/turntable-close-polished.png');

await browser.close();
console.log('Done.');
