// The car park scenery: tarmac, stall lines, planted medians, cart corrals,
// and the store itself, a warehouse the size of a small country.
import * as THREE from 'three';
import { EGA, box, textTexture } from './models.js';
import { STALL_W, RAISED_H, STORE_NAME, LOT_SLOGANS } from '../sim/lot.js';

const flat = (m) => { m.castShadow = false; return m; };
const sign = (text, w, h, opts, x, y, z, ry = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, opts), side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
};

export function buildLotScene(level, surface = 'dry') {
  const g = new THREE.Group();
  const L = level.lot;
  const { D, A, half, rows, aisles, zStore, zFar, storeFace } = L;
  const midZ = (zFar + storeFace) / 2;
  const spanX = level.xMax - level.xMin + 40;
  const spanZ = storeFace - zFar + 6;
  const tarmac = surface === 'ice' ? EGA.lgray : EGA.dgray;

  g.add(flat(box(spanX, 0.1, spanZ, tarmac, 0, -0.05, midZ)));
  // puddles / ice
  if (surface !== 'dry') {
    for (let i = 0; i < (surface === 'ice' ? 70 : 34); i++) {
      const p = box(2 + Math.random() * 4, 0.015, 1 + Math.random() * 2, surface === 'ice' ? (Math.random() < 0.5 ? EGA.white : EGA.lcyan) : EGA.blue,
        (Math.random() - 0.5) * 2 * (half + A), 0.008, zFar + Math.random() * (zStore - zFar), { basic: true });
      p.castShadow = p.receiveShadow = false;
      g.add(p);
    }
  }

  // Stall lines: a line between every stall, and one across the back.
  const line = (w, d, x, z, c = EGA.white) => g.add(flat(box(w, 0.02, d, c, x, 0.012, z, { basic: true })));
  const walk = L.walkways;
  for (const row of rows) {
    const zc = row.open + row.n * D / 2;
    for (let b = 0; b < 3; b++) {
      const x0 = -half + b * (8 * STALL_W + 3.2);
      for (let i = 0; i <= 8; i++) line(0.12, D, x0 + i * STALL_W, zc);
      line(8 * STALL_W, 0.12, x0 + 4 * STALL_W, row.open + row.n * (D - 0.06));
    }
  }
  // Crosswalks across the aisles on the walkways, and arrows to say which way.
  for (const x of walk) {
    for (const az of aisles) {
      for (let k = -3; k <= 3; k++) line(2.4, 0.45, x, az + k * (A / 7.5), EGA.white);
    }
    // the walkway strip through the rows
    g.add(flat(box(3.0, 0.02, zStore - zFar, 0x555555, x, 0.006, (zStore + zFar) / 2, { basic: true })));
  }
  for (const az of aisles) {
    for (let x = -half + 8; x < half; x += 16) {
      for (const side of [1, -1]) {
        const dir = side * level.hand; // traffic keeps to the proper side
        const ar = new THREE.Group();
        ar.add(flat(box(1.6, 0.02, 0.18, EGA.white, -0.3, 0.012, 0, { basic: true })));
        const h1 = flat(box(0.7, 0.02, 0.18, EGA.white, 0.35, 0.012, 0.2, { basic: true })); h1.rotation.y = 0.7;
        const h2 = flat(box(0.7, 0.02, 0.18, EGA.white, 0.35, 0.012, -0.2, { basic: true })); h2.rotation.y = -0.7;
        ar.add(h1, h2);
        ar.position.set(x + side * 4, 0, az + dir * A / 4);
        ar.rotation.y = side > 0 ? 0 : Math.PI;
        g.add(ar);
      }
    }
  }

  // Raised strips: medians with a curb and a hedge, the store sidewalk, the perimeter planter.
  for (const q of level.raised) {
    const w = q.x1 - q.x0, d = q.z1 - q.z0, cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
    const top = q.kind === 'sidewalk' ? EGA.lgray : EGA.green;
    g.add(flat(box(w, RAISED_H, d, EGA.white, cx, RAISED_H / 2, cz)));
    g.add(flat(box(w - 0.3, 0.02, d - 0.3, top, cx, RAISED_H + 0.01, cz)));
    if (q.kind === 'median') {
      for (let x = q.x0 + 1; x < q.x1 - 1; x += 3.6) g.add(box(1.4 + Math.random() * 0.8, 0.5, 0.8, EGA.green, x, RAISED_H + 0.25, cz));
    }
    if (q.kind === 'planter') {
      g.add(box(w, 1.8, 1.2, EGA.green, cx, RAISED_H + 0.9, q.z0 + 0.7)); // a hedge you can't see over
      for (let x = q.x0 + 2; x < q.x1; x += 5) g.add(box(1.6, 0.6, 1.3, EGA.lgreen, x, RAISED_H + 1.9, q.z0 + 0.7));
    }
    if (q.kind === 'sidewalk') {
      for (let x = q.x0; x < q.x1; x += 2.5) line(0.05, d, x, cz, EGA.dgray).position.y = RAISED_H + 0.02;
      // the painted fire lane in front of it
      for (let x = -half - 10; x < half + 10; x += 2) line(1.0, 0.25, x, zStore - 0.4, EGA.lred);
    }
  }

  // Cart corrals.
  for (const w of level.walls.filter((q) => q.kind === 'corral')) {
    const c = new THREE.Group();
    const len = w.hw * 2;
    for (const s of [1, -1]) {
      c.add(box(0.06, 0.06, len, EGA.lgray, s * w.hl, 1.0, 0));
      c.add(box(0.06, 0.06, len, EGA.lgray, s * w.hl, 0.5, 0));
      for (const e of [1, -1]) c.add(box(0.08, 1.05, 0.08, EGA.lgray, s * w.hl, 0.52, e * len / 2));
    }
    c.add(box(w.hl * 2, 0.06, 0.06, EGA.lgray, 0, 1.0, -Math.sign(w.z) * len / 2));
    for (let k = 0; k < 4; k++) { const ct = buildCart(); ct.position.set(0, 0, -len / 2 + 0.8 + k * 0.55); ct.rotation.y = Math.PI / 2; c.add(ct); }
    c.add(sign('CART RETURN (OPTIONAL, APPARENTLY)', 2.2, 0.5, { bg: '#0000aa', fg: '#ffffff', w: 384, h: 64, size: 16 }, 0, 1.6, len / 2 * -Math.sign(w.z), 0));
    c.position.set(w.x, 0, w.z);
    g.add(c);
  }

  // The store.
  const store = new THREE.Group();
  const sz = storeFace + 15, sw = 2 * half + 40, sh = 11;
  store.add(box(sw, sh, 30, EGA.lgray, 0, sh / 2, sz));
  store.add(box(sw + 0.4, 1.2, 30.4, EGA.red, 0, sh + 0.2, sz));                 // the red band across the top
  store.add(box(sw + 0.5, 0.8, 0.4, EGA.lblue, 0, sh - 1.5, storeFace - 0.1));   // and the blue one
  const brand = sign(STORE_NAME, 26, 4.4, { bg: '#aa0000', fg: '#ffffff', w: 512, h: 88, size: 60, border: '#ffff55' }, 0, sh - 3.8, storeFace - 0.25, Math.PI);
  store.add(brand);
  store.add(sign('WHOLESALE WAREHOUSE OF EVERYTHING', 22, 1.3, { bg: '#0000aa', fg: '#ffff55', w: 512, h: 48, size: 20 }, 0, sh - 6.6, storeFace - 0.25, Math.PI));
  // entrance and exit
  for (const [x, txt] of [[-9, 'IN'], [9, 'OUT (EVENTUALLY)']]) {
    store.add(box(7, 3.4, 0.2, EGA.black, x, 1.7, storeFace - 0.05));
    for (let k = 0; k < 4; k++) store.add(box(1.6, 3.0, 0.1, EGA.lcyan, x - 2.6 + k * 1.75, 1.6, storeFace - 0.2, { basic: true }));
    store.add(sign(txt, 6, 0.8, { bg: '#555555', fg: '#ffffff', w: 256, h: 40, size: 18 }, x, 3.95, storeFace - 0.3, Math.PI));
  }
  // banners
  [-36, -24, 24, 36].forEach((x, i) => {
    store.add(sign(LOT_SLOGANS[i % LOT_SLOGANS.length], 10, 1.6, { bg: ['#ffff55', '#55ff55', '#ff55ff', '#55ffff'][i], fg: '#000000', w: 512, h: 80, size: 22, border: '#000000' }, x, 5.0, storeFace - 0.25, Math.PI));
  });
  // A tyre centre round the side, and a giant inflatable gorilla on the roof, for reasons.
  store.add(sign('TYRE CENTRE: WE ALSO DO DENTS', 12, 1.2, { bg: '#000000', fg: '#ff5555', w: 512, h: 48, size: 20 }, -half - 4, 3.2, storeFace - 0.25, Math.PI));
  const gor = new THREE.Group();
  gor.add(box(3.2, 4, 2.4, EGA.dgray, 0, 2, 0), box(2.2, 2, 2, EGA.dgray, 0, 5, 0), box(1.4, 0.8, 0.3, EGA.lgray, 0, 4.8, -1.05));
  gor.add(box(0.9, 3.4, 0.9, EGA.dgray, 2.1, 3, 0), box(0.9, 3.4, 0.9, EGA.dgray, -2.1, 3, 0));
  gor.add(box(0.3, 0.3, 0.1, EGA.white, 0.5, 5.4, -1.0, { basic: true }), box(0.3, 0.3, 0.1, EGA.white, -0.5, 5.4, -1.0, { basic: true }));
  gor.add(sign('SALE!', 3, 1, { bg: '#ffff55', fg: '#aa0000', w: 128, h: 48, size: 22 }, 0, 2.2, -1.25, Math.PI));
  gor.position.set(22, sh + 0.8, storeFace + 5);
  gor.userData.gorilla = true;
  store.add(gor);
  g.add(store);

  // Signs at the lot entrances, and over the far hedge.
  for (const end of [level.xMin, level.xMax]) {
    g.add(box(0.5, 1.2, spanZ - 6, EGA.white, end, 0.6, midZ));
    for (let z = zFar; z < storeFace; z += 2) g.add(box(0.52, 1.0, 1.0, EGA.lred, end, 0.6, z));
    g.add(sign('LOT FULL. GO HOME.', 7, 1.2, { bg: '#aa5500', fg: '#ffffff' }, end, 2.2, aisles[1], Math.PI / 2));
  }
  g.add(sign('NO OVERNIGHT PARKING. NO DAYTIME PARKING EITHER, LOOK AROUND YOU.', 18, 1.1, { bg: '#ffffff', fg: '#aa0000', w: 768, h: 48, size: 18 }, 0, 3.6, zFar - 1.2, 0));

  // Ground beyond.
  g.add(flat(box(600, 0.1, 600, EGA.green, 0, -0.2, midZ)));
  return { group: g, buildings: [], gorilla: gor };
}

