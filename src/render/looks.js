import * as THREE from 'three';

// Experimental colour styles, picked with ?look=classic|a|b|c in the URL.
//   classic: the original EGA look
//   a: a hand-picked 34-colour palette (Endesga 32 plus a teal and a periwinkle)
//   b: EGA colours with hue-shifted shading (cool purple shadows, warm highlights)
//   c: full colour, warm/cool lighting, smooth sky, light colour grade
const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('look') : null;
export const LOOK = ['a', 'b', 'c'].includes(param) ? param : 'classic';

const hex = (s) => parseInt(s.replace('#', ''), 16);

export const PALETTE_A = [
  '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
  '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
  '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
  '#5b6ee1', '#2a9d8f',
].map(hex);

// EGA colour -> nearest-in-spirit palette colour.
const EGA_TO_A = {
  0x000000: '#181425', 0x0000aa: '#124e89', 0x00aa00: '#3e8948', 0x00aaaa: '#2a9d8f',
  0xaa0000: '#a22633', 0xaa00aa: '#68386c', 0xaa5500: '#b86f50', 0xaaaaaa: '#c0cbdc',
  0x555555: '#5a6988', 0x5555ff: '#5b6ee1', 0x55ff55: '#63c74d', 0x55ffff: '#2ce8f5',
  0xff5555: '#e43b44', 0xff55ff: '#b55088', 0xffff55: '#fee761', 0xffffff: '#ffffff',
};

function nearest(color, pal) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  let best = pal[0], bd = Infinity;
  for (const p of pal) {
    const d = (r - ((p >> 16) & 255)) ** 2 + (g - ((p >> 8) & 255)) ** 2 + (b - (p & 255)) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function remapColor(color) {
  if (LOOK !== 'a' && LOOK !== 'c') return color;
  if (typeof color !== 'number') return color;
  return EGA_TO_A[color] ? hex(EGA_TO_A[color]) : nearest(color, PALETTE_A);
}

export function remapCss(css) {
  if (LOOK !== 'a' && LOOK !== 'c') return css;
  const s = css.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return '#' + remapColor(parseInt(full, 16)).toString(16).padStart(6, '0');
}

// Toon lighting ramp, dark to light. Coloured steps give hue-shifted shading.
const RAMPS = {
  classic: [[90, 90, 90], [175, 175, 175], [255, 255, 255]],
  a: [[90, 90, 90], [175, 175, 175], [255, 255, 255]],
  b: [[60, 46, 130], [196, 172, 204], [255, 240, 200]],
  c: [[86, 80, 140], [155, 150, 185], [222, 216, 220], [255, 247, 230]],
};

export function makeRamp() {
  const steps = RAMPS[LOOK];
  const data = new Uint8Array(steps.flatMap((c) => [...c, 255]));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const SKY = {
  classic: { bands: ['#0000aa', '#0000aa', '#5555ff', '#5555ff', '#55ffff', '#55ffff', '#ffffff'], fog: 0x55ffff },
  a: { bands: ['#124e89', '#124e89', '#0099db', '#0099db', '#2ce8f5', '#2ce8f5', '#c0cbdc'], fog: 0x2ce8f5 },
  b: { bands: ['#0000aa', '#0000aa', '#5555ff', '#5555ff', '#55ffff', '#55ffff', '#ffffff'], fog: 0x55ffff },
  c: { gradient: [[0, '#2f5fb8'], [0.55, '#7fb6ea'], [0.85, '#cfe6f2'], [1, '#ffe7c4']], fog: 0xcfe6f2 },
}[LOOK];

export const LIGHTS = {
  classic: { sky: 0xffffff, ground: 0x555555, hemi: 1.6, sun: 0xffffff, sunI: 2.2 },
  a: { sky: 0xffffff, ground: 0x555555, hemi: 1.6, sun: 0xffffff, sunI: 2.2 },
  b: { sky: 0x9a8ee0, ground: 0x4a3470, hemi: 1.5, sun: 0xffe6b8, sunI: 3.0 },
  c: { sky: 0xb4c4f4, ground: 0x6a5577, hemi: 1.6, sun: 0xfff0d4, sunI: 2.6 },
}[LOOK];

export const LOOK_ID = { classic: 0, a: 1, b: 2, c: 3 }[LOOK];
