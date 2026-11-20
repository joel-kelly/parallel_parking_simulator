// Backing into a car park stall: the planner (a kinematic rehearsal) and the
// driver (the same moves, under real physics). Used for par, the instructor
// demo, and the tests that prove every stall can be parked in.
//
// Everything happens in the stall frame (see spot.js): x' along the aisle in
// the direction you approach, z' into the stall. You finish facing out of the
// stall, heading -90 degrees in that frame.
import { centreAhead } from './vehicles.js';
import { spotPose, toSpot, spotAngle } from './spot.js';
import { collideOBB } from './physics.js';
import { speedCtl, clamp, AIDriver } from './ai.js';

const STEER_FRAC = 0.97;
const PAD = 0.1;         // driving clearance around everything
const PLAN_PAD = 0.16;   // the plan keeps a little more, so small wobbles don't spoil it
const ROOM = 0.2;        // stop this far short of anything in the way
const BACK_GAP = 0.3;    // aim to stop this far from the back of the stall
const DECEL = 2.2;
const OUT = -Math.PI / 2; // finished heading: nose out
const L1 = 2.2, L2 = 1.3; // tracking gains (per metre): s^2 + L1 s + L2, nicely damped
const MAX_SHUFFLES = 5;
const MAX_FIXES = 2;

// The moves: swing back into the stall on full lock, shuffle (forward and
// back, both turning the same way) until square, reverse straight in while
// steering onto the centre line, and if that went wonky, pull out a bit and
// try again.
function* policy() {
  yield { kind: 'arc', steer: 1, dir: -1 };
  for (let i = 0; i < MAX_SHUFFLES; i++) {
    // forward: keep turning if there's room, or ease off / straighten up and
    // come back at it if the corner of the car next door is in the way
    yield { kind: 'arc', steer: [-1, 0, 1], dir: 1, ifShort: true, dist: 1.6 };
    yield { kind: 'arc', steer: 1, dir: -1, ifShort: true };
  }
  yield { kind: 'track', dir: -1 };
  for (let i = 0; i < MAX_FIXES; i++) {
    yield { kind: 'track', dir: 1, dist: 2.2, ifWonky: true };
    yield { kind: 'track', dir: -1, ifWonky: true };
  }
}

// Wedged: pull forward (straightening up) and try the swing again.
function* recovery() {
  yield { kind: 'arc', steer: [1, 0], dir: 1, dist: 3, free: true };
  yield* policy();
}

// Everything near the stall, as boxes in the stall frame.
function obstaclesFor(world, spot, car, reach, PAD) {
  const out = [];
  const near = (b) => Math.hypot(b.x - spot.cx, b.z - spot.cz) < reach + Math.hypot(b.hl, b.hw);
  const add = (b, pad) => {
    if (!near(b)) return;
    const [x, z] = toSpot(spot, b.x, b.z);
    out.push({ x, z, a: spotAngle(spot, b.a), hl: b.hl + pad, hw: b.hw + pad });
  };
  for (const p of world.parked) add(p.body, PAD);
  for (const c of world.carts) add(c.body, PAD);
  for (const p of world.props) if (!p.broken) add(p.body, PAD);
  for (const w of world.walls) add(w, PAD);
  for (const c of world.cars) if (c !== car && !c.isTraffic) add(c.body, PAD);
  // Leavers start parked; plan around them as they are.
  for (const c of world.cars) if (c.leaving === 'wait') add(c.body, PAD);
  // Medians, planters and sidewalks: don't drive up on them.
  for (const q of world.level.raised || []) {
    const b = { x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, a: 0, hl: (q.x1 - q.x0) / 2, hw: (q.z1 - q.z0) / 2 };
    const cx = Math.max(q.x0, Math.min(q.x1, spot.cx)), cz = Math.max(q.z0, Math.min(q.z1, spot.cz));
    if (Math.hypot(cx - spot.cx, cz - spot.cz) > reach) continue;
    // A huge strip: clip it to the neighbourhood so the boxes stay small.
    const x0 = Math.max(q.x0, spot.cx - reach), x1 = Math.min(q.x1, spot.cx + reach);
    const [x, z] = toSpot(spot, (x0 + x1) / 2, b.z);
    const along = Math.abs(spot.ux) > 0.5;
    out.push({ x, z, a: along ? 0 : Math.PI / 2, hl: (along ? (x1 - x0) : (q.z1 - q.z0)) / 2, hw: (along ? (q.z1 - q.z0) : (x1 - x0)) / 2 });
  }
  return out;
}

