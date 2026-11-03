import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Click START RACE to dismiss overlay
const btn = page.locator('#btnStartRace');
if (await btn.isVisible()) {
  await btn.click();
}
await page.waitForTimeout(1000);

// Hide UI overlay for clean inspection
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

// Helper to position camera in 3D scene using window.__overrideCamera
async function setView(camPos, targetPos) {
  await page.evaluate(({ c, t }) => {
    window.__overrideCamera = {
      cx: c[0], cy: c[1], cz: c[2],
      tx: t[0], ty: t[1], tz: t[2]
    };
  }, { c: camPos, t: targetPos });
  await page.waitForTimeout(500);
}

// 1. View corresponding to Screenshot 1 (Bridge, slopes, approaches around x=6..12, z=8)
await setView([5.0, 7.5, 3.5], [9.6, 2.5, 8.0]);
await page.screenshot({ path: 'outputs/current-view-1-bridge-slopes.png' });
console.log('Saved outputs/current-view-1-bridge-slopes.png');

// 2. View corresponding to Screenshot 2 (Hairpin 1 looking south-east from above)
await setView([-10.0, 10.0, -2.5], [-13.2, 2.0, -7.0]);
await page.screenshot({ path: 'outputs/current-view-2-hairpin-1.png' });
console.log('Saved outputs/current-view-2-hairpin-1.png');

// 3. View corresponding to Screenshot 3 (Hairpin 1 looking north-east from edge)
await setView([-16.5, 5.0, -3.5], [-11.0, 2.0, -7.5]);
await page.screenshot({ path: 'outputs/current-view-3-hairpin-side.png' });
console.log('Saved outputs/current-view-3-hairpin-side.png');

// 4. View corresponding to Screenshot 4 (Fire & Water hazard at x=-7.5, z=-4.0)
await setView([-7.5, 4.5, -0.8], [-7.5, 2.0, -4.0]);
await page.screenshot({ path: 'outputs/current-view-4-fire-water.png' });
console.log('Saved outputs/current-view-4-fire-water.png');

// 5. View corresponding to Screenshot 5 (Rock field at x in [1.4, 4.6], z ~ 0)
await setView([3.0, 4.2, 3.2], [3.0, 1.2, 0.0]);
await page.screenshot({ path: 'outputs/current-view-5-rock-field.png' });
console.log('Saved outputs/current-view-5-rock-field.png');

await browser.close();
console.log('All views captured successfully.');
