// The up-and-down part of car physics, layered on top of the flat 2D sim.
// Each car gets a height (of its centre of mass), vertical speed, pitch and
// roll. Wheels and body corners are springs against the ground, so cars ride
// up curbs and ramps, fly off the end, and can land on their roof.
//
// pitch > 0 is nose up. roll > 0 is the right side (+side axis) up.
import { CURB, SIDEWALK_H } from './level.js';
import { centreAhead } from './vehicles.js';

export const G = 9.8;
const K_WHEEL = 80, C_WHEEL = 7;    // per wheel, per unit mass
const K_BODY = 260, C_BODY = 20;    // body panels hitting the ground
const MAX_PEN = 0.45;
const CURB_BEVEL = 0.3;
const MAX_GROUND_V = 12;
export const RAMP_STEP = 0.35;      // ramp edges lower than this can be driven over

// Ramp profile: a curved transition up to `theta`, then a straight run to the lip.
export function rampProfile(ramp, u) {
  const ut = ramp.R * Math.sin(ramp.theta);
  if (u <= ut) return ramp.R - Math.sqrt(ramp.R * ramp.R - u * u);
  return ramp.R * (1 - Math.cos(ramp.theta)) + (u - ut) * Math.tan(ramp.theta);
}

export function rampTop(ramp) {
  return rampProfile(ramp, ramp.len);
}

// Height of the ramp surface at (x, z), clamped into its footprint.
export function rampHeightClamped(ramp, x, z) {
  const u = Math.max(0, Math.min(ramp.len, x - ramp.x0));
  return rampProfile(ramp, u);
}

export function groundHeight(level, x, z) {
  return Math.max(curbHeight(z), rampHeight(level.ramp, x, z));
}

function curbHeight(z) {
  const az = Math.abs(z);
  return az <= CURB ? 0 : az >= CURB + CURB_BEVEL ? SIDEWALK_H : (az - CURB) / CURB_BEVEL * SIDEWALK_H;
}

function rampHeight(r, x, z) {
  if (!r || z < r.z0 || z > r.z1) return 0;
  const u = x - r.x0;
  return u >= 0 && u <= r.len ? rampProfile(r, u) : 0;
}

// Sets up the vertical state on a car made by world.js.
export function initAir(car) {
  const s = car.spec;
  const hcm = s.height * 0.4;
  const ahead = centreAhead(s);
  const front = s.wheelbase - ahead, back = -ahead;
  const hw = s.width / 2 - 0.15;
  const L = s.length / 2, W = s.width / 2;
  const low = (s.style === 'monster' ? s.wheelRadius * 1.2 : s.wheelRadius + 0.05) - hcm;
  const top = s.height - hcm;
  // [forward, side, up (from the centre of mass), isWheel]
  const pts = [[front, hw, -hcm, true], [front, -hw, -hcm, true], [back, -hw, -hcm, true], [back, hw, -hcm, true]];
  for (const f of [L, -L]) for (const l of [W, -W]) for (const u of [low, top]) pts.push([f, l, u, false]);
  Object.assign(car, {
    hcm, lowU: low, topU: top, y: hcm, vy: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
    airborne: false, airTime: 0, flipped: false, sideT: 0,
    contactPts: pts, prevG: null,
    Ip: (s.length * s.length + s.height * s.height) / 12,
    Ir: (s.width * s.width + s.height * s.height) / 12,
  });
}

// Up vector's vertical component: 1 upright, 0 on its side, -1 on its roof.
export function upness(car) {
  return Math.cos(car.pitch) * Math.cos(car.roll);
}

// Height of the car body's underside at a world point (the roof, if it's upside down).
export function carBottomAt(car, px, pz) {
  const b = car.body;
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const dx = px - b.x, dz = pz - b.z;
  const f = Math.max(-b.hl, Math.min(b.hl, dx * c + dz * s));
  const l = Math.max(-b.hw, Math.min(b.hw, -dx * s + dz * c));
  const cp = Math.cos(car.pitch), sp = Math.sin(car.pitch), sr = Math.sin(car.roll), up = upness(car);
  const base = car.y + f * sp + l * cp * sr;
  return Math.min(base + car.lowU * up, base + car.topU * up);
}

