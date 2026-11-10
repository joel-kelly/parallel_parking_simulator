import { makeBody } from './physics.js';

// Player vehicles. Sizes in metres, speeds in m/s.
// `cost` is the number of points needed to unlock.
// `extraRoom` is added to every spot for that vehicle (a bus gets a bus-sized spot).
export const VEHICLES = [
  {
    id: 'bean', name: 'THE BEAN', cost: 0,
    blurb: 'Tiny, beige-ish, emotionally fragile. Perfect for beginners.',
    length: 3.6, width: 1.7, height: 1.45, wheelbase: 2.35, rearOverhang: 0.6,
    maxSteer: 0.66, accel: 4.5, maxSpeed: 16, maxReverse: 5, mass: 950,
    wheelRadius: 0.32, color: 0xffff55, accent: 0xff55ff, style: 'hatch',
  },
  {
    id: 'za', name: 'ZA WAGON', cost: 0,
    blurb: 'Pizza delivery van. 30 minutes or your bumper is free.',
    length: 4.6, width: 1.9, height: 2.1, wheelbase: 2.9, rearOverhang: 0.8,
    maxSteer: 0.62, accel: 4.0, maxSpeed: 15, maxReverse: 4.5, mass: 1600,
    wheelRadius: 0.36, color: 0xff5555, accent: 0xffffff, style: 'van',
  },
  {
    id: 'kart', name: 'SHOPPING KART', cost: 400,
    blurb: 'A go-kart welded to a shopping trolley. Twitchy. Illegal. Fast.',
    length: 2.4, width: 1.3, height: 1.2, wheelbase: 1.6, rearOverhang: 0.35,
    maxSteer: 0.8, accel: 7.0, maxSpeed: 19, maxReverse: 6, mass: 420,
    wheelRadius: 0.22, color: 0xaaaaaa, accent: 0xff5555, style: 'kart',
  },
  {
    id: 'scoop', name: 'MR. SCOOPS', cost: 800,
    blurb: 'Ice cream truck. The jingle is non-negotiable.',
    length: 5.2, width: 2.0, height: 2.5, wheelbase: 3.2, rearOverhang: 1.0,
    maxSteer: 0.6, accel: 3.5, maxSpeed: 14, maxReverse: 4, mass: 2400,
    wheelRadius: 0.38, color: 0xffffff, accent: 0x55ffff, style: 'truck',
  },
  {
    id: 'monster', name: 'GROUND POUNDER', cost: 1500,
    blurb: 'Monster truck. Parking is optional. Scenery is a suggestion.',
    length: 4.8, width: 2.4, height: 2.6, wheelbase: 3.0, rearOverhang: 0.9,
    maxSteer: 0.62, accel: 6.5, maxSpeed: 20, maxReverse: 6, mass: 3200,
    wheelRadius: 0.75, color: 0x55ff55, accent: 0xff5555, style: 'monster',
  },
  {
    id: 'limo', name: 'STRETCH PRINCE', cost: 2500,
    blurb: 'A limousine. Good luck. Seriously, good luck.',
    length: 7.2, width: 1.95, height: 1.5, wheelbase: 5.0, rearOverhang: 1.0,
    maxSteer: 0.6, accel: 4.0, maxSpeed: 17, maxReverse: 4.5, mass: 2600,
    wheelRadius: 0.34, color: 0x333355, accent: 0xaaaaaa, style: 'limo',
  },
  {
    id: 'weenie', name: 'THE WEENIE', cost: 4000,
    blurb: 'A car shaped like a hot dog. You have peaked.',
    length: 5.4, width: 2.0, height: 2.2, wheelbase: 3.3, rearOverhang: 1.05,
    maxSteer: 0.62, accel: 4.5, maxSpeed: 16, maxReverse: 5, mass: 2000,
    wheelRadius: 0.36, color: 0xaa5500, accent: 0xffff55, style: 'weenie',
  },
  {
    id: 'bus', name: 'BIG YELLER', cost: 6000,
    blurb: 'A school bus. Forty seats. Zero visibility. Pure hubris.',
    length: 9.0, width: 2.4, height: 3.0, wheelbase: 5.6, rearOverhang: 1.8,
    maxSteer: 0.62, accel: 3.2, maxSpeed: 14, maxReverse: 4, mass: 6000, extraRoom: 0.6,
    wheelRadius: 0.45, color: 0xffff55, accent: 0x000000, style: 'bus',
  },
];

// Cars you park next to (and smash into).
export const NPC_CARS = [
  { style: 'sedan', length: 4.4, width: 1.8, height: 1.45 },
  { style: 'hatch', length: 3.9, width: 1.75, height: 1.5 },
  { style: 'van', length: 4.9, width: 1.95, height: 2.0 },
  { style: 'pickup', length: 5.2, width: 2.0, height: 1.8 },
  { style: 'sedan', length: 4.6, width: 1.85, height: 1.4 },
];

export const NPC_COLORS = [0x5555ff, 0xff5555, 0x55ff55, 0xff55ff, 0x55ffff, 0xaaaaaa, 0xffaa00, 0x0000aa];

export function vehicleById(id) {
  return VEHICLES.find((v) => v.id === id) || VEHICLES[0];
}

