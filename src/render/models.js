import * as THREE from 'three';
import { remapColor, remapCss, ramp, onLookChange } from './looks.js';
import { CURB, SIDEWALK, SIDEWALK_H, LANE, BUILDING_DEPTH } from '../sim/level.js';
import { rampProfile, rampTop } from '../sim/air.js';

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

// ---------- the secret lunch-box fleet ----------
// Cars shaped like food. Each builder fills roughly the L x W footprint.

function blob(rx, ry, rz, color, x, y, z, seg = 10) {
  const m = sphere(1, color, seg);
  m.scale.set(rx, ry, rz);
  m.position.set(x, y, z);
  return m;
}

// A cylinder lying along the car (rTop at the front).
function log(rFront, rBack, len, color, x, y, z, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rFront, rBack, len, seg).rotateZ(-Math.PI / 2), mat(color));
  m.position.set(x, y, z);
  return m;
}

// The undercarriage every food car sits on, and a little open cockpit.
function chassis({ add, L, W, ride }) {
  add(box(L * 0.92, 0.22, W * 0.8, EGA.dgray, 0, ride, 0));
}
function cockpit({ add, W, glass }, x, y, w = W * 0.5) {
  add(box(0.7, 0.3, w, EGA.black, x - 0.3, y, 0));
  add(box(0.06, 0.4, w, glass, x + 0.08, y + 0.2, 0));
  add(box(0.12, 0.3, 0.3, EGA.dgray, x - 0.2, y + 0.2, 0)); // steering column
}

