import { View } from './render/view.js';
import { Audio } from './audio.js';
import { loadSave, writeSave, todayKey } from './save.js';
import { World } from './sim/world.js';
import { buildLevel, DIFFICULTIES, rng } from './sim/level.js';
import { VEHICLES, vehicleById, NITRO_MAX } from './sim/vehicles.js';
import { AI_PROFILES, AIDriver, planPark } from './sim/ai.js';
import { gradePark } from './sim/grading.js';
import { Tutorial } from './tutorial.js';
import { MODS, RANDOM_POOL, modNames } from './sim/mods.js';
import { CAREER, careerUnlocked, careerStars, starsFor, FIRST_CLEAR_BONUS, STAR_BONUS } from './sim/career.js';
import { TROPHIES, TROPHY_POINTS, checkTrophies } from './sim/achievements.js';
import { pollPads, setLayouts, hasLayout, rumble, setRumble, stopRumble } from './gamepad.js';
import { PadSetup } from './padsetup.js';
import { setLook, cssHex } from './render/looks.js';

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const hud = $('hud');

const save = loadSave();
setLayouts(save.padLayouts);
setRumble(save.rumble);
const audio = new Audio();
audio.setMuted(save.muted);
let view;

const WRECK_TIME = 120;   // seconds until the police turn up
const SHIFT_STRIKES = 3;

