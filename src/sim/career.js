// The Career: a run of hand-picked levels, each with its own gimmick.
// `vehicle` lends you a company car for that level. `time` is a limit in seconds.
export const CAREER = [
  { id: 'c01', name: 'FIRST DAY', blurb: 'Just park. No tricks. Savour it.', diff: 'easy', mods: [] },
  { id: 'c02', name: 'RUSH HOUR', blurb: 'Traffic in the other lane. Try not to join it.', diff: 'normal', mods: ['traffic'] },
  { id: 'c03', name: 'JAYWALKERS', blurb: 'Pedestrians with no sense of self-preservation. Honk (H) to shift them.', diff: 'normal', mods: ['peds'] },
  { id: 'c04', name: 'PIZZA RUN', blurb: '45 seconds or the pizza is free. Company van provided.', diff: 'normal', mods: [], vehicle: 'za', time: 45 },
  { id: 'c05', name: 'NIGHT SHIFT', blurb: 'The street lights are out. Your headlights are not. Mostly.', diff: 'normal', mods: ['night'] },
  { id: 'c06', name: 'CREEPER', blurb: 'The car in front is backing up. Into your spot. Slowly. Smugly.', diff: 'easy', mods: ['shrink'] },
  { id: 'c07', name: 'DOWNPOUR', blurb: 'Wet tarmac. Half the grip, and the wipers are broken.', diff: 'normal', mods: ['rain'] },
  { id: 'c08', name: 'PEA SOUP', blurb: 'You cannot see the spot. The spot cannot see you. Fair.', diff: 'normal', mods: ['fog'] },
  { id: 'c09', name: 'MYSTERY STREET', blurb: 'No marker. Lots of gaps. Pick one you fit in. Tighter pays more.', diff: 'normal', mods: ['hidden'] },
  { id: 'c10', name: 'STUCK PEDAL', blurb: 'The accelerator is jammed. Finish with the handbrake. Good luck stopping.', diff: 'normal', mods: ['sticky'] },
  { id: 'c11', name: 'STEERING RECALL', blurb: 'The wheel is wired backwards. The mechanic calls it a feature.', diff: 'normal', mods: ['mirror'] },
  { id: 'c12', name: 'TREMORS', blurb: 'Minor earthquakes. The parked cars are not staying parked.', diff: 'normal', mods: ['quake'] },
  { id: 'c13', name: 'BLACK ICE', blurb: 'The road is a rink. Brake early. Brake earlier than that.', diff: 'normal', mods: ['ice'] },
  { id: 'c14', name: 'BLIND SPOT', blurb: 'A hard spot, chase camera only. Feel the gap.', diff: 'hard', mods: ['blind'] },
  { id: 'c15', name: 'LIMO SERVICE', blurb: 'A client. A limo. Night. Pedestrians. What could go wrong.', diff: 'normal', mods: ['night', 'peds'], vehicle: 'limo' },
  { id: 'c16', name: 'MONSTER MASH', blurb: 'Race Valet Vinnie in a monster truck during an earthquake. Normal Tuesday.', mode: 'race', diff: 'hard', mods: ['quake'], vehicle: 'monster' },
  { id: 'c17', name: 'RUSH HOUR II', blurb: 'Hard spot, rain, traffic, and a clock. Welcome to the city.', diff: 'hard', mods: ['traffic', 'rain'], time: 75 },
  { id: 'c18', name: 'THE PARKINATOR', blurb: 'Race the machine. At night. It does not blink. It has no eyes.', mode: 'race', diff: 'insane', mods: ['night'] },
  { id: 'c19', name: 'GRADUATION', blurb: 'Everything, all at once, in an insane spot. Make us proud.', diff: 'insane', mods: ['traffic', 'peds', 'night', 'quake'] },
  // Post-grad: the big-box store car park. Back it in.
  { id: 'c20', name: 'SATURDAY AT BULKZILLA', blurb: 'The car park is full, the carts are feral, and you must BACK IN. Nose out, like a getaway driver.', mode: 'lot', diff: 'normal', mods: [] },
  { id: 'c21', name: 'FREE SAMPLE FRENZY', blurb: 'Someone is giving away tiny sausages. Everyone is here. Everyone is walking in the road.', mode: 'lot', diff: 'normal', mods: ['peds', 'traffic'] },
  { id: 'c22', name: 'MIDNIGHT MADNESS SALE', blurb: 'Doors open at midnight. It is raining. The spot is tight. The deals are not that good.', mode: 'lot', diff: 'hard', mods: ['night', 'rain'] },
  { id: 'c23', name: 'FIELD TRIP', blurb: 'Forty kids. One hot dog stand. Back the bus in, and nobody touch anything.', mode: 'lot', diff: 'normal', mods: ['peds'], vehicle: 'bus' },
  { id: 'c24', name: 'BLACK FRIDAY', blurb: 'Insane stall, spot hunters, shoppers, ice, and the clock. Retail is war.', mode: 'lot', diff: 'insane', mods: ['traffic', 'peds', 'ice'], time: 90 },
];

export const FIRST_CLEAR_BONUS = 150;
export const STAR_BONUS = 50;

export function careerIndex(id) { return CAREER.findIndex((l) => l.id === id); }

// A level is open once the one before it has at least one star.
export function careerUnlocked(save, i) {
  return i === 0 || (save.career[CAREER[i - 1].id] || 0) >= 1;
}

export function careerStars(save) {
  return CAREER.reduce((n, l) => n + (save.career[l.id] || 0), 0);
}

// Stars for a finished level. Test levels: parked / B / A. Races: win / clean win / fast clean win.
export function starsFor(level, r) {
  if (level.mode === 'race') {
    if (!r.won) return 0;
    if (r.dings > 0) return 1;
    return r.time <= 45 ? 3 : 2;
  }
  if (!r.parked) return 0;
  if (r.score >= 850) return 3;
  if (r.score >= 650) return 2;
  return 1;
}
