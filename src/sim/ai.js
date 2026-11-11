import { centreAhead } from './vehicles.js';
import { PARK_GAP } from './level.js';
import { spotPose, spotBounds, toSpot, spotAngle } from './spot.js';
import { collideOBB } from './physics.js';

export const AI_PROFILES = {
  easy: { name: 'GRANDMA GERTRUDE', vmax: 3.2, varc: 0.9, pause: 1.0, slop: 0.04, taunt: 'Back in my day we parked horses.' },
  normal: { name: 'INSTRUCTOR DAVE', vmax: 4.5, varc: 1.2, pause: 0.5, slop: 0.025, taunt: 'Mirror. Signal. Dominate.' },
  hard: { name: 'VALET VINNIE', vmax: 6.5, varc: 1.5, pause: 0.2, slop: 0.01, taunt: 'Keys? I don\'t need keys.' },
  insane: { name: 'THE PARKINATOR', vmax: 8.5, varc: 1.8, pause: 0.05, slop: 0.0, taunt: 'RESISTANCE IS CURBED.' },
};

const DECEL = 2.2;
const ROOM = 0.22;      // stop this far from the neighbours when shuffling
const PAD = 0.1;        // planning clearance around the neighbours
const STEER_FRAC = 0.97;
const MAX_SHUFFLES = 8;

/**
 * The parking policy, shared by the planner (kinematic simulation) and the
 * driver (real physics). Parameters: start pose (x0, z0), first arc angle phi,
 * straight reverse length. After the S-curve it shuffles forward/back with
 * opposite locks until straight, then centres itself.
 */
function* policy(P) {
  yield { steer: 1, dir: -1, until: 'heading', target: -P.phi };
  if (P.straight > 0.03) yield { steer: 0, dir: -1, until: 'dist', dist: P.straight, correct: true };
  yield { steer: -1, dir: -1, until: 'heading', target: 0, room: true };
  for (let i = 0; i < MAX_SHUFFLES; i++) {
    yield { steer: 1, dir: 1, until: 'heading', target: 0, room: true, ifTilted: true };
    yield { steer: -1, dir: -1, until: 'heading', target: 0, room: true, ifTilted: true };
  }
  yield { steer: 0, dir: 0, until: 'centre' };
}

export function planPark(world, spot, spec, rand = () => 0.5, slop = 0) {
  const R = spec.wheelbase / Math.tan(spec.maxSteer * STEER_FRAC);
  const b = centreAhead(spec);
  const bounds = spotBounds(world, spot);
  const front = world.parked[spot.frontCar].body;
  const zf = -(0.22 + spec.width / 2);
  const xc = (bounds.rear + bounds.front) / 2;
  const obstacles = [spot.frontCar, spot.rearCar].map((i) => {
    const o = world.parked[i].body;
    const [x, z] = toSpot(spot, o.x, o.z);
    return { x, z, a: spotAngle(spot, o.a), hl: o.hl + PAD, hw: o.hw + PAD };
  });
  const ctx = { R, b, spec, bounds, obstacles };

  let best = null;
  for (const clear of [0.8, 0.6, 1.0, 0.45]) {
    const z0 = -(PARK_GAP + front.hw * 2 + clear + spec.width / 2);
    const dz = zf - z0;
    const phiNeed = Math.acos(Math.max(-1, 1 - dz / (2 * R)));
    for (let k = 0; k < 6; k++) {
      const phi = Math.min(1.05, phiNeed) - k * 0.1;
      if (phi < 0.35) break;
      const straight = Math.max(0, (dz - 2 * R * (1 - Math.cos(phi))) / Math.sin(phi));
      const longi = 2 * R * Math.sin(phi) + straight * Math.cos(phi);
      for (let back = -0.4; back <= 2.4; back += 0.1) {
        const P = { R, b, zf, z0, phi, straight, x0: xc - b - back + longi, xFinal: xc - b };
        const res = simulate(P, ctx);
        if (!res.ok) continue;
        const score = res.moves * 10 + Math.abs(back) * 0.5 + Math.abs(clear - 0.8);
        if (!best || score < best.score) best = { ...P, score, moves: res.moves };
      }
    }
  }
  if (!best) return null;
  best.phi += (rand() - 0.5) * 2 * slop;
  return best;
}

