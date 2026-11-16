import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';

async function main() {
  console.log('--- TESTING NETLIFY PRODUCTION DIST BUILD IN CHROME ---');

  // Preview the production 'dist' directory
  const previewServer = await preview({
    preview: { port: 5177 },
    build: { outDir: 'dist' },
  });

  const address = previewServer.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5177;
  const url = `http://localhost:${port}/`;
  console.log(`Preview server running at ${url}`);

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

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  console.log('Navigating to production build...');
  await page.goto(url, { waitUntil: 'networkidle' });

  // Verify launcher menu keys footer
  const menuFooter = await page.$('#menuKeysFooter');
  assert.ok(menuFooter, 'Menu keys footer should be present');
  const footerText = await menuFooter.textContent();
  console.log(`Launcher Menu Keys: "${footerText?.trim()}"`);
  assert.ok(footerText?.includes('Drive'), 'Menu should show Drive controls');

  // Start Race
  const startBtn = await page.$('#btnStartRace');
  assert.ok(startBtn, 'Start race button must be present');
  await startBtn.click();

  // Wait for countdown to finish and racing state to engage
  await page.waitForFunction(() => {
    const el = document.querySelector('#hudInputBadge');
    return el && el.textContent?.includes('KEYBOARD');
  }, { timeout: 10000 });

  const badgeText = await page.$eval('#hudInputBadge', el => el.textContent);
  console.log(`HUD Input Badge: "${badgeText}"`);
  assert.ok(badgeText?.includes('KEYBOARD'), 'Default input should be keyboard');

  const guideHtml = await page.$eval('#hudControlsGuide', el => el.innerHTML);
  console.log(`HUD Controls Guide HTML preview: ${guideHtml.slice(0, 100)}...`);
  assert.ok(guideHtml.includes('DRIVE'), 'Controls guide must explain Drive');
  assert.ok(guideHtml.includes('BRAKE'), 'Controls guide must explain Brake');
  assert.ok(guideHtml.includes('30s TECH PIT'), 'Controls guide must explain Tech Pit');

  // Take screenshot of the live HUD controls guide
  const screenshotPath = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a/verify_dist_controls_hud.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  assert.equal(errors.length, 0, `Page had errors: ${errors.join(', ')}`);
  console.log('--- ALL NETLIFY DIST TESTS PASSED CLEANLY ---');

  await browser.close();
  await new Promise(resolve => previewServer.httpServer?.close(resolve));
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
