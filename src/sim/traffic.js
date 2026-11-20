// Traffic: NPC cars that cruise along a lane (lane.dir is the direction of
// travel; which side of the road that puts them on depends on level.hand,
// unless the lane gives its own z), brake for anything in the way,
// honk at you when you're the thing in the way, and loop around off-screen.
// In the car park some of them start out parked and back out when you come
// past ("leavers"), without looking, as is traditional.
import { makeCar, trafficSpec, driveCar } from './vehicles.js';
import { LANE, CURB } from './level.js';
import { collideOBB } from './physics.js';
import { wrapAngle } from './spot.js';
import { speedCtl, clamp } from './ai.js';
import { initAir } from './air.js';

const FAR = 5000; // where cars wait between laps (nothing is out there)
const laneZ = (lane, lv) => lane.z ?? lane.dir * lv.hand * LANE;

export class Traffic {
  constructor(world, lanes) {
    this.world = world;
    this.cars = [];
    const lv = world.level;
    for (const lane of lanes) {
      const hi = lane.xMax ?? lv.xMax;
      const span = hi - lv.xMin - 16;
      for (let i = 0; i < lane.count; i++) {
        const spec = trafficSpec(world.rand, lv.food);
        const x = lv.xMin + 8 + (i + 0.5) * span / lane.count + (world.rand() - 0.5) * 6;
        const car = makeCar(spec, { x, z: laneZ(lane, lv), a: lane.dir > 0 ? 0 : Math.PI }, 'car');
        initAir(car);
        car.isTraffic = true;
        car.lane = lane;
        car.blockedT = 0;
        car.honkT = 0;
        car.off = false;
        car.offT = 0;
        world.cars.push(car);
        this.cars.push(car);
      }
    }
    // Parked cars that are about to leave.
    for (const lv0 of lv.leavers || []) {
      const spec = {
        ...lv0, id: 'npc', name: 'SOMEONE LEAVING', accent: lv0.accent ?? 0xffffff,
        wheelbase: lv0.length * 0.62, rearOverhang: lv0.length * 0.19,
        maxSteer: 0.62, accel: 3.5, maxSpeed: 12, maxReverse: 2.2, mass: 1400, wheelRadius: 0.32,
      };
      const car = makeCar(spec, { x: lv0.x, z: lv0.z, a: lv0.a }, 'car');
      initAir(car);
      Object.assign(car, {
        isTraffic: true, lane: lv0.lane, blockedT: 0, honkT: 0, off: false, offT: 0,
        leaving: 'wait', leaver: lv0, leaveT: 0,
      });
      world.cars.push(car);
      this.cars.push(car);
    }
  }

  // Called once the world has every body: don't start on top of anything.
  settle() {
    for (const c of this.cars) if (!c.leaving && this.overlapsAny(c.body, c, 2.5)) this.park(c, 1 + this.world.rand() * 3);
  }

  overlapsAny(body, self, pad) {
    const probe = { x: body.x, z: body.z, a: body.a, hl: body.hl + pad, hw: body.hw + 0.3 };
    for (const o of this.world.cars) if (o !== self && !o.off && collideOBB(probe, o.body)) return true;
    for (const pk of this.world.parked) if (collideOBB(probe, pk.body)) return true;
    for (const ct of this.world.carts) if (collideOBB(probe, ct.body)) return true;
    return false;
  }

  // Take a car off the street for a while.
  park(c, wait) {
    c.off = true;
    c.offT = wait;
    const b = c.body;
    b.x = FAR + this.cars.indexOf(c) * 30; b.z = 0;
    b.vx = b.vz = b.w = 0;
    b.sleeping = true;
    c.speed = 0;
  }

  spawn(c) {
    const lv = this.world.level, b = c.body, dir = c.lane.dir;
    b.x = dir > 0 ? lv.xMin + 6 : (c.lane.xMax ?? lv.xMax) - 6;
    b.z = laneZ(c.lane, lv);
    b.a = dir > 0 ? 0 : Math.PI;
    b.vx = b.vz = b.w = 0;
    c.steer = 0;
    if (this.overlapsAny(b, c, 4)) { b.x = FAR + this.cars.indexOf(c) * 30; return false; }
    b.sleeping = false;
    return true;
  }

  step(dt) {
    const lv = this.world.level;
    for (const c of this.cars) {
      if (c.off) {
        c.offT -= dt;
        if (c.offT > 0 || !this.spawn(c)) continue;
        c.off = false;
      }
      const input = c.leaving && c.leaving !== 'gone' ? this.leave(c, dt) : this.drive(c, dt);
      driveCar(c, input, dt, this.world.grip, !c.airborne);
      const b = c.body;
      const hi = c.lane.xMax ?? lv.xMax;
      if ((c.lane.dir > 0 && b.x > hi - 5) || (c.lane.dir < 0 && b.x < lv.xMin + 5)) this.park(c, 0.5 + this.world.rand() * 3);
    }
  }

