// The big-box store car park: rows of perpendicular stalls, feral shopping
// carts, people backing out without looking, and you, reversing into a stall.
//
// Layout (world coords): aisles run along x. Aisle 1 (the one you start in)
// is centred on z = 0. Each side of it has a row of stalls opening onto it,
// a planted median, a second row facing the next aisle, and so on out to the
// store (+z) and the perimeter hedge (-z).
import { NPC_CARS, NPC_COLORS, foodNpc, minTurnRadius } from './vehicles.js';
import { surfaceGrip } from './mods.js';
import { corners } from './physics.js';

export const STALL_W = 2.8;      // painted stall width
export const MEDIAN = 1.6;       // planted strip between back-to-back rows
export const RAISED_H = 0.15;    // height of medians, sidewalks and planters
const BEVEL = 0.25;
const BLOCK = 8;                 // stalls between pedestrian walkways
const BLOCKS = 3;
const WALKWAY = 3.2;
export const STORE_NAME = 'BULKZILLA';

// Spare room beside your car (total, both sides) in the stall, by difficulty.
export const LOT_MARGIN = { easy: 2.0, normal: 1.35, hard: 0.95, insane: 0.7 };

export const LOT_SLOGANS = [
  'PRICES SO LOW, SO ARE OUR STANDARDS', 'MEMBERS ONLY. MEMBERS OF WHAT? DO NOT ASK.',
  'FREE SAMPLES. LIMIT: NONE.', 'TODAY ONLY: 48-PACK OF MAYONNAISE',
  'NOW SELLING CASKETS AND CROISSANTS', 'PARKING IS A CONTACT SPORT',
];

const rngPick = (r, arr) => arr[Math.floor(r() * arr.length)];

// The rows of stalls, the aisles and the raised strips, from the vehicle's size.
export function lotDims(vehicle) {
  const D = Math.max(5.6, vehicle.length + 0.9);
  const R = minTurnRadius({ ...vehicle, maxSteer: vehicle.maxSteer * 0.97 });
  const A = Math.min(12, Math.max(7.6, 4.2 + R * 0.75));
  const half = (BLOCKS * BLOCK * STALL_W + (BLOCKS - 1) * WALKWAY) / 2;
  return { D, A, R, half };
}

/**
 * Builds a car park level. Same shape of data as buildLevel's street levels,
 * plus `lot` (layout), `raised` (planters/sidewalks: rectangles of raised
 * ground), `carts` (loose shopping carts) and `leavers` (parked cars that
 * will back out when you come past).
 */