// A shopping cart, about a metre long, local +x is the handle-to-nose direction.
export function buildCart() {
  const c = new THREE.Group();
  const col = EGA.lgray;
  c.add(box(0.85, 0.04, 0.55, col, 0.05, 0.55, 0));                     // basket floor
  for (const s of [1, -1]) {
    c.add(box(0.9, 0.42, 0.03, col, 0.05, 0.76, s * 0.28, { transparent: true, opacity: 0.85 }));
    c.add(box(0.04, 0.04, 0.55, col, 0.5, 0.97, 0));
  }
  c.add(box(0.03, 0.42, 0.55, col, 0.5, 0.76, 0), box(0.03, 0.42, 0.55, col, -0.4, 0.76, 0));
  c.add(box(0.06, 0.06, 0.6, EGA.lred, -0.5, 1.02, 0));                 // the handle
  c.add(box(0.75, 0.04, 0.4, col, 0.05, 0.18, 0));                      // bottom tray
  for (const [x, z] of [[0.38, 0.22], [0.38, -0.22], [-0.32, 0.22], [-0.32, -0.22]]) c.add(box(0.1, 0.14, 0.05, EGA.black, x, 0.07, z));
  c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return c;
}

// The yellow box and bouncing P on your stall, plus a "back it in" arrow.
export function buildStallMarker(spot, color = EGA.yellow) {
  const g = new THREE.Group();
  const D = spot.depth, W = spot.width;
  const inner = new THREE.Group();
  const add = (w, d, x, z) => inner.add(flat(box(w, 0.03, d, color, x, 0.03, z, { basic: true })));
  add(0.16, D, -W / 2, D / 2); add(0.16, D, W / 2, D / 2); add(W, 0.16, 0, D - 0.08);
  // reverse chevrons pointing into the stall
  for (let k = 0; k < 2; k++) {
    for (const s of [1, -1]) {
      const m = flat(box(0.9, 0.03, 0.16, color, s * 0.32, 0.03, D * 0.45 + k * 0.9, { basic: true }));
      m.rotation.y = s * 0.75;
      inner.add(m);
    }
  }
  // stall frame -> world: x' along (ux, uz), z' along (nx, nz)
  inner.matrixAutoUpdate = false;
  inner.matrix.set(spot.ux, 0, spot.nx, spot.ox, 0, 1, 0, 0, spot.uz, 0, spot.nz, spot.oz, 0, 0, 0, 1);
  g.add(inner);
  g.userData.lines = inner;
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({ map: textTexture('P', { w: 64, h: 64, size: 40, bg: '#0000aa', fg: '#ffffff' }), side: THREE.DoubleSide }));
  s.position.set(spot.cx, 3.6, spot.cz);
  g.add(s);
  g.userData.sign = s;
  return g;
}

