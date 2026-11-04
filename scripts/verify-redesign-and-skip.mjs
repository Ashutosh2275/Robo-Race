import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('outputs');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function verify() {
  console.log('Launching browser for verification...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. Verify Redesigned Launch Hub Modal
  console.log('Checking redesigned AAA launch card...');
  const gameCard = await page.waitForSelector('.game-card');
  if (!gameCard) throw new Error('Game card not found!');

  const titleText = await page.textContent('.hub-title');
  console.log('Found launch title:', titleText);
  const editionText = await page.textContent('.hub-edition');
  console.log('Found edition:', editionText);

  const trackCards = await page.$$('.track-card');
  console.log(`Found ${trackCards.length} interactive circuit selector cards.`);
  if (trackCards.length !== 4) throw new Error(`Expected 4 track cards, found ${trackCards.length}`);

  const heroCta = await page.waitForSelector('.hub-hero-cta');
  const ctaText = await heroCta.textContent();
  console.log('Found hero CTA text:', ctaText?.trim());

  // Take screenshot of the redesigned launch hub
  const hubShotPath = path.join(outDir, 'redesigned-launch-hub.png');
  await page.screenshot({ path: hubShotPath });
  console.log(`Saved screenshot: ${hubShotPath}`);

  // Test selecting a different track card, then re-selecting Track B
  console.log('Testing track card click interaction...');
  await page.click('#cardTrackA');
  await page.waitForTimeout(300);
  const isAActive = await page.$eval('#cardTrackA', el => el.classList.contains('active'));
  console.log('Track A active after click:', isAActive);

  await page.click('#cardTrackB');
  await page.waitForTimeout(300);
  const isBActive = await page.$eval('#cardTrackB', el => el.classList.contains('active'));
  console.log('Track B active after click:', isBActive);

  // 2. Start Race and Verify Floating Skip Checkpoint Button
  console.log('Clicking ENGAGE DRIVETRAIN / START RACE...');
  await page.click('#btnStartRace');

  // Wait for countdown to finish and state to become 'racing'
  console.log('Waiting for race state to transition to "racing"...');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 10000 });

  // Verify Floating Skip Button is visible
  console.log('Checking floating skip button on the right side...');
  const skipContainer = await page.waitForSelector('#floatingSkipContainer:not(.hidden)');
  const skipVisible = await skipContainer.isVisible();
  console.log('Floating skip container visible:', skipVisible);
  if (!skipVisible) throw new Error('Floating skip container is not visible during racing!');

  const skipLabel = await page.textContent('#btnSkipCheckpoint .skip-text');
  const skipDetail = await page.textContent('#skipTargetDetail');
  console.log('Skip button label:', skipLabel?.trim(), '| Target:', skipDetail?.trim());

  // Screenshot floating skip button during racing
  const racingShotPath = path.join(outDir, 'floating-skip-button-racing.png');
  await page.screenshot({ path: racingShotPath });
  console.log(`Saved screenshot: ${racingShotPath}`);

  // 3. Test Clicking Skip Checkpoint Button
  console.log('Clicking "SKIP CHECKPOINT" button...');
  await page.click('#btnSkipCheckpoint');
  await page.waitForTimeout(500);

  const debugState = await page.evaluate(() => ({
    checkpoint: window.__gameDebug?.getCurrentCheckpoint?.(),
    raceState: window.__gameDebug?.raceState,
    robotX: window.__gameDebug?.pose?.x,
    robotZ: window.__gameDebug?.pose?.z,
    toast: document.querySelector('.toast')?.textContent,
    gatesHUD: document.querySelector('#gates')?.textContent,
    skipTarget: document.querySelector('#skipTargetDetail')?.textContent,
  }));
  console.log('After skipping Gate 01:', debugState);

  if (debugState.checkpoint !== 1) {
    throw new Error(`Expected checkpoint to advance to 1 (Gate 02), got ${debugState.checkpoint}`);
  }

  // Screenshot after skip
  const skippedShotPath = path.join(outDir, 'checkpoint-skipped-gate02.png');
  await page.screenshot({ path: skippedShotPath });
  console.log(`Saved screenshot: ${skippedShotPath}`);

  // 4. Test Key 'K' to Skip Gate 02 -> Gate 03
  console.log('Testing keyboard shortcut [K] to skip next checkpoint...');
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(500);

  const debugState2 = await page.evaluate(() => ({
    checkpoint: window.__gameDebug?.getCurrentCheckpoint?.(),
    gatesHUD: document.querySelector('#gates')?.textContent,
    skipTarget: document.querySelector('#skipTargetDetail')?.textContent,
  }));
  console.log('After pressing [K] (Gate 02 -> Gate 03):', debugState2);

  if (debugState2.checkpoint !== 2) {
    throw new Error(`Expected checkpoint to advance to 2 (Gate 03), got ${debugState2.checkpoint}`);
  }

  // 5. Test Key 'K' to Skip Gate 03 -> Gate 04 (Technical straight cleared)
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(400);
  const debugState3 = await page.evaluate(() => ({
    checkpoint: window.__gameDebug?.getCurrentCheckpoint?.(),
    gatesHUD: document.querySelector('#gates')?.textContent,
    skipTarget: document.querySelector('#skipTargetDetail')?.textContent,
  }));
  console.log('After skipping to Gate 04:', debugState3);

  // 6. Test Key 'K' to Skip Gate 04 -> Gate 05 (Spiral Summit Cleared)
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(400);
  const debugState4 = await page.evaluate(() => ({
    checkpoint: window.__gameDebug?.getCurrentCheckpoint?.(),
    robotY: window.__gameDebug?.pose?.y,
    gatesHUD: document.querySelector('#gates')?.textContent,
    skipTarget: document.querySelector('#skipTargetDetail')?.textContent,
  }));
  console.log('After skipping to Gate 05 (Spiral Summit):', debugState4);

  // Screenshot on Spiral Summit after skip
  const summitShotPath = path.join(outDir, 'checkpoint-skipped-spiral-summit.png');
  await page.screenshot({ path: summitShotPath });
  console.log(`Saved screenshot: ${summitShotPath}`);

  console.log('All verification assertions passed with flying colors!');
  await browser.close();
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