const FOOD = {
  egg(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const ry = (H - ride) / 2 + 0.1;
    add(blob(L * 0.4, ry, W * 0.5, color, -L * 0.06, ride + ry, 0));       // fat end
    add(blob(L * 0.34, ry * 0.8, W * 0.42, color, L * 0.14, ride + ry * 0.85, 0)); // pointy end
    add(box(L * 0.3, 0.07, W * 0.3, accent, -L * 0.1, ride + ry * 2 - 0.02, 0)); // sunny side up
    cockpit(c, L * 0.05, ride + ry * 2 - 0.05, W * 0.4);
  },
  apple(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const ry = (H - ride) / 2;
    add(blob(L * 0.42, ry, W * 0.5, color, 0, ride + ry, 0));
    add(blob(0.22, 0.06, 0.22, EGA.brown, -L * 0.08, H - 0.01, 0)); // dimple
    const stem = box(0.12, 0.5, 0.12, EGA.brown, -L * 0.08, H + 0.2, 0);
    stem.rotation.z = 0.25;
    const leaf = box(0.6, 0.06, 0.3, accent, -L * 0.08 - 0.35, H + 0.35, 0.1);
    leaf.rotation.z = -0.4;
    add(stem, leaf);
    cockpit(c, L * 0.2, H - 0.22);
  },
  banana(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    // five segments along a curve, tips in the air
    const n = 5, seg = L * 0.9 / n, th = 0.8, lift = (H - ride - th) / 4;
    for (let i = 0; i < n; i++) {
      const t = i - (n - 1) / 2;
      const b = box(seg + 0.22, th, W * (Math.abs(t) > 1.5 ? 0.5 : 0.72), color, t * seg, ride + th / 2 + lift * t * t * 0.9, 0);
      b.rotation.z = Math.atan(2 * lift * t / seg) * 0.9;
      add(b);
    }
    const tipY = H - 0.3;
    const stalk = box(0.4, 0.3, 0.3, accent, L * 0.47, tipY, 0); stalk.rotation.z = 0.8;
    const nub = box(0.25, 0.25, 0.25, accent, -L * 0.47, tipY, 0); nub.rotation.z = -0.8;
    add(stalk, nub);
    cockpit(c, 0.3, ride + th - 0.05, W * 0.45);
  },
  pickle(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const rad = Math.min(W * 0.45, (H - ride) / 2);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(rad, L * 0.95 - rad * 2, 4, 8).rotateZ(Math.PI / 2), mat(color));
    body.position.set(0, ride + rad, 0);
    add(body);
    for (let i = 0; i < 12; i++) { // warts
      const a = (i * 2.4) % (Math.PI * 1.2) - Math.PI * 0.1;
      const x = -L * 0.34 + (i * 0.37 % 1) * L * 0.68;
      add(box(0.18, 0.18, 0.18, accent, x, ride + rad + Math.sin(a) * rad * 0.97, Math.cos(a) * rad * 0.97));
    }
    cockpit(c, L * 0.18, ride + rad * 2 - 0.12, W * 0.42);
  },
  carrot(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const rad = Math.min(W * 0.46, (H - ride) / 2);
    add(log(0.12, rad, L * 0.86, color, L * 0.05, ride + rad, 0, 8));
    add(blob(0.3, rad, rad, color, -L * 0.38, ride + rad, 0, 8));
    for (let i = 0; i < 3; i++) add(box(0.5, 0.05, W * 0.5, EGA.brown, -L * 0.2 + i * L * 0.2, ride + rad * (1.86 - i * 0.42), 0)); // rings
    for (const [dz, tilt] of [[0, 0.5], [0.3, 0.9], [-0.3, 0.2]]) { // leafy top, out the back
      const leaf = box(1.0, 0.14, 0.22, accent, -L * 0.47, ride + rad + 0.45 + Math.abs(dz), dz);
      leaf.rotation.z = -tilt;
      add(leaf);
    }
    cockpit(c, -L * 0.12, ride + rad * 1.8, W * 0.4);
  },
  cheese(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const h = H - ride, l = L * 0.96;
    const shape = new THREE.Shape([new THREE.Vector2(-l / 2, 0), new THREE.Vector2(l / 2, 0), new THREE.Vector2(l / 2, h * 0.3), new THREE.Vector2(-l / 2, h)]);
    const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), mat(color));
    wedge.position.y = ride;
    add(wedge);
    add(box(0.08, h * 0.98, W * 1.01, accent, -l / 2, ride + h / 2, 0)); // rind
    for (const [x, y, rr] of [[-0.32, 0.55, 0.26], [-0.1, 0.25, 0.16], [0.12, 0.3, 0.2], [-0.4, 0.2, 0.12], [0.33, 0.14, 0.1]]) { // holes
      for (const side of [1, -1]) {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 0.06, 8).rotateX(Math.PI / 2), mat(accent));
        hole.position.set(x * l, ride + y * h, side * W / 2);
        add(hole);
      }
    }
    cockpit(c, L * 0.12, ride + h * 0.58, W * 0.5);
  },
  pumpkin(c) {
    const { add, L, W, H, ride, color, accent } = c;
    add(box(L * 0.8, 0.25, 0.3, EGA.dgray, 0, ride - 0.1, 0));
    add(box(L * 0.8, 0.2, W * 0.7, EGA.dgray, 0, ride + 0.05, 0));
    const ry = (H - ride - 0.1) / 2, y = ride + 0.1 + ry;
    for (const dz of [-0.24, 0, 0.24]) add(blob(L * (dz ? 0.37 : 0.4), ry * (dz ? 0.94 : 1), W * 0.22, color, 0, y, dz * W, 10)); // ribs
    add(blob(L * 0.36, ry * 0.9, W * 0.4, color, 0, y, 0, 10));
    const stem = box(0.3, 0.45, 0.3, accent, 0, H + 0.12, 0);
    stem.rotation.z = -0.2;
    add(stem);
    add(box(0.5, 0.06, 0.22, accent, 0.3, H + 0.02, 0.2));
    // a carved grin facing forward
    const fx = L * 0.37;
    add(box(0.2, 0.26, 0.26, EGA.yellow, fx, y + ry * 0.28, W * 0.15, { basic: true }), box(0.2, 0.26, 0.26, EGA.yellow, fx, y + ry * 0.28, -W * 0.15, { basic: true }));
    add(box(0.2, 0.16, W * 0.36, EGA.yellow, fx + 0.03, y - ry * 0.22, 0, { basic: true }));
  },
  pencil(c) {
    const { add, L, W, H, ride, color, accent } = c;
    chassis(c);
    const rad = Math.min(W * 0.36, (H - ride) / 2), y = ride + rad;
    const squash = (m) => { m.scale.z = (W * 0.42) / rad; return m; };
    add(squash(log(rad, rad, L * 0.62, color, -L * 0.03, y, 0, 6)));       // barrel
    add(squash(log(rad * 0.3, rad, L * 0.14, 0xffaa55, L * 0.35, y, 0, 6))); // sharpened wood
    add(squash(log(0.02, rad * 0.3, L * 0.05, EGA.black, L * 0.445, y, 0, 6))); // lead
    add(squash(log(rad * 1.04, rad * 1.04, L * 0.06, EGA.lgray, -L * 0.37, y, 0, 6))); // ferrule
    add(squash(log(rad * 0.95, rad * 0.95, L * 0.08, accent, -L * 0.44, y, 0, 6)));    // eraser
    cockpit(c, L * 0.12, y + rad * 0.82, W * 0.4);
  },
};

