import { NPC_CARS, NPC_COLORS } from './vehicles.js';
import { surfaceGrip } from './mods.js';

export const CURB = 6.5;          // |z| of the curb line
export const SIDEWALK = 4.0;      // sidewalk depth
export const SIDEWALK_H = 0.18;   // curb height
export const LANE = 2.1;          // |z| of each travel lane centre
export const PARK_GAP = 0.3;      // how far parked cars sit off the curb
export const BUILDING_DEPTH = 10;
// Building damage: first hard hit smashes the shopfront, enough damage collapses it.
export const BUILDING_FACADE_HIT = 3;
export const BUILDING_COLLAPSE = 220;

// Extra space in the target spot beyond the player's own length.
export const DIFFICULTIES = [
  { id: 'easy', name: 'EASY', margin: 3.0, mult: 0.5, blurb: 'A whole bus could fit. Probably.' },
  { id: 'normal', name: 'NORMAL', margin: 2.0, mult: 1, blurb: 'A regular, honest parking spot.' },
  { id: 'hard', name: 'HARD', margin: 1.45, mult: 1.6, blurb: 'Breathe in. Everybody breathe in.' },
  { id: 'insane', name: 'INSANE', margin: 1.15, mult: 2.5, blurb: 'Physics has filed a complaint.' },
];

// Wreck mode jump. Profile is a curve up to `theta` radians, then straight to the lip.
export const RAMP = { len: 6, z0: -3, z1: 3, theta: 0.45, R: 8 };

export const PROPS = {
  meter: { hl: 0.13, hw: 0.13, h: 1.3, breakSpeed: 1.2, value: 200, name: 'PARKING METER' },
  hydrant: { hl: 0.22, hw: 0.22, h: 0.8, breakSpeed: 2.2, value: 800, name: 'FIRE HYDRANT' },
  mailbox: { hl: 0.3, hw: 0.28, h: 1.2, breakSpeed: 1.8, value: 350, name: 'MAILBOX' },
  trash: { hl: 0.3, hw: 0.3, h: 1.0, breakSpeed: 1.2, value: 150, name: 'TRASH CAN' },
  lamp: { hl: 0.16, hw: 0.16, h: 6, breakSpeed: 2.8, value: 1500, name: 'LAMP POST', topple: true },
  bench: { hl: 0.9, hw: 0.3, h: 0.9, breakSpeed: 2.0, value: 400, name: 'BENCH' },
  newsbox: { hl: 0.25, hw: 0.25, h: 1.1, breakSpeed: 1.2, value: 120, name: 'NEWSPAPER BOX' },
  tree: { hl: 0.25, hw: 0.25, h: 7, breakSpeed: 3.0, value: 2000, name: 'TREE (A WHOLE TREE)', topple: true },
  cone: { hl: 0.2, hw: 0.2, h: 0.7, breakSpeed: 0.2, value: 25, name: 'TRAFFIC CONE' },
  crate: { hl: 0.5, hw: 0.5, h: 1.0, breakSpeed: 0.8, value: 60, name: 'CRATE' },
  sawhorse: { hl: 0.2, hw: 1.0, h: 1.0, breakSpeed: 0.8, value: 100, name: 'BARRIER' },
  fruit: { hl: 1.25, hw: 0.6, h: 1.3, breakSpeed: 1.5, value: 900, name: 'FRUIT STAND' },
  booth: { hl: 0.5, hw: 0.5, h: 2.4, breakSpeed: 3.0, value: 1200, name: 'PHONE BOOTH' },
  portaloo: { hl: 0.6, hw: 0.6, h: 2.3, breakSpeed: 1.6, value: 700, name: 'PORTABLE TOILET (OCCUPIED)' },
  statue: { hl: 0.7, hw: 0.7, h: 3.7, breakSpeed: 3.5, value: 9000, name: 'STATUE OF THE MAYOR' },
};

