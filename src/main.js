import { View } from './render/view.js';
import { Audio } from './audio.js';
import { loadSave, writeSave } from './save.js';
import { World } from './sim/world.js';
import { buildLevel, DIFFICULTIES } from './sim/level.js';
import { VEHICLES, vehicleById } from './sim/vehicles.js';
import { AI_PROFILES, AIDriver, planPark } from './sim/ai.js';
import { gradePark } from './sim/grading.js';
import { Tutorial } from './tutorial.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const hud = $('hud');

const save = loadSave();
const audio = new Audio();
audio.setMuted(save.muted);
let view;

// ---------------- input ----------------
const keys = new Set();
const pressed = new Set();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', () => audio.unlock());

function readInput(dt) {
  if (game.autopilot) return game.autopilot.update(dt);
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  return {
    throttle: (up ? 1 : 0) - (down ? 1 : 0),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    handbrake: keys.has('Space'),
  };
}

// ---------------- game state ----------------
const game = {
  state: 'menu',   // menu | garage | howto | countdown | play | paused | results
  mode: 'test',
  world: null,
  countdown: 0,
  playTime: 0,
  par: 2,
  bubbleT: 0,
  menuSel: 0,
  result: null,
};

const MODES = [
  { id: 'test', name: 'DRIVING TEST', desc: 'Park between two cars. Get graded by a deeply judgemental instructor.' },
  { id: 'race', name: 'RACE THE AI', desc: 'First one parked wins. Ramming is frowned upon. Not banned. Frowned upon.' },
  { id: 'wreck', name: 'WRECK-REATION', desc: 'No rules. Smash the town. Then file an insurance claim.' },
  { id: 'tutorial', name: 'TUTORIAL', desc: 'Learn the controls in about a minute.' },
  { id: 'garage', name: 'GARAGE', desc: 'Spend points on new rides.' },
  { id: 'howto', name: 'HOW TO PLAY', desc: 'Controls, and a short lecture.' },
];

const INSTRUCTOR = {
  start: ['Whenever you are ready. I have all day. I do not have all day.', 'Park between the cars. The spot with the big bouncing P. Subtle, I know.', 'Ten and two, please. Or don\'t. I\'m not your mum.'],
  ding: ['I felt that in my spine.', 'That car had a family.', 'Was that... a ding? I am writing that down.', 'Gentle! It\'s a car, not a piñata.'],
  curb: ['The curb is not a ramp.', 'We are on the sidewalk now. Lovely view.', 'Pedestrians hate this one trick.'],
  prop: ['Did you just...?!', 'That is coming out of your deposit.', 'The town council will hear about this.'],
  slow: ['Any day now.', 'I\'ve aged a year. Possibly two.', 'Is the car on? Are YOU on?'],
  reverse: ['Beep. Beep. Beep.', 'Reversing! Daring!'],
};
const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

function say(text, secs = 3.5) {
  const b = $('bubble');
  b.innerHTML = text;
  b.classList.remove('hidden');
  game.bubbleT = secs;
}

// ---------------- screens ----------------
function showScreen(html) { screen.innerHTML = html; }
function hideScreen() { screen.innerHTML = ''; }

function diffObj() { return DIFFICULTIES.find((d) => d.id === save.difficulty) || DIFFICULTIES[1]; }

function renderMenu() {
  game.state = 'menu';
  game.pendingMode = null;
  hud.classList.add('hidden');
  const v = vehicleById(save.vehicle);
  showScreen(`
    <div class="window">
      <div class="logo">PARALLEL PARKING<br><span class="l2">SIMULATOR</span></div>
      <div class="tagline">EPISODE ONE: CURB YOUR ENTHUSIASM</div>
      ${save.tutorialSeen ? '' : '<div class="tagline new">NEW HERE? A QUICK TUTORIAL RUNS FIRST (ENTER SKIPS IT)</div>'}
      <ul class="menu" id="menu">
        ${MODES.map((m, i) => `<li data-i="${i}">${m.name}</li>`).join('')}
      </ul>
      <div class="menu-desc" id="menu-desc"></div>
      <div class="row"><span>RIDE: <span class="k">${v.name}</span></span><span>POINTS: <span class="k">${save.points}</span></span></div>
      <div class="hint">W/S + ENTER TO PICK &bull; M MUTE &bull; P RETRO COLOURS<br><span style="color:var(--dgray)">BUILD ${__BUILD__}</span></div>
    </div>`);
  bindList('#menu li', (i) => { game.menuSel = i; highlightMenu(); }, () => menuSelect());
  highlightMenu();
}

// Mouse support for a list: hover selects, click activates.
function bindList(selector, onHover, onClick) {
  screen.querySelectorAll(selector).forEach((el) => {
    const i = +el.dataset.i;
    el.addEventListener('mouseenter', () => onHover(i));
    el.addEventListener('click', () => { onHover(i); onClick(i); });
  });
}

