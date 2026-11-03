import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const meshes = await page.evaluate(() => {
  const list = [];
  if (window.__threeScene) {
    window.__threeScene.traverse(obj => {
      if (obj.isMesh) {
        const x = obj.position.x;
        const y = obj.position.y;
        const z = obj.position.z;
        if (x >= -4 && x <= 2 && z >= -6 && z <= 2) {
          list.push({
            name: obj.name || 'unnamed',
            pos: [parseFloat(x.toFixed(2)), parseFloat(y.toFixed(2)), parseFloat(z.toFixed(2))],
            geo: obj.geometry.type,
            color: obj.material?.color ? '#' + obj.material.color.getHexString() : (obj.material?.map ? 'textured' : 'none'),
          });
        }
      }
    });
  }
  return list;
});

console.log('Meshes near ramp count:', meshes.length);
console.log('Sample meshes:', JSON.stringify(meshes, null, 2));
await browser.close();
