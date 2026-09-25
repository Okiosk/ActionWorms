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
  public acidPoolCenter?: { x: number; y: number; r: number };

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
    worms: { id: string; x: number; y: number; radius: number; takeDamage: (dmg: number, kx: number, ky: number, attackerId: string) => void; isAlive: () => boolean; freeze?: (frames: number) => void }[],
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

    // Homing Missile Tracking
    if (this.weapon.homing && this.armed) {
      let closestWorm: any = null;
      let closestDist = 320;
      for (const w of worms) {
        if (w.id !== this.ownerId && w.isAlive()) {
          const d = Math.hypot(w.x - this.x, w.y - this.y);
          if (d < closestDist) {
            closestDist = d;
            closestWorm = w;
          }
        }
      }
      if (closestWorm) {
        const targetAngle = Math.atan2(closestWorm.y - this.y, closestWorm.x - this.x);
        const curAngle = Math.atan2(this.vy, this.vx);
        let diff = targetAngle - curAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const turnSpeed = 0.11;
        const newAngle = curAngle + Math.max(-turnSpeed, Math.min(turnSpeed, diff));
        const curSpeed = Math.hypot(this.vx, this.vy);
        this.vx = Math.cos(newAngle) * curSpeed;
        this.vy = Math.sin(newAngle) * curSpeed;
      }
    }

    // Vortex Gravitational Pull
    if (this.weapon.vortex) {
      for (const w of worms) {
        if (w.isAlive()) {
          const dx = this.x - w.x;
          const dy = this.y - w.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 1 && dist < 120) {
            const pull = (1 - dist / 120) * 0.75;
            w.takeDamage(0, (dx / dist) * pull, (dy / dist) * pull, this.ownerId);
          }
        }
      }
    }

    // Tail particle FX
    if (this.weapon.id === 'bazooka' || this.weapon.id === 'homing_missile') {
      particles.spawn(this.x, this.y, -this.vx * 0.2, -this.vy * 0.2, 'smoke', undefined, 2.5, 30);
      if (this.weapon.id === 'homing_missile') {
        particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 'fire', undefined, 2, 15);
      }
    } else if (this.weapon.id === 'flamer') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 'fire', undefined, 3, 25);
    } else if (this.weapon.id === 'railgun') {
      particles.spawn(this.x, this.y, 0, 0, 'spark', '#22e8dd', 2.0, 15);
    } else if (this.weapon.id === 'bouncy_ball') {
      particles.spawn(this.x, this.y, -this.vx * 0.1, -this.vy * 0.1, 'spark', '#b844ff', 1.8, 12);
    } else if (this.weapon.id === 'vortex') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 'smoke', '#8822cc', 3.0, 20);
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

    // Boomerang: reverse direction halfway through fuse
    if (this.weapon.boomerang) {
      const halfFuse = this.weapon.fuseFrames / 2;
      if (this.fuse <= halfFuse && this.fuse > halfFuse - 1) {
        // Reverse velocity toward shooter (just reverse X)
        this.vx = -this.vx * 0.9;
        this.vy = -this.vy * 0.5;
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
          if (this.weapon.toxic) {
            particles.spawnBloodBurst(this.x, this.y, 20);
          }
          this.detonate(terrain, particles, worms, onDetonate);
          return;
        }
      }

      // Check collision with terrain
      if (terrain.isSolid(nextX, nextY)) {
        // Piercing laser / Gauss gun / Railgun behavior
        if (this.weapon.piercing) {
          terrain.carveCircle(nextX, nextY, this.weapon.craterRadius);
          this.x = nextX;
          this.y = nextY;
          continue;
        }

        // Bouncing logic (grenades, cluster bombs, mines, bouncy ball)
        if (this.bouncesLeft > 0) {
          this.bouncesLeft--;
          if (this.weapon.id === 'bouncy_ball') {
            sound.playBouncy();
          } else {
            sound.playGrenadeBounce();
          }

          // Reflect velocity against surface normal
          const normal = this.findNormal(terrain, this.x, this.y);
          const dot = this.vx * normal.nx + this.vy * normal.ny;
          const restitution = this.weapon.id === 'bouncy_ball' ? 0.95 : 0.58;
          this.vx = (this.vx - 2 * dot * normal.nx) * restitution;
          this.vy = (this.vy - 2 * dot * normal.ny) * restitution;
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
    worms: { id: string; x: number; y: number; radius: number; takeDamage: (dmg: number, kx: number, ky: number, attackerId: string) => void; isAlive: () => boolean; freeze?: (frames: number) => void }[],
    onDetonate: (proj: Projectile) => void
  ) {
    if (!this.alive) return;
    this.alive = false;

    // Record acid pool center so Game.ts can carve the terrain
    if (this.weapon.acidPool) {
      this.acidPoolCenter = { x: this.x, y: this.y, r: this.weapon.craterRadius + 5 };
    }

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

    // Freeze bomb: freeze nearby worms
    if (this.weapon.freezeDuration) {
      const freezeRadius = this.weapon.craterRadius * 2.5;
      for (const w of worms) {
        if (!w.isAlive()) continue;
        const dist = Math.hypot(w.x - this.x, w.y - this.y);
        if (dist <= freezeRadius) {
          w.freeze?.(this.weapon.freezeDuration);
        }
      }
    }

    // Acid bomb: visual spray effect (terrain carving handled by Game.ts via acidPoolCenter)
    if (this.weapon.acidPool) {
      particles.spawn(this.x, this.y, 0, -1, 'dirt', '#22ff44', 5, 30);
      particles.spawn(this.x, this.y, 2, -0.5, 'dirt', '#00ee22', 4, 25);
      particles.spawn(this.x, this.y, -2, -0.5, 'dirt', '#00ee22', 4, 25);
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
    } else if (this.weapon.id === 'homing_missile') {
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      // Homing missile body
      ctx.fillStyle = '#225588';
      ctx.fillRect(-6, -2.5, 9, 5);
      // Nose cone
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(3, -2.5);
      ctx.lineTo(7, 0);
      ctx.lineTo(3, 2.5);
      ctx.fill();
    } else if (this.weapon.id === 'railgun') {
      ctx.strokeStyle = '#22e8dd';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.9, this.y - this.vy * 0.9);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'bouncy_ball') {
      ctx.fillStyle = '#b844ff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'dart_gun') {
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.fillStyle = '#44ff66';
      ctx.fillRect(-4, -1, 8, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, -0.5, 2, 1);
    } else if (this.weapon.id === 'vortex') {
      // Swirling singularity
      ctx.fillStyle = '#110022';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b844ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (this.weapon.id === 'flamer') {
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'laser') {
      ctx.strokeStyle = '#ff2222';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ff6666';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 8, this.y - this.vy * 8);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (this.weapon.id === 'acid_bomb') {
      ctx.fillStyle = '#22dd22';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'freeze_bomb') {
      ctx.fillStyle = '#aaddff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'mortar') {
      ctx.fillStyle = '#886644';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'boomerang') {
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.fillStyle = '#cc8822';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'sniper') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.5, this.y - this.vy * 0.5);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
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
