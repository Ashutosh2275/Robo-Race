import * as THREE from 'three';

type PbrMapSet = {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finalizeTexture(
  cvs: HTMLCanvasElement,
  isColor: boolean,
  repeatX = 4,
  repeatY = 4,
  clamp = false,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates weathered proving-ground asphalt with limestone aggregate grit,
 * faded tire-track wear lanes, hairline cracks, and matched height/roughness maps.
 */
export function createAsphaltPbrMaps(repeat = 4): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  const rgh = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = rgh.width = rgh.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rx = rgh.getContext('2d')!;
  const rnd = mulberry32(104729);

  // Faded weathered slate-charcoal binder base
  cx.fillStyle = '#2d3031';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#7e7e7e';
  bx.fillRect(0, 0, size, size);
  rx.fillStyle = '#dadada'; // ~0.85 base roughness
  rx.fillRect(0, 0, size, size);

  // Subtle soft-feathered dusty aggregate mottling (no hard circular edges)
  for (let i = 0; i < 48; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const rad = 28 + rnd() * 68;
    const g = Math.floor(38 + rnd() * 18);
    const grad = cx.createRadialGradient(px, py, 0, px, py, rad);
    grad.addColorStop(0, `rgba(${g},${g + 1},${g},0.16)`);
    grad.addColorStop(1, `rgba(${g},${g + 1},${g},0)`);
    cx.fillStyle = grad;
    cx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }

  // Fine stone aggregate pebbles & mineral flecks (matched on albedo + bump + roughness)
  for (let i = 0; i < 4200; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const r = 1 + (rnd() > 0.78 ? 1.6 : 0.8);
    const tone = rnd();
    if (tone > 0.68) {
      cx.fillStyle = 'rgba(130, 128, 120, 0.24)';
      bx.fillStyle = 'rgba(225, 225, 225, 0.42)';
      rx.fillStyle = 'rgba(175, 175, 175, 0.25)';
    } else if (tone < 0.28) {
      cx.fillStyle = 'rgba(18, 19, 20, 0.34)';
      bx.fillStyle = 'rgba(45, 45, 45, 0.45)';
      rx.fillStyle = 'rgba(242, 242, 242, 0.30)';
    } else {
      cx.fillStyle = 'rgba(72, 74, 73, 0.24)';
      bx.fillStyle = 'rgba(155, 155, 155, 0.28)';
      rx.fillStyle = 'rgba(215, 215, 215, 0.22)';
    }
    cx.fillRect(px, py, r, r);
    bx.fillRect(px, py, r, r);
    rx.fillRect(px, py, r, r);
  }

  // Subtle twin wheel-wear paths & faint oil polish
  for (const laneY of [135, 345]) {
    const grad = cx.createLinearGradient(0, laneY - 38, 0, laneY + 38);
    grad.addColorStop(0, 'rgba(15,16,17,0)');
    grad.addColorStop(0.5, 'rgba(15,16,17,0.16)');
    grad.addColorStop(1, 'rgba(15,16,17,0)');
    cx.fillStyle = grad;
    cx.fillRect(0, laneY - 38, size, 76);

    rx.fillStyle = 'rgba(165, 165, 165, 0.24)'; // slightly smoother rubber-polished tracks
    rx.fillRect(0, laneY - 22, size, 44);
  }

  // Faint weathered tar cracks
  cx.strokeStyle = 'rgba(16, 17, 18, 0.42)';
  bx.strokeStyle = 'rgba(28, 28, 28, 0.65)';
  cx.lineWidth = 1.4;
  bx.lineWidth = 2.0;
  for (let c = 0; c < 5; c++) {
    let px = rnd() * size;
    let py = rnd() * size;
    cx.beginPath();
    bx.beginPath();
    cx.moveTo(px, py);
    bx.moveTo(px, py);
    for (let s = 0; s < 10; s++) {
      px += (rnd() - 0.3) * 28;
      py += (rnd() - 0.5) * 22;
      cx.lineTo(px, py);
      bx.lineTo(px, py);
    }
    cx.stroke();
    bx.stroke();
  }

  return {
    map: finalizeTexture(col, true, repeat, repeat),
    bumpMap: finalizeTexture(bmp, false, repeat, repeat),
    roughnessMap: finalizeTexture(rgh, false, repeat, repeat),
  };
}

/**
 * Generates weathered industrial concrete slab grid for arena aprons and piers.
 */
export function createConcreteSlabPbrMaps(baseHex = '#202223', repeat = 6): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(49211);

  cx.fillStyle = baseHex;
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#888888';
  bx.fillRect(0, 0, size, size);

  // Soft radial concrete weathering patina (zero sharp discs)
  for (let i = 0; i < 60; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const r = 24 + rnd() * 64;
    const grad = cx.createRadialGradient(px, py, 0, px, py, r);
    const tone = rnd() > 0.5 ? 'rgba(215,212,198,0.035)' : 'rgba(8,9,10,0.09)';
    grad.addColorStop(0, tone);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.fillRect(px - r, py - r, r * 2, r * 2);
  }

  for (let i = 0; i < 2400; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const s = 1 + rnd() * 2;
    const b = rnd() > 0.5;
    cx.fillStyle = b ? 'rgba(155,152,145,0.08)' : 'rgba(12,13,14,0.16)';
    bx.fillStyle = b ? 'rgba(175,175,175,0.22)' : 'rgba(70,70,70,0.24)';
    cx.fillRect(px, py, s, s);
    bx.fillRect(px, py, s, s);
  }

  // Expansion joint grid lines (2x2 concrete slabs per tile)
  for (const pos of [0, 256]) {
    cx.fillStyle = 'rgba(10, 11, 12, 0.52)';
    bx.fillStyle = 'rgba(25, 25, 25, 0.85)';
    cx.fillRect(pos, 0, 3, size);
    cx.fillRect(0, pos, size, 3);
    bx.fillRect(pos, 0, 4, size);
    bx.fillRect(0, pos, size, 4);
  }

  return {
    map: finalizeTexture(col, true, repeat, repeat),
    bumpMap: finalizeTexture(bmp, false, repeat, repeat),
  };
}

