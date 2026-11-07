// Headless check: the AI can parallel park every vehicle at every difficulty.
// If the AI can do it, the spot is physically possible for a human too.
import { buildLevel, DIFFICULTIES } from '../src/sim/level.js';
import { VEHICLES } from '../src/sim/vehicles.js';
import { World } from '../src/sim/world.js';
import { AIDriver, AI_PROFILES } from '../src/sim/ai.js';
import { rng } from '../src/sim/level.js';

let failures = 0;
const verbose = process.argv.includes('-v');
for (const veh of VEHICLES) {
  for (const diff of DIFFICULTIES) {
    for (const seed of [1, 2, 3]) {
      const level = buildLevel({ mode: 'race', difficulty: diff.id, vehicle: veh, seed });
      const world = new World(level, veh, { aiSpec: veh, aiProfile: AI_PROFILES[diff.id], rand: rng(seed) });
      // Also drive the player's car with an AI to test the player's spot.
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
      if (!ok || verbose) {
        const fmt = (c, d) => `parked=${c.parked} moves=${c.moves}/${d.plan_.moves} t=${(c.parkedAt || 0).toFixed(1)} dings=${c.dings} hops=${c.curbHops} phase=${d.phase} ` +
          (c.lastEval ? `curb=${c.lastEval.curbDist.toFixed(2)} ang=${c.lastEval.angle.toFixed(1)} fg=${c.lastEval.frontGap.toFixed(2)} rg=${c.lastEval.rearGap.toFixed(2)}` : '');
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${veh.id.padEnd(8)} ${diff.id.padEnd(7)} s${seed} | AI ${fmt(ai, world.ai.driver)} | P ${fmt(pl, pd)}`);
      }
    }
  }
}
console.log(failures ? `${failures} failures` : 'all parked cleanly');
process.exit(failures ? 1 : 0);
