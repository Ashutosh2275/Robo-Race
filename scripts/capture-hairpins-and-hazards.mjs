import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

async function main() {
  console.log('--- CAPTURING HAIRPINS, HAZARDS, AND FINISH LINE SCREENSHOTS ---');

  const server = await createServer({
    server: { port: 5182 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5182;
  const url = `http://localhost:${port}/`;
  console.log(`Vite server running at ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('Browser error:', msg.text());
    }
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  const startBtn = await page.$('#btnStartRace');
  if (startBtn) await startBtn.click();
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });

  fs.mkdirSync('outputs', { recursive: true });

  const setRobotPose = async (x, z, yaw) => {
    await page.evaluate(({ px, pz, pyaw }) => {
      const d = window.__gameDebug;
      d.motionState.x = px;
      d.motionState.z = pz;
      d.motionState.yaw = pyaw;
      d.motionState.vx = 0;
      d.motionState.vz = 0;
      d.motionState.angular = 0;
      d.pose.x = px;
      d.pose.z = pz;
      d.pose.yaw = pyaw;
      d.pose.vx = 0;
      d.pose.vz = 0;
      d.pose.pitch = 0;
      d.pose.roll = 0;
      d.pose.pitchRate = 0;
      d.pose.rollRate = 0;
      d.pose.yawRate = 0;
    }, { px: x, pz: z, pyaw: yaw });
    await page.waitForTimeout(1500);
  };

  // 1. Recreate the EXACT viewpoint from the user's uploaded image:
  // Robot at x = -11.5, z = -4.0 (approaching Hairpin 1, looking at Hairpin 1, Water, Planks, Finish)
  console.log('Capturing user view matching media_1793681280854_1bd97577.png...');
  await setRobotPose(-11.5, -4.0, -Math.PI / 2);
  await page.screenshot({ path: 'outputs/hairpin-01-user-comparison.png' });
  console.log('Saved outputs/hairpin-01-user-comparison.png');

  // 2. Close-up on Gate 09 and Environmental Hazards (Fire -> Water -> Oil)
  console.log('Capturing Gate 09 & Environmental Hazards (Fire, Water Basin, Oil)...');
  await setRobotPose(-2.5, -4.0, -Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-09-hazards.png' });
  console.log('Saved outputs/checkpoint-09-hazards.png');

  // 3. Close-up on Hairpin 1 (West U-Turn Plaza)
  console.log('Capturing Hairpin 1 West U-Turn Plaza...');
  await setRobotPose(-13.2, -6.0, Math.PI);
  await page.screenshot({ path: 'outputs/hairpin-01-apex.png' });
  console.log('Saved outputs/hairpin-01-apex.png');

  // 4. Close-up on Checkpoint 10 Parallel Planks Trestle Bridge
  console.log('Capturing Checkpoint 10 Parallel Planks Trestle Bridge...');
  await setRobotPose(-9.5, -8.0, Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-10-parallel-planks.png' });
  console.log('Saved outputs/checkpoint-10-parallel-planks.png');

  // 5. Close-up on Hairpin 2 (East U-Turn Plaza)
  console.log('Capturing Hairpin 2 East U-Turn Plaza...');
  await setRobotPose(-0.2, -10.0, 0);
  await page.screenshot({ path: 'outputs/hairpin-02-apex.png' });
  console.log('Saved outputs/hairpin-02-apex.png');

  // 6. Checkpoint 11 Finish Straight & Grand Checkered Grid
  console.log('Capturing Checkpoint 11 Finish Straight...');
  await setRobotPose(-10.0, -12.0, -Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-11-finish-straight.png' });
  console.log('Saved outputs/checkpoint-11-finish-straight.png');

  // 7. Tactical Overhead of entire Hazards, Hairpins & Planks complex
  console.log('Capturing Tactical Overhead of Hazards & Hairpins...');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'outputs/hairpins-and-hazards-tactical.png' });
  console.log('Saved outputs/hairpins-and-hazards-tactical.png');

  await browser.close();
  await server.close();
  console.log('--- ALL HAZARD & HAIRPIN SCREENSHOTS CAPTURED ---');
}

main().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