const SHOPS = [
  'WHIPLASH & SONS LAW', 'DENTS R US', 'DONUT TURN LEFT', 'BLIND SPOT OPTICIANS',
  'SPINE & DANDY CHIRO', 'ACT OF GOD INSURANCE', 'CRASH COURSE DRIVING', 'SKID MARKS LAUNDRY',
  'BE KIND REWIND VIDEO', 'BAIL BONDS & BAGELS', 'SMASH & FIX GLASS', 'DMV: TAKE A NUMBER',
  'BUMPER EMPORIUM', 'NECK BRACES 4 LESS', 'NO REFUNDS PAWN', 'CURB APPEAL REALTY',
  'TOW-TALLY TACOS', 'LEANING TOWER OF PIZZA', 'DOUBLE PARKED PUB', 'NEUTRAL GROUNDS CAFE',
  'SECOND GEAR THRIFT', 'TIGHT SPOT YOGA', 'CRUMPLE ZONE CAKES', 'PARALLEL UNIVERSE COMICS',
  'SMALL CLAIMS SUSHI', 'HONK IF HUNGRY DINER', 'BACK IN 5 MINUTES', 'METER MAID MANICURES',
  'FENDER BENDER BURGERS', 'HEAD ON HAIR SALON', 'TAILGATE TAILORS', 'PANIC STATIONS ARCADE',
];
const BUILDING_COLORS = [0xaa5500, 0xaa00aa, 0x00aaaa, 0x5555ff, 0xaa0000, 0x00aa00, 0x555555, 0xff55ff];

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/**
 * Builds a level description (plain data, no physics or graphics).
 * mode: 'test' | 'race' | 'wreck'
 * mods: array of modifier ids (see mods.js)
 * margin: overrides the difficulty's spare room (used by the Valet Shift)
 */
