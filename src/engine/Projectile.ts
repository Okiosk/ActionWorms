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

    // Tail particle FX (Magical Spell Trails)
    if (this.weapon.id === 'bazooka' || this.weapon.id === 'flamer') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 'fire', undefined, 2.5, 20);
      particles.spawn(this.x, this.y, -this.vx * 0.15, -this.vy * 0.15, 'smoke', undefined, 2.0, 25);
    } else if (this.weapon.id === 'mortar') {
      particles.spawn(this.x, this.y, -this.vx * 0.2, -this.vy * 0.2, 'smoke', undefined, 3.0, 30);
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 'fire', undefined, 2.0, 15);
    } else if (this.weapon.id === 'homing_missile') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 'spark', '#38bdf8', 2.0, 18);
    } else if (this.weapon.id === 'railgun' || this.weapon.id === 'gauss') {
      particles.spawn(this.x, this.y, 0, 0, 'spark', this.weapon.elementColor || '#a855f7', 2.0, 15);
    } else if (this.weapon.id === 'bouncy_ball') {
      particles.spawn(this.x, this.y, -this.vx * 0.1, -this.vy * 0.1, 'spark', '#d946ef', 1.8, 12);
    } else if (this.weapon.id === 'vortex') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 'smoke', '#7c3aed', 3.0, 20);
    } else if (this.weapon.id === 'acid_bomb') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, -0.5, 'spark', '#22c55e', 2.0, 15);
    } else if (this.weapon.id === 'freeze_bomb') {
      particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, -0.5, 'spark', '#bae6fd', 1.8, 15);
    } else if (this.weapon.id === 'boomerang') {
      particles.spawn(this.x, this.y, 0, 0, 'spark', '#f59e0b', 1.5, 10);
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
      particles.spawnExplosionFX(this.x, this.y, this.weapon.craterRadius, this.weapon.elementColor);
    } else {
      sound.playExplosion(10);
      particles.spawn(this.x, this.y, 0, 0, 'spark', this.weapon.elementColor || '#ffd700', 2, 20);
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
    const elemColor = this.weapon.elementColor || '#ffd700';

    if (this.weapon.id === 'bazooka') {
      // Boule de Feu Majeure (Great Fireball)
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 10;
      // Outer fire halo
      ctx.fillStyle = '#ff4400';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // Mid flame
      ctx.fillStyle = '#ffaa00';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Inner glowing core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'mortar') {
      // Météore Déferlant (Falling Meteor)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#4a2511';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(-3, -2, 6, 4);
      ctx.fillStyle = '#ffee44';
      ctx.fillRect(-1, -1, 3, 2);
    } else if (this.weapon.id === 'grenade' || this.weapon.id === 'chiquita') {
      // Orbe Instable / Orbe de Scission (Arcane / Celestial Orbs)
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.015);
      const isChiquita = this.weapon.id === 'chiquita';
      const orbColor = isChiquita ? '#ffd700' : '#a855f7';
      ctx.shadowColor = orbColor;
      ctx.shadowBlur = 8;
      ctx.fillStyle = orbColor;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.isSubCluster ? 3.0 : 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.isSubCluster ? 1.5 : 2.5 + pulse * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'mine') {
      // Rune Tellurique (Explosive Rune)
      const pulse = Math.floor(Date.now() / 180) % 2 === 0;
      ctx.shadowColor = this.armed ? '#ef4444' : '#8b5cf6';
      ctx.shadowBlur = this.armed ? 8 : 4;
      ctx.strokeStyle = this.armed ? (pulse ? '#ff3333' : '#aa0000') : '#8b5cf6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.x - 3, this.y);
      ctx.lineTo(this.x + 3, this.y);
      ctx.moveTo(this.x, this.y - 3);
      ctx.lineTo(this.x, this.y + 3);
      ctx.stroke();
    } else if (this.weapon.id === 'gauss') {
      // Rayon Astral (Astral Ray)
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.85, this.y - this.vy * 0.85);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'homing_missile') {
      // Feu Follet Traqueur (Seeking Wisp)
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.02);
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = `rgba(0, 240, 255, ${0.45 + pulse * 0.35})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 6.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e0ffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'railgun') {
      // Foudre Divine (Divine Lightning)
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.9, this.y - this.vy * 0.9);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (this.weapon.id === 'bouncy_ball') {
      // Sphère Chaotique (Chaos Sphere)
      ctx.shadowColor = '#d946ef';
      ctx.shadowBlur = 9;
      ctx.fillStyle = '#d946ef';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fbcfe8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (this.weapon.id === 'dart_gun') {
      // Dards Empoisonnés (Venomous Darts)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#15803d';
      ctx.fillRect(-5, -1.2, 9, 2.4);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(4, -1, 3, 2);
    } else if (this.weapon.id === 'vortex') {
      // Singularité du Néant (Void Singularity)
      const rot = (Date.now() * 0.008) % (Math.PI * 2);
      ctx.translate(this.x, this.y);
      ctx.rotate(rot);
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 14;
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7.0, 0, Math.PI * 1.6);
      ctx.stroke();
      ctx.fillStyle = '#060010';
      ctx.beginPath();
      ctx.arc(0, 0, 4.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'flamer') {
      // Souffle du Dragon (Dragon's Breath)
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'laser') {
      // Faisceau Lunaire (Lunar Beam)
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.8;
      ctx.shadowColor = '#fb7185';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 8, this.y - this.vy * 8);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    } else if (this.weapon.id === 'acid_bomb') {
      // Fiole Alchimique (Alchemical Flask)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(3, -1.2, 2.5, 2.4);
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 7;
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.arc(0, 0, 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#bbf7d0';
      ctx.lineWidth = 1.0;
      ctx.stroke();
    } else if (this.weapon.id === 'freeze_bomb') {
      // Nova de Givre (Frost Nova)
      ctx.translate(this.x, this.y);
      ctx.rotate((Date.now() * 0.005) % (Math.PI * 2));
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(2, -2);
      ctx.lineTo(6, 0);
      ctx.lineTo(2, 2);
      ctx.lineTo(0, 6);
      ctx.lineTo(-2, 2);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-2, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'boomerang') {
      // Lame Spirituelle (Spirit Blade)
      ctx.translate(this.x, this.y);
      ctx.rotate((Date.now() * 0.02) % (Math.PI * 2));
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7.5, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'sniper') {
      // Éclair de Jugement (Judgment Bolt)
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(this.x - this.vx * 0.6, this.y - this.vy * 0.6);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    } else if (this.weapon.id === 'shotgun') {
      // Éclats Arcaniques (Arcane Shards)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 5;
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.lineTo(0, -1.8);
      ctx.lineTo(-3, 0);
      ctx.lineTo(0, 1.8);
      ctx.closePath();
      ctx.fill();
    } else if (this.weapon.id === 'minigun') {
      // Choc d'Étincelles (Spark Jolt)
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 4;
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Spark générique aux couleurs du sort
      ctx.fillStyle = elemColor;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