/**
 * Steps one car's vertical motion. Returns events (landings, flips) via emit.
 */
export function stepAir(car, level, dt, emit) {
  const b = car.body;
  const ca = Math.cos(b.a), sa = Math.sin(b.a);
  const cp = Math.cos(car.pitch), sp = Math.sin(car.pitch);
  const cr = Math.cos(car.roll), sr = Math.sin(car.roll);
  const up = cp * cr;
  const pts = car.contactPts;
  if (!car.prevG) car.prevG = pts.map(() => null);

  let fy = -G, tp = 0, tr = 0, wheels = 0, bodyHits = 0, hardest = 0;
  for (let i = 0; i < pts.length; i++) {
    const [f, l, u, isWheel] = pts[i];
    const wx = b.x + ca * f - sa * l, wz = b.z + sa * f + ca * l;
    const rh = rampHeight(level.ramp, wx, wz);
    const g = Math.max(curbHeight(wz), rh);
    // Only the ramp shoves wheels upward as they roll along it; curbs just
    // push back through the springs, so they jolt instead of launching you.
    const prev = car.prevG[i];
    car.prevG[i] = rh;
    // tyres stop holding the car up as it tips past ~55 degrees
    const hold = isWheel ? Math.min(1, Math.max(0, (up - 0.45) / 0.3)) : 1;
    if (hold <= 0) continue;
    const py = car.y + f * sp + l * cp * sr + u * up;
    const pen = g - py;
    if (pen <= 0) continue;
    // generalized lever arms: how this point's height changes with pitch and roll
    const dP = f * cp - l * sp * sr - u * sp * cr;
    const dR = l * cp * cr - u * cp * sr;
    const vel = car.vy + dP * car.pitchV + dR * car.rollV;
    const gv = prev == null || rh < g ? 0 : Math.max(-MAX_GROUND_V, Math.min(MAX_GROUND_V, (rh - prev) / dt));
    const k = isWheel ? K_WHEEL : K_BODY, c = isWheel ? C_WHEEL : C_BODY;
    const F = hold * Math.max(0, k * Math.min(pen, MAX_PEN) + c * (gv - vel));
    fy += F; tp += F * dP; tr += F * dR;
    if (isWheel) wheels++;
    else { bodyHits++; hardest = Math.max(hardest, gv - vel); }
  }

  car.vy += fy * dt;
  car.pitchV += tp / car.Ip * dt;
  car.rollV += tr / car.Ir * dt;
  car.y += car.vy * dt;
  car.pitch += car.pitchV * dt;
  car.roll += car.rollV * dt;

  if (wheels > 0) {
    // rolling up (or down) a slope
    const k = G * sp * dt * wheels / 4;
    b.vx -= ca * k; b.vz -= sa * k;
  }
  if (bodyHits > 0) {
    // body scraping along the ground
    const k = Math.exp(-bodyHits * 0.6 * dt);
    b.vx *= k; b.vz *= k; b.w *= k;
  }

  const wasAir = car.airborne;
  car.airborne = wheels === 0;
  if (car.airborne) car.airTime += dt;
  else {
    if (wasAir && car.airTime > 0.4) emit({ type: 'land', car, airTime: car.airTime, impact: Math.max(0, -car.vy) });
    car.airTime = 0;
  }
  // Flipped: on the roof, or lying on its side for a moment.
  if (wheels + bodyHits > 0 && up < 0.6) car.sideT += dt;
  else if (wheels > 0 && up > 0.8) car.sideT = 0;
  if (!car.flipped && bodyHits > 0 && (up < 0 || car.sideT > 0.6)) {
    car.flipped = true;
    emit({ type: 'flip', car, x: b.x, z: b.z, impact: hardest });
  }
}
