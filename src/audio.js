// Procedural positional sounds through the native Web Audio PannerNode (HRTF). No samples.
export class Audio3D {
  constructor() { this.ctx = null; this.listeners = []; this.enabled = true; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
    const n = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // soft forest ambience so silence isn't a giveaway
    const amb = this.ctx.createBufferSource(); amb.buffer = this.noise; amb.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = this.ctx.createGain(); g.gain.value = 0.035;
    amb.connect(f).connect(g).connect(this.master); amb.start();
  }

  setListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    const fwd = camera.getWorldDirection(this._f ??= camera.position.clone());
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(p.x, p.y, p.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** Recipes: [filterType, freq, Q, duration, gain, extraClickDelay] */
  static RECIPES = {
    crack: ['highpass', 1400, 0.7, 0.05, 2.4, 0.035],
    squelch: ['lowpass', 420, 4.0, 0.18, 1.3, 0],
    splash: ['bandpass', 1300, 0.8, 0.32, 1.4, 0.08],
    rustle: ['highpass', 2800, 0.5, 0.45, 0.55, 0],
    step: ['lowpass', 260, 1.0, 0.07, 0.55, 0],
    tap: ['bandpass', 2200, 3.0, 0.03, 0.6, 0],
    sip: ['bandpass', 1100, 6.0, 0.06, 0.5, 0],
  };

  play(kind, x, y, z) {
    for (const l of this.listeners) l(kind, x, y, z);
    if (!this.ctx || !this.enabled) return;
    const r = Audio3D.RECIPES[kind]; if (!r) return;
    const [type, freq, q, dur, gain, click2] = r;
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = 1.5; pan.rolloffFactor = 1.3; pan.maxDistance = 40;
    if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; }
    else pan.setPosition(x, y, z);
    pan.connect(this.master);
    const burst = (at, g, d) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq * (0.85 + Math.random() * 0.3); f.Q.value = q;
      if (kind === 'squelch') f.frequency.exponentialRampToValueAtTime(freq * 2.2, at + d);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(g, at + Math.min(0.01, d * 0.2));
      env.gain.exponentialRampToValueAtTime(0.0001, at + d);
      src.connect(f).connect(env).connect(pan);
      src.start(at, Math.random() * 0.5, d + 0.05);
    };
    burst(t, gain, dur);
    if (click2) burst(t + click2, gain * 0.6, dur * 0.8);
  }

  ping() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.4);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.55);
  }
}
