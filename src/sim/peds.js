// Pedestrians: they stroll the sidewalks, jaywalk, stop in the road to check
// their phone, and dive out of the way (always, cartoonishly) of cars.
import { CURB, LANE } from './level.js';
import { toLocal } from './physics.js';

const WALK = 1.3;
const HURRY = 3.8;
const SHIRTS = [0xff5555, 0x55ff55, 0x5555ff, 0xff55ff, 0x55ffff, 0xffff55, 0xffffff, 0xaa00aa, 0x00aaaa];
const PANTS = [0x0000aa, 0x555555, 0xaa5500, 0x000000];
const SKINS = [0xffaa55, 0xaa5500, 0xffdd99, 0x885522];

export class Pedestrians {
  constructor(world, n) {
    this.world = world;
    this.list = [];
    const r = world.rand, lv = world.level;
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    for (let i = 0; i < n; i++) {
      const side = r() < 0.5 ? 1 : -1;
      this.list.push({
        id: i, x: lv.xMin + 10 + r() * (lv.xMax - lv.xMin - 20), z: side * (CURB + 1.0 + r() * 2.4), y: 0,
        side, facing: r() < 0.5 ? 1 : -1, state: 'walk', t: 2 + r() * 10, speed: WALK,
        vx: 0, vz: 0, vy: 0, shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hat: r() < 0.35,
        scaredT: 0, phase: r() * 6, waited: false, hurried: false,
      });
    }
  }

  // Everyone in the road within earshot gets a move on.
  hearHorn(car) {
    const b = car.body;
    for (const p of this.list) {
      if (Math.hypot(p.x - b.x, p.z - b.z) > 18) continue;
      if (p.state === 'wait' || p.state === 'cross') { p.state = 'cross'; p.speed = HURRY; p.hurried = true; p.waited = true; }
    }
  }

  step(dt) {
    const lv = this.world.level, r = this.world.rand;
    for (const p of this.list) {
      p.t -= dt;
      if (p.scaredT > 0) p.scaredT -= dt;
      if (p.state === 'walk') {
        p.x += p.facing * WALK * dt;
        p.phase += dt * 6;
        if (p.x < lv.xMin + 6 || p.x > lv.xMax - 6) p.facing *= -1;
        if (p.t <= 0) {
          const rp = lv.ramp;
          const onRamp = rp && p.x > rp.x0 - 3 && p.x < rp.x0 + rp.len + 3;
          if (!this.carNear(p, 12) && !onRamp) { p.state = 'cross'; p.side = -p.side; p.speed = WALK; p.waited = false; p.hurried = false; }
          p.t = 6 + r() * 12;
        }
      } else if (p.state === 'cross') {
        const tz = p.side * (CURB + 1.2 + (p.id % 3) * 0.7);
        const dz = Math.sign(tz - p.z) || 1;
        p.z += dz * p.speed * dt;
        p.phase += dt * (p.speed > WALK ? 14 : 6);
        if (!p.waited && Math.abs(Math.abs(p.z) - LANE) < 0.4) {
          p.waited = true; p.state = 'wait'; p.t = 2 + r() * 3.5;
        }
        if ((tz - p.z) * dz <= 0) { p.z = tz; p.state = 'walk'; p.speed = WALK; p.t = 4 + r() * 10; }
      } else if (p.state === 'wait') {
        if (p.t <= 0) { p.state = 'cross'; p.speed = WALK; }
      } else if (p.state === 'dive') {
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt; p.vy -= 22 * dt;
        if (p.y <= 0) {
          p.y = 0; p.state = 'cross'; p.speed = HURRY; p.hurried = true; p.waited = true;
        }
        continue;
      }
      // Anything bearing down on them? Dive.
      for (const c of this.world.cars) {
        if (c.off || c.body.sleeping || Math.abs(c.speed) < 0.8) continue;
        const b = c.body;
        const [lx, lz] = toLocal(b, p.x, p.z);
        const reach = 1.4 + Math.abs(c.speed) * 0.3;
        const inPath = c.speed > 0 ? (lx > 0 && lx < b.hl + reach) : (lx < 0 && lx > -b.hl - reach);
        if (Math.abs(lz) < b.hw + 0.6 && (inPath || Math.abs(lx) < b.hl + 0.2)) { this.dive(p, c, lz); break; }
      }
    }
  }

  dive(p, car, lz) {
    const b = car.body;
    const sideSign = lz >= 0 ? 1 : -1;
    const sx = -Math.sin(b.a) * sideSign, sz = Math.cos(b.a) * sideSign; // sideways, away from the car
    p.vx = sx * 5 + b.vx * 0.25; p.vz = sz * 5 + b.vz * 0.25; p.vy = 5.5; p.y = 0.01;
    p.state = 'dive';
    p.diveA = Math.atan2(p.vz, p.vx);
    p.side = Math.sign(p.z + sz * 4) || 1;
    if (p.scaredT <= 0) {
      p.scaredT = 3;
      if (car.isPlayer || car.isAI) car.scares++;
      this.world.emit({ type: 'scare', ped: p, car, x: p.x, z: p.z });
    }
  }

  carNear(p, d) {
    for (const c of this.world.cars) if (!c.off && Math.hypot(c.body.x - p.x, c.body.z - p.z) < d) return true;
    return false;
  }
}