/**
 * Generates authentic weathered running-bond kiln brick masonry with recessed mortar joints.
 */
export function createBrickMasonryPbrMaps(): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  const rgh = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = rgh.width = rgh.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rx = rgh.getContext('2d')!;
  const rnd = mulberry32(83491);

  // Recessed dusty mortar bed
  cx.fillStyle = '#403d37';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#363636';
  bx.fillRect(0, 0, size, size);
  rx.fillStyle = '#f5f5f5';
  rx.fillRect(0, 0, size, size);

  const brickColors = ['#7c5848', '#6f4e40', '#856251', '#65483c', '#775647', '#806455'];
  const rows = 8;
  const cols = 4;
  const rowH = size / rows;
  const brickW = size / cols;
  const mortar = 5;

  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 1 ? brickW * 0.5 : 0;
    for (let colIdx = -1; colIdx <= cols; colIdx++) {
      const bx0 = colIdx * brickW + offset + mortar * 0.5;
      const by0 = row * rowH + mortar * 0.5;
      const bw = brickW - mortar;
      const bh = rowH - mortar;

      const base = brickColors[Math.floor(rnd() * brickColors.length)];
      cx.fillStyle = base;
      cx.fillRect(bx0, by0, bw, bh);

      const hShade = 175 + Math.floor(rnd() * 35);
      bx.fillStyle = `rgb(${hShade},${hShade},${hShade})`;
      bx.fillRect(bx0 + 2, by0 + 2, bw - 4, bh - 4);
      rx.fillStyle = '#d4d4d4';
      rx.fillRect(bx0, by0, bw, bh);

      // Aged ceramic pitting, soot smudges & faded efflorescence
      for (let p = 0; p < 28; p++) {
        const px = bx0 + rnd() * bw;
        const py = by0 + rnd() * bh;
        const pw = 2 + rnd() * 8;
        const ph = 2 + rnd() * 5;
        const kind = rnd();
        cx.fillStyle = kind > 0.65
          ? 'rgba(182, 174, 158, 0.14)'
          : 'rgba(24, 18, 15, 0.18)';
        bx.fillStyle = kind > 0.5 ? 'rgba(220,220,220,0.22)' : 'rgba(90,90,90,0.30)';
        cx.fillRect(px, py, pw, ph);
        bx.fillRect(px, py, pw, ph);
      }

      // Subtle bevel highlight/shadow at brick edges
      cx.fillStyle = 'rgba(255, 240, 220, 0.07)';
      cx.fillRect(bx0, by0, bw, 3);
      cx.fillStyle = 'rgba(16, 12, 10, 0.25)';
      cx.fillRect(bx0, by0 + bh - 4, bw, 4);
    }
  }

  // Weathering rain-drip soot gradient from upper coping down onto brick wall
  const soot = cx.createLinearGradient(0, 0, 0, size);
  soot.addColorStop(0, 'rgba(18, 17, 16, 0.34)');
  soot.addColorStop(0.28, 'rgba(18, 17, 16, 0.06)');
  soot.addColorStop(0.75, 'rgba(18, 17, 16, 0.04)');
  soot.addColorStop(1, 'rgba(22, 20, 17, 0.28)');
  cx.fillStyle = soot;
  cx.fillRect(0, 0, size, size);

  return {
    map: finalizeTexture(col, true, 2, 1.5),
    bumpMap: finalizeTexture(bmp, false, 2, 1.5),
    roughnessMap: finalizeTexture(rgh, false, 2, 1.5),
  };
}

