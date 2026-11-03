import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const objects = await page.evaluate(() => {
  // Access three.js scene if attached to window or traverse
  const results = [];
  // Find scene from renderer or canvas
  const canvas = document.querySelector('canvas');
  // In main.ts, let's see if scene or colliders are accessible
  return window.__sceneObjects || (window.__colliders ? window.__colliders.map(c => ({ id: c.id, x: c.x, z: c.z, y: c.y, hx: c.hx, hz: c.hz, rot: c.rot })) : []);
});

console.log('Colliders / objects near ramp/fire:', objects.filter(o => o.x >= -4 && o.x <= 2 && o.z >= -6 && o.z <= 2));

await browser.close();