// Moves the highlight without rebuilding the screen (so scrolling is kept),
// and scrolls the selected item into view on short screens.
function setSel(selector, idx) {
  screen.querySelectorAll(selector).forEach((el, i) => {
    el.classList.toggle('sel', i === idx);
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}

function highlightMenu() {
  setSel('#menu li', game.menuSel);
  const d = $('menu-desc');
  if (d) d.textContent = MODES[game.menuSel].desc;
}

function menuSelect() {
  audio.select();
  const m = MODES[game.menuSel];
  if (m.id === 'garage') renderGarage();
  else if (m.id === 'howto') renderHowTo();
  else if (m.id === 'test' || m.id === 'race') renderDifficulty(m.id);
  else startGame(m.id);
}

// ---- difficulty picker (shown after choosing Driving Test or Race) ----
let diffSel = 1;
let diffMode = 'test';
function renderDifficulty(mode) {
  game.state = 'difficulty';
  diffMode = mode;
  diffSel = Math.max(0, DIFFICULTIES.findIndex((d) => d.id === save.difficulty));
  const m = MODES.find((x) => x.id === mode);
  const opp = (d) => (mode === 'race' ? `VS ${AI_PROFILES[d.id].name}` : '');
  const best = (d) => {
    const b = save.best[`${save.vehicle}:${d.id}`];
    return mode === 'test' && b ? `BEST ${b}` : '';
  };
  showScreen(`
    <div class="window" style="max-width:600px">
      <h2>${m.name}</h2>
      <div class="tagline" style="margin-top:0">HOW TIGHT A SPOT CAN YOU HANDLE?</div>
      <ul class="menu" id="diffs">
        ${DIFFICULTIES.map((d, i) => `<li data-i="${i}">${d.name}<span class="desc">${d.blurb}<br>
          <span style="color:var(--lgreen)">+${d.margin.toFixed(2)}M SPARE &bull; x${d.mult} POINTS</span>
          ${opp(d) || best(d) ? `<br><span style="color:var(--lmagenta)">${opp(d) || best(d)}</span>` : ''}</span></li>`).join('')}
      </ul>
      <div class="hint">W/S + ENTER TO START &bull; ESC TO GO BACK</div>
    </div>`);
  bindList('#diffs li', (i) => { diffSel = i; setSel('#diffs li', diffSel); }, () => pickDifficulty());
  setSel('#diffs li', diffSel);
}

function pickDifficulty() {
  save.difficulty = DIFFICULTIES[diffSel].id;
  writeSave(save);
  audio.select();
  startGame(diffMode);
}

let garageSel = 0;
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const owns = (v) => v.cost === 0 || save.unlocked.includes(v.id);

// A vehicle spec with the player's paint job applied.
function paintedSpec(v) {
  const p = save.paint[v.id] || {};
  return { ...v, color: p.color ?? v.color, accent: p.accent ?? v.accent };
}

function renderGarage(msg = '') {
  game.state = 'garage';
  garageSel = Math.max(0, VEHICLES.findIndex((v) => v.id === save.vehicle));
  drawGarage(msg);
}
function drawGarage(msg = '') {
  const scroll = screen.querySelector('.window')?.scrollTop || 0;
  showScreen(`
    <div class="window side">
      <h2>THE GARAGE</h2>
      <div class="row" style="max-width:none;margin:0 0 12px"><span>POINTS: <span class="k">${save.points}</span></span><span class="good">${msg}</span></div>
      <div class="garage">
        ${VEHICLES.map((v, i) => {
          const owned = owns(v);
          const ps = paintedSpec(v);
          const cls = ['car-card', i === garageSel ? 'sel' : '', owned ? '' : 'locked'].join(' ');
          const best = DIFFICULTIES.map((d) => save.best[`${v.id}:${d.id}`]).filter(Boolean);
          let price;
          if (save.vehicle === v.id) price = '<span class="good">&#9654; DRIVING</span>';
          else if (owned) price = v.cost === 0 && !save.unlocked.includes(v.id) ? '<span class="good">FREE! TAKE IT</span>' : 'OWNED';
          else price = save.points >= v.cost ? `<span class="k">BUY: ${v.cost} PTS</span>` : `<span class="bad">${v.cost} PTS</span>`;
          return `<div class="${cls}" data-i="${i}">
            <div class="name"><span class="swatch" style="background:${hex(ps.color)}"></span>${v.name}</div>
            <div class="blurb">${v.blurb}</div>
            <div>LENGTH ${v.length.toFixed(1)}M</div>
            <div class="price">${price}</div>
            ${owned ? '<div class="paint-btn" data-paint="1">&#9998; PAINT (C)</div>' : ''}
            ${best.length ? `<div style="font-size:8px;color:var(--lgray)">BEST ${Math.max(...best)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="hint">ARROWS BROWSE &bull; ENTER BUY / DRIVE &bull; C PAINT &bull; ESC BACK</div>
    </div>`);
  screen.querySelector('.window').scrollTop = scroll;
  screen.querySelectorAll('.car-card').forEach((el) => {
    el.addEventListener('mouseenter', () => { garageSel = +el.dataset.i; setSel('.car-card', garageSel); });
    el.addEventListener('click', (e) => {
      garageSel = +el.dataset.i;
      if (e.target.closest('[data-paint]')) renderPaint(VEHICLES[garageSel]);
      else garageAction();
    });
  });
}
function garageAction() {
  const v = VEHICLES[garageSel];
  if (owns(v)) {
    if (!save.unlocked.includes(v.id)) save.unlocked.push(v.id);
    save.vehicle = v.id; writeSave(save); audio.select(); drawGarage(`${v.name} SELECTED`);
  } else if (save.points >= v.cost) {
    save.points -= v.cost; save.unlocked.push(v.id); save.vehicle = v.id; writeSave(save);
    audio.jingle(true); drawGarage(`BOUGHT ${v.name}!`);
  } else {
    audio.tone(110, 0.2, 'square', 0.1); drawGarage(`NEED ${v.cost - save.points} MORE POINTS`);
  }
}

// ---- paint shop ----
const PALETTE = [
  [0x000000, 'MIDNIGHT'], [0x0000aa, 'NAVY'], [0x00aa00, 'GREEN'], [0x00aaaa, 'TEAL'],
  [0xaa0000, 'MAROON'], [0xaa00aa, 'PURPLE'], [0xaa5500, 'BROWN'], [0xaaaaaa, 'SILVER'],
  [0x555555, 'GRAPHITE'], [0x5555ff, 'BLUE'], [0x55ff55, 'LIME'], [0x55ffff, 'AQUA'],
  [0xff5555, 'SALMON'], [0xff55ff, 'HOT PINK'], [0xffff55, 'YELLOW'], [0xffffff, 'WHITE'],
];
const PAINT_QUIPS = [
  'Fresh coat. Same driving.', 'Paint is free. Dignity costs extra.', 'Go faster stripes: scientifically unproven.',
  'Hides dents. Mostly.', 'The parking meters will never recognise you.',
];
const paint = { veh: null, row: 0, idx: [0, 0], quip: '' };

function renderPaint(v) {
  if (!owns(v)) return;
  game.state = 'paint';
  paint.veh = v;
  paint.row = 0;
  const ps = paintedSpec(v);
  paint.idx = [ps.color, ps.accent].map((c) => Math.max(0, PALETTE.findIndex(([x]) => x === c)));
  paint.quip = PAINT_QUIPS[Math.floor(Math.random() * PAINT_QUIPS.length)];
  audio.select();
  const row = (r, label) => `
    <div class="paint-row" data-row="${r}">
      <div class="paint-label">${label} <span class="paint-name"></span></div>
      <div class="swatches">${PALETTE.map(([c, n], i) => `<div class="sw" data-row="${r}" data-i="${i}" title="${n}" style="background:${hex(c)}"></div>`).join('')}</div>
    </div>`;
  showScreen(`
    <div class="window side" style="max-width:520px">
      <h2>PAINT SHOP</h2>
      <div class="tagline" style="margin-top:0">${v.name}</div>
      ${row(0, 'BODY')}
      ${row(1, 'STRIPE')}
      <div class="quip" style="margin-top:16px">${paint.quip}</div>
      <div class="hint">A/D PICK COLOUR &bull; W/S BODY OR STRIPE<br>R FACTORY PAINT &bull; ENTER / ESC DONE</div>
    </div>`);
  screen.querySelectorAll('.sw').forEach((el) => {
    el.addEventListener('click', () => { paint.row = +el.dataset.row; paint.idx[paint.row] = +el.dataset.i; applyPaint(); });
  });
  drawPaint();
}

function applyPaint() {
  const id = paint.veh.id;
  save.paint[id] = { color: PALETTE[paint.idx[0]][0], accent: PALETTE[paint.idx[1]][0] };
  writeSave(save);
  audio.blip();
  drawPaint();
}

function drawPaint() {
  screen.querySelectorAll('.paint-row').forEach((rowEl) => {
    const r = +rowEl.dataset.row;
    rowEl.classList.toggle('active', r === paint.row);
    rowEl.querySelector('.paint-name').textContent = PALETTE[paint.idx[r]][1];
    rowEl.querySelectorAll('.sw').forEach((el, i) => el.classList.toggle('sel', i === paint.idx[r]));
  });
}

function renderHowTo() {
  game.state = 'howto';
  showScreen(`
    <div class="window howto">
      <h2>HOW TO PLAY</h2>
      <div><span class="k">W / UP</span> GAS (OR BRAKE, IF ROLLING BACKWARD)</div>
      <div><span class="k">S / DOWN</span> BRAKE, THEN REVERSE</div>
      <div><span class="k">A D / ARROWS</span> STEER</div>
      <div><span class="k">SPACE</span> HANDBRAKE (DRIFT, IF YOU MUST)</div>
      <div><span class="k">C</span> CHANGE CAMERA (TOP-DOWN IS GREAT FOR PARKING)</div>
      <div><span class="k">H</span> HORN</div>
      <div><span class="k">R</span> RESTART &nbsp; <span class="k">ESC</span> PAUSE</div>
      <div><span class="k">ENTER</span> CASH OUT (WRECK MODE)</div>
      <div><span class="k">I</span> LET THE INSTRUCTOR PARK (DRIVING TEST, NO POINTS)</div>
      <p style="color:var(--lgray);font-size:9px;line-height:2">
        NO GEARS TO FIDDLE WITH: STOP, THEN HOLD S TO GO BACKWARD. EACH TIME YOU SWITCH
        DIRECTION IT COUNTS AS A MOVE. BEAT THE INSTRUCTOR'S PAR FOR FULL MARKS.<br><br>
        TO PARK: STOP INSIDE THE SPOT, CLOSE TO THE CURB, MORE OR LESS STRAIGHT, AND HOLD STILL.<br><br>
        CLASSIC TECHNIQUE: PULL UP ALONGSIDE THE FRONT CAR. REVERSE WITH FULL RIGHT LOCK
        UNTIL YOU'RE AT ~45&deg;. THEN FULL LEFT LOCK AS YOU SWING IN. SHUFFLE IF NEEDED.
      </p>
      <div class="hint">ESC OR ENTER TO GO BACK</div>
    </div>`);
}

// ---------------- gameplay ----------------
function startGame(mode) {
  // First time playing anything: run the tutorial first, then carry on.
  if (mode !== 'tutorial' && !save.tutorialSeen) {
    game.pendingMode = mode;
    mode = 'tutorial';
  }
  if (mode === 'tutorial') {
    save.tutorialSeen = true;
    writeSave(save);
  }
  game.mode = mode;
  const tutorial = mode === 'tutorial';
  const vehicle = paintedSpec(vehicleById(save.vehicle));
  const diff = tutorial ? DIFFICULTIES[0] : diffObj();
  const seed = tutorial ? 11 : Math.floor(Math.random() * 1e9);
  const level = buildLevel({ mode: tutorial ? 'test' : mode, difficulty: diff.id, vehicle, seed });
  const opts = {};
  if (mode === 'race') {
    opts.aiSpec = vehicleById(save.vehicle);
    opts.aiProfile = AI_PROFILES[diff.id];
  }
  const world = new World(level, vehicle, opts);
  game.world = world;
  game.playTime = 0;
  game.idleT = 0;
  game.saidReverse = false;
  game.result = null;
  game.autopilot = null;
  game.tutorial = tutorial ? new Tutorial($('tutor')) : null;
  $('tutor').classList.toggle('hidden', !tutorial);
  if (world.playerSpot) {
    const plan = planPark(world, world.playerSpot, vehicle);
    game.par = plan ? plan.moves : 6;
  }
  view.load(world);
  hideScreen();
  hud.classList.remove('hidden');
  hud.classList.toggle('tutorial', tutorial);
  $('bubble').classList.add('hidden');
  game.state = 'countdown';
  game.countdown = mode === 'race' ? 3.99 : 1.2;
  game.lastCount = 99;
  if (mode === 'test') say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.start)}`, 5);
  if (mode === 'race') say(`<b>${opts.aiProfile.name}:</b> "${opts.aiProfile.taunt}"`, 4);
  if (tutorial) say('<b>INSTRUCTOR:</b> Welcome to driving school. Follow the instructions up top.', 4);
  if (mode === 'wreck') say('<b>WRECK-REATION:</b> Everything is breakable. Trees. Shops. Whole buildings (keep ramming). Press ENTER to file your insurance claim.', 6);
}

function updateHUD() {
  const w = game.world;
  const p = w.player;
  const t = game.playTime.toFixed(1);
  const mode = MODES.find((m) => m.id === game.mode).name;
  let tl = `<div class="k">${mode}</div>`;
  if (game.mode === 'tutorial') {
    const tu = game.tutorial;
    tl += `<div>STEP <span class="v">${Math.min(tu.step + 1, tu.total)}/${tu.total}</span></div>`;
    tl += `<div>DINGS <span class="${p.dings ? 'bad' : 'v'}">${p.dings}</span></div>`;
  } else if (game.mode === 'wreck') {
    tl += `<div>DAMAGE <span class="bad">$${w.destruction.toLocaleString()}</span></div>`;
    tl += `<div>THINGS BROKEN <span class="v">${p.propsBroken}</span></div>`;
    tl += `<div>CARS WRECKED <span class="v">${w.parked.filter((c) => c.wrecked).length}</span></div>`;
  } else {
    tl += `<div>TIME <span class="v">${t}s</span></div>`;
    tl += `<div>MOVES <span class="v">${p.moves}</span> <span style="color:var(--lgray)">PAR ${game.par}</span></div>`;
    tl += `<div>DINGS <span class="${p.dings ? 'bad' : 'v'}">${p.dings}</span></div>`;
  }
  $('hud-tl').innerHTML = tl;

  let tr = `<div>${game.mode === 'tutorial' ? 'PRACTICE' : diffObj().name}</div><div>PTS <span class="k">${save.points}</span></div>`;
  if (game.mode === 'race' && w.ai) {
    const a = w.ai.car;
    const status = a.parked ? '<span class="bad">PARKED!</span>' : w.ai.driver.gaveUp ? '<span class="good">GAVE UP</span>' : 'PARKING...';
    tr += `<div style="color:var(--lmagenta)">${w.ai.driver.p.name}</div><div>${status}</div>`;
  }
  $('hud-tr').innerHTML = tr;

  const kmh = Math.round(Math.abs(p.speed) * 3.6);
  let bl = `<div class="gear ${p.gear === 'R' ? 'r' : ''}">${p.gear}</div><div><div>${kmh} KM/H</div>`;
  if (p.lastEval && (p.lastEval.inSpot || p.lastEval.curbDist < 2.5) && game.mode !== 'wreck') {
    const e = p.lastEval;
    const cd = e.curbDist < 0 ? '<span class="bad">ON CURB</span>' : `<span class="${e.curbDist < 0.35 ? 'good' : 'v'}">${e.curbDist.toFixed(2)}M</span>`;
    bl += `<div style="font-size:9px">CURB ${cd} &nbsp;ANGLE <span class="${e.angle < 3 ? 'good' : 'v'}">${e.angle.toFixed(0)}&deg;</span></div>`;
  }
  bl += '</div>';
  $('hud-bl').innerHTML = bl;
  $('hud-br').innerHTML = `WASD DRIVE &bull; SPACE BRAKE<br>C CAMERA &bull; H HORN<br>R RESTART &bull; ESC PAUSE${game.mode === 'test' ? '<br>I INSTRUCTOR DEMO' : ''}`;

  const park = $('hud-park');
  if (p.parkTimer > 0 && !p.parked) {
    park.classList.remove('hidden');
    $('hud-park-fill').style.width = `${Math.min(100, p.parkTimer / 1.5 * 100)}%`;
  } else park.classList.add('hidden');
}

function handleEvents(events) {
  const w = game.world;
  for (const e of events) {
    view.handle(e);
    if (e.type === 'ding') {
      if (e.car.isPlayer || e.impact > 1) audio.crash(e.impact);
      if (e.car.isPlayer && game.mode === 'test' && e.impact > 0.4) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.ding)}`);
    } else if (e.type === 'break') {
      audio.crash(3);
      if (e.prop.type === 'meter') audio.coin();
      if (game.mode === 'test' && e.by && e.by.isPlayer) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.prop)}`);
    } else if (e.type === 'wreck') audio.boom();
    else if (e.type === 'smash' || e.type === 'facade') audio.smash();
    else if (e.type === 'collapse') { audio.boom(); audio.smash(); }
    else if (e.type === 'curb' && e.car.isPlayer) {
      audio.curb();
      if (game.mode === 'test') say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.curb)}`);
    } else if (e.type === 'parked') {
      audio.jingle(e.car.isPlayer);
    }
  }
  if (game.state !== 'play') return;
  // end conditions
  if (game.mode === 'test' && w.player.parked) finishTest();
  if (game.mode === 'race') {
    if (w.player.parked) finishRace(true);
    else if (w.ai.car.parked) finishRace(false);
  }
}

