import { makeBody, collideOBB, closingSpeed, resolve, integrate } from './physics.js';
import { driveCar, centreAhead, makeCar, NITRO_MAX } from './vehicles.js';
import { PROPS, CURB, BUILDING_FACADE_HIT, BUILDING_COLLAPSE } from './level.js';
import { AIDriver } from './ai.js';
import { evaluatePark, spotBounds } from './spot.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './peds.js';
import { initAir, stepAir, carBottomAt, rampHeightClamped, RAMP_STEP } from './air.js';

const SUB = 1 / 120;
const PARK_HOLD = 1.5; // seconds stationary in the spot to count as parked
export const MOVE_DIST = 0.25;
export const COMBO_WINDOW = 2.5; // seconds between smashes to keep a combo alive
const STOP = { throttle: 0, steer: 0, handbrake: true };

export class World {
  constructor(level, playerSpec, opts = {}) {
    this.level = level;
    this.mods = level.mods || new Set();
    this.grip = level.grip ?? 1;
    this.rand = opts.rand || Math.random;
    this.time = 0;
    this.events = [];
    this.destruction = 0;
    this.combo = 0;
    this.mult = 1;
    this.comboBest = 0;
    this.lastDestroyT = -99;
    this.acc = 0;
    this.finished = false;

    this.player = makeCar(playerSpec, level.playerStart, 'car');
    initAir(this.player);
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

    this.playerSpots = level.spots.filter((s) => s.owner === 'player');
    this.playerSpot = this.playerSpots[0] || null;
    this.ai = null;
    if (opts.aiSpec && level.aiStart) {
      const aiCar = makeCar(opts.aiSpec, level.aiStart, 'car');
      initAir(aiCar);
      aiCar.isAI = true;
      this.cars.push(aiCar);
      const spot = level.spots.find((s) => s.owner === 'ai');
      this.ai = { car: aiCar, spot, driver: new AIDriver(this, aiCar, spot, opts.aiProfile, opts.rand) };
    }
    this.traffic = new Traffic(this, level.traffic || []);
    this.peds = new Pedestrians(this, level.peds || 0);

    this.statics = [...this.walls];
    this.buildings = level.buildings.map((info, i) => ({
      info, damage: 0, facade: false, collapsed: false, body: this.walls.find((w) => w.building === i),
    }));
    this.dynamics = [...this.cars.map((c) => c.body), ...this.parked.map((p) => p.body)];
    this.bodyOwner = new Map();
    for (const c of this.cars) this.bodyOwner.set(c.body, { car: c });
    for (const p of this.parked) this.bodyOwner.set(p.body, { parked: p });
    for (const p of this.props) this.bodyOwner.set(p.body, { prop: p });
    this.traffic.settle();

    // hazards
    this.quakeNext = 8 + this.rand() * 6;
    this.quakeT = 0;
    this.quakeKick = 0;
    this.creepT = 0;
    this.shrunk = 0;
  }

  emit(e) { this.events.push(e); }