/**
 * Generates weathered bridge cedar/oak planks with iron end straps and bolt studs.
 */
export function createWeatheredWoodPbrMaps(): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(27743);

  cx.fillStyle = '#5c4b3b';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#848484';
  bx.fillRect(0, 0, size, size);

  // Longitudinal wood fiber streaks across plank width
  for (let i = 0; i < 420; i++) {
    const x = rnd() * size;
    const w = 1 + rnd() * 3.5;
    const dark = rnd() > 0.42;
    cx.fillStyle = dark ? 'rgba(38, 29, 21, 0.24)' : 'rgba(138, 118, 96, 0.16)';
    bx.fillStyle = dark ? 'rgba(65, 65, 65, 0.30)' : 'rgba(195, 195, 195, 0.22)';
    cx.fillRect(x, 0, w, size);
    bx.fillRect(x, 0, w, size);
  }

  // Plank board splits & darkened water weathering
  for (const seam of [128, 256, 384]) {
    cx.fillStyle = 'rgba(24, 18, 14, 0.55)';
    bx.fillStyle = 'rgba(25, 25, 25, 0.85)';
    cx.fillRect(0, seam - 2, size, 3);
    bx.fillRect(0, seam - 2, size, 4);
  }

  // Rusted hex bolt stud impressions near plank end rails
  for (const bxPos of [42, size - 42]) {
    for (const byPos of [72, 256, 440]) {
      cx.fillStyle = '#332e2a';
      cx.beginPath();
      cx.arc(bxPos, byPos, 10, 0, Math.PI * 2);
      cx.fill();
      bx.fillStyle = '#dedede';
      bx.beginPath();
      bx.arc(bxPos, byPos, 10, 0, Math.PI * 2);
      bx.fill();
    }
  }

  return {
    map: finalizeTexture(col, true, 1, 1),
    bumpMap: finalizeTexture(bmp, false, 1, 1),
  };
}

/**
 * Generates stamped weathered steel diamond tread plate with specular lug bump.
 */