// A pose (rear axle x, z, heading a in the stall frame) as a box.
function carBox(spec, b, x, z, a) {
  return { x: x + b * Math.cos(a), z: z + b * Math.sin(a), a, hl: spec.length / 2, hw: spec.width / 2 };
}

const hits = (box, obstacles) => obstacles.some((o) => collideOBB(box, o));

// How far the car can travel along its current arc before touching something.
function freeDist(spec, b, x, z, a, dir, k, obstacles, max = 1.2) {
  const ds = 0.05;
  // only what's within reach of this bit of driving
  const cx = x + b * Math.cos(a), cz = z + b * Math.sin(a);
  const r = Math.hypot(spec.length / 2, spec.width / 2) + max + 0.1;
  const near = obstacles.filter((o) => Math.hypot(o.x - cx, o.z - cz) < r + Math.hypot(o.hl, o.hw));
  if (!near.length) return max;
  for (let s = ds; s <= max; s += ds) {
    const da = dir * s * k;
    let nx, nz;
    if (Math.abs(k) < 1e-6) { nx = x + dir * s * Math.cos(a); nz = z + dir * s * Math.sin(a); } else {
      nx = x + (Math.sin(a + da) - Math.sin(a)) / k;
      nz = z - (Math.cos(a + da) - Math.cos(a)) / k;
    }
    if (hits(carBox(spec, b, nx, nz, a + da), near)) return s - ds;
  }
  return max;
}

// A move may offer several steering choices: take the first with room to move.
function pickSteer(m, roomy) {
  if (!Array.isArray(m.steer)) return m.steer;
  return m.steer.find(roomy) ?? m.steer[0];
}

// Steering (as a fraction of full lock) for the straight-in tracking law.
function trackSteer(R, x, a, dir) {
  const e = a - OUT;
  const k = dir < 0 ? L1 * e - L2 * x : -L1 * e - L2 * x;
  return clamp(k * R, -1, 1);
}

/**
 * Finds a clean way to back into the stall. Returns the approach pose
 * {x0, z0} plus the number of moves it took, or null.
 */
export function planBackIn(world, spot, spec, car = world.player) {
  const R = spec.wheelbase / Math.tan(spec.maxSteer * STEER_FRAC);
  const b = centreAhead(spec);
  const reach = R + spec.length + 8;
  const obstacles = obstaclesFor(world, spot, car, reach, PLAN_PAD);
  const zT = spot.depth - BACK_GAP - (spec.length / 2 - b); // rear axle depth when finished
  const ctx = { R, b, spec, obstacles, zT, spot };
  const aisle = world.level.lot ? world.level.lot.A : 7.6;
  let best = null;
  const zs = [];
  for (let z0 = -1.1 - spec.width / 2; z0 >= -aisle + spec.width / 2 + 0.5; z0 -= 0.6) zs.push(z0);
  for (const z0 of zs) {
    for (let dx = -1.5; dx <= 3.5; dx += 0.25) {
      const P = { R, b, zT, x0: R + dx, z0 };
      const res = simulate(P, ctx);
      if (!res.ok) continue;
      const score = res.moves * 10 + Math.abs(dx) * 0.2 + res.err * 4;
      if (!best || score < best.score) best = { ...P, score, moves: res.moves };
      if (best.moves <= 1 && res.moves <= 1) break;
    }
    if (best && best.moves <= 1) break;
  }
  return best;
}