  step(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) {
      this.substep(SUB, input);
      this.acc -= SUB;
    }
  }

  // The player's input after the mods have had their way with it.
  playerInput(input, dt) {
    const p = this.player;
    if (p.parked && this.level.mode !== 'wreck') return STOP;
    const inp = { throttle: input.throttle, steer: input.steer, handbrake: !!input.handbrake, nitro: false };
    if (this.mods.has('mirror')) inp.steer = -inp.steer;
    if (this.mods.has('sticky') && inp.throttle === 0 && !inp.handbrake) inp.throttle = 0.4;
    if (input.nitro && this.level.mode === 'wreck' && p.nitro > 0) {
      inp.nitro = true;
      p.nitro = Math.max(0, p.nitro - 40 * dt);
      p.nitroOn = true;
    } else {
      p.nitroOn = false;
      p.nitro = Math.min(NITRO_MAX, p.nitro + 12 * dt);
    }
    return inp;
  }

  substep(dt, input) {
    this.time += dt;
    const p = this.player;
    driveCar(p, this.playerInput(input, dt), dt, this.grip, !p.airborne);
    if (this.ai) {
      const aiIn = this.ai.car.parked ? STOP : this.ai.driver.update(dt);
      driveCar(this.ai.car, aiIn, dt, this.grip, !this.ai.car.airborne);
    }
    this.traffic.step(dt);
    this.peds.step(dt);
    this.stepHazards(dt);
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
    for (const c of this.cars) if (!c.off) stepAir(c, this.level, dt, (e) => this.emit(e));
    for (const c of this.cars) if (!c.off) this.updateCar(c, dt);
  }

  stepHazards(dt) {
    if (this.mods.has('quake')) {
      if (this.quakeT > 0) {
        this.quakeT -= dt;
        this.quakeKick -= dt;
        if (this.quakeKick <= 0) {
          this.quakeKick = 0.3;
          for (const pk of this.parked) this.kick(pk.body, 1.6);
          for (const c of this.cars) if (!c.off) this.kick(c.body, 0.6);
        }
      } else {
        this.quakeNext -= dt;
        if (this.quakeNext <= 0) {
          this.quakeT = 1.6;
          this.quakeKick = 0;
          this.quakeNext = 11 + this.rand() * 9;
          this.emit({ type: 'quake', duration: this.quakeT });
        }
      }
    }
    if (this.mods.has('shrink') && this.playerSpot && !this.player.parked) {
      const spot = this.playerSpot;
      const front = this.parked[spot.frontCar].body;
      const bounds = spotBounds(this, spot);
      const minLen = this.player.spec.length + 1.15 + (this.player.spec.extraRoom || 0); // never tighter than Insane
      const touching = collideOBB({ ...front, hl: front.hl + 0.15 }, this.player.body);
      if (bounds.front - bounds.rear > minLen && front.sleeping && !touching) {
        const v = 0.065;
        front.x -= spot.dir * v * dt;
        this.shrunk += v * dt;
        this.creepT += dt;
        if (this.creepT > 3.5) { this.creepT = 0; this.emit({ type: 'creep', x: front.x, z: front.z, body: front }); }
      }
    }
  }

  kick(b, k) {
    b.vx += (this.rand() - 0.5) * 2 * k;
    b.vz += (this.rand() - 0.5) * k;
    b.w += (this.rand() - 0.5) * 0.4;
    b.sleeping = false;
  }

  // The player leaned on the horn.
  honk() {
    this.player.honks++;
    this.peds.hearHorn(this.player);
  }

  // Destruction that counts toward a combo (smashing things in quick
  // succession multiplies the payout). Returns the value actually awarded.
  addDestruction(value, x, z) {
    if (this.time - this.lastDestroyT < COMBO_WINDOW) this.combo++; else this.combo = 1;
    this.lastDestroyT = this.time;
    this.mult = Math.min(8, 1 + Math.floor((this.combo - 1) / 2));
    this.comboBest = Math.max(this.comboBest, this.combo);
    const v = Math.round(value * this.mult);
    this.destruction += v;
    if (this.combo >= 3) this.emit({ type: 'combo', combo: this.combo, mult: this.mult, x, z });
    return v;
  }

  get comboLeft() { return Math.max(0, COMBO_WINDOW - (this.time - this.lastDestroyT)); }

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
    if (!this.overlapsInHeight(a, b, c)) return; // flying over it
    const impact = closingSpeed(a, b, c);
    const ob = this.bodyOwner.get(b);

    if (ob && ob.prop) {
      const pr = ob.prop;
      // heavier vehicles smash things more easily
      const eff = impact * Math.sqrt(a.mass / 1200);
      if (eff > pr.def.breakSpeed && (a.kind === 'car' || impact > 1.5)) {
        pr.broken = true;
        const slow = 1 - Math.min(0.35, 60 / a.mass * (pr.def.breakSpeed + 0.5));
        a.vx *= slow; a.vz *= slow;
        const owner = this.bodyOwner.get(a);
        const car = owner && owner.car;
        if (car) car.propsBroken++;
        const value = car && car.isPlayer ? this.addDestruction(pr.def.value, c.px, c.pz) : (this.destruction += pr.def.value, pr.def.value);
        this.emit({ type: 'break', prop: pr, impact, vx: a.vx, vz: a.vz, x: c.px, z: c.pz, by: car, value, mult: this.mult });
        return;
      }
    }

    if (b.sleeping) b.sleeping = false;
    resolve(a, b, c);
    if (impact > 0.25) this.hit(a, b, impact, c);
  }

  // Bottom and top heights of a body at a contact point.
  heightSpan(body, px, pz) {
    const o = this.bodyOwner.get(body);
    if (o && o.car) {
      const bot = carBottomAt(o.car, px, pz);
      return [bot, bot + o.car.spec.height];
    }
    if (o && o.parked) return [0, o.parked.info.height];
    if (o && o.prop) return [0, o.prop.def.h];
    // The ramp only blocks you where its edge is too tall to drive up.
    if (body.kind === 'ramp') return [-1, rampHeightClamped(this.level.ramp, px, pz) - RAMP_STEP];
    return [-Infinity, Infinity];
  }

  overlapsInHeight(a, b, c) {
    const [a0, a1] = this.heightSpan(a, c.px, c.pz);
    const [b0, b1] = this.heightSpan(b, c.px, c.pz);
    return a0 < b1 && b0 < a1;
  }

  hit(a, b, impact, c) {
    const oa = this.bodyOwner.get(a) || {};
    const ob = this.bodyOwner.get(b) || {};
    const byPlayer = (oa.car && oa.car.isPlayer) || (ob.car && ob.car.isPlayer);
    for (const [o, other] of [[oa, b], [ob, a]]) {
      if (o.car) {
        const car = o.car;
        const last = car.lastHit.get(other) || -10;
        if (this.time - last > 0.6) {
          car.dings++;
          car.damage += impact * impact * 4 + impact * 6;
          const otherOwner = this.bodyOwner.get(other) || {};
          this.emit({ type: 'ding', car, impact, x: c.px, z: c.pz, other, otherCar: otherOwner.car || null });
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
          const value = byPlayer ? this.addDestruction(5000, pk.body.x, pk.body.z) : (this.destruction += 5000, 5000);
          this.emit({ type: 'wreck', parked: pk, x: pk.body.x, z: pk.body.z, value, mult: this.mult });
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
      const value = this.addDestruction(3000, c.px, c.pz);
      this.emit({ type: 'facade', building: bd, x: c.px, z: c.pz, impact, nx: c.nx, nz: c.nz, by: car, value });
    } else {
      this.emit({ type: 'smash', x: c.px, z: c.pz, impact, nx: c.nx, nz: c.nz });
    }
    if (bd.damage >= BUILDING_COLLAPSE) {
      bd.collapsed = true;
      const w = bd.info.x1 - bd.info.x0;
      const value = this.addDestruction(20000 + Math.round(w * bd.info.height * 150), c.px, c.pz);
      this.statics = this.statics.filter((s) => s !== bd.body);
      this.emit({ type: 'collapse', building: bd, value, by: car });
    }
  }

  // The player's spot nearest to where the car is (Mystery Street has several).
  nearestSpot(car) {
    if (this.playerSpots.length <= 1) return this.playerSpot;
    let best = null, bd = Infinity;
    for (const s of this.playerSpots) {
      const d = Math.abs(s.cx - car.body.x);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
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

    // Parking detection (player and race AI only)
    if (!(car.isPlayer || car.isAI)) return;
    const spot = car.isAI ? (this.ai && this.ai.spot) : this.nearestSpot(car);
    if (!spot || car.parked || this.level.mode === 'wreck') return;
    const ev = evaluatePark(this, car, spot);
    car.lastEval = ev;
    car.lastSpot = spot;
    const still = Math.abs(car.speed) < 0.08 && Math.abs(b.w) < 0.05;
    if (ev.inSpot && ev.angle < 15 && still && car.hasMoved) {
      car.parkTimer += dt;
      if (car.parkTimer >= PARK_HOLD) {
        car.parked = true;
        car.parkedAt = this.time;
        car.finalEval = ev;
        car.parkedSpot = spot;
        this.emit({ type: 'parked', car, eval: ev, spot });
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