export function createDiamondPlatePbrMaps(baseHex = '#43494d'): PbrMapSet {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  const rgh = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = rgh.width = rgh.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rx = rgh.getContext('2d')!;
  const rnd = mulberry32(55103);

  cx.fillStyle = baseHex;
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#686868';
  bx.fillRect(0, 0, size, size);
  rx.fillStyle = '#a8a8a8';
  rx.fillRect(0, 0, size, size);

  // Grime & brushed oil patina
  for (let i = 0; i < 320; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    cx.fillStyle = rnd() > 0.5 ? 'rgba(20, 22, 24, 0.14)' : 'rgba(130, 138, 142, 0.08)';
    cx.fillRect(px, py, 2 + rnd() * 14, 2);
  }

  // Raised alternating diamond tread lugs
  const step = 32;
  for (let gy = 8; gy < size; gy += step) {
    for (let gx = 8; gx < size; gx += step) {
      const alt = ((gx + gy) / step) % 2 === 0;
      cx.save();
      bx.save();
      rx.save();
      cx.translate(gx, gy);
      bx.translate(gx, gy);
      rx.translate(gx, gy);
      const ang = alt ? Math.PI * 0.25 : -Math.PI * 0.25;
      cx.rotate(ang);
      bx.rotate(ang);
      rx.rotate(ang);

      cx.fillStyle = 'rgba(155, 162, 166, 0.34)';
      cx.fillRect(-7, -2.2, 14, 4.4);
      bx.fillStyle = '#efefef';
      bx.fillRect(-7, -2.2, 14, 4.4);
      rx.fillStyle = '#626262'; // polished lug crowns
      rx.fillRect(-7, -2.2, 14, 4.4);

      cx.restore();
      bx.restore();
      rx.restore();
    }
  }

  return {
    map: finalizeTexture(col, true, 5, 5),
    bumpMap: finalizeTexture(bmp, false, 5, 5),
    roughnessMap: finalizeTexture(rgh, false, 5, 5),
  };
}

/**
 * Generates weathered industrial paint with brushed scratches & edge wear (never neon plastic).
 */
export function createFadedPaintPbrMaps(
  baseHex: string,
  scratchHex = '#484d50',
  repeat = 2,
): PbrMapSet {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(baseHex.charCodeAt(1) * 9973 + repeat * 31);

  cx.fillStyle = baseHex;
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#888888';
  bx.fillRect(0, 0, size, size);

  // Soft bleached patina & oil grime washes (no hard disc boundaries)
  for (let i = 0; i < 36; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const r = 18 + rnd() * 42;
    const grad = cx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, rnd() > 0.5 ? 'rgba(245, 240, 225, 0.055)' : 'rgba(22, 20, 17, 0.09)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.fillRect(px - r, py - r, r * 2, r * 2);
  }

  // Scratched paint flecks revealing primer/steel underneath
  for (let i = 0; i < 180; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const len = 3 + rnd() * 14;
    cx.strokeStyle = scratchHex;
    cx.globalAlpha = 0.16 + rnd() * 0.22;
    cx.lineWidth = 1 + rnd() * 1.4;
    cx.beginPath();
    cx.moveTo(px, py);
    cx.lineTo(px + (rnd() - 0.5) * len, py + (rnd() - 0.5) * len);
    cx.stroke();

    bx.strokeStyle = 'rgba(45,45,45,0.4)';
    bx.lineWidth = 1.5;
    bx.beginPath();
    bx.moveTo(px, py);
    bx.lineTo(px + (rnd() - 0.5) * len, py + (rnd() - 0.5) * len);
    bx.stroke();
  }
  cx.globalAlpha = 1;

  return {
    map: finalizeTexture(col, true, repeat, repeat),
    bumpMap: finalizeTexture(bmp, false, repeat, repeat),
  };
}

/**
 * Generates weathered military-industrial ochre armor plating for the vintage UGV rover.
 */