/**
 * Builds a car. Local +x is forward, +z is right. Returns
 * { root, body, wheels: [{pivot, wheel, front}], panels }
 */
export function buildCar(spec, color, accent = EGA.white) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts for suspension / curb hops
  root.add(body);
  const L = spec.length, W = spec.width, H = spec.height;
  const style = spec.look || spec.style;
  const food = FOOD[style];
  const r = spec.wheelRadius || 0.32;
  const ride = spec.style === 'monster' ? r * 1.2 : r + 0.05;
  const glass = EGA.lcyan;
  const add = (...m) => { m.forEach((x) => body.add(x)); };

  if (food) {
    food({ add, L, W, H, r, ride, color, accent, glass });
  } else if (style === 'monster') {
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
  } else if (style === 'kart') {
    // a go-kart frame with a shopping trolley basket where the seat should be
    add(box(L * 0.9, 0.12, W * 0.8, EGA.dgray, 0, ride + 0.1, 0));                 // frame
    add(box(0.5, 0.35, W * 0.5, EGA.lred, L * 0.05, ride + 0.35, 0));               // seat
    add(box(0.3, 0.55, W * 0.5, EGA.lred, -L * 0.1, ride + 0.6, 0));               // seat back
    add(box(0.08, 0.5, 0.08, EGA.dgray, L * 0.3, ride + 0.45, 0));                 // steering column
    const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 10), mat(EGA.black));
    wheelRing.position.set(L * 0.28, ride + 0.75, 0); wheelRing.rotation.y = Math.PI / 2 - 0.5; wheelRing.castShadow = true;
    add(wheelRing);
    // the basket: lattice of thin bars (open at the top)
    const bx = -L * 0.32, bw = W * 0.7, bl = L * 0.3, bh = 0.6, by = ride + 0.5;
    for (let i = 0; i <= 3; i++) {
      add(box(bl, 0.03, 0.03, color, bx, by + i * bh / 3, bw / 2), box(bl, 0.03, 0.03, color, bx, by + i * bh / 3, -bw / 2));
      add(box(0.03, 0.03, bw, color, bx - bl / 2, by + i * bh / 3, 0), box(0.03, 0.03, bw, color, bx + bl / 2, by + i * bh / 3, 0));
    }
    for (let i = 0; i <= 4; i++) {
      add(box(0.03, bh, 0.03, color, bx - bl / 2 + i * bl / 4, by + bh / 2, bw / 2), box(0.03, bh, 0.03, color, bx - bl / 2 + i * bl / 4, by + bh / 2, -bw / 2));
    }
    add(box(bl * 0.98, 0.03, bw * 0.98, color, bx, by, 0));                        // basket floor
    add(box(0.5, 0.3, 0.4, accent, bx, by + 0.2, 0.1), box(0.3, 0.25, 0.3, EGA.lgreen, bx + 0.1, by + 0.15, -0.2)); // groceries
    add(box(0.12, 0.9, 0.05, 0xff8800, -L * 0.45, ride + 0.9, 0), box(0.3, 0.25, 0.04, 0xff8800, -L * 0.45, ride + 1.3, 0)); // safety flag
    add(box(0.4, 0.2, W * 0.4, EGA.dgray, -L * 0.12, ride + 0.25, 0));             // engine
  } else if (style === 'bus') {
    const capH = H - ride - 0.1;
    add(box(L, capH, W, color, 0, ride + capH / 2 + 0.05, 0));
    add(box(L * 0.2, capH * 0.4, W * 1.02, EGA.white, L * 0.4, ride + capH * 0.45, 0)); // hood
    add(box(L * 0.95, 0.22, W * 1.02, accent, 0, ride + capH * 0.4, 0));             // black rub rail
    add(box(0.06, capH * 0.45, W * 0.85, glass, L / 2 + 0.01, ride + capH * 0.7, 0)); // windscreen
    const nWin = Math.max(4, Math.round(L / 1.1));
    for (let i = 0; i < nWin; i++) {
      const wx = -L / 2 + 0.9 + (i + 0.5) * (L - 1.8) / nWin;
      add(box((L - 1.8) / nWin - 0.25, capH * 0.32, 0.06, glass, wx, ride + capH * 0.68, W / 2 + 0.01));
      add(box((L - 1.8) / nWin - 0.25, capH * 0.32, 0.06, glass, wx, ride + capH * 0.68, -W / 2 - 0.01));
    }
    add(box(0.08, 0.6, 0.5, EGA.black, -L * 0.3, H + 0.1, -W * 0.2, { basic: true }));          // exhaust stack-ish
    add(box(0.5, 0.25, 0.25, EGA.lred, L / 2 - 0.4, H + 0.12, W * 0.35, { basic: true }), box(0.5, 0.25, 0.25, EGA.lred, L / 2 - 0.4, H + 0.12, -W * 0.35, { basic: true }));
    add(box(0.5, 0.25, 0.25, EGA.yellow, L / 2 - 1.0, H + 0.12, W * 0.35, { basic: true }), box(0.5, 0.25, 0.25, EGA.yellow, L / 2 - 1.0, H + 0.12, -W * 0.35, { basic: true }));
    // the STOP arm
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: textTexture('STOP', { bg: '#aa0000', fg: '#ffffff', w: 64, h: 64, size: 14 }), side: THREE.DoubleSide }));
    stop.position.set(L * 0.1, ride + capH * 0.6, -W / 2 - 0.4); add(stop);
    add(box(0.04, 0.04, 0.4, EGA.dgray, L * 0.1, ride + capH * 0.6, -W / 2 - 0.2));
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
  // (food cars carry their lights on the chassis, tucked under the produce)
  const lightY = ride + (food ? 0.02 : style === 'monster' ? 0.55 : style === 'bus' ? 0.9 : 0.35);
  const lightX = food ? L * 0.46 : L / 2 + 0.01;
  add(box(0.08, 0.16, 0.3, EGA.yellow, lightX, lightY, W * 0.32), box(0.08, 0.16, 0.3, EGA.yellow, lightX, lightY, -W * 0.32));
  add(box(0.08, 0.16, 0.3, EGA.lred, -lightX, lightY, W * 0.32), box(0.08, 0.16, 0.3, EGA.lred, -lightX, lightY, -W * 0.32));
  if (style !== 'monster' && style !== 'weenie' && style !== 'kart' && !food) {
    add(box(0.14, 0.16, W * 1.02, EGA.dgray, L / 2, ride + 0.08, 0), box(0.14, 0.16, W * 1.02, EGA.dgray, -L / 2, ride + 0.08, 0));
  }

  // wheels
  const ahead = spec.length / 2 - spec.rearOverhang;
  const rearX = -ahead, frontX = spec.wheelbase - ahead;
  const wz = W / 2 - (spec.style === 'monster' ? -0.05 : spec.style === 'kart' ? 0.0 : 0.12);
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
    case 'portaloo': {
      add(box(1.1, 2.2, 1.1, EGA.lblue, 0, 1.1, 0));
      add(box(1.15, 0.15, 1.15, EGA.blue, 0, 2.25, 0));
      add(box(0.05, 1.7, 0.6, EGA.blue, 0.56, 1.0, 0));
      add(box(0.06, 0.12, 0.3, EGA.lgreen, 0.58, 1.9, 0, { basic: true })); // "vacant". it lies.
      break;
    }
    case 'statue': {
      add(box(1.6, 1.0, 1.6, EGA.lgray, 0, 0.5, 0));
      add(box(1.2, 0.8, 1.2, EGA.dgray, 0, 1.4, 0));
      add(box(0.5, 1.4, 0.4, EGA.brown, 0, 2.5, 0));            // body
      add(box(0.2, 1.0, 0.2, EGA.brown, 0, 1.9, 0.3), box(0.2, 1.0, 0.2, EGA.brown, 0, 1.9, -0.3)); // legs (sort of)
      add(box(0.9, 0.2, 0.2, EGA.brown, 0.3, 3.1, 0));           // an arm, pointing at the future
      add(box(0.4, 0.4, 0.4, EGA.brown, 0, 3.4, 0));             // head
      add(box(0.5, 0.15, 0.5, EGA.brown, 0, 3.65, 0));           // hat
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshBasicMaterial({ map: textTexture('THE MAYOR', { bg: '#555555', fg: '#ffff55', w: 128, h: 48, size: 14 }), side: THREE.DoubleSide }));
      plaque.position.set(0, 1.4, 0.62); add(plaque);
      break;
    }
    case 'sheep': {
      add(box(0.9, 0.5, 0.5, EGA.white, 0, 0.6, 0));
      add(box(0.7, 0.14, 0.4, EGA.lgray, 0, 0.9, 0));       // extra fluff
      add(box(0.26, 0.26, 0.26, EGA.dgray, 0.55, 0.78, 0)); // head
      add(box(0.06, 0.1, 0.44, EGA.dgray, 0.5, 0.92, 0));   // ears
      for (const [x, z] of [[0.3, 0.15], [0.3, -0.15], [-0.3, 0.15], [-0.3, -0.15]]) add(box(0.09, 0.36, 0.09, EGA.dgray, x, 0.18, z));
      break;
    }
    default:
      add(box(0.5, 0.5, 0.5, EGA.lmagenta, 0, 0.25, 0));
  }
  return g;
}

