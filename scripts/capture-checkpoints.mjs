import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

async function main() {
  console.log('--- CAPTURING CHECKPOINT 5 & 6 DETAILED SCREENSHOTS ---');

  const server = await createServer({
    server: { port: 5180 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5180;
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
    // Allow camera lerp to catch up
    await page.waitForTimeout(1500);
  };

  // 1. Move to Checkpoint 4 approach looking at Checkpoint 5 Bridge
  console.log('Capturing Gate 04 & Bridge Approach (Checkpoint 5 entrance)...');
  await setRobotPose(4.5, 8.0, Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-05-approach.png' });
  console.log('Saved outputs/checkpoint-05-approach.png');

  // 2. Move to Checkpoint 5 Bridge Crest
  console.log('Capturing Checkpoint 5 Bridge Crest...');
  await setRobotPose(9.6, 8.0, Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-05-crest.png' });
  console.log('Saved outputs/checkpoint-05-crest.png');

  // 3. Move to Bridge Descent & Checkpoint 6 Turn Shelf Entry
  console.log('Capturing Bridge Descent towards Checkpoint 6...');
  await setRobotPose(11.8, 8.0, Math.PI / 2);
  await page.screenshot({ path: 'outputs/checkpoint-05-to-06-descent.png' });
  console.log('Saved outputs/checkpoint-05-to-06-descent.png');

  // 4. Move to Checkpoint 6 Marble Pit Turn
  console.log('Capturing Checkpoint 6 Marble Pit & Turning Shelf...');
  await setRobotPose(13.2, 5.0, Math.atan2(3.6, -3.3));
  await page.screenshot({ path: 'outputs/checkpoint-06-marble-pit.png' });
  console.log('Saved outputs/checkpoint-06-marble-pit.png');

  // 5. Tactical Overhead Camera to view Checkpoints 5 & 6 synchronisation
  console.log('Capturing Tactical Overhead of CP6...');
  // Press 'C' twice to cycle to Tactical Overhead
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'outputs/checkpoints-5-6-tactical.png' });
  console.log('Saved outputs/checkpoints-5-6-tactical.png');

  await browser.close();
  await server.close();
  console.log('--- ALL CHECKPOINT SCREENSHOTS CAPTURED ---');
}

main().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
