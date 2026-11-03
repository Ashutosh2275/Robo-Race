import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const artifactDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
const outputsDir = path.resolve('outputs');
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

async function run() {
  console.log('--- CAPTURING LANE SEPARATION & VIADUCT RECONSTRUCTION ---');
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

  // Set state to racing
  await page.evaluate(() => {
    if (window.__gameDebug) {
      window.__gameDebug.raceState = 'racing';
      window.__gameDebug.countdown = 0;
    }
  });

  const views = [
    {
      name: 'lane_separation_exact_user_view',
      desc: 'Exact match perspective of user screenshot showing separated roads, open chasm, and centered middle track',
      robotPose: { x: -11.5, z: -4.0, yaw: -Math.PI / 2 },
      cam: { cx: -8.0, cy: 11.0, cz: 2.0, tx: -9.5, ty: 0.67, tz: -10.0 },
    },
    {
      name: 'lane_separation_aerial_overview',
      desc: 'Top-down aerial view showing symmetric lane spacing, open air chasms, and curved viaduct hairpins',
      robotPose: { x: -7.5, z: -9.2, yaw: Math.PI / 2 },
      cam: { cx: -8.0, cy: 18.0, cz: -9.0, tx: -8.0, ty: 0.67, tz: -9.2 },
    },
    {
      name: 'lane_separation_chasm_close_up',
      desc: 'Close-up showing independent bridge decks, concrete parapet barriers, yellow coping, and open gap between roads',
      robotPose: { x: -7.5, z: -9.2, yaw: Math.PI / 2 },
      cam: { cx: -1.0, cy: 3.5, cz: -11.8, tx: -10.0, ty: 0.8, tz: -11.8 },
    },
    {
      name: 'hairpin1_curved_viaduct_ribbon',
      desc: 'Hairpin 1 semicircular elevated viaduct ribbon connecting Lane 1 to Lane 2 with open inner space',
      robotPose: { x: -13.2, z: -4.0, yaw: -Math.PI / 2 },
      cam: { cx: -9.5, cy: 5.5, cz: -6.6, tx: -16.0, ty: 0.67, tz: -6.6 },
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

    await page.waitForTimeout(700);

    const outPath = path.join(outputsDir, `${v.name}.png`);
    await page.screenshot({ path: outPath });
    console.log(`Saved ${outPath}`);

    // Also copy to artifact directory
    const artPath = path.join(artifactDir, `${v.name}.png`);
    fs.copyFileSync(outPath, artPath);
    console.log(`Copied to artifact ${artPath}`);
  }

  await browser.close();
  console.log('--- ALL SCREENSHOTS CAPTURED ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
