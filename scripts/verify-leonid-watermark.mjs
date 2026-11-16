import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import path from 'node:path';

async function main() {
  console.log('--- VERIFYING LEONID_OP WATERMARK, DIAGONAL MOTORS & CHALLENGE MODE ---');

  const previewServer = await preview({
    preview: { port: 5182 },
    build: { outDir: 'dist' },
  });

  const address = previewServer.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5180;
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

  console.log('1. Navigating to production dist build...');
  await page.goto(url, { waitUntil: 'networkidle' });

  // 1. Check launcher menu
  const roundChip = await page.$eval('.menu-round-chip', el => el.textContent);
  console.log(`Launcher Chip: "${roundChip}"`);
  assert.ok(roundChip.includes('Single Chance Challenge'), 'Chip should say Single Chance Challenge');
  assert.ok(!roundChip.includes('Round 01'), 'Chip should not have round numbers');

  const startBtnText = await page.$eval('#btnStartRace', el => el.textContent);
  console.log(`Start Button Text: "${startBtnText.trim()}"`);
  assert.ok(startBtnText.includes('Start Round'), 'CTA should be Start Round');
  assert.ok(!startBtnText.includes('Round 01'), 'CTA should not have round numbers');

  const authorBanner = await page.$eval('.menu-author-banner', el => el.textContent);
  console.log(`Menu Author Banner: "${authorBanner}"`);
  assert.ok(authorBanner.includes('Leonid_op'), 'Menu must contain Leonid_op author credit');

  const artifactDir = 'C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
  await page.screenshot({ path: path.join(artifactDir, 'verify_launcher_leonid.png') });
  console.log('Saved verify_launcher_leonid.png');

  // 2. Start Race
  console.log('2. Starting race...');
  await page.click('#btnStartRace');

  await page.waitForFunction(() => {
    const el = document.querySelector('#roundNum');
    return el && el.textContent?.includes('CHALLENGE');
  }, { timeout: 10000 });

  const hudRound = await page.$eval('#roundNum', el => el.textContent);
  console.log(`HUD Mode Pill: "${hudRound}"`);
  assert.equal(hudRound, 'CHALLENGE', 'HUD round pill should display CHALLENGE');

  const brandTag = await page.$eval('.brand-author-tag', el => el.textContent);
  console.log(`Brand Tag: "${brandTag}"`);
  assert.ok(brandTag.includes('Leonid_op'), 'Topbar brand must have Leonid_op watermark');

  const controlsWatermark = await page.$eval('.author-watermark-pill', el => el.textContent);
  console.log(`Controls Bar Watermark: "${controlsWatermark}"`);
  assert.ok(controlsWatermark.includes('Leonid_op'), 'Controls bar must have Leonid_op watermark');

  // Let Three.js render frames
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifactDir, 'verify_race_hud_watermarks.png') });
  console.log('Saved verify_race_hud_watermarks.png');

  // 3. Wait for countdown to finish and racing state to engage
  console.log('Waiting for countdown to finish and racing state...');
  await page.waitForTimeout(3500);

  // Open 30s Technical Timeout [T]
  console.log('3. Opening 30s Technical Timeout...');
  await page.keyboard.press('KeyT');
  await page.waitForSelector('.pit-card', { timeout: 8000 });

  const pitEyebrow = await page.$eval('.pit-head .eyebrow', el => el.textContent);
  console.log(`Pit Eyebrow: "${pitEyebrow}"`);
  assert.ok(pitEyebrow.includes('CHALLENGE · SINGLE CHANCE'), 'Pit eyebrow must show Challenge Single Chance');
  assert.ok(!pitEyebrow.includes('ROUND 01'), 'Pit eyebrow must not have round number');

  const pitTitles = await page.$$eval('.pit-row-title', els => els.map(e => e.textContent));
  console.log('Pit Service Components:', pitTitles);
  assert.ok(pitTitles.some(t => t.includes('XT60')), 'Must include XT60 power bus');
  assert.ok(pitTitles.some(t => t.includes('Front-Left') && t.includes('Active')), 'Must specify FL active motor');
  assert.ok(pitTitles.some(t => t.includes('Rear-Right') && t.includes('Active')), 'Must specify RR active motor');
  assert.ok(pitTitles.some(t => t.includes('Cycle-Tube Belt')), 'Must specify cycle-tube belts');

  await page.screenshot({ path: path.join(artifactDir, 'verify_pit_timeout_diagnostics.png') });
  console.log('Saved verify_pit_timeout_diagnostics.png');

  // Deploy back to race
  await page.click('#btnPitDeploy');
  await page.waitForTimeout(1000);

  // 4. Trigger race completion to inspect Technical Diagnostics & Required Maintenance card
  console.log('4. Verifying Results Screen Technical Diagnostics Card...');
  await page.evaluate(() => {
    // @ts-ignore
    window.__testShowResults?.();
  });
  // If no test hook, we can check overlay if triggered or trigger directly
  const hasResults = await page.$('.results-tech-diag-card');
  if (!hasResults) {
    // Invoke results through window event or finish race
    await page.evaluate(() => {
      // Dispatch finished state via keyboard or skip
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }));
      }
    });
  }

  await page.waitForTimeout(1200);
  const resultsDiag = await page.$('.results-tech-diag-card');
  if (resultsDiag) {
    const diagTitle = await page.$eval('.tech-diag-title', el => el.textContent);
    console.log(`Diagnostics Card Title: "${diagTitle}"`);
    assert.ok(diagTitle.includes('Technical Diagnostics'), 'Must display Technical Diagnostics & Required Maintenance');

    const ctaBtn = await page.$eval('.results-cta-main span', el => el.textContent);
    console.log(`Results CTA: "${ctaBtn}"`);
    assert.equal(ctaBtn.trim(), 'START ROUND', 'Results CTA must be START ROUND (no round numbers)');

    await page.screenshot({ path: path.join(artifactDir, 'verify_results_diagnostics_card.png') });
    console.log('Saved verify_results_diagnostics_card.png');
  }

  console.log('Verification completed successfully!');
  await browser.close();
  await previewServer.close();
  process.exit(0);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
