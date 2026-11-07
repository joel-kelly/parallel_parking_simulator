import { makeBody, collideOBB, closingSpeed, resolve, integrate } from './physics.js';
import { driveCar, centreAhead } from './vehicles.js';
import { PROPS, CURB, BUILDING_FACADE_HIT, BUILDING_COLLAPSE } from './level.js';
import { AIDriver } from './ai.js';
import { evaluatePark } from './spot.js';

const SUB = 1 / 120;
const PARK_HOLD = 1.5; // seconds stationary in the spot to count as parked
export const MOVE_DIST = 0.25;

function makeCar(spec, pose, kind) {
  const body = makeBody({
    kind, x: pose.x, z: pose.z, a: pose.a,
    hl: spec.length / 2, hw: spec.width / 2, mass: spec.mass,
    restitution: 0.3, friction: 0.4,
  });
  return {
    spec, body, steer: 0, gear: 'D', moves: 0, hasMoved: false, speed: 0,
    dings: 0, damage: 0, curbHops: 0, wheelsOnCurb: 0, propsBroken: 0,
    parkTimer: 0, parked: false, lastHit: new Map(), wheelH: [0, 0, 0, 0],
    dir: 0, pendingDir: 0, pendingDist: 0,
  };
}

export class World {
  constructor(level, playerSpec, opts = {}) {
    this.level = level;
    this.time = 0;
    this.events = [];
    this.destruction = 0;
    this.acc = 0;
    this.finished = false;

    this.player = makeCar(playerSpec, level.playerStart, 'car');
    this.player.isPlayer = true;
    this.cars = [this.player];

    this.parked = level.parked.map((p) => {
      const body = makeBody({
        kind: 'parked', x: p.x, z: p.z, a: p.a, hl: p.length / 2, hw: p.width / 2,
        mass: 1300 + p.length * 60, restitution: 0.25, friction: 0.6, linDamp: 1.2, angDamp: 1.5,
      });
      body.sleeping = true;
      return { info: p, body, damage: 0, wrecked: false };
    });

    this.props = level.props.map((p) => {
      const d = PROPS[p.type];
      const body = makeBody({
        kind: 'prop', x: p.x, z: p.z, a: p.a, hl: d.hl, hw: d.hw,
        isStatic: true, breakSpeed: d.breakSpeed, restitution: 0.1,
      });
      return { type: p.type, def: d, body, broken: false };
    });

    this.walls = level.walls.map((w) => makeBody({ ...w, isStatic: true, restitution: 0.15, friction: 0.7 }));

    this.playerSpot = level.spots.find((s) => s.owner === 'player') || null;
    this.ai = null;
    if (opts.aiSpec && level.aiStart) {
      const aiCar = makeCar(opts.aiSpec, level.aiStart, 'car');
      aiCar.isAI = true;
      this.cars.push(aiCar);
      const spot = level.spots.find((s) => s.owner === 'ai');
      this.ai = { car: aiCar, spot, driver: new AIDriver(this, aiCar, spot, opts.aiProfile, opts.rand) };
    }

    this.statics = [...this.walls];
    this.buildings = level.buildings.map((info, i) => ({
      info, damage: 0, facade: false, collapsed: false, body: this.walls.find((w) => w.building === i),
    }));
    this.dynamics = [...this.cars.map((c) => c.body), ...this.parked.map((p) => p.body)];
    this.bodyOwner = new Map();
    for (const c of this.cars) this.bodyOwner.set(c.body, { car: c });
    for (const p of this.parked) this.bodyOwner.set(p.body, { parked: p });
    for (const p of this.props) this.bodyOwner.set(p.body, { prop: p });
  }

  emit(e) { this.events.push(e); }

