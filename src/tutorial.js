// A short, skippable guided intro to the controls. Each step watches what the
// player does and moves on once they've done it.

const key = (k) => `<span class="key">${k}</span>`;

const STEPS = [
  {
    text: `Hold ${key('W')} to drive forward.`,
    done: (t) => t.forward > 6,
  },
  {
    text: `Steer with ${key('A')} and ${key('D')}. Try both ways.`,
    done: (t) => t.steeredLeft && t.steeredRight,
  },
  {
    text: `Hold ${key('S')} to brake. Keep holding it to reverse.<br><small>No gears to shift: it flips from D to R by itself.</small>`,
    done: (t) => t.reverse > 2,
  },
  {
    text: `Press ${key('C')} to change the camera.<br><small>Top-down is great for parking. Keep pressing to cycle.</small>`,
    done: (t) => t.camPresses >= 1,
  },
  {
    text: `${key('SPACE')} is the handbrake. Give it a tap.`,
    done: (t) => t.handbrake,
  },
  {
    text: `Now park in the spot with the bouncing ${key('P')}.<br><small>Pull up beside the car in front of it, then reverse in. Stop and hold still to finish. Stuck? Press ${key('I')} to watch the instructor.</small>`,
    done: (t, world) => world.player.parked,
  },
];

export class Tutorial {
  constructor(el) {
    this.el = el;
    this.step = 0;
    this.forward = 0;
    this.reverse = 0;
    this.steeredLeft = false;
    this.steeredRight = false;
    this.camPresses = 0;
    this.handbrake = false;
    this.finished = false;
    this.flash = 0;
    this.render();
  }

  get total() { return STEPS.length; }

  // Returns true on the frame a step is completed.
  update(dt, input, world) {
    if (this.finished) return false;
    const p = world.player;
    if (p.speed > 0) this.forward += p.speed * dt;
    else this.reverse -= p.speed * dt;
    if (Math.abs(p.speed) > 0.5) {
      if (input.steer < 0) this.steeredLeft = true;
      if (input.steer > 0) this.steeredRight = true;
    }
    if (input.handbrake) this.handbrake = true;
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) this.render();
    }

    if (STEPS[this.step].done(this, world)) {
      this.step++;
      if (this.step >= STEPS.length) this.finished = true;
      // reset per-step counters so each step is actually practised
      this.forward = 0; this.reverse = 0;
      this.flash = 0.9;
      this.el.innerHTML = '<div class="tut-nice">NICE!</div>';
      return true;
    }
    return false;
  }

  render() {
    if (this.finished) return;
    this.el.innerHTML = `
      <div class="tut-step">STEP ${this.step + 1}/${STEPS.length}</div>
      <div class="tut-text">${STEPS[this.step].text}</div>
      <div class="tut-skip">${key('ENTER')} SKIP TUTORIAL</div>`;
  }
}