// ---------------- input ----------------
const keys = new Set();
const pressed = new Map(); // code -> presses since the last frame
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
let pad = { throttle: 0, steer: 0, handbrake: false };
let usingPad = false; // last input came from a controller: show its button names
window.addEventListener('keydown', (e) => {
  audio.unlock();
  usingPad = false;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.set(e.code, (pressed.get(e.code) || 0) + 1);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// Brief notice when a controller connects, naming what the browser sees.
window.addEventListener('gamepadconnected', (e) => {
  const gp = e.gamepad;
  const el = document.createElement('div');
  el.className = 'pad-toast';
  const known = gp.mapping === 'standard' || hasLayout(gp.id);
  el.textContent = `CONTROLLER CONNECTED: ${gp.id}${known ? '' : ' (NON-STANDARD LAYOUT: RUN CONTROLLER SETUP FROM THE MENU)'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
  // An unknown layout on the title screen: go straight to setup.
  if (!known && game.state === 'menu') renderPadSetup();
});
window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', () => audio.unlock());

function readInput(dt) {
  if (game.autopilot) return game.autopilot.update(dt);
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    throttle: clamp((up ? 1 : 0) - (down ? 1 : 0) + pad.throttle),
    steer: clamp((right ? 1 : 0) - (left ? 1 : 0) + pad.steer),
    handbrake: keys.has('Space') || pad.handbrake,
    nitro: keys.has('ShiftLeft') || keys.has('ShiftRight') || !!pad.nitro,
  };
}

// Controllers: analog values feed readInput, button presses join the keyboard's.
function pollController() {
  const s = game.state;
  if (s === 'padsetup') { pad = { throttle: 0, steer: 0, handbrake: false, codes: [] }; return; }
  pad = pollPads(s === 'play' || s === 'countdown' ? 'drive' : s === 'paused' ? 'paused' : 'menu');
  for (const c of pad.codes) pressed.set(c, (pressed.get(c) || 0) + 1);
  if (pad.active) { audio.unlock(); usingPad = true; }
  if (game.tutorial) game.tutorial.setPad(usingPad);
}

// ---------------- game state ----------------
const game = {
  state: 'menu',   // menu | free | difficulty | career | trophies | garage | paint | howto | countdown | play | paused | ending | results
  run: null,       // the current run's configuration (see startRun)
  world: null,
  countdown: 0,
  playTime: 0,
  bubbleT: 0,
  menuSel: 0,
  freeSel: 0,
  careerSel: 0,
  result: null,
  slow: 0,         // seconds of slow motion left
  pendingRun: null,
};

const MENU = [
  { id: 'career', name: 'CAREER', desc: `${CAREER.length} levels of escalating nonsense: traffic, ice, earthquakes, a bus. Earn stars.` },
  { id: 'shift', name: 'VALET SHIFT', desc: 'Endless. Customers keep coming, the spots keep shrinking, the clock keeps ticking. Three strikes.' },
  { id: 'daily', name: 'DAILY DARE', desc: 'One fixed challenge per day. Same for everyone. Brag accordingly.' },
  { id: 'free', name: 'FREE PLAY', desc: 'Driving Test, Race the AI, Wreck-reation, Tutorial.' },
  { id: 'garage', name: 'GARAGE', desc: 'Spend points on new rides. Paint them badly.' },
  { id: 'trophies', name: 'TROPHIES', desc: 'Achievements. Each one is worth points and smugness.' },
  { id: 'howto', name: 'HOW TO PLAY', desc: 'Controls, hazards, and a short lecture.' },
  { id: 'pad', name: 'CONTROLLER SETUP', desc: 'Teach the game your controller: press each button when asked. Pick your own horn button.' },
];
const FREE = [
  { id: 'test', name: 'DRIVING TEST', desc: 'Park between two cars. Get graded by a deeply judgemental instructor.' },
  { id: 'race', name: 'RACE THE AI', desc: 'First one parked wins. Ramming is frowned upon. Not banned. Frowned upon.' },
  { id: 'wreck', name: 'WRECK-REATION', desc: 'Two minutes before the cops arrive. Smash the town. Chain smashes for combos. SHIFT for nitro.' },
  { id: 'tutorial', name: 'TUTORIAL', desc: 'Learn the controls in about a minute.' },
  { id: 'back', name: 'BACK', desc: '' },
];
const SIM_NAMES = { test: 'DRIVING TEST', race: 'RACE THE AI', wreck: 'WRECK-REATION', tutorial: 'TUTORIAL', career: 'CAREER', shift: 'VALET SHIFT', daily: 'DAILY DARE' };

const INSTRUCTOR = {
  start: ['Whenever you are ready. I have all day. I do not have all day.', 'Park between the cars. The spot with the big bouncing P. Subtle, I know.', 'Ten and two, please. Or don\'t. I\'m not your mum.'],
  ding: ['I felt that in my spine.', 'That car had a family.', 'Was that... a ding? I am writing that down.', 'Gentle! It\'s a car, not a piñata.'],
  curb: ['The curb is not a ramp.', 'We are on the sidewalk now. Lovely view.', 'Pedestrians hate this one trick.'],
  prop: ['Did you just...?!', 'That is coming out of your deposit.', 'The town council will hear about this.'],
  slow: ['Any day now.', 'I\'ve aged a year. Possibly two.', 'Is the car on? Are YOU on?'],
  reverse: ['Beep. Beep. Beep.', 'Reversing! Daring!'],
  honk: ['Someone is honking. At you. Specifically.', 'That is the sound of the public forming an opinion.', 'They can wait. They cannot wait. Hurry.'],
  scare: ['You nearly flattened that one.', 'They dived. Beautifully. Into a bin.', 'Pedestrians have rights. Allegedly.'],
  quake: ['EARTHQUAKE! Not my fault, for once.', 'The ground is moving. Park faster.', 'Hold on to something. Not the horn.'],
  creep: ['That driver is backing into your spot. Deal with it.', 'Your spot is shrinking. Like my patience.'],
  timeLow: ['Ten seconds. Tick tock.', 'Time is a flat circle. Yours is almost up.'],
  hidden: ['No marker today. Find a gap you fit in. Any gap.', 'Several gaps. One of them is yours. Tighter ones pay more.'],
};
const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

function say(text, secs = 3.5) {
  const b = $('bubble');
  b.innerHTML = text;
  b.classList.remove('hidden');
  game.bubbleT = secs;
}

function toast(title, body) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.innerHTML = `<div class="t">${title}</div>${body}`;
  $('toasts').appendChild(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 350); }, 4500);
}

// ---------------- screens ----------------
function showScreen(html) { screen.innerHTML = html; }
function hideScreen() { screen.innerHTML = ''; }

function diffObj() { return DIFFICULTIES.find((d) => d.id === save.difficulty) || DIFFICULTIES[1]; }
const stars = (n, max = 3) => Array.from({ length: max }, (_, i) => `<span class="${i < n ? '' : 'off'}">&#9733;</span>`).join('');
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Rotating slogans under the logo, like loading-screen quips.
const SLOGANS = [
  'EPISODE TWO: CURB YOUR ENTHUSIASM HARDER',
  'NOW WITH 40% MORE CURB',
  'OBJECTS IN MIRROR ARE CLOSER THAN THEY APPEAR',
  'YOUR INSURANCE PROVIDER HAS BEEN NOTIFIED',
  'TIP: THE BRAKE IS ALSO A PEDAL',
  'TIP: HONKING DOES NOT MAKE THE SPOT BIGGER',
  "IT'S NOT A DENT. IT'S CHARACTER.",
  'REVERSE IS JUST FORWARD WITH TRUST ISSUES',
  "THE SPOT IS BIGGER THAN IT LOOKS. IT ISN'T.",
  'NO PEDESTRIANS WERE HARMED. THEY LEFT.',
  'TIP: THE CURB IS NOT A SUGGESTION',
  'TIP: CHECK YOUR MIRRORS. ADMIRE YOURSELF.',
  'TIP: A 47-POINT TURN IS STILL A TURN',
  'TIP: THE PERSON BEHIND YOU IS JUDGING YOU',
  'TIP: THAT NOISE WAS PROBABLY FINE',
  'TIP: SIGNAL. NOBODY ELSE WILL.',
  'RATED E FOR EVENTUALLY',
  'LOADING SMUG ONLOOKERS...',
  'WARNING: CONTAINS TIGHT SPOTS',
  'BUMPERS: THEY ARE FOR BUMPING',
  'ESTABLISHED 1991. LICENSE PENDING.',
  'SHAREWARE! PLEASE REGISTER YOUR BUMPER.',
  'AS SEEN ON A DRIVING TEST NEAR YOU',
  'THE METER IS RUNNING. SO IS YOUR NOSE.',
  'NOW PARKING: ABSOLUTELY NOBODY',
];
let sloganIdx = 0;
setInterval(() => {
  const el = $('slogan');
  if (!el) return;
  let next = sloganIdx;
  while (next === sloganIdx) next = Math.floor(Math.random() * SLOGANS.length);
  sloganIdx = next;
  el.classList.add('out');
  setTimeout(() => { el.textContent = SLOGANS[sloganIdx]; el.classList.remove('out'); }, 350);
}, 4500);

function renderMenu() {
  game.state = 'menu';
  game.pendingRun = null;
  hud.classList.add('hidden');
  const v = vehicleById(save.vehicle);
  const total = CAREER.length * 3;
  const tag = (m) => {
    if (m.id === 'career') return `<span class="tag">${careerStars(save)}/${total} &#9733;</span>`;
    if (m.id === 'trophies') return `<span class="tag">${save.trophies.length}/${TROPHIES.length}</span>`;
    if (m.id === 'shift' && save.shiftBestRound) return `<span class="tag">BEST ${save.shiftBest}</span>`;
    if (m.id === 'daily' && save.daily[todayKey()] != null) return '<span class="tag">DONE TODAY</span>';
    return '';
  };
  showScreen(`
    <div class="window">
      <div class="logo">PARALLEL PARKING<br><span class="l2">SIMULATOR</span></div>
      <div class="tagline slogan" id="slogan">${SLOGANS[sloganIdx]}</div>
      ${save.tutorialSeen ? '' : '<div class="tagline new">NEW HERE? A QUICK TUTORIAL RUNS FIRST (ENTER SKIPS IT)</div>'}
      <ul class="menu" id="menu">
        ${MENU.map((m, i) => `<li data-i="${i}">${m.name}${tag(m)}</li>`).join('')}
      </ul>
      <div class="menu-desc" id="menu-desc"></div>
      <div class="row"><span>RIDE: <span class="k">${v.name}</span></span><span>POINTS: <span class="k">${save.points}</span></span></div>
      <div class="hint">W/S + ENTER TO PICK &bull; M MUTE &bull; P CLASSIC COLOURS &bull; V RUMBLE<br><span style="color:var(--dgray)">BUILD ${__BUILD__}</span></div>
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
  if (!d) return;
  const m = MENU[game.menuSel];
  if (m.id === 'daily') {
    const c = dailyConfig();
    const best = save.daily[c.dailyKey];
    d.innerHTML = `${m.desc}<br><span class="k">TODAY:</span> ${vehicleById(c.vehicle).name} &bull; ${c.diff.toUpperCase()}${c.mods.length ? ' &bull; ' + modNames(new Set(c.mods)).join(' + ') : ''}${c.time ? ` &bull; ${c.time}S LIMIT` : ''}${best != null ? `<br><span class="good">YOUR BEST TODAY: ${best}</span>` : ''}`;
  } else d.textContent = m.desc;
}

function menuSelect() {
  audio.select();
  const m = MENU[game.menuSel];
  if (m.id === 'garage') renderGarage();
  else if (m.id === 'howto') renderHowTo();
  else if (m.id === 'pad') renderPadSetup();
  else if (m.id === 'free') renderFree();
  else if (m.id === 'career') renderCareer();
  else if (m.id === 'trophies') renderTrophies();
  else if (m.id === 'shift') startShift();
  else if (m.id === 'daily') startRun(dailyConfig());
}

// ---- free play submenu ----
function renderFree() {
  game.state = 'free';
  showScreen(`
    <div class="window" style="max-width:600px">
      <h2>FREE PLAY</h2>
      <ul class="menu" id="free">${FREE.map((m, i) => `<li data-i="${i}">${m.name}</li>`).join('')}</ul>
      <div class="menu-desc" id="free-desc"></div>
      <div class="hint">W/S + ENTER TO PICK &bull; ESC TO GO BACK</div>
    </div>`);
  bindList('#free li', (i) => { game.freeSel = i; highlightFree(); }, () => freeSelect());
  highlightFree();
}
function highlightFree() {
  setSel('#free li', game.freeSel);
  const d = $('free-desc');
  if (d) d.textContent = FREE[game.freeSel].desc;
}
function freeSelect() {
  audio.select();
  const m = FREE[game.freeSel];
  if (m.id === 'back') renderMenu();
  else if (m.id === 'test' || m.id === 'race') renderDifficulty(m.id);
  else if (m.id === 'wreck') startRun({ kind: 'wreck', mods: ['traffic', 'peds'] });
  else startRun({ kind: 'tutorial' });
}

// ---- difficulty picker (shown after choosing Driving Test or Race) ----
let diffSel = 1;
let diffMode = 'test';
function renderDifficulty(mode) {
  game.state = 'difficulty';
  diffMode = mode;
  diffSel = Math.max(0, DIFFICULTIES.findIndex((d) => d.id === save.difficulty));
  const m = FREE.find((x) => x.id === mode);
  const opp = (d) => (mode === 'race' ? `VS ${AI_PROFILES[d.id].name}${save.beaten.includes(d.id) ? ' (BEATEN)' : ''}` : '');
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
  startRun({ kind: diffMode, diff: save.difficulty });
}

// ---- career ----
function renderCareer(msg = '') {
  game.state = 'career';
  // land on the first level that isn't done yet
  if (!msg) {
    const firstOpen = CAREER.findIndex((l, i) => careerUnlocked(save, i) && !(save.career[l.id] >= 1));
    game.careerSel = firstOpen >= 0 ? firstOpen : CAREER.length - 1;
  }
  showScreen(`
    <div class="window" style="max-width:640px">
      <h2>CAREER</h2>
      <div class="row" style="margin:0 0 10px;max-width:none"><span>STARS <span class="k">${careerStars(save)}/${CAREER.length * 3}</span></span><span class="good">${msg}</span></div>
      <ul class="levels" id="levels">
        ${CAREER.map((l, i) => {
          const open = careerUnlocked(save, i);
          const s = save.career[l.id] || 0;
          return `<li data-i="${i}" class="${open ? '' : 'locked'}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm">${open ? l.name : '???'}</span><span class="stars">${open ? stars(s) : ''}</span></li>`;
        }).join('')}
      </ul>
      <div class="level-desc" id="level-desc"></div>
      <div class="hint">W/S BROWSE &bull; ENTER PLAY &bull; ESC BACK</div>
    </div>`);
  bindList('#levels li', (i) => { game.careerSel = i; highlightCareer(); }, () => careerSelect());
  highlightCareer();
}
function highlightCareer() {
  setSel('#levels li', game.careerSel);
  const d = $('level-desc');
  if (!d) return;
  const l = CAREER[game.careerSel];
  if (!careerUnlocked(save, game.careerSel)) { d.innerHTML = 'LOCKED. EARN A STAR ON THE LEVEL BEFORE IT.'; return; }
  const diff = DIFFICULTIES.find((x) => x.id === l.diff);
  const bits = [`${l.mode === 'race' ? 'RACE VS ' + AI_PROFILES[l.diff].name : 'DRIVING TEST'} &bull; ${diff.name} SPOT`];
  if (l.vehicle) bits.push(`<span class="car">COMPANY CAR: ${vehicleById(l.vehicle).name}</span>`);
  if (l.time) bits.push(`<span class="car">${l.time} SECOND LIMIT</span>`);
  if (l.mods.length) bits.push(`<span class="mods">${l.mods.map((m) => MODS[m].name).join(' + ')}</span>`);
  d.innerHTML = `<span style="color:var(--white)">${l.blurb}</span><br>${bits.join('<br>')}<br><span style="color:var(--dgray)">${l.mode === 'race' ? 'STARS: WIN / NO DINGS / UNDER 45S' : 'STARS: PARK / SCORE 650 / SCORE 850'}</span>`;
}
function careerSelect() {
  if (!careerUnlocked(save, game.careerSel)) { audio.tone(110, 0.2, 'square', 0.1); return; }
  audio.select();
  startCareerLevel(game.careerSel);
}
function startCareerLevel(i) {
  const l = CAREER[i];
  startRun({ kind: 'career', simMode: l.mode || 'test', diff: l.diff, vehicle: l.vehicle, mods: l.mods, time: l.time, career: { index: i, level: l } });
}

// ---- trophies ----
function renderTrophies() {
  game.state = 'trophies';
  showScreen(`
    <div class="window" style="max-width:760px">
      <h2>TROPHIES</h2>
      <div class="tagline" style="margin-top:0">${save.trophies.length}/${TROPHIES.length} EARNED &bull; ${TROPHY_POINTS} POINTS EACH</div>
      <div class="trophies">
        ${TROPHIES.map((t) => `<div class="trophy ${save.trophies.includes(t.id) ? 'got' : ''}"><div class="nm">${t.name}</div><div>${t.desc}</div></div>`).join('')}
      </div>
      <div class="hint">ESC OR ENTER TO GO BACK</div>
    </div>`);
}

// ---- daily dare ----
function dailyConfig() {
  const key = todayKey();
  const seed = parseInt(key.replace(/-/g, ''), 10);
  const r = rng(seed);
  const vehicle = VEHICLES[Math.floor(r() * VEHICLES.length)];
  const diff = ['normal', 'normal', 'hard', 'hard', 'insane'][Math.floor(r() * 5)];
  const pool = [...RANDOM_POOL];
  const mods = [];
  const n = 1 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) mods.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  if (r() < 0.2) mods.push('hidden');
  const time = r() < 0.35 ? 60 : 0;
  return { kind: 'daily', diff, vehicle: vehicle.id, mods, time, seed: seed * 7 + 3, dailyKey: key };
}

// ---- garage ----
let garageSel = 0;
const hex = cssHex;
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
            <div class="name"><span class="swatch" data-c="${ps.color}" style="background:${hex(ps.color)}"></span>${v.name}</div>
            <div class="blurb">${v.blurb}</div>
            <div>LENGTH ${v.length.toFixed(1)}M${v.extraRoom ? ' (GETS A BIGGER SPOT)' : ''}</div>
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
    awardTrophies(null);
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
      <div class="swatches">${PALETTE.map(([c, n], i) => `<div class="sw" data-row="${r}" data-i="${i}" title="${n}" data-c="${c}" style="background:${hex(c)}"></div>`).join('')}</div>
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
      <div><span class="k">SHIFT</span> NITRO (WRECK-REATION ONLY)</div>
      <div><span class="k">C</span> CHANGE CAMERA (TOP-DOWN IS GREAT FOR PARKING)</div>
      <div><span class="k">H</span> HORN (MOVES JAYWALKERS ALONG)</div>
      <div><span class="k">R</span> RESTART &nbsp; <span class="k">ESC</span> PAUSE</div>
      <div><span class="k">ENTER</span> CASH OUT EARLY (WRECK MODE)</div>
      <div><span class="k">I</span> LET THE INSTRUCTOR PARK (DRIVING TEST, NO POINTS)</div>
      <div><span class="k">CONTROLLER</span> RT OR RIGHT STICK GAS, LT BRAKE/REVERSE, LEFT STICK STEER,
        RB HANDBRAKE, X CAMERA, Y HORN, LB INSTRUCTOR, START PAUSE.
        BUTTONS IN THE WRONG PLACE? RUN CONTROLLER SETUP FROM THE MENU. V TURNS RUMBLE ON/OFF</div>
      <p style="color:var(--lgray);font-size:9px;line-height:2">
        NO GEARS TO FIDDLE WITH: STOP, THEN HOLD S TO GO BACKWARD. EACH TIME YOU SWITCH
        DIRECTION IT COUNTS AS A MOVE. BEAT THE INSTRUCTOR'S PAR FOR FULL MARKS.<br><br>
        TO PARK: STOP INSIDE THE SPOT, CLOSE TO THE CURB, MORE OR LESS STRAIGHT, AND HOLD STILL.<br><br>
        CLASSIC TECHNIQUE: PULL UP ALONGSIDE THE FRONT CAR. REVERSE WITH FULL RIGHT LOCK
        UNTIL YOU'RE AT ~45&deg;. THEN FULL LEFT LOCK AS YOU SWING IN. SHUFFLE IF NEEDED.<br><br>
        <span style="color:var(--lmagenta)">HAZARDS</span> (CAREER, VALET SHIFT AND DAILY DARE MIX THESE IN):<br>
        ${Object.values(MODS).map((m) => `<span style="color:var(--white)">${m.name}</span>: ${m.desc.toUpperCase()}`).join('<br>')}
      </p>
      <div class="hint">ESC OR ENTER TO GO BACK</div>
    </div>`);
}

function toastRumble() {
  const el = document.createElement('div');
  el.className = 'pad-toast';
  el.textContent = `CONTROLLER RUMBLE ${save.rumble ? 'ON' : 'OFF'} (V)`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
  if (save.rumble) rumble(0.6, 0.4, 200);
}

// ---- controller setup ----
let padSetup = null;
function renderPadSetup() {
  game.state = 'padsetup';
  padSetup = new PadSetup(screen, (id, layout) => {
    padSetup = null;
    if (id && layout) {
      save.padLayouts = { ...save.padLayouts, [id]: layout };
      writeSave(save);
      setLayouts(save.padLayouts);
      audio.select();
    }
    renderMenu();
  });
}

// ---------------- gameplay ----------------
/**
 * Starts a run. cfg:
 *  kind: test | race | wreck | tutorial | career | shift | daily
 *  simMode (test/race/wreck, defaults from kind), diff, vehicle (id, lent for the run),
 *  mods (ids), time (limit in s), margin (spare room override), seed,
 *  career: { index, level }, shift: shift state, dailyKey
 */
function startRun(cfg) {
  // First time playing anything: run the tutorial first, then carry on.
  if (cfg.kind !== 'tutorial' && !save.tutorialSeen) {
    game.pendingRun = cfg;
    cfg = { kind: 'tutorial' };
  }
  if (cfg.kind === 'tutorial') {
    save.tutorialSeen = true;
    writeSave(save);
  }
  const tutorial = cfg.kind === 'tutorial';
  const simMode = cfg.simMode || (cfg.kind === 'race' || cfg.kind === 'wreck' ? cfg.kind : 'test');
  const diff = tutorial ? DIFFICULTIES[0] : (DIFFICULTIES.find((d) => d.id === cfg.diff) || diffObj());
  const baseVehicle = vehicleById(cfg.vehicle || save.vehicle);
  const vehicle = paintedSpec(baseVehicle);
  const mods = cfg.mods || [];
  const seed = cfg.seed ?? (tutorial ? 11 : Math.floor(Math.random() * 1e9));
  const level = buildLevel({ mode: simMode, difficulty: diff.id, vehicle, seed, mods, margin: cfg.margin });
  const opts = { rand: rng(seed + 1) };
  if (simMode === 'race') {
    opts.aiSpec = baseVehicle;
    opts.aiProfile = AI_PROFILES[diff.id];
  }
  const world = new World(level, vehicle, opts);
  for (const s of world.playerSpots) {
    const plan = planPark(world, s, vehicle);
    s.par = plan ? plan.moves : 6;
  }
  game.run = {
    kind: cfg.kind, simMode, diff, mods: level.mods, vehicle: baseVehicle, lent: !!cfg.vehicle && cfg.vehicle !== save.vehicle,
    timeLimit: cfg.time || (simMode === 'wreck' ? WRECK_TIME : 0),
    career: cfg.career || null, shift: cfg.shift || null, dailyKey: cfg.dailyKey || null, seed,
    aiProfile: opts.aiProfile || null, par: world.playerSpot ? world.playerSpot.par : 6,
    tickedAt: 99, saidTimeLow: false, topKmh: 0,
  };
  game.world = world;
  game.playTime = 0;
  game.idleT = 0;
  game.slow = 0;
  game.saidReverse = false;
  game.result = null;
  game.autopilot = null;
  game.tutorial = tutorial ? new Tutorial($('tutor'), usingPad) : null;
  $('tutor').classList.toggle('hidden', !tutorial);
  view.load(world);
  hideScreen();
  hud.classList.remove('hidden');
  hud.classList.toggle('tutorial', tutorial);
  $('bubble').classList.add('hidden');
  $('hud-center').innerHTML = '';
  game.state = 'countdown';
  game.countdown = simMode === 'race' ? 3.99 : cfg.kind === 'shift' ? 3.2 : 1.2;
  game.lastCount = 99;
  const run = game.run;
  if (cfg.kind === 'shift') {
    const sh = cfg.shift;
    $('hud-center').innerHTML = `<div class="hud-intro"><div class="h">CUSTOMER #${sh.round}</div><div class="s">${vehicle.name}<br>${cfg.time}S &bull; +${(cfg.margin).toFixed(2)}M SPARE</div>${mods.length ? `<div class="m">${modNames(level.mods).join(' + ')}</div>` : ''}</div>`;
  } else if (cfg.kind === 'career') {
    const l = cfg.career.level;
    $('hud-center').innerHTML = `<div class="hud-intro"><div class="h">${l.name}</div><div class="s">${l.blurb}</div>${mods.length ? `<div class="m">${modNames(level.mods).join(' + ')}</div>` : ''}</div>`;
    game.countdown = simMode === 'race' ? 3.99 : 2.6;
  } else if (cfg.kind === 'daily') {
    $('hud-center').innerHTML = `<div class="hud-intro"><div class="h">DAILY DARE</div><div class="s">${cfg.dailyKey}<br>${vehicle.name} &bull; ${diff.name}</div>${mods.length ? `<div class="m">${modNames(level.mods).join(' + ')}</div>` : ''}</div>`;
    game.countdown = 2.6;
  }
  // The opening line waits for the intro card (if any) to go away.
  const intro = $('hud-center').innerHTML !== '';
  const open = (text, secs) => { if (intro) game.sayAfter = [text, secs]; else say(text, secs); };
  game.sayAfter = null;
  if (simMode === 'test' && !tutorial && cfg.kind !== 'shift') {
    if (level.mods.has('hidden')) open(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.hidden)}`, 5);
    else if (level.mods.has('sticky')) open('<b>INSTRUCTOR:</b> The pedal is stuck. Brakes work. Finish with the handbrake (SPACE). Do not panic. Panic a little.', 6);
    else if (level.mods.has('mirror')) open('<b>INSTRUCTOR:</b> The steering is reversed. Left is right. I did warn the dealer.', 5);
    else open(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.start)}`, 5);
  }
  if (simMode === 'race') open(`<b>${run.aiProfile.name}:</b> "${run.aiProfile.taunt}"`, 4);
  if (tutorial) say('<b>INSTRUCTOR:</b> Welcome to driving school. Follow the instructions up top.', 4);
  if (simMode === 'wreck') say('<b>WRECK-REATION:</b> Two minutes until the cops arrive. Smash things fast for combos, hold SHIFT for nitro, and mind the ramp at the far end: land on your wheels or it is game over. ENTER cashes out early.', 7);
}

// ---- valet shift ----
function startShift() {
  const sh = { round: 0, score: 0, strikes: 0, streak: 0, seed: Math.floor(Math.random() * 1e6), served: 0 };
  nextShiftRound(sh);
}
function shiftRoundConfig(sh) {
  const r = rng(sh.seed + sh.round * 101);
  const vehicle = VEHICLES[Math.floor(r() * VEHICLES.length)];
  let margin = Math.max(1.15, 2.8 - 0.12 * (sh.round - 1));
  const time = Math.max(25, Math.round(62 - 2.5 * (sh.round - 1)));
  const nMods = sh.round >= 10 ? 3 : sh.round >= 6 ? 2 : sh.round >= 3 ? 1 : 0;
  const pool = RANDOM_POOL.filter((m) => m !== 'shrink' || sh.round >= 5);
  const mods = [];
  for (let i = 0; i < nMods; i++) mods.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const seed = sh.seed * 13 + sh.round;
  // Make sure the spot is actually parkable in this car: widen until the planner finds a way.
  for (let k = 0; k < 6; k++) {
    const level = buildLevel({ mode: 'test', difficulty: 'normal', vehicle, seed, margin });
    const world = new World(level, vehicle, { rand: rng(seed) });
    if (planPark(world, world.playerSpot, vehicle)) break;
    margin += 0.2;
  }
  return { kind: 'shift', vehicle: vehicle.id, margin, time, mods, seed, shift: sh };
}
function nextShiftRound(sh) {
  sh.round++;
  startRun(shiftRoundConfig(sh));
}
function shiftStrike(why) {
  const sh = game.run.shift;
  sh.strikes++;
  audio.strike();
  $('hud-center').innerHTML = `<span class="bad">${why}</span><div class="sub">STRIKE ${sh.strikes} OF ${SHIFT_STRIKES}</div>`;
  if (sh.strikes >= SHIFT_STRIKES) finishShift();
  else endWith(() => { $('hud-center').innerHTML = ''; nextShiftRound(sh); }, 2.2);
}
function finishShift() {
  const sh = game.run.shift;
  const points = sh.served * 25 + Math.floor(sh.score / 20);
  awardPoints(points);
  const isBest = sh.score > save.shiftBest;
  save.shiftBest = Math.max(save.shiftBest, sh.score);
  save.shiftBestRound = Math.max(save.shiftBestRound, sh.served);
  writeSave(save);
  const quip = sh.served >= 12 ? 'Management is frightened of you. Promotion pending.'
    : sh.served >= 7 ? 'A solid shift. Only three customers cried.'
      : sh.served >= 3 ? 'You served some customers. Some of them got their cars back.'
        : 'Shortest shift in company history. The record was already yours.';
  const r = runResult({ parked: false });
  endWith(() => {
    renderResults({
      title: 'SHIFT OVER', grade: String(sh.served), gradeTitle: `CUSTOMER${sh.served === 1 ? '' : 'S'} SERVED`, quip,
      items: [{ label: 'SHIFT SCORE', detail: String(sh.score) }, { label: 'BEST SHIFT', detail: String(save.shiftBest) }, { label: 'LONGEST STREAK', detail: `x${Math.min(5, 1 + Math.floor((sh.bestStreak || 0) / 2))}` }],
      total: isBest && sh.score > 0 ? 'NEW BEST SHIFT!' : '', points,
      next: () => startShift(), back: () => renderMenu(),
    });
    awardTrophies(r);
  }, 2.2);
}

function updateHUD() {
  const w = game.world;
  const run = game.run;
  const p = w.player;
  const t = game.playTime.toFixed(1);
  let tl = `<div class="k">${SIM_NAMES[run.kind]}</div>`;
  if (run.kind === 'tutorial') {
    const tu = game.tutorial;
    tl += `<div>STEP <span class="v">${Math.min(tu.step + 1, tu.total)}/${tu.total}</span></div>`;
    tl += `<div>DINGS <span class="${p.dings ? 'bad' : 'v'}">${p.dings}</span></div>`;
  } else if (run.simMode === 'wreck') {
    tl += `<div>DAMAGE <span class="bad">$${w.destruction.toLocaleString()}</span></div>`;
    tl += `<div>THINGS BROKEN <span class="v">${p.propsBroken}</span></div>`;
    tl += `<div>CARS WRECKED <span class="v">${w.parked.filter((c) => c.wrecked).length}</span></div>`;
  } else if (run.kind === 'shift') {
    const sh = run.shift;
    const mult = Math.min(5, 1 + Math.floor(sh.streak / 2));
    tl += `<div>CUSTOMER <span class="v">#${sh.round}</span> &bull; <span class="v">${run.vehicle.name}</span></div>`;
    tl += `<div>SCORE <span class="k">${sh.score}</span> ${mult > 1 ? `<span class="good">STREAK x${mult}</span>` : ''}</div>`;
    tl += `<div>STRIKES <span class="strikes">${Array.from({ length: SHIFT_STRIKES }, (_, i) => `<span class="${i < sh.strikes ? '' : 'off'}">&#10006;</span>`).join('')}</span> &nbsp;DINGS <span class="${p.dings ? 'bad' : 'v'}">${p.dings}/3</span></div>`;
  } else {
    tl += `<div>TIME <span class="v">${t}s</span></div>`;
    tl += `<div>MOVES <span class="v">${p.moves}</span> <span style="color:var(--lgray)">PAR ${p.lastSpot ? p.lastSpot.par : run.par}</span></div>`;
    tl += `<div>DINGS <span class="${p.dings ? 'bad' : 'v'}">${p.dings}</span>${p.scares ? ` &nbsp;SCARED <span class="bad">${p.scares}</span>` : ''}</div>`;
  }
  $('hud-tl').innerHTML = tl;

  let tr = `<div>${run.kind === 'tutorial' ? 'PRACTICE' : run.kind === 'shift' ? `${run.vehicle.length.toFixed(1)}M CAR` : run.diff.name}</div><div>PTS <span class="k">${save.points}</span></div>`;
  if (run.career) tr = `<div>LEVEL ${run.career.index + 1}: ${run.career.level.name}</div>${tr}`;
  if (run.simMode === 'race' && w.ai) {
    const a = w.ai.car;
    const status = a.parked ? '<span class="bad">PARKED!</span>' : w.ai.driver.gaveUp ? '<span class="good">GAVE UP</span>' : 'PARKING...';
    tr += `<div style="color:var(--lmagenta)">${w.ai.driver.p.name}</div><div>${status}</div>`;
  }
  $('hud-tr').innerHTML = tr;

  // top: timer, hazards, mystery hint
  let top = '';
  if (run.timeLimit && game.state !== 'countdown') {
    const left = Math.max(0, run.timeLimit - game.playTime);
    top += `<div class="timer ${left <= 10 ? 'low' : ''}"><span class="lbl">${run.simMode === 'wreck' ? 'COPS ARRIVE IN' : 'TIME LEFT'}</span>${fmtTime(left)}</div>`;
  }
  if (run.mods.size && run.kind !== 'tutorial') top += `<div class="mods">${modNames(run.mods).join(' + ')}</div>`;
  if (run.mods.has('hidden') && !p.parked) top += '<div class="find">FIND A GAP YOU FIT IN</div>';
  $('hud-top').innerHTML = top;

  // combo (wreck)
  const combo = $('combo');
  if (run.simMode === 'wreck' && w.combo >= 2 && w.comboLeft > 0) {
    combo.classList.remove('hidden');
    combo.innerHTML = `<div class="big">x${w.mult}</div><div class="sub">${w.combo} SMASH COMBO</div><div class="bar"><div style="width:${w.comboLeft / 2.5 * 100}%"></div></div>`;
  } else combo.classList.add('hidden');

  const kmh = Math.round(Math.abs(p.speed) * 3.6);
  run.topKmh = Math.max(run.topKmh, kmh);
  let bl = `<div class="gear ${p.gear === 'R' ? 'r' : ''}">${p.gear}</div><div><div>${kmh} KM/H</div>`;
  if (p.lastEval && (p.lastEval.inSpot || p.lastEval.curbDist < 2.5) && run.simMode !== 'wreck') {
    const e = p.lastEval;
    const cd = e.curbDist < 0 ? '<span class="bad">ON CURB</span>' : `<span class="${e.curbDist < 0.35 ? 'good' : 'v'}">${e.curbDist.toFixed(2)}M</span>`;
    bl += `<div style="font-size:9px">CURB ${cd} &nbsp;ANGLE <span class="${e.angle < 3 ? 'good' : 'v'}">${e.angle.toFixed(0)}&deg;</span></div>`;
  }
  if (run.simMode === 'wreck') bl += `<div style="font-size:8px">NITRO (SHIFT)</div><div class="meter ${p.nitroOn ? 'on' : ''}"><div style="width:${p.nitro / NITRO_MAX * 100}%"></div></div>`;
  bl += '</div>';
  $('hud-bl').innerHTML = bl;
  $('hud-br').innerHTML = usingPad
    ? `RT / R-STICK GAS &bull; LT BRAKE<br>L-STICK STEER &bull; RB HANDBRAKE<br>X CAMERA &bull; Y HORN<br>BACK RESTART &bull; START PAUSE${run.kind === 'test' ? '<br>LB INSTRUCTOR DEMO' : ''}${run.simMode === 'wreck' ? '<br>LB NITRO &bull; A CASH OUT' : ''}`
    : `WASD DRIVE &bull; SPACE BRAKE<br>C CAMERA &bull; H HORN<br>R RESTART &bull; ESC PAUSE${run.kind === 'test' ? '<br>I INSTRUCTOR DEMO' : ''}${run.simMode === 'wreck' ? '<br>SHIFT NITRO &bull; ENTER CASH OUT' : ''}`;

  const park = $('hud-park');
  if (p.parkTimer > 0 && !p.parked) {
    park.classList.remove('hidden');
    $('hud-park-fill').style.width = `${Math.min(100, p.parkTimer / 1.5 * 100)}%`;
  } else park.classList.add('hidden');
}

function handleEvents(events) {
  const w = game.world;
  const run = game.run;
  const test = run.simMode === 'test' && run.kind !== 'tutorial' && run.kind !== 'shift';
  // Rumble only for things the player feels (and only when on a controller).
  const buzz = (strong, weak, ms) => { if (usingPad) rumble(strong, weak, ms); };
  const hitBuzz = (impact) => buzz(0.15 + impact * 0.09, 0.25 + impact * 0.06, 80 + Math.min(300, impact * 40));
  for (const e of events) {
    view.handle(e);
    if (e.type === 'ding') {
      if (e.car.isPlayer || (e.otherCar && e.otherCar.isPlayer)) hitBuzz(e.impact);
      if (e.car.isPlayer || e.impact > 1) audio.crash(e.impact);
      if (e.car.isPlayer && e.otherCar && e.otherCar.isTraffic) audio.honk();
      if (e.car.isPlayer && test && e.impact > 0.4) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.ding)}`);
    } else if (e.type === 'break') {
      audio.crash(3);
      if (e.by && e.by.isPlayer) hitBuzz(Math.max(2, e.impact || 0));
      if (e.prop.type === 'meter') audio.coin();
      if (e.prop.type === 'statue') { audio.boom(); game.slow = Math.max(game.slow, 0.8); }
      if (test && e.by && e.by.isPlayer) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.prop)}`);
    } else if (e.type === 'wreck') { audio.boom(); game.slow = Math.max(game.slow, 0.5); buzz(1, 0.8, 450); }
    else if (e.type === 'smash' || e.type === 'facade') { audio.smash(); buzz(0.6, 0.6, 200); }
    else if (e.type === 'collapse') { audio.boom(); audio.smash(); game.slow = Math.max(game.slow, 0.9); buzz(1, 1, 900); }
    else if (e.type === 'curb' && e.car.isPlayer) {
      audio.curb();
      buzz(0.35, 0.1, 90);
      if (test) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.curb)}`);
    } else if (e.type === 'parked') {
      audio.jingle(e.car.isPlayer);
      if (e.car.isPlayer) { game.slow = Math.max(game.slow, 1.1); buzz(0, 0.5, 120); }
    } else if (e.type === 'honk') {
      audio.honk();
      if (test && Math.random() < 0.5) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.honk)}`, 2.5);
    } else if (e.type === 'scare') {
      audio.yelp();
      if (test && e.car.isPlayer) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.scare)}`, 2.5);
    } else if (e.type === 'quake') {
      audio.rumble(e.duration);
      buzz(0.5, 0.2, Math.min(5000, e.duration * 1000));
      if (test) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.quake)}`, 2.5);
    } else if (e.type === 'creep') {
      audio.tone(900, 0.08, 'square', 0.04); audio.tone(900, 0.08, 'square', 0.04, 0.4);
      if (test && w.shrunk < 0.4) say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.creep)}`, 3);
    } else if (e.type === 'combo') {
      audio.tone(600 + e.combo * 60, 0.08, 'square', 0.07); audio.tone(900 + e.combo * 60, 0.12, 'square', 0.07, 0.08);
    } else if (e.type === 'land' && e.car.isPlayer) {
      audio.crash(Math.min(6, 1 + e.impact * 0.5));
      hitBuzz(Math.min(8, 1 + e.impact * 0.7));
    } else if (e.type === 'flip' && e.car.isPlayer) {
      audio.crash(8);
      audio.boom();
      buzz(1, 1, 600);
    }
  }
  if (view.takeThunder()) audio.thunder();
  if (game.state !== 'play') return;
  // end conditions
  if (run.simMode === 'wreck' && w.player.flipped) {
    say(`<b>WRECK-REATION:</b> ${pickLine(['Cars go wheels-down. Generally.', 'That is not how cars go.', 'Your car is now a turtle. Game over, turtle.'])}`, 4);
    finishWreck(false, true);
  }
  if (run.simMode === 'test' && run.kind !== 'tutorial' && w.player.parked) finishTest();
  if (run.simMode === 'race') {
    if (w.player.parked) finishRace(true);
    else if (w.ai.car.parked) finishRace(false);
  }
  if (run.kind === 'shift' && game.state === 'play' && w.player.dings >= 3) shiftStrike('CUSTOMER COMPLAINED!');
}

// The facts about a finished run, for trophies and records.
function runResult(extra) {
  const w = game.world, run = game.run, p = w.player;
  const spot = p.parkedSpot || p.lastSpot;
  return {
    kind: run.kind, simMode: run.simMode, car: p, world: w, mods: run.mods, diff: run.diff.id, time: game.playTime,
    vehicleId: run.vehicle.id, careerId: run.career ? run.career.level.id : null, hidden: run.mods.has('hidden'),
    spotSpare: spot ? spot.length - p.spec.length - (p.spec.extraRoom || 0) : 99,
    parked: p.parked, won: false, score: 0, letter: '', ...extra,
  };
}

function finishTest() {
  const w = game.world, run = game.run, p = w.player;
  if (run.kind === 'shift') return finishShiftRound();
  const spot = p.parkedSpot;
  const par = spot && spot.par != null ? spot.par : run.par;
  const r = gradePark({ car: p, evalResult: p.finalEval, time: game.playTime, par, difficulty: run.diff, spot, mods: run.mods, hidden: run.mods.has('hidden') });
  if (game.autopilot) {
    r.points = 0;
    r.quip = 'The instructor parked it. You get nothing. Good day, sir.';
  }
  save.parks++;
  const key = `${run.vehicle.id}:${run.diff.id}`;
  const isBest = !game.autopilot && run.kind === 'test' && (!save.best[key] || r.score > save.best[key]);
  if (isBest) save.best[key] = r.score;
  const extras = [];
  let total = `SCORE ${r.score}${isBest ? ' (NEW BEST!)' : ''}`;
  let starsHtml = '';
  let next = () => startRun(sameRunConfig());
  let back = () => renderMenu();
  if (run.career) {
    const got = game.autopilot ? 0 : starsFor(run.career.level, { parked: true, score: r.score });
    const bonus = careerProgress(run.career, got, extras);
    r.points += bonus;
    starsHtml = stars(got);
    total = `SCORE ${r.score} &bull; ${got} STAR${got === 1 ? '' : 'S'}`;
    const ni = run.career.index + 1;
    next = ni < CAREER.length && careerUnlocked(save, ni) ? () => startCareerLevel(ni) : () => renderCareer();
    back = () => renderCareer('');
  }
  if (run.dailyKey && !game.autopilot) {
    const prev = save.daily[run.dailyKey];
    if (prev == null || r.score > prev) { save.daily[run.dailyKey] = r.score; extras.push({ label: prev == null ? 'DAILY DARE DONE' : 'NEW DAILY BEST', detail: run.dailyKey, good: true }); }
    else extras.push({ label: 'DAILY BEST', detail: String(prev) });
  }
  if (r.hazard > 1 && r.points > 0) extras.push({ label: 'HAZARD PAY', detail: `x${r.hazard.toFixed(1)} points`, good: true });
  awardPoints(r.points);
  writeSave(save);
  const res = runResult({ parked: true, score: r.score, letter: r.letter });
  endWith(() => {
    renderResults({
      title: run.career ? run.career.level.name : run.dailyKey ? 'DAILY DARE' : 'TEST COMPLETE',
      grade: r.letter, gradeTitle: r.title, quip: r.quip, items: [...r.items, ...extras], stars: starsHtml,
      total, points: r.points, next, back, retry: () => startRun(sameRunConfig()),
      nextLabel: run.career ? 'NEXT LEVEL' : 'GO AGAIN', backLabel: run.career ? 'CAREER' : 'MENU',
    });
    if (!game.autopilot) awardTrophies(res);
  });
}

// Re-runs the current run (same level config; a fresh seed unless it's the daily).
function sameRunConfig() {
  const run = game.run;
  if (run.career) { const l = run.career.level; return { kind: 'career', simMode: l.mode || 'test', diff: l.diff, vehicle: l.vehicle, mods: l.mods, time: l.time, career: run.career }; }
  if (run.dailyKey) return dailyConfig();
  if (run.kind === 'wreck') return { kind: 'wreck', mods: ['traffic', 'peds'] };
  return { kind: run.kind, diff: run.diff.id };
}

// Records stars for a career level; returns bonus points and pushes result lines.
function careerProgress(career, got, extras) {
  const id = career.level.id;
  const prev = save.career[id] || 0;
  let bonus = 0;
  if (got > 0 && prev === 0) { bonus += FIRST_CLEAR_BONUS; extras.push({ label: 'LEVEL CLEARED', detail: `+${FIRST_CLEAR_BONUS} pts`, good: true }); }
  if (got > prev) {
    const nb = (got - prev) * STAR_BONUS;
    bonus += nb;
    extras.push({ label: prev ? 'MORE STARS!' : 'STARS', detail: `+${nb} pts`, good: true });
    save.career[id] = got;
    const ni = career.index + 1;
    if (prev === 0 && ni < CAREER.length) extras.push({ label: 'UNLOCKED', detail: CAREER[ni].name, good: true });
  }
  return bonus;
}

function finishShiftRound() {
  const w = game.world, run = game.run, p = w.player, sh = run.shift;
  const left = Math.max(0, run.timeLimit - game.playTime);
  const clean = p.dings === 0;
  sh.streak = clean ? sh.streak + 1 : 0;
  sh.bestStreak = Math.max(sh.bestStreak || 0, sh.streak);
  const mult = Math.min(5, 1 + Math.floor(sh.streak / 2));
  const par = p.parkedSpot && p.parkedSpot.par != null ? p.parkedSpot.par : run.par;
  const base = 100 + Math.round(left * 5) + (clean ? 100 : 0) + (p.moves <= par ? 50 : 0) - p.dings * 25 - p.scares * 20;
  const gained = Math.max(10, base) * mult;
  sh.score += gained;
  sh.served++;
  save.parks++;
  const bits = [`+${gained}`];
  if (mult > 1) bits.push(`STREAK x${mult}`);
  $('hud-center').innerHTML = `<span class="good">${bits.join(' ')}</span><div class="sub">${clean ? 'CLEAN! ' : ''}${left.toFixed(0)}S SPARE &bull; NEXT CUSTOMER...</div>`;
  endWith(() => { $('hud-center').innerHTML = ''; nextShiftRound(sh); }, 2.4);
}

function finishRace(won, forfeit = false) {
  const w = game.world, run = game.run;
  const d = run.diff;
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
    if (!save.beaten.includes(d.id)) save.beaten.push(d.id);
  } else {
    points = 15;
    grade = 'LOSE';
    quip = pickLine([`${ai.name}: "${ai.taunt}"`, 'Beaten by a computer. It happens to the best of us. And to you.', `${ai.name} parked in ${w.ai.car.parkedAt.toFixed(1)}s. Just saying.`]);
  }
  const items = [
    { label: 'YOUR TIME', pts: null, detail: won ? `${game.playTime.toFixed(1)}s` : 'DNF' },
    { label: 'DINGS', pts: null, detail: String(w.player.dings) },
    { label: 'MOVES', pts: null, detail: String(w.player.moves) },
  ];
  let starsHtml = '', next = () => startRun(sameRunConfig()), back = () => renderMenu();
  if (run.career) {
    const got = starsFor(run.career.level, { won, dings: w.player.dings, time: game.playTime });
    points += careerProgress(run.career, got, items);
    starsHtml = stars(got);
    const ni = run.career.index + 1;
    next = won && ni < CAREER.length && careerUnlocked(save, ni) ? () => startCareerLevel(ni) : () => renderCareer();
    back = () => renderCareer('');
  }
  awardPoints(points);
  writeSave(save);
  const res = runResult({ parked: won, won });
  endWith(() => {
    renderResults({
      title: won ? 'YOU WIN!' : 'YOU LOSE!', grade, gradeTitle: won ? 'SPEED PARKER' : 'SECOND PLACE (OF TWO)', quip, items, total: '', points, stars: starsHtml,
      next, back, retry: () => startRun(sameRunConfig()), nextLabel: run.career && won ? 'NEXT LEVEL' : 'GO AGAIN', backLabel: run.career ? 'CAREER' : 'MENU',
    });
    awardTrophies(res);
  });
}

function finishWreck(copsArrived = false, flipped = false) {
  const w = game.world;
  const points = Math.min(600, Math.round(w.destruction / 150));
  awardPoints(points);
  writeSave(save);
  const wrecked = w.parked.filter((c) => c.wrecked).length;
  const quip = flipped ? pickLine(['You rolled it. The claim was filed from the roof, upside down.', 'Rollover. The adjuster has asked which side is meant to be up.', 'Wheels up, claim in. Your insurer is laughing too hard to deny it.'])
    : w.destruction > 60000 ? 'The town has been renamed in your honour. It is now called "The Crater".'
    : w.destruction > 20000 ? 'Your insurer has entered witness protection.'
      : w.destruction > 5000 ? 'A respectable amount of chaos. The mayor is concerned.'
        : 'That is barely a fender bender. Are you even trying?';
  if (copsArrived) { audio.siren(5); game.sirenT = 3; $('hud-center').innerHTML = '<span class="bad">BUSTED!</span><div class="sub">THE COPS HAVE ARRIVED</div>'; }
  const res = runResult({ parked: false });
  endWith(() => {
    $('hud-center').innerHTML = '';
    renderResults({
      title: flipped ? 'ROLLED OVER!' : copsArrived ? 'BUSTED! INSURANCE CLAIM' : 'INSURANCE CLAIM', grade: `$${Math.round(w.destruction / 1000)}K`, gradeTitle: 'TOTAL DAMAGES',
      quip,
      items: [
        { label: 'THINGS SMASHED', detail: String(w.player.propsBroken) },
        { label: 'CARS WRECKED', detail: String(wrecked) },
        { label: 'BEST COMBO', detail: `${w.comboBest} smash${w.comboBest === 1 ? '' : 'es'}` },
        { label: 'TOP SPEED', detail: `${game.run.topKmh} km/h` },
        { label: 'YOUR CAR', detail: flipped ? 'UPSIDE DOWN' : w.player.damage > 200 ? 'A SMOKING RUIN' : w.player.damage > 60 ? 'DENTED' : 'SUSPICIOUSLY FINE' },
      ],
      total: '', points, next: () => startRun(sameRunConfig()), back: () => renderMenu(),
    });
    awardTrophies(res);
  }, copsArrived ? 3 : flipped ? 2.8 : 1.6); // let the tumble play out
}

// The clock ran out.
function timeUp() {
  const run = game.run;
  if (run.simMode === 'wreck') return finishWreck(true);
  if (run.kind === 'shift') return shiftStrike('CUSTOMER LEFT!');
  audio.jingle(false);
  say('<b>INSTRUCTOR:</b> Time. Out of the car. Out.', 4);
  let next = () => startRun(sameRunConfig()), back = () => renderMenu(), starsHtml = '';
  if (run.career) { starsHtml = stars(0); next = () => startRun(sameRunConfig()); back = () => renderCareer(''); }
  const res = runResult({ parked: false });
  endWith(() => {
    renderResults({
      title: 'TIME\'S UP', grade: 'F', gradeTitle: 'STILL NOT PARKED', quip: pickLine(['The meter expired. So did my hope.', 'Punctuality is a virtue. You have other virtues, probably.', 'The customer has taken the bus.']),
      items: [{ label: 'TIME LIMIT', detail: `${run.timeLimit}s` }, { label: 'DINGS', detail: String(game.world.player.dings) }], total: '', points: 0, stars: starsHtml,
      next, back, retry: next, nextLabel: 'TRY AGAIN', backLabel: run.career ? 'CAREER' : 'MENU',
    });
    awardTrophies(res);
  }, 2);
}

function finishTutorial(skipped) {
  const next = game.pendingRun;
  game.pendingRun = null;
  $('tutor').classList.add('hidden');
  if (skipped) {
    if (next) startRun(next); else renderMenu();
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
    if (next) startRun(next); else renderMenu();
  }, 3.5);
}

function awardPoints(n) {
  const before = save.points;
  save.points += n;
  save.totalEarned += n;
  game.newlyAffordable = VEHICLES.filter((v) => !save.unlocked.includes(v.id) && v.cost > before && v.cost <= save.points);
}

// Checks trophies after a run (or in the garage); pays out and toasts the new ones.
function awardTrophies(r) {
  if (r) {
    save.topSpeed = Math.max(save.topSpeed, game.run.topKmh);
    save.honks += game.world.player.honks;
  }
  const won = checkTrophies(save, r);
  if (!won.length) { writeSave(save); return; }
  for (const t of won) { save.points += TROPHY_POINTS; save.totalEarned += TROPHY_POINTS; }
  writeSave(save);
  won.forEach((t, i) => setTimeout(() => {
    audio.trophy();
    toast(`&#9733; TROPHY: ${t.name}`, `${t.desc}<br><span class="good">+${TROPHY_POINTS} POINTS</span>`);
    const tot = screen.querySelector('.total');
    if (tot) tot.innerHTML = tot.innerHTML.replace(/\(TOTAL \d+\)/, `(TOTAL ${save.points})`);
  }, 400 + i * 900));
}

