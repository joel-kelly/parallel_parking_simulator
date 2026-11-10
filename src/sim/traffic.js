// Traffic: NPC cars that cruise along a lane, brake for anything in the way,
// honk at you when you're the thing in the way, and loop around off-screen.
import { makeCar, trafficSpec, driveCar } from './vehicles.js';
import { LANE, CURB } from './level.js';
import { collideOBB } from './physics.js';
import { wrapAngle } from './spot.js';
import { speedCtl, clamp } from './ai.js';

const FAR = 5000; // where cars wait between laps (nothing is out there)

export class Traffic {
  constructor(world, lanes) {
    this.world = world;
    this.cars = [];
    const lv = world.level;
    for (const lane of lanes) {
      const span = lv.xMax - lv.xMin - 16;
      for (let i = 0; i < lane.count; i++) {
        const spec = trafficSpec(world.rand);
        const x = lv.xMin + 8 + (i + 0.5) * span / lane.count + (world.rand() - 0.5) * 6;
        const car = makeCar(spec, { x, z: lane.dir * LANE, a: lane.dir > 0 ? 0 : Math.PI }, 'car');
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
  }

  // Called once the world has every body: don't start on top of anything.
  settle() {
    for (const c of this.cars) if (this.overlapsAny(c.body, c, 2.5)) this.park(c, 1 + this.world.rand() * 3);
  }

  overlapsAny(body, self, pad) {
    const probe = { x: body.x, z: body.z, a: body.a, hl: body.hl + pad, hw: body.hw + 0.3 };
    for (const o of this.world.cars) if (o !== self && !o.off && collideOBB(probe, o.body)) return true;
    for (const pk of this.world.parked) if (collideOBB(probe, pk.body)) return true;
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
    b.x = dir > 0 ? lv.xMin + 6 : lv.xMax - 6;
    b.z = dir * LANE;
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
      driveCar(c, this.drive(c, dt), dt, this.world.grip);
      const b = c.body;
      if ((c.lane.dir > 0 && b.x > lv.xMax - 5) || (c.lane.dir < 0 && b.x < lv.xMin + 5)) this.park(c, 0.5 + this.world.rand() * 3);
    }
  }

  drive(c, dt) {
    const b = c.body, dir = c.lane.dir;
    const laneA = dir > 0 ? 0 : Math.PI, laneZ = dir * LANE;
    const ea = wrapAngle(laneA - b.a);
    const off = (b.z - laneZ) * dir; // > 0: right of the lane centre
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
    if (Math.abs(ea) > 1.2 || Math.abs(b.z) > CURB - 0.6) vt = 0;
    return { throttle: speedCtl(c.speed, vt), steer, handbrake: false };
  }
}