function finishTest() {
  const w = game.world;
  const r = gradePark({ car: w.player, evalResult: w.player.finalEval, time: game.playTime, par: game.par, difficulty: diffObj() });
  if (game.autopilot) {
    r.points = 0;
    r.quip = 'The instructor parked it. You get nothing. Good day, sir.';
  }
  awardPoints(r.points);
  const key = `${save.vehicle}:${save.difficulty}`;
  const isBest = !game.autopilot && (!save.best[key] || r.score > save.best[key]);
  if (isBest) save.best[key] = r.score;
  writeSave(save);
  endWith(() => renderResults({
    title: 'TEST COMPLETE',
    grade: r.letter, gradeTitle: r.title, quip: r.quip, items: r.items,
    total: `SCORE ${r.score}${isBest ? ' (NEW BEST!)' : ''}`, points: r.points,
  }));
}

function finishRace(won, forfeit = false) {
  const w = game.world;
  const d = diffObj();
  let points = 0, quip, grade;
  const ai = w.ai.driver.p;
  if (won) {
    points = Math.round((150 + Math.max(0, 60 - game.playTime) * 3 - w.player.dings * 15) * d.mult);
    points = Math.max(20, points);
    if (forfeit) points = Math.round(points * 0.5);
    grade = 'WIN';
    quip = forfeit ? `${ai.name} gave up and called a tow truck. A win is a win. (Half points.)`
      : pickLine([`${ai.name} is furious. Sublime.`, `You beat ${ai.name}. They will remember this.`, 'Victory! Your insurance premiums remain unchanged.']);
    save.wins++;
  } else {
    points = 15;
    grade = 'LOSE';
    quip = pickLine([`${ai.name}: "${ai.taunt}"`, 'Beaten by a computer. It happens to the best of us. And to you.', `${ai.name} parked in ${w.ai.car.parkedAt.toFixed(1)}s. Just saying.`]);
  }
  awardPoints(points);
  writeSave(save);
  const items = [
    { label: 'YOUR TIME', pts: null, detail: won ? `${game.playTime.toFixed(1)}s` : 'DNF' },
    { label: 'DINGS', pts: null, detail: String(w.player.dings) },
    { label: 'MOVES', pts: null, detail: String(w.player.moves) },
  ];
  endWith(() => renderResults({ title: won ? 'YOU WIN!' : 'YOU LOSE!', grade, gradeTitle: won ? 'SPEED PARKER' : 'SECOND PLACE (OF TWO)', quip, items, total: '', points }));
}

