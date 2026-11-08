import * as THREE from 'three';
import { remapColor, remapCss, ramp, onLookChange } from './looks.js';
import { CURB, SIDEWALK, SIDEWALK_H, LANE, BUILDING_DEPTH } from '../sim/level.js';

// The classic 16-colour EGA palette, for that early-90s shareware feel.
export const EGA = {
  black: 0x000000, blue: 0x0000aa, green: 0x00aa00, cyan: 0x00aaaa,
  red: 0xaa0000, magenta: 0xaa00aa, brown: 0xaa5500, lgray: 0xaaaaaa,
  dgray: 0x555555, lblue: 0x5555ff, lgreen: 0x55ff55, lcyan: 0x55ffff,
  lred: 0xff5555, lmagenta: 0xff55ff, yellow: 0xffff55, white: 0xffffff,
};

// Materials are made from authored EGA colours and recoloured when the look changes.
// userData.base keeps the authored colour; userData.dim darkens it (charred wrecks).
const matCache = new Map();
const allMats = new Set();
export function trackMaterial(m, base, dim = 1) {
  m.userData.base = base;
  m.userData.dim = dim;
  allMats.add(m);
  paint(m);
  return m;
}
function paint(m) {
  m.color.setHex(remapColor(m.userData.base)).multiplyScalar(m.userData.dim);
  if (m.isMeshToonMaterial) m.gradientMap = ramp();
}

export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = opts.basic
      ? new THREE.MeshBasicMaterial({ transparent: !!opts.transparent, opacity: opts.opacity ?? 1 })
      : new THREE.MeshToonMaterial({ transparent: !!opts.transparent, opacity: opts.opacity ?? 1 });
    matCache.set(key, trackMaterial(m, color));
  }
  return matCache.get(key);
}

// Sign textures are redrawn when the look changes.
const textures = new Set();

onLookChange(() => {
  for (const m of allMats) paint(m);
  for (const t of textures) { t.userData.draw(); t.needsUpdate = true; }
});

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(boxGeo, mat(color, opts));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop, rBot, h, color, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color));
  m.castShadow = true;
  return m;
}

function sphere(r, color, seg = 6) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat(color));
  m.castShadow = true;
  return m;
}

export function textTexture(text, { bg = '#0000aa', fg = '#ffff55', w = 256, h = 48, size = 22, border = '#ffffff' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const draw = () => {
    g.fillStyle = remapCss(bg); g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = remapCss(border); g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); }
    g.fillStyle = remapCss('#000000');
    let s = size;
    g.font = `${s}px "Press Start 2P", monospace`;
    while (g.measureText(text).width > w - 16 && s > 8) { s -= 2; g.font = `${s}px "Press Start 2P", monospace`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2 + 2, h / 2 + 3);
    g.fillStyle = remapCss(fg);
    g.fillText(text, w / 2, h / 2 + 1);
  };
  draw();
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.draw = draw;
  textures.add(t);
  t.addEventListener('dispose', () => textures.delete(t));
  return t;
}

// ---------- vehicles ----------

function wheel(r, color = EGA.black) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 10).rotateX(Math.PI / 2), mat(color));
  tyre.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.3, 6).rotateX(Math.PI / 2), mat(EGA.lgray));
  g.add(tyre, hub);
  return g;
}

/**
 * Builds a car. Local +x is forward, +z is right. Returns
 * { root, body, wheels: [{pivot, wheel, front}], panels }
 */