export function buildLot({ difficulty: diff, vehicle, seed, mods, margin, leftHand = false, food = false, r }) {
  const modSet = new Set([...mods].filter((m) => m !== 'shrink'));
  const hand = leftHand ? -1 : 1;
  const hidden = modSet.has('hidden');
  const { D, A, R, half } = lotDims(vehicle);

  // z bands, from the perimeter (-z) to the store (+z)
  const a1 = 0, a0 = -(A + 2 * D + MEDIAN), a2 = A + 2 * D + MEDIAN;
  const rows = [
    // open: z of the edge facing the aisle; n: direction from that edge into the stall
    { id: 'S3', open: a0 - A / 2, n: -1, aisle: 0 },
    { id: 'S2', open: a0 + A / 2, n: 1, aisle: 0 },
    { id: 'S1', open: a1 - A / 2, n: -1, aisle: 1 },
    { id: 'N1', open: a1 + A / 2, n: 1, aisle: 1 },
    { id: 'N2', open: a2 - A / 2, n: -1, aisle: 2 },
    { id: 'N3', open: a2 + A / 2, n: 1, aisle: 2 },
  ];
  const aisles = [a0, a1, a2];
  const zStore = a2 + A / 2 + D;          // store-side row backs onto the sidewalk
  const zFar = a0 - A / 2 - D;            // perimeter row backs onto the hedge
  const sidewalk = 5;
  const storeFace = zStore + sidewalk;
  const xEnd = half + A + 4;              // lot edge (cross aisles beyond the rows)
  const xMin = -(xEnd + 10), xMax = xEnd + 10;

  const level = {
    mode: 'lot', lot: { D, A, R, half, rows, aisles, zStore, zFar, storeFace, xEnd, walkways: [] },
    difficulty: diff, curbZ: Infinity, xMin, xMax, seed, leftHand, hand, food,
    mods: modSet, grip: surfaceGrip(modSet),
    parked: [], props: [], buildings: [], walls: [], spots: [], raised: [], carts: [], leavers: [],
    playerStart: { x: 0, z: hand * A / 4, a: 0 },
    aiStart: null, traffic: [], peds: 0,
  };

  // Stall centres along x, with walkways between blocks.
  const stallXs = [];
  for (let b = 0; b < BLOCKS; b++) {
    const x0 = -half + b * (BLOCK * STALL_W + WALKWAY);
    for (let i = 0; i < BLOCK; i++) stallXs.push(x0 + (i + 0.5) * STALL_W);
    if (b < BLOCKS - 1) level.lot.walkways.push(x0 + BLOCK * STALL_W + WALKWAY / 2);
  }

  // Raised ground: the medians, the store sidewalk and the perimeter planter.
  const rect = (x0, x1, z0, z1, kind) => level.raised.push({ x0, x1, z0, z1, kind });
  rect(-half, half, a1 + A / 2 + D, a1 + A / 2 + D + MEDIAN, 'median');
  rect(-half, half, a1 - A / 2 - D - MEDIAN, a1 - A / 2 - D, 'median');
  rect(xMin, xMax, zStore, storeFace, 'sidewalk');
  rect(xMin, xMax, zFar - 3, zFar, 'planter');

  let npcN = 0;
  const npc = () => {
    const t = rngPick(r, NPC_CARS);
    const car = { ...t, color: rngPick(r, NPC_COLORS) };
    return food ? foodNpc(car, npcN++) : car;
  };
  // Parks a car in a stall. off: sideways nudge; tilt: radians; noseIn: facing into the stall.
  const parkIn = (row, x, car, { off = 0, tilt = 0, noseIn = r() < 0.6, depth } = {}) => {
    const back = row.open + row.n * (depth ?? (D - 0.35 - r() * 0.5)); // where the car's far end sits
    const cz = back - row.n * car.length / 2;
    const a = (noseIn ? (row.n > 0 ? Math.PI / 2 : -Math.PI / 2) : (row.n > 0 ? -Math.PI / 2 : Math.PI / 2)) + tilt;
    level.parked.push({ ...car, x: x + off, z: cz, a });
    return level.parked.length - 1;
  };

  // ---- the spot(s) ----
  const stallSpare = (margin ?? LOT_MARGIN[diff.id] ?? 1.35) + (vehicle.extraRoom || 0);
  const myRow = rows.find((w) => w.id === (hand > 0 ? 'N1' : 'S1'));
  const otherRow = rows.find((w) => w.id === (hand > 0 ? 'S1' : 'N1'));
  const taken = new Map(); // `${row.id}:${i}` -> true
  const spots = [];
  const addSpot = (row, i, spare) => {
    const x = stallXs[i];
    const nz = row.n;
    spots.push({
      kind: 'stall', owner: 'player', row: row.id, i,
      ox: x, oz: row.open, ux: 1, uz: 0, nx: 0, nz, hand: nz, // stall on the right of +x when nz > 0
      cx: x, cz: row.open + nz * D / 2, depth: D, width: Math.max(STALL_W, vehicle.width + 0.6),
      length: vehicle.width + spare, spare,
    });
    taken.set(`${row.id}:${i}`, true);
    // Neighbours hug the lines so the gap is exactly as advertised (give or take a wonky park).
    for (const side of [-1, 1]) {
      const j = i + side;
      if (j < 0 || j >= stallXs.length || taken.has(`${row.id}:${j}`)) continue;
      if (blockOf(j) !== blockOf(i)) continue; // walkway on that side: nobody to hug
      const car = npc();
      const want = (vehicle.width + spare) / 2 + car.width / 2; // centre-to-centre
      const tilt = (r() - 0.5) * 0.05;
      parkIn(row, x + side * want, car, { tilt, off: 0 });
      taken.set(`${row.id}:${j}`, true);
    }
  };
  const blockOf = (i) => Math.floor(i / BLOCK);
  if (hidden) {
    // Several empty stalls along your aisle, both sides, different squeezes. Any will do.
    const spares = [0.7, 0.95, 1.3, 1.8, 2.4].map((s) => s + (vehicle.extraRoom || 0));
    for (let k = spares.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [spares[k], spares[j]] = [spares[j], spares[k]]; }
    const picks = [3, 7, 11, 15, 19];
    picks.forEach((i, k) => addSpot(k % 2 ? otherRow : myRow, i + Math.floor(r() * 2), spares[k]));
  } else {
    const i = 9 + Math.floor(r() * 8); // somewhere in the middle block
    addSpot(myRow, i, stallSpare);
  }
  level.spots = spots.sort((p, q) => q.spare - p.spare);
  const primary = spots.reduce((p, q) => (q.spare > p.spare ? q : p));
  level.playerStart = { x: Math.max(-xEnd + 2, primary.cx - 24), z: hand * A / 4, a: 0 };

  // ---- everybody else ----
  // The stalls across the aisle from a spot stay filled, but tidily: no wonky
  // parkers or carts in the way of the swing.
  const keepClear = (row, i) => row.aisle === 1 && spots.some((s) => s.row !== row.id && Math.abs(i - s.i) <= 3);
  // Cart corrals stand in for a stall in the far rows.
  const corrals = [['N2', 4], ['S2', 18], ['N3', 13]];
  for (const [rowId, i] of corrals) {
    const row = rows.find((w) => w.id === rowId);
    taken.set(`${rowId}:${i}`, true);
    level.walls.push({ kind: 'corral', x: stallXs[i], z: row.open + row.n * D / 2, hl: 0.9, hw: (D - 1.2) / 2, a: 0, h: 1.1 });
  }
  const leaverCands = [];
  for (const row of rows) {
    stallXs.forEach((x, i) => {
      const key = `${row.id}:${i}`;
      if (taken.has(key)) return;
      taken.set(key, true);
      const nearSpot = spots.some((s) => s.row === row.id && Math.abs(s.i - i) <= 2);
      const calm = nearSpot || keepClear(row, i);
      const roll = r();
      if (!calm && roll < 0.08) {
        // an empty stall... with a shopping cart abandoned in the middle of it
        level.carts.push({ x: x + (r() - 0.5) * 0.8, z: row.open + row.n * (1.5 + r() * 2.5), a: r() * 6 });
        return;
      }
      if (roll < 0.12) return; // a genuinely empty stall, far from where you need one
      const car = npc();
      const next = `${row.id}:${i + 1}`;
      if (!calm && r() < 0.06 && i + 1 < stallXs.length && blockOf(i + 1) === blockOf(i) && !taken.has(next)) {
        // The Entitled: parked across the line (taking the next stall too), at an angle, in a hurry
        taken.set(next, true);
        parkIn(row, x + STALL_W / 2, car, { tilt: (r() < 0.5 ? 1 : -1) * (0.16 + r() * 0.08), depth: D - 0.3 });
        return;
      }
      const idx = parkIn(row, x, car, { off: calm ? (r() - 0.5) * 0.2 : (r() - 0.5) * 0.5, tilt: (r() - 0.5) * (calm ? 0.03 : 0.08) });
      // Candidates to back out later: nose-in, on an aisle you drive down, away from your spot.
      if (row.aisle !== 0 && !nearSpot && Math.abs(level.parked[idx].a - (row.n > 0 ? Math.PI / 2 : -Math.PI / 2)) < 0.1) leaverCands.push({ idx, row, x });
    });
  }

  // Cars that back out when you come past: taken out of the parked list and
  // handed to the traffic system, which drives them out and away.
  const nLeave = modSet.has('traffic') ? 3 : 2;
  const ahead = leaverCands.filter((c) => c.x > level.playerStart.x + 8 && c.x < primary.cx + 18 && Math.abs(c.x - primary.cx) > STALL_W * 3.5 && c.row.aisle === 1);
  const others = leaverCands.filter((c) => c.row.aisle === 2);
  const chosen = [];
  for (const pool of [ahead, ahead, others]) {
    if (chosen.length >= nLeave || !pool.length) continue;
    const c = pool.splice(Math.floor(r() * pool.length), 1)[0];
    chosen.push(c);
  }
  const drop = new Set(chosen.map((c) => c.idx));
  for (const c of chosen) {
    const p = level.parked[c.idx];
    const aisleZ = aisles[c.row.aisle];
    // after backing out they drive off along their aisle, keeping to the proper side
    const dir = c.row.aisle === 1 ? -1 : (r() < 0.5 ? 1 : -1);
    level.leavers.push({ ...p, lane: { dir, z: aisleZ + dir * hand * A / 4, speed: 3.6 }, rowOpen: c.row.open, rowN: c.row.n, trigger: 9 + r() * 6 });
  }
  if (drop.size) level.parked = level.parked.filter((p, i) => !drop.has(i));

  // ---- carts loose in the aisles (never in the stretch you need) ----
  const nCarts = 7;
  for (let k = 0; k < nCarts; k++) {
    const ai = k % 3;
    let x = (r() - 0.5) * 2 * (half + A * 0.5);
    const z = aisles[ai] + (r() - 0.5) * (A - 2);
    if (ai === 1 && spots.some((s) => Math.abs(x - s.cx) < 16)) x = Math.sign(x || 1) * (half + 1 + r() * 2);
    if (ai === 1 && Math.abs(x - level.playerStart.x) < 6) continue;
    level.carts.push({ x, z, a: r() * 6 });
  }

  // ---- props ----
  const prop = (type, x, z, a = 0) => level.props.push({ type, x, z, a });
  for (const m of level.raised.filter((q) => q.kind === 'median')) {
    const mz = (m.z0 + m.z1) / 2;
    for (let x = -half + 4; x < half - 2; x += 11.2) prop('lamp', x + r() * 0.6, mz);
    for (let x = -half + 9.6; x < half - 2; x += 11.2) prop(r() < 0.5 ? 'tree' : 'shrub', x + r(), mz);
  }
  // the store front: bollards, benches, a free sample table (guarded)
  for (let x = -half; x <= half; x += 4) prop('bollard', x, zStore + 0.6);
  prop('samples', -6, zStore + 2.6);
  prop('samples', 9, zStore + 2.6);
  for (const x of [-20, 2, 22]) prop('bench', x, storeFace - 1.0);
  for (const x of [-14, 15, 30]) prop('trash', x, zStore + 3.2);
  prop('newsbox', -27, zStore + 3.4);
  // the perimeter: a hedge you can't see over, and trees
  for (let x = xMin + 6; x < xMax - 6; x += 9) prop('tree', x + r() * 2, zFar - 1.5);
  if (leftHand) for (let k = 0; k < 4; k++) prop('sheep', -half + 6 + k * 17 + r() * 3, zFar - 1.2 - r(), r() * 6);

  // Remove props sitting on each other.
  level.props = level.props.filter((p, i) => !level.props.slice(0, i).some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 1.0));

  // ---- walls ----
  const storeDepth = 30;
  level.walls.push({ kind: 'store', x: 0, z: storeFace + storeDepth / 2, hl: xMax + 20, hw: storeDepth / 2, a: 0 });
  level.walls.push({ kind: 'backwall', x: 0, z: zFar - 3.5, hl: xMax + 20, hw: 0.5, a: 0 });
  for (const end of [xMin, xMax]) {
    level.walls.push({ kind: 'barricade', x: end, z: (zFar + storeFace) / 2, hl: 0.6, hw: (storeFace - zFar) / 2 + 2, a: 0 });
  }

  // ---- moving things ----
  // Spot hunters crawl the aisles. More (and pushier) with Rush Hour.
  const busy = modSet.has('traffic');
  level.traffic.push({ dir: 1, count: busy ? 3 : 2, speed: busy ? 5 : 3.6, z: a0 + hand * A / 4 });
  level.traffic.push({ dir: -1, count: busy ? 3 : 2, speed: busy ? 5 : 3.6, z: a2 - hand * A / 4 });
  level.traffic.push({ dir: -1, count: busy ? 2 : 1, speed: busy ? 4.5 : 3.2, z: a1 - hand * A / 4 });
  level.peds = modSet.has('peds') ? 14 : 7;
  return level;
}

