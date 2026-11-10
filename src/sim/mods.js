// Level modifiers ("mods"): hazards and handicaps that can be mixed into any run.
// The sim reads them from `level.mods` (a Set of ids); the renderer uses the
// same ids to dress the street up (night, fog, rain...).
export const MODS = {
  traffic: { name: 'RUSH HOUR', desc: 'Traffic in the other lane. They honk. They do not forgive.' },
  peds: { name: 'JAYWALKERS', desc: 'Pedestrians wander onto the road. Honk (H) to hurry them along.' },
  rain: { name: 'DOWNPOUR', desc: 'Wet road. Half the grip, twice the drama.' },
  ice: { name: 'BLACK ICE', desc: 'The street is a skating rink. Brake early. Then earlier.' },
  night: { name: 'NIGHT SHIFT', desc: 'Pitch dark. Headlights only.' },
  fog: { name: 'PEA SOUP', desc: 'Fog so thick you could park in it.' },
  blind: { name: 'NO MIRRORS', desc: 'Chase camera only. No peeking from above.' },
  mirror: { name: 'STEERING RECALL', desc: 'Left is right and right is left. The dealer is very sorry.' },
  sticky: { name: 'STUCK PEDAL', desc: 'The accelerator is jammed: the car creeps forward on its own. Finish with the handbrake (SPACE).' },
  shrink: { name: 'CREEPER', desc: 'The car in front keeps backing up. Your spot is shrinking. Hurry.' },
  quake: { name: 'TREMORS', desc: 'Earthquakes. The parked cars shuffle about. So does your stomach.' },
  hidden: { name: 'MYSTERY STREET', desc: 'No marker. Several gaps. Any gap you fit in counts, and tighter gaps pay more.' },
};

// Mods that the Valet Shift and the Daily Dare draw from at random.
export const RANDOM_POOL = ['traffic', 'peds', 'rain', 'ice', 'night', 'fog', 'blind', 'mirror', 'sticky', 'shrink', 'quake'];

// Mods that change how the car itself drives (so the AI can't be used to prove
// the spot is fair while they're on).
export const DRIVING_MODS = ['rain', 'ice', 'mirror', 'sticky', 'shrink', 'quake'];

export function surfaceGrip(mods) {
  if (mods.has('ice')) return 0.2;
  if (mods.has('rain')) return 0.55;
  return 1;
}

export const modNames = (mods) => [...mods].map((m) => MODS[m].name);
