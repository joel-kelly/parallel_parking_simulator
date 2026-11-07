// Tiny top-down rigid body physics on the ground plane (x, z).
// Every body is an oriented box. Heading angle `a` turns +x toward +z.
// forward = (cos a, sin a), side (right) = (-sin a, cos a).

let nextId = 1;

export function makeBody(opts) {
  const b = {
    id: nextId++,
    x: 0, z: 0, a: 0,
    vx: 0, vz: 0, w: 0,
    hl: 1, hw: 1,           // half length (along forward), half width
    mass: 1000,
    isStatic: false,
    kind: 'static',         // 'car' | 'parked' | 'prop' | 'wall'
    restitution: 0.25,
    friction: 0.5,
    linDamp: 0, angDamp: 0, // per-second damping (parked cars have brakes on)
    breakSpeed: Infinity,   // props shatter above this impact speed
    broken: false,
    ...opts,
  };
  recomputeMass(b);
  return b;
}

export function recomputeMass(b) {
  if (b.isStatic) {
    b.invMass = 0;
    b.invI = 0;
  } else {
    b.invMass = 1 / b.mass;
    const L = b.hl * 2, W = b.hw * 2;
    b.invI = 1 / (b.mass * (L * L + W * W) / 12);
  }
}

export function corners(b) {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const fx = c * b.hl, fz = s * b.hl;   // forward * hl
  const sx = -s * b.hw, sz = c * b.hw;  // side * hw
  return [
    [b.x + fx + sx, b.z + fz + sz], // front right
    [b.x + fx - sx, b.z + fz - sz], // front left
    [b.x - fx - sx, b.z - fz - sz], // rear left
    [b.x - fx + sx, b.z - fz + sz], // rear right
  ];
}

// World point -> body local (along forward, along side)
export function toLocal(b, px, pz) {
  const dx = px - b.x, dz = pz - b.z;
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return [dx * c + dz * s, -dx * s + dz * c];
}

function project(cs, ax, az) {
  let min = Infinity, max = -Infinity;
  for (const [x, z] of cs) {
    const p = x * ax + z * az;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

// Returns contact {nx, nz, depth, px, pz} with normal pointing from a to b, or null.
export function collideOBB(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const reach = Math.hypot(a.hl, a.hw) + Math.hypot(b.hl, b.hw);
  if (dx * dx + dz * dz > reach * reach) return null;

  const ca = corners(a), cb = corners(b);
  const axes = [
    [Math.cos(a.a), Math.sin(a.a)], [-Math.sin(a.a), Math.cos(a.a)],
    [Math.cos(b.a), Math.sin(b.a)], [-Math.sin(b.a), Math.cos(b.a)],
  ];
  let best = Infinity, nx = 0, nz = 0;
  for (const [ax, az] of axes) {
    const [amin, amax] = project(ca, ax, az);
    const [bmin, bmax] = project(cb, ax, az);
    const o = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      // orient from a to b
      if (dx * ax + dz * az < 0) { nx = -ax; nz = -az; } else { nx = ax; nz = az; }
    }
  }

  // Contact point: average of corners inside the other box.
  let px = 0, pz = 0, n = 0;
  for (const [x, z] of ca) {
    const [lx, lz] = toLocal(b, x, z);
    if (Math.abs(lx) <= b.hl + 1e-3 && Math.abs(lz) <= b.hw + 1e-3) { px += x; pz += z; n++; }
  }
  for (const [x, z] of cb) {
    const [lx, lz] = toLocal(a, x, z);
    if (Math.abs(lx) <= a.hl + 1e-3 && Math.abs(lz) <= a.hw + 1e-3) { px += x; pz += z; n++; }
  }
  if (n === 0) { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; } else { px /= n; pz /= n; }
  return { nx, nz, depth: best, px, pz };
}

function pointVel(b, rx, rz) {
  return [b.vx - b.w * rz, b.vz + b.w * rx];
}

// Normal speed at which the bodies are approaching each other at the contact (positive = closing).
export function closingSpeed(a, b, c) {
  const [avx, avz] = pointVel(a, c.px - a.x, c.pz - a.z);
  const [bvx, bvz] = pointVel(b, c.px - b.x, c.pz - b.z);
  return (avx - bvx) * c.nx + (avz - bvz) * c.nz;
}

export function resolve(a, b, c) {
  const rax = c.px - a.x, raz = c.pz - a.z;
  const rbx = c.px - b.x, rbz = c.pz - b.z;
  const [avx, avz] = pointVel(a, rax, raz);
  const [bvx, bvz] = pointVel(b, rbx, rbz);
  const rvx = bvx - avx, rvz = bvz - avz;
  const vn = rvx * c.nx + rvz * c.nz;

  // positional correction (always, so things never sink into each other)
  const totInv = a.invMass + b.invMass;
  if (totInv > 0) {
    const corr = Math.max(c.depth - 0.005, 0) / totInv * 0.8;
    a.x -= c.nx * corr * a.invMass; a.z -= c.nz * corr * a.invMass;
    b.x += c.nx * corr * b.invMass; b.z += c.nz * corr * b.invMass;
  }
  if (vn > 0) return 0; // separating

  const raN = rax * c.nz - raz * c.nx;
  const rbN = rbx * c.nz - rbz * c.nx;
  const e = Math.min(a.restitution, b.restitution);
  const denom = a.invMass + b.invMass + raN * raN * a.invI + rbN * rbN * b.invI;
  if (denom <= 0) return 0;
  const j = -(1 + e) * vn / denom;
  applyImpulse(a, -j * c.nx, -j * c.nz, rax, raz);
  applyImpulse(b, j * c.nx, j * c.nz, rbx, rbz);

  // friction
  let tx = rvx - vn * c.nx, tz = rvz - vn * c.nz;
  const tl = Math.hypot(tx, tz);
  if (tl > 1e-4) {
    tx /= tl; tz /= tl;
    const raT = rax * tz - raz * tx;
    const rbT = rbx * tz - rbz * tx;
    const dT = a.invMass + b.invMass + raT * raT * a.invI + rbT * rbT * b.invI;
    let jt = -tl / dT;
    const mu = Math.min(a.friction, b.friction);
    jt = Math.max(jt, -mu * j);
    applyImpulse(a, -jt * tx, -jt * tz, rax, raz);
    applyImpulse(b, jt * tx, jt * tz, rbx, rbz);
  }
  return -vn;
}

function applyImpulse(b, jx, jz, rx, rz) {
  if (b.isStatic) return;
  b.vx += jx * b.invMass;
  b.vz += jz * b.invMass;
  b.w += (rx * jz - rz * jx) * b.invI;
}

export function integrate(b, dt) {
  if (b.isStatic) return;
  if (b.linDamp) {
    const k = Math.exp(-b.linDamp * dt);
    b.vx *= k; b.vz *= k;
  }
  if (b.angDamp) b.w *= Math.exp(-b.angDamp * dt);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.a += b.w * dt;
}