function finishWreck() {
  const w = game.world;
  const points = Math.min(500, Math.round(w.destruction / 150));
  awardPoints(points);
  writeSave(save);
  const wrecked = w.parked.filter((c) => c.wrecked).length;
  const quip = w.destruction > 60000 ? 'The town has been renamed in your honour. It is now called "The Crater".'
    : w.destruction > 20000 ? 'Your insurer has entered witness protection.'
      : w.destruction > 5000 ? 'A respectable amount of chaos. The mayor is concerned.'
        : 'That is barely a fender bender. Are you even trying?';
  endWith(() => renderResults({
    title: 'INSURANCE CLAIM', grade: `$${Math.round(w.destruction / 1000)}K`, gradeTitle: 'TOTAL DAMAGES',
    quip,
    items: [
      { label: 'THINGS SMASHED', detail: String(w.player.propsBroken) },
      { label: 'CARS WRECKED', detail: String(wrecked) },
      { label: 'YOUR CAR', detail: w.player.damage > 200 ? 'A SMOKING RUIN' : w.player.damage > 60 ? 'DENTED' : 'SUSPICIOUSLY FINE' },
    ],
    total: '', points,
  }));
}

function finishTutorial(skipped) {
  const next = game.pendingMode;
  game.pendingMode = null;
  $('tutor').classList.add('hidden');
  if (skipped) {
    if (next) startGame(next); else renderMenu();
    return;
  }
  let msg = 'You are now a licensed driver. Sort of. Legally? Unclear.';
  if (!save.tutorialDone && !game.autopilot) {
    save.tutorialDone = true;
    awardPoints(50);
    writeSave(save);
    msg += ' Have 50 points.';
  }
  $('hud-center').innerHTML = `LICENSED!<div class="sub">${next ? 'NOW FOR THE REAL THING...' : 'BACK TO THE MENU...'}</div>`;
  say(`<b>INSTRUCTOR:</b> ${msg}`, 4);
  audio.jingle(true);
  endWith(() => {
    $('hud-center').innerHTML = '';
    if (next) startGame(next); else renderMenu();
  });
  game.endT = 3.5;
}

