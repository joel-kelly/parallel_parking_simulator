// The driver's seat: a cabin for each vehicle (every one with its own
// nonsense on the dashboard), and an infotainment screen showing the backup
// camera, with guide lines that bend as you steer and a parking sensor that
// panics as you get close.
import * as THREE from 'three';
import { EGA, box, mat, textTexture } from './models.js';
import { remapCss } from './looks.js';
import { centreAhead } from '../sim/vehicles.js';

const FEED_W = 208, FEED_H = 112;      // backup camera resolution: proper potato quality
const UI_W = 320, UI_H = 200;          // the screen's canvas

// Per-vehicle cabins. dash/trim/seat colours, the infotainment brand, its
// radio station, and a list of knick-knacks.
const THEMES = {
  bean: {
    dash: 0xff55ff, trim: 0xffffff, wheel: 0xff55ff, brand: 'BEAN-OS 3.1', ui: '#aa00aa',
    radio: ['NOW PLAYING: SMOOTH REVERSE FM', 'BEEP BEEP (THE BACKING-UP SONG)', 'TRAFFIC: YES'],
    extras: ['dice', 'bobble', 'tree'],
  },
  za: {
    dash: 0xaa0000, trim: 0xffffff, wheel: 0x000000, brand: 'ZA-NAV', ui: '#aa0000',
    radio: ['DELIVERY ETA: 29:59', 'TIP: PINEAPPLE IS VALID', 'CUSTOMER RATING: 2 SLICES'],
    extras: ['pizzas', 'pepperoni', 'timer'],
  },
  kart: {
    dash: 0x555555, trim: 0xff5555, wheel: 0x000000, brand: 'KART-PAD (ZIP-TIED)', ui: '#555555', open: true,
    radio: ['WARRANTY: VOID', 'AISLE 7: CLEAN-UP', 'DO NOT RIDE THE CART'],
    extras: ['soda', 'receipt'],
  },
  scoop: {
    dash: 0xffffff, trim: 0x55ffff, wheel: 0x00aaaa, brand: 'SCOOP SYSTEMS', ui: '#00aaaa',
    radio: ['JINGLE: ON (CANNOT BE TURNED OFF)', 'NOW PLAYING: THE JINGLE (AGAIN)', 'SPRINKLES: CRITICAL'],
    extras: ['cones', 'jingle'],
  },
  monster: {
    dash: 0x000000, trim: 0xffff55, wheel: 0x000000, brand: 'POUNDER VISION', ui: '#000000', cage: true,
    radio: ['SUNDAY! SUNDAY! SUNDAY!', 'TORQUE: YES', 'LOUD MODE: LOUDER'],
    extras: ['flames', 'skull'],
  },
  limo: {
    dash: 0x000000, trim: 0xffff55, wheel: 0x555555, brand: 'LIMO LUXE ENTERTAINMENT', ui: '#0000aa',
    radio: ['NOW PLAYING: SMOOTH JAZZ (SMOOTHER)', 'PROM MODE ENGAGED', 'CHAMPAGNE LEVEL: LOW'],
    extras: ['disco', 'champagne', 'neon'],
  },
  weenie: {
    dash: 0xffff55, trim: 0xff5555, wheel: 0xaa5500, brand: 'WEENIE-TRONIC', ui: '#aa5500',
    radio: ['RELISH THE MOMENT', 'MUSTARD LEVEL: OPTIMAL', 'NOW PLAYING: HOT DOG STAND-UP'],
    extras: ['condiments', 'bobble'],
  },
  bus: {
    dash: 0x00aa00, trim: 0x000000, wheel: 0x000000, brand: 'BUS-O-MATIC 1987', ui: '#00aa00',
    radio: ['NO SHOUTING ON THE BUS', 'ARE WE THERE YET? NO.', 'SOMEONE IS STANDING UP'],
    extras: ['apple', 'drawings', 'stopsign'],
  },
};

