// Controller setup: asks the player to press each control in turn and records
// which raw button or axis it is. Needed for pads the browser reports with a
// non-standard layout, where button and axis numbers differ per model.
//
// A binding is one of:
//   { b: i }           button i
//   { a: i, s, r }     axis i moved in direction s (+1/-1) from its resting value r
//   { a: i, v }        axis i at an exact value (d-pads reported as one "hat" axis)

// Standard-mapping indices, the same as gamepad.js uses.
const STEPS = [
  { id: 7, label: 'PULL THE RIGHT TRIGGER', what: 'GAS', kind: 'any' },
  { id: 6, label: 'PULL THE LEFT TRIGGER', what: 'BRAKE / REVERSE', kind: 'any' },
  { id: 'stick', label: 'PUSH THE RIGHT STICK UP', what: 'GAS (DOWN = BRAKE)', kind: 'stick' },
  { id: 0, label: 'PRESS THE BOTTOM FACE BUTTON', what: 'CONFIRM', kind: 'button' },
  { id: 1, label: 'PRESS THE RIGHT FACE BUTTON', what: 'BACK / HANDBRAKE', kind: 'button' },
  { id: 2, label: 'PRESS THE LEFT FACE BUTTON', what: 'CAMERA', kind: 'button' },
  { id: 3, label: 'PRESS THE BUTTON YOU WANT FOR THE HORN', what: 'HORN (TOP FACE BUTTON IS USUAL)', kind: 'button' },
  { id: 4, label: 'PRESS THE LEFT BUMPER', what: 'INSTRUCTOR / NITRO', kind: 'button' },
  { id: 5, label: 'PRESS THE RIGHT BUMPER', what: 'HANDBRAKE', kind: 'button' },
  { id: 8, label: 'PRESS SELECT / BACK / MINUS', what: 'RESTART', kind: 'button' },
  { id: 9, label: 'PRESS START / MENU / PLUS', what: 'PAUSE', kind: 'button' },
  { id: 12, label: 'PRESS D-PAD UP', what: 'MENU UP', kind: 'dpad' },
  { id: 13, label: 'PRESS D-PAD DOWN', what: 'MENU DOWN', kind: 'dpad' },
  { id: 14, label: 'PRESS D-PAD LEFT', what: 'STEER LEFT', kind: 'dpad' },
  { id: 15, label: 'PRESS D-PAD RIGHT', what: 'STEER RIGHT', kind: 'dpad' },
];

const MOVE = 0.6;      // axis travel that counts as "this one"
const STEP_TIME = 10;  // seconds before a step skips itself
const ANALOG_WAIT = 0.25; // on gas/brake, give an analog axis this long to show up before taking a button

/** How far a binding is pressed, 0..1. */
export function bindValue(gp, k) {
  if (!k) return 0;
  if (k.b != null) {
    const b = gp.buttons[k.b];
    return b ? Math.max(b.value || 0, b.pressed ? 1 : 0) : 0;
  }
  const v = gp.axes[k.a];
  if (v == null) return 0;
  if (k.v != null) return Math.abs(v - k.v) < 0.15 ? 1 : 0;
  const span = Math.max(0.5, k.s > 0 ? 1 - k.r : 1 + k.r);
  return Math.max(0, Math.min(1, (v - k.r) * k.s / span));
}

/** A stick binding read both ways, -1..1 (positive = the direction recorded). */
export function stickValue(gp, k) {
  if (!k) return 0;
  const v = gp.axes[k.a];
  return v == null ? 0 : Math.max(-1, Math.min(1, (v - k.r) * k.s));
}

const snap = (gp) => ({ axes: [...gp.axes], buttons: gp.buttons.map((b) => b.pressed) });

export class PadSetup {
  /** onDone(id, layout) when finished, or onDone(null) if cancelled / no pad used. */
  constructor(el, onDone) {
    this.el = el;
    this.onDone = onDone;
    this.step = 0;
    this.padIndex = null;   // locked to the first pad that answers
    this.padId = null;
    this.layout = { map: {}, stick: null };
    this.results = [];
    this.startStep();
  }

  startStep() {
    this.t = 0;
    this.base = null;       // snapshot taken once everything is let go
    this.buttonSince = null;
    this.render();
  }

  pads() {
    const all = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    return all.filter((gp) => gp && gp.connected && (this.padIndex == null || gp.index === this.padIndex));
  }

