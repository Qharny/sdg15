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

  footstep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.12);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 180 + Math.random() * 80;
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
    this._tone(660, 0.22, "sine", 0.25);
    this._tone(880, 0.28, "sine", 0.2, 0.08);
  }

  alert() {
    this._tone(180, 0.35, "sawtooth", 0.18);
    this._tone(140, 0.4, "sawtooth", 0.14, 0.12);
  }

  splash() {
    this._tone(320, 0.15, "sine", 0.15);
  }

  shoot() {
    this._tone(760, 0.07, "triangle", 0.16);
  }
}