function awardPoints(n) {
  const before = save.points;
  save.points += n;
  save.totalEarned += n;
  game.newlyAffordable = VEHICLES.filter((v) => !save.unlocked.includes(v.id) && v.cost > before && v.cost <= save.points);
}

function endWith(fn) {
  game.state = 'ending';
  game.endT = 1.6;
  game.endFn = fn;
}

function renderResults(r) {
  game.state = 'results';
  hud.classList.add('hidden');
  const items = (r.items || []).map((it) => `<div class="line"><span>${it.label}</span><span class="d">${it.detail || ''}</span><span class="${it.pts < 0 ? 'bad' : ''}">${it.pts == null ? '' : it.pts}</span></div>`).join('');
  const unlock = game.newlyAffordable && game.newlyAffordable.length
    ? `<div class="good" style="font-size:10px;margin-top:12px">NEW RIDE AFFORDABLE: ${game.newlyAffordable.map((v) => v.name).join(', ')}! VISIT THE GARAGE.</div>` : '';
  showScreen(`
    <div class="window results">
      <h2>${r.title}</h2>
      <div class="grade" style="${r.grade.length > 2 ? 'font-size:56px' : ''}">${r.grade}</div>
      <div class="grade-title">${r.gradeTitle}</div>
      <div class="quip">${r.quip}</div>
      <div class="breakdown">${items}</div>
      ${r.total ? `<div class="total">${r.total}</div>` : ''}
      <div class="total">+${r.points} POINTS &nbsp; <span style="color:var(--lgray)">(TOTAL ${save.points})</span></div>
      ${unlock}
      <div class="hint">ENTER: GO AGAIN &bull; G: GARAGE &bull; ESC: MENU</div>
    </div>`);
}

