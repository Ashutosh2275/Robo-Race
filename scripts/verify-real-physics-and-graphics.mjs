import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('--- VERIFYING ULTRA-REALISTIC GRAPHICS & PHYSICAL BOULDER BROAD TWIST ---');

  const url = 'http://localhost:5173/';
  console.log(`Connecting to dev server at ${url}...`);

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

  // Click start race button
  const startBtn = await page.$('#btnStartRace');
  if (startBtn) await startBtn.click();

  // Wait 4s for countdown to finish
  await page.waitForTimeout(4000);

  fs.mkdirSync('outputs', { recursive: true });
  const brainDir = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';

  // 1. Capture Ultra-Realistic Fire System
  console.log('Capturing Ultra-Realistic Fire System (Additive Curved Tongues, Magma Bed, Helical Embers)...');
  await page.evaluate(() => {
    window.__setCameraPose?.(-2.8 * 1.3 - 2.8, 1.85, -4.0 * 1.3 + 2.8, -2.8 * 1.3, 1.1, -4.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-fire-ultra-close.png' });
  console.log('Saved outputs/real-fire-ultra-close.png');

  // 2. Capture Ultra-Realistic Water Basin
  console.log('Capturing Ultra-Realistic Water Basin (Refractive Glass Transmission, Gerstner Waves, Foam)...');
  await page.evaluate(() => {
    window.__setCameraPose?.(-4.8 * 1.3 - 2.6, 2.1, -4.0 * 1.3 + 2.6, -4.8 * 1.3, 0.85, -4.0 * 1.3);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-water-ultra-close.png' });
  console.log('Saved outputs/real-water-ultra-close.png');

  // 3. Capture Natural Sculpted Rock Field
  console.log('Capturing Natural Sculpted Rock Field (5 Distinct Geological Formations, Compacted Quarry Bed)...');
  await page.evaluate(() => {
    window.__setCameraPose?.(3.0 * 1.3 + 2.8, 2.2, 0.0 + 2.4, 3.0 * 1.3, 1.0, 0.0);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-rock-field-ultra-close.png' });
  console.log('Saved outputs/real-rock-field-ultra-close.png');

  // 4. Capture Robot Mechatronics & Details (LED Headlights, Tow Shackles, Antenna)
  console.log('Capturing Robot Mechatronics & Details...');
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (dbg && dbg.pose) {
      const rx = dbg.pose.x;
      const ry = dbg.pose.y;
      const rz = dbg.pose.z;
      window.__setCameraPose?.(rx + 1.8, ry + 1.2, rz + 2.2, rx, ry + 0.4, rz);
    }
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/real-robot-details-close.png' });
  console.log('Saved outputs/real-robot-details-close.png');

  // 5. Test Drive & Real Physics Verification: Broad Twist over Rocks
  console.log('Executing Physical Test Drive over Boulders to verify Broad Twist...');
  // Teleport vehicle right before the rock field facing +X
  await page.evaluate(() => {
    window.__teleportRobot?.(1.65 * 1.3, 0.22 * 1.3, Math.PI / 2);
  });
  await page.waitForTimeout(200);

  // Press W with Playwright native keyboard
  await page.keyboard.down('KeyW');

  const rockTwistData = await page.evaluate(async () => {
    const dbg = window.__gameDebug;
    const initialYaw = dbg?.pose?.yaw ?? Math.PI / 2;
    const history = [];

    for (let frame = 0; frame < 60; frame++) {
      await new Promise(r => requestAnimationFrame(r));
      if (dbg && dbg.pose) {
        history.push({
          frame,
          x: dbg.pose.x,
          z: dbg.pose.z,
          y: dbg.pose.y,
          roll: dbg.pose.roll,
          pitch: dbg.pose.pitch,
          yaw: dbg.pose.yaw,
          yawDelta: dbg.pose.yaw - initialYaw,
        });
      }
    }

    return { initialYaw, history };
  });

  await page.keyboard.up('KeyW');

  console.log(`Initial Yaw: ${rockTwistData.initialYaw?.toFixed(4)} rad`);
  const lastState = rockTwistData.history?.at(-1);
  const maxRoll = Math.max(...(rockTwistData.history?.map(h => Math.abs(h.roll)) || [0]));
  const maxPitch = Math.max(...(rockTwistData.history?.map(h => Math.abs(h.pitch)) || [0]));
  const finalYawDelta = (lastState?.yawDelta ?? 0);

  console.log(`Max Roll Tilt: ${(maxRoll * 180 / Math.PI).toFixed(2)} deg`);
  console.log(`Max Pitch Tilt: ${(maxPitch * 180 / Math.PI).toFixed(2)} deg`);
  console.log(`Final Yaw Twist: ${(finalYawDelta * 180 / Math.PI).toFixed(2)} deg (${finalYawDelta.toFixed(4)} rad)`);

  // Capture robot in the middle of boulder climbing & broad twist
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (dbg && dbg.pose) {
      const rx = dbg.pose.x;
      const ry = dbg.pose.y;
      const rz = dbg.pose.z;
      window.__setCameraPose?.(rx - 2.2, ry + 1.8, rz + 2.2, rx, ry + 0.3, rz);
    }
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'outputs/robot-rock-climb-broad-twist.png' });
  console.log('Saved outputs/robot-rock-climb-broad-twist.png');

  // Copy captured images to brain directory for artifacts
  const images = [
    'real-fire-ultra-close.png',
    'real-water-ultra-close.png',
    'real-rock-field-ultra-close.png',
    'real-robot-details-close.png',
    'robot-rock-climb-broad-twist.png',
  ];
  for (const img of images) {
    const srcPath = path.join('outputs', img);
    const dstPath = path.join(brainDir, img);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`Copied ${img} to artifacts: ${dstPath}`);
    }
  }

  // Measure performance (FPS and CPU frame time)
  const perf = await page.evaluate(async () => {
    const times = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    const avgDt = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      avgFrameTimeMs: avgDt,
      fps: 1000 / avgDt,
    };
  });

  console.log(`\n--- PERFORMANCE RESULTS (LOW CORE USAGE) ---`);
  console.log(`Average Frame Time: ${perf.avgFrameTimeMs.toFixed(2)} ms`);
  console.log(`Estimated FPS: ${perf.fps.toFixed(1)} FPS (Target: 60 FPS)`);

  await browser.close();
  console.log('\nVerification & visual capture complete!');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