  step(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) {
      this.substep(SUB, input);
      this.acc -= SUB;
    }
  }

  substep(dt, input) {
    this.time += dt;
    const p = this.player;
    driveCar(p, p.parked && this.level.mode !== 'wreck' ? { throttle: 0, steer: 0, handbrake: true } : input, dt);
    if (this.ai) {
      const aiIn = this.ai.car.parked ? { throttle: 0, steer: 0, handbrake: true } : this.ai.driver.update(dt);
      driveCar(this.ai.car, aiIn, dt);
    }
    for (const c of this.cars) if (Math.abs(c.speed) > 0.5) c.hasMoved = true;

    // Parked cars: brakes on. Constant friction decel on top of damping.
    for (const pk of this.parked) {
      const b = pk.body;
      if (b.sleeping) continue;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const k = Math.max(0, sp - 3 * dt) / sp;
        b.vx *= k; b.vz *= k;
      }
      if (sp < 0.03 && Math.abs(b.w) < 0.03) { b.vx = b.vz = b.w = 0; b.sleeping = true; }
    }

    for (const b of this.dynamics) if (!b.sleeping) integrate(b, dt);
    this.collide();
    for (const c of this.cars) this.updateCar(c, dt);
  }

  collide() {
    const dyn = this.dynamics;
    for (let i = 0; i < dyn.length; i++) {
      const a = dyn[i];
      if (a.sleeping) continue;
      for (let j = 0; j < dyn.length; j++) {
        if (j === i) continue;
        const b = dyn[j];
        if (!b.sleeping && j < i) continue; // awake pairs handled once
        this.contact(a, b);
      }
      for (const s of this.statics) this.contact(a, s);
      for (const pr of this.props) if (!pr.broken) this.contact(a, pr.body);
    }
  }

  contact(a, b) {
    const c = collideOBB(a, b);
    if (!c) return;
    const impact = closingSpeed(a, b, c);
    const ob = this.bodyOwner.get(b);

    if (ob && ob.prop) {
      const pr = ob.prop;
      // heavier vehicles smash things more easily
      const eff = impact * Math.sqrt(a.mass / 1200);
      if (eff > pr.def.breakSpeed && (a.kind === 'car' || impact > 1.5)) {
        pr.broken = true;
        this.destruction += pr.def.value;
        const slow = 1 - Math.min(0.35, 60 / a.mass * (pr.def.breakSpeed + 0.5));
        a.vx *= slow; a.vz *= slow;
        const owner = this.bodyOwner.get(a);
        if (owner && owner.car) owner.car.propsBroken++;
        this.emit({ type: 'break', prop: pr, impact, vx: a.vx, vz: a.vz, x: c.px, z: c.pz, by: owner && owner.car });
        return;
      }
    }

    if (b.sleeping) b.sleeping = false;
    resolve(a, b, c);
    if (impact > 0.25) this.hit(a, b, impact, c);
  }

  hit(a, b, impact, c) {
    const oa = this.bodyOwner.get(a) || {};
    const ob = this.bodyOwner.get(b) || {};
    for (const [o, other] of [[oa, b], [ob, a]]) {
      if (o.car) {
        const car = o.car;
        const last = car.lastHit.get(other) || -10;
        if (this.time - last > 0.6) {
          car.dings++;
          car.damage += impact * impact * 4 + impact * 6;
          this.emit({ type: 'ding', car, impact, x: c.px, z: c.pz, other });
        }
        car.lastHit.set(other, this.time);
      }
      if (o.parked) {
        const pk = o.parked;
        const before = pk.damage;
        pk.damage += impact * impact * 6;
        if (impact > 1.0) this.destruction += Math.round(impact * 120);
        if (!pk.wrecked && pk.damage > 260) {
          pk.wrecked = true;
          this.destruction += 5000;
          this.emit({ type: 'wreck', parked: pk, x: pk.body.x, z: pk.body.z });
        } else if (pk.damage - before > 2) {
          this.emit({ type: 'dent', parked: pk, impact });
        }
      }
    }
    if (b.kind === 'building' && impact > BUILDING_FACADE_HIT) this.hitBuilding(this.buildings[b.building], a, impact, c);
    if (b.kind === 'barricade' && impact > 2) this.emit({ type: 'smash', x: c.px, z: c.pz, impact, nx: c.nx, nz: c.nz });
  }

  hitBuilding(bd, by, impact, c) {
    if (bd.collapsed) return;
    // Heavier vehicles do more damage.
    bd.damage += impact * impact * by.mass / 1200;
    this.destruction += Math.round(impact * 200);
    const owner = this.bodyOwner.get(by);
    const car = owner && owner.car;
    if (!bd.facade) {
      bd.facade = true;
      this.destruction += 3000;
      this.emit({ type: 'facade', building: bd, x: c.px, z: c.pz, impact, nx: c.nx, nz: c.nz, by: car });
    } else {
      this.emit({ type: 'smash', x: c.px, z: c.pz, impact, nx: c.nx, nz: c.nz });
    }
    if (bd.damage >= BUILDING_COLLAPSE) {
      bd.collapsed = true;
      const w = bd.info.x1 - bd.info.x0;
      const value = 20000 + Math.round(w * bd.info.height * 150);
      this.destruction += value;
      this.statics = this.statics.filter((s) => s !== bd.body);
      this.emit({ type: 'collapse', building: bd, value, by: car });
    }
  }

  updateCar(car, dt) {
    const b = car.body;
    // A "move" is a change of direction that actually goes somewhere (25cm+),
    // so tiny nudges don't count against you.
    if (Math.abs(car.speed) > 0.05) {
      const d = Math.sign(car.speed);
      if (d === car.dir) car.pendingDist = 0;
      else {
        if (d !== car.pendingDir) { car.pendingDir = d; car.pendingDist = 0; }
        car.pendingDist += Math.abs(car.speed) * dt;
        if (car.pendingDist > MOVE_DIST) {
          if (car.dir !== 0) car.moves++;
          car.dir = d;
          car.pendingDist = 0;
        }
      }
    }
    const s = car.spec;
    const c = Math.cos(b.a), sn = Math.sin(b.a);
    const ahead = centreAhead(s);
    const front = s.wheelbase - ahead, back = -ahead;
    const hw = s.width / 2 - 0.15;
    const wheels = [[front, hw], [front, -hw], [back, -hw], [back, hw]];
    let on = 0;
    wheels.forEach(([f, l], i) => {
      const x = b.x + c * f - sn * l;
      const z = b.z + sn * f + c * l;
      const onCurb = Math.abs(z) > CURB;
      car.wheelH[i] = onCurb ? 1 : 0;
      if (onCurb) on++;
    });
    if (on > car.wheelsOnCurb && car.wheelsOnCurb === 0) {
      car.curbHops++;
      if (Math.abs(car.speed) > 2) { b.vx *= 0.9; b.vz *= 0.9; }
      this.emit({ type: 'curb', car, speed: Math.abs(car.speed) });
    }
    car.wheelsOnCurb = on;

    // Parking detection
    const spot = car.isAI ? (this.ai && this.ai.spot) : this.playerSpot;
    if (!spot || car.parked || this.level.mode === 'wreck') return;
    const ev = evaluatePark(this, car, spot);
    car.lastEval = ev;
    const still = Math.abs(car.speed) < 0.08 && Math.abs(b.w) < 0.05;
    if (ev.inSpot && ev.angle < 15 && still && car.hasMoved) {
      car.parkTimer += dt;
      if (car.parkTimer >= PARK_HOLD) {
        car.parked = true;
        car.parkedAt = this.time;
        car.finalEval = ev;
        this.emit({ type: 'parked', car, eval: ev });
      }
    } else car.parkTimer = 0;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export { PARK_HOLD };
