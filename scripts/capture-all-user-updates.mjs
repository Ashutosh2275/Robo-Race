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
await page.waitForTimeout(1000);

// Hide UI overlay for clean inspection
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});

async function setView(camPos, targetPos) {
  await page.evaluate(({ c, t }) => {
    window.__overrideCamera = {
      cx: c[0], cy: c[1], cz: c[2],
      tx: t[0], ty: t[1], tz: t[2]
    };
  }, { c: camPos, t: targetPos });
  await page.waitForTimeout(600);
}

// 1. View of the 45-Degree Descent Ramp connecting elevated rock field to ground
await setView([2.8, 3.5, 0.5], [0.2, 0.2, -1.5]);
await page.screenshot({ path: 'outputs/descent-ramp-45-deg.png' });
console.log('Saved outputs/descent-ramp-45-deg.png');

// 2. View of the Ground-Level Fire Hazard and 0.5m Deep Still Water Basket
await setView([-0.8, 3.2, 0.5], [-3.8, 0.0, -4.0]);
await page.screenshot({ path: 'outputs/ground-fire-and-water-basket.png' });
console.log('Saved outputs/ground-fire-and-water-basket.png');

// 3. Close-up Macro of the Still Water Basket
await setView([-4.8, 2.2, -1.8], [-4.8, -0.1, -4.0]);
await page.screenshot({ path: 'outputs/water-basket-still-close.png' });
console.log('Saved outputs/water-basket-still-close.png');

// 4. View of Checkpoint 06 turn and bridge exit (showing unblocked full 6m roadway)
await setView([11.2, 5.5, 11.5], [13.2, 1.2, 4.5]);
await page.screenshot({ path: 'outputs/checkpoint-06-unblocked-plaza.png' });
console.log('Saved outputs/checkpoint-06-unblocked-plaza.png');

await browser.close();
console.log('Capture completed successfully.');