function renderPause() {
  game.state = 'paused';
  showScreen(`
    <div class="window" style="max-width:420px;text-align:center">
      <h2>PAUSED</h2>
      <p style="font-size:10px;line-height:2;color:var(--lgray)">THE INSTRUCTOR SIGHS AUDIBLY.</p>
      <div class="hint" style="font-size:10px">ESC: RESUME &bull; R: RESTART &bull; Q: QUIT TO MENU</div>
    </div>`);
}

// ---------------- per-state key handling ----------------
function handleKeys() {
  const hit = (c) => pressed.has(c);
  if (hit('KeyM')) { save.muted = !save.muted; audio.setMuted(save.muted); writeSave(save); }
  if (hit('KeyP')) { save.ega = !save.ega; view.setEga(save.ega); writeSave(save); }

  switch (game.state) {
    case 'menu':
      if (hit('KeyW') || hit('ArrowUp')) { game.menuSel = (game.menuSel + MODES.length - 1) % MODES.length; highlightMenu(); audio.blip(); }
      if (hit('KeyS') || hit('ArrowDown')) { game.menuSel = (game.menuSel + 1) % MODES.length; highlightMenu(); audio.blip(); }
      if (hit('Enter') || hit('Space')) menuSelect();
      break;
    case 'difficulty':
      if (hit('KeyW') || hit('ArrowUp')) { diffSel = (diffSel + DIFFICULTIES.length - 1) % DIFFICULTIES.length; setSel('#diffs li', diffSel); audio.blip(); }
      if (hit('KeyS') || hit('ArrowDown')) { diffSel = (diffSel + 1) % DIFFICULTIES.length; setSel('#diffs li', diffSel); audio.blip(); }
      if (hit('Enter') || hit('Space')) pickDifficulty();
      if (hit('Escape')) renderMenu();
      break;
    case 'garage': {
      const cols = Math.max(1, Math.round((screen.querySelector('.garage')?.clientWidth || 600) / 212));
      let moved = false;
      if (hit('KeyA') || hit('ArrowLeft')) { garageSel = (garageSel + VEHICLES.length - 1) % VEHICLES.length; moved = true; }
      if (hit('KeyD') || hit('ArrowRight')) { garageSel = (garageSel + 1) % VEHICLES.length; moved = true; }
      if (hit('KeyW') || hit('ArrowUp')) { garageSel = Math.max(0, garageSel - cols); moved = true; }
      if (hit('KeyS') || hit('ArrowDown')) { garageSel = Math.min(VEHICLES.length - 1, garageSel + cols); moved = true; }
      if (moved) { audio.blip(); setSel('.car-card', garageSel); }
      if (hit('Enter') || hit('Space')) garageAction();
      if (hit('KeyC')) {
        if (owns(VEHICLES[garageSel])) renderPaint(VEHICLES[garageSel]);
        else { audio.tone(110, 0.2, 'square', 0.1); drawGarage('BUY IT BEFORE YOU PAINT IT'); }
      }
      if (hit('Escape')) renderMenu();
      break;
    }
    case 'paint': {
      const n = PALETTE.length;
      if (hit('KeyA') || hit('ArrowLeft')) { paint.idx[paint.row] = (paint.idx[paint.row] + n - 1) % n; applyPaint(); }
      if (hit('KeyD') || hit('ArrowRight')) { paint.idx[paint.row] = (paint.idx[paint.row] + 1) % n; applyPaint(); }
      if (hit('KeyW') || hit('ArrowUp') || hit('KeyS') || hit('ArrowDown')) { paint.row = 1 - paint.row; audio.blip(); drawPaint(); }
      if (hit('KeyR')) {
        delete save.paint[paint.veh.id]; writeSave(save);
        renderPaint(paint.veh);
      }
      if (hit('Enter') || hit('Escape')) {
        const v = paint.veh;
        renderGarage();
        garageSel = VEHICLES.indexOf(v);
        setSel('.car-card', garageSel);
      }
      break;
    }
    case 'howto':
      if (hit('Escape') || hit('Enter')) renderMenu();
      break;
    case 'countdown':
    case 'play':
      if (hit('Escape')) { renderPause(); break; }
      if (hit('KeyR')) { startGame(game.mode); break; }
      if (hit('KeyC')) { view.cycleCamera(); if (game.tutorial) game.tutorial.camPresses++; }
      if (hit('Space') && game.tutorial) game.tutorial.handbrake = true;
      if (game.mode === 'tutorial' && hit('Enter')) { finishTutorial(true); break; }
      if (hit('KeyH')) audio.horn(game.world.player.spec.style);
      if (game.state === 'play' && game.mode === 'wreck' && hit('Enter')) finishWreck();
      if (game.state === 'play' && (game.mode === 'test' || game.mode === 'tutorial') && hit('KeyI') && !game.autopilot) {
        const w = game.world;
        game.autopilot = new AIDriver(w, w.player, w.playerSpot, AI_PROFILES.normal);
        say('<b>INSTRUCTOR:</b> Oh, for heaven\'s sake. Move over. Watch and learn.', 5);
      }
      break;
    case 'paused':
      if (hit('Escape')) { hideScreen(); game.state = 'play'; }
      if (hit('KeyR')) startGame(game.mode);
      if (hit('KeyQ')) renderMenu();
      break;
    case 'results':
      if (hit('Enter') || hit('Space')) startGame(game.mode);
      if (hit('KeyG')) renderGarage();
      if (hit('Escape')) renderMenu();
      break;
    default:
  }
  pressed.clear();
}

