import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('--- CAPTURING BLENDER-GRADE FIRE, WATER & SINGLE PATH RACE ARENA ---');

  const server = await createServer({
    server: { port: 5185 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5185;
  const url = `http://localhost:${port}/`;
  console.log(`Vite server running at ${url}`);

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  const startBtn = await page.$('#btnStartRace');
  if (startBtn) await startBtn.click();

  // Wait 3.5s for countdown to finish and animations to stabilize
  await page.waitForTimeout(4000);

  fs.mkdirSync('outputs', { recursive: true });

  const brainDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';

  // Helper to set Three.js camera position and lookAt target directly
  const setCamera = async (camX, camY, camZ, targetX, targetY, targetZ) => {
    await page.evaluate(({ cx, cy, cz, tx, ty, tz }) => {
      // Find Three.js camera and controls in main scope
      const cam = window.__gameCamera;
      if (cam) {
        cam.position.set(cx, cy, cz);
        cam.lookAt(tx, ty, tz);
      }
    }, { cx: camX, cy: camY, cz: camZ, tx: targetX, ty: targetY, tz: targetZ });
    // Let animation loop run 20 frames
    await page.waitForTimeout(500);
  };

  // 1. Checkpoint 09: Ultra-Realistic Volumetric Fire & Ascending Spark Embers
  console.log('Capturing Checkpoint 09 Real Fire System...');
  await page.evaluate(() => {
    // Position camera close to the fire hearth
    window.__setCameraPose?.(-4.8 * 1.3, 2.2, -4.0 * 1.3 + 3.2, -2.8 * 1.3, 1.2, -4.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-fire-volumetric-close.png' });
  console.log('Saved outputs/real-fire-volumetric-close.png');

  // 2. Checkpoint 09: Sunken Water Cooling Basin with Gerstner Waves
  console.log('Capturing Checkpoint 09 Real Water Basin...');
  await page.evaluate(() => {
    window.__setCameraPose?.(-4.8 * 1.3 - 2.8, 2.4, -4.0 * 1.3 + 2.8, -4.8 * 1.3, 0.8, -4.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-water-basin-close.png' });
  console.log('Saved outputs/real-water-basin-close.png');

  // 3. Checkpoint 05: Grand Arch Bridge & Real Fluid Water River Basin
  console.log('Capturing Checkpoint 05 Grand Bridge & Fluid River...');
  await page.evaluate(() => {
    window.__setCameraPose?.(9.6 * 1.3 - 4.5, 3.2, 8.0 * 1.3 + 4.5, 9.6 * 1.3, 1.0, 8.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-water-river-bridge.png' });
  console.log('Saved outputs/real-water-river-bridge.png');

  // 4. Central Safety Barrier Walls (Confirming Single Continuous Path without mixed paths)
  console.log('Capturing Central Safety Barrier Walls & Single-Path Corridors...');
  await page.evaluate(() => {
    // High angle looking down the 3 channelized lanes (z = -4, -8, -12)
    window.__setCameraPose?.(-6.85 * 1.3, 7.5, -8.0 * 1.3 + 9.5, -6.85 * 1.3, 1.0, -8.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/single-path-channelized-lanes.png' });
  console.log('Saved outputs/single-path-channelized-lanes.png');

  // 5. Tactical Overhead Stadium View of Entire Single-Path Championship Circuit
  console.log('Capturing Full Circuit Tactical Arena Overview...');
  await page.evaluate(() => {
    window.__setCameraPose?.(0, 24, 0, 0, 0, 0);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/championship-circuit-tactical-overview.png' });
  console.log('Saved outputs/championship-circuit-tactical-overview.png');

  // Synchronize to artifacts
  const captures = [
    'real-fire-volumetric-close.png',
    'real-water-basin-close.png',
    'real-water-river-bridge.png',
    'single-path-channelized-lanes.png',
    'championship-circuit-tactical-overview.png',
  ];
  for (const c of captures) {
    const src = path.join('outputs', c);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(brainDir, c));
    }
  }

  console.log('All visual captures synchronized to artifacts directory!');
  await browser.close();
  await server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
