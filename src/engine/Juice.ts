/**
 * Game feel ("juice"): camera shake & kick, floating numbers, screen flashes.
 * Purely visual and local to each player — nothing here touches the simulation.
 */

function loadShakePref(): boolean {
  try {
    return localStorage.getItem('arcane_worms_shake') !== '0';
  } catch {
    return true;
  }
}

/** Camera: trauma-based shake (smooth noise, not jitter), recoil kick and aim look-ahead */
export class CameraFx {
  public shakeEnabled = loadShakePref();
  private trauma = 0;
  private kickX = 0;
  private kickY = 0;
  private seed = Math.random() * 100;

  public setShake(on: boolean) {
    this.shakeEnabled = on;
    try {
      localStorage.setItem('arcane_worms_shake', on ? '1' : '0');
    } catch {
      // storage unavailable
    }
  }

  /** 0…1, adds up (big explosions next to you ≈ 0.6) */
  public addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Recoil: pushes the camera by (dx, dy) world pixels, springs back quickly */
  public kick(dx: number, dy: number) {
    this.kickX += dx;
    this.kickY += dy;
  }

  public reset() {
    this.trauma = 0;
    this.kickX = this.kickY = 0;
  }

  /** Offset to add to the camera this frame (world pixels) */
  public offset(now: number, dt: number): { x: number; y: number } {
    this.trauma = Math.max(0, this.trauma - dt * 0.0016);
    const k = Math.exp(-dt / 90);
    this.kickX *= k;
    this.kickY *= k;
    if (!this.shakeEnabled) return { x: 0, y: 0 };
    const t = now * 0.001;
    const s = this.trauma * this.trauma * 7;
    const n = (f: number, p: number) => Math.sin(t * f + this.seed + p) * 0.6 + Math.sin(t * f * 2.3 + p * 1.7) * 0.4;
    return { x: this.kickX + s * n(31, 0), y: this.kickY + s * n(37, 4.2) };
  }
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  born: number;
  life: number;
}

/** Damage numbers, "+75 or", "K.O. !" … popping out of the world */
export class FloatingTexts {
  private items: FloatText[] = [];

  public add(x: number, y: number, text: string, color: string, size = 7, life = 900) {
    if (this.items.length > 60) this.items.shift();
    this.items.push({ x: x + (Math.random() - 0.5) * 6, y, vy: -0.035, text, color, size, born: performance.now(), life });
  }

  public clear() {
    this.items = [];
  }

  public draw(ctx: CanvasRenderingContext2D, now: number) {
    if (this.items.length === 0) return;
    this.items = this.items.filter(i => now - i.born < i.life);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const i of this.items) {
      const t = now - i.born;
      const u = t / i.life;
      // Pop: overshoots then settles; rises and fades at the end
      const pop = t < 90 ? 0.6 + (t / 90) * 1.0 : t < 180 ? 1.6 - ((t - 90) / 90) * 0.6 : 1;
      const y = i.y + i.vy * t - Math.min(t, 150) * 0.02;
      ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      ctx.font = `800 ${(i.size * pop).toFixed(2)}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1.2, i.size * 0.28);
      ctx.strokeStyle = 'rgba(10, 6, 4, 0.9)';
      ctx.strokeText(i.text, i.x, y);
      ctx.fillStyle = i.color;
      ctx.fillText(i.text, i.x, y);
    }
    ctx.restore();
  }
}

/** Full-screen flash (big explosions close to you) */
export class ScreenFlash {
  private amount = 0;
  private color = '255, 200, 140';

  public flash(amount: number, rgb = '255, 200, 140') {
    if (amount > this.amount) {
      this.amount = Math.min(0.45, amount);
      this.color = rgb;
    }
  }

  public draw(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number) {
    if (this.amount <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${this.color}, ${this.amount})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    this.amount *= Math.exp(-dt / 70);
  }
}

/** Damage colour: white for scratches, yellow, orange, red for big hits */
export function damageColor(dmg: number): string {
  return dmg >= 45 ? '#ff4a3d' : dmg >= 25 ? '#ff9a2e' : dmg >= 10 ? '#ffe066' : '#ffffff';
}

export function hexToRgbString(hex: string): string {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`;
}
