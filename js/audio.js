// All sound is synthesized with the Web Audio API - no external audio
// files - so the game stays a handful of static files with zero fetches
// beyond the three.js CDN import.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this._started = false;
  }

  start() {
    if (this._started) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    this._started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._startWind();
  }

  _noiseBuffer(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brownish noise, softer than white
      data[i] = last * 3.2;
    }
    return buffer;
  }

  _startWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.12;
    src.connect(filter).connect(this.windGain).connect(this.master);
    src.start();
  }

  // `groundHealth` (0-1) lets footsteps sound duller/softer on dry, bare
  // ground and crisper on healthy land, without needing separate samples.
  footstep(groundHealth = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.12);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 140 + groundHealth * 90 + Math.random() * 80;
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.15);
  }

  _tone(freq, duration, type, startGain, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(startGain, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  chime() {
    // Slight per-call pitch jitter so repeated planting doesn't sound robotic.
    const jitter = 0.95 + Math.random() * 0.1;
    this._tone(660 * jitter, 0.22, "sine", 0.25);
    this._tone(880 * jitter, 0.28, "sine", 0.2, 0.08);
  }

  alert() {
    this._tone(180, 0.35, "sawtooth", 0.18);
    this._tone(140, 0.4, "sawtooth", 0.14, 0.12);
  }

  // Distinct from the logger `alert()` timbre (square vs sawtooth, higher
  // pitch) so players can tell the two threats apart by ear.
  poacherAlert() {
    this._tone(310, 0.28, "square", 0.16);
    this._tone(220, 0.32, "square", 0.12, 0.1);
  }

  fanfare() {
    this._tone(523.25, 0.18, "triangle", 0.22);
    this._tone(659.25, 0.18, "triangle", 0.22, 0.1);
    this._tone(783.99, 0.32, "triangle", 0.24, 0.2);
  }

  splash() {
    this._tone(320, 0.15, "sine", 0.15);
  }

  shoot() {
    this._tone(760, 0.07, "triangle", 0.16);
  }

  crackle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200 + Math.random() * 800;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  // Toggled on/off by the game loop based on whether it's currently raining
  // - a soft, higher-pitched hiss layered on top of the wind loop.
  setRain(active) {
    if (!this.ctx) return;
    if (active && !this._rain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(4);
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 2200;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 1.5);
      this._rain = { src, gain };
    } else if (!active && this._rain) {
      const { src, gain } = this._rain;
      const stopAt = this.ctx.currentTime + 1.5;
      gain.gain.linearRampToValueAtTime(0, stopAt);
      src.stop(stopAt + 0.05);
      this._rain = null;
    }
  }
}
