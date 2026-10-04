import { CONFIG } from '../config';
import { WeaponDef } from '../weapons/WeaponDef';
import { Terrain } from './Terrain';
import { ParticleManager } from './Particles';
import { Worm } from './Worm';

/** What a projectile needs from the game world. Game implements it (host only). */
export interface ProjectileWorld {
  terrain: Terrain;
  particles: ParticleManager;
  worms: Worm[];
  /** Detonation: crater, damage, FX, special effects. `directHit` = the wizard that was touched. */
  explode(p: Projectile, directHit: Worm | null): void;
  /** A piercing spell travelled from (x0,y0) to (x1,y1) this tick: carve the tunnel. */
  pierce(p: Projectile, x0: number, y0: number, x1: number, y1: number): void;
  /** A bouncing spell hit the ground hard. */
  bounce(p: Projectile): void;
  /** A spell was sent back by a mirror shield. */
  reflect(p: Projectile): void;
}

export interface ProjectileParams {
  id: number;
  ownerId: string;
  weapon: WeaponDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isSubCluster?: boolean;
}

/** Ticks before a spell can hit its own caster (it starts inside his reach) */
const SELF_HIT_DELAY = 15;
/** Ticks before a rune trap becomes active */
const MINE_ARM_DELAY = 40;

export class Projectile {
  public id: number;
  public ownerId: string;
  public weapon: WeaponDef;
  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public vx: number;
  public vy: number;
  public bouncesLeft: number;
  public fuse: number;
  public age: number = 0;
  public alive: boolean = true;
  public isSubCluster: boolean;
  /** Lying still on the ground (grenades that stopped rolling, rune traps) */
  public resting: boolean = false;
  /** Wizard whose mirror shield sent this spell back (immune to it) */
  public reflectedBy: string = '';
  /** Chakram flying back to its caster */
  private returning: boolean = false;
  /** Rune trap armed — set by the host, synced for rendering on clients */
  public armed: boolean = false;

  constructor(p: ProjectileParams) {
    this.id = p.id;
    this.ownerId = p.ownerId;
    this.weapon = p.weapon;
    this.x = this.prevX = p.x;
    this.y = this.prevY = p.y;
    this.vx = p.vx;
    this.vy = p.vy;
    this.bouncesLeft = p.weapon.bounces;
    this.fuse = p.weapon.fuseFrames;
    this.isSubCluster = !!p.isSubCluster;
  }

  public update(world: ProjectileWorld) {
    if (!this.alive) return;
    const { terrain, particles, worms } = world;
    this.prevX = this.x;
    this.prevY = this.y;
    this.age++;
    if (this.weapon.sticky) this.armed = this.age >= MINE_ARM_DELAY;

    if (--this.fuse <= 0) {
      this.detonate(world, null);
      return;
    }

    this.spawnTrail(particles);

    // Rune trap: explodes when an enemy (or its caster, once he walked away) comes close
    if (this.weapon.sticky && this.armed) {
      for (const w of worms) {
        if (!w.isAlive()) continue;
        if (w.id === this.ownerId && this.age < 120) continue;
        if (Math.hypot(w.x - this.x, w.y - this.y) < 22) {
          this.detonate(world, null);
          return;
        }
      }
    }

    if (this.resting) {
      // Start falling again if the ground underneath was blown away
      if (terrain.isSolid(this.x, this.y + 2) || terrain.isSolid(this.x, this.y)) return;
      this.resting = false;
    }

    // Water: fire spells fizzle out, everything else is slowed down
    const inWater = terrain.fluidAt(this.x, this.y) === CONFIG.MAT_WATER;
    if (inWater) {
      if (this.weapon.id === 'flamer') {
        this.alive = false;
        particles.spawn(this.x, this.y, 0, -0.5, 'smoke', undefined, 2, 20);
        return;
      }
      this.vx *= 0.94;
      this.vy *= 0.94;
    }

    this.vy += CONFIG.GRAVITY * this.weapon.gravityScale * (inWater ? 0.3 : 1);

    if (this.weapon.homing && this.age > 15) this.steerTowards(this.findTarget(worms, 320), 0.11);

    if (this.weapon.boomerang && this.age >= this.weapon.fuseFrames / 2) {
      if (!this.returning) {
        this.returning = true;
        this.fuse = this.weapon.fuseFrames; // enough time to fly all the way back
      }
      const owner = worms.find(w => w.id === this.ownerId && w.isAlive());
      if (owner) this.steerTowards(owner, 0.25);
    }

    if (this.weapon.vortex) {
      for (const w of worms) {
        if (!w.isAlive() || w.id === this.ownerId) continue;
        const dx = this.x - w.x;
        const dy = this.y - w.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1 && dist < 120) {
          const pull = (1 - dist / 120) * 0.35;
          w.vx += (dx / dist) * pull;
          w.vy += (dy / dist) * pull;
        }
      }
    }

