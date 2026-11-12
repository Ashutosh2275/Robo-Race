import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire('D:/Robo Race/package.json');
const { chromium } = require('playwright');

const ARTIFACT_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/0f9d7c42-e98f-4a53-8d91-7ec6b88e763a';
const URL = 'http://localhost:5173/';

async function main() {
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

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('Navigating to game...');
  await page.goto(URL, { waitUntil: 'networkidle' });

  // 1. Start a fresh race
  await page.waitForSelector('#btnStartRace');
  await page.click('#btnStartRace');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });

  // 2. Press KeyK until all checkpoints are cleared and finish screen is triggered
  console.log('Skipping gates to reach race finish...');
  for (let i = 0; i < 20; i++) {
    const isFinished = await page.evaluate(() => window.__gameDebug?.raceState === 'finished');
    if (isFinished) break;
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(60);
  }

  await page.waitForSelector('.results-card', { timeout: 8000 });
  await page.waitForTimeout(600); // let entrance animations play out smoothly

  // Take screenshot of the victory glassmorphism modal
  await page.screenshot({ path: `${ARTIFACT_DIR}/verify_premium_results.png` });
  console.log('Saved verify_premium_results.png');

  // Verify elements are present and properly rendered
  const resultsInfo = await page.evaluate(() => {
    const card = document.querySelector('.results-card');
    const title = document.querySelector('.results-title')?.textContent;
    const timeVal = document.querySelector('.results-time-val')?.textContent;
    const metricCards = document.querySelectorAll('.results-metric-card');
    const startNextBtn = document.querySelector('#btnAgain')?.textContent;
    const menuBtn = document.querySelector('#btnMenu')?.textContent;
    const computed = card ? window.getComputedStyle(card) : null;
    return {
      title,
      timeVal,
      metricCount: metricCards.length,
      startNextBtn,
      menuBtn,
      backdropFilter: computed?.backdropFilter || computed?.webkitBackdropFilter,
      borderRadius: computed?.borderRadius,
    };
  });
  console.log('Results modal info:', resultsInfo);
  assert.equal(resultsInfo.title, 'Race Finished!');
  assert.equal(resultsInfo.metricCount, 4);
  assert.ok(resultsInfo.startNextBtn?.includes('START ROUND'));

  // 3. Test clicking "START ROUND" to ensure seamless progression
  console.log('Testing START ROUND button click...');
  await page.click('#btnAgain');
  await page.waitForTimeout(400);
  const nextRaceState = await page.evaluate(() => window.__gameDebug?.raceState);
  console.log('Next race state:', nextRaceState);
  assert.ok(nextRaceState === 'countdown' || nextRaceState === 'racing');

  // 4. Test failure modal glassmorphism
  console.log('Testing failure modal...');
  await page.evaluate(() => {
    // Deplete chassis integrity to trigger showFailure
    const s = window.__gameDebug.subsystems;
    s.integrity.chassis = 0;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${ARTIFACT_DIR}/verify_premium_failure.png` });
  console.log('Saved verify_premium_failure.png');

  assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join('; ')}`);
  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
