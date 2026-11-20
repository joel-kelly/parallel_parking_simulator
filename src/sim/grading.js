// Turns a finished park into a score, a letter grade and some unsolicited feedback.

const GRADES = [
  { min: 950, letter: 'S', title: 'PARKING DEITY' },
  { min: 850, letter: 'A', title: 'CURB WHISPERER' },
  { min: 700, letter: 'B', title: 'RESPECTABLE CITIZEN' },
  { min: 550, letter: 'C', title: 'ADEQUATE, FRANKLY' },
  { min: 400, letter: 'D', title: 'MENACE (MILD)' },
  { min: 0, letter: 'F', title: 'PUBLIC HAZARD' },
];

const QUIPS = {
  S: ['I have never seen anything so beautiful. I am weeping into my clipboard.', 'Your parking will be taught in schools.', 'The curb asked for your number.'],
  A: ['Lovely. My nan would be proud. She hates everyone.', 'Clean. Crisp. Mildly smug. I respect it.', 'That was nearly sexy.'],
  B: ['Solid. Not exciting, but solid. Like a casserole.', 'You parked. Legally, even.', 'Good effort. I only screamed once.'],
  C: ['Technically that is a car, and technically it is parked.', 'The curb is over there. Waving. Lonely.', 'I have seen worse. Today, even. Not much worse.'],
  D: ['Did you learn to drive from a pamphlet?', 'Your car is parked. Your dignity is not.', 'I am adding a new section to my report called "why".'],
  F: ['I am getting out of the car now.', 'Please return your licence to the nearest bin.', 'The insurance company has been notified. They laughed.'],
};

/**
 * spot: the spot that was parked in (for the tight-squeeze bonus on Mystery Street).
 * mods: Set of active modifiers (hazard pay bumps the points).
 */
export function gradePark({ car, evalResult, time, par, difficulty, spot = null, mods = new Set(), hidden = false }) {
  const items = [];
  let score = 1000;
  const pen = (label, pts, detail) => {
    pts = Math.round(pts);
    if (pts > 0) { score -= pts; items.push({ label, pts: -pts, detail }); }
  };
  const bonus = (label, pts, detail) => {
    pts = Math.round(pts);
    if (pts > 0) { score += pts; items.push({ label, pts: `+${pts}`, detail, good: true }); }
  };

  const extraMoves = Math.max(0, car.moves - par);
  pen('EXTRA SHUFFLES', extraMoves * 50, `${car.moves} moves (par ${par})`);
  pen('DINGS', car.dings * 80, `${car.dings} ding${car.dings === 1 ? '' : 's'}`);
  const d = evalResult.curbDist;
  if (d < 0) pen('ON THE CURB', 150, 'wheels up on the sidewalk');
  else if (d > 0.3) pen('CURB DISTANCE', Math.min(300, (d - 0.3) * 350), `${d.toFixed(2)}m from curb`);
  if (car.curbHops > 0) pen('CURB HOPS', car.curbHops * 60, `${car.curbHops} hop${car.curbHops === 1 ? '' : 's'}`);
  pen('WONKINESS', Math.min(200, Math.max(0, evalResult.angle - 1) * 15), `${evalResult.angle.toFixed(1)}° off straight`);
  const off = Math.abs(evalResult.frontGap - evalResult.rearGap) / 2;
  pen('CENTERING', Math.min(150, Math.max(0, off - 0.15) * 80), `${off.toFixed(2)}m off centre`);
  pen('DAWDLING', Math.min(150, Math.max(0, time - 35) * 3), `${time.toFixed(1)}s`);
  pen('VANDALISM', car.propsBroken * 100, `${car.propsBroken} thing${car.propsBroken === 1 ? '' : 's'} destroyed`);
  pen('TERRORISED PEDESTRIANS', car.scares * 60, `${car.scares} dive${car.scares === 1 ? '' : 's'} for cover`);
  if (hidden && spot) {
    const spare = spot.length - car.spec.length - (car.spec.extraRoom || 0);
    if (spare < 1.0) bonus('TIGHT SQUEEZE', 200, `only ${spare.toFixed(2)}m to spare`);
    else if (spare < 1.6) bonus('SNUG FIT', 100, `${spare.toFixed(2)}m to spare`);
  }

  const g = GRADES.find((x) => Math.max(0, score) >= x.min);
  const quips = QUIPS[g.letter];
  let quip = quips[Math.floor(Math.random() * quips.length)];
  if (car.propsBroken >= 3) quip = 'You hit more things than you missed. Bold strategy.';
  else if (car.scares >= 3) quip = 'Three people dived for cover. One of them was me. From inside the car.';
  else if (d > 1.0) quip = 'You parked closer to the moon than the curb.';
  else if (car.dings >= 4) quip = 'The other cars are filing a class action.';

  return finish(score, items, quip, difficulty, mods);
}