export function createRoverArmorPbrMaps(): PbrMapSet {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  const rgh = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = rgh.width = rgh.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rx = rgh.getContext('2d')!;
  const rnd = mulberry32(1986);

  // Seamless muted olive-ochre military armor coat (scales cleanly on all box aspect ratios)
  cx.fillStyle = '#8b7744';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#828282';
  bx.fillRect(0, 0, size, size);
  rx.fillStyle = '#cfcfcf';
  rx.fillRect(0, 0, size, size);

  // Feathered grime & sun-faded weathering washes
  for (let i = 0; i < 42; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const rad = 20 + rnd() * 48;
    const grad = cx.createRadialGradient(px, py, 0, px, py, rad);
    grad.addColorStop(0, rnd() > 0.45 ? 'rgba(28, 25, 20, 0.14)' : 'rgba(210, 198, 162, 0.07)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }

  // Fine brushed steel grain & minor surface scuffs (seamless micro-detail)
  for (let i = 0; i < 680; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const len = 2 + rnd() * 10;
    const isChip = rnd() > 0.86;
    cx.fillStyle = isChip ? 'rgba(54, 58, 61, 0.36)' : 'rgba(22, 20, 16, 0.12)';
    cx.fillRect(px, py, len, 1.2);
    bx.fillStyle = isChip ? 'rgba(48, 48, 48, 0.48)' : 'rgba(148, 148, 148, 0.18)';
    bx.fillRect(px, py, len, 1.2);
    if (isChip) {
      rx.fillStyle = '#707070';
      rx.fillRect(px, py, len, 1.5);
    }
  }

  return {
    map: finalizeTexture(col, true, 1, 1),
    bumpMap: finalizeTexture(bmp, false, 1, 1),
    roughnessMap: finalizeTexture(rgh, false, 1, 1),
  };
}

/**
 * Generates weathered mineral/rock stone textures with rough crystalline relief bump.
 */
export function createMineralPbrMaps(baseHex: string, speckColors: string[], repeat = 2): PbrMapSet {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(baseHex.charCodeAt(1) * 1291 + speckColors.length * 97);

  cx.fillStyle = baseHex;
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#808080';
  bx.fillRect(0, 0, size, size);

  for (let i = 0; i < 650; i++) {
    const px = rnd() * size;
    const py = rnd() * size;
    const r = 1.5 + rnd() * 5.5;
    cx.fillStyle = speckColors[i % speckColors.length];
    cx.globalAlpha = 0.25 + rnd() * 0.35;
    bx.fillStyle = i % 2 === 0 ? 'rgba(215,215,215,0.40)' : 'rgba(40,40,40,0.40)';
    cx.beginPath();
    cx.ellipse(px, py, r, r * (0.5 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2);
    cx.fill();
    bx.beginPath();
    bx.arc(px, py, r * 0.9, 0, Math.PI * 2);
    bx.fill();
  }
  cx.globalAlpha = 1;

  return {
    map: finalizeTexture(col, true, repeat, repeat),
    bumpMap: finalizeTexture(bmp, false, repeat, repeat),
  };
}

/**
 * Generates weathered rubber chevron track belt texture + deep tread lug bump map.
 */
export function createRubberTrackPbrMaps(): PbrMapSet {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;

  cx.fillStyle = '#171918';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#505050';
  bx.fillRect(0, 0, size, size);

  cx.strokeStyle = '#292c2a';
  cx.lineWidth = 8;
  cx.lineCap = 'round';
  bx.strokeStyle = '#e5e5e5';
  bx.lineWidth = 9;
  bx.lineCap = 'round';
  for (let y = 12; y < size; y += 26) {
    cx.beginPath();
    cx.moveTo(28, y);
    cx.lineTo(128, y + 14);
    cx.lineTo(228, y);
    cx.stroke();

    bx.beginPath();
    bx.moveTo(28, y);
    bx.lineTo(128, y + 14);
    bx.lineTo(228, y);
    bx.stroke();
  }

  return {
    map: finalizeTexture(col, true, 4, 4),
    bumpMap: finalizeTexture(bmp, false, 4, 4),
  };
}

/**
 * Generates weathered high-angle proving ramp deck with faded amber zigzag chevrons.
 */
export function createHighClimbPbrMaps(): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(9910);

  cx.fillStyle = '#262a2d';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#787878';
  bx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 24) {
    cx.fillStyle = y % 48 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.08)';
    cx.fillRect(0, y, size, 12);
    bx.fillStyle = y % 48 === 0 ? '#969696' : '#585858';
    bx.fillRect(0, y, size, 8);
  }
  for (let i = 0; i < 650; i++) {
    cx.fillStyle = rnd() > 0.5 ? 'rgba(130, 128, 120, 0.14)' : 'rgba(12, 14, 15, 0.24)';
    cx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }

  // Faded painted ochre zigzag climbing line
  cx.strokeStyle = 'rgba(176, 138, 60, 0.56)';
  cx.lineWidth = 10;
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
  cx.setLineDash([22, 18]);
  cx.beginPath();
  cx.moveTo(40, 256);
  cx.lineTo(155, 110);
  cx.lineTo(285, 402);
  cx.lineTo(410, 110);
  cx.lineTo(485, 256);
  cx.stroke();
  cx.setLineDash([]);

  return {
    map: finalizeTexture(col, true, 1, 1, true),
    bumpMap: finalizeTexture(bmp, false, 1, 1, true),
  };
}

