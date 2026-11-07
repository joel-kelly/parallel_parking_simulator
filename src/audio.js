// All sounds are synthesised with WebAudio: bleepy, square-wave, very 1991.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.beepT = 0;
  }

  // Browsers only allow audio after a user gesture.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  // Reverse beeper while backing up. Cheeky but accurate.
  reverseBeep(dt, reversing) {
    if (!this.ctx) return;
    if (!reversing) { this.beepT = 0; return; }
    this.beepT -= dt;
    if (this.beepT <= 0) { this.tone(1200, 0.12, 'square', 0.06); this.beepT = 0.6; }
  }

  tone(freq, dur, type = 'square', vol = 0.1, when = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  crash(impact) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 300 + Math.random() * 600; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    const v = Math.min(0.6, 0.08 + impact * 0.06);
    const dur = 0.1 + Math.min(0.5, impact * 0.05);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur);
    if (impact < 1.5) this.tone(1800, 0.08, 'square', 0.05); // "ding"
    else this.tone(120, 0.2, 'square', 0.12, 0, -60);
  }

  smash() {
    this.crash(4);
    for (let i = 0; i < 5; i++) this.tone(2000 + Math.random() * 2000, 0.05, 'square', 0.03, i * 0.03);
  }

  boom() {
    this.crash(12);
    this.tone(80, 0.6, 'sawtooth', 0.25, 0, -50);
  }

  coin() {
    this.tone(988, 0.08, 'square', 0.08);
    this.tone(1319, 0.25, 'square', 0.08, 0.08);
  }

  curb() { this.tone(90, 0.12, 'square', 0.12, 0, -30); }

  horn(style) {
    if (style === 'truck') { // ice cream jingle
      [523, 659, 784, 659, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.12, i * 0.15));
    } else if (style === 'weenie') { // awooga
      this.tone(300, 0.35, 'sawtooth', 0.12, 0, 250);
      this.tone(550, 0.35, 'sawtooth', 0.12, 0.38, -250);
    } else if (style === 'monster') {
      this.tone(110, 0.5, 'sawtooth', 0.18); this.tone(147, 0.5, 'sawtooth', 0.12);
    } else {
      this.tone(415, 0.3, 'square', 0.1); this.tone(523, 0.3, 'square', 0.08);
    }
  }

  blip() { this.tone(660, 0.05, 'square', 0.06); }
  select() { this.tone(880, 0.06, 'square', 0.06); this.tone(1320, 0.08, 'square', 0.06, 0.06); }

  jingle(good) {
    const notes = good ? [523, 659, 784, 1047, 784, 1047] : [392, 370, 349, 330];
    notes.forEach((f, i) => this.tone(f, good ? 0.12 : 0.25, 'square', 0.09, i * (good ? 0.11 : 0.25)));
  }

  countdown(go) { this.tone(go ? 1046 : 523, go ? 0.4 : 0.15, 'square', 0.1); }
}