    // Sub-stepped movement (2 px per step)
    const startX = this.x;
    const startY = this.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) / 2));
    const stepX = this.vx / steps;
    const stepY = this.vy / steps;

    for (let s = 0; s < steps; s++) {
      const nx = this.x + stepX;
      const ny = this.y + stepY;

      // Enemy mirror shields send the spell back
      for (const w of worms) {
        if (w.shieldTimer <= 0 || !w.isAlive() || w.id === this.ownerId) continue;
        const dx = nx - w.x;
        const dy = ny - w.y;
        const d = Math.hypot(dx, dy);
        if (d > 15 || d < 0.01) continue;
        const nnx = dx / d;
        const nny = dy / d;
        const dot = this.vx * nnx + this.vy * nny;
        if (dot < 0) {
          this.vx -= 2 * dot * nnx;
          this.vy -= 2 * dot * nny;
        }
        this.ownerId = w.id;
        this.reflectedBy = w.id;
        this.age = Math.max(this.age, SELF_HIT_DELAY);
        this.returning = false;
        world.reflect(this);
        return;
      }

      // Wizards
      for (const w of worms) {
        if (!w.isAlive()) continue;
        if (Math.hypot(w.x - nx, w.y - ny) > w.radius + 2) continue;
        if (w.id === this.ownerId) {
          if (this.returning) {
            this.alive = false; // caught by its caster
            return;
          }
          if (this.age < SELF_HIT_DELAY) continue;
        }
        if (this.weapon.sticky) continue; // traps only trigger by proximity
        this.x = nx;
        this.y = ny;
        this.detonate(world, w);
        return;
      }

      // Terrain
      if (terrain.isSolid(nx, ny)) {
        if (this.weapon.piercing) {
          this.x = nx;
          this.y = ny;
          continue;
        }
        if (this.weapon.sticky) {
          this.vx = this.vy = 0;
          this.resting = true;
          break;
        }
        // Giant mushrooms send every spell back, without using up a bounce
        if (terrain.materialAt(nx, ny) === CONFIG.MAT_BOUNCE) {
          this.bounceOff(world, true);
          break;
        }
        if (this.weapon.bounces > 0) {
          if (this.bounceOff(world, false)) break;
          this.detonate(world, null);
          return;
        }
        this.x = nx;
        this.y = ny;
        this.detonate(world, null);
        return;
      }

      this.x = nx;
      this.y = ny;
    }

    if (this.weapon.piercing) world.pierce(this, startX, startY, this.x, this.y);
  }

  /**
   * Reflects off the terrain. Light contacts (rolling) don't use up a bounce; the spell
   * comes to rest once it is slow enough. Returns false when it should explode instead.
   */
  private bounceOff(world: ProjectileWorld, elastic: boolean): boolean {
    const { nx, ny } = this.findNormal(world.terrain);
    const dot = this.vx * nx + this.vy * ny;
    if (dot >= 0) return true; // already moving away from the surface

    const hardImpact = -dot > 1.2;
    if (hardImpact) {
      if (!elastic) {
        if (this.bouncesLeft <= 0) return false;
        this.bouncesLeft--;
      }
      world.bounce(this);
    }

    const restitution = elastic ? 1.0 : 0.55;
    const friction = elastic ? 1.0 : 0.85;
    const tx = this.vx - dot * nx;
    const ty = this.vy - dot * ny;
    this.vx = tx * friction - dot * nx * restitution;
    this.vy = ty * friction - dot * ny * restitution;

    if (elastic && ny < -0.5) this.vy = Math.min(this.vy, -3); // springy mushroom cap
    else if (!hardImpact && Math.hypot(this.vx, this.vy) < 0.6 && ny < -0.5) {
      this.vx = this.vy = 0;
      this.resting = true;
    }
    return true;
  }

  private findNormal(terrain: Terrain): { nx: number; ny: number } {
    let nx = 0;
    let ny = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (terrain.isSolid(this.x + dx, this.y + dy)) {
          nx -= dx;
          ny -= dy;
        }
      }
    }
    const len = Math.hypot(nx, ny);
    if (len > 0.001) return { nx: nx / len, ny: ny / len };
    // Fallback: oppose the motion
    const sp = Math.hypot(this.vx, this.vy) || 1;
    return { nx: -this.vx / sp, ny: -this.vy / sp };
  }

  private findTarget(worms: Worm[], range: number): Worm | null {
    let best: Worm | null = null;
    let bestDist = range;
    for (const w of worms) {
      if (w.id === this.ownerId || !w.isAlive()) continue;
      const d = Math.hypot(w.x - this.x, w.y - this.y);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    return best;
  }

  private steerTowards(target: { x: number; y: number } | null, turnSpeed: number) {
    if (!target) return;
    const speed = Math.max(Math.hypot(this.vx, this.vy), this.weapon.projectileSpeed * 0.8);
    const cur = Math.atan2(this.vy, this.vx);
    let diff = Math.atan2(target.y - this.y, target.x - this.x) - cur;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const a = cur + Math.max(-turnSpeed, Math.min(turnSpeed, diff));
    this.vx = Math.cos(a) * speed;
    this.vy = Math.sin(a) * speed;
  }

  public detonate(world: ProjectileWorld, directHit: Worm | null) {
    if (!this.alive) return;
    this.alive = false;
    world.explode(this, directHit);
  }

  /** Magical trails (also used by clients, which only render projectiles) */
  public spawnTrail(particles: ParticleManager) {
    const id = this.weapon.id;
    const x = this.x;
    const y = this.y;
    const r = () => Math.random() - 0.5;
    if (this.resting) return;
    switch (id) {
      case 'bazooka':
        particles.spawn(x, y, r() * 0.4, r() * 0.4, 'fire', undefined, 2.5, 20);
        particles.spawn(x, y, -this.vx * 0.15, -this.vy * 0.15, 'smoke', undefined, 2.0, 25);
        break;
      case 'flamer':
        particles.spawn(x, y, r() * 0.4, -0.3, 'fire', undefined, 2.5, 14);
        break;
      case 'homing_missile':
        particles.spawn(x, y, r() * 0.3, r() * 0.3, 'spark', '#38bdf8', 2.0, 18);
        break;
      case 'railgun':
        particles.spawn(x, y, 0, 0, 'spark', this.weapon.elementColor, 2.0, 15);
        break;
      case 'vortex':
        particles.spawn(x, y, r() * 2, r() * 2, 'smoke', '#7c3aed', 3.0, 20);
        break;
      case 'acid_bomb':
        particles.spawn(x, y, r() * 0.5, -0.5, 'spark', '#22c55e', 2.0, 15);
        break;
      case 'freeze_bomb':
        particles.spawn(x, y, r() * 0.5, -0.5, 'spark', '#bae6fd', 1.8, 15);
        break;
      case 'boomerang':
        particles.spawn(x, y, 0, 0, 'spark', '#f59e0b', 1.5, 10);
        break;
      case 'earth_wall':
        if (this.age % 3 === 0) particles.spawn(x, y, r() * 0.5, 0, 'dirt', undefined, 1.5, 20);
        break;
      case 'leech':
        particles.spawn(x, y, r() * 0.3, r() * 0.3, 'blood', undefined, 1.2, 15);
        break;
      case 'teleport':
        particles.spawn(x + r() * 6, y + r() * 6, 0, 0, 'spark', '#b48cff', 1.5, 14);
        break;
      case 'chain_lightning':
        particles.spawn(x, y, r() * 1.5, r() * 1.5, 'spark', '#cff6ff', 1.2, 8);
        break;
      case 'meteor':
        if (this.isSubCluster) {
          particles.spawn(x, y, r() * 0.5, -0.5, 'fire', undefined, 3, 18);
          particles.spawn(x, y, -this.vx * 0.2, -this.vy * 0.2, 'smoke', undefined, 3.0, 30);
        } else if (this.age % 4 === 0) {
          particles.spawn(x, y, r() * 0.3, -0.4, 'spark', '#ff9a40', 1.5, 16);
        }
        break;
    }
  }

  public draw(ctx: CanvasRenderingContext2D, alpha: number) {
    if (!this.alive) return;
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;

    ctx.save();
    const elemColor = this.weapon.elementColor;

    if (this.weapon.id === 'bazooka') {
      // Boule de Feu Majeure (Great Fireball)
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 10;
      // Outer fire halo
      ctx.fillStyle = '#ff4400';
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // Mid flame
      ctx.fillStyle = '#ffaa00';
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Inner glowing core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'grenade' || this.weapon.id === 'chiquita') {
      // Orbe Instable / Orbe de Scission (Arcane / Celestial Orbs)
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.015);
      const isChiquita = this.weapon.id === 'chiquita';
      const orbColor = isChiquita ? '#ffd700' : '#a855f7';
      ctx.shadowColor = orbColor;
      ctx.shadowBlur = 8;
      ctx.fillStyle = orbColor;
      ctx.beginPath();
      ctx.arc(x, y, this.isSubCluster ? 3.0 : 5.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, this.isSubCluster ? 1.5 : 2.5 + pulse * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'mine') {
      // Rune Tellurique (Explosive Rune)
      const pulse = Math.floor(Date.now() / 180) % 2 === 0;
      ctx.shadowColor = this.armed ? '#ef4444' : '#8b5cf6';
      ctx.shadowBlur = this.armed ? 8 : 4;
      ctx.strokeStyle = this.armed ? (pulse ? '#ff3333' : '#aa0000') : '#8b5cf6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y);
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    } else if (this.weapon.id === 'homing_missile') {
      // Feu Follet Traqueur (Seeking Wisp)
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.02);
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = `rgba(0, 240, 255, ${0.45 + pulse * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, 6.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e0ffff';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'railgun') {
      // Foudre Divine (Divine Lightning)
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(x - this.vx * 0.9, y - this.vy * 0.9);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (this.weapon.id === 'vortex') {
      // Singularité du Néant (Void Singularity)
      const rot = (Date.now() * 0.008) % (Math.PI * 2);
      ctx.translate(x, y);
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
      ctx.arc(x, y, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'acid_bomb') {
      // Fiole Alchimique (Alchemical Flask)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(x, y);
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
      ctx.translate(x, y);
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
      ctx.translate(x, y);
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
    } else if (this.weapon.id === 'shotgun') {
      // Éclats Arcaniques (Arcane Shards)
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(x, y);
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
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'earth_wall') {
      // Clod of enchanted earth
      ctx.translate(x, y);
      ctx.rotate(this.age * 0.15);
      ctx.fillStyle = '#7a4a22';
      ctx.strokeStyle = '#e0a060';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4.5, -2); ctx.lineTo(-1, -5); ctx.lineTo(4, -3.5); ctx.lineTo(5, 1.5); ctx.lineTo(1, 5); ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (this.weapon.id === 'leech') {
      // Blood bolt
      const angle = Math.atan2(this.vy, this.vx);
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#9b0020';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.arc(2.5, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'teleport') {
      // Swirling rift orb
      ctx.translate(x, y);
      ctx.rotate(this.age * 0.3);
      ctx.shadowColor = '#b48cff';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#c9a8ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 1.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3, Math.PI, Math.PI * 2.3);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'chain_lightning') {
      // Crackling ball of lightning
      ctx.shadowColor = '#9fe8ff';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#e6faff';
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#bff2ff';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.weapon.id === 'meteor') {
      if (this.isSubCluster) {
        // Falling meteor
        const angle = Math.atan2(this.vy, this.vx);
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.shadowColor = '#ff6600';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff8a1a';
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(0, -4);
        ctx.lineTo(0, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#4a2511';
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Target beacon
        const pulse = 0.5 + 0.5 * Math.sin(this.age * 0.3);
        ctx.shadowColor = '#ff7a1a';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(255, 140, 40, ${0.6 + pulse * 0.4})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 3.5 + pulse * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffd08a';
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Spark générique aux couleurs du sort
      ctx.fillStyle = elemColor;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