/**
 * Generates weathered submerged proving-tank concrete tile maps with muted grout seams,
 * fine limestone aggregate, and damp mineral staining.
 */
export function createWaterBasinConcretePbrMaps(repeatX = 4, repeatY = 2): PbrMapSet {
  const size = 512;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const rnd = mulberry32(8123);

  cx.fillStyle = '#525c5d';
  cx.fillRect(0, 0, size, size);
  bx.fillStyle = '#828282';
  bx.fillRect(0, 0, size, size);

  // Subtle tile block tonal variation (industrial precast basin panels)
  const cols = 4;
  const rows = 4;
  const cw = size / cols;
  const ch = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const shade = Math.round((rnd() - 0.5) * 14);
      cx.fillStyle = `rgb(${80 + shade}, ${91 + shade}, ${92 + shade})`;
      cx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
      const bShade = 128 + shade * 2;
      bx.fillStyle = `rgb(${bShade}, ${bShade}, ${bShade})`;
      bx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
    }
  }

  // Fine mineral silt & patina flecks
  for (let i = 0; i < 2400; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const s = 1 + rnd() * 2.5;
    cx.fillStyle = rnd() > 0.45 ? 'rgba(34, 46, 44, 0.16)' : 'rgba(138, 146, 142, 0.11)';
    cx.fillRect(x, y, s, s);
    bx.fillStyle = rnd() > 0.5 ? 'rgba(65, 65, 65, 0.25)' : 'rgba(170, 170, 170, 0.2)';
    bx.fillRect(x, y, s, s);
  }

  // Recessed expansion grout seams & subtle mineral rim darkening
  cx.strokeStyle = 'rgba(26, 33, 33, 0.72)';
  cx.lineWidth = 4;
  bx.strokeStyle = '#383838';
  bx.lineWidth = 5;
  for (let g = 0; g <= cols; g++) {
    const pos = g * cw;
    cx.beginPath(); cx.moveTo(pos, 0); cx.lineTo(pos, size); cx.stroke();
    cx.beginPath(); cx.moveTo(0, pos); cx.lineTo(size, pos); cx.stroke();
    bx.beginPath(); bx.moveTo(pos, 0); bx.lineTo(pos, size); bx.stroke();
    bx.beginPath(); bx.moveTo(0, pos); bx.lineTo(size, pos); bx.stroke();
  }

  // Faint waterline algae / lime patches along seams
  for (let i = 0; i < 14; i++) {
    const gx = rnd() * size;
    const gy = rnd() * size;
    const rad = 28 + rnd() * 54;
    const grad = cx.createRadialGradient(gx, gy, 2, gx, gy, rad);
    grad.addColorStop(0, 'rgba(38, 55, 48, 0.22)');
    grad.addColorStop(1, 'rgba(38, 55, 48, 0)');
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(gx, gy, rad, 0, Math.PI * 2);
    cx.fill();
  }

  return {
    map: finalizeTexture(col, true, repeatX, repeatY),
    bumpMap: finalizeTexture(bmp, false, repeatX, repeatY),
  };
}