function endWith(fn, secs = 1.6) {
  game.state = 'ending';
  stopRumble();
  game.endT = secs;
  game.endFn = fn;
}

function renderResults(r) {
  game.state = 'results';
  game.result = r;
  hud.classList.add('hidden');
  const items = (r.items || []).map((it) => `<div class="line"><span>${it.label}</span><span class="d">${it.detail || ''}</span><span class="${it.good || (typeof it.pts === 'string' && it.pts.startsWith('+')) ? 'good' : it.pts < 0 ? 'bad' : ''}">${it.pts == null ? '' : it.pts}</span></div>`).join('');
  const unlock = game.newlyAffordable && game.newlyAffordable.length
    ? `<div class="good" style="font-size:10px;margin-top:12px">NEW RIDE AFFORDABLE: ${game.newlyAffordable.map((v) => v.name).join(', ')}! VISIT THE GARAGE.</div>` : '';
  showScreen(`
    <div class="window results">
      <h2>${r.title}</h2>
      <div class="grade" style="${r.grade.length > 2 ? 'font-size:56px' : ''}">${r.grade}</div>
      ${r.stars ? `<div class="stars-big">${r.stars}</div>` : ''}
      <div class="grade-title">${r.gradeTitle}</div>
      <div class="quip">${r.quip}</div>
      <div class="breakdown">${items}</div>
      ${r.total ? `<div class="total">${r.total}</div>` : ''}
      <div class="total">+${r.points} POINTS &nbsp; <span style="color:var(--lgray)">(TOTAL ${save.points})</span></div>
      ${unlock}
      <div class="hint">ENTER: ${r.nextLabel || 'GO AGAIN'}${r.retry ? ' &bull; R: RETRY' : ''} &bull; G: GARAGE &bull; ESC: ${r.backLabel || 'MENU'}</div>
    </div>`);
}