// Kinematic simulation of the policy. Returns {ok, moves} where moves counts
// gear changes (the same thing the player is scored on).
function simulate(P, ctx) {
  const { R, b, spec, bounds, obstacles } = ctx;
  let x = P.x0, z = P.z0, a = 0;
  const car = { hl: spec.length / 2, hw: spec.width / 2, x: 0, z: 0, a: 0 };
  const corners = () => {
    const c = Math.cos(a), s = Math.sin(a);
    const cx = x + b * c, cz = z + b * s;
    const f = spec.length / 2, w = spec.width / 2;
    return [[cx + c * f - s * w, cz + s * f + c * w], [cx + c * f + s * w, cz + s * f - c * w],
      [cx - c * f + s * w, cz - s * f - c * w], [cx - c * f - s * w, cz - s * f + c * w]];
  };
  const collides = () => {
    car.x = x + b * Math.cos(a); car.z = z + b * Math.sin(a); car.a = a;
    for (const o of obstacles) if (collideOBB(car, o)) return true;
    for (const k of corners()) if (k[1] > 0.02) return true; // over the curb
    return false;
  };
  let moves = 0;
  let lastDir = 1;
  const ds = 0.04;
  for (const m of policy(P)) {
    if (m.ifTilted && Math.abs(a) < 0.012) continue;
    if (m.until === 'centre') {
      const d = P.xFinal - x;
      const dir = Math.sign(d);
      const room = dir > 0 ? roomFront(corners(), bounds) : roomRear(corners(), bounds);
      const go = Math.min(Math.abs(d), Math.max(0, room - ROOM));
      if (go > 0.25 && dir !== lastDir) moves++;
      x += dir * go;
      break;
    }
    if (m.dir !== lastDir) { moves++; lastDir = m.dir; }
    const k = m.steer / R;
    let travelled = 0;
    for (let i = 0; i < 2000; i++) {
      if (m.until === 'heading' && (m.dir * m.steer > 0 ? a >= m.target : a <= m.target)) break;
      if (m.until === 'dist' && travelled >= m.dist) break;
      if (m.room) {
        const cs = corners();
        if (m.dir < 0 && roomRear(cs, bounds) < ROOM) break;
        if (m.dir > 0 && roomFront(cs, bounds) < ROOM) break;
      }
      x += m.dir * ds * Math.cos(a);
      z += m.dir * ds * Math.sin(a);
      a += m.dir * ds * k;
      travelled += ds;
      if (collides()) return { ok: false };
    }
    if (m.ifTilted && travelled < ds) return { ok: false }; // no room to shuffle
  }
  if (Math.abs(a) > 0.03) return { ok: false };
  const cs = corners();
  if (roomFront(cs, bounds) < 0.05 || roomRear(cs, bounds) < 0.05) return { ok: false };
  return { ok: true, moves };
}

const roomRear = (cs, bounds) => Math.min(...cs.map((k) => k[0])) - bounds.rear;
const roomFront = (cs, bounds) => bounds.front - Math.max(...cs.map((k) => k[0]));