// ---------- street ----------

export function buildStreet(level, surface = 'dry') {
  const g = new THREE.Group();
  const roadColor = surface === 'ice' ? EGA.lgray : EGA.dgray;
  const len = level.xMax - level.xMin + 60;
  const mid = (level.xMin + level.xMax) / 2;

  // road
  const road = box(len, 0.1, CURB * 2, roadColor, mid, -0.05, 0);
  road.castShadow = false;
  g.add(road);
  // centre line dashes and parking bay ticks
  for (let x = level.xMin - 20; x < level.xMax + 20; x += 4) {
    const d = box(2, 0.02, 0.18, EGA.yellow, x, 0.01, 0, { basic: true });
    d.castShadow = false;
    g.add(d);
  }
  // ice patches / puddles
  if (surface !== 'dry') {
    const n = surface === 'ice' ? 60 : 28;
    for (let i = 0; i < n; i++) {
      const px = level.xMin - 10 + Math.random() * (level.xMax - level.xMin + 20);
      const pz = (Math.random() - 0.5) * (CURB * 2 - 1.5);
      const p = box(2 + Math.random() * 4, 0.015, 1 + Math.random() * 2, surface === 'ice' ? (Math.random() < 0.5 ? EGA.white : EGA.lcyan) : EGA.blue, px, 0.008, pz, { basic: true });
      p.castShadow = false; p.receiveShadow = false;
      g.add(p);
    }
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

// Wreck mode's jump: a curved wooden kicker with chevrons and a warning banner.
export function buildRamp(ramp) {
  const g = new THREE.Group();
  const width = ramp.z1 - ramp.z0;
  const H = rampTop(ramp);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const u = ramp.len * i / steps;
    shape.lineTo(u, rampProfile(ramp, u));
  }
  shape.lineTo(ramp.len, 0);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  const wedge = new THREE.Mesh(geo, mat(EGA.brown));
  wedge.castShadow = true;
  wedge.receiveShadow = true;
  wedge.position.set(ramp.x0, 0, ramp.z0);
  g.add(wedge);
  const cz = (ramp.z0 + ramp.z1) / 2;
  // plank lines and chevron stripes laid on the surface
  for (let i = 1; i < 12; i++) {
    const u = ramp.len * i / 12;
    const du = 0.05;
    const slope = Math.atan2(rampProfile(ramp, Math.min(ramp.len, u + du)) - rampProfile(ramp, Math.max(0, u - du)), 2 * du);
    const stripe = i % 3 === 0;
    const m = box(stripe ? 0.3 : 0.05, 0.03, width, stripe ? EGA.yellow : EGA.black, ramp.x0 + u, rampProfile(ramp, u) + 0.02, cz, { basic: !stripe });
    m.rotation.z = slope;
    m.castShadow = false;
    g.add(m);
  }
  // hazard trim along the lip and the sides
  for (let k = 0; k < 6; k++) {
    g.add(box(0.12, 0.3, width / 6, k % 2 ? EGA.black : EGA.yellow, ramp.x0 + ramp.len + 0.06, H - 0.15, ramp.z0 + (k + 0.5) * width / 6));
  }
  // a banner over the run-up
  const bx = ramp.x0 - 6;
  for (const z of [ramp.z0 - 0.6, ramp.z1 + 0.6]) g.add(box(0.2, 5, 0.2, EGA.white, bx, 2.5, z));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width + 1.2, 1.1),
    new THREE.MeshBasicMaterial({ map: textTexture('RAMP OF POOR DECISIONS', { bg: '#aa0000', fg: '#ffff55', w: 384 }), side: THREE.DoubleSide }));
  sign.position.set(bx, 4.4, cz);
  sign.rotation.y = -Math.PI / 2;
  g.add(sign);
  return g;
}

