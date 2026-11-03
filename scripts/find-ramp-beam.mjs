import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const found = await page.evaluate(() => {
  const res = [];
  window.__course.traverse(obj => {
    if (obj.isMesh && obj.geometry) {
      obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox.clone();
      // transform by object matrix
      bb.applyMatrix4(obj.matrixWorld);
      // check if intersects x in [-3, 1], z in [-4, 0]
      if (bb.min.x <= 1 && bb.max.x >= -3 && bb.min.z <= 0 && bb.max.z >= -4) {
        res.push({
          id: obj.id,
          name: obj.name,
          pos: [obj.position.x, obj.position.y, obj.position.z],
          geo: obj.geometry.type,
          bb: {
            min: [bb.min.x.toFixed(2), bb.min.y.toFixed(2), bb.min.z.toFixed(2)],
            max: [bb.max.x.toFixed(2), bb.max.y.toFixed(2), bb.max.z.toFixed(2)]
          },
          matColor: obj.material?.color ? '#' + obj.material.color.getHexString() : 'none'
        });
      }
    }
  });
  return res;
});

console.log('Meshes found:', JSON.stringify(found, null, 2));
await browser.close();