function simulate(P, ctx) {
  const { R, b, spec, obstacles, zT } = ctx;
  let x = P.x0, z = P.z0, a = 0;
  // The approach along the aisle must be clear too.
  if (hits(carBox(spec, b, x, z, 0), obstacles)) return { ok: false };
  const run = { x: x - 6 + b, z, a: 0, hl: 6 + spec.length / 2 - 0.5, hw: spec.width / 2 };
  if (hits(run, obstacles)) return { ok: false };
  let moves = 0, lastDir = 1;
  const ds = 0.05;
  let fixes = 0;
  for (const m of policy()) {
    if (m.ifShort && a <= OUT + 0.035) continue;
    if (m.ifWonky) {
      if (Math.abs(x) < 0.15 && Math.abs(a - OUT) < 0.06 && z > zT - 0.3) continue;
      if (m.dir < 0) fixes++;
    }
    if (m.dir !== lastDir) { moves++; lastDir = m.dir; }
    const steer = m.kind === 'arc' ? pickSteer(m, (st) => freeDist(spec, b, x, z, a, m.dir, st / R, obstacles, 0.5) >= 0.45) : 0;
    let travelled = 0;
    for (let i = 0; i < 800; i++) {
      let k;
      if (m.kind === 'arc') {
        if (a <= OUT && !m.free) break;
        if (m.dist && travelled >= m.dist) break;
        k = steer / R;
      } else {
        if (m.dir < 0 && z >= zT) break;
        if (m.dist && travelled >= m.dist) break;
        k = trackSteer(R, x, a, m.dir) / R;
      }
      if (freeDist(spec, b, x, z, a, m.dir, m.kind === 'arc' ? k : 0, obstacles, ROOM + ds) < ROOM) break;
      x += m.dir * ds * Math.cos(a);
      z += m.dir * ds * Math.sin(a);
      a += m.dir * ds * k;
      travelled += ds;
    }
    if (m.kind === 'arc' && travelled < ds && m.ifShort) return { ok: false }; // wedged
  }
  const err = Math.abs(x) + Math.abs(a - OUT) * 3;
  const gap = zT + BACK_GAP - z; // how far short of the target we stopped (0 = on target)
  if (Math.abs(a - OUT) > 0.05 || Math.abs(x) > 0.2 || gap > BACK_GAP + 0.45) return { ok: false };
  return { ok: true, moves, err, fixes };
}

/**
 * Drives a car into a stall under real physics. Same interface as AIDriver:
 * update(dt) returns the input; gaveUp, phase and plan_.moves are public.
 */
export class LotDriver {
  constructor(world, car, spot, profile, rand = Math.random) {
    this.world = world;
    this.car = car;
    this.spot = spot;
    this.p = profile;
    this.rand = rand;
    this.attempts = 0;
    this.gaveUp = false;
    this.replan();
  }

  replan() {
    const spec = this.car.spec;
    const R = spec.wheelbase / Math.tan(spec.maxSteer * STEER_FRAC);
    this.plan_ = planBackIn(this.world, this.spot, spec, this.car)
      || { R, b: centreAhead(spec), zT: this.spot.depth - BACK_GAP - spec.rearOverhang, x0: R + 1, z0: -2.2, moves: 9 };
    this.obstacles = null;
    this.moves = policy();
    this.move = null;
    this.phase = 'approach';
    this.timer = 0;
    this.stuck = 0;
  }

  // Live obstacle boxes (refreshed now and then: things get shoved about).
  obs() {
    if (!this.obstacles || this.timer % 0.5 < 1 / 100) {
      const spec = this.car.spec;
      this.obstacles = obstaclesFor(this.world, this.spot, this.car, this.plan_.R + spec.length + 8);
    }
    return this.obstacles;
  }

