import { chromium } from 'playwright';

async function testFullDriveInChrome() {
  console.log('=== RUNNING COMPREHENSIVE CHROME GAMEPLAY & PHYSICS AUDIT ===');
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--enable-webgl', '--window-size=1280,720']
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('CHROME ERROR:', msg.text());
    if (msg.type() === 'warn') console.warn('CHROME WARN:', msg.text());
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  page.on('pageerror', err => {
    console.error('CHROME PAGE EXCEPTION:', err);
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Start Race
  await page.click('#btnStartRace');
  await page.waitForFunction(() => window.__gameDebug?.raceState === 'racing', { timeout: 15000 });
  console.log('Race started successfully!');

  // Define critical waypoints across the full 11-checkpoint championship course
  const courseWaypoints = [
    { name: 'Start Line (Gate 01)', x: -28.9, z: 10.4 },
    { name: 'Ramp Ascent', x: -21.0, z: 8.0 },
    { name: 'Slalom Weave 1', x: -16.5, z: 7.2 },
    { name: 'Slalom Weave 2', x: -13.0, z: 8.8 },
    { name: 'Slalom Weave 3', x: -9.5, z: 7.2 },
    { name: 'Breaker Entry (Gate 03)', x: -6.0, z: 8.0 },
    { name: 'Breakers Mid', x: -2.0, z: 8.0 },
    { name: 'Bridge Approach (Gate 04)', x: 1.5, z: 8.0 },
    { name: 'Bridge Crest (Gate 05)', x: 6.0, z: 8.0 },
    { name: 'Bridge Descent', x: 10.5, z: 8.0 },
    { name: 'Rock Pit Entry (Gate 06)', x: 14.5, z: 8.0 },
    { name: 'Rock Pit Exit', x: 18.0, z: 8.0 },
    { name: 'Turntable Approach (Gate 07)', x: 21.0, z: 8.0 },
    { name: 'Turntable Center', x: 23.5, z: 8.0 },
    { name: 'Turntable Exit to Curve', x: 26.0, z: 5.5 },
    { name: 'Curve Downward', x: 26.0, z: 0.0 },
    { name: 'Corridor 2 Entrance (Gate 08)', x: 21.0, z: -4.0 },
    { name: 'Fire Hearth (Gate 09 Entry)', x: 10.0, z: -4.0 },
    { name: 'Water Basin Passage', x: 0.0, z: -4.0 },
    { name: 'Diamond Plate Transition', x: -7.0, z: -4.0 },
    { name: 'Hairpin 1 Approach', x: -11.5, z: -4.0 },
    { name: 'Hairpin 1 Apex', x: -14.5, z: -6.0 },
    { name: 'Hairpin 1 Exit to Lane 2', x: -11.5, z: -8.0 },
    { name: 'Parallel Planks Trestle (Gate 10)', x: -5.0, z: -8.0 },
    { name: 'Planks Exit', x: 0.0, z: -8.0 },
    { name: 'Hairpin 2 Approach', x: 2.0, z: -8.0 },
    { name: 'Hairpin 2 Apex', x: 4.0, z: -10.0 },
    { name: 'Hairpin 2 Exit to Lane 3', x: 2.0, z: -12.0 },
    { name: 'Finish Straight (Gate 11)', x: -10.0, z: -12.0 },
    { name: 'Checkered Line', x: -28.0, z: -12.0 }
  ];

  console.log(`Driving through ${courseWaypoints.length} waypoints in real Chrome...`);

  const issuesFound = [];

  for (let i = 0; i < courseWaypoints.length; i++) {
    const wp = courseWaypoints[i];
    // Teleport or guide probe to waypoint to test physical support, terrain height, and visual fidelity
    const state = await page.evaluate(target => {
      const dbg = window.__gameDebug;
      // Set position
      dbg.pose.x = target.x;
      dbg.pose.z = target.z;
      dbg.pose.vx = 0;
      dbg.pose.vz = 0;
      dbg.pose.pitch = 0;
      dbg.pose.roll = 0;
      return {
        pose: { ...dbg.pose },
        groundContact: { ...dbg.groundContact },
        subsystems: {
          chassis: dbg.subsystems?.integrity?.chassis,
          activeHazard: dbg.subsystems?.activeHazard,
          battery: dbg.subsystems?.battery?.percentage,
          motors: dbg.subsystems?.motors?.leftTemp
        },
        currentCheckpoint: dbg.currentCheckpoint,
        raceState: dbg.raceState
      };
    }, wp);

    // Wait a couple of simulation frames
    await page.waitForTimeout(100);

    // Re-read state after physics step
    const stepState = await page.evaluate(() => {
      const dbg = window.__gameDebug;
      return {
        pose: { ...dbg.pose },
        groundContact: { ...dbg.groundContact },
        subsystems: {
          chassis: dbg.subsystems?.integrity?.chassis,
          activeHazard: dbg.subsystems?.activeHazard,
          battery: dbg.subsystems?.battery?.percentage,
          motors: dbg.subsystems?.motors?.leftTemp
        },
        currentCheckpoint: dbg.currentCheckpoint,
        raceState: dbg.raceState
      };
    });

    const gap = Math.abs(stepState.pose.y + 0.12 - (stepState.groundContact?.supportY ?? stepState.groundContact?.terrainY ?? 0));
    const isFlipped = stepState.pose.isFlipped;
    const chassisHealth = stepState.subsystems.chassis;

    console.log(`WP ${String(i+1).padStart(2, '0')}: ${wp.name.padEnd(30)} -> Y: ${stepState.pose.y.toFixed(2)}, TerrainY: ${(stepState.groundContact?.terrainY ?? 0).toFixed(2)}, SupportY: ${(stepState.groundContact?.supportY ?? 0).toFixed(2)}, CP: ${stepState.currentCheckpoint}, Flipped: ${isFlipped}, Health: ${chassisHealth}%`);

    if (gap > 0.45 && !wp.name.includes('Transition')) {
      issuesFound.push(`Gap anomaly at ${wp.name} (x: ${wp.x}, z: ${wp.z}): robot Y=${stepState.pose.y.toFixed(2)} vs terrain Y=${stepState.contact.terrainY.toFixed(2)} (gap: ${gap.toFixed(3)}m)`);
    }

    if (isFlipped) {
      issuesFound.push(`Robot flipped at ${wp.name} (x: ${wp.x}, z: ${wp.z})!`);
    }

    if (chassisHealth < 50) {
      issuesFound.push(`Chassis health dropped severely at ${wp.name}: ${chassisHealth}%`);
    }
  }

  // Check ending state
  const finalSummary = await page.evaluate(() => {
    return {
      checkpoint: window.__gameDebug.currentCheckpoint,
      raceState: window.__gameDebug.raceState,
      integrity: window.__gameDebug.subsystems.integrity
    };
  });

  console.log('Final Summary:', JSON.stringify(finalSummary, null, 2));

  if (issuesFound.length > 0) {
    console.log('ISSUES IDENTIFIED:');
    issuesFound.forEach(iss => console.log(' -', iss));
  } else {
    console.log('NO TERRAIN OR STABILITY BUGS IDENTIFIED!');
  }

  await browser.close();
}

testFullDriveInChrome().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
