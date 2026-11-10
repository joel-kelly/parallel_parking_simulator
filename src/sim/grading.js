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

  score = Math.max(0, score);
  const g = GRADES.find((x) => score >= x.min);
  const quips = QUIPS[g.letter];
  let quip = quips[Math.floor(Math.random() * quips.length)];
  if (car.propsBroken >= 3) quip = 'You hit more things than you missed. Bold strategy.';
  else if (car.scares >= 3) quip = 'Three people dived for cover. One of them was me. From inside the car.';
  else if (d > 1.0) quip = 'You parked closer to the moon than the curb.';
  else if (car.dings >= 4) quip = 'The other cars are filing a class action.';

  // Hazard pay: each active modifier is worth a bit more.
  const hazard = 1 + 0.2 * mods.size;
  const points = Math.round(score * difficulty.mult * hazard / 4);
  return { score, letter: g.letter, title: g.title, items, quip, points, hazard };
}