  nextMove(pose) {
    const P = this.plan_;
    for (;;) {
      const r = this.moves.next();
      if (r.done) { this.move = null; this.phase = 'done'; return; }
      const m = r.value;
      if (m.ifShort && pose.a <= OUT + 0.035) continue;
      if (m.ifWonky && Math.abs(pose.x) < 0.15 && Math.abs(pose.a - OUT) < 0.06 && pose.z > P.zT - 0.3) continue;
      const spec = this.car.spec;
      const steer = m.kind === 'arc' ? pickSteer(m, (st) => freeDist(spec, P.b, pose.x, pose.z, pose.a, m.dir, st / P.R, this.obs(), 0.5) >= 0.45) : 0;
      this.move = { ...m, steer, travelled: 0, steering: m.kind === 'arc' };
      this.phase = 'move';
      this.timer = 0;
      return;
    }
  }

  update(dt) {
    const c = this.car, P = this.plan_;
    const spec = c.spec;
    const pose = spotPose(this.spot, c.body, centreAhead(spec));
    const v = c.speed;
    const inp = { throttle: 0, steer: 0, handbrake: false };
    this.timer += dt;
    if (this.gaveUp) return inp;
    const go = (vt) => { inp.throttle = speedCtl(v, vt); };

    if (this.phase === 'approach' || this.phase === 'align') {
      // Same drive-up as the parallel parker.
      AIDriver.prototype.approachStep.call(this, pose, P, inp, go, v);
    } else if (this.phase === 'move') {
      const m = this.move;
      let k;
      if (m.kind === 'arc') {
        inp.steer = m.steer * STEER_FRAC;
        k = m.steer / P.R;
      } else {
        inp.steer = trackSteer(P.R, pose.x, pose.a, m.dir) * STEER_FRAC;
        k = inp.steer / STEER_FRAC / P.R;
      }
      if (m.steering) {
        // set the wheels before moving, so the arc is the planned one
        go(0);
        if (Math.abs(c.steer * this.spot.hand - inp.steer * spec.maxSteer) < 0.02 && Math.abs(v) < 0.05) m.steering = false;
      } else {
        let left;
        m.travelled += Math.abs(v) * dt;
        if (m.kind === 'arc') left = m.free ? Infinity : Math.max(0, pose.a - OUT) * P.R;
        else if (m.dir < 0) left = P.zT - pose.z;
        else left = Infinity;
        if (m.dist) left = Math.min(left, m.dist - m.travelled);
        const room = freeDist(spec, P.b, pose.x, pose.z, pose.a, m.dir, m.kind === 'arc' ? k : 0, this.obs(), 1.2) - ROOM;
        left = Math.min(left, room);
        const vmax = m.kind === 'arc' ? this.p.varc : Math.min(0.9, this.p.varc);
        if (left > 0.01) go(m.dir * Math.min(vmax, Math.max(0.2, Math.sqrt(2 * DECEL * left))));
        else {
          go(0);
          if (Math.abs(v) < 0.03) this.nextMove(pose);
        }
      }
    } else {
      go(0);
      // Ran out of moves without getting in? Pull out and have another go.
      if (Math.abs(v) < 0.03 && !c.parked && (!c.lastEval || !c.lastEval.inSpot) && this.timer > 1) {
        this.attempts++;
        if (this.attempts > 2) this.gaveUp = true;
        else { this.moves = recovery(); this.nextMove(pose); }
      }
    }

    if (inp.throttle !== 0 && Math.abs(v) < 0.05 && this.phase !== 'done') {
      this.stuck += dt;
      if (this.stuck > 3) {
        this.attempts++;
        if (this.attempts > 2) this.gaveUp = true;
        else this.replan();
      }
    } else this.stuck = 0;
    inp.steer *= this.spot.hand;
    return inp;
  }
}

// The right driver for a spot: parallel parker on the street, back-in in the car park.
export function makeDriver(world, car, spot, profile, rand) {
  return spot && spot.kind === 'stall' ? new LotDriver(world, car, spot, profile, rand) : new AIDriver(world, car, spot, profile, rand);
}
