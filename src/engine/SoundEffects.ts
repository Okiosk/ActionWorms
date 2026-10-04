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

  public playShotgun() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx || !this.noiseBuffer) return;

    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    filter.Q.value = 2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.7 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
    noise.stop(t + 0.25);
  }

  public playMinigun() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx || !this.noiseBuffer) return;

    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
    noise.stop(t + 0.05);
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

  public playSpellForWeapon(weaponId: string) {
    if (!this.enabled) return;
    this.initCtx();

    // Fire / Meteor / Dragon
    if (weaponId === 'bazooka' || weaponId === 'mortar' || weaponId === 'flamer') {
      this.playSpellSample(0, 1.1);
      this.playBazooka();
    }
    // Arcane / Spark / Minigun / Shotgun
    else if (weaponId === 'minigun' || weaponId === 'shotgun') {
      this.playSpellSample(1, 0.9);
      if (weaponId === 'minigun') this.playMinigun();
      else this.playShotgun();
    }
    // Astral / Divine / Railgun / Gauss / Sniper / Laser
    else if (weaponId === 'gauss' || weaponId === 'railgun' || weaponId === 'sniper' || weaponId === 'laser') {
      this.playSpellSample(3, 1.2);
      this.playRailgun();
    }
    // Frost / Dart
    else if (weaponId === 'freeze_bomb' || weaponId === 'dart_gun') {
      this.playSpellSample(2, 1.0);
      this.playDart();
    }
    // Void / Wisp / Chaos / Acid / Grenade / Mine / Boomerang / Bouncy
    else if (weaponId === 'vortex' || weaponId === 'homing_missile' || weaponId === 'mine') {
      this.playSpellSample(4, 1.1);
      if (weaponId === 'vortex') this.playVortex();
      else if (weaponId === 'homing_missile') this.playHoming();
      else this.playGrenadeBounce();
    }
    else if (weaponId === 'acid_bomb') {
      this.playSpellSample(4, 1.0);
      this.playGrenadeBounce();
    }
    else if (weaponId === 'bouncy_ball' || weaponId === 'boomerang') {
      this.playSpellSample(1, 0.9);
      this.playBouncy();
    }
    else {
      this.playSpellSample(1, 0.8);
      this.playGrenadeBounce();
    }
  }
}

export const sound = new SoundEffects();
