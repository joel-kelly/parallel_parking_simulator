import { corners } from './physics.js';

// Spot frame: origin at the spot centre on the curb line, +x' = direction of
// traffic on that side of the road, +z' = toward the curb.
// spot.dir is the traffic direction (+1 = +x). spot.hand is +1 when the curb
// is on the driver's right and -1 when it's on their left (New Zealand mode),
// in which case the frame is a mirror image, so angles and steering flip too.
//
// Car park stalls (spot.kind === 'stall') have their own frame: origin on the
// stall's open edge, +x' = (ux, uz) along the aisle, +z' = (nx, nz) into the
// stall; hand = -1 when that's a mirror image (stall on the left).
export function toSpot(spot, x, z) {
  if (spot.kind === 'stall') {
    const dx = x - spot.ox, dz = z - spot.oz;
    return [dx * spot.ux + dz * spot.uz, dx * spot.nx + dz * spot.nz];
  }
  return [spot.dir * (x - spot.cx), spot.dir * spot.hand * (z - spot.cz)];
}

// A world heading as an angle in the spot frame (0 = along the traffic).
export function spotAngle(spot, a) {
  if (spot.kind === 'stall') return spot.hand * wrapAngle(a - Math.atan2(spot.uz, spot.ux));
  return spot.hand * wrapAngle(a - (spot.dir > 0 ? 0 : Math.PI));
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function spotPose(spot, body, ahead) {
  const a = spotAngle(spot, body.a);
  const [cx, cz] = toSpot(spot, body.x, body.z);
  return {
    x: cx - Math.cos(a) * ahead,
    z: cz - Math.sin(a) * ahead,
    cx, cz, a,
    corners: corners(body).map(([x, z]) => toSpot(spot, x, z)),
  };
}

export function spotBounds(world, spot) {
  const f = world.parked[spot.frontCar].body;
  const r = world.parked[spot.rearCar].body;
  const fc = corners(f).map(([x, z]) => toSpot(spot, x, z)[0]);
  const rc = corners(r).map(([x, z]) => toSpot(spot, x, z)[0]);
  return { front: Math.min(...fc), rear: Math.max(...rc) };
}

export function evaluatePark(world, car, spot) {
  const pose = spotPose(spot, car.body, 0);
  const bounds = spotBounds(world, spot);
  const xs = pose.corners.map((c) => c[0]);
  const zs = pose.corners.map((c) => c[1]);
  const front = Math.max(...xs), rear = Math.min(...xs);
  const inner = Math.max(...zs), outer = Math.min(...zs);
  const inSpot = rear > bounds.rear - 0.2 && front < bounds.front + 0.2 && outer > -3.3 && inner < 0.25;
  return {
    inSpot,
    angle: Math.abs(pose.a) * 180 / Math.PI,
    curbDist: -inner,                      // gap between car side and curb
    frontGap: bounds.front - front,
    rearGap: rear - bounds.rear,
  };
}
