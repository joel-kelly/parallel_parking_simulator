// All sounds are synthesised with WebAudio: bleepy, square-wave, very 1991.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.beepT = 0;
    this.nitroOsc = null;
    this.sirenT = 0;
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

  noiseBurst(vol, dur, freq, q = 0.8, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur);
  }

  crash(impact) {
    if (!this.ctx) return;
    const v = Math.min(0.6, 0.08 + impact * 0.06);
    const dur = 0.1 + Math.min(0.5, impact * 0.05);
    this.noiseBurst(v, dur, 300 + Math.random() * 600);
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
    } else if (style === 'food') { // clown horn
      this.tone(330, 0.12, 'square', 0.12, 0, 180);
      this.tone(330, 0.2, 'square', 0.12, 0.16, 180);
    } else if (style === 'monster') {
      this.tone(110, 0.5, 'sawtooth', 0.18); this.tone(147, 0.5, 'sawtooth', 0.12);
    } else if (style === 'bus') { // air horn
      this.tone(185, 0.7, 'sawtooth', 0.2); this.tone(233, 0.7, 'sawtooth', 0.16); this.tone(92, 0.7, 'square', 0.1);
    } else if (style === 'kart') { // meep meep
      this.tone(1400, 0.08, 'square', 0.1); this.tone(1400, 0.08, 'square', 0.1, 0.12);
    } else {
      this.tone(415, 0.3, 'square', 0.1); this.tone(523, 0.3, 'square', 0.08);
    }
  }

  // Another driver, leaning on it.
  honk() { this.tone(330, 0.5, 'square', 0.09); this.tone(415, 0.5, 'square', 0.07); }

  // A pedestrian diving for cover.
  yelp() { this.tone(900 + Math.random() * 400, 0.18, 'square', 0.07, 0, 500); }

  // Earthquake rumble.
  rumble(dur = 1.6) {
    this.noiseBurst(0.35, dur, 60, 0.5);
    this.tone(40, dur, 'sawtooth', 0.15, 0, 10);
  }

  // Thunder for the downpour.
  thunder() { this.noiseBurst(0.4, 1.4, 90, 0.4); this.tone(50, 1.0, 'sawtooth', 0.1, 0.1, -20); }

  // Police siren for the end of Wreck-reation.
  siren(n = 4) {
    for (let i = 0; i < n; i++) {
      this.tone(600, 0.4, 'square', 0.08, i * 0.8, 300);
      this.tone(900, 0.4, 'square', 0.08, i * 0.8 + 0.4, -300);
    }
  }

  // Nitro: a rising rasp while held.
  nitro(on) {
    if (!this.ctx) return;
    if (on && !this.nitroOsc) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, this.ctx.currentTime);
      o.frequency.linearRampToValueAtTime(220, this.ctx.currentTime + 1.5);
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.1, this.ctx.currentTime + 0.1);
      o.connect(g); g.connect(this.master);
      o.start();
      this.nitroOsc = { o, g };
    } else if (!on && this.nitroOsc) {
      const { o, g } = this.nitroOsc;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
      o.stop(this.ctx.currentTime + 0.2);
      this.nitroOsc = null;
    }
  }

  tick(urgent) { this.tone(urgent ? 1200 : 800, 0.05, 'square', urgent ? 0.09 : 0.05); }

  trophy() {
    [659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, i * 0.09));
    this.tone(2093, 0.5, 'triangle', 0.08, 0.45);
  }

  strike() { this.tone(220, 0.3, 'square', 0.12); this.tone(165, 0.5, 'square', 0.12, 0.25); }

  baa() {
    // a wobbly bleat: quick alternating tones for the tremolo
    for (let i = 0; i < 7; i++) this.tone(i % 2 ? 390 : 340, 0.07, 'sawtooth', 0.1, i * 0.06, -20);
  }

  blip() { this.tone(660, 0.05, 'square', 0.06); }
  select() { this.tone(880, 0.06, 'square', 0.06); this.tone(1320, 0.08, 'square', 0.06, 0.06); }

  jingle(good) {
    const notes = good ? [523, 659, 784, 1047, 784, 1047] : [392, 370, 349, 330];
    notes.forEach((f, i) => this.tone(f, good ? 0.12 : 0.25, 'square', 0.09, i * (good ? 0.11 : 0.25)));
  }

  countdown(go) { this.tone(go ? 1046 : 523, go ? 0.4 : 0.15, 'square', 0.1); }
}
