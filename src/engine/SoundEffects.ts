export class SoundEffects {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public enabled: boolean = SoundEffects.loadEnabled();
  public volume: number = 0.5;
  private spellBuffers: (AudioBuffer | null)[] = [null, null, null, null, null];
  private isPreloading: boolean = false;

  private static loadEnabled(): boolean {
    try {
      return localStorage.getItem('arcane_worms_muted') !== '1';
    } catch {
      return true;
    }
  }

  public toggleMuted(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('arcane_worms_muted', this.enabled ? '0' : '1');
    } catch {
      // storage unavailable — keep the in-memory value
    }
    return this.enabled;
  }

  private initCtx() {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.generateNoiseBuffer();
      this.preloadSpellSounds();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private preloadSpellSounds() {
    if (this.isPreloading || !this.ctx) return;
    this.isPreloading = true;
    const base = import.meta.env.BASE_URL;
    for (let i = 1; i <= 5; i++) {
      const idx = i - 1;
      const url = `${base}assets/audio/spell${i}.ogg`;
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then(ab => this.ctx?.decodeAudioData(ab))
        .then(buf => {
          if (buf) this.spellBuffers[idx] = buf;
        })
        .catch(() => {
          // Fallback gracefully if network/offline
        });
    }
  }

  private generateNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  public playBazooka() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);

    gain.gain.setValueAtTime(0.4 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  public playExplosion(radius: number = 18) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx || !this.noiseBuffer) return;

    const t = this.ctx.currentTime;
    const duration = Math.min(1.2, 0.3 + (radius / 25) * 0.7);

    // Noise layer (crunch & crackle)
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + duration);

    const gain = this.ctx.createGain();
    const vol = Math.min(1.0, 0.4 + (radius / 30) * 0.5) * this.volume;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
    noise.stop(t + duration);

    // Sub-bass layer (thump)
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + duration * 0.7);

    oscGain.gain.setValueAtTime(vol * 0.8, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + duration * 0.7);

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + duration * 0.7);
  }

  public playGrenadeBounce() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600 + Math.random() * 200, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.07);

    gain.gain.setValueAtTime(0.25 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playRopeShoot() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);

    gain.gain.setValueAtTime(0.25 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playRopeLatch() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(950, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);

    gain.gain.setValueAtTime(0.3 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playHurt() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);

    gain.gain.setValueAtTime(0.35 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playDie() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.5);

    gain.gain.setValueAtTime(0.5 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.5);
    this.playExplosion(15);
  }

  public playHoming() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.15);
    gain.gain.setValueAtTime(0.3 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  public playRailgun() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);
    gain.gain.setValueAtTime(0.45 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  public playBouncy() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(480, t + 0.08);
    gain.gain.setValueAtTime(0.25 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playDart() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1100, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
    gain.gain.setValueAtTime(0.2 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playVortex() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(320, t + 0.3);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    gain.gain.setValueAtTime(0.35 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  public playSpellSample(index: number = 0, volMultiplier: number = 1.0) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const buf = this.spellBuffers[index % 5];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.55 * this.volume * volMultiplier, this.ctx.currentTime);
      src.connect(gain);
      gain.connect(this.ctx.destination);
      src.start();
    }
  }

  // ── Small synth helpers for the funny spells ─────────────────────────────

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, vibrato = 0) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato > 0) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 22;
      depth.gain.value = vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol * this.volume, t + Math.min(0.03, dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noise(filter: BiquadFilterType, f0: number, f1: number, dur: number, vol: number, q = 1) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  /** Métamorphose: « bêêê » (vibrato on a nasal saw) */
  public playBleat() {
    this.tone('sawtooth', 520, 470, 0.55, 0.16, 0, 28);
    this.tone('square', 1040, 900, 0.5, 0.04, 0, 40);
  }

  /** Crapauds: « croâ » */
  public playCroak() {
    this.tone('square', 170, 110, 0.12, 0.12);
    this.tone('square', 150, 95, 0.1, 0.1, 0.13);
  }

  /** Mains Foudroyantes: short electric crackle */
  public playCrackle() {
    this.noise('highpass', 2500 + Math.random() * 2000, 1200, 0.09, 0.22, 0.7);
    this.tone('sawtooth', 90 + Math.random() * 40, 60, 0.08, 0.05);
  }

  /** Philtre d'Ivresse: « hic ! » */
  public playHiccup() {
    this.tone('triangle', 400, 900, 0.08, 0.2);
    this.tone('triangle', 380, 850, 0.08, 0.16, 0.45);
  }

  /** Bulle Farceuse: bubbly rising blips */
  public playBubble() {
    for (let i = 0; i < 4; i++) this.tone('sine', 300 + i * 120, 700 + i * 160, 0.09, 0.13, i * 0.07);
  }

  public playPop() {
    this.tone('sine', 900, 120, 0.07, 0.3);
    this.noise('bandpass', 2000, 800, 0.05, 0.25, 2);
  }

  /** Fiole Pestilentielle: glass, then a long hiss of gas */
  public playGas() {
    this.tone('triangle', 2400, 1800, 0.08, 0.12);
    this.noise('bandpass', 3000, 900, 1.4, 0.18, 0.8);
  }

  public playSpellForWeapon(weaponId: string) {
    if (!this.enabled) return;
    this.initCtx();

    switch (weaponId) {
      case 'bazooka':
      case 'flamer':
      case 'meteor':
        this.playSpellSample(0, 1.1);
        this.playBazooka();
        break;
      case 'railgun':
        this.playSpellSample(3, 1.2);
        this.playRailgun();
        break;
      case 'freeze_bomb':
      case 'leech':
      case 'shield':
        this.playSpellSample(2, 1.0);
        this.playDart();
        break;
      case 'vortex':
      case 'teleport':
      case 'swap':
      case 'portal':
      case 'antigravity':
        this.playSpellSample(4, 1.1);
        this.playVortex();
        break;
      case 'homing_missile':
        this.playSpellSample(4, 1.1);
        this.playHoming();
        break;
      case 'tornado':
        this.noise('bandpass', 400, 1600, 0.9, 0.3, 0.6);
        break;
      case 'boomerang':
      case 'bubble':
      case 'hot_potato':
      case 'decoy':
        this.playSpellSample(1, 0.9);
        this.playBouncy();
        break;
      case 'frogs':
        this.playCroak();
        break;
      case 'polymorph':
      case 'drunk':
        this.playSpellSample(2, 0.9);
        this.playBouncy();
        break;
      default: // chiquita, mine, toxic_cloud, earth_wall
        this.playSpellSample(4, 1.0);
        this.playGrenadeBounce();
    }
  }
}

export const sound = new SoundEffects();
