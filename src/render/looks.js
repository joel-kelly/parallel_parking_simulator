import * as THREE from 'three';

// Two colour styles, switched live with the P key:
//   modern:  a hand-picked palette, warm sun / cool shadows, smooth sky, light colour grade
//   classic: the original 16-colour EGA look with ordered dithering
// Everything in the game is authored in EGA colours; the modern look remaps them.
let current = 'modern';
const listeners = [];

export const getLook = () => current;
export function setLook(look) {
  current = look === 'classic' ? 'classic' : 'modern';
  for (const fn of listeners) fn(current);
}
export const onLookChange = (fn) => listeners.push(fn);

const hex = (s) => parseInt(s.replace('#', ''), 16);

// Endesga 32 plus a teal and a periwinkle.
const PALETTE = [
  '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
  '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
  '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
  '#5b6ee1', '#2a9d8f',
].map(hex);

// Each EGA colour's modern counterpart. Also used for the CSS variables in style.css.
const EGA_TO_MODERN = {
  0x000000: '#181425', 0x0000aa: '#124e89', 0x00aa00: '#3e8948', 0x00aaaa: '#2a9d8f',
  0xaa0000: '#a22633', 0xaa00aa: '#68386c', 0xaa5500: '#b86f50', 0xaaaaaa: '#c0cbdc',
  0x555555: '#5a6988', 0x5555ff: '#5b6ee1', 0x55ff55: '#63c74d', 0x55ffff: '#2ce8f5',
  0xff5555: '#e43b44', 0xff55ff: '#b55088', 0xffff55: '#fee761', 0xffffff: '#ffffff',
};

function nearest(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  let best = PALETTE[0], bd = Infinity;
  for (const p of PALETTE) {
    const d = (r - ((p >> 16) & 255)) ** 2 + (g - ((p >> 8) & 255)) ** 2 + (b - (p & 255)) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Authored (EGA-ish) colour -> colour for the current look.
export function remapColor(color) {
  if (current === 'classic' || typeof color !== 'number') return color;
  return EGA_TO_MODERN[color] ? hex(EGA_TO_MODERN[color]) : nearest(color);
}

export function remapCss(css) {
  if (current === 'classic' || !css || css[0] !== '#') return css;
  const s = css.slice(1);
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return '#' + remapColor(parseInt(full, 16)).toString(16).padStart(6, '0');
}

export const cssHex = (c) => `#${remapColor(c).toString(16).padStart(6, '0')}`;

// Toon lighting ramps, dark to light. The modern one shifts hue: purple shadows, warm highlights.
function rampTexture(steps) {
  const data = new Uint8Array(steps.flatMap((c) => [...c, 255]));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const RAMPS = {
  classic: rampTexture([[90, 90, 90], [175, 175, 175], [255, 255, 255]]),
  modern: rampTexture([[86, 80, 140], [155, 150, 185], [222, 216, 220], [255, 247, 230]]),
};
export const ramp = () => RAMPS[current];

const STYLE = {
  classic: {
    sky: { bands: ['#0000aa', '#0000aa', '#5555ff', '#5555ff', '#55ffff', '#55ffff', '#ffffff'] },
    fog: 0x55ffff,
    hemiSky: 0xffffff, hemiGround: 0x555555, hemi: 1.6, sun: 0xffffff, sunI: 2.2,
  },
  modern: {
    sky: { gradient: [[0, '#2f5fb8'], [0.55, '#7fb6ea'], [0.85, '#cfe6f2'], [1, '#ffe7c4']] },
    fog: 0xcfe6f2,
    hemiSky: 0xb4c4f4, hemiGround: 0x6a5577, hemi: 1.6, sun: 0xfff0d4, sunI: 2.6,
  },
};
export const style = () => STYLE[current];

const skyCache = {};
export function skyTexture() {
  if (skyCache[current]) return skyCache[current];
  const sky = STYLE[current].sky;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  if (sky.gradient) {
    const lg = g.createLinearGradient(0, 0, 0, 256);
    for (const [t, col] of sky.gradient) lg.addColorStop(t, col);
    g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
  } else {
    sky.bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i / sky.bands.length) * 256, 4, 256 / sky.bands.length + 1); });
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = sky.gradient ? THREE.LinearFilter : THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return (skyCache[current] = t);
}

// Swap the page's CSS colour variables to match.
function applyCss() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const names = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'lgray',
    'dgray', 'lblue', 'lgreen', 'lcyan', 'lred', 'lmagenta', 'yellow', 'white'];
  const ega = [0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
    0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff];
  names.forEach((n, i) => {
    if (current === 'classic') root.style.removeProperty(`--${n}`);
    else root.style.setProperty(`--${n}`, cssHex(ega[i]));
  });
}
onLookChange(applyCss);
