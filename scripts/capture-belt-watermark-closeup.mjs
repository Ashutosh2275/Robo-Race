import { chromium } from 'playwright';
import { preview } from 'vite';
import path from 'node:path';

async function main() {
  const previewServer = await preview({
    preview: { port: 5184 },
    build: { outDir: 'dist' },
  });

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

  await page.goto('http://localhost:5184/', { waitUntil: 'networkidle' });
  await page.click('#btnStartRace');
  await page.waitForTimeout(3500);

  // Position camera right above the bot to view belts and diagonal mechatronics clearly
  await page.evaluate(() => {
    // @ts-ignore
    const cam = window.camera;
    // @ts-ignore
    const target = window.pose;
    // Switch to overhead / close view
    // Press 'c' twice for overhead or orbit
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
  });

  await page.waitForTimeout(1000);
  const artifactDir = 'C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
  await page.screenshot({ path: path.join(artifactDir, 'verify_belt_watermark_closeup.png') });
  console.log('Saved verify_belt_watermark_closeup.png');

  await browser.close();
  await previewServer.close();
}

main().catch(console.error);