function renderPause() {
  stopRumble();
  game.state = 'paused';
  showScreen(`
    <div class="window" style="max-width:420px;text-align:center">
      <h2>PAUSED</h2>
      <p style="font-size:10px;line-height:2;color:var(--lgray)">THE INSTRUCTOR SIGHS AUDIBLY.</p>
      <div class="hint" style="font-size:10px">${usingPad ? 'START: RESUME &bull; BACK: RESTART &bull; Y: QUIT' : 'ESC: RESUME &bull; R: RESTART &bull; Q: QUIT'}</div>
    </div>`);
}

function quitRun() {
  audio.nitro(false);
  if (game.run && game.run.career) renderCareer(''); else renderMenu();
}

// Colour swatches in menus are inline styles, so repaint them when the look changes.
function recolorSwatches() {
  screen.querySelectorAll('[data-c]').forEach((el) => { el.style.background = hex(+el.dataset.c); });
}

// ---------------- per-state key handling ----------------
function handleKeys() {
  const hit = (c) => pressed.has(c);
  const times = (c) => pressed.get(c) || 0;
  const nav = (list, sel, fwd, back) => (sel + list.length * 4 + times(fwd[0]) + times(fwd[1]) - times(back[0]) - times(back[1])) % list.length;
  if (hit('KeyM')) { save.muted = !save.muted; audio.setMuted(save.muted); writeSave(save); }
  if (hit('KeyV')) { save.rumble = !save.rumble; setRumble(save.rumble); writeSave(save); toastRumble(); }
  if (hit('KeyP')) { save.look = save.look === 'classic' ? 'modern' : 'classic'; setLook(save.look); writeSave(save); recolorSwatches(); }

  switch (game.state) {
    case 'menu':
      if (hit('KeyW') || hit('ArrowUp') || hit('KeyS') || hit('ArrowDown')) { game.menuSel = nav(MENU, game.menuSel, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']); highlightMenu(); audio.blip(); }
      if (hit('Enter') || hit('Space')) menuSelect();
      break;
    case 'free':
      if (hit('KeyW') || hit('ArrowUp') || hit('KeyS') || hit('ArrowDown')) { game.freeSel = nav(FREE, game.freeSel, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']); highlightFree(); audio.blip(); }
      if (hit('Enter') || hit('Space')) freeSelect();
      if (hit('Escape')) renderMenu();
      break;
    case 'difficulty':
      if (hit('KeyW') || hit('ArrowUp') || hit('KeyS') || hit('ArrowDown')) { diffSel = nav(DIFFICULTIES, diffSel, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']); setSel('#diffs li', diffSel); audio.blip(); }
      if (hit('Enter') || hit('Space')) pickDifficulty();
      if (hit('Escape')) renderFree();
      break;
    case 'career':
      if (hit('KeyW') || hit('ArrowUp') || hit('KeyS') || hit('ArrowDown')) { game.careerSel = nav(CAREER, game.careerSel, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']); highlightCareer(); audio.blip(); }
      if (hit('Enter') || hit('Space')) careerSelect();
      if (hit('Escape')) renderMenu();
      break;
    case 'trophies':
      if (hit('Escape') || hit('Enter')) renderMenu();
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
    case 'padsetup':
      if (hit('Space')) { padSetup.skip(); audio.blip(); }
      else if (hit('Escape')) padSetup.cancel();
      break;
    case 'countdown':
    case 'play': {
      const run = game.run;
      if (hit('Escape')) { audio.nitro(false); renderPause(); break; }
      if (hit('KeyR') && run.kind !== 'shift') { audio.nitro(false); startRun(sameRunConfig()); break; }
      if (hit('KeyC')) {
        if (view.cycleCamera()) { if (game.tutorial) game.tutorial.camPresses++; } else say('<b>NO MIRRORS:</b> chase camera only on this one.', 2);
      }
      if (hit('Space') && game.tutorial) game.tutorial.handbrake = true;
      if (run.kind === 'tutorial' && hit('Enter')) { finishTutorial(true); break; }
      if (hit('KeyH')) { audio.horn(game.world.player.spec.style); game.world.honk(); if (usingPad) rumble(0, 0.3, 150); }
      if (game.state === 'play' && run.simMode === 'wreck' && hit('Enter')) { audio.nitro(false); finishWreck(false); }
      if (game.state === 'play' && (run.kind === 'test' || run.kind === 'tutorial') && hit('KeyI') && !game.autopilot) {
        const w = game.world;
        game.autopilot = new AIDriver(w, w.player, w.playerSpot, AI_PROFILES.normal);
        say('<b>INSTRUCTOR:</b> Oh, for heaven\'s sake. Move over. Watch and learn.', 5);
      }
      break;
    }
    case 'paused':
      if (hit('Escape')) { hideScreen(); game.state = 'play'; }
      if (hit('KeyR')) startRun(game.run.kind === 'shift' ? shiftRoundConfig(game.run.shift) : sameRunConfig());
      if (hit('KeyQ')) quitRun();
      break;
    case 'results':
      if (hit('Enter') || hit('Space')) game.result.next();
      if (hit('KeyR') && game.result.retry) game.result.retry();
      if (hit('KeyG')) renderGarage();
      if (hit('Escape')) game.result.back();
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
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollController();
  handleKeys();
  if (game.state === 'padsetup' && padSetup) padSetup.update(rawDt);

  const w = game.world;
  if (game.bubbleT > 0) { game.bubbleT -= rawDt; if (game.bubbleT <= 0) $('bubble').classList.add('hidden'); }

  // slow motion for the big moments
  let dt = rawDt;
  if (game.slow > 0) { game.slow -= rawDt; dt = rawDt * 0.3; }

  if (game.state === 'countdown') {
    game.countdown -= rawDt;
    const n = Math.ceil(game.countdown);
    const run = game.run;
    if (run.simMode === 'race' && n !== game.lastCount && n > 0) { audio.countdown(false); game.lastCount = n; }
    if (run.simMode === 'race') $('hud-center').innerHTML = n > 0 ? String(n) : '';
    if (game.countdown <= 0) {
      game.state = 'play';
      $('hud-center').innerHTML = '';
      if (game.sayAfter) { say(...game.sayAfter); game.sayAfter = null; }
      if (run.simMode === 'race' || run.kind === 'shift') {
        audio.countdown(true);
        $('hud-center').innerHTML = run.simMode === 'race' ? 'PARK!' : 'GO!';
        setTimeout(() => { if (/^(PARK|GO)!$/.test($('hud-center').innerHTML)) $('hud-center').innerHTML = ''; }, 900);
      }
    }
    view.update(dt);
    updateHUD();
  } else if (game.state === 'play' || game.state === 'ending') {
    const run = game.run;
    const input = game.state === 'play' ? readInput(dt) : { throttle: 0, steer: 0, handbrake: true };
    w.step(dt, input);
    game.playTime += game.state === 'play' ? dt : 0;
    handleEvents(w.drainEvents());
    if (game.state === 'play' && game.tutorial) {
      if (game.tutorial.update(dt, input, w)) audio.select();
      if (game.tutorial.finished) finishTutorial(false);
    }
    if (game.state === 'play' && run.simMode === 'race' && w.ai.driver.gaveUp && !w.ai.car.parked) finishRace(true, true);

    // the clock
    if (game.state === 'play' && run.timeLimit) {
      const left = run.timeLimit - game.playTime;
      const sec = Math.ceil(left);
      if (left <= 10 && sec !== run.tickedAt && sec > 0) { run.tickedAt = sec; audio.tick(left <= 5); }
      if (left <= 10 && !run.saidTimeLow && run.simMode === 'test' && run.kind !== 'shift') { run.saidTimeLow = true; say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.timeLow)}`, 3); }
      if (left <= 0) timeUp();
    }

    // instructor nags
    if (run.kind === 'test' && game.state === 'play') {
      if (Math.abs(w.player.speed) < 0.05) game.idleT += dt; else game.idleT = 0;
      if (game.idleT > 12) { say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.slow)}`); game.idleT = 0; }
      if (!game.saidReverse && w.player.gear === 'R' && w.player.speed < -0.5) { game.saidReverse = true; say(`<b>INSTRUCTOR:</b> ${pickLine(INSTRUCTOR.reverse)}`, 2); }
    }
    audio.reverseBeep(dt, w.player.gear === 'R' && w.player.speed < -0.2);
    audio.nitro(w.player.nitroOn && game.state === 'play');
    if (game.sirenT > 0) {
      game.sirenT -= rawDt;
      view.doFlash(0.35, Math.floor(game.sirenT * 6) % 2 ? 0xff0000 : 0x0000ff);
    }
    view.update(dt);
    updateHUD();
    if (game.state === 'ending') {
      game.endT -= rawDt;
      if (game.endT <= 0) { game.sirenT = 0; game.endFn(); }
    }
  } else if (game.state === 'garage' || game.state === 'paint') {
    const v = game.state === 'paint' ? paint.veh : VEHICLES[garageSel];
    const ps = paintedSpec(v);
    view.renderShowcase(rawDt, ps, ps.color, ps.accent, window.innerWidth >= 900);
  } else if (game.state !== 'paused') {
    view.renderIdle(rawDt);
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
  setLook(save.look);
  const combo = document.createElement('div');
  combo.id = 'combo';
  combo.className = 'hidden';
  hud.appendChild(combo);
  // a scenic street behind the menu, with a bit of life in it
  const vehicle = vehicleById(save.vehicle);
  const level = buildLevel({ mode: 'test', difficulty: 'normal', vehicle, seed: 7, mods: ['traffic', 'peds'] });
  const world = new World(level, vehicle, { rand: rng(7) });
  game.world = world;
  view.load(world);
  renderMenu();
  window.__ppsBooted = true;
  $('boot-msg').style.display = 'none';
  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) window.__pps = { game, save, startRun, CAREER, AIDriver, AI_PROFILES, renderMenu, renderTrophies, renderGarage, renderFree, renderCareer, startShift, dailyConfig };

boot();
