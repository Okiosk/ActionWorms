import { CONFIG } from '../config';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { Terrain } from './Terrain';
import { ParticleManager } from './Particles';
import { sound } from './SoundEffects';

export interface ProjectileParams {
  id: number;
  ownerId: string;
  weapon: WeaponDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse?: number;
  isSubCluster?: boolean;
}

export class Projectile {
  public id: number;
  public ownerId: string;
  public weapon: WeaponDef;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public bouncesLeft: number;
  public fuse: number;
  public alive: boolean = true;
  public isSubCluster: boolean;
  public armed: boolean = false;
  public armTimer: number = 20;

  constructor(params: ProjectileParams) {
    this.id = params.id;
    this.ownerId = params.ownerId;
    this.weapon = params.weapon;
    this.x = params.x;
    this.y = params.y;
    this.vx = params.vx;
    this.vy = params.vy;
    this.bouncesLeft = params.weapon.bounces;
    this.fuse = params.fuse !== undefined ? params.fuse : params.weapon.fuseFrames;
    this.isSubCluster = !!params.isSubCluster;
  }

  public update(
    terrain: Terrain,
    particles: ParticleManager,
    worms: { id: string; x: number; y: number; radius: number; takeDamage: (dmg: number, kx: number, ky: number, attackerId: string) => void; isAlive: () => boolean }[],
    onDetonate: (proj: Projectile) => void
  ) {
    if (!this.alive) return;

    if (this.armTimer > 0) {
      this.armTimer--;
      if (this.armTimer === 0) this.armed = true;
    }

    // Fuse countdown
    if (this.fuse > 0) {
      this.fuse--;
      if (this.fuse <= 0) {
        this.detonate(terrain, particles, worms, onDetonate);
        return;
      }
    }

    // Gravity
    this.vy += CONFIG.GRAVITY * this.weapon.gravityScale;

    // Tail particle FX
    if (this.weapon.id === 'bazooka') {
      particles.spawn(this.x, this.y, -this.vx * 0.2, -this.vy * 0.2, 'smoke', undefined, 2.5, 30);
    } else if (this.weapon.id === 'flamer') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 'fire', undefined, 3, 25);
    }

    // Proximity mine trigger
    if (this.weapon.id === 'mine' && this.armed) {
      for (const w of worms) {
        if (w.isAlive() && Math.hypot(w.x - this.x, w.y - this.y) < 26) {
          this.detonate(terrain, particles, worms, onDetonate);
          return;
        }
      }
    }

    // Sub-stepping for collision detection
    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil(speed / 3));
    const stepX = this.vx / steps;
    const stepY = this.vy / steps;

    for (let s = 0; s < steps; s++) {
      const nextX = this.x + stepX;
      const nextY = this.y + stepY;

      // Check collision with worms
      for (const w of worms) {
        if (!w.isAlive()) continue;
        // Don't collide with self immediately on launch
        if (w.id === this.ownerId && !this.armed && this.weapon.id !== 'mine') continue;

        if (Math.hypot(w.x - nextX, w.y - nextY) <= w.radius + 2) {
          // Direct hit!
          this.x = nextX;
          this.y = nextY;
          this.detonate(terrain, particles, worms, onDetonate);
          return;
        }
      }

      // Check collision with terrain
      if (terrain.isSolid(nextX, nextY)) {
        // Piercing laser / Gauss gun behavior
        if (this.weapon.piercing) {
          terrain.carveCircle(nextX, nextY, this.weapon.craterRadius);
          this.x = nextX;
          this.y = nextY;
          continue;
        }

        // Bouncing logic (grenades, cluster bombs, mines)
        if (this.bouncesLeft > 0) {
          this.bouncesLeft--;
          sound.playGrenadeBounce();

          // Reflect velocity against surface normal
          const normal = this.findNormal(terrain, this.x, this.y);
          const dot = this.vx * normal.nx + this.vy * normal.ny;
          this.vx = (this.vx - 2 * dot * normal.nx) * 0.58;
          this.vy = (this.vy - 2 * dot * normal.ny) * 0.58;
          break;
        } else {
          // Explode on terrain contact
          this.x = nextX;
          this.y = nextY;
          this.detonate(terrain, particles, worms, onDetonate);
          return;
        }
      }

      this.x = nextX;
      this.y = nextY;
    }
  }

  private findNormal(terrain: Terrain, x: number, y: number): { nx: number; ny: number } {
    let nx = 0;
    let ny = 0;
    const r = 2;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (terrain.isSolid(x + dx, y + dy)) {
          nx -= dx;
          ny -= dy;
        }
      }
    }
    const len = Math.hypot(nx, ny);
    if (len > 0.001) {
      return { nx: nx / len, ny: ny / len };
    }
    return { nx: 0, ny: -1 };
  }

  public detonate(
    terrain: Terrain,
    particles: ParticleManager,
    worms: { id: string; x: number; y: number; radius: number; takeDamage: (dmg: number, kx: number, ky: number, attackerId: string) => void; isAlive: () => boolean }[],
    onDetonate: (proj: Projectile) => void
  ) {
    if (!this.alive) return;
    this.alive = false;

    // Carve terrain
    if (this.weapon.craterRadius > 0) {
      terrain.carveCircle(this.x, this.y, this.weapon.craterRadius);
    }

    // Audio & Visual FX
    if (this.weapon.craterRadius >= 10) {
      sound.playExplosion(this.weapon.craterRadius);
      particles.spawnExplosionFX(this.x, this.y, this.weapon.craterRadius);
    } else {
      sound.playExplosion(10);
      particles.spawn(this.x, this.y, 0, 0, 'dirt', undefined, 2, 20);
    }

    // Damage & Knockback to worms in blast radius
    const blastRadius = this.weapon.craterRadius * 1.5;
    for (const w of worms) {
      if (!w.isAlive()) continue;
      const dist = Math.hypot(w.x - this.x, w.y - this.y);
      if (dist <= blastRadius) {
        const falloff = 1 - dist / blastRadius;
        const dmg = Math.round(this.weapon.damage * falloff);
        const knockDirX = dist > 0.1 ? (w.x - this.x) / dist : 0;
        const knockDirY = dist > 0.1 ? (w.y - this.y) / dist : -1;
        const knockForce = falloff * 5.0;

        w.takeDamage(dmg, knockDirX * knockForce, knockDirY * knockForce, this.ownerId);
      }
    }

    onDetonate(this);
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.alive) return;

    ctx.save();
    if (this.weapon.id === 'bazooka') {
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      // Rocket body
      ctx.fillStyle = '#666666';
      ctx.fillRect(-5, -2, 8, 4);
      // Warhead tip
      ctx.fillStyle = '#ff2222';
      ctx.beginPath();
      ctx.moveTo(3, -2);
      ctx.lineTo(6, 0);
      ctx.lineTo(3, 2);
      ctx.fill();
    } else if (this.weapon.id === 'grenade' || this.weapon.id === 'chiquita') {
      ctx.fillStyle = this.weapon.id === 'chiquita' ? '#eedd22' : '#228833';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.isSubCluster ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (this.weapon.id === 'mine') {
      ctx.fillStyle = this.armed ? (Math.floor(Date.now() / 200) % 2 === 0 ? '#ff1111' : '#333333') : '#888888';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'gauss') {
      ctx.strokeStyle = '#66e0ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.8, this.y - this.vy * 0.8);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    } else if (this.weapon.id === 'flamer') {
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Bullets (minigun, shotgun)
      ctx.fillStyle = '#ffee66';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