export function buildLevel({ mode, difficulty = 'normal', vehicle, seed = Date.now(), mods = [], margin }) {
  const r = rng(seed);
  const diff = DIFFICULTIES.find((d) => d.id === difficulty) || DIFFICULTIES[1];
  const modSet = new Set(mods);
  const hidden = modSet.has('hidden') && mode === 'test';
  const xMin = mode === 'wreck' ? -120 : -70;
  const xMax = mode === 'wreck' ? 140 : 90;
  const level = {
    mode, difficulty: diff, curbZ: CURB, xMin, xMax, seed,
    mods: modSet, grip: surfaceGrip(modSet),
    parked: [], props: [], buildings: [], walls: [], spots: [],
    playerStart: { x: -22, z: LANE, a: 0 },
    aiStart: null,
    traffic: [], peds: 0,
  };

  const spotX = 15;
  const spare = (margin ?? diff.margin) + (vehicle.extraRoom || 0);
  const spotLen = vehicle.length + spare;

  const npc = () => {
    const t = pick(r, NPC_CARS);
    return { ...t, color: pick(r, NPC_COLORS) };
  };

  // Lines parked cars along one curb, leaving the given gaps ({x, len, owner})
  // exactly open. dir = +1 for the +z curb (traffic heading +x).
  const lineCurb = (dir, gaps) => {
    const zc = dir * (CURB - PARK_GAP);
    const add = (c, cx) => {
      level.parked.push({ ...c, x: cx, z: zc - dir * c.width / 2, a: dir > 0 ? 0 : Math.PI });
      return level.parked.length - 1;
    };
    const lo = xMin + 8, hi = xMax - 8;
    const sorted = [...gaps].sort((a, b) => a.x - b.x);
    // Segments of curb between gaps. The car on each side of a gap sits flush
    // against it, so the gap is exactly as wide as advertised.
    const segments = [];
    let start = lo, prev = null;
    for (const g of sorted) {
      segments.push({ s0: start, s1: g.x - g.len / 2, before: prev, after: g });
      start = g.x + g.len / 2;
      prev = g;
    }
    segments.push({ s0: start, s1: hi, before: prev, after: null });
    for (const seg of segments) {
      let x0 = seg.s0, x1 = seg.s1;
      if (seg.before) { const c = npc(); seg.before.hiIdx = add(c, x0 + c.length / 2); x0 += c.length; }
      if (seg.after) { const c = npc(); seg.after.loIdx = add(c, x1 - c.length / 2); x1 -= c.length; }
      let x = x0;
      while (true) {
        const c = npc();
        // Normal spacing, or a decoy gap: tempting, but shorter than your car.
        let gap = 0.9 + r() * 1.5;
        if (mode === 'wreck') { if (r() < 0.25) gap = 6; } else if (r() < 0.14) gap = Math.max(1.6, vehicle.length - 0.5 - r() * 1.0);
        if (x + gap + c.length > x1 - (seg.after ? 0.8 : 0)) break;
        add(c, x + gap + c.length / 2);
        x += gap + c.length;
      }
    }
    for (const g of sorted) {
      level.spots.push({
        dir, cx: g.x, cz: dir * CURB, length: g.len, owner: g.owner,
        frontCar: dir > 0 ? g.hiIdx : g.loIdx, rearCar: dir > 0 ? g.loIdx : g.hiIdx,
      });
    }
  };

  if (mode === 'test') {
    if (hidden) {
      // Several unmarked gaps of different sizes; any of them counts.
      const spares = [0.55, 0.9, 1.4, 2.1, 3.0].map((s) => s + (vehicle.extraRoom || 0));
      for (let i = spares.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [spares[i], spares[j]] = [spares[j], spares[i]]; }
      const gaps = spares.map((s, i) => ({ x: -30 + i * 24 + (r() - 0.5) * 5, len: vehicle.length + s, owner: 'player' }));
      lineCurb(1, gaps);
    } else {
      lineCurb(1, [{ x: spotX, len: spotLen, owner: 'player' }]);
    }
    lineCurb(-1, []);
  } else if (mode === 'race') {
    lineCurb(1, [{ x: spotX, len: spotLen, owner: 'player' }]);
    lineCurb(-1, [{ x: spotX, len: spotLen, owner: 'ai' }]);
    level.aiStart = { x: spotX + (spotX - level.playerStart.x), z: -LANE, a: Math.PI };
  } else {
    lineCurb(1, []);
    lineCurb(-1, []);
    level.playerStart = { x: xMin + 15, z: LANE, a: 0 };
  }
  // The biggest spot is the "primary" one (used for the par and the marker).
  level.spots.sort((a, b) => (a.owner === 'player' ? 0 : 1) - (b.owner === 'player' ? 0 : 1) || b.length - a.length);


  // Sidewalk furniture on both sides.
  for (const dir of [1, -1]) {
    const zc = dir * CURB;
    // parking meters next to every parked car
    for (const p of level.parked) {
      if (Math.sign(p.z) !== dir) continue;
      level.props.push({ type: 'meter', x: p.x + p.length / 2 * 0.9, z: zc + dir * 0.45, a: 0 });
    }
    for (let x = xMin + 6; x < xMax - 6; x += 16) {
      level.props.push({ type: 'lamp', x: x + r() * 2, z: zc + dir * 0.85, a: 0 });
    }
    for (let x = xMin + 12; x < xMax - 6; x += 13) {
      level.props.push({ type: 'tree', x: x + r() * 3, z: zc + dir * 3.0, a: 0 });
    }
    const furniture = ['hydrant', 'mailbox', 'trash', 'bench', 'newsbox', 'trash', 'booth', 'hydrant', 'portaloo'];
    for (let x = xMin + 8; x < xMax - 8; x += 5 + r() * 5) {
      const type = pick(r, furniture);
      const z = type === 'bench' ? zc + dir * 2.2 : zc + dir * (1.5 + r() * 1.0);
      level.props.push({ type, x, z, a: type === 'bench' ? 0 : r() * 6 });
    }
  }

  if (mode === 'wreck') {
    // Things that exist purely to be hit.
    for (let i = 0; i < 9; i++) {
      const cx = xMin + 30 + i * 24 + r() * 6;
      const cz = (r() - 0.5) * 5;
      const kind = i % 3;
      if (kind === 0) { // cone pyramid-ish cluster
        for (let k = 0; k < 9; k++) level.props.push({ type: 'cone', x: cx + (k % 3) * 0.9, z: cz + Math.floor(k / 3) * 0.9, a: 0 });
      } else if (kind === 1) { // crate wall
        for (let k = 0; k < 8; k++) level.props.push({ type: 'crate', x: cx, z: cz - 3.5 + k * 1.02, a: 0 });
      } else { // barrier line
        for (let k = 0; k < 3; k++) level.props.push({ type: 'sawhorse', x: cx + k * 0.8, z: cz + (k - 1) * 2.2, a: 0 });
      }
    }
    for (let k = 0; k < 4; k++) {
      const dir = k % 2 ? 1 : -1;
      level.props.push({ type: 'fruit', x: xMin + 50 + k * 50, z: dir * (CURB + 2.0), a: 0 });
    }
    // The jump: a ramp across both lanes near the far end, run-up cleared.
    const ramp = { ...RAMP, x0: xMax - 58 };
    level.ramp = ramp;
    level.props = level.props.filter((p) => !(Math.abs(p.z) < CURB - 2 && p.x > ramp.x0 - 30 && p.x < ramp.x0 + ramp.len + 4));
    // something to land in
    const lx = ramp.x0 + ramp.len + 16;
    for (let k = 0; k < 12; k++) level.props.push({ type: 'crate', x: lx + (k % 3) * 1.05, z: -1.6 + Math.floor(k / 3) * 1.05, a: 0 });
    for (let k = 0; k < 10; k++) level.props.push({ type: 'cone', x: lx - 8 + (k % 5) * 1.6, z: (k < 5 ? -1 : 1) * 2.4, a: 0 });
    // The mayor, immortalised in bronze, in the middle of a roundabout-ish plaza.
    level.props.push({ type: 'statue', x: xMin + 130, z: 0, a: 0 });
  } else {
    // Roadworks near the end.
    level.props.push({ type: 'sawhorse', x: xMax - 14, z: LANE, a: 0 });
    level.props.push({ type: 'sawhorse', x: xMax - 14, z: -LANE, a: 0 });
  }

  // Moving hazards. (In wreck mode the traffic keeps to the stretch west of the ramp.)
  const laneEnd = level.ramp ? level.ramp.x0 - 8 : undefined;
  if (modSet.has('traffic')) level.traffic.push({ dir: -1, count: mode === 'wreck' ? 4 : 3, speed: mode === 'wreck' ? 7.5 : 6, xMax: laneEnd });
  if (mode === 'wreck') level.traffic.push({ dir: 1, count: 3, speed: 7, xMax: laneEnd });
  if (modSet.has('peds')) level.peds = mode === 'wreck' ? 14 : 7;

  // Remove props that ended up overlapping each other (keeps the street tidy).
  level.props = level.props.filter((p, i) => {
    const d = PROPS[p.type];
    for (let j = 0; j < i; j++) {
      const q = level.props[j];
      const e = PROPS[q.type];
      if (Math.abs(p.x - q.x) < d.hl + e.hl + 0.25 && Math.abs(p.z - q.z) < Math.max(d.hw, d.hl) + Math.max(e.hw, e.hl) + 0.25) {
        return false;
      }
    }
    return true;
  });

  // Buildings
  for (const dir of [1, -1]) {
    let x = xMin - 10;
    while (x < xMax + 10) {
      const w = 8 + Math.floor(r() * 3) * 3;
      level.buildings.push({
        x0: x, x1: x + w, dir, name: pick(r, SHOPS),
        color: pick(r, BUILDING_COLORS), height: 6 + Math.floor(r() * 4) * 2.5,
      });
      x += w;
    }
  }
  const bz0 = CURB + SIDEWALK;
  // One collision box per building so each can be wrecked on its own.
  level.buildings.forEach((b, i) => {
    level.walls.push({
      kind: 'building', building: i,
      x: (b.x0 + b.x1) / 2, z: b.dir * (bz0 + BUILDING_DEPTH / 2), hl: (b.x1 - b.x0) / 2, hw: BUILDING_DEPTH / 2, a: 0,
    });
  });
  // Back walls behind the lots, for when a building is no longer there.
  for (const dir of [1, -1]) {
    level.walls.push({ kind: 'backwall', x: (xMin + xMax) / 2, z: dir * (bz0 + BUILDING_DEPTH + 0.5), hl: (xMax - xMin) / 2 + 30, hw: 0.5, a: 0 });
  }
  if (level.ramp) {
    const rp = level.ramp;
    level.walls.push({ kind: 'ramp', x: rp.x0 + rp.len / 2, z: (rp.z0 + rp.z1) / 2, hl: rp.len / 2, hw: (rp.z1 - rp.z0) / 2, a: 0 });
  }
  // Road closed barricades at each end (reaching back through the lots too)
  for (const end of [xMin, xMax]) {
    level.walls.push({ kind: 'barricade', x: end, z: 0, hl: 0.6, hw: bz0 + BUILDING_DEPTH + 1, a: 0 });
  }
  return level;
}
