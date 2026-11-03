import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('--- CAPTURING ROBOT DRIVING MILESTONES ---');

  const server = await createServer({
    server: { port: 5188 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5188;
  const url = `http://localhost:${port}/`;

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
  await page.waitForTimeout(3500);

  const brainDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';

  // Helper to place robot and camera for exact milestone captures
  const captureMilestone = async (name, poseX, poseY, poseZ, poseYaw, camX, camY, camZ, targetX, targetY, targetZ) => {
    await page.evaluate(({ px, py, pz, pyaw, cx, cy, cz, tx, ty, tz }) => {
      const dbg = window.__gameDebug;
      if (dbg) {
        dbg.pose.x = px;
        dbg.pose.y = py;
        dbg.pose.z = pz;
        dbg.pose.yaw = pyaw;
        dbg.motionState.x = px;
        dbg.motionState.z = pz;
        dbg.motionState.yaw = pyaw;
      }
      window.__setCameraPose?.(cx, cy, cz, tx, ty, tz);
    }, { px: poseX, py: poseY, pz: poseZ, pyaw: poseYaw, cx: camX, cy: camY, cz: camZ, tx: targetX, ty: targetY, tz: targetZ });

    // Let animation loop run 25 frames
    await page.waitForTimeout(600);
    const outPath = `outputs/${name}.png`;
    await page.screenshot({ path: outPath });
    console.log(`Saved ${outPath}`);
    if (fs.existsSync(outPath)) {
      fs.copyFileSync(outPath, path.join(brainDir, `${name}.png`));
    }
  };

  // 1. Robot traversing Checkpoint 09 Fire Hearth with glowing charcoal and volumetric flames
  console.log('Capturing Robot at Fire Hearth...');
  await captureMilestone(
    'robot-traversing-fire-hearth',
    -2.8 * 1.3, 0.45, -4.0 * 1.3, -Math.PI / 2, // robot position (westbound)
    -1.4 * 1.3, 1.8, -4.0 * 1.3 + 2.4,          // camera pos
    -3.2 * 1.3, 0.7, -4.0 * 1.3                  // target pos
  );

  // 2. Robot plunging into Checkpoint 09 Sunken Water Cooling Basin with dynamic waves
  console.log('Capturing Robot in Water Basin...');
  await captureMilestone(
    'robot-plunging-water-basin',
    -4.8 * 1.3, 0.45, -4.0 * 1.3, -Math.PI / 2,
    -3.4 * 1.3, 1.9, -4.0 * 1.3 + 2.5,
    -5.2 * 1.3, 0.7, -4.0 * 1.3
  );

  // 3. Robot driving across Checkpoint 10 Precision Parallel Planks
  console.log('Capturing Robot on Parallel Planks...');
  await captureMilestone(
    'robot-crossing-parallel-planks',
    -9.75, 0.88, -10.40, Math.PI / 2, // robot position (eastbound)
    -12.8, 2.1, -10.40 + 2.6,
    -9.0, 0.9, -10.40
  );

  // 4. Robot crossing Checkpoint 11 Finish Line under Box-Truss Gantry & Gold Laser
  console.log('Capturing Robot at Finish Line...');
  await captureMilestone(
    'robot-crossing-finish-line',
    -17.16, 0.67, -15.60, -Math.PI / 2,
    -14.2, 2.2, -15.60 + 2.8,
    -18.0, 1.1, -15.60
  );

  console.log('All robot milestone captures completed and synchronized!');
  await browser.close();
  await server.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Milestone capture failed:', err);
  process.exit(1);
});
