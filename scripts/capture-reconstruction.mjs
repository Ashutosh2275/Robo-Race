import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const artifactDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
const outputsDir = path.resolve('outputs');
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

async function run() {
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
    viewport: { width: 1280, height: 720 },
  });

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

  // Start race
  const startBtn = await page.$('#btnStartRace');
  if (startBtn) await startBtn.click();
  await page.waitForTimeout(1000);

  // Skip countdown if needed
  await page.evaluate(() => {
    if (window.__gameDebug) {
      window.__gameDebug.raceState = 'racing';
      window.__gameDebug.countdown = 0;
    }
  });

  const views = [
    {
      name: 'reconstructed_approach_road_turntable_to_rock',
      desc: 'Approach road connecting turntable to rock obstacle platform',
      robotPose: { x: 10.65, z: 0.1, yaw: -Math.PI / 2 },
      cam: { cx: 12.8, cy: 3.2, cz: 0.1, tx: 5.5, ty: 0.8, tz: 0.0 },
    },
    {
      name: 'reconstructed_scurve_viaduct_rock_to_fire',
      desc: 'Monolithic watertight S-curve viaduct connecting rock field to fire platform',
      robotPose: { x: 1.4, z: 0.0, yaw: -Math.PI / 2 },
      cam: { cx: 3.8, cy: 2.8, cz: 0.0, tx: -1.5, ty: 0.5, tz: -3.5 },
    },
    {
      name: 'reconstructed_structural_pier_bents_elevation',
      desc: 'Structural pier bents and concrete foundations supporting elevated track',
      robotPose: { x: 6.0, z: 0.0, yaw: -Math.PI / 2 },
      cam: { cx: 4.5, cy: 2.0, cz: 8.5, tx: 4.5, ty: 0.3, tz: 0.0 },
    },
    {
      name: 'reconstructed_complete_corridor_aerial',
      desc: 'Aerial overview of connected turntable, approach road, rock platform and viaduct',
      robotPose: { x: 10.65, z: 0.1, yaw: -Math.PI / 2 },
      cam: { cx: 5.0, cy: 12.0, cz: 4.0, tx: 3.0, ty: 0.5, tz: -2.0 },
    },
  ];

  for (const v of views) {
    console.log(`Capturing ${v.name}...`);
    await page.evaluate((view) => {
      if (window.__teleportRobot) {
        window.__teleportRobot(view.robotPose.x, view.robotPose.z, view.robotPose.yaw);
      }
      if (window.__setCameraPose) {
        window.__setCameraPose(view.cam.cx, view.cam.cy, view.cam.cz, view.cam.tx, view.cam.ty, view.cam.tz);
      }
    }, v);

    await page.waitForTimeout(600);

    const outPath = path.join(outputsDir, `${v.name}.png`);
    const artPath = path.join(artifactDir, `${v.name}.png`);
    await page.screenshot({ path: outPath });
    fs.copyFileSync(outPath, artPath);
    console.log(`Saved: ${outPath} and ${artPath}`);
  }

  await browser.close();
  console.log('Capture complete!');
}

run().catch((err) => {
  console.error('Error during capture:', err);
  process.exit(1);
});