// ---------------- main loop ----------------
let last = performance.now();
let frameErrors = 0;
function frame(now) {
  // One bad frame shouldn't freeze the game: keep the loop alive and report it.
  try {
    step(now);
  } catch (e) {
    frameErrors++;
    console.error(e);
    if (frameErrors === 1) say(`<b>OOPS:</b> something glitched (${e.message}). If things look wrong, press R or reload.`, 8);
  }
  requestAnimationFrame(frame);
}

function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  handleKeys();

  const w = game.world;
  if (game.bubbleT > 0) { game.bubbleT -= dt; if (game.bubbleT <= 0) $('bubble').classList.add('hidden'); }

  if (game.state === 'countdown') {
    game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    if (game.mode === 'race' && n !== game.lastCount && n > 0) { audio.countdown(false); game.lastCount = n; }
    $('hud-center').innerHTML = game.mode === 'race' ? (n > 0 ? String(n) : '') : '';
    if (game.countdown <= 0) {
      game.state = 'play';
      if (game.mode === 'race') {
        audio.countdown(true);
        $('hud-center').innerHTML = 'PARK!';
        setTimeout(() => { if ($('hud-center').innerHTML === 'PARK!') $('hud-center').innerHTML = ''; }, 900);
      }
    }
    view.update(dt);
    updateHUD();
  } else if (game.state === 'play' || game.state === 'ending') {
    const input = game.state === 'play' ? readInput(dt) : { throttle: 0, steer: 0, handbrake: true };
    w.step(dt, input);
    game.playTime += game.state === 'play' ? dt : 0;
    handleEvents(w.drainEvents());
    if (game.state === 'play' && game.tutorial) {
      if (game.tutorial.update(dt, input, w)) audio.select();
      if (game.tutorial.finished) finishTutorial(false);
    }
    if (game.state === 'play' && game.mode === 'race' && w.ai.driver.gaveUp && !w.ai.car.parked) finishRace(true, true);

    // instructor nags
    if (game.mode === 'test' && game.state === 'play') {
      if (Math.abs(w.player.speed) < 0.05) game.idleT += dt; else game.idleT = 0;
      if (game.idleT > 12) { say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.slow)}`); game.idleT = 0; }
      if (!game.saidReverse && w.player.gear === 'R' && w.player.speed < -0.5) { game.saidReverse = true; say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.reverse)}`, 2); }
    }
    audio.reverseBeep(dt, w.player.gear === 'R' && w.player.speed < -0.2);
    view.update(dt);
    updateHUD();
    if (game.state === 'ending') {
      game.endT -= dt;
      if (game.endT <= 0) game.endFn();
    }
  } else if (game.state === 'garage' || game.state === 'paint') {
    const v = game.state === 'paint' ? paint.veh : VEHICLES[garageSel];
    const ps = paintedSpec(v);
    view.renderShowcase(dt, ps, ps.color, ps.accent, window.innerWidth >= 900);
  } else if (game.state !== 'paused') {
    view.renderIdle(dt);
  }
}

async function boot() {
  // Don't let a slow font download hold up the game.
  try {
    await Promise.race([document.fonts.load('16px "Press Start 2P"'), new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) { /* fall back to monospace */ }
  try {
    view = new View($('game'), $('popups'));
  } catch (e) {
    window.__ppsFail('GRAPHICS TROUBLE', `Your browser couldn't start WebGL, which the game needs.<br><br>
      Try reloading, restarting the browser, or turning on hardware acceleration.<br><br>(${e.message})`);
    return;
  }
  $('game').addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    window.__ppsFail('GRAPHICS CRASHED', 'Your browser reset the graphics. Reload the page to keep playing.');
  });
  view.setEga(save.ega);
  // a scenic wreck-mode street behind the menu
  const vehicle = vehicleById(save.vehicle);
  const level = buildLevel({ mode: 'test', difficulty: 'normal', vehicle, seed: 7 });
  const world = new World(level, vehicle, {});
  game.world = world;
  view.load(world);
  renderMenu();
  window.__ppsBooted = true;
  $('boot-msg').style.display = 'none';
  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) window.__pps = { game, save };

boot();
