import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
const OUTPUTS_DIR = 'd:/Robo Race/outputs';

if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

async function run() {
  console.log('Launching browser for multi-level spiral verification...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 }
  });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Click start race
  const startBtn = await page.$('#btnStartRace');
  if (startBtn) {
    await startBtn.click();
    console.log('Clicked start race button');
  }
  await page.waitForTimeout(1000);

  const views = [
    {
      name: 'spiral_overview',
      desc: '1. Full parking garage spiral climbing ramp overview',
      cam: {
        cx: -3.5 * 1.3,
        cy: 14.5,
        cz: 13.5 * 1.3,
        tx: -3.5 * 1.3,
        ty: 1.2,
        tz: 0.0
      }
    },
    {
      name: 'spiral_ground_entrance',
      desc: '2. Ground-level entrance to spiral ramp (Gate 05)',
      cam: {
        cx: -12.5 * 1.3,
        cy: 4.5,
        cz: -4.5 * 1.3,
        tx: -7.70 * 1.3,
        ty: 0.2,
        tz: 0.0
      }
    },
    {
      name: 'spiral_midway_climb',
      desc: '3. Midway climbing section of helical ramp (Gate 06)',
      cam: {
        cx: -3.5 * 1.3,
        cy: 6.2,
        cz: 8.5 * 1.3,
        tx: -3.5 * 1.3,
        ty: 1.0,
        tz: 4.20 * 1.3
      }
    },
    {
      name: 'spiral_rooftop_platform',
      desc: '4. Upper rooftop observation deck and turntable (Gate 07)',
      cam: {
        cx: 1.0 * 1.3,
        cy: 6.5,
        cz: 5.5 * 1.3,
        tx: 1.0 * 1.3,
        ty: 1.8,
        tz: 0.0
      }
    },
    {
      name: 'spiral_descending_ramp',
      desc: '5. Connected descending viaduct ramp returning to ground (Gate 08)',
      cam: {
        cx: 13.5 * 1.3,
        cy: 6.5,
        cz: 5.5 * 1.3,
        tx: 7.25 * 1.3,
        ty: 0.8,
        tz: 0.0
      }
    },
    {
      name: 'lane5_mandatory_fire_water_finish',
      desc: '6. Mandatory final sequence: Fire platform -> Water basin -> Grand Finish',
      cam: {
        cx: 4.0 * 1.3,
        cy: 12.0,
        cz: -3.5 * 1.3,
        tx: 4.0 * 1.3,
        ty: 0.0,
        tz: -13.50 * 1.3
      }
    }
  ];

  for (const v of views) {
    console.log('Capturing:', v.desc);
    await page.evaluate(cam => {
      window.__overrideCamera = cam;
    }, v.cam);

    await page.waitForTimeout(600);

    const outPath = path.join(OUTPUTS_DIR, `${v.name}.png`);
    const artPath = path.join(ARTIFACTS_DIR, `${v.name}.png`);

    await page.screenshot({ path: outPath, fullPage: false });
    fs.copyFileSync(outPath, artPath);
    console.log('Saved:', outPath, 'and artifact:', artPath);
  }

  await browser.close();
  console.log('All 6 verification captures completed successfully!');
}

run().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
