import { corners } from './physics.js';

// Spot frame: origin at the spot centre on the curb line, +x' = direction of
// traffic on that side of the road, +z' = toward the curb.
export function toSpot(spot, x, z) {
  return [spot.dir * (x - spot.cx), spot.dir * (z - spot.cz)];
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function spotPose(spot, body, ahead) {
  const a = wrapAngle(body.a - (spot.dir > 0 ? 0 : Math.PI));
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
