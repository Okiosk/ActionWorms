import { CONFIG } from '../config';
import { WeaponDef } from '../weapons/WeaponDef';
import { Terrain } from './Terrain';
import { ParticleManager } from './Particles';
import { drawFx } from './Sprites';
import { Worm } from './Worm';
import { WORLD_ENV } from './Env';

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
  /** A frog jumped. */
  hop(p: Projectile): void;
  /** All spells in flight (homing spells also chase enemy decoys) */
  projectiles: Projectile[];
  /** Small damage dealt by a spell without exploding (tornado) */
  hurt(w: Worm, dmg: number, ownerId: string): void;
  /** The hot potato changed hands */
  pass(p: Projectile, to: Worm): void;
}

/** Something a homing spell can chase */
interface Target { x: number; y: number }

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
  private trailTick = 0;
  /** Frogs: ticks before the next jump */
  private hopTimer = 10;
  /** Hot potato: id of the wizard carrying it ('' = loose) — synced for rendering */
  public attachedTo = '';
  private passCooldown = 0;
  private caught = false;
  /** Ticks before it can go through a portal again */
  public portalCooldown = 0;

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

    if (this.portalCooldown > 0) this.portalCooldown--;
    if (--this.fuse <= 0) {
      const carrier = this.attachedTo ? worms.find(w => w.id === this.attachedTo) ?? null : null;
      this.detonate(world, carrier);
      return;
    }

    this.spawnTrail(particles);

    if (this.weapon.tornado) {
      this.updateTornado(world);
      return;
    }
    if (this.weapon.decoy) {
      this.updateDecoy(world);
      return;
    }
    if (this.weapon.hotPotato && this.attachedTo) {
      this.updateCarried(world);
      return;
    }

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

    // A loose hot potato is picked up by whoever walks into it
    if (this.weapon.hotPotato) {
      for (const w of worms) {
        if (!w.isAlive() || (w.id === this.ownerId && this.age < SELF_HIT_DELAY)) continue;
        if (Math.hypot(w.x - this.x, w.y - this.y) < 9) {
          this.catch(w, world);
          return;
        }
      }
    }

    // Frogs: hop towards the nearest enemy whenever they touch the ground
    if (this.weapon.hopper) {
      // Jumps on any other wizard that comes close
      for (const w of worms) {
        if (w.isAlive() && w.id !== this.ownerId && Math.hypot(w.x - this.x, w.y - 2 - this.y) < 9) {
          this.detonate(world, w);
          return;
        }
      }
      if (this.hopTimer > 0) this.hopTimer--;
      if (this.hopTimer <= 0 && this.vy >= -0.2 && (this.resting || terrain.isSolid(this.x, this.y + 3))) {
        const target = this.findTarget(world, 420);
        const dir = target ? Math.sign(target.x - this.x) || 1 : this.vx >= 0 ? 1 : -1;
        const high = target && target.y < this.y - 18;
        this.vx = dir * (1.1 + Math.random() * 0.6);
        this.vy = -(high ? 3.6 : 2.5 + Math.random() * 0.5);
        this.resting = false;
        this.hopTimer = 20 + Math.floor(Math.random() * 14);
        world.hop(this);
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
        particles.spawn(this.x, this.y, 0, -0.5, 'smoke', '#9a9a9a', 5, 25);
        return;
      }
      this.vx *= 0.94;
      this.vy *= 0.94;
    }

    this.vy += CONFIG.GRAVITY * this.weapon.gravityScale * (inWater ? 0.3 : 1) * WORLD_ENV.gravityAt(this.x, this.y);
    if (this.weapon.gravityScale > 0) this.vx += WORLD_ENV.wind * 1.6;

    if (this.weapon.homing && this.age > 15) this.steerTowards(this.findTarget(world, 320), 0.11);

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
        if (this.weapon.hotPotato) {
          this.catch(w, world);
          return;
        }
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

  /** Nearest enemy wizard — or enemy decoy, which fools homing spells */
  private findTarget(world: ProjectileWorld, range: number): Target | null {
    let best: Target | null = null;
    let bestDist = range;
    for (const w of world.worms) {
      if (w.id === this.ownerId || !w.isAlive()) continue;
      const d = Math.hypot(w.x - this.x, w.y - this.y);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    for (const p of world.projectiles) {
      if (!p.alive || !p.weapon.decoy || p.ownerId === this.ownerId) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y) * 0.8; // decoys look juicier
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  // ── Hot potato ──────────────────────────────────────────────────────────

  private catch(w: Worm, world: ProjectileWorld) {
    this.attachedTo = w.id;
    this.vx = this.vy = 0;
    this.resting = false;
    this.passCooldown = 25;
    if (!this.caught) {
      this.caught = true;
      this.fuse = Math.min(this.fuse, 240); // 4 s from the first catch
    }
    world.pass(this, w);
  }

  /** Rides above the carrier's head and jumps to any wizard he touches */
  private updateCarried(world: ProjectileWorld) {
    const carrier = world.worms.find(w => w.id === this.attachedTo);
    if (!carrier || !carrier.isAlive()) {
      this.attachedTo = ''; // dropped
      this.vy = -1;
      return;
    }
    this.x = carrier.x;
    this.y = carrier.y - 16;
    if (this.passCooldown > 0) {
      this.passCooldown--;
      return;
    }
    for (const w of world.worms) {
      if (w === carrier || !w.isAlive()) continue;
      if (Math.hypot(w.x - carrier.x, w.y - carrier.y) < 13) {
        this.catch(w, world);
        return;
      }
    }
  }

  // ── Tornado ─────────────────────────────────────────────────────────────

  /** Rolls along the ground (climbs slopes, turns back at walls), sucking wizards up */
  private updateTornado(world: ProjectileWorld) {
    const t = world.terrain;
    let dir = this.vx >= 0 ? 1 : -1;
    const speed = this.weapon.projectileSpeed;
    let nx = this.x + dir * speed;
    let ny = this.y;
    let climb = 0;
    while (t.isSolid(nx, ny) && climb < 10) {
      ny -= 1;
      climb++;
    }
    if (t.isSolid(nx, ny)) {
      dir = -dir;
      nx = this.x;
      ny = this.y;
    }
    for (let fall = 0; fall < 4 && !t.isSolid(nx, ny + 1); fall++) ny += 1;
    this.x = nx;
    this.y = ny;
    this.vx = dir * speed;
    this.vy = 0;

    for (const w of world.worms) {
      if (!w.isAlive()) continue;
      const dx = w.x - this.x;
      const dy = w.y - this.y;
      if (Math.abs(dx) > 16 || dy > 8 || dy < -46) continue;
      // Caught in the funnel: spun around its axis and lifted
      w.rope.release();
      w.vx = w.vx * 0.7 + (dir * speed - dx * 0.12) * 0.3;
      w.vy = Math.max(-2.2, w.vy - 0.45);
      if (this.age % 15 === 0) world.hurt(w, 2, this.ownerId);
    }
  }

  // ── Decoy ───────────────────────────────────────────────────────────────

  /** Walks straight ahead like a real wizard, hops now and then, explodes when approached */
  private updateDecoy(world: ProjectileWorld) {
    const t = world.terrain;
    for (const w of world.worms) {
      if (w.isAlive() && w.id !== this.ownerId && Math.hypot(w.x - this.x, w.y - this.y) < 13) {
        this.detonate(world, w);
        return;
      }
    }
    const dir = this.vx >= 0 ? 1 : -1;
    const grounded = t.isSolid(this.x, this.y + 6);
    if (grounded) {
      // Walk, climbing small steps
      let nx = this.x + dir * 1.1;
      let ny = this.y;
      let climb = 0;
      while ((t.isSolid(nx, ny + 4) || t.isSolid(nx + dir * 4, ny)) && climb < 5) {
        ny -= 1;
        climb++;
      }
      if (t.isSolid(nx + dir * 4, ny) || t.isSolid(nx, ny - 5)) {
        this.vx = -dir * 1.1; // a wall: turn around
        nx = this.x;
        ny = this.y;
      } else {
        this.vx = dir * 1.1;
      }
      this.x = nx;
      this.y = ny;
      this.vy = 0;
      if (this.age % 70 === 35) this.vy = -2.4; // a little hop, like players do
    }
    if (!grounded || this.vy < 0) {
      this.vy = Math.min(5, this.vy + CONFIG.GRAVITY * WORLD_ENV.gravityAt(this.x, this.y));
      const steps = Math.ceil(Math.abs(this.vy) + Math.abs(this.vx));
      for (let i = 0; i < steps; i++) {
        const sx = this.x + this.vx / steps;
        const sy = this.y + this.vy / steps;
        if (t.isSolid(sx, sy + 5.5) && this.vy > 0) {
          this.vy = 0;
          break;
        }
        if (t.isSolid(sx, sy - 5) && this.vy < 0) this.vy = 0;
        if (!t.isSolid(sx + Math.sign(this.vx) * 4, sy)) this.x = sx;
        this.y = sy;
      }
    }
    // Snap out of the ground
    for (let k = 0; k < 6 && t.isSolid(this.x, this.y + 4); k++) this.y -= 1;
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
    if (this.resting) return;
    const t = ++this.trailTick;
    const x = this.x;
    const y = this.y;
    const r = () => Math.random() - 0.5;
    const color = this.weapon.elementColor;
    switch (this.weapon.id) {
      case 'bazooka':
        particles.spawn(x + r() * 2, y + r() * 2, r() * 0.3 - this.vx * 0.05, r() * 0.3 - this.vy * 0.05, 'fire', undefined, 6 + Math.random() * 3, 16);
        if (t % 2 === 0) particles.spawn(x, y, -this.vx * 0.1, -this.vy * 0.1, 'smoke', undefined, 5, 35);
        break;
      case 'flamer':
        particles.spawn(x, y, r() * 0.4, -0.3, 'fire', undefined, 5 + Math.random() * 3, 14);
        break;
      case 'polymorph':
        if (t % 2 === 0) particles.spawn(x + r() * 4, y + r() * 4, r() * 0.3, r() * 0.3, 'spark', Math.random() < 0.5 ? color : '#ffffff', 0.9, 18);
        break;
      case 'drunk':
        if (t % 3 === 0) particles.spawn(x, y, r() * 0.3, -0.3, 'glow', '#d7f06a', 4, 22);
        break;
      case 'bubble':
        if (t % 4 === 0) particles.spawn(x + r() * 6, y + r() * 6, r() * 0.2, -0.25, 'glow', '#cfeeff', 3, 30);
        break;
      case 'portal':
        particles.spawn(x + r() * 3, y + r() * 3, r() * 0.3, r() * 0.3, 'spark', t % 2 ? '#4fd8ff' : '#ff9a3c', 0.8, 14);
        break;
      case 'hot_potato':
        if (t % 2 === 0) particles.spawn(x + 2, y - 6, r() * 0.6, -0.8, 'spark', '#ffd27a', 0.7, 12);
        if (t % 6 === 0) particles.spawn(x, y - 5, r() * 0.2, -0.3, 'smoke', '#6b6468', 4, 25);
        break;
      case 'tornado':
        if (t % 2 === 0) {
          const a = Math.random() * Math.PI * 2;
          particles.spawn(x + Math.cos(a) * 12, y - 4, -Math.sin(a) * 1.2, -0.8 - Math.random(), 'dirt', undefined, 1.2, 30);
        }
        break;
      case 'antigravity':
        particles.spawn(x + r() * 4, y + r() * 4, r() * 0.2, -0.6, 'spark', '#d2b4ff', 0.8, 16);
        break;
      case 'swap':
        particles.spawn(x, y, r() * 0.3, r() * 0.3, 'spark', t % 2 ? '#38d6ff' : '#ff9a3c', 0.9, 12);
        break;
      case 'homing_missile':
        particles.spawn(x + r() * 3, y + r() * 3, r() * 0.3, -0.2, 'glow', color, 6, 18);
        break;
      case 'railgun':
        particles.spawn(x, y, r() * 0.2, r() * 0.2, 'spark', color, 1.2, 14);
        break;
      case 'vortex':
        if (t % 2 === 0) particles.spawn(x + r() * 10, y + r() * 10, r() * 0.6, r() * 0.6, 'smoke', '#2a1450', 7, 22);
        break;
      case 'toxic_cloud':
        if (t % 2 === 0) particles.spawn(x, y, r() * 0.5, -0.3, 'smoke', '#7fc23a', 4, 25);
        break;
      case 'freeze_bomb':
        particles.spawn(x + r() * 4, y + r() * 4, r() * 0.3, 0.1, 'spark', '#dff8ff', 0.8, 18);
        break;
      case 'boomerang':
        if (t % 2 === 0) particles.spawn(x, y, 0, 0, 'glow', color, 6, 8);
        break;
      case 'earth_wall':
        if (t % 3 === 0) particles.spawn(x, y, r() * 0.5, 0, 'dirt', undefined, 1.5, 20);
        break;
      case 'leech':
        particles.spawn(x, y, r() * 0.3, r() * 0.3, 'blood', undefined, 0.8, 20);
        break;
      case 'teleport':
        particles.spawn(x + r() * 6, y + r() * 6, 0, 0, 'spark', color, 1, 14);
        break;
      case 'chiquita':
        if (t % 2 === 0) particles.spawn(x, y, r() * 0.3, r() * 0.3, 'spark', color, 0.9, 16);
        break;
      case 'meteor':
        if (this.isSubCluster) {
          particles.spawn(x + r() * 3, y + r() * 3, r() * 0.5, -0.5, 'fire', undefined, 8 + Math.random() * 4, 18);
          if (t % 2 === 0) particles.spawn(x, y, -this.vx * 0.2, -this.vy * 0.2, 'smoke', undefined, 7, 40);
        } else if (t % 4 === 0) {
          particles.spawn(x, y, r() * 0.3, -0.4, 'spark', '#ff9a40', 1, 16);
        }
        break;
    }
  }

  /** Painted glow sprites (additive), oriented along the flight direction when it matters. */
  public draw(ctx: CanvasRenderingContext2D, alpha: number, now: number) {
    if (!this.alive) return;
    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    const color = this.weapon.elementColor;
    const dir = Math.atan2(this.vy, this.vx);
    const speed = Math.hypot(this.vx, this.vy);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.012 + this.id);
    const spin = now * 0.006 + this.id;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    switch (this.weapon.id) {
      case 'bazooka':
        drawFx(ctx, 'circle_05', x, y, 20, '#ff5a14', 0.7);
        drawFx(ctx, 'flame_02', x, y, 13, '#ff9a1f', 0.9, spin * 2);
        drawFx(ctx, 'circle_05', x, y, 7, '#fff4c2', 1);
        break;
      case 'frogs': { // Crapauds Kamikazes
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const f = this.vx >= 0 ? 1 : -1;
        const air = !this.resting && Math.abs(this.vy) > 0.4;
        ctx.translate(x, y);
        ctx.scale(f, 1);
        // back legs (stretched while jumping)
        ctx.strokeStyle = '#2f8a22';
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-1.5, 1);
        ctx.lineTo(air ? -5 : -3.5, air ? 3 : 2.2);
        ctx.stroke();
        ctx.fillStyle = '#4fc23a';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.6, 2.6, air ? -0.35 : 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c9f08a';
        ctx.beginPath();
        ctx.ellipse(0.8, 1.1, 2, 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
        // bulging eyes
        for (const ex of [0.6, 2.4]) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(ex, -2.2, 1.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#111111';
          ctx.beginPath();
          ctx.arc(ex + 0.3, -2.2, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // lit fuse on the back, blinking faster as it nears the end
        const blink = this.fuse < 90 ? Math.floor(now / 90) % 2 === 0 : Math.floor(now / 300) % 2 === 0;
        ctx.globalCompositeOperation = 'lighter';
        drawFx(ctx, 'circle_05', -1.5, -2.2, blink ? 6 : 3.5, '#ff5a2a', 0.9);
        break;
      }
      case 'polymorph': // Métamorphose Ovine
        drawFx(ctx, 'circle_05', x, y, 14 + pulse * 3, color, 0.7);
        drawFx(ctx, 'magic_02', x, y, 12, '#ffd2f3', 0.9, spin * 1.5);
        drawFx(ctx, 'star_04', x, y, 8, '#ffffff', 1, -spin);
        break;
      case 'drunk': { // Philtre d'Ivresse: a spinning bottle of grog
        drawFx(ctx, 'circle_05', x, y, 13, color, 0.45);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.translate(x, y);
        ctx.rotate(spin * 2.5);
        ctx.fillStyle = '#7a4a1e';
        ctx.fillRect(-0.9, -5, 1.8, 2.4);
        ctx.fillStyle = '#c99a3a';
        ctx.beginPath();
        ctx.ellipse(0, 0.6, 2.6, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f1e7b6';
        ctx.fillRect(-1.6, -0.2, 3.2, 1.6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(-1, -0.6, 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bubble': // Bulle Farceuse
        drawFx(ctx, 'light_01', x, y, 15, color, 0.4, spin * 0.3);
        drawFx(ctx, 'circle_02', x, y, 13 + pulse, '#e6f7ff', 0.85);
        drawFx(ctx, 'circle_05', x - 2.5, y - 2.5, 3.5, '#ffffff', 0.9);
        break;
      case 'portal': // Portails Jumeaux: the seed of a portal
        drawFx(ctx, 'twirl_02', x, y, 13, color, 1, spin * 4);
        drawFx(ctx, 'circle_05', x, y, 7, '#ffffff', 1);
        break;
      case 'antigravity': // Anomalie: an inverted droplet of void
        drawFx(ctx, 'circle_05', x, y, 15 + pulse * 3, color, 0.7);
        drawFx(ctx, 'magic_03', x, y, 12, '#e8dcff', 0.9, -spin * 2);
        break;
      case 'tornado': { // Tornade: a funnel of spinning wind, wide at the top
        for (let k = 0; k < 6; k++) {
          const h = k / 5;
          const wob = Math.sin(now * 0.008 + k * 0.9) * (2 + h * 4);
          drawFx(ctx, k % 2 ? 'twirl_01' : 'twirl_02', x + wob, y - 4 - h * 36, 10 + h * 26, '#dfe9f2', 0.45 + (1 - h) * 0.25, spin * (5 - h * 2) * (k % 2 ? 1 : -1));
        }
        ctx.globalCompositeOperation = 'source-over';
        drawFx(ctx, 'smoke_04', x, y - 2, 18, '#8a7a66', 0.45, spin);
        break;
      }
      case 'hot_potato': { // Patate Chaude: a potato with a fizzing fuse, blinking near the end
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const urgent = this.fuse < 90 && Math.floor(now / 100) % 2 === 0;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.attachedTo ? Math.sin(now * 0.02) * 0.3 : spin);
        ctx.fillStyle = urgent ? '#ff5a2a' : '#b98546';
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.6, 3.6, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(80, 50, 20, 0.7)';
        for (const [ex, ey] of [[-1.8, -0.6], [1.2, 1.1], [0.6, -1.6]]) {
          ctx.beginPath();
          ctx.arc(ex, ey, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(1.5, -3);
        ctx.quadraticCurveTo(3, -5.5, 2, -6.5);
        ctx.stroke();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        drawFx(ctx, 'star_04', x + 2, y - 6.5, 6 + Math.random() * 3, '#ffd27a', 1, Math.random() * 3);
        if (this.attachedTo) {
          // Countdown above the carrier
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.font = '700 6px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
          const label = String(Math.ceil(this.fuse / 60));
          ctx.strokeText(label, x, y - 9);
          ctx.fillStyle = urgent ? '#ff5a2a' : '#ffe36b';
          ctx.fillText(label, x, y - 9);
        }
        break;
      }
      case 'decoy':
        break; // drawn by the game as a wizard (needs the caster's colour and name)
      case 'swap': // Permutation: two orbs chasing each other
        for (const [k, c] of [[0, '#38d6ff'], [Math.PI, '#ff9a3c']] as const) {
          const a = spin * 4 + k;
          drawFx(ctx, 'circle_05', x + Math.cos(a) * 3, y + Math.sin(a) * 3, 8, c, 1);
        }
        drawFx(ctx, 'circle_05', x, y, 4, '#ffffff', 1);
        break;
      case 'chiquita': // Comète Étoilée (and its shards)
        if (this.isSubCluster) {
          drawFx(ctx, 'circle_05', x, y, 9, color, 0.7);
          drawFx(ctx, 'star_06', x, y, 9, '#ffffff', 1, spin * 2);
        } else {
          drawFx(ctx, 'circle_05', x, y, 18, color, 0.7);
          drawFx(ctx, 'star_09', x, y, 16, color, 1, spin);
          drawFx(ctx, 'circle_05', x, y, 5, '#ffffff', 1);
        }
        break;
      case 'mine': { // Rune Piégée: dim while arming, blinking red once armed
        const blink = this.armed && Math.floor(now / 180) % 2 === 0;
        const c = this.armed ? '#ff3b2f' : color;
        drawFx(ctx, 'magic_01', x, y, 13, c, this.armed ? (blink ? 1 : 0.55) : 0.45, now * 0.0015);
        if (this.armed) drawFx(ctx, 'circle_05', x, y, 10, c, blink ? 0.6 : 0.25);
        break;
      }
      case 'homing_missile': // Feu Follet
        drawFx(ctx, 'circle_05', x, y, 16 + pulse * 5, color, 0.6);
        drawFx(ctx, 'light_01', x, y, 11, color, 0.7, spin);
        drawFx(ctx, 'circle_05', x, y, 5, '#e8ffff', 1);
        break;
      case 'railgun': // Foudre Divine
        drawFx(ctx, 'trace_01', x - this.vx * 0.45, y - this.vy * 0.45, 7, color, 1, dir + Math.PI / 2, speed * 0.25);
        drawFx(ctx, 'circle_05', x, y, 12, color, 0.8);
        drawFx(ctx, 'circle_05', x, y, 5, '#ffffff', 1);
        break;
      case 'vortex': // Singularité du Néant
        drawFx(ctx, 'twirl_01', x, y, 26, color, 0.9, -spin * 2);
        drawFx(ctx, 'twirl_02', x, y, 20, '#c58bff', 0.7, -spin * 3);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#05000c';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 3.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'flamer': // Souffle du Dragon
        drawFx(ctx, 'circle_05', x, y, 10, '#ff5a14', 0.6);
        drawFx(ctx, 'flame_01', x, y, 9, '#ffb347', 0.9, spin * 3);
        break;
      case 'toxic_cloud': // Fiole Pestilentielle: a real flask, with a toxic glow
        drawFx(ctx, 'circle_05', x, y, 15, color, 0.45 + pulse * 0.2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.translate(x, y);
        ctx.rotate(dir);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(3, -1.1, 2.5, 2.2);
        ctx.fillStyle = '#1ea33a';
        ctx.beginPath();
        ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.beginPath();
        ctx.arc(-1.2, -1.2, 1.1, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'freeze_bomb': // Orbe de Givre
        drawFx(ctx, 'circle_05', x, y, 16, color, 0.6);
        drawFx(ctx, 'magic_03', x, y, 14, '#dff8ff', 1, spin);
        break;
      case 'boomerang': // Chakram
        drawFx(ctx, 'slash_01', x, y, 14, color, 1, spin * 4);
        drawFx(ctx, 'slash_01', x, y, 14, color, 1, spin * 4 + Math.PI);
        drawFx(ctx, 'circle_05', x, y, 6, '#fff3c8', 1);
        break;
      case 'earth_wall': // Rempart: an enchanted clod of earth
        drawFx(ctx, 'circle_05', x, y, 13, color, 0.35);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.translate(x, y);
        ctx.rotate(spin);
        ctx.fillStyle = '#7a4a22';
        ctx.strokeStyle = '#e0a060';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-4.5, -2); ctx.lineTo(-1, -5); ctx.lineTo(4, -3.5); ctx.lineTo(5, 1.5); ctx.lineTo(1, 5); ctx.lineTo(-4, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'leech': // Sangsue Écarlate
        drawFx(ctx, 'circle_05', x, y, 13, color, 0.7);
        drawFx(ctx, 'trace_01', x - this.vx * 0.5, y - this.vy * 0.5, 5, color, 0.9, dir + Math.PI / 2, 2.2);
        drawFx(ctx, 'circle_05', x, y, 4, '#ff9aa8', 1);
        break;
      case 'teleport': // Translocation
        drawFx(ctx, 'twirl_02', x, y, 16, color, 1, spin * 3);
        drawFx(ctx, 'circle_05', x, y, 6, '#ffffff', 1);
        break;
      case 'meteor':
        if (this.isSubCluster) {
          drawFx(ctx, 'circle_05', x, y, 22, '#ff6a1a', 0.7);
          drawFx(ctx, 'flame_05', x - this.vx * 1.2, y - this.vy * 1.2, 14, '#ffb347', 0.9, dir - Math.PI / 2, 0.8);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#3b1d0c';
          ctx.beginPath();
          ctx.arc(x, y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          drawFx(ctx, 'circle_05', x, y, 6, '#ffd08a', 0.8);
        } else {
          // Target beacon
          drawFx(ctx, 'magic_01', x, y, 12 + pulse * 3, color, 0.8, now * 0.002);
          drawFx(ctx, 'circle_05', x, y, 6, '#ffd08a', 1);
        }
        break;
      default:
        drawFx(ctx, 'circle_05', x, y, 8, color, 1);
    }
    ctx.restore();
  }
}