  // A parked car pulling out: wait for someone to come past, then reverse out
  // of the stall, swing round to face along the aisle, and join the traffic.
  leave(c, dt) {
    const w = this.world, b = c.body, lv0 = c.leaver;
    const hold = { throttle: 0, steer: 0, handbrake: true };
    c.leaveT += dt;
    if (c.leaving === 'wait') {
      const p = w.player;
      const near = Math.abs(p.body.x - b.x) < lv0.trigger && Math.abs(p.body.z - lv0.lane.z) < 8 && !p.parked;
      if (near && c.leaveT > 3) {
        c.leaving = 'out';
        w.emit({ type: 'backout', car: c, x: b.x, z: b.z });
      }
      return hold;
    }
    // Something right behind? Stop and lean on the horn (it is your fault, apparently).
    const back = { x: b.x - Math.cos(b.a) * (b.hl + 0.9), z: b.z - Math.sin(b.a) * (b.hl + 0.9), a: b.a, hl: 0.9, hw: b.hw + 0.1 };
    let blocked = false;
    for (const o of w.cars) if (o !== c && !o.off && collideOBB(back, o.body)) { blocked = o; break; }
    if (blocked) {
      c.honkT -= dt;
      if (blocked.isPlayer && c.honkT <= 0) { c.honkT = 2 + w.rand() * 2; w.emit({ type: 'honk', car: c, x: b.x, z: b.z }); }
      return { throttle: speedCtl(c.speed, 0), steer: 0, handbrake: false };
    }
    const laneA = c.lane.dir > 0 ? 0 : Math.PI;
    const ea = wrapAngle(laneA - b.a);
    // depth of the car's centre past the stall's open edge, into the aisle
    const out = (lv0.rowOpen - b.z) * lv0.rowN;
    if (c.leaving === 'out') {
      if (out > b.hl * 0.3) c.leaving = 'turn';
      return { throttle: speedCtl(c.speed, -1.3), steer: 0, handbrake: false };
    }
    // reversing: steering away from where you want the nose to go turns it there
    if (Math.abs(ea) < 0.2 || out > 6) { c.leaving = 'gone'; return this.drive(c, dt); }
    return { throttle: speedCtl(c.speed, -1.3), steer: -Math.sign(ea), handbrake: false };
  }

  drive(c, dt) {
    const b = c.body, dir = c.lane.dir;
    const laneA = dir > 0 ? 0 : Math.PI, laneZ0 = laneZ(c.lane, this.world.level);
    const ea = wrapAngle(laneA - b.a);
    const off = (b.z - laneZ0) * dir; // > 0: right of the lane centre
    const steer = clamp(-0.5 * off + 1.8 * ea, -1, 1);

    // Look ahead for anything in the lane.
    const look = 4 + Math.max(0, c.speed) * 1.3;
    const ahead = { x: b.x + Math.cos(b.a) * (b.hl + look / 2), z: b.z + Math.sin(b.a) * (b.hl + look / 2), a: b.a, hl: look / 2, hw: b.hw + 0.25 };
    let blocked = null;
    for (const o of this.world.cars) {
      if (o === c || o.off) continue;
      if (collideOBB(ahead, o.body)) { blocked = o; break; }
    }
    if (!blocked) for (const pk of this.world.parked) if (collideOBB(ahead, pk.body)) { blocked = pk; break; }
    if (!blocked) for (const ct of this.world.carts) if (collideOBB(ahead, ct.body)) { blocked = ct; break; }

    let vt = c.lane.speed;
    if (blocked) { vt = 0; c.blockedT += dt; } else c.blockedT = 0;
    if (blocked && blocked.isPlayer && c.blockedT > 0.7) {
      c.honkT -= dt;
      if (c.honkT <= 0) {
        c.honkT = 2.5 + this.world.rand() * 2.5;
        this.world.emit({ type: 'honk', car: c, x: b.x, z: b.z });
      }
    }
    // Spun round or shoved onto the sidewalk: stop rather than mow down the town.
    const lost = this.world.level.lot ? Math.abs(b.z - laneZ0) > (c.leaver ? 6.5 : 3.2) : Math.abs(b.z) > CURB - 0.6;
    if (Math.abs(ea) > 1.2 || lost) vt = 0;
    return { throttle: speedCtl(c.speed, vt), steer, handbrake: false };
  }
}