export function buildCar(spec, color, accent = EGA.white) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts for suspension / curb hops
  root.add(body);
  const L = spec.length, W = spec.width, H = spec.height;
  const style = spec.style;
  const r = spec.wheelRadius || 0.32;
  const ride = style === 'monster' ? r * 1.2 : r + 0.05;
  const glass = EGA.lcyan;
  const add = (...m) => { m.forEach((x) => body.add(x)); };

  if (style === 'monster') {
    add(box(L * 0.95, 0.7, W * 0.8, color, 0, ride + 0.5, 0));
    add(box(L * 0.45, 0.65, W * 0.72, color, -0.1, ride + 1.17, 0));
    add(box(0.05, 0.45, W * 0.6, glass, L * 0.125, ride + 1.2, 0));
    add(box(L * 0.3, 0.4, 0.05, glass, -0.1, ride + 1.2, W * 0.36), box(L * 0.3, 0.4, 0.05, glass, -0.1, ride + 1.2, -W * 0.36));
    add(box(L * 0.5, 0.12, W * 0.82, accent, 0.4, ride + 0.88, 0));     // stripe
    add(box(0.5, 0.5, W * 0.3, EGA.dgray, L * 0.25, ride + 0.95, 0));   // blower
    add(box(L * 0.8, 0.25, 0.3, EGA.dgray, 0, ride - 0.1, 0));          // chassis
  } else if (style === 'van' || style === 'truck') {
    const capH = H - ride - 0.15;
    add(box(L, capH, W, color, 0, ride + capH / 2 + 0.05, 0));
    add(box(0.06, capH * 0.4, W * 0.85, glass, L / 2 + 0.01, ride + capH * 0.7, 0));
    add(box(L * 0.18, capH * 0.35, 0.06, glass, L * 0.36, ride + capH * 0.7, W / 2), box(L * 0.18, capH * 0.35, 0.06, glass, L * 0.36, ride + capH * 0.7, -W / 2));
    add(box(L * 0.98, 0.18, W * 1.01, accent, -0.02, ride + capH * 0.35, 0));
    if (spec.id === 'za') { // the pizza
      const pz = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 10), mat(EGA.yellow));
      pz.position.set(-0.2, H + 0.12, 0); pz.rotation.z = 0.25; pz.castShadow = true;
      add(pz);
      for (let i = 0; i < 5; i++) {
        const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 6), mat(EGA.red));
        pep.position.set(Math.cos(i * 1.3) * 0.55, 0.08, Math.sin(i * 1.3) * 0.55);
        pz.add(pep);
      }
      add(box(0.15, 0.4, 0.15, EGA.dgray, -0.2, H - 0.1, 0));
    } else if (spec.id === 'scoop') { // ice cream truck
      add(box(0.06, 0.8, W * 0.6, EGA.black, -L * 0.1, ride + capH * 0.55, W / 2 + 0.02)); // serving hatch
      const cone = cyl(0.45, 0.05, 1.0, EGA.brown, 8); cone.rotation.x = Math.PI; cone.position.set(-0.3, H + 0.45, 0);
      const scoop = sphere(0.5, EGA.lmagenta, 8); scoop.position.set(-0.3, H + 1.05, 0);
      const cherry = sphere(0.14, EGA.lred, 6); cherry.position.set(-0.3, H + 1.6, 0);
      add(cone, scoop, cherry);
    }
  } else if (style === 'weenie') {
    const bun1 = box(L * 0.95, 0.55, 0.55, color, 0, ride + 0.4, W * 0.28);
    const bun2 = box(L * 0.95, 0.55, 0.55, color, 0, ride + 0.4, -W * 0.28);
    const dog = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, L * 0.75, 4, 8).rotateZ(Math.PI / 2), mat(EGA.lred));
    dog.position.set(0, ride + 0.95, 0); dog.castShadow = true;
    add(bun1, bun2, dog);
    for (let i = 0; i < 6; i++) add(box(0.5, 0.06, 0.12, accent, -L * 0.3 + i * L * 0.12, ride + 1.52, (i % 2 ? 0.15 : -0.15)));
    add(box(0.8, 0.5, W * 0.6, EGA.white, L * 0.3, ride + 0.85, 0));
    add(box(0.05, 0.3, W * 0.5, glass, L * 0.3 + 0.41, ride + 0.95, 0));
  } else {
    // hatch, sedan, pickup, limo
    const lowH = 0.55;
    add(box(L, lowH, W, color, 0, ride + lowH / 2, 0));
    let cabL = L * 0.5, cabX = -L * 0.05;
    if (style === 'hatch') { cabL = L * 0.55; cabX = -L * 0.12; }
    if (style === 'pickup') { cabL = L * 0.3; cabX = L * 0.08; }
    if (style === 'limo') { cabL = L * 0.7; cabX = -L * 0.05; }
    const cabH = H - ride - lowH;
    add(box(cabL, cabH, W * 0.88, color, cabX, ride + lowH + cabH / 2, 0));
    add(box(0.06, cabH * 0.7, W * 0.78, glass, cabX + cabL / 2 + 0.01, ride + lowH + cabH * 0.5, 0));
    add(box(0.06, cabH * 0.7, W * 0.78, glass, cabX - cabL / 2 - 0.01, ride + lowH + cabH * 0.5, 0));
    const nWin = style === 'limo' ? 4 : 2;
    for (let i = 0; i < nWin; i++) {
      const wl = cabL / nWin - 0.15;
      const wx = cabX - cabL / 2 + (i + 0.5) * (cabL / nWin);
      add(box(wl, cabH * 0.6, 0.06, glass, wx, ride + lowH + cabH * 0.5, W * 0.44 + 0.01));
      add(box(wl, cabH * 0.6, 0.06, glass, wx, ride + lowH + cabH * 0.5, -W * 0.44 - 0.01));
    }
    if (style === 'pickup') add(box(L * 0.35, 0.3, W * 0.9, EGA.dgray, -L * 0.28, ride + lowH + 0.05, 0));
    add(box(L * 1.01, 0.1, W * 1.01, accent, 0, ride + lowH * 0.6, 0)); // racing stripe-ish trim
    if (style === 'limo') add(box(0.2, 0.2, 0.2, EGA.yellow, cabX + cabL / 2 - 0.3, H + 0.05, 0));
  }
  // lights and bumpers
  const lightY = ride + (style === 'monster' ? 0.55 : 0.35);
  add(box(0.08, 0.16, 0.3, EGA.yellow, L / 2 + 0.01, lightY, W * 0.32), box(0.08, 0.16, 0.3, EGA.yellow, L / 2 + 0.01, lightY, -W * 0.32));
  add(box(0.08, 0.16, 0.3, EGA.lred, -L / 2 - 0.01, lightY, W * 0.32), box(0.08, 0.16, 0.3, EGA.lred, -L / 2 - 0.01, lightY, -W * 0.32));
  if (style !== 'monster' && style !== 'weenie') {
    add(box(0.14, 0.16, W * 1.02, EGA.dgray, L / 2, ride + 0.08, 0), box(0.14, 0.16, W * 1.02, EGA.dgray, -L / 2, ride + 0.08, 0));
  }

  // wheels
  const ahead = spec.length / 2 - spec.rearOverhang;
  const rearX = -ahead, frontX = spec.wheelbase - ahead;
  const wz = W / 2 - (style === 'monster' ? -0.05 : 0.12);
  const wheels = [];
  for (const [x, z, front] of [[frontX, wz, true], [frontX, -wz, true], [rearX, -wz, false], [rearX, wz, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const w = wheel(r);
    pivot.add(w);
    root.add(pivot);
    wheels.push({ pivot, wheel: w, front });
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, wheels, radius: r };
}

// ---------- props ----------

export function buildProp(type) {
  const g = new THREE.Group();
  const add = (m) => { g.add(m); return m; };
  switch (type) {
    case 'meter': {
      add(box(0.08, 0.9, 0.08, EGA.dgray, 0, 0.45, 0));
      add(box(0.24, 0.32, 0.2, EGA.lgray, 0, 1.0, 0));
      add(box(0.02, 0.12, 0.14, EGA.red, 0.12, 1.02, 0));
      break;
    }
    case 'hydrant': {
      const b = add(cyl(0.16, 0.2, 0.6, EGA.lred, 8)); b.position.y = 0.3;
      const t = add(sphere(0.17, EGA.lred, 8)); t.position.y = 0.62;
      add(box(0.45, 0.1, 0.1, EGA.red, 0, 0.42, 0));
      break;
    }
    case 'mailbox': {
      add(box(0.55, 0.85, 0.5, EGA.blue, 0, 0.62, 0));
      add(box(0.12, 0.2, 0.12, EGA.dgray, 0.15, 0.1, 0.15));
      add(box(0.12, 0.2, 0.12, EGA.dgray, -0.15, 0.1, -0.15));
      add(box(0.57, 0.08, 0.3, EGA.white, 0, 0.85, 0));
      break;
    }
    case 'trash': {
      const c = add(cyl(0.3, 0.26, 0.85, EGA.green, 8)); c.position.y = 0.43;
      const lid = add(cyl(0.33, 0.33, 0.08, EGA.dgray, 8)); lid.position.y = 0.9;
      break;
    }
    case 'lamp': {
      add(box(0.18, 4.2, 0.18, EGA.dgray, 0, 2.1, 0));
      add(box(0.12, 0.12, 1.1, EGA.dgray, 0, 4.15, 0)).position.z = 0;
      add(box(0.4, 0.25, 0.4, EGA.yellow, 0, 4.0, 0, { basic: true }));
      break;
    }
    case 'bench': {
      add(box(1.8, 0.1, 0.5, EGA.brown, 0, 0.5, 0));
      add(box(1.8, 0.4, 0.08, EGA.brown, 0, 0.8, 0.22));
      add(box(0.1, 0.5, 0.45, EGA.dgray, 0.75, 0.25, 0));
      add(box(0.1, 0.5, 0.45, EGA.dgray, -0.75, 0.25, 0));
      break;
    }
    case 'newsbox': {
      add(box(0.45, 0.9, 0.45, EGA.yellow, 0, 0.45, 0));
      add(box(0.02, 0.3, 0.35, EGA.lcyan, 0.23, 0.65, 0));
      break;
    }
    case 'tree': {
      add(box(0.3, 2.0, 0.3, EGA.brown, 0, 1.0, 0));
      add(box(1.8, 1.4, 1.8, EGA.green, 0, 2.6, 0));
      add(box(1.2, 1.0, 1.2, EGA.lgreen, 0, 3.6, 0));
      add(box(0.9, 0.12, 0.9, EGA.brown, 0, 0.06, 0));
      break;
    }
    case 'cone': {
      const c = add(cyl(0.04, 0.2, 0.7, 0xff8800, 6)); c.position.y = 0.35;
      add(box(0.45, 0.06, 0.45, 0xff8800, 0, 0.03, 0));
      const s = add(cyl(0.11, 0.14, 0.12, EGA.white, 6)); s.position.y = 0.38;
      break;
    }
    case 'crate': {
      add(box(0.98, 0.98, 0.98, EGA.brown, 0, 0.49, 0));
      add(box(1.0, 0.12, 1.0, 0xffaa55, 0, 0.9, 0));
      add(box(1.0, 0.12, 1.0, 0xffaa55, 0, 0.1, 0));
      break;
    }
    case 'sawhorse': {
      add(box(0.12, 0.3, 2.0, EGA.white, 0, 0.9, 0));
      for (let i = 0; i < 4; i++) add(box(0.13, 0.3, 0.25, EGA.lred, 0, 0.9, -0.75 + i * 0.5));
      add(box(0.1, 0.9, 0.1, EGA.dgray, 0, 0.45, 0.85));
      add(box(0.1, 0.9, 0.1, EGA.dgray, 0, 0.45, -0.85));
      break;
    }
    case 'fruit': {
      add(box(2.4, 0.9, 1.1, EGA.brown, 0, 0.45, 0));
      add(box(2.5, 0.1, 1.3, EGA.lred, 0, 2.0, 0));
      add(box(0.1, 1.1, 0.1, EGA.dgray, 1.15, 1.45, 0.5));
      add(box(0.1, 1.1, 0.1, EGA.dgray, -1.15, 1.45, 0.5));
      for (let i = 0; i < 12; i++) {
        const f = add(sphere(0.14, [EGA.lred, EGA.yellow, EGA.lgreen, 0xff8800][i % 4], 5));
        f.position.set(-1 + (i % 6) * 0.4, 1.02, (i < 6 ? -0.25 : 0.25));
      }
      break;
    }
    case 'booth': {
      add(box(0.95, 2.3, 0.95, EGA.red, 0, 1.15, 0));
      add(box(0.05, 1.4, 0.7, EGA.lcyan, 0.48, 1.3, 0));
      add(box(1.0, 0.2, 1.0, EGA.yellow, 0, 2.35, 0));
      break;
    }
    default:
      add(box(0.5, 0.5, 0.5, EGA.lmagenta, 0, 0.25, 0));
  }
  return g;
}

// ---------- street ----------

export function buildStreet(level) {
  const g = new THREE.Group();
  const len = level.xMax - level.xMin + 60;
  const mid = (level.xMin + level.xMax) / 2;

  // road
  const road = box(len, 0.1, CURB * 2, EGA.dgray, mid, -0.05, 0);
  road.castShadow = false;
  g.add(road);
  // centre line dashes and parking bay ticks
  for (let x = level.xMin - 20; x < level.xMax + 20; x += 4) {
    const d = box(2, 0.02, 0.18, EGA.yellow, x, 0.01, 0, { basic: true });
    d.castShadow = false;
    g.add(d);
  }
  for (const dir of [1, -1]) {
    const edge = box(len, 0.02, 0.1, EGA.white, mid, 0.01, dir * (CURB - 2.5), { basic: true });
    edge.castShadow = false;
    g.add(edge);
    // sidewalk + curb
    const sw = box(len, SIDEWALK_H, SIDEWALK, EGA.lgray, mid, SIDEWALK_H / 2, dir * (CURB + SIDEWALK / 2));
    sw.castShadow = false;
    g.add(sw);
    const curb = box(len, SIDEWALK_H + 0.02, 0.2, EGA.white, mid, SIDEWALK_H / 2, dir * (CURB + 0.1));
    curb.castShadow = false;
    g.add(curb);
    // sidewalk slab lines
    for (let x = level.xMin - 20; x < level.xMax + 20; x += 2.5) {
      const l = box(0.05, 0.01, SIDEWALK, EGA.dgray, x, SIDEWALK_H + 0.005, dir * (CURB + SIDEWALK / 2), { basic: true });
      l.castShadow = false;
      g.add(l);
    }
  }

  // buildings (each its own group so it can be wrecked)
  const bz0 = CURB + SIDEWALK;
  const buildings = level.buildings.map((b) => {
    const v = buildBuilding(b);
    g.add(v.group);
    return v;
  });
  // the lots behind the buildings (only visible once a building is gone) and their back walls
  const span = level.xMax - level.xMin + 60;
  for (const dir of [1, -1]) {
    const lot = box(span, SIDEWALK_H, BUILDING_DEPTH, EGA.dgray, mid, SIDEWALK_H / 2 - 0.01, dir * (bz0 + BUILDING_DEPTH / 2));
    lot.castShadow = false;
    g.add(lot);
    g.add(box(span, 2.4, 1.0, EGA.red, mid, 1.2, dir * (bz0 + BUILDING_DEPTH + 0.5)));
    g.add(box(span, 0.25, 1.1, EGA.lgray, mid, 2.5, dir * (bz0 + BUILDING_DEPTH + 0.5)));
  }

  // road closed barricades
  for (const end of [level.xMin, level.xMax]) {
    const span = (CURB + SIDEWALK) * 2;
    g.add(box(0.5, 1.2, span, EGA.white, end, 0.6, 0));
    for (let z = -span / 2 + 0.5; z < span / 2; z += 2) g.add(box(0.52, 1.0, 1.0, EGA.lred, end, 0.6, z));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2),
      new THREE.MeshBasicMaterial({ map: textTexture('ROAD CLOSED: BECAUSE', { bg: '#aa5500', fg: '#ffffff' }), side: THREE.DoubleSide }));
    sign.position.set(end, 2.0, 0);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
  }

  // distant ground + blocky hills
  const ground = box(600, 0.1, 600, EGA.green, mid, -0.2, 0);
  ground.castShadow = false;
  g.add(ground);
  return { group: g, buildings };
}

