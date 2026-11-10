// Headless checks that the game is fair:
//  1. the AI can parallel park every vehicle at every difficulty
//     (if the AI can do it, the spot is physically possible for a human too);
//  2. every Career level has a parkable spot (with the hazards that don't
//     change how the car drives switched on);
//  3. traffic and pedestrians run for a while without anyone exploding.
import { buildLevel, DIFFICULTIES, rng } from '../src/sim/level.js';
import { VEHICLES, vehicleById } from '../src/sim/vehicles.js';
import { World } from '../src/sim/world.js';
import { AIDriver, AI_PROFILES, planPark } from '../src/sim/ai.js';
import { CAREER } from '../src/sim/career.js';
import { DRIVING_MODS, RANDOM_POOL } from '../src/sim/mods.js';

let failures = 0;
const verbose = process.argv.includes('-v');
const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };

const fmt = (c, d) => `parked=${c.parked} moves=${c.moves}/${d.plan_.moves} t=${(c.parkedAt || 0).toFixed(1)} dings=${c.dings} hops=${c.curbHops} phase=${d.phase} ` +
  (c.lastEval ? `curb=${c.lastEval.curbDist.toFixed(2)} ang=${c.lastEval.angle.toFixed(1)} fg=${c.lastEval.frontGap.toFixed(2)} rg=${c.lastEval.rearGap.toFixed(2)}` : '');

// 1. Every vehicle, every difficulty, a few seeds.
for (const veh of VEHICLES) {
  for (const diff of DIFFICULTIES) {
    for (const seed of [1, 2, 3]) {
      const level = buildLevel({ mode: 'race', difficulty: diff.id, vehicle: veh, seed });
      const world = new World(level, veh, { aiSpec: veh, aiProfile: AI_PROFILES[diff.id], rand: rng(seed) });
      const pd = new AIDriver(world, world.player, world.playerSpot, AI_PROFILES.insane, rng(seed + 9));
      let t = 0;
      const dt = 1 / 60;
      while (t < 90 && !(world.ai.car.parked && world.player.parked)) {
        world.step(dt, world.player.parked ? { throttle: 0, steer: 0 } : pd.update(dt));
        t += dt;
      }
      const ai = world.ai.car, pl = world.player;
      const ok = ai.parked && pl.parked && ai.dings === 0 && pl.dings === 0 && pl.moves <= pd.plan_.moves + 1;
      if (!ok) failures++;
      if (!ok || verbose) console.log(`${ok ? 'ok  ' : 'FAIL'} ${veh.id.padEnd(8)} ${diff.id.padEnd(7)} s${seed} | AI ${fmt(ai, world.ai.driver)} | P ${fmt(pl, pd)}`);
    }
  }
}

// 2. Career levels: the spot must be parkable with the level's own car.
for (const lv of CAREER) {
  const veh = vehicleById(lv.vehicle || 'bean');
  const mods = lv.mods.filter((m) => !DRIVING_MODS.includes(m));
  const level = buildLevel({ mode: lv.mode || 'test', difficulty: lv.diff, vehicle: veh, seed: 5, mods });
  const opts = { rand: rng(5) };
  if (lv.mode === 'race') { opts.aiSpec = veh; opts.aiProfile = AI_PROFILES[lv.diff]; }
  const world = new World(level, veh, opts);
  if (level.mods.has('hidden') && world.playerSpots.length < 4) fail(`${lv.id}: mystery street has only ${world.playerSpots.length} gaps`);
  const pd = new AIDriver(world, world.player, world.playerSpot, AI_PROFILES.insane, rng(7));
  let t = 0;
  const dt = 1 / 60;
  while (t < 90 && !world.player.parked) { world.step(dt, pd.update(dt)); t += dt; }
  if (!world.player.parked) fail(`${lv.id} (${lv.name}): AI could not park | ${fmt(world.player, pd)}`);
  else if (verbose) console.log(`ok   ${lv.id} ${lv.name.padEnd(16)} t=${t.toFixed(1)} moves=${world.player.moves} dings=${world.player.dings}`);
  if (lv.time && world.player.parked && t > lv.time * 0.8) fail(`${lv.id}: AI needed ${t.toFixed(0)}s of a ${lv.time}s limit`);
}

// 3. Hazards soak test: every mod at once (where they combine), nobody parked, nothing NaN.
{
  const veh = vehicleById('za');
  const level = buildLevel({ mode: 'wreck', difficulty: 'normal', vehicle: veh, seed: 3, mods: [...RANDOM_POOL] });
  const world = new World(level, veh, { rand: rng(3) });
  if (world.traffic.cars.length < 5) fail(`wreck mode should have traffic in both lanes, got ${world.traffic.cars.length}`);
  if (world.peds.list.length < 10) fail(`wreck mode should have pedestrians, got ${world.peds.list.length}`);
  let scares = 0, honks = 0;
  for (let t = 0; t < 60; t += 1 / 60) {
    // drive up and down the middle of the road like a lunatic
    const input = { throttle: 1, steer: Math.sin(t * 0.7) * 0.5, handbrake: false, nitro: t % 10 < 3 };
    world.step(1 / 60, input);
    for (const e of world.drainEvents()) { if (e.type === 'scare') scares++; if (e.type === 'honk') honks++; }
  }
  const bad = [...world.cars, ...world.parked.map((p) => ({ body: p.body }))].filter((c) => !Number.isFinite(c.body.x + c.body.z + c.body.a + c.body.vx));
  if (bad.length) fail(`${bad.length} bodies went non-finite`);
  for (const p of world.peds.list) if (!Number.isFinite(p.x + p.z + p.y)) fail('a pedestrian went non-finite');
  if (world.player.nitro < 0 || world.player.nitro > 100) fail(`nitro out of range: ${world.player.nitro}`);
  if (verbose) console.log(`soak: scares=${scares} honks=${honks} destruction=$${world.destruction} combo best=${world.comboBest} speed=${(world.player.speed * 3.6).toFixed(0)}km/h`);
  if (scares === 0) fail('nobody dived out of the way in 60s of lunatic driving');
}

// 4. The shrinking spot stops at a parkable size.
{
  const veh = vehicleById('bean');
  const level = buildLevel({ mode: 'test', difficulty: 'easy', vehicle: veh, seed: 4, mods: ['shrink'] });
  const world = new World(level, veh, { rand: rng(4) });
  for (let t = 0; t < 120; t += 1 / 60) world.step(1 / 60, { throttle: 0, steer: 0, handbrake: true });
  const plan = planPark(world, world.playerSpot, veh);
  if (world.shrunk < 1) fail(`spot should have shrunk, moved ${world.shrunk.toFixed(2)}m`);
  if (!plan) fail('shrunk spot is no longer parkable');
  else if (verbose) console.log(`shrink: moved ${world.shrunk.toFixed(2)}m, still parkable in ${plan.moves} moves`);
}

console.log(failures ? `${failures} failures` : 'all parked cleanly');
process.exit(failures ? 1 : 0);