export function buildSpotMarker(spot, color = EGA.yellow) {
  const g = new THREE.Group();
  const len = spot.length, depth = 2.4;
  const side = Math.sign(spot.cz);
  const zc = spot.cz - side * depth / 2;
  const lines = [
    [len, 0.12, spot.cx, zc - side * depth / 2 + side * 0.06],
    [0.12, depth, spot.cx - len / 2, zc],
    [0.12, depth, spot.cx + len / 2, zc],
  ];
  const lg = new THREE.Group();
  for (const [w, d, x, z] of lines) {
    const m = box(w, 0.03, d, color, x - spot.cx, 0.02, z, { basic: true });
    m.castShadow = false;
    lg.add(m);
  }
  lg.position.x = spot.cx;
  g.add(lg);
  g.userData.lines = lg;
  // A big bouncy "P" sign.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({ map: textTexture('P', { w: 64, h: 64, size: 40, bg: color === EGA.yellow ? '#0000aa' : '#aa0000', fg: '#ffffff' }), side: THREE.DoubleSide }));
  sign.position.set(spot.cx, 3.6, zc);
  g.add(sign);
  g.userData.sign = sign;
  return g;
}

export { LANE };


// ---------- pedestrians ----------

/** A blocky person. Returns { root, legs: [l, r], body } ; local +x is forward. */
export function buildPed(p) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legL = box(0.22, 0.75, 0.22, p.pants, 0, 0.375, 0.14);
  const legR = box(0.22, 0.75, 0.22, p.pants, 0, 0.375, -0.14);
  // pivot legs at the hip so they swing
  const hipL = new THREE.Group(); hipL.position.set(0, 0.75, 0.14); legL.position.set(0, -0.375, 0); hipL.add(legL);
  const hipR = new THREE.Group(); hipR.position.set(0, 0.75, -0.14); legR.position.set(0, -0.375, 0); hipR.add(legR);
  body.add(hipL, hipR);
  body.add(box(0.36, 0.7, 0.56, p.shirt, 0, 1.1, 0));
  body.add(box(0.14, 0.6, 0.14, p.shirt, 0, 1.15, 0.36), box(0.14, 0.6, 0.14, p.shirt, 0, 1.15, -0.36)); // arms
  body.add(box(0.36, 0.36, 0.36, p.skin, 0, 1.65, 0));
  body.add(box(0.1, 0.06, 0.06, EGA.white, 0.19, 1.7, 0.08), box(0.1, 0.06, 0.06, EGA.white, 0.19, 1.7, -0.08)); // eyes
  if (p.hat) body.add(box(0.44, 0.12, 0.44, p.pants, 0.04, 1.86, 0), box(0.3, 0.2, 0.3, p.pants, 0, 1.98, 0));
  // a phone, to be stared at in the middle of the road
  body.add(box(0.08, 0.14, 0.1, EGA.black, 0.25, 1.3, 0.2));
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, hips: [hipL, hipR] };
}

// Night sky: dark bands with a scatter of stars.
export function nightSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const bands = ['#000000', '#000000', '#0000aa', '#0000aa', '#0000aa', '#555555'];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i / bands.length) * 64, 128, 64 / bands.length + 1); });
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 40), 1, 1);
  g.fillStyle = '#ffff55';
  g.fillRect(100, 8, 6, 6); g.fillRect(99, 9, 8, 4); // a moon, roughly
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Grey sky for fog and rain.
export function greySkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const bands = ['#555555', '#555555', '#aaaaaa', '#aaaaaa', '#aaaaaa', '#ffffff'];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i / bands.length) * 64, 4, 64 / bands.length + 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
