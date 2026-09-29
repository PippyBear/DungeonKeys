// WebAudio 实时合成音效与背景音乐（无音频文件）
import { platform } from './platform.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.last = {};
    this.musicTimer = null;
    this.track = null;
  }
  init() {
    if (this.ctx) { this.resume(); return; }
    try {
      this.ctx = platform.createAudioContext();
      if (!this.ctx) return;
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      this.mus = c.createGain(); this.mus.gain.value = 0.3; this.mus.connect(this.master);
      // 简易混响（延迟反馈）让地牢有回声
      try {
        const d = c.createDelay(1.0); d.delayTime.value = 0.23;
        const fb = c.createGain(); fb.gain.value = 0.28;
        const wet = c.createGain(); wet.gain.value = 0.22;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        this.sfx.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(this.master);
      } catch (e) { /* 部分环境不支持 */ }
      const len = Math.floor(c.sampleRate * 1.0);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* ignore */ } }
  suspend() { try { if (this.ctx && this.ctx.suspend) this.ctx.suspend(); } catch (e) { /* ignore */ } }
  _ok(name, gap) {
    if (!this.ctx || !this.settings.sound) return false;
    const t = this.ctx.currentTime;
    if (this.last[name] && t - this.last[name] < gap) return false;
    this.last[name] = t;
    return true;
  }
  _tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0, dest) {
    const c = this.ctx, t = c.currentTime + Math.max(0, delay);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, vol = 0.3, filter = 'lowpass', f0 = 1000, f1 = 0, delay = 0, q = 1) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filter; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  play(name) {
    const gap = { step: 0.2, hit: 0.05, spike: 0.1, coinbounce: 0.08, swing: 0.3, climb: 0.15, land: 0.1 }[name] || 0.035;
    if (!this._ok(name, gap)) return;
    try {
      if (name.startsWith('rune')) {
        const k = +name.slice(4);
        const n = [72, 76, 79, 83, 86][k % 5];
        this._tone(NOTE(n), 0.9, 'sine', 0.25); this._tone(NOTE(n + 12), 0.6, 'triangle', 0.08);
        return;
      }
      switch (name) {
        case 'click': this._tone(900, 0.05, 'square', 0.08, 1.2); break;
        case 'open': this._tone(400, 0.12, 'triangle', 0.2, 2); break;
        case 'close': this._tone(600, 0.1, 'triangle', 0.15, 0.5); break;
        case 'error': this._tone(180, 0.18, 'square', 0.1, 0.8); break;
        case 'coin': this._tone(1600, 0.07, 'square', 0.06); this._tone(2400, 0.12, 'square', 0.05, 0, 0.06); break;
        case 'coinbounce': this._tone(2200, 0.04, 'triangle', 0.05); break;
        case 'crystal': [0, 7, 12].forEach((n, i) => this._tone(NOTE(84 + n), 0.3, 'sine', 0.12, 0, i * 0.05)); break;
        case 'key': [0, 4, 7, 12, 16].forEach((n, i) => this._tone(NOTE(76 + n), 0.35, 'triangle', 0.15, 0, i * 0.07)); break;
        case 'heal': [0, 5, 9, 12].forEach((n, i) => this._tone(NOTE(72 + n), 0.3, 'sine', 0.14, 0, i * 0.06)); break;
        case 'levelup': [0, 4, 7, 12, 7, 12, 19].forEach((n, i) => this._tone(NOTE(67 + n), 0.25, 'triangle', 0.16, 0, i * 0.09)); break;
        case 'solve': [0, 3, 7, 10, 12, 15].forEach((n, i) => this._tone(NOTE(69 + n), 0.5, 'sine', 0.14, 0, i * 0.08)); this._noise(0.8, 0.1, 'highpass', 4000); break;
        case 'magic': this._tone(NOTE(81), 0.8, 'sine', 0.1, 1.5); this._noise(0.6, 0.06, 'highpass', 5000); break;
        case 'gate': this._noise(0.6, 0.35, 'bandpass', 300, 150, 0, 2); this._tone(70, 0.5, 'sawtooth', 0.06, 0.7); break;
        case 'unseal': this._tone(NOTE(60), 1.2, 'sine', 0.2, 2); this._tone(NOTE(67), 1.2, 'sine', 0.15, 2, 0.1); this._noise(1, 0.12, 'highpass', 3000); break;
        case 'chest': this._noise(0.35, 0.3, 'bandpass', 500, 900, 0, 3); [0, 4, 7].forEach((n, i) => this._tone(NOTE(79 + n), 0.3, 'triangle', 0.12, 0, 0.25 + i * 0.07)); break;
        case 'wood': this._noise(0.15, 0.45, 'bandpass', 700, 300, 0, 2); this._tone(150, 0.12, 'triangle', 0.2, 0.6); break;
        case 'pot': this._noise(0.25, 0.4, 'highpass', 2500, 1200, 0, 1); this._tone(1800, 0.06, 'triangle', 0.1, 0.7); break;
        case 'push': this._noise(0.25, 0.3, 'lowpass', 500, 200); break;
        case 'lever': this._noise(0.08, 0.4, 'bandpass', 1200, 0, 0, 3); this._tone(200, 0.15, 'square', 0.08, 0.6, 0.04); break;
        case 'plate': this._tone(120, 0.2, 'sine', 0.3, 0.5); this._noise(0.1, 0.2, 'bandpass', 800); break;
        case 'zap': this._tone(1500, 0.3, 'sawtooth', 0.12, 0.2); this._noise(0.3, 0.25, 'highpass', 3000); break;
        case 'mirror': this._noise(0.25, 0.25, 'bandpass', 1500, 600, 0, 4); this._tone(NOTE(88), 0.2, 'sine', 0.06); break;
        case 'spike': this._noise(0.12, 0.25, 'highpass', 3000, 6000); this._tone(2600, 0.08, 'triangle', 0.06); break;
        case 'flame': this._noise(1.2, 0.3, 'lowpass', 900, 400); break;
        case 'swing': this._noise(0.35, 0.18, 'bandpass', 400, 1200, 0, 2); break;
        case 'arrow': this._noise(0.18, 0.2, 'bandpass', 2500, 900, 0, 3); break;
        case 'slash': this._noise(0.14, 0.3, 'bandpass', 1800, 4000, 0, 1.5); break;
        case 'whoosh': this._noise(0.25, 0.3, 'bandpass', 600, 2500, 0, 1.5); break;
        case 'hit': this._noise(0.08, 0.35, 'lowpass', 1800, 300); this._tone(180, 0.08, 'square', 0.08, 0.5); break;
        case 'squish': this._noise(0.15, 0.3, 'lowpass', 700, 200); this._tone(300, 0.12, 'sine', 0.15, 0.4); break;
        case 'rockhit': this._noise(0.15, 0.4, 'lowpass', 900, 200); this._tone(90, 0.12, 'square', 0.1, 0.6); break;
        case 'bones': for (let i = 0; i < 5; i++) this._noise(0.05, 0.3, 'bandpass', 2000 + Math.random() * 1500, 0, i * 0.05 + Math.random() * 0.02, 5); break;
        case 'die': this._tone(500, 0.3, 'triangle', 0.15, 0.3); break;
        case 'bossdie': this._noise(2, 0.6, 'lowpass', 1200, 40); this._tone(60, 1.5, 'sawtooth', 0.2, 0.3); break;
        case 'swipe': this._noise(0.15, 0.25, 'bandpass', 900, 2000, 0, 1.2); break;
        case 'chomp': this._noise(0.1, 0.4, 'lowpass', 1200, 200); this._tone(120, 0.1, 'square', 0.12, 0.5, 0.03); break;
        case 'mimic': this._tone(150, 0.4, 'sawtooth', 0.15, 0.5); this._noise(0.4, 0.2, 'lowpass', 600); break;
        case 'roar': this._tone(90, 0.8, 'sawtooth', 0.2, 0.6); this._noise(0.8, 0.3, 'lowpass', 500, 150); break;
        case 'slam': case 'boom': this._noise(0.7, 0.6, 'lowpass', 900, 50); this._tone(55, 0.5, 'sine', 0.5, 0.5); break;
        case 'throw': this._noise(0.3, 0.2, 'bandpass', 300, 900); break;
        case 'hurt': this._tone(300, 0.2, 'square', 0.12, 0.5); this._noise(0.15, 0.3, 'lowpass', 1500, 300); break;
        case 'shield': this._tone(NOTE(84), 0.4, 'sine', 0.15, 0.5); this._noise(0.3, 0.2, 'highpass', 4000); break;
        case 'fireball': this._noise(0.5, 0.35, 'bandpass', 400, 1500, 0, 1); this._tone(200, 0.4, 'sawtooth', 0.06, 2); break;
        case 'nova': this._noise(0.8, 0.3, 'highpass', 2000, 6000); [0, 5, 12].forEach((n, i) => this._tone(NOTE(84 + n), 0.6, 'sine', 0.1, 0, i * 0.04)); break;
        case 'thunder': this._noise(0.5, 0.45, 'bandpass', 3000, 400, 0, 1); this._tone(80, 0.3, 'sawtooth', 0.12, 0.5); break;
        case 'descend': [12, 7, 3, 0, -5].forEach((n, i) => this._tone(NOTE(72 + n), 0.5, 'sine', 0.14, 0, i * 0.12)); this._noise(1.2, 0.15, 'lowpass', 800, 100); break;
        case 'gameover': [0, -3, -7, -12].forEach((n, i) => this._tone(NOTE(62 + n), 0.6, 'triangle', 0.18, 0.97, i * 0.3)); break;
        case 'step': this._noise(0.05, 0.05, 'lowpass', 500); break;
        case 'bow': this._tone(420, 0.12, 'triangle', 0.15, 0.5); this._noise(0.12, 0.2, 'bandpass', 2500, 900, 0, 3); break;
        case 'bolt': this._tone(NOTE(84), 0.2, 'sine', 0.12, 1.8); this._noise(0.2, 0.08, 'highpass', 4000); break;
        case 'cleave': this._noise(0.25, 0.4, 'bandpass', 700, 2200, 0, 1.2); this._tone(110, 0.18, 'sawtooth', 0.08, 0.6); break;
        case 'spore': this._noise(0.6, 0.3, 'lowpass', 1200, 300); this._tone(160, 0.3, 'sine', 0.12, 0.5); break;
        case 'teleport': this._tone(NOTE(72), 0.35, 'sine', 0.14, 3); this._noise(0.3, 0.1, 'highpass', 3000); break;
        case 'charge': this._tone(NOTE(76), 0.5, 'triangle', 0.08, 1.8); break;
        case 'imp': this._tone(700, 0.15, 'square', 0.06, 1.5); break;
        case 'ice': this._noise(0.3, 0.25, 'highpass', 3000, 8000); this._tone(NOTE(96), 0.2, 'sine', 0.08); break;
        case 'bonecast': for (let i = 0; i < 3; i++) this._noise(0.05, 0.25, 'bandpass', 2500, 0, i * 0.05, 5); this._tone(NOTE(55), 0.4, 'sawtooth', 0.08, 0.7); break;
        case 'summon': this._tone(NOTE(43), 0.9, 'sawtooth', 0.12, 1.2); this._noise(0.8, 0.2, 'lowpass', 600, 200); break;
        case 'buy': [0, 7, 12].forEach((n, i) => this._tone(NOTE(84 + n), 0.15, 'square', 0.05, 0, i * 0.06)); break;
        case 'jump': this._tone(260, 0.14, 'triangle', 0.1, 2.2); this._noise(0.08, 0.08, 'lowpass', 900); break;
        case 'jump2': this._tone(520, 0.16, 'sine', 0.1, 1.8); this._noise(0.15, 0.08, 'highpass', 4000); break;
        case 'land': this._noise(0.08, 0.2, 'lowpass', 600, 150); break;
        case 'landHard': this._noise(0.18, 0.35, 'lowpass', 700, 80); this._tone(80, 0.12, 'sine', 0.2, 0.6); break;
        case 'climb': this._noise(0.05, 0.15, 'bandpass', 900, 0, 0, 3); break;
        case 'boing': this._tone(180, 0.35, 'sine', 0.25, 4); this._tone(360, 0.25, 'triangle', 0.06, 3, 0.03); break;
        case 'crumble': this._noise(0.6, 0.25, 'lowpass', 500, 120, 0, 1); for (let i = 0; i < 4; i++) this._noise(0.05, 0.15, 'bandpass', 1500, 0, 0.1 + i * 0.12, 4); break;
        case 'fall': this._tone(700, 0.7, 'sine', 0.12, 0.2); this._noise(0.6, 0.12, 'bandpass', 800, 200, 0, 1); break;
        default: break;
      }
    } catch (e) { /* ignore */ }
  }

  playMusic(track) {
    if (this.track === track && this.musicTimer) return;
    this.track = track;
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!this.ctx || !this.settings.music || !track) return;
    const songs = {
      dungeon: { bpm: 66, wave: 'triangle', vol: 0.09, lead: [57, -1, 60, -1, 64, -1, 62, 60, 57, -1, -1, -1, 55, -1, 57, -1, 60, -1, 59, -1, 57, -1, -1, -1, 52, -1, 55, 57, 60, -1, 64, 62], bass: [33, 33, 29, 29, 31, 31, 28, 28] },
      boss: { bpm: 132, wave: 'sawtooth', vol: 0.04, lead: [57, 57, 60, 57, 63, 57, 62, 60, 57, 57, 60, 57, 64, 63, 62, 60], bass: [33, 33, 33, 33, 34, 34, 31, 31], drum: true },
      title: { bpm: 58, wave: 'sine', vol: 0.12, lead: [69, -1, 72, -1, 76, -1, 74, -1, 72, -1, 71, -1, 69, -1, -1, -1, 67, -1, 69, -1, 72, -1, 71, -1, 64, -1, -1, -1, -1, -1, -1, -1], bass: [45, 45, 41, 41, 43, 43, 40, 40] },
    };
    const s = songs[track];
    if (!s) return;
    const step = 60 / s.bpm / 2;
    let i = 0;
    let next = this.ctx.currentTime + 0.1;
    const sched = () => {
      if (!this.ctx) return;
      if (next < this.ctx.currentTime) next = this.ctx.currentTime + 0.05;
      while (next < this.ctx.currentTime + 0.4) {
        const d = next - this.ctx.currentTime;
        const n = s.lead[i % s.lead.length];
        if (n > 0) this._tone(NOTE(n), step * 2.5, s.wave, s.vol, 0, d, this.mus);
        if (i % 4 === 0) {
          const b = s.bass[(i / 4) % s.bass.length];
          this._tone(NOTE(b), step * 4.2, 'sine', 0.18, 0, d, this.mus);
          this._tone(NOTE(b + 7), step * 4.2, 'sine', 0.05, 0, d, this.mus);
        }
        if (s.drum && i % 2 === 0) this._kick(next, i % 8 === 4);
        if (!s.drum && i % 16 === 7 && Math.random() < 0.5) this._tone(NOTE(96 + Math.floor(Math.random() * 5)), 0.2, 'sine', 0.03, 0.9, d, this.mus);
        next += step;
        i++;
      }
    };
    this.musicTimer = setInterval(sched, 120);
  }
  _kick(t, snare) {
    const c = this.ctx;
    if (snare) {
      const s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
      const g = c.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      s.connect(f); f.connect(g); g.connect(this.mus); s.start(t); s.stop(t + 0.2);
      return;
    }
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25);
  }
}