/**
 * Generates seamless animated water surface ripple bump map, muted mineral water albedo,
 * and subtle floor caustic lattice texture.
 */
export function createWaterSurfaceMaps(): PbrMapSet & { causticMap: THREE.CanvasTexture; wakeFoamMap: THREE.CanvasTexture } {
  const size = 256;
  const col = document.createElement('canvas');
  const bmp = document.createElement('canvas');
  const cst = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = cst.width = cst.height = size;
  const cx = col.getContext('2d')!;
  const bx = bmp.getContext('2d')!;
  const kx = cst.getContext('2d')!;

  const bImg = bx.createImageData(size, size);
  const cImg = cx.createImageData(size, size);
  const kImg = kx.createImageData(size, size);
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const w1 = Math.sin(tau * (u * 3 + v * 2)) * 0.45;
      const w2 = Math.cos(tau * (u * 5 - v * 4 + 0.3)) * 0.30;
      const w3 = Math.sin(tau * (u * 8 + v * 7 + 0.6)) * 0.16;
      const w4 = Math.cos(tau * (u * 13 - v * 11)) * 0.09;
      const h = w1 + w2 + w3 + w4; // [-1..+1]

      const idx = (y * size + x) * 4;
      const bmpVal = Math.max(0, Math.min(255, Math.round(128 + h * 112)));
      bImg.data[idx] = bmpVal;
      bImg.data[idx + 1] = bmpVal;
      bImg.data[idx + 2] = bmpVal;
      bImg.data[idx + 3] = 255;

      // Muted vintage industrial mineral slate-teal water tone
      const tone = h * 10;
      cImg.data[idx] = Math.max(12, Math.min(80, Math.round(25 + tone * 0.8)));
      cImg.data[idx + 1] = Math.max(32, Math.min(110, Math.round(62 + tone * 1.1)));
      cImg.data[idx + 2] = Math.max(36, Math.min(120, Math.round(69 + tone * 1.1)));
      cImg.data[idx + 3] = 255;

      // Caustic filament intensity concentrated along wave focus ridges
      const focus = Math.pow(Math.max(0, 1 - Math.abs(w1 + w2) * 2.8), 2.4);
      const kv = Math.max(0, Math.min(255, Math.round(focus * 195)));
      kImg.data[idx] = Math.round(kv * 0.58);
      kImg.data[idx + 1] = Math.round(kv * 0.88);
      kImg.data[idx + 2] = kv;
      kImg.data[idx + 3] = Math.round(focus * 180);
    }
  }

  bx.putImageData(bImg, 0, 0);
  cx.putImageData(cImg, 0, 0);
  kx.putImageData(kImg, 0, 0);

  // Feathered organic frothy wake bubble texture for moving tracks in water
  const wakeCvs = document.createElement('canvas');
  wakeCvs.width = wakeCvs.height = 128;
  const wx = wakeCvs.getContext('2d')!;
  const wImg = wx.createImageData(128, 128);
  const wRnd = mulberry32(4421);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const nx = (x - 64) / 64;
      const ny = (y - 64) / 64;
      const r = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const ringProfile = Math.exp(-Math.pow((r - 0.64) / 0.18, 2));
      const breakup = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ang * 7 + r * 9) * (0.5 + wRnd() * 0.5));
      const alpha = r > 0.96 ? 0 : Math.max(0, Math.min(1, ringProfile * breakup));
      const wi = (y * 128 + x) * 4;
      wImg.data[wi] = 198;
      wImg.data[wi + 1] = 222;
      wImg.data[wi + 2] = 226;
      wImg.data[wi + 3] = Math.round(alpha * 255);
    }
  }
  wx.putImageData(wImg, 0, 0);

  return {
    map: finalizeTexture(col, true, 5, 3),
    bumpMap: finalizeTexture(bmp, false, 5, 3),
    causticMap: finalizeTexture(cst, true, 4, 2),
    wakeFoamMap: finalizeTexture(wakeCvs, true, 1, 1, true),
  };
}
