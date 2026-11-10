// Controller support for Xbox-style pads. Pads the browser reports with the
// "standard" mapping (Xbox, 8BitDo in X-input mode) get the full layout. Other
// pads (Firefox often reports 8BitDo and Switch-style pads this way) get a
// best guess (left stick, face buttons and triggers by their usual positions)
// until the player runs Controller Setup, which records where everything is.
// Analog sticks and triggers drive the car directly; buttons are turned into
// the same key codes the keyboard uses, so menus and actions need no changes.

import { bindValue, stickValue } from './padsetup.js';

const DEAD = 0.15;      // stick deadzone
const NAV = 0.6;        // stick push that counts as a menu "press"

// Standard-mapping button indices.
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7,
  BACK = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

// Buttons -> key codes. While driving, the thumbs are on the sticks, so
// actions live on the face buttons and handbrake is on RB/B (handled in poll).
const DRIVE_MAP = {
  [A]: ['Enter'], [X]: ['KeyC'], [Y]: ['KeyH'], [LB]: ['KeyI'],
  [BACK]: ['KeyR'], [START]: ['Escape'],
};
const MENU_MAP = {
  [A]: ['Enter'], [B]: ['Escape'], [X]: ['KeyC'], [Y]: ['KeyG', 'KeyQ'],
  [BACK]: ['KeyR'], [START]: ['Enter'],
  [UP]: ['ArrowUp'], [DOWN]: ['ArrowDown'], [LEFT]: ['ArrowLeft'], [RIGHT]: ['ArrowRight'],
};

const prev = new Map(); // pad index -> previous "down" flags

// Layouts recorded in Controller Setup, keyed by the pad's id string.
let layouts = {};
export function setLayouts(l) { layouts = l || {}; prev.clear(); }
export function hasLayout(id) { return !!layouts[id]; }

const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));
const clamp = (v) => Math.max(-1, Math.min(1, v));

/**
 * Read every connected standard pad once per frame.
 * mode: 'drive' | 'menu' | 'paused'
 * Returns { throttle, steer, handbrake, nitro, codes, active } where codes are key
 * codes pressed this frame and active is true if the pad was touched at all.
 */
export function pollPads(mode) {
  const out = { throttle: 0, steer: 0, handbrake: false, nitro: false, codes: [], active: false };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const std = gp.mapping === 'standard';
    const lay = layouts[gp.id];
    const ax = (i) => dz(gp.axes[i] || 0);
    let btn, ry;
    if (lay) {
      // Recorded layout: read each standard control from wherever it really is.
      btn = (i) => { const v = bindValue(gp, lay.map[i]); return { pressed: v > 0.5, value: v }; };
      ry = lay.stick ? -dz(stickValue(gp, lay.stick)) : 0; // up is negative, like standard
    } else {
      btn = (i) => gp.buttons[i] || { pressed: false, value: 0 };
      // On non-standard pads only the left stick is in a predictable place;
      // other axes may be triggers resting at -1, which would floor the gas.
      ry = std ? ax(3) : 0;
    }
    const lx = ax(0), ly = ax(1);
    const dpadX = (btn(RIGHT).pressed ? 1 : 0) - (btn(LEFT).pressed ? 1 : 0);
    const dpadY = (btn(DOWN).pressed ? 1 : 0) - (btn(UP).pressed ? 1 : 0);

    // Driving: right trigger or right stick up = gas; left trigger or right
    // stick down = brake, then reverse. Left stick or d-pad steers.
    out.throttle += btn(RT).value - btn(LT).value - ry;
    out.steer += lx + dpadX;
    if (btn(RB).pressed || btn(B).pressed) out.handbrake = true;
    if (btn(LB).pressed) out.nitro = true; // nitro in Wreck mode (LB is also the instructor demo elsewhere)

    // "Down" flags for edge detection. In menus the left stick acts as a d-pad.
    const down = lay ? Array.from({ length: RIGHT + 1 }, (_, i) => btn(i).pressed) : gp.buttons.map((b) => b.pressed);
    if (mode !== 'drive') {
      down[UP] = down[UP] || ly < -NAV;
      down[DOWN] = down[DOWN] || ly > NAV;
      down[LEFT] = down[LEFT] || lx < -NAV;
      down[RIGHT] = down[RIGHT] || lx > NAV;
    }
    const was = prev.get(gp.index) || [];
    const map = mode === 'drive' ? DRIVE_MAP : MENU_MAP;
    down.forEach((d, i) => {
      if (!d || was[i]) return;
      out.active = true;
      // Start toggles pause; elsewhere in menus it confirms.
      if (i === START && mode === 'paused') out.codes.push('Escape');
      else if (map[i]) out.codes.push(...map[i]);
    });
    prev.set(gp.index, down);

    if (lx || ly || ry || dpadX || dpadY || btn(RT).value > 0.1 || btn(LT).value > 0.1) out.active = true;
  }
  out.throttle = clamp(out.throttle);
  out.steer = clamp(out.steer);
  return out;
}

// ---- rumble ----
// Chrome and Edge support 'dual-rumble'; other browsers quietly do nothing.
// strong = low-frequency (big) motor, weak = high-frequency (buzzy) motor, 0..1.
// A new effect replaces the playing one, so a weaker effect doesn't cut off a
// stronger one that's still going.
let rumbleOn = true;
let busyUntil = 0, busyLevel = 0;
export function setRumble(on) { rumbleOn = on; if (!on) stopRumble(); }

export function rumble(strong, weak, ms) {
  if (!rumbleOn || !navigator.getGamepads) return;
  const now = performance.now();
  const level = Math.max(strong, weak);
  if (now < busyUntil && level < busyLevel) return;
  busyUntil = now + ms; busyLevel = level;
  for (const gp of navigator.getGamepads()) {
    const act = gp && gp.connected && gp.vibrationActuator;
    if (!act || !act.playEffect) continue;
    act.playEffect('dual-rumble', {
      duration: Math.round(ms), strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak),
    }).catch(() => {});
  }
}

export function stopRumble() {
  busyUntil = 0; busyLevel = 0;
  if (!navigator.getGamepads) return;
  for (const gp of navigator.getGamepads()) {
    const act = gp && gp.connected && gp.vibrationActuator;
    if (act && act.reset) act.reset().catch(() => {});
  }
}
