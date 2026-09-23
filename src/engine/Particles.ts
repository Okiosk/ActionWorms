import { CONFIG } from '../config';
import { Terrain } from './Terrain';

export type ParticleType = 'blood' | 'smoke' | 'spark' | 'dirt' | 'gib' | 'fire';

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
  stainsTerrain: boolean;
}

export class ParticleManager {
  public particles: Particle[] = [];
  private maxParticles = 600;

  public spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: ParticleType,
    color?: string,
    size: number = 2,
    life: number = 60,
    stainsTerrain: boolean = false
  ) {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift(); // discard oldest
    }

    let defaultColor = '#ffffff';
    if (type === 'blood') {
      defaultColor = Math.random() > 0.4 ? CONFIG.COLORS.BLOOD_FRESH : CONFIG.COLORS.BLOOD_DARK;
    } else if (type === 'dirt') {
      defaultColor = Math.random() > 0.5 ? CONFIG.COLORS.DIRT_BASE : CONFIG.COLORS.DIRT_DARK;
    } else if (type === 'smoke') {
      defaultColor = `rgba(140, 140, 140, ${0.4 + Math.random() * 0.3})`;
    } else if (type === 'spark') {
      defaultColor = Math.random() > 0.5 ? '#ffcc00' : '#ff5500';
    } else if (type === 'gib') {
      defaultColor = '#881111';
    } else if (type === 'fire') {
      defaultColor = Math.random() > 0.5 ? '#ff8800' : '#ff3300';
    }

    this.particles.push({
      x,
      y,
      vx,
      vy,
      type,
      color: color || defaultColor,
      size,
      life,
      maxLife: life,
      stainsTerrain
    });
  }

  public spawnBloodBurst(x: number, y: number, count: number = 16, force: number = 3.5) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 0.9) * force;
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 1.0,
        'blood',
        undefined,
        1.5 + Math.random() * 1.5,
        40 + Math.floor(Math.random() * 60),
        true // blood stains terrain!
      );
    }
  }

  public spawnExplosionFX(x: number, y: number, radius: number = 20) {
    const sparkCount = Math.floor(radius * 1.2);
    const smokeCount = Math.floor(radius * 0.8);
    const dirtCount = Math.floor(radius * 1.0);

    // Sparks
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * (radius * 0.28);
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        'spark',
        undefined,
        1.5 + Math.random() * 2,
        20 + Math.floor(Math.random() * 30)
      );
    }

    // Dirt debris
    for (let i = 0; i < dirtCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * (radius * 0.22);
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 1.5,
        'dirt',
        undefined,
        2 + Math.random() * 2.5,
        45 + Math.floor(Math.random() * 45)
      );
    }

    // Smoke clouds
    for (let i = 0; i < smokeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.3 + Math.random() * (radius * 0.12);
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 0.5,
        'smoke',
        undefined,
        3 + Math.random() * (radius * 0.25),
        40 + Math.floor(Math.random() * 35)
      );
    }
  }

  public spawnGibs(x: number, y: number, count: number = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 4.0;
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 2.0,
        'gib',
        undefined,
        3 + Math.random() * 2,
        90 + Math.floor(Math.random() * 60),
        true
      );
    }
    this.spawnBloodBurst(x, y, 30, 5.0);
  }

  public update(terrain: Terrain) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Physics
      if (p.type === 'blood' || p.type === 'dirt' || p.type === 'gib') {
        p.vy += CONFIG.GRAVITY * 1.1;
        p.vx *= 0.98;
      } else if (p.type === 'smoke') {
        p.vy -= 0.02; // slight buoyancy
        p.vx *= 0.95;
        p.size += 0.08; // expand
      } else if (p.type === 'fire') {
        p.vy -= 0.04;
        p.vx *= 0.96;
      } else if (p.type === 'spark') {
        p.vy += CONFIG.GRAVITY * 0.6;
        p.vx *= 0.96;
      }

      const nextX = p.x + p.vx;
      const nextY = p.y + p.vy;

      // Collision with terrain
      if (terrain.isSolid(nextX, nextY)) {
        if (p.stainsTerrain) {
          terrain.addBlood(nextX, nextY, p.size);
          this.particles.splice(i, 1);
          continue;
        }

        // Bouncing for gibs & debris
        if (p.type === 'gib' || p.type === 'dirt') {
          p.vx *= -0.3;
          p.vy *= -0.3;
          p.life -= 15;
        } else {
          this.particles.splice(i, 1);
          continue;
        }
      } else {
        p.x = nextX;
        p.y = nextY;
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const alpha = Math.min(1.0, p.life / (p.maxLife * 0.4));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.type === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spark' || p.type === 'fire') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  public clear() {
    this.particles = [];
  }
}