// A drivable spec for a traffic car, based on one of the parked-car shapes.
export function trafficSpec(rand) {
  const t = NPC_CARS[Math.floor(rand() * NPC_CARS.length)];
  return {
    ...t, id: 'npc', name: 'SOME GUY', color: NPC_COLORS[Math.floor(rand() * NPC_COLORS.length)], accent: 0xffffff,
    wheelbase: t.length * 0.62, rearOverhang: t.length * 0.19,
    maxSteer: 0.6, accel: 4.0, maxSpeed: 14, maxReverse: 4, mass: 1400, wheelRadius: 0.32,
  };
}

// Distance from the car's centre to its rear axle.
export function centreAhead(spec) {
  return spec.length / 2 - spec.rearOverhang;
}

export function minTurnRadius(spec) {
  return spec.wheelbase / Math.tan(spec.maxSteer);
}

export const NITRO_MAX = 100;

// A car in the world: physics body plus driving state and the counters it's graded on.
export function makeCar(spec, pose, kind = 'car') {
  const body = makeBody({
    kind, x: pose.x, z: pose.z, a: pose.a,
    hl: spec.length / 2, hw: spec.width / 2, mass: spec.mass,
    restitution: 0.3, friction: 0.4,
  });
  return {
    spec, body, steer: 0, gear: 'D', moves: 0, hasMoved: false, speed: 0, slip: 0,
    dings: 0, damage: 0, curbHops: 0, wheelsOnCurb: 0, propsBroken: 0, scares: 0, honks: 0,
    parkTimer: 0, parked: false, lastHit: new Map(), wheelH: [0, 0, 0, 0],
    dir: 0, pendingDir: 0, pendingDist: 0,
    nitro: NITRO_MAX, nitroOn: false, lastInput: { throttle: 0, steer: 0, handbrake: false },
  };
}

/**
 * Arcade-ish bicycle model. No gears to fiddle with: hold W to go forward,
 * hold S to brake and then reverse. Gear flips automatically once stopped.
 *
 * input: { throttle: -1..1, steer: -1..1, handbrake: bool, nitro?: bool }
 * grip: 1 on dry tarmac, lower on rain/ice (slower braking, sliding tyres).
 * grounded: false while airborne (no grip at all).
 */
export function driveCar(car, input, dt, grip = 1, grounded = true) {
  const spec = car.spec;
  const b = car.body;
  const c = Math.cos(b.a), s = Math.sin(b.a);
  // Read speed in the heading we last set the velocity in. Tyres carry the
  // velocity round with the car as it turns; measuring in the new heading
  // would turn leftover sideways slip into extra forward speed every tick.
  const va = car.velA ?? b.a;
  const vc = Math.cos(va), vs = Math.sin(va);
  let v = b.vx * vc + b.vz * vs;
  car.lastInput = input;

  // Steering wheel turns at a finite rate and self-centres when released.
  const target = input.steer * spec.maxSteer;
  const rate = (input.steer === 0 ? 3.0 : 2.2) * dt;
  car.steer += Math.max(-rate, Math.min(rate, target - car.steer));
  if (!grounded) { car.speed = b.vx * c + b.vz * s; car.velA = undefined; car.slip = 0; return; } // no grip in the air

  const brake = 11 * (0.3 + 0.7 * grip);
  const accel = spec.accel * (0.6 + 0.4 * grip) * (input.nitro ? 2.6 : 1);
  const vmax = spec.maxSpeed * (input.nitro ? 1.7 : 1);
  const t = input.throttle;
  if (input.handbrake) {
    v = approach(v, 0, 14 * (0.25 + 0.75 * grip) * dt);
  } else if (t > 0) {
    if (v < -0.15) v = approach(v, 0, brake * dt);
    else {
      if (car.gear !== 'D' && v > -0.15) shift(car, 'D');
      v += accel * t * dt * (1 - Math.max(0, v) / vmax);
    }
  } else if (t < 0) {
    if (v > 0.15) v = approach(v, 0, brake * dt);
    else {
      if (car.gear !== 'R' && v < 0.15) shift(car, 'R');
      v += accel * 0.8 * t * dt * (1 - Math.max(0, -v) / spec.maxReverse);
    }
  } else {
    v = approach(v, 0, 2.2 * (0.3 + 0.7 * grip) * dt); // engine braking / rolling resistance
  }

  const L = spec.wheelbase;
  const wDesired = v * Math.tan(car.steer) / L;
  const ahead = centreAhead(spec);
  const sx = -s, sz = c;
  // Tyres grip hard sideways: blend lateral slip and yaw toward the ideal
  // (no-slip) values. Forward speed is applied directly.
  const lat = -b.vx * vs + b.vz * vc;
  const latDesired = wDesired * ahead;
  car.slip = lat - latDesired;
  const gripRate = (input.handbrake ? 2.5 : 30) * grip;
  const g = 1 - Math.exp(-gripRate * dt);
  const latNew = lat + (latDesired - lat) * g;
  b.vx = v * c + latNew * sx;
  b.vz = v * s + latNew * sz;
  b.w += (wDesired - b.w) * g;
  car.speed = v;
  car.velA = b.a;
}

function shift(car, gear) {
  car.gear = gear;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}
