import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { drawFx, FxName } from './Sprites';
import { WORLD_ENV } from './Env';

/**
 *  blood  droplet, drawn as a streak along its velocity, splats on any solid
 *  drip   blood running down a wall / hanging from a ceiling
 *  gib    chunk of flesh (death), bleeds while flying
 *  smoke  soft sprite, normal blending
 *  dirt   debris
 *  spark  glowing ember, stretched along its velocity (additive)
 *  fire   flame sprite, white → yellow → orange → red as it ages (additive)
 *  glow   soft halo that fades (additive)
 *  flash  short, growing burst (additive)
 *  ring   expanding shockwave (additive)
 */
export type ParticleType = 'blood' | 'drip' | 'gib' | 'smoke' | 'dirt' | 'spark' | 'fire' | 'glow' | 'flash' | 'ring';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: ParticleType;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  rot: number;
  vr: number;
  /** Sprite override (otherwise chosen by type) */
  sprite: FxName | null;
  /** drip: side of the wall (-1 / 1), 0 = ceiling */
  side: number;
}

const ADDITIVE = new Set<ParticleType>(['spark', 'fire', 'glow', 'flash', 'ring']);
const BLOOD_COLORS = ['#a30d0d', '#7a0808', '#c41818'];
const FIRE_COLORS = ['#fff4c2', '#ffd447', '#ff9a1f', '#ff5a14', '#b8240a'];
const SMOKE_SPRITES: FxName[] = ['smoke_01', 'smoke_04', 'smoke_07'];
const FLAME_SPRITES: FxName[] = ['flame_01', 'flame_02', 'fire_01'];
const GIB_SPRITES: FxName[] = ['dirt_01', 'dirt_02', 'dirt_03'];
const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

export class ParticleManager {
  public particles: Particle[] = [];
  private maxParticles = 900;
  /** Particles spawned during update() (gibs bleeding, drips) are added after the pass */
  private updating = false;
  private pending: Particle[] = [];

