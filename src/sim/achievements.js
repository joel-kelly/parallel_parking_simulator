// Trophies. Each `check(save, r)` gets the save and the result of the run that
// just ended (null when checking outside a run, e.g. in the garage).
// r: { kind, simMode, parked, won, score, letter, time, car, world, mods, diff,
//      careerId, shiftRound, aiId, hidden, vehicleId }
import { VEHICLES } from './vehicles.js';
import { CAREER } from './career.js';
import { AI_PROFILES } from './ai.js';

const test = (r) => r && (r.simMode === 'test') && r.parked;

export const TROPHIES = [
  { id: 'first', name: 'LICENSED-ISH', desc: 'Park a car. Any car. Anywhere legal.', check: (s, r) => test(r) },
  { id: 's_rank', name: 'PARKING DEITY', desc: 'Earn an S grade.', check: (s, r) => test(r) && r.letter === 'S' },
  { id: 'insane_s', name: 'PHYSICS COMPLAINT', desc: 'S grade on an Insane spot.', check: (s, r) => test(r) && r.letter === 'S' && r.diff === 'insane' },
  { id: 'one_move', name: 'ONE AND DONE', desc: 'Park a Hard or Insane spot in a single move.', check: (s, r) => test(r) && r.car.moves <= 1 && (r.diff === 'hard' || r.diff === 'insane') },
  { id: 'fast', name: 'DRIVE-THRU', desc: 'Park in under 12 seconds.', check: (s, r) => test(r) && r.time < 12 },
  { id: 'pinata', name: 'PINATA', desc: 'Ten dings in one driving test. Then park anyway.', check: (s, r) => test(r) && r.car.dings >= 10 },
  { id: 'hops', name: 'CURB YOUR ENTHUSIASM', desc: 'Hop the curb five times in one run.', check: (s, r) => r && r.car.curbHops >= 5 },
  { id: 'limo_insane', name: 'YOU HAD THE LUCK', desc: 'Park the Stretch Prince on Insane.', check: (s, r) => test(r) && r.vehicleId === 'limo' && r.diff === 'insane' },
  { id: 'bus_park', name: 'FORTY SEATS', desc: 'Park Big Yeller on Hard or worse.', check: (s, r) => test(r) && r.vehicleId === 'bus' && (r.diff === 'hard' || r.diff === 'insane') },
  { id: 'crater', name: 'THE CRATER', desc: '$50,000 of damage in one Wreck-reation.', check: (s, r) => r && r.simMode === 'wreck' && r.world.destruction >= 50000 },
  { id: 'demolish', name: 'URBAN RENEWAL', desc: 'Bring down a whole building.', check: (s, r) => r && r.world.buildings.some((b) => b.collapsed) },
  { id: 'combo', name: 'MAYHEM', desc: 'A ten-smash combo.', check: (s, r) => r && r.world.comboBest >= 10 },
  { id: 'mayor', name: 'CIVIC DUTY', desc: 'Topple the statue of the mayor.', check: (s, r) => r && r.world.props.some((p) => p.type === 'statue' && p.broken) },
  { id: 'terminated', name: 'TERMINATED', desc: 'Beat The Parkinator.', check: (s) => s.beaten.includes('insane') },
  { id: 'sweep', name: 'UNDEFEATED', desc: 'Beat all four AI drivers.', check: (s) => Object.keys(AI_PROFILES).every((k) => s.beaten.includes(k)) },
  { id: 'shift5', name: 'PROBATION PASSED', desc: 'Reach customer 5 in a Valet Shift.', check: (s) => s.shiftBestRound >= 5 },
  { id: 'shift10', name: 'EMPLOYEE OF THE MONTH', desc: 'Reach customer 10 in a Valet Shift.', check: (s) => s.shiftBestRound >= 10 },
  { id: 'shift15', name: 'VALET SUPREME', desc: 'Reach customer 15 in a Valet Shift.', check: (s) => s.shiftBestRound >= 15 },
  { id: 'grad', name: 'GRADUATE', desc: 'Clear every Career level.', check: (s) => CAREER.every((l) => (s.career[l.id] || 0) >= 1) },
  { id: 'honours', name: 'SUMMA CUM LAUDE', desc: 'Three stars on every Career level.', check: (s) => CAREER.every((l) => (s.career[l.id] || 0) >= 3) },
  { id: 'collector', name: 'COLLECTOR', desc: 'Own every vehicle.', check: (s) => VEHICLES.every((v) => v.cost === 0 || s.unlocked.includes(v.id)) },
  { id: 'hydrant', name: 'SPLASH ZONE', desc: 'Break a fire hydrant.', check: (s, r) => r && r.world.props.some((p) => p.type === 'hydrant' && p.broken) },
  { id: 'gentle', name: 'GENTLE GIANT', desc: 'Park with Jaywalkers about without scaring a single one.', check: (s, r) => test(r) && r.mods.has('peds') && r.car.scares === 0 },
  { id: 'ambi', name: 'AMBIDEXTROUS', desc: 'A grade or better with the steering reversed.', check: (s, r) => test(r) && r.mods.has('mirror') && (r.letter === 'A' || r.letter === 'S') },
  { id: 'skater', name: 'FIGURE SKATER', desc: 'Park on Black Ice with no dings.', check: (s, r) => test(r) && r.mods.has('ice') && r.car.dings === 0 },
  { id: 'owl', name: 'NIGHT OWL', desc: 'Park in the dark with no dings.', check: (s, r) => test(r) && r.mods.has('night') && r.car.dings === 0 },
  { id: 'squeeze', name: 'SARDINE', desc: 'Earn the Tight Squeeze bonus on Mystery Street.', check: (s, r) => test(r) && r.hidden && r.spotSpare < 1.0 },
  { id: 'daily', name: 'HABIT FORMING', desc: 'Complete a Daily Dare.', check: (s) => Object.keys(s.daily).length >= 1 },
  { id: 'daily5', name: 'REGULAR', desc: 'Complete five Daily Dares.', check: (s) => Object.keys(s.daily).length >= 5 },
  { id: 'honker', name: 'ROAD RAGE', desc: 'Honk the horn 100 times. In total. We counted.', check: (s) => s.honks >= 100 },
  { id: 'speed', name: 'SPEED DEMON', desc: 'Hit 100 km/h. In a parking game.', check: (s) => s.topSpeed >= 100 },
  { id: 'rich', name: 'OLD MONEY', desc: 'Earn 20,000 points in total.', check: (s) => s.totalEarned >= 20000 },
];

export const TROPHY_POINTS = 100;

export function trophyById(id) { return TROPHIES.find((t) => t.id === id); }

// Returns the newly earned trophies (and records them in the save).
export function checkTrophies(save, r) {
  const won = [];
  for (const t of TROPHIES) {
    if (save.trophies.includes(t.id)) continue;
    let ok = false;
    try { ok = !!t.check(save, r); } catch (e) { ok = false; }
    if (ok) { save.trophies.push(t.id); won.push(t); }
  }
  return won;
}