export class AIDriver {
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
    this.plan_ = planPark(this.world, this.spot, spec, this.rand, this.p.slop);
    if (!this.plan_) {
      // No clean plan: wing it from a sensible start.
      const R = spec.wheelbase / Math.tan(spec.maxSteer * STEER_FRAC);
      const bounds = spotBounds(this.world, this.spot);
      const xc = (bounds.rear + bounds.front) / 2;
      const b = centreAhead(spec);
      this.plan_ = { R, b, zf: -(0.22 + spec.width / 2), z0: -4.0, phi: 0.9, straight: 0, x0: xc - b + 5, xFinal: xc - b, moves: 9 };
    }
    this.moves = policy(this.plan_);
    this.move = null;
    this.phase = 'approach';
    this.timer = 0;
    this.stuck = 0;
  }

  nextMove(pose) {
    for (;;) {
      const r = this.moves.next();
      if (r.done) { this.move = null; this.phase = 'done'; return; }
      const m = r.value;
      if (m.ifTilted && Math.abs(pose.a) < 0.012) continue;
      if (m.correct) {
        // Re-aim the straight using where we actually are.
        const ph = -pose.a;
        m.dist = Math.max(0, (this.plan_.zf - pose.z - this.plan_.R * (1 - Math.cos(ph))) / Math.sin(ph));
      }
      this.move = { ...m, travelled: 0, steering: true };
      this.phase = 'move';
      this.timer = 0;
      return;
    }
  }

  // Returns {throttle, steer, handbrake}
  update(dt) {
    const c = this.car;
    const P = this.plan_;
    const pose = spotPose(this.spot, c.body, centreAhead(c.spec));
    const v = c.speed;
    const inp = { throttle: 0, steer: 0, handbrake: false };
    this.timer += dt;
    if (this.gaveUp) return inp;
    const go = (vt) => { inp.throttle = speedCtl(v, vt); };

    if (this.phase === 'approach') {
      const d = P.x0 - pose.x;
      inp.steer = clamp(0.5 * (P.z0 - pose.z) - 1.6 * pose.a, -1, 1);
      if (d > 0.05) go(Math.min(this.p.vmax, Math.sqrt(2 * DECEL * d)));
      else go(0);
      if ((d <= 0.05 && Math.abs(v) < 0.05) || d < -0.3) { this.phase = 'align'; this.timer = 0; }
    } else if (this.phase === 'align') {
      const d = P.x0 - pose.x;
      inp.steer = clamp(-1.5 * pose.a, -1, 1);
      if (Math.abs(d) > 0.05) go(Math.sign(d) * Math.min(0.8, Math.sqrt(2 * DECEL * Math.abs(d))));
      else go(0);
      if (Math.abs(d) <= 0.05 && Math.abs(v) < 0.03 && this.timer > this.p.pause) this.nextMove(pose);
    } else if (this.phase === 'move') {
      const m = this.move;
      const bounds = spotBounds(this.world, this.spot);
      if (m.until === 'centre') {
        const d = P.xFinal - pose.x;
        const room = d > 0 ? roomFront(pose.corners, bounds) : roomRear(pose.corners, bounds);
        const left = Math.min(Math.abs(d), Math.max(0, room - ROOM));
        inp.steer = 0;
        if (left > 0.04) go(Math.sign(d) * Math.min(0.7, Math.sqrt(2 * DECEL * left)));
        else { go(0); if (Math.abs(v) < 0.03) this.phase = 'done'; }
      } else {
        const target = m.steer * STEER_FRAC;
        inp.steer = target;
        if (m.steering) {
          go(0);
          if (Math.abs(c.steer * this.spot.hand - target * c.spec.maxSteer) < 0.02 && Math.abs(v) < 0.05) m.steering = false;
        } else {
          let left = Infinity;
          if (m.until === 'heading') left = Math.max(0, (m.dir * m.steer > 0 ? m.target - pose.a : pose.a - m.target)) * P.R;
          if (m.until === 'dist') { m.travelled += Math.abs(v) * dt; left = m.dist - m.travelled; }
          if (m.room) {
            const room = m.dir < 0 ? roomRear(pose.corners, bounds) : roomFront(pose.corners, bounds);
            left = Math.min(left, room - ROOM);
          }
          if (left > 0.01) go(m.dir * Math.min(this.p.varc, Math.max(0.2, Math.sqrt(2 * DECEL * left))));
          else {
            go(0);
            if (Math.abs(v) < 0.03) this.nextMove(pose);
          }
        }
      }
    } else {
      go(0);
    }

    // Stuck detection: commanded to move but not moving (blocked or rammed).
    if (inp.throttle !== 0 && Math.abs(v) < 0.05 && this.phase !== 'done') {
      this.stuck += dt;
      if (this.stuck > 3) {
        this.attempts++;
        if (this.attempts > 2) this.gaveUp = true;
        else this.replan();
      }
    } else this.stuck = 0;
    inp.steer *= this.spot.hand; // planned in the spot frame, which is mirrored when the curb is on the left
    return inp;
  }
}

export function speedCtl(v, vt) {
  if (vt === 0) {
    if (v > 0.15) return -1;
    if (v < -0.15) return 1;
    return 0;
  }
  if (vt > 0) {
    if (v < -0.15) return 1;
    if (v < vt) return clamp((vt - v) * 3, 0.15, 1);
    if (v > vt + 0.4) return -1;
    return 0;
  }
  if (v > 0.15) return -1;
  if (v > vt) return -clamp((v - vt) * 3, 0.15, 1);
  if (v < vt - 0.4) return 1;
  return 0;
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