  // Everything back at rest (no buttons held, last binding let go)?
  idle(gp) {
    if (gp.buttons.some((b) => b.pressed)) return false;
    const lastStep = STEPS[this.step - 1];
    const last = lastStep && this.results[this.step - 1];
    if (last) {
      const v = lastStep.kind === 'stick' ? Math.abs(stickValue(gp, last)) : bindValue(gp, last);
      if (v > 0.3) return false;
    }
    return true;
  }

  update(dt) {
    if (this.step >= STEPS.length) return;
    this.t += dt;
    if (this.t > STEP_TIME) { this.skip(); return; }
    const s = STEPS[this.step];
    const pads = this.pads();

    if (!this.base) {
      if (pads.length && pads.every((gp) => this.idle(gp))) {
        this.base = new Map(pads.map((gp) => [gp.index, snap(gp)]));
      }
      return;
    }

    for (const gp of pads) {
      const base = this.base.get(gp.index);
      if (!base) continue;
      let axisHit = null;
      if (s.kind !== 'button') {
        gp.axes.forEach((v, i) => {
          if (axisHit) return;
          const r = base.axes[i] ?? 0;
          const d = v - r;
          const hat = Math.abs(r) > 1.05; // d-pad hats rest outside -1..1 and jump between fixed values
          if (Math.abs(d) < (hat ? 0.2 : MOVE)) return;
          if (s.kind === 'stick' && (hat || Math.abs(r) > 0.3)) return;
          if (s.kind === 'any' && hat) return;
          axisHit = hat ? { a: i, v: Math.round(v * 100) / 100 } : { a: i, s: Math.sign(d), r: Math.round(r * 100) / 100 };
        });
      }
      if (axisHit) { this.bind(gp, axisHit); return; }

      if (s.kind === 'stick') continue;
      const bi = gp.buttons.findIndex((b, i) => b.pressed && !base.buttons[i]);
      if (bi < 0) { if (this.buttonSince && this.buttonSince.pad === gp.index) this.buttonSince = null; continue; }
      if (s.kind === 'any') {
        // Triggers often report a button and an axis; prefer the analog axis.
        if (!this.buttonSince) this.buttonSince = { pad: gp.index, t: this.t };
        if (this.t - this.buttonSince.t < ANALOG_WAIT) continue;
      }
      this.bind(gp, { b: bi });
      return;
    }
  }

  bind(gp, k) {
    if (this.padIndex == null) { this.padIndex = gp.index; this.padId = gp.id; }
    const s = STEPS[this.step];
    if (s.id === 'stick') this.layout.stick = k;
    else this.layout.map[s.id] = k;
    this.results[this.step] = k;
    this.next();
  }

  skip() {
    this.results[this.step] = null;
    this.next();
  }

  next() {
    this.step++;
    if (this.step >= STEPS.length) this.finish();
    else this.startStep();
  }

  finish() {
    this.onDone(this.padId, this.padId ? this.layout : null);
  }

  cancel() { this.onDone(null, null); }

  render() {
    const s = STEPS[this.step];
    const name = (k) => (!k ? '<span style="color:var(--dgray)">SKIPPED</span>'
      : k.b != null ? `BUTTON ${k.b}` : k.v != null ? `HAT ${k.a}` : `AXIS ${k.a}${k.s > 0 ? '+' : '-'}`);
    const done = STEPS.slice(0, this.step).map((st, i) =>
      `<div><span class="k">${st.what}</span> ${name(this.results[i])}</div>`).join('');
    this.el.innerHTML = `
      <div class="window howto">
        <h2>CONTROLLER SETUP</h2>
        <div style="color:var(--lgray)">STEP ${this.step + 1} OF ${STEPS.length}${this.padId ? ` &bull; ${this.padId.slice(0, 40)}` : ''}</div>
        <div style="font-size:12px;margin:12px 0" class="good">${s.label}</div>
        <div style="color:var(--lgray)">USED FOR: ${s.what}</div>
        <div style="margin-top:10px;max-height:30vh;overflow:auto">${done}</div>
        <div class="hint">LET GO OF EVERYTHING BETWEEN STEPS<br>SPACE SKIPS A STEP (OR WAIT ${STEP_TIME}S) &bull; ESC CANCELS</div>
      </div>`;
  }
}