// Hazard pay: each active modifier is worth a bit more.
function finish(score, items, quip, difficulty, mods) {
  score = Math.max(0, score);
  const g = GRADES.find((x) => score >= x.min);
  const hazard = 1 + 0.2 * mods.size;
  const points = Math.round(score * difficulty.mult * hazard / 4);
  return { score, letter: g.letter, title: g.title, items, quip, points, hazard };
}

const LOT_QUIPS = {
  S: ['Backed in like a getaway driver. A law-abiding one. I think.', 'Nose out, ready to leave. You are the main character of this car park.', 'The trolley boy saw that. He is telling everyone.'],
  A: ['Lovely. You could make a quick exit with a 48-pack of mayonnaise.', 'Tidy. The car next door can still open its doors. Barely.', 'That was very nearly professional.'],
  B: ['Parked. Facing the right way. That puts you ahead of most people here.', 'Good. Not great. Good. Like the free samples.', 'Respectable. The gorilla nodded.'],
  C: ['It is in the stall. Most of it. The important parts.', 'The lines are a guide, I suppose. A loose one.', 'Fine. You can go in now. The mayonnaise awaits.'],
  D: ['The car next door is calling a lawyer.', 'Bold use of two spaces.', 'I am going to pretend I did not see that.'],
  F: ['That is not parked, that is abandoned.', 'Leave the car. Take a cart. Walk home.', 'The store has banned you. From the car park. Of the store.'],
};

/** Backing into a car park stall (see lot.js). */
export function gradeStall({ car, evalResult: e, time, par, difficulty, spot = null, mods = new Set(), hidden = false }) {
  const items = [];
  let score = 1000;
  const pen = (label, pts, detail) => {
    pts = Math.round(pts);
    if (pts > 0) { score -= pts; items.push({ label, pts: -pts, detail }); }
  };
  const bonus = (label, pts, detail) => {
    pts = Math.round(pts);
    if (pts > 0) { score += pts; items.push({ label, pts: `+${pts}`, detail, good: true }); }
  };
  if (e.noseIn) pen('NOSE IN', 350, 'we said BACK it in');
  pen('EXTRA SHUFFLES', Math.max(0, car.moves - par) * 50, `${car.moves} moves (par ${par})`);
  pen('DINGS', car.dings * 80, `${car.dings} ding${car.dings === 1 ? '' : 's'}`);
  if (e.backGap < 0) pen('IN THE SHRUBBERY', 150, 'over the back of the stall');
  else if (e.backGap > 0.5) pen('STICKING OUT', Math.min(300, (e.backGap - 0.5) * 220), `${e.backGap.toFixed(2)}m from the back`);
  if (car.curbHops > 0) pen('PLANTER HOPS', car.curbHops * 60, `${car.curbHops} hop${car.curbHops === 1 ? '' : 's'}`);
  pen('WONKINESS', Math.min(200, Math.max(0, e.angle - 1) * 15), `${e.angle.toFixed(1)}° off straight`);
  const off = Math.abs(e.offCentre);
  pen('BETWEEN THE LINES', Math.min(150, Math.max(0, off - 0.12) * 120), `${off.toFixed(2)}m off centre`);
  pen('DAWDLING', Math.min(150, Math.max(0, time - 40) * 3), `${time.toFixed(1)}s`);
  pen('VANDALISM', car.propsBroken * 100, `${car.propsBroken} thing${car.propsBroken === 1 ? '' : 's'} destroyed`);
  pen('TERRORISED SHOPPERS', car.scares * 60, `${car.scares} dive${car.scares === 1 ? '' : 's'} for cover`);
  if (hidden && spot) {
    const spare = spot.spare - (car.spec.extraRoom || 0);
    if (spare < 0.8) bonus('TIGHT SQUEEZE', 200, `only ${spare.toFixed(2)}m to spare`);
    else if (spare < 1.2) bonus('SNUG FIT', 100, `${spare.toFixed(2)}m to spare`);
  }
  const letter = GRADES.find((x) => Math.max(0, score) >= x.min).letter;
  const quips = LOT_QUIPS[letter];
  let quip = quips[Math.floor(Math.random() * quips.length)];
  if (e.noseIn) quip = 'Nose in. I said BACK in. The getaway is ruined.';
  else if (car.propsBroken >= 3) quip = 'You hit more of the car park than you parked in.';
  else if ((car.cartHits || 0) >= 3) quip = 'You hit three shopping carts. They will remember you. They have no brakes and long memories.';
  else if (car.scares >= 3) quip = 'Three shoppers dived for cover. One of them was holding a cake.';
  return finish(score, items, quip, difficulty, mods);
}
