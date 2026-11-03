import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ARTIFACT_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';

async function main() {
  console.log('--- STARTING COMPREHENSIVE CIRCUIT SCREENSHOT CAPTURE ---');

  // Start Vite Server
  const server = await createServer({
    server: { port: 5178 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5178;
  const url = `http://localhost:${port}/`;

  // Launch Chrome
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  const startBtn = await page.$('#btnStartRace');
  if (startBtn) await startBtn.click();
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 7000 });
  await page.waitForTimeout(1000);

  const views = [
    {
      name: 'full_circuit_topdown_aerial',
      desc: 'Top-down aerial view of entire 48m x 35.6m arena showing 5 parallel lanes, 4 hairpins, 2.35m chasms, and 100% map footprint utilization',
      cam: { cx: 0, cy: 52, cz: 0, tx: 0, ty: 0, tz: 0 },
    },
    {
      name: 'full_circuit_isometric_overview',
      desc: 'Isometric overview showing all 5 viaduct tiers, piers, obstacles, and lighting',
      cam: { cx: -28, cy: 32, cz: 30, tx: 0, ty: 0, tz: 0 },
    },
    {
      name: 'lane1_rock_field_platform',
      desc: 'Reconstructed rock field platform on Lane 1 with boulders distributed across the full usable width',
      cam: { cx: 13, cy: 8, cz: 23, tx: 13, ty: 1, tz: 17.55 },
    },
    {
      name: 'lane2_climbing_hill_and_fire',
      desc: 'Climbing hill summit, slope descent, and elevated refractory fire platform on Lane 2',
      cam: { cx: 10, cy: 8, cz: 14, tx: 6, ty: 1.5, tz: 8.775 },
    },
    {
      name: 'lane2_fire_and_water_basin',
      desc: 'Fire platform, cooling bridge, and deep water basin with mirror water on Lane 2',
      cam: { cx: 3, cy: 7, cz: 14, tx: -4, ty: 0, tz: 8.775 },
    },
    {
      name: 'lane3_turntable_and_marble_pit',
      desc: 'Industrial motorized turntable, oil skid pad, and marble pit on Lane 3',
      cam: { cx: -2, cy: 7, cz: 6, tx: -5, ty: 1, tz: 0 },
    },
    {
      name: 'lane4_warren_bridge_and_planks',
      desc: 'Grand Warren steel arch bridge and parallel plank balance obstacle on Lane 4',
      cam: { cx: 4, cy: 8, cz: -14, tx: 2, ty: 1, tz: -8.775 },
    },
    {
      name: 'lane5_grand_finish_straight',
      desc: 'Final acceleration straightaway and Grand Finish Checkered Gantry on Lane 5',
      cam: { cx: 8, cy: 6, cz: -21, tx: 15, ty: 1, tz: -17.55 },
    },
  ];

  for (const v of views) {
    console.log(`Capturing ${v.name}...`);
    await page.evaluate(({ cx, cy, cz, tx, ty, tz }) => {
      window.__setCameraPose(cx, cy, cz, tx, ty, tz);
    }, v.cam);
    await page.waitForTimeout(600);

    const localPath = `outputs/${v.name}.png`;
    const artifactPath = path.join(ARTIFACT_DIR, `${v.name}.png`);
    await page.screenshot({ path: localPath });
    fs.copyFileSync(localPath, artifactPath);
    console.log(`Saved ${localPath} and ${artifactPath}`);
  }

  await browser.close();
  await server.close();
  console.log('--- ALL SCREENSHOTS CAPTURED SUCCESSFULLY ---');
}

main().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