// Where the windscreen meets the dash, along the car (local x), by body style.
function windshieldX(spec) {
  const L = spec.length, st = spec.look ? 'food' : spec.style;
  switch (st) {
    case 'hatch': return 0.155 * L;
    case 'limo': return 0.3 * L;
    case 'pickup': return 0.23 * L;
    case 'van': case 'truck': case 'bus': return L / 2 - 0.12;
    case 'monster': return -0.1 + 0.225 * L;
    case 'weenie': return 0.3 * L + 0.3;
    case 'kart': return 0.3 * L;
    case 'food': return 0.22 * L;
    default: return 0.2 * L;
  }
}

/**
 * Builds the cabin for a vehicle. Returns the group (in the car's local
 * frame, ground at y = 0) plus the bits that move, the eye position, the
 * screen and the backup camera.
 */
export function buildInterior(spec, color, accent, leftHand) {
  const th = THEMES[spec.id] || THEMES.bean;
  const g = new THREE.Group();
  const L = spec.length, W = spec.width, H = spec.height;
  const r = spec.wheelRadius || 0.32;
  const ride = spec.style === 'monster' ? r * 1.2 : r + 0.05;
  const big = spec.style === 'bus' || spec.style === 'van' || spec.style === 'truck';
  const xw = windshieldX(spec);
  const eyeY = H - Math.min(0.5, Math.max(0.2, 0.22 * (H - ride))) + (th.open ? 0.05 : 0);
  const yd = eyeY - (big ? 0.5 : 0.42);                // top of the dash
  const zd = (leftHand ? 1 : -1) * W * 0.22;           // the driver's side (left when keeping right)
  const xe = xw - (big ? 1.5 : 1.35);                 // eye, behind the wheel
  const roofY = th.open ? null : H - 0.04;
  const add = (...ms) => { ms.forEach((m) => g.add(m)); return ms[0]; };
  const anim = { danglers: [], bobbles: [], spinners: [] };

  // the bit of bonnet you can see over the dash
  if (!big && !th.open) add(box(Math.max(0.3, L / 2 - xw), 0.05, W * 0.96, color, xw + (L / 2 - xw) / 2, yd - 0.06, 0));
  // dashboard
  const dd = big ? 0.55 : 0.62;
  add(box(dd, 0.34, W * (th.open ? 0.5 : 0.94), th.dash, xw - dd / 2, yd - 0.17, 0));
  add(box(0.05, 0.05, W * (th.open ? 0.52 : 0.95), th.trim, xw - dd + 0.02, yd + 0.01, 0)); // padded lip
  // floor, footwell and the passenger seat
  add(box(xw - xe + 0.6, 0.08, W * 0.9, EGA.dgray, (xw + xe) / 2 - 0.3, ride + 0.12, 0));
  add(box(0.08, yd - ride - 0.3, W * 0.9, EGA.black, xw - dd + 0.04, ride + (yd - ride - 0.3) / 2 + 0.1, 0));
  add(box(0.55, 0.14, 0.5, th.trim === EGA.black ? EGA.dgray : th.trim, xe + 0.05, ride + 0.38, -zd), box(0.12, 0.6, 0.5, th.trim === EGA.black ? EGA.dgray : th.trim, xe - 0.25, ride + 0.7, -zd));
  // instrument binnacle behind the wheel
  add(box(0.2, 0.12, 0.42, EGA.black, xw - dd + 0.12, yd + 0.04, zd));
  add(box(0.02, 0.08, 0.34, EGA.lgreen, xw - dd + 0.02, yd + 0.05, zd, { basic: true }));
  if (!th.open) {
    // doors, up to the window line
    for (const s of [1, -1]) add(box(2.2, yd - ride, 0.08, color, xe + 0.2, ride + (yd - ride) / 2, s * (W / 2 - 0.04)));
    for (const s of [1, -1]) add(box(2.2, 0.05, 0.12, th.trim, xe + 0.2, yd, s * (W / 2 - 0.06)));
    // A-pillars, roof, mirror
    const rise = roofY - yd, lean = big ? 0.12 : 0.45;
    for (const s of [1, -1]) {
      const p = add(box(0.09, Math.hypot(rise, lean), 0.09, th.cage ? EGA.yellow : color, xw - lean / 2, yd + rise / 2, s * W * 0.45));
      p.rotation.z = Math.atan2(lean, rise);
    }
    add(box(1.4, 0.06, W * 0.96, th.cage ? EGA.dgray : EGA.lgray, xw - lean - 0.7, roofY, 0));
    add(box(0.12, 0.05, W * 0.96, color, xw - lean, roofY - 0.02, 0));
    add(box(0.03, 0.07, 0.26, EGA.dgray, xw - lean - 0.12, roofY - 0.12, -zd * 0.3), box(0.02, 0.05, 0.22, EGA.lcyan, xw - lean - 0.135, roofY - 0.12, -zd * 0.3, { basic: true }));
    add(box(0.02, 0.1, 0.02, EGA.dgray, xw - lean - 0.12, roofY - 0.06, -zd * 0.3));
    // wing mirrors, just out of the side windows
    for (const s of [1, -1]) add(box(0.12, 0.14, 0.2, color, xw - 0.15, yd + 0.12, s * (W / 2 + 0.1)), box(0.02, 0.1, 0.16, EGA.lcyan, xw - 0.22, yd + 0.12, s * (W / 2 + 0.1), { basic: true }));
    if (th.cage) {
      add(box(0.08, 0.08, W * 0.9, EGA.yellow, xw - 0.3, roofY - 0.15, 0));
      for (const s of [1, -1]) add(box(1.2, 0.08, 0.08, EGA.yellow, xw - 0.9, roofY - 0.15, s * W * 0.44));
    }
  }

  // the steering wheel (turns with the front wheels)
  const wheel = new THREE.Group();
  const wr = spec.style === 'bus' ? 0.27 : th.open ? 0.16 : 0.19;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wr, 0.032, 6, 14), mat(th.wheel));
  wheel.add(rim);
  wheel.add(box(0.1, 0.1, 0.05, th.trim, 0, 0, 0));
  for (const a of [0, 2.1, -2.1]) { const sp = box(0.03, wr, 0.03, EGA.dgray, Math.sin(a) * wr / 2, -Math.cos(a) * wr / 2, 0); sp.rotation.z = a; wheel.add(sp); }
  const tilt = new THREE.Group();
  tilt.add(wheel);
  tilt.rotation.y = -Math.PI / 2;                        // face the driver
  tilt.rotation.order = 'YXZ';
  tilt.rotation.x = spec.style === 'bus' ? -1.0 : -0.35; // a bus wheel lies nearly flat
  tilt.position.set(xw - dd - 0.12, yd - 0.02, zd);
  add(tilt);
  add(box(0.4, 0.06, 0.06, EGA.dgray, xw - dd + 0.08, yd - 0.08, zd)).rotation.z = -0.4; // column
  // gear selector between the seats
  add(box(0.3, 0.15, 0.2, EGA.black, xe + 0.15, ride + 0.45, 0), box(0.04, 0.22, 0.04, EGA.dgray, xe + 0.2, ride + 0.62, 0));
  const knob = add(box(0.08, 0.08, 0.08, spec.id === 'monster' ? EGA.white : th.trim, xe + 0.2, ride + 0.75, 0));

  // the screen, on a stalk in the middle of the dash, angled at the driver
  const sw = spec.style === 'limo' ? 0.62 : spec.style === 'bus' ? 0.34 : th.open ? 0.4 : 0.52;
  const sh = sw * 0.62;
  const screen = new THREE.Group();
  screen.add(box(0.03, sh + 0.05, sw + 0.05, EGA.black, 0.017, 0, 0));
  const feedRT = new THREE.WebGLRenderTarget(FEED_W, FEED_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const feedRect = { y0: 0.13, y1: 0.88 }; // canvas rows (from the top) the picture fills
  const fh = sh * (feedRect.y1 - feedRect.y0);
  const feedGeo = new THREE.PlaneGeometry(sw, fh).translate(0, sh * (0.5 - (feedRect.y0 + feedRect.y1) / 2), 0);
  // backup cameras show a mirror image, so the left of the screen is your left
  const uv = feedGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const feed = new THREE.Mesh(feedGeo, new THREE.MeshBasicMaterial({ map: feedRT.texture }));
  feed.rotation.y = -Math.PI / 2;
  screen.add(feed);
  const ui = document.createElement('canvas');
  ui.width = UI_W; ui.height = UI_H;
  const uiTex = new THREE.CanvasTexture(ui);
  uiTex.magFilter = uiTex.minFilter = THREE.NearestFilter;
  uiTex.colorSpace = THREE.SRGBColorSpace;
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: uiTex, transparent: true }));
  overlay.rotation.y = -Math.PI / 2;
  overlay.position.x = -0.004;
  screen.add(overlay);
  const sx = xw - dd + 0.06, sy = yd + sh / 2 + 0.06, sz = th.open ? zd + (leftHand ? -1 : 1) * 0.02 : zd * 0.12;
  screen.position.set(th.open ? sx - 0.12 : sx, th.open ? yd + sh / 2 + 0.12 : sy, sz);
  // face the eye
  screen.rotation.order = 'YXZ';
  screen.rotation.y = Math.atan2(zd - sz, sx - xe) * 0.9;
  screen.rotation.z = -0.18;
  add(screen);
  if (!th.open) add(box(0.06, 0.08, 0.06, EGA.dgray, sx + 0.02, yd + 0.04, sz));
  else add(box(0.05, 0.05, 0.4, EGA.black, sx - 0.12, yd + 0.1, sz)); // zip ties, technically

  // ---- the knick-knacks ----
  const dashTop = (x, z) => [x, yd + 0.02, z];
  const passenger = -zd;
  const lean = big ? 0.12 : 0.45;
  for (const ex of th.extras) {
    if (ex === 'dice' && roofY) {
      add(box(0.3, 0.03, 0.42, EGA.lgray, xw - lean - 0.2, roofY - 0.05, -zd * 1.05)); // sun visor, folded up
      for (const s of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(xw - lean - 0.2, roofY - 0.07, -zd * 1.05 + s * 0.05);
        piv.add(box(0.005, 0.16, 0.005, EGA.white, 0, -0.08, 0));
        const die = box(0.07, 0.07, 0.07, EGA.lmagenta, 0, -0.19, 0);
        die.rotation.set(0.4 * s, 0.3, 0.2);
        piv.add(die);
        for (const [dx, dz] of [[0.036, 0], [0, 0.036]]) piv.add(box(dx ? 0.005 : 0.02, 0.02, dz ? 0.005 : 0.02, EGA.white, dx, -0.19, dz, { basic: true }));
        add(piv);
        anim.danglers.push({ g: piv, ax: 0, az: 0, vx: 0, vz: 0, len: 0.2 });
      }
    }
    if (ex === 'tree' && roofY) {
      const piv = new THREE.Group();
      piv.position.set(xw - lean - 0.12, roofY - 0.2, -zd * 0.3);
      const tri = box(0.01, 0.12, 0.08, EGA.green, 0, -0.1, 0);
      piv.add(box(0.004, 0.04, 0.004, EGA.white, 0, -0.02, 0), tri, box(0.012, 0.08, 0.05, EGA.lgreen, 0, -0.08, 0));
      add(piv);
      anim.danglers.push({ g: piv, ax: 0, az: 0, vx: 0, vz: 0, len: 0.12 });
    }
    if (ex === 'bobble') {
      const base = new THREE.Group();
      base.position.set(...dashTop(xw - 0.18, zd + (leftHand ? -1 : 1) * 0.22));
      const body = spec.id === 'weenie' ? EGA.lred : EGA.blue;
      base.add(box(0.07, 0.03, 0.07, EGA.black, 0, 0.015, 0), box(0.05, 0.08, 0.06, body, 0, 0.07, 0));
      const head = new THREE.Group();
      head.position.y = 0.12;
      if (spec.id === 'weenie') {
        head.add(box(0.05, 0.12, 0.05, EGA.lred, 0, 0.06, 0), box(0.03, 0.01, 0.06, EGA.yellow, 0.026, 0.08, 0, { basic: true }));
      } else {
        head.add(box(0.1, 0.1, 0.1, 0xffaa55, 0, 0.05, 0), box(0.01, 0.02, 0.02, EGA.black, -0.05, 0.07, 0.02), box(0.01, 0.02, 0.02, EGA.black, -0.05, 0.07, -0.02));
        head.add(box(0.11, 0.03, 0.11, EGA.yellow, 0, 0.1, 0)); // hair, sort of
      }
      base.add(head);
      add(base);
      anim.bobbles.push({ g: head, ax: 0, az: 0, vx: 0, vz: 0 });
    }
    if (ex === 'pizzas') {
      for (let k = 0; k < 3; k++) {
        const pz = box(0.38, 0.05, 0.38, EGA.white, ...dashTop(xw - 0.25, passenger));
        pz.position.y += 0.03 + k * 0.055;
        pz.rotation.y = (k - 1) * 0.12;
        add(pz);
      }
      const lid = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: textTexture('ZA', { w: 64, h: 64, size: 26, bg: '#ffffff', fg: '#aa0000', border: '#aa0000' }) }));
      lid.rotation.x = -Math.PI / 2;
      lid.rotation.z = Math.PI / 2;
      lid.position.set(xw - 0.25, yd + 0.2, passenger);
      add(lid);
    }
    if (ex === 'pepperoni') {
      const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 10), mat(EGA.red));
      pep.position.set(...dashTop(xw - 0.12, zd + (leftHand ? -1 : 1) * 0.3));
      add(pep);
      anim.spinners.push({ g: pep, rate: 1.5 });
    }
    if (ex === 'timer') {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: textTexture('29:59', { w: 96, h: 36, size: 16, bg: '#000000', fg: '#ff5555', border: null }) }));
      t.rotation.y = -Math.PI / 2;
      t.rotation.z = -0.3;
      t.position.set(xw - dd + 0.05, yd + 0.06, zd + (leftHand ? 1 : -1) * 0.25);
      add(t);
    }
    if (ex === 'soda') {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 8), mat(EGA.lred));
      cup.position.set(xe + 0.45, ride + 0.55, -zd * 0.6);
      add(cup, box(0.01, 0.12, 0.01, EGA.white, xe + 0.45, ride + 0.68, -zd * 0.6));
    }
    if (ex === 'receipt') {
      const piv = new THREE.Group();
      piv.position.set(sx - 0.1, yd + 0.05, sz + 0.25);
      piv.add(box(0.01, 0.4, 0.08, EGA.white, 0, -0.18, 0, { basic: true }));
      add(piv);
      anim.danglers.push({ g: piv, ax: 0, az: 0, vx: 0, vz: 0, len: 0.4 });
    }
    if (ex === 'cones') {
      for (let k = 0; k < 4; k++) {
        const z = passenger + (k - 1.5) * 0.12;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), mat(EGA.brown));
        cone.rotation.x = Math.PI;
        cone.position.set(xw - 0.2, yd + 0.08, z);
        const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), mat([EGA.lmagenta, EGA.white, 0xaa5500, EGA.lgreen][k]));
        scoop.position.set(xw - 0.2, yd + 0.16, z);
        add(cone, scoop);
      }
    }
    if (ex === 'jingle') {
      add(box(0.1, 0.05, 0.1, EGA.lgray, xw - 0.35, yd + 0.03, -0.02));
      add(box(0.06, 0.04, 0.06, EGA.lred, xw - 0.35, yd + 0.07, -0.02, { basic: true }));
    }
    if (ex === 'flames') {
      for (let k = 0; k < 7; k++) {
        const f = box(0.1, 0.005, 0.07, k % 2 ? 0xff8800 : EGA.lred, xw - 0.12 - (k % 3) * 0.05, yd + 0.035, -W * 0.4 + k * W * 0.13, { basic: true });
        f.rotation.y = 0.4;
        add(f);
      }
    }
    if (ex === 'skull') {
      add(box(0.09, 0.09, 0.09, EGA.white, xe + 0.2, ride + 0.8, 0), box(0.01, 0.02, 0.02, EGA.black, xe + 0.245, ride + 0.81, 0.02), box(0.01, 0.02, 0.02, EGA.black, xe + 0.245, ride + 0.81, -0.02));
      knob.visible = false;
      const base = new THREE.Group();
      base.position.set(...dashTop(xw - 0.2, passenger));
      const head = new THREE.Group();
      head.position.y = 0.08;
      head.add(box(0.11, 0.11, 0.12, EGA.white, 0, 0.05, 0), box(0.01, 0.03, 0.03, EGA.black, -0.056, 0.06, 0.03), box(0.01, 0.03, 0.03, EGA.black, -0.056, 0.06, -0.03));
      base.add(box(0.04, 0.08, 0.04, EGA.dgray, 0, 0.04, 0), head);
      add(base);
      anim.bobbles.push({ g: head, ax: 0, az: 0, vx: 0, vz: 0 });
    }
    if (ex === 'disco' && roofY) {
      const ball = new THREE.Group();
      ball.position.set(xw - lean - 0.15, roofY - 0.2, -zd * 0.9);
      for (let i = 0; i < 26; i++) {
        const a = i * 2.4, y = (i / 26 - 0.5) * 0.18;
        const rr = Math.sqrt(Math.max(0, 0.0081 - y * y));
        ball.add(box(0.035, 0.035, 0.035, i % 3 ? EGA.white : EGA.lcyan, Math.cos(a) * rr, y, Math.sin(a) * rr, { basic: true }));
      }
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), mat(EGA.lgray)));
      add(ball, box(0.005, 0.12, 0.005, EGA.white, xw - lean - 0.15, roofY - 0.08, -zd * 0.9));
      anim.spinners.push({ g: ball, rate: 1.2 });
    }
    if (ex === 'champagne') {
      const z = passenger;
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.15, 10), mat(EGA.lgray));
      bucket.position.set(xw - 0.3, yd + 0.09, z);
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.26, 8), mat(EGA.green));
      bottle.position.set(xw - 0.3, yd + 0.2, z);
      bottle.rotation.z = 0.3;
      add(bucket, bottle, box(0.03, 0.04, 0.03, EGA.yellow, xw - 0.34, yd + 0.33, z));
    }
    if (ex === 'neon') {
      add(box(0.02, 0.02, W * 0.9, EGA.lmagenta, xw - dd + 0.01, yd - 0.1, 0, { basic: true }));
      add(box(1.5, 0.02, 0.02, EGA.lmagenta, xe, ride + 0.2, W * 0.44, { basic: true }), box(1.5, 0.02, 0.02, EGA.lmagenta, xe, ride + 0.2, -W * 0.44, { basic: true }));
    }
    if (ex === 'condiments') {
      for (const [c, dz] of [[EGA.lred, 0], [EGA.yellow, 0.1]]) {
        add(box(0.06, 0.16, 0.06, c, xe + 0.4, ride + 0.6, -zd * 0.5 + dz), box(0.02, 0.05, 0.02, c, xe + 0.4, ride + 0.71, -zd * 0.5 + dz));
      }
    }
    if (ex === 'apple') {
      const ap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(EGA.lred));
      ap.position.set(...dashTop(xw - 0.2, passenger));
      ap.position.y += 0.06;
      add(ap, box(0.01, 0.04, 0.01, EGA.brown, xw - 0.2, yd + 0.14, passenger));
    }
    if (ex === 'drawings') {
      ['#ffff55', '#55ffff', '#ff55ff'].forEach((c, k) => {
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.14), new THREE.MeshBasicMaterial({
          map: textTexture(['MY BUS', 'MR DRIVER', 'VROOM'][k], { w: 96, h: 72, size: 12, bg: c, fg: '#aa0000', border: '#000000' }), side: THREE.DoubleSide,
        }));
        pic.rotation.y = -Math.PI / 2;
        pic.rotation.x = (k - 1) * 0.15;
        pic.position.set(xw - 0.02, yd + 0.1, passenger + (k - 1) * 0.22);
        add(pic);
      });
    }
    if (ex === 'stopsign') {
      add(box(0.05, 0.25, 0.05, EGA.dgray, xe + 0.45, ride + 0.6, -zd * 0.5), box(0.06, 0.08, 0.08, EGA.lred, xe + 0.45, ride + 0.76, -zd * 0.5, { basic: true }));
    }
  }
  if (spec.look) {
    // the lunch-box fleet: condiments come as standard
    add(box(0.04, 0.09, 0.04, EGA.white, ...dashTop(xw - 0.12, passenger + 0.3)), box(0.04, 0.09, 0.04, EGA.dgray, ...dashTop(xw - 0.12, passenger + 0.36)));
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });

  // The backup camera: just above the rear bumper, pointing back and down.
  const camY = Math.min(H * 0.6, ride + (big ? 1.0 : 0.6));
  const rearCam = new THREE.PerspectiveCamera(72, sw / fh, 0.05, 120);
  const camLocal = new THREE.Vector3(-L / 2 - 0.05, camY, 0);
  const camAim = new THREE.Vector3(-L / 2 - 4, camY - 2.0, 0);

  return {
    group: g, theme: th, anim, wheel, screen, feedRT, ui, uiTex, rearCam, camLocal, camAim,
    eye: new THREE.Vector3(xe, eyeY, zd), look: new THREE.Vector3(xe + 6, eyeY - 1.25, zd * 0.4),
    screenPos: new THREE.Vector3(sx, sy, sz), feedRect,
    ticker: 0, tick: 0,
  };
}