// ---- raised ground ----

export function raisedHeight(level, x, z) {
  let h = 0;
  for (const q of level.raised) {
    if (x <= q.x0 || x >= q.x1 || z <= q.z0 || z >= q.z1) continue;
    const d = Math.min(x - q.x0, q.x1 - x, z - q.z0, q.z1 - z);
    h = Math.max(h, d >= BEVEL ? RAISED_H : d / BEVEL * RAISED_H);
  }
  return h;
}

// ---- evaluating a park in a stall ----

// The stall frame (see spot.js): x' along the aisle, z' into the stall.
function toStall(spot, x, z) {
  const dx = x - spot.ox, dz = z - spot.oz;
  return [dx * spot.ux + dz * spot.uz, dx * spot.nx + dz * spot.nz];
}

export function evaluateStall(world, car, spot) {
  const b = car.body;
  const cs = corners(b).map(([x, z]) => toStall(spot, x, z));
  const xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1]);
  const theta = Math.atan2(spot.uz, spot.ux);
  let a = spot.hand * (b.a - theta);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  const eBack = Math.abs(wrap(a + Math.PI / 2)), eNose = Math.abs(wrap(a - Math.PI / 2));
  const noseIn = eNose < eBack;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const deep = Math.max(...zs), shallow = Math.min(...zs);
  const halfW = spot.width / 2;
  const inSpot = lo > -halfW - 0.25 && hi < halfW + 0.25 && shallow > -0.45 && deep < spot.depth + 0.35;
  const backGap = spot.depth - deep;
  return {
    inSpot, noseIn,
    angle: Math.min(eBack, eNose) * 180 / Math.PI,
    backGap,
    curbDist: backGap,           // for the HUD, which calls it the curb everywhere else
    offCentre: (lo + hi) / 2,
    sticksOut: Math.max(0, -shallow),
  };
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