/**
 * One building: `block` is the main body, `facade` holds the shopfront bits
 * that fly off on the first big hit, `extras` are windows/cornice that go
 * when it collapses.
 */
export function buildBuilding(b) {
  const group = new THREE.Group();
  const facade = new THREE.Group();
  const extras = new THREE.Group();
  group.add(facade, extras);
  const bz0 = CURB + SIDEWALK;
  const w = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, h = b.height, depth = BUILDING_DEPTH;
  const z = b.dir * (bz0 + depth / 2);
  const block = box(w - 0.1, h, depth, b.color, cx, h / 2, z);
  group.add(block);
  extras.add(box(w + 0.1, 0.4, depth + 0.4, EGA.white, cx, h + 0.2, z)); // cornice
  const face = b.dir * bz0 - b.dir * 0.02;
  // Upper-floor windows: start above the shop sign and stand clear of the
  // wall (a window half-buried in the wall flickers).
  const out = -b.dir * 0.08;
  let n = 0;
  for (let fy = 4.6; fy < h - 1; fy += 2.5) {
    for (let fx = b.x0 + 1.2; fx < b.x1 - 1; fx += 2) {
      const lit = (n++ * 7 + Math.round(b.x0)) % 3 === 0;
      extras.add(box(1.0, 1.3, 0.06, lit ? EGA.yellow : EGA.blue, fx + 0.3, fy, face + out, { basic: true }));
    }
  }
  // shopfront: door, big window (in panes, so it shatters nicely), sign, awning
  facade.add(box(1.2, 2.2, 0.12, EGA.black, b.x0 + 1.5, 1.1, face));
  const winW = w - 4, panes = Math.max(2, Math.round(winW / 1.2));
  for (let i = 0; i < panes; i++) {
    for (let j = 0; j < 2; j++) {
      facade.add(box(winW / panes - 0.04, 0.78, 0.12, EGA.lcyan, cx + 1 - winW / 2 + (i + 0.5) * winW / panes, 1.0 + j * 0.8, face, { basic: true }));
    }
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 1, 8), 1.1),
    new THREE.MeshBasicMaterial({ map: textTexture(b.name), side: THREE.DoubleSide }));
  sign.position.set(cx, 2.85, face - b.dir * 0.12);
  sign.rotation.y = b.dir > 0 ? Math.PI : 0;
  facade.add(sign);
  const aw = box(w - 0.6, 0.15, 1.4, [EGA.lred, EGA.lmagenta, EGA.lgreen, EGA.lblue][Math.abs(Math.floor(b.x0)) % 4], cx, 2.25, face - b.dir * 0.7);
  aw.rotation.x = b.dir * 0.25;
  facade.add(aw);
  // a dark, smashed-in hole that appears behind the shopfront once it's gone
  const hole = box(w - 2.5, 2.3, 0.1, EGA.black, cx + 0.3, 1.25, face + b.dir * 0.03, { basic: true });
  hole.visible = false;
  group.add(hole);
  return { group, block, facade, extras, hole, info: b, w, h, depth, cx, z };
}

export function buildSpotMarker(spot, color = EGA.yellow) {
  const g = new THREE.Group();
  const len = spot.length, depth = 2.4;
  const zc = spot.cz - spot.dir * depth / 2;
  const lines = [
    [len, 0.12, spot.cx, zc - spot.dir * depth / 2 + spot.dir * 0.06],
    [0.12, depth, spot.cx - len / 2, zc],
    [0.12, depth, spot.cx + len / 2, zc],
  ];
  for (const [w, d, x, z] of lines) {
    const m = box(w, 0.03, d, color, x, 0.02, z, { basic: true });
    m.castShadow = false;
    g.add(m);
  }
  // A big bouncy "P" sign.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({ map: textTexture('P', { w: 64, h: 64, size: 40, bg: color === EGA.yellow ? '#0000aa' : '#aa0000', fg: '#ffffff' }), side: THREE.DoubleSide }));
  sign.position.set(spot.cx, 3.6, zc);
  g.add(sign);
  g.userData.sign = sign;
  return g;
}

export { LANE };