/** Moves the knick-knacks: dice swing, heads bobble, disco balls spin. */
export function animateInterior(it, car, dt, accel) {
  it.wheel.rotation.z = -car.steer / car.spec.maxSteer * 2.6;
  const k = 70, c = 4.5;
  for (const d of it.anim.danglers) {
    // a pendulum: kicked backward by acceleration, sideways by cornering
    d.vx += (-k * d.ax - c * d.vx - accel.fwd * 9) * dt;
    d.vz += (-k * d.az - c * d.vz + accel.side * 9) * dt;
    d.ax += d.vx * dt; d.az += d.vz * dt;
    d.g.rotation.z = THREE.MathUtils.clamp(d.ax, -1, 1);
    d.g.rotation.x = THREE.MathUtils.clamp(d.az, -1, 1);
  }
  for (const b of it.anim.bobbles) {
    b.vx += (-160 * b.ax - 3 * b.vx - accel.fwd * 14 + accel.up * 3) * dt;
    b.vz += (-160 * b.az - 3 * b.vz + accel.side * 14) * dt;
    b.ax += b.vx * dt; b.az += b.vz * dt;
    b.g.rotation.z = THREE.MathUtils.clamp(b.ax, -0.8, 0.8);
    b.g.rotation.x = THREE.MathUtils.clamp(b.az, -0.8, 0.8);
  }
  for (const s of it.anim.spinners) s.g.rotation.y += s.rate * dt;
}

