import { chromium } from 'playwright';
import fs from 'node:fs';

async function auditInChrome() {
  console.log('=== LAUNCHING REAL GOOGLE CHROME FOR DEEP AUDIT ===');
  
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, // we can run headless or with a virtual window
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=1280,720'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleMessages.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log('CHROME CONSOLE:', text);
    }
  });

  page.on('pageerror', err => {
    console.error('CHROME UNCAUGHT PAGE ERROR:', err);
    pageErrors.push(err.toString());
  });

  page.on('requestfailed', req => {
    console.warn(`CHROME REQUEST FAILED: ${req.url()} (${req.failure()?.errorText})`);
    requestFailures.push({ url: req.url(), error: req.failure()?.errorText });
  });

  console.log('Navigating to http://localhost:5173/ ...');
  const response = await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 15000 });
  console.log('HTTP Status:', response.status());

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'outputs/chrome-audit-01-intro.png' });

  // 1. Audit Start Screen DOM and buttons
  const startBtn = await page.$('#btnStartRace');
  console.log('Start button exists:', !!startBtn);
  if (!startBtn) {
    throw new Error('Start button #btnStartRace not found');
  }

  // Check Settings & Diagnostics before race start
  const settingsBtn = await page.$('#btnMenuSettings');
  console.log('Menu Settings button exists:', !!settingsBtn);
  if (settingsBtn) {
    await settingsBtn.click();
    await page.waitForTimeout(400);
    const settingsPanel = await page.$('#settings');
    const isSettingsVisible = await settingsPanel?.isVisible();
    console.log('Settings panel opened:', isSettingsVisible);
    await page.screenshot({ path: 'outputs/chrome-audit-02-settings.png' });

    // Check Diagnostics modal
    const openCalibBtn = await page.$('#openCalibBtn');
    if (openCalibBtn) {
      await openCalibBtn.click();
      await page.waitForTimeout(400);
      const diagModal = await page.$('#diagnosticsModal');
      const isDiagVisible = await diagModal?.isVisible();
      console.log('Diagnostics modal opened:', isDiagVisible);
      await page.screenshot({ path: 'outputs/chrome-audit-03-diagnostics.png' });

      const closeCalibBtn = await page.$('#closeCalibBtn');
      if (closeCalibBtn) await closeCalibBtn.click();
      await page.waitForTimeout(300);
    }

    // Close settings
    const closeSettingsBtn = await page.$('#closeSettingsBtn');
    if (closeSettingsBtn) await closeSettingsBtn.click();
    await page.waitForTimeout(300);
  }

  // 2. Start Race
  console.log('Clicking Start Race...');
  await page.click('#btnStartRace');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'outputs/chrome-audit-04-countdown.png' });

  // Wait for countdown to finish and race to become active
  console.log('Waiting for raceState to become racing...');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 15000 });
  console.log('Race is active!');
  await page.screenshot({ path: 'outputs/chrome-audit-05-racing-hud.png' });

  // 3. Inspect Window and GameDebug state
  const debugState = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return {
      hasDebug: !!dbg,
      raceState: dbg?.raceState,
      pose: dbg?.pose,
      subsystems: dbg?.subsystems,
      contact: dbg?.contact,
      currentCheckpoint: dbg?.currentCheckpoint,
      totalCheckpoints: dbg?.totalCheckpoints
    };
  });
  console.log('Debug state on start:', JSON.stringify(debugState, null, 2));

  // 4. Test Key Controls: W, S, A, D, T, Space, R, C
  console.log('Testing W driving...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  const wSpeed = await page.evaluate(() => Math.hypot(window.__gameDebug.pose.vx, window.__gameDebug.pose.vz));
  console.log('Speed during W:', wSpeed.toFixed(2), 'm/s');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  console.log('Testing Steering A...');
  const yawBeforeA = await page.evaluate(() => window.__gameDebug.pose.yaw);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(800);
  const yawAfterA = await page.evaluate(() => window.__gameDebug.pose.yaw);
  console.log('Yaw delta A:', (yawAfterA - yawBeforeA).toFixed(3));
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(300);

  console.log('Testing Steering D...');
  const yawBeforeD = await page.evaluate(() => window.__gameDebug.pose.yaw);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  const yawAfterD = await page.evaluate(() => window.__gameDebug.pose.yaw);
  console.log('Yaw delta D:', (yawAfterD - yawBeforeD).toFixed(3));
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300);

  console.log('Testing Camera change C...');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'outputs/chrome-audit-06-camera-c.png' });

  console.log('Testing Recovery R...');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  const poseAfterR = await page.evaluate(() => window.__gameDebug.pose);
  console.log('Pose after recovery R:', poseAfterR.x.toFixed(2), poseAfterR.z.toFixed(2), 'yaw:', poseAfterR.yaw.toFixed(2));

  // 5. Check performance metrics & WebGL status
  const perfMetrics = await page.evaluate(() => {
    const gl = document.getElementById('game')?.getContext('webgl2');
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
      memory: window.performance?.memory ? {
        totalJSHeapSize: (window.performance.memory.totalJSHeapSize / 1048576).toFixed(1) + ' MB',
        usedJSHeapSize: (window.performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB'
      } : 'not exposed'
    };
  });
  console.log('WebGL and Performance Info:', perfMetrics);

  // 6. Check UI elements and styling:
  const uiAudit = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    const speedEl = document.getElementById('spd');
    const lapEl = document.getElementById('lap');
    const checkpointEl = document.getElementById('cp');
    const batEl = document.getElementById('bat');
    const motEl = document.getElementById('mot');
    const hltEl = document.getElementById('hlt');
    const touchControls = document.getElementById('touch-controls');
    
    return {
      hudVisible: hud ? window.getComputedStyle(hud).display !== 'none' : false,
      speedText: speedEl?.textContent,
      lapText: lapEl?.textContent,
      checkpointText: checkpointEl?.textContent,
      batteryText: batEl?.textContent,
      motorTempText: motEl?.textContent,
      healthText: hltEl?.textContent,
      touchControlsPresent: !!touchControls,
      touchControlsDisplay: touchControls ? window.getComputedStyle(touchControls).display : 'none'
    };
  });
  console.log('UI Audit:', JSON.stringify(uiAudit, null, 2));

  // 7. Check for audio errors or user interaction audio policy
  const audioAudit = await page.evaluate(() => {
    return {
      hasAudioContext: !!window.AudioContext || !!window.webkitAudioContext
    };
  });
  console.log('Audio Audit:', audioAudit);

  await page.screenshot({ path: 'outputs/chrome-audit-07-final.png' });

  await browser.close();

  const report = {
    consoleMessages,
    pageErrors,
    requestFailures,
    perfMetrics,
    uiAudit,
    debugState
  };

  fs.writeFileSync('outputs/chrome-audit-report.json', JSON.stringify(report, null, 2));
  console.log('=== CHROME AUDIT FINISHED SUCCESSFULLY ===');
}

auditInChrome().catch(err => {
  console.error('Chrome Audit Error:', err);
  process.exit(1);
});
