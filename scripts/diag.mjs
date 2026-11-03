import { chromium } from 'playwright';
import { createServer } from 'vite';

async function test() {
  const server = await createServer({ server: { port: 5180 } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG [' + msg.type() + ']:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message, err.stack));
  await page.goto('http://localhost:5180/');
  await page.waitForTimeout(1000);
  const startBtn = await page.$('#btnStartRace');
  console.log('StartBtn exists:', !!startBtn);
  if (startBtn) {
    await startBtn.click();
    console.log('Clicked startBtn');
    await page.waitForTimeout(2500);
    const dbg = await page.evaluate(() => window.__gameDebug);
    console.log('DBG state after click:', dbg?.raceState, 'countdown:', dbg?.countdown);
  }
  await browser.close();
  await server.close();
}

test().catch(console.error);