  public spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: ParticleType,
    color?: string,
    size: number = 2,
    life: number = 60
  ): Particle {
    if (!this.updating && this.particles.length >= this.maxParticles) {
      // Drop the oldest cosmetic particle, keep blood in flight (it leaves stains)
      const i = this.particles.findIndex(p => p.type !== 'blood' && p.type !== 'drip');
      this.particles.splice(i >= 0 ? i : 0, 1);
    }

    let c = color;
    let sprite: FxName | null = null;
    switch (type) {
      case 'blood':
      case 'drip':
        c ??= pick(BLOOD_COLORS);
        break;
      case 'gib':
        c ??= '#6e0b0b';
        sprite = pick(GIB_SPRITES);
        break;
      case 'dirt':
        c ??= Math.random() > 0.5 ? CONFIG.COLORS.DIRT_BASE : CONFIG.COLORS.DIRT_DARK;
        break;
      case 'smoke':
        c ??= '#6b6468';
        sprite = pick(SMOKE_SPRITES);
        break;
      case 'spark':
        c ??= Math.random() > 0.5 ? '#ffcc33' : '#ff6a1a';
        break;
      case 'fire':
        sprite = pick(FLAME_SPRITES);
        break;
      case 'flash':
        sprite = 'scorch_01';
        break;
      case 'ring':
        sprite = 'circle_02';
        break;
    }

    const p: Particle = {
      x, y, vx, vy, type,
      color: c ?? '#ffffff',
      size,
      life,
      maxLife: life,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.08,
      sprite,
      side: 0
    };
    (this.updating ? this.pending : this.particles).push(p);
    return p;
  }

  /**
   * Blood spray. (dx, dy) is the direction of the hit: most droplets fly that way in a cone,
   * a few splash back. Without a direction, droplets burst upwards.
   */
  public spawnBloodBurst(x: number, y: number, count: number = 16, dx = 0, dy = 0, force: number = 3) {
    const len = Math.hypot(dx, dy);
    const dir = len > 0.01 ? Math.atan2(dy, dx) : -Math.PI / 2;
    const cone = len > 0.01 ? 0.55 : 1.3;
    for (let i = 0; i < count; i++) {
      const back = len > 0.01 && Math.random() < 0.18;
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * cone * 1.4;
      const a = dir + (back ? Math.PI : 0) + g;
      const speed = (0.35 + Math.random() * 0.85) * force * (back ? 0.5 : 1);
      this.spawn(
        x + (Math.random() - 0.5) * 3,
        y + (Math.random() - 0.5) * 4,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 0.6,
        'blood',
        undefined,
        0.5 + Math.random() * Math.random() * 1.6,
        70 + Math.floor(Math.random() * 60)
      );
    }
  }

  /** Death: a big spray, chunks and a pool around the body. */
  public spawnGibs(x: number, y: number, count: number = 5) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 1.5 + Math.random() * 2.5;
      this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 1, 'gib', undefined, 2 + Math.random() * 1.6,
        90 + Math.floor(Math.random() * 50));
    }
    this.spawnBloodBurst(x, y, 34, 0, 0, 4);
    this.spawnBloodBurst(x, y + 3, 14, 0, 1, 1.2);
  }

  /** Spell impact. `fiery` = fire spell (flames instead of a coloured burst). */
  public spawnExplosionFX(x: number, y: number, radius: number = 20, color = '#ffaa33', fiery = false) {
    const r = radius;
    // Flash and shockwave
    this.spawn(x, y, 0, 0, 'flash', fiery ? '#ffb347' : color, r * 2.4, 11).sprite = fiery ? 'scorch_02' : 'scorch_01';
    this.spawn(x, y, 0, 0, 'glow', fiery ? '#ff8a2a' : color, r * 3.2, 16);
    this.spawn(x, y, 0, 0, 'ring', fiery ? '#ffd27a' : color, r * 1.1, 14);
    if (!fiery) this.spawn(x, y, 0, 0, 'flash', '#ffffff', r * 1.2, 7).sprite = 'star_09';

    // Flames / coloured embers
    const flames = Math.floor(r * (fiery ? 0.7 : 0.35));
    for (let i = 0; i < flames; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * r * 0.07;
      this.spawn(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, Math.cos(a) * sp, Math.sin(a) * sp - 0.3,
        'fire', fiery ? undefined : color, r * (0.35 + Math.random() * 0.4), 18 + Math.floor(Math.random() * 16));
    }

    // Sparks
    const sparks = Math.floor(r * 0.9);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * r * 0.2;
      this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 0.8, 'spark',
        Math.random() < 0.3 ? '#ffffff' : color, 0.8 + Math.random() * 1.2, 20 + Math.floor(Math.random() * 30));
    }

    // Debris
    const debris = Math.floor(r * 0.6);
    for (let i = 0; i < debris; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * r * 0.16;
      this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 1.5, 'dirt', undefined,
        0.8 + Math.random() * 1.4, 45 + Math.floor(Math.random() * 45));
    }

    // Smoke
    const smoke = Math.floor(r * 0.35);
    for (let i = 0; i < smoke; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.2 + Math.random() * r * 0.05;
      this.spawn(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, Math.cos(a) * speed, Math.sin(a) * speed - 0.25,
        'smoke', fiery ? '#3b3330' : undefined, r * (0.5 + Math.random() * 0.5), 50 + Math.floor(Math.random() * 40));
    }
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  public update(terrain: Terrain) {
    const G = CONFIG.GRAVITY;
    const list = this.particles;
    this.updating = true;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (--p.life > 0 && this.step(p, terrain, G)) list[n++] = p;
    }
    list.length = n;
    this.updating = false;
    for (const p of this.pending) if (list.length < this.maxParticles) list.push(p);
    this.pending.length = 0;
  }

  /** Moves one particle; returns false when it is gone. */
  private step(p: Particle, terrain: Terrain, g: number): boolean {
    p.rot += p.vr;
    // Gravity anomalies flip everything inside; the storm blows the light stuff away
    const G = g * WORLD_ENV.gravityAt(p.x, p.y);
    if (WORLD_ENV.wind !== 0) p.vx += WORLD_ENV.wind * (p.type === 'smoke' || p.type === 'fire' ? 0.8 : 0.3);
    switch (p.type) {
      case 'blood':
        return this.stepBlood(p, terrain, G);
      case 'drip':
        return this.stepDrip(p, terrain);
      case 'gib':
        p.vy += G;
        p.vx *= 0.99;
        if (p.life % 3 === 0) this.spawn(p.x, p.y, p.vx * 0.3, p.vy * 0.3, 'blood', undefined, 0.7, 40);
        break;
      case 'dirt':
        p.vy += G * 1.1;
        p.vx *= 0.98;
        break;
      case 'smoke':
        p.vy -= 0.012;
        p.vx *= 0.96;
        p.vy *= 0.97;
        p.size += 0.12;
        p.x += p.vx;
        p.y += p.vy;
        return true;
      case 'fire':
        p.vy -= 0.035;
        p.vx *= 0.95;
        p.size *= 1.01;
        p.x += p.vx;
        p.y += p.vy;
        return !terrain.fluidAt(p.x, p.y) || terrain.fluidAt(p.x, p.y) === CONFIG.MAT_LAVA;
      case 'spark':
        p.vy += G * 0.5;
        p.vx *= 0.97;
        break;
      case 'glow':
      case 'flash':
      case 'ring':
        p.x += p.vx;
        p.y += p.vy;
        return true;
    }

    const nx = p.x + p.vx;
    const ny = p.y + p.vy;
    if (terrain.isSolid(nx, ny)) {
      if (p.type === 'gib') terrain.addBlood(nx, ny, 1.6, p.vx, p.vy);
      if (p.type === 'spark') return false;
      // Bounce (debris, chunks)
      if (terrain.isSolid(nx, p.y)) p.vx *= -0.35; else p.x = nx;
      if (terrain.isSolid(p.x, ny)) p.vy *= -0.3; else p.y = ny;
      p.vx *= 0.8;
      p.vr *= 0.5;
      p.life -= 8;
    } else {
      p.x = nx;
      p.y = ny;
    }
    return true;
  }

  private stepBlood(p: Particle, terrain: Terrain, G: number): boolean {
    p.vy += G;
    p.vx *= 0.99;
    // Sub-steps so fast droplets don't tunnel through thin walls
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) / 2));
    for (let s = 0; s < steps; s++) {
      const nx = p.x + p.vx / steps;
      const ny = p.y + p.vy / steps;
      if (terrain.isSolid(nx, ny)) {
        terrain.addBlood(nx, ny, p.size, p.vx, p.vy);
        // Big drops on walls and ceilings run down / drip
        if (p.size > 0.9 && Math.random() < 0.45) {
          const side = terrain.isSolid(p.x + 1.5, p.y) ? 1 : terrain.isSolid(p.x - 1.5, p.y) ? -1 : 0;
          const ceiling = side === 0 && terrain.isSolid(p.x, p.y - 1.5);
          if (side !== 0 || ceiling) {
            const d = this.spawn(p.x, p.y, 0, side !== 0 ? 0.12 + Math.random() * 0.12 : 0, 'drip', p.color,
              0.6 + Math.random() * 0.3, side !== 0 ? 60 + Math.floor(Math.random() * 90) : 40 + Math.floor(Math.random() * 60));
            d.side = side;
          }
        }
        return false;
      }
      if (terrain.fluidAt(nx, ny)) {
        // Diluted in water, burnt in lava
        p.vx *= 0.6;
        p.vy *= 0.6;
        p.life -= 6;
      }
      p.x = nx;
      p.y = ny;
    }
    return true;
  }

  private stepDrip(p: Particle, terrain: Terrain): boolean {
    if (p.side === 0) {
      // Hanging from a ceiling: grows, then falls as a droplet
      p.size += 0.006;
      if (p.life < 3 || !terrain.isSolid(p.x, p.y - 1.5)) {
        p.type = 'blood';
        p.vx = 0;
        p.vy = 0.3;
        p.life = 80;
      }
      return true;
    }
    p.y += p.vy;
    p.vy *= 0.995;
    const wx = p.x + p.side;
    if (!terrain.isSolid(wx, p.y)) {
      // Ran off the end of the wall: falls
      p.type = 'blood';
      p.vx = 0;
      p.vy = 0.4;
      p.life = 80;
      return true;
    }
    if (terrain.isSolid(p.x, p.y + 1)) {
      terrain.addBlood(p.x, p.y + 1, p.size, 0, 0.5);
      return false;
    }
    if ((p.life & 1) === 0) terrain.addBlood(wx, p.y, 0.45, 0, 0.6);
    return true;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  public draw(ctx: CanvasRenderingContext2D) {
    if (this.particles.length === 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;

    // 1. Normal blending: smoke, debris, chunks
    for (const p of this.particles) {
      const fade = Math.min(1, p.life / (p.maxLife * 0.4));
      if (p.type === 'smoke') {
        const t = 1 - p.life / p.maxLife;
        drawFx(ctx, p.sprite!, p.x, p.y, p.size, p.color, Math.min(1, t * 4) * fade * 0.4, p.rot);
      } else if (p.type === 'gib') {
        drawFx(ctx, p.sprite!, p.x, p.y, p.size * 2.4, p.color, fade, p.rot);
      } else if (p.type === 'dirt') {
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;

    // 2. Blood: streaks along the velocity, batched by colour and thickness
    ctx.lineCap = 'round';
    for (let ci = 0; ci < BLOOD_COLORS.length; ci++) {
      for (const thick of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (const p of this.particles) {
          if ((p.type !== 'blood' && p.type !== 'drip') || p.color !== BLOOD_COLORS[ci] || (p.size > 1.05) !== thick) continue;
          const sp = Math.hypot(p.vx, p.vy);
          const k = sp > 0.01 ? Math.min(0.8, 2.2 / sp) : 0;
          ctx.moveTo(p.x - p.vx * k, p.y - p.vy * k);
          ctx.lineTo(p.x + 0.01, p.y + 0.01);
          any = true;
        }
        if (!any) continue;
        ctx.strokeStyle = BLOOD_COLORS[ci];
        ctx.lineWidth = thick ? 1.15 : 0.7;
        ctx.stroke();
      }
    }

    // 3. Additive glows
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (!ADDITIVE.has(p.type)) continue;
      const t = 1 - p.life / p.maxLife; // 0 → 1
      const fade = Math.min(1, p.life / (p.maxLife * 0.4));
      switch (p.type) {
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy);
          drawFx(ctx, p.sprite ?? 'circle_05', p.x, p.y, p.size * 3, p.color, fade, Math.atan2(p.vy, p.vx), 1 + Math.min(2.5, sp * 0.8));
          break;
        }
        case 'fire': {
          const color = p.color !== '#ffffff' ? p.color : FIRE_COLORS[Math.min(FIRE_COLORS.length - 1, Math.floor(t * FIRE_COLORS.length))];
          drawFx(ctx, p.sprite!, p.x, p.y, p.size, color, fade * 0.9, p.rot);
          break;
        }
        case 'glow':
          drawFx(ctx, p.sprite ?? 'circle_05', p.x, p.y, p.size, p.color, (1 - t) * 0.55);
          break;
        case 'flash':
          drawFx(ctx, p.sprite!, p.x, p.y, p.size * (0.6 + t * 0.6), p.color, (1 - t) * (1 - t), p.rot);
          break;
        case 'ring':
          drawFx(ctx, p.sprite!, p.x, p.y, p.size * (1 + t * 2.2), p.color, (1 - t) * (1 - t) * 0.6);
          break;
      }
    }
    ctx.restore();
  }

  public clear() {
    this.particles = [];
  }
}