/**
 * Redraws the screen: the brand bar, guide lines projected through the
 * backup camera, the parking sensor, and the radio ticker.
 * sensor: { left, mid, right } distances (m) behind the bumper.
 */
export function drawScreen(it, car, sensor, time) {
  const g = it.ui.getContext('2d');
  const W = UI_W, H = UI_H, th = it.theme;
  const fr = it.feedRect;
  const fy0 = fr.y0 * H, fy1 = fr.y1 * H;
  g.clearRect(0, 0, W, H);
  const css = (c) => remapCss(c);
  // the bars
  g.fillStyle = css(th.ui);
  g.fillRect(0, 0, W, fy0);
  g.fillRect(0, fy1, W, H - fy1);
  g.font = '12px "Press Start 2P", monospace';
  g.textBaseline = 'middle';
  g.fillStyle = css('#ffffff');
  g.textAlign = 'left';
  g.fillText(th.brand.split(' ')[0], 6, fy0 / 2 + 1);
  g.textAlign = 'right';
  g.fillStyle = css(car.gear === 'R' ? '#ffff55' : '#ffffff');
  g.fillText(car.gear === 'R' ? 'R CAM' : 'CAM', W - 6, fy0 / 2 + 1);
  // ticker
  const msgs = [...th.radio, 'OBJECTS ON SCREEN ARE JUDGING YOU'];
  const msg = msgs[Math.floor(time / 6) % msgs.length];
  g.font = '11px "Press Start 2P", monospace';
  g.textAlign = 'left';
  g.fillStyle = css('#ffff55');
  const tw = g.measureText(msg).width;
  const off = ((time * 60) % (tw + W)) - tw;
  g.fillText(msg, W - off - tw, (fy1 + H) / 2 + 1);

  // guide lines: where the corners of the back of the car will go, reversing at this steering angle
  const cam = it.rearCam;
  const s = car.spec, b = car.body;
  const ahead = centreAhead(s);
  const curv = Math.tan(car.steer) / s.wheelbase; // turning rate per metre
  const proj = new THREE.Vector3();
  const toScreen = (x, z) => {
    proj.set(x, 0.02, z).project(cam);
    if (proj.z > 1 || proj.z < -1) return null;
    return [(1 - (proj.x * 0.5 + 0.5)) * W, fy0 + (1 - (proj.y * 0.5 + 0.5)) * (fy1 - fy0)];
  };
  const pathPt = (dist, side) => {
    // rear axle travels backward along an arc; corners ride along with it
    const a0 = b.a;
    const da = -dist * curv;
    let rx, rz;
    const ca = Math.cos(a0), sa = Math.sin(a0);
    const axX = b.x - ca * ahead, axZ = b.z - sa * ahead;
    if (Math.abs(curv) < 1e-4) { rx = axX - ca * dist; rz = axZ - sa * dist; } else {
      rx = axX + (Math.sin(a0 + da) - Math.sin(a0)) / curv;
      rz = axZ - (Math.cos(a0 + da) - Math.cos(a0)) / curv;
    }
    const a = a0 + da, back = s.length / 2 - ahead; // rear overhang
    const hw = s.width / 2;
    return [rx - Math.cos(a) * back - Math.sin(a) * side * hw, rz - Math.sin(a) * back + Math.cos(a) * side * hw];
  };
  g.save();
  g.beginPath(); g.rect(0, fy0, W, fy1 - fy0); g.clip();
  g.lineWidth = 3;
  const bands = [[0, 1, '#ff5555'], [1, 2, '#ffff55'], [2, 4, '#55ff55']];
  for (const side of [1, -1]) {
    for (const [d0, d1, col] of bands) {
      g.strokeStyle = css(col);
      g.beginPath();
      let started = false;
      for (let dd = d0; dd <= d1 + 1e-6; dd += 0.25) {
        const p = toScreen(...pathPt(dd, side));
        if (!p) { started = false; continue; }
        if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]);
      }
      g.stroke();
    }
  }
  // distance ticks across the path at 1m and 2m
  for (const [dd, col] of [[1, '#ff5555'], [2, '#ffff55']]) {
    const p = toScreen(...pathPt(dd, 1)), q = toScreen(...pathPt(dd, -1));
    if (!p || !q) continue;
    g.strokeStyle = css(col);
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + (q[0] - p[0]) * 0.18, p[1] + (q[1] - p[1]) * 0.18);
    g.moveTo(q[0], q[1]); g.lineTo(q[0] + (p[0] - q[0]) * 0.18, q[1] + (p[1] - q[1]) * 0.18); g.stroke();
  }
  g.restore();

  // parking sensor: three blocks across the top of the picture (mirrored like the image)
  const zone = (dist) => (dist < 0.4 ? '#ff5555' : dist < 1.0 ? '#ff5555' : dist < 1.8 ? '#ffff55' : dist < 3 ? '#55ff55' : null);
  const near = Math.min(sensor.left, sensor.mid, sensor.right);
  const cells = [[sensor.right, 0], [sensor.mid, 1], [sensor.left, 2]];
  for (const [dist, i] of cells) {
    const col = zone(dist);
    const x = W * 0.22 + i * W * 0.19;
    if (!col || (dist < 0.4 && Math.floor(time * 8) % 2)) continue;
    g.fillStyle = css('#000000');
    g.fillRect(x - 2, fy0 + 3, W * 0.18 + 4, 14);
    g.fillStyle = css(col);
    const bars = dist < 1 ? 3 : dist < 1.8 ? 2 : 1;
    for (let k = 0; k < bars; k++) g.fillRect(x + k * (W * 0.062), fy0 + 5, W * 0.055, 10);
  }
  if (near < 3) {
    g.textAlign = 'center';
    g.font = '20px "Press Start 2P", monospace';
    g.fillStyle = css('#000000');
    g.fillRect(W / 2 - 64, fy1 - 30, 128, 28);
    g.fillStyle = css(near < 0.4 ? '#ff5555' : '#ffffff');
    g.fillText(near < 0.3 ? 'STOP!' : `${near.toFixed(1)}M`, W / 2, fy1 - 15);
  }
  // the classic small print
  it.uiTex.needsUpdate = true;
}

