import { CONFIG } from '../config';
import { WeaponDef, WeaponId, StatusEffect } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_WEAPON, MONEY_START } from '../weapons/WeaponRegistry';
import { Terrain } from './Terrain';
import { NinjaRope } from './NinjaRope';
import { ParticleManager } from './Particles';
import { MatchModifiers, DEFAULT_MODIFIERS } from '../net/Protocol';
import { Rules, rulesOf } from './Mutators';
import { WORLD_ENV } from './Env';
import { drawWizard, drawFx, WizardAnim, setFxAlpha } from './Sprites';

export interface WormInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  fire: boolean;
  rope: boolean;
  aimAngle?: number;
}

export interface WormFx {
  particles: ParticleManager;
  onShoot: (worm: Worm, weapon: WeaponDef, angle: number) => void;
  playSounds: boolean;
}

export const EMPTY_INPUT: WormInput = {
  left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false
};

// Collision probes, relative to the wizard's centre (sprite ≈ 10 × 11 px)
const FEET = 5;
const HEAD = 5;
const SIDE = 4.6;

/** Height of the painted wizard in world pixels, and where his feet are below the centre */
export const WIZARD_HEIGHT = 20;
export const WIZARD_FOOT = 5.7;
/** Robe colour of a frozen wizard */
export const FROZEN_ROBE = '#a8dcff';

export class Worm {
  public id: string;
  public name: string;
  public color: string;

  // Kinematics (prevX/prevY = position at the previous tick, for render interpolation)
  public x: number = 0;
  public y: number = 0;
  public prevX: number = 0;
  public prevY: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public readonly radius: number = 5.5;
  public facing: number = 1;
  public aimAngle: number = 0;

  // State
  public rules: Rules = rulesOf(DEFAULT_MODIFIERS.mutators);
  /** Ticks before this wizard can go through a portal again */
  public portalCooldown = 0;
  public maxHealth: number = 100;
  public health: number = 0;
  public frags: number = 0;
  public deaths: number = 0;
  public score: number = 0; // King of the hill: ticks spent alone in the zone
  public money: number = MONEY_START;
  public grounded: boolean = false;
  public freezeTimer: number = 0;
  public shieldTimer: number = 0;     // Égide Miroir: reflects enemy spells
  public burnTimer: number = 0;       // Souffle du Dragon: damage over time
  public burnBy: string = '';         // who set us on fire (kill credit)
  // Curses (ticks left) — synced by the host, also used by the client prediction
  public sheepTimer: number = 0;      // Métamorphose: a sheep, no spells, no rope
  public bubbleTimer: number = 0;     // Bulle: floats up, helpless
  public drunkTimer: number = 0;      // Ivresse: left/right swapped, wobbly aim
  /** Mains Foudroyantes: > 0 while the caster keeps the arcs going */
  public channelTimer: number = 0;
  /** Last time electric arcs hit this wizard (rendering) */
  public shockedAt = -1e9;
  /** Dead and choosing a spell in the grimoire — do not respawn automatically */
  public waitingForShop: boolean = true;
  private regenAccum: number = 0;

  public rope: NinjaRope = new NinjaRope();
  private ropeHeld: boolean = false;
  // Animation state (rendering only, in ms)
  private animTimer: number = 0;
  private castAt = -1e9;
  private hurtAt = -1e9;
  private seenHealth = 0;
  private runPhase = 0;
  private idlePhase = 0;
  private lastDrawAt = 0;
  private pose: { anim: WizardAnim; frame: number } = { anim: 'idle', frame: 0 };

  public weapon: WeaponDef = WEAPON_REGISTRY[DEFAULT_WEAPON];
  /** Ticks before the next cast */
  public shotCooldown: number = 0;

  constructor(id: string, name: string, color: string) {
    this.id = id;
    this.name = name;
    this.color = color;
  }

  public setWeapon(id: WeaponId) {
    this.weapon = WEAPON_REGISTRY[id] || WEAPON_REGISTRY[DEFAULT_WEAPON];
    this.shotCooldown = 0;
  }

  public applyModifiers(mods: MatchModifiers) {
    this.rules = rulesOf(mods.mutators);
    this.maxHealth = mods.maxHealth;
    this.health = Math.min(this.health, this.maxHealth);
    this.rope.setReach(this.rules.ropeReach);
  }

  public spawn(x: number, y: number) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.health = this.maxHealth;
    this.freezeTimer = 0;
    this.shieldTimer = 0;
    this.burnTimer = 0;
    this.clearCurses();
    this.channelTimer = 0;
    this.waitingForShop = false;
    this.rope.release();
    this.shotCooldown = 0;
  }

  /** Staff swing animation (called whenever a spell is cast, on every machine) */
  public onCast() {
    const now = performance.now();
    if (now - this.castAt > 150) this.castAt = now;
  }

  public clearCurses() {
    this.sheepTimer = 0;
    this.bubbleTimer = 0;
    this.drunkTimer = 0;
  }

  /** Lasting curse from a spell (the longest one wins). */
  public curse(status: StatusEffect, ticks: number) {
    if (status === 'sheep') this.sheepTimer = Math.max(this.sheepTimer, ticks);
    else if (status === 'bubble') this.bubbleTimer = Math.max(this.bubbleTimer, ticks);
    else this.drunkTimer = Math.max(this.drunkTimer, ticks);
    if (status !== 'drunk') this.rope.release();
  }

  public isAlive(): boolean {
    return this.health > 0;
  }

  public freeze(frames: number) {
    this.freezeTimer = Math.max(this.freezeTimer, frames);
    this.rope.release();
  }

  public takeDamage(amount: number, knockX: number, knockY: number) {
    if (!this.isAlive()) return;
    this.health = Math.max(0, this.health - amount);
    this.vx += knockX;
    this.vy += knockY;
    if (amount >= 5) this.bubbleTimer = 0; // a real hit pops the bubble
    if (this.health <= 0) this.rope.release();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Simulation (one tick)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * One simulation tick.
   * `fx` = null runs movement only (used by clients to replay unacknowledged inputs):
   * no timers, no firing, no sounds, no particles.
   */
  public update(input: WormInput, terrain: Terrain, fx: WormFx | null) {
    this.prevX = this.x;
    this.prevY = this.y;
    if (!this.isAlive()) return;

    if (fx) {
      if (this.shotCooldown > 0) this.shotCooldown--;
      if (this.channelTimer > 0) this.channelTimer--;
    }

    const frozen = this.freezeTimer > 0;
    this.step(input, terrain, fx);
    if (!fx || frozen) return;

    // HP regeneration (HP per second)
    if (this.rules.regenRate > 0) {
      this.regenAccum += this.rules.regenRate / 60;
      if (this.regenAccum >= 1) {
        const healed = Math.floor(this.regenAccum);
        this.regenAccum -= healed;
        this.health = Math.min(this.health + healed, this.maxHealth);
      }
    }

    if (input.fire) this.attemptFire(fx.onShoot);
  }

  /** Movement: aim, rope, walking, jumping, gravity and collisions. */
  private step(input: WormInput, terrain: Terrain, fx: WormFx | null) {
    this.grounded = this.blockedDown(terrain, this.x, this.y + 1);
    const groundMat = this.grounded ? this.groundMaterial(terrain) : CONFIG.MAT_AIR;
    const inFluid = terrain.fluidAt(this.x, this.y) !== 0;
    // Liquids: strong buoyancy, the wizard sinks slowly
    const g = CONFIG.GRAVITY * this.rules.gravity * (inFluid ? 0.2 : 1) * WORLD_ENV.gravityAt(this.x, this.y);
    if (this.portalCooldown > 0) this.portalCooldown--;

    if (this.sheepTimer > 0) this.sheepTimer--;
    if (this.drunkTimer > 0) this.drunkTimer--;

    // Frozen: no control at all, just fall and slide to a stop
    if (this.freezeTimer > 0) {
      this.freezeTimer--;
      if (fx && this.freezeTimer % 10 === 0) {
        fx.particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, -0.5, 'spark', '#aaddff', 2, 20);
      }
      this.applyGravity(g);
      this.vx *= this.grounded ? 0.85 : 0.99;
      this.resolvePhysics(terrain);
      this.ropeHeld = input.rope;
      return;
    }

    if (input.aimAngle !== undefined) {
      // Drunk: the aim sways around the mouse
      this.aimAngle = input.aimAngle + (this.drunkTimer > 0 ? Math.sin(this.drunkTimer * 0.09) * 0.5 : 0);
      this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
    }

    const playSounds = !!fx?.playSounds;

    // Bubble: floats up slowly, barely steerable, pops against the ceiling
    if (this.bubbleTimer > 0) {
      this.bubbleTimer--;
      if (this.rope.state !== 'idle') this.rope.release();
      this.ropeHeld = input.rope;
      const drift = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      this.vx = (this.vx + drift * 0.03) * 0.97;
      this.vy = Math.max(-0.7, Math.min(this.vy * 0.95, 1) - 0.045);
      if (this.blockedUp(terrain, this.x, this.y - 1.5)) this.bubbleTimer = 0;
      this.grounded = false;
      this.resolvePhysics(terrain);
      return;
    }
    const sheep = this.sheepTimer > 0;

    // Rope: fires on press (pressing again while attached re-fires), releases on button up
    if (input.rope && !this.ropeHeld && !sheep) {
      this.rope.shoot(this.x, this.y, this.aimAngle, playSounds);
    } else if (!input.rope && this.rope.state !== 'idle') {
      this.rope.release();
    }
    this.ropeHeld = input.rope;

    const attached = this.rope.isAttached();
    const speedMod = this.rules.wormSpeed;
    const walk = CONFIG.WORM_WALK_SPEED * speedMod * (sheep ? 1.35 : 1);
    // Drunk: left and right are swapped
    const moveDir = ((input.left ? -1 : 0) + (input.right ? 1 : 0)) * (this.drunkTimer > 0 ? -1 : 1);

    // Giant mushroom: trampoline (jump on it to go even higher)
    if (groundMat === CONFIG.MAT_BOUNCE && !attached && this.vy >= 0) {
      this.vy = -(input.jump ? CONFIG.BOUNCE_JUMP_FORCE : CONFIG.BOUNCE_FORCE);
      this.grounded = false;
    }

    this.applyGravity(g);

    if (this.grounded) {
      const onIce = groundMat === CONFIG.MAT_ICE;
      const top = onIce ? walk * 1.5 : walk;
      if (Math.abs(this.vx) > top * 1.5) {
        // Sliding after a blast or a swing: keep the momentum, lose it progressively
        this.vx *= onIce ? 0.99 : 0.9;
      } else if (onIce) {
        // Slippery: slow to accelerate, slow to stop
        if (moveDir !== 0) this.vx = Math.max(-top, Math.min(top, this.vx + moveDir * 0.07 * speedMod));
        this.vx *= 0.985;
      } else {
        if (moveDir !== 0) {
          this.vx = Math.max(-walk, Math.min(walk, this.vx + moveDir * 0.32 * speedMod));
        }
        this.vx *= inFluid ? 0.6 : CONFIG.GROUND_FRICTION;
      }
    } else if (inFluid && !attached) {
      // Swimming: up/jump to rise, everything is slowed down
      if (moveDir !== 0 && this.vx * moveDir < walk * 0.8) this.vx += moveDir * 0.1 * speedMod;
      if (input.up || input.jump) {
        // At the surface, a stroke leaps out of the water
        const atSurface = terrain.fluidAt(this.x, this.y - HEAD - 1) === 0;
        this.vy = atSurface && input.jump ? -CONFIG.WORM_JUMP_FORCE * 0.9 : this.vy - 0.24;
      }
      this.vx *= 0.9;
      this.vy *= 0.9;
    } else if (attached) {
      // Pump the swing
      if (moveDir !== 0) this.vx += moveDir * 0.12 * speedMod;
      this.vx *= 0.998;
      this.vy *= 0.998;
    } else {
      // Air steering never accelerates beyond walking speed, but keeps blast/slingshot momentum
      if (moveDir !== 0 && this.vx * moveDir < walk) {
        this.vx = moveDir > 0
          ? Math.min(walk, this.vx + 0.08 * speedMod)
          : Math.max(-walk, this.vx - 0.08 * speedMod);
      }
      if (Math.abs(this.vx) > walk) this.vx *= 0.995;
      else if (moveDir === 0) this.vx *= 0.96;
    }

    if (input.jump && this.grounded && !attached) {
      this.vy = -CONFIG.WORM_JUMP_FORCE * this.rules.jump * (sheep ? 1.3 : 1) * Math.sign(g || 1);
      this.grounded = false;
    }

    this.rope.update(this.x, this.y, terrain, attached && (input.up || input.jump), attached && input.down, playSounds);
    if (this.rope.isAttached()) this.applyRopeVelocityConstraint();

    this.resolvePhysics(terrain);
  }

  /** Material the wizard stands on (centre first, then the feet corners). */
  private groundMaterial(t: Terrain): number {
    for (const dx of [0, -3, 3]) {
      const m = t.materialAt(this.x + dx, this.y + FEET + 0.5);
      if (t.isSolid(this.x + dx, this.y + FEET + 0.5)) return m;
      const m2 = t.materialAt(this.x + dx, this.y + FEET + 1.5);
      if (t.isSolid(this.x + dx, this.y + FEET + 1.5)) return m2;
    }
    return CONFIG.MAT_AIR;
  }

  /** Overrides the "rope button held" memory (used when re-syncing with the host). */
  public setRopeHeld(held: boolean) {
    this.ropeHeld = held;
  }

  private applyGravity(g: number) {
    if (this.grounded && this.vy >= 0 && g >= 0) {
      // Resting on the ground. Upward velocity (jump, blast) is left untouched.
      this.vy = 0;
    } else {
      // (negative gravity inside an anomaly: falls upwards)
      this.vy = Math.max(-CONFIG.MAX_FALL_SPEED, Math.min(CONFIG.MAX_FALL_SPEED, this.vy + g));
    }
    // Storm: the wind pushes wizards that are in the air
    if (WORLD_ENV.wind !== 0 && !this.grounded && !this.rope.isAttached()) this.vx += WORLD_ENV.wind;
  }

  /** Removes the outward radial velocity when the tether is taut and caps the swing speed. */
  private applyRopeVelocityConstraint() {
    const hx = this.x - this.rope.hookX;
    const hy = this.y - this.rope.hookY;
    const dist = Math.hypot(hx, hy);
    if (dist < 0.001) return;
    const ox = hx / dist;
    const oy = hy / dist;
    const radialVel = this.vx * ox + this.vy * oy;
    if (dist >= this.rope.length - 0.5 && radialVel > 0) {
      this.vx -= ox * radialVel;
      this.vy -= oy * radialVel;
    }
    const max = CONFIG.ROPE_MAX_SWING_SPEED * this.rules.wormSpeed;
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > max) {
      this.vx *= max / spd;
      this.vy *= max / spd;
    }
  }

  /** A cast, then a short cooldown. A sheep cannot cast. */
  private attemptFire(onShoot: (worm: Worm, weapon: WeaponDef, angle: number) => void) {
    if (this.shotCooldown > 0 || this.sheepTimer > 0) return;
    this.shotCooldown = Math.max(1, Math.round(this.weapon.cooldown * this.rules.cooldownScale));
    onShoot(this, this.weapon, this.aimAngle);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Collision
  // ════════════════════════════════════════════════════════════════════════

  private blockedSide(t: Terrain, x: number, y: number, dir: number): boolean {
    return t.isSolid(x + dir * SIDE, y) ||
           t.isSolid(x + dir * 3.5, y - 3.5) ||
           t.isSolid(x + dir * 3.5, y + 2.5);
  }

  private blockedDown(t: Terrain, x: number, y: number): boolean {
    return t.isSolid(x, y + FEET) || t.isSolid(x - 3, y + FEET - 0.5) || t.isSolid(x + 3, y + FEET - 0.5);
  }

  private blockedUp(t: Terrain, x: number, y: number): boolean {
    return t.isSolid(x, y - HEAD) || t.isSolid(x - 3, y - HEAD + 0.5) || t.isSolid(x + 3, y - HEAD + 0.5);
  }

  /** Horizontal move with step-up (slopes / small ledges). Returns false when blocked. */
  private moveX(t: Terrain, dx: number, maxClimb: number): boolean {
    if (Math.abs(dx) < 1e-6) return true;
    const dir = dx > 0 ? 1 : -1;
    const targetX = this.x + dx;
    if (!this.blockedSide(t, targetX, this.y, dir)) {
      this.x = targetX;
      // Small bumps pass under the side probes: lift the feet out of the ground
      for (let up = 0; up < maxClimb && this.blockedDown(t, this.x, this.y - 0.5); up++) {
        if (this.blockedUp(t, this.x, this.y - 1)) break;
        this.y -= 1;
      }
      return true;
    }
    for (let up = 1; up <= maxClimb; up++) {
      const ty = this.y - up;
      if (!this.blockedSide(t, targetX, ty, dir) && !this.blockedUp(t, targetX, ty)) {
        this.x = targetX;
        this.y = ty;
        return true;
      }
    }
    return false;
  }

  /** Vertical move; stops flush against floors/ceilings. Returns false when blocked. */
  private moveY(t: Terrain, dy: number): boolean {
    if (Math.abs(dy) < 1e-6) return true;
    const blocked = (y: number) => (dy > 0 ? this.blockedDown(t, this.x, y) : this.blockedUp(t, this.x, y));
    if (!blocked(this.y + dy)) {
      this.y += dy;
      return true;
    }
    // Get as close as possible (no visible gap when landing)
    const step = dy / 4;
    for (let i = 0; i < 3 && !blocked(this.y + step); i++) this.y += step;
    return false;
  }

  private resolvePhysics(terrain: Terrain) {
    // 1. Un-embed if the centre ended up inside terrain (e.g. crater edge, spawn)
    if (terrain.isSolid(this.x, this.y)) {
      for (let off = 1; off <= 12; off++) {
        if (!terrain.isSolid(this.x, this.y - off)) { this.y -= off; break; }
        if (!terrain.isSolid(this.x - off, this.y)) { this.x -= off; break; }
        if (!terrain.isSolid(this.x + off, this.y)) { this.x += off; break; }
        if (!terrain.isSolid(this.x, this.y + off)) { this.y += off; break; }
      }
    }

    const wasGrounded = this.grounded;
    const attached = this.rope.isAttached();

    // 2. Sub-stepped movement (≤ 1 px per step: no tunnelling at any speed)
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    const sx = this.vx / steps;
    const sy = this.vy / steps;
    for (let s = 0; s < steps; s++) {
      if (sx !== 0 && !this.moveX(terrain, sx, wasGrounded ? 3 : 2)) {
        this.vx = 0;
      }
      // Stick to the ground when walking down a slope
      if (wasGrounded && !attached && this.vy >= 0 && sx !== 0) {
        for (let down = 1; down <= 3; down++) {
          if (this.blockedDown(terrain, this.x, this.y + down)) {
            this.y += down - 1;
            break;
          }
        }
      }
      if (sy !== 0 && !this.moveY(terrain, sy)) {
        if (sy > 0) this.grounded = true;
        this.vy = 0;
      }
    }

    // 3. Tether length constraint: pull back towards the anchor, with collisions
    if (this.rope.isAttached()) {
      const hx = this.x - this.rope.hookX;
      const hy = this.y - this.rope.hookY;
      const dist = Math.hypot(hx, hy);
      const excess = dist - this.rope.length;
      if (excess > 0.01 && dist > 0.001) {
        const ox = hx / dist;
        const oy = hy / dist;
        const n = Math.ceil(excess);
        for (let i = 0; i < n; i++) {
          const movedX = this.moveX(terrain, -ox * excess / n, 0);
          const movedY = this.moveY(terrain, -oy * excess / n);
          if (!movedX && !movedY) break;
        }
        const radialVel = this.vx * ox + this.vy * oy;
        if (radialVel > 0) {
          this.vx -= ox * radialVel;
          this.vy -= oy * radialVel;
        }
      }
    }

    // 4. Stay inside the world
    this.x = Math.max(14, Math.min(terrain.width - 14, this.x));
    this.y = Math.max(14, Math.min(terrain.height - 14, this.y));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Rendering — painted, animated wizard (robe in the player's colour)
  // ════════════════════════════════════════════════════════════════════════

  /** Picks the animation frame: hurt > casting > airborne > running > idle. */
  private updatePose(terrain: Terrain, now: number) {
    const dt = Math.min(100, now - (this.lastDrawAt || now));
    this.lastDrawAt = now;
    if (this.health < this.seenHealth - 3) this.hurtAt = now;
    this.seenHealth = this.health;
    if (this.freezeTimer > 0) return; // frozen in place

    const sinceHurt = now - this.hurtAt;
    const sinceCast = now - this.castAt;
    const speed = Math.abs(this.x - this.prevX);
    const onGround = this.grounded || this.blockedDown(terrain, this.x, this.y + 1.5);
    const pose = this.pose;
    if (now - this.shockedAt < 150) {
      // Electrocuted: convulsions
      pose.anim = 'damage';
      pose.frame = Math.floor(now / 45) % 7;
    } else if (this.channelTimer > 0) {
      // Casting the arcs: staff thrust forward
      pose.anim = 'attack';
      pose.frame = 5;
    } else if (sinceHurt < 260) {
      pose.anim = 'damage';
      pose.frame = Math.floor((sinceHurt / 260) * 7);
    } else if (sinceCast < 250) {
      // Starts with the staff already raised: the spell leaves on the swing
      pose.anim = 'attack';
      pose.frame = 2 + Math.floor((sinceCast / 250) * 5);
    } else if (!onGround && this.rope.state !== 'attached') {
      pose.anim = 'run';
      pose.frame = this.vy < 0 ? 4 : 10; // legs apart
    } else if (onGround && speed > 0.12) {
      this.runPhase += dt * (0.004 + Math.min(speed, 2) * 0.008);
      pose.anim = 'run';
      pose.frame = Math.floor(this.runPhase) % 13;
    } else {
      this.idlePhase += dt * 0.011;
      pose.anim = 'idle';
      pose.frame = Math.floor(this.idlePhase) % 13;
    }
  }

  /** `ghost`: Fantômes mutator — almost invisible unless casting or hurt */
  public draw(ctx: CanvasRenderingContext2D, alpha: number, isLocal: boolean, terrain: Terrain, now: number, ghost = false) {
    if (!this.isAlive()) {
      this.seenHealth = 0;
      return;
    }
    this.animTimer++;
    this.updatePose(terrain, now);
    if (ghost) {
      const since = Math.min(now - this.castAt, now - this.hurtAt, now - this.shockedAt);
      const vis = since < 900 ? 1 : since < 1500 ? 1 - ((since - 900) / 600) * 0.94 : 0.06;
      if (vis < 0.99) {
        ctx.save();
        ctx.globalAlpha = vis;
        setFxAlpha(vis);
        this.drawBody(ctx, alpha, isLocal, terrain, now);
        setFxAlpha(1);
        ctx.restore();
        return;
      }
    }
    this.drawBody(ctx, alpha, isLocal, terrain, now);
  }

  private drawBody(ctx: CanvasRenderingContext2D, alpha: number, isLocal: boolean, _terrain: Terrain, now: number) {

    const px = this.prevX + (this.x - this.prevX) * alpha;
    const py = this.prevY + (this.y - this.prevY) * alpha;
    const f = this.facing;
    const frozen = this.freezeTimer > 0;
    const spellColor = this.weapon.elementColor;
    const aimCos = Math.cos(this.aimAngle);
    const aimSin = Math.sin(this.aimAngle);

    this.rope.draw(ctx, px, py);

    // Wizard (or sheep)
    const footY = py + WIZARD_FOOT;
    const shocked = now - this.shockedAt < 150;
    const wx = px + (shocked ? (Math.random() - 0.5) * 1.4 : 0);
    const sheep = this.sheepTimer > 0;
    if (sheep) {
      this.drawSheep(ctx, wx, footY, f, now);
    } else {
      ctx.save();
      if (this.drunkTimer > 0) {
        // Drunk: sways around his feet
        ctx.translate(wx, footY);
        ctx.rotate(Math.sin(now * 0.005) * 0.16);
        ctx.translate(-wx, -footY);
      }
      if (!drawWizard(ctx, frozen ? FROZEN_ROBE : this.color, this.pose.anim, this.pose.frame, wx, footY, f, WIZARD_HEIGHT)) {
        ctx.fillStyle = this.color; // sprites still loading
        ctx.beginPath();
        ctx.ellipse(px, py - 3, 4.5, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (frozen) {
      // Encased in ice
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#cdeeff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.roundRect(px - 7.5, footY - WIZARD_HEIGHT - 1.5, 15, WIZARD_HEIGHT + 2, 2.5);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Spell focus: a glowing orb floating in the aim direction (bigger right after casting)
    if (!sheep) {
      const casting = this.shotCooldown > 0 || now - this.castAt < 200;
      const ox = px + f * 1.5 + aimCos * 9;
      const oy = py - 5 + aimSin * 9;
      const pulse = 0.85 + 0.15 * Math.sin(now * 0.008);
      drawFx(ctx, 'circle_05', ox, oy, (casting ? 15 : 10) * pulse, spellColor, 0.9);
      drawFx(ctx, 'star_04', ox, oy, casting ? 11 : 7, '#ffffff', 0.9, now * 0.002);
    }

    // Electrocuted: blue glow
    if (shocked) {
      drawFx(ctx, 'circle_05', px, py - 4, 26, '#6fa8ff', 0.55 + Math.random() * 0.3);
      drawFx(ctx, Math.random() < 0.5 ? 'spark_01' : 'spark_02', px, py - 4, 22, '#dff0ff', 0.8, Math.random() * 6.3);
    }

    // Drunk: little stars spinning around the head
    if (this.drunkTimer > 0) {
      for (let k = 0; k < 3; k++) {
        const a = now * 0.005 + (k * Math.PI * 2) / 3;
        drawFx(ctx, 'star_04', px + Math.cos(a) * 6, footY - (sheep ? 12 : WIZARD_HEIGHT) - 1 + Math.sin(a) * 1.8, 6, '#ffe36b', 0.95, a);
      }
    }

    // Bubble: soap bubble around the wizard
    if (this.bubbleTimer > 0) {
      const wob = Math.sin(now * 0.01) * 0.8;
      drawFx(ctx, 'light_01', px, py - 4, 30 + wob, '#bfe8ff', 0.35, now * 0.0008);
      drawFx(ctx, 'circle_02', px, py - 4, 29 - wob, '#e6f7ff', 0.7);
      drawFx(ctx, 'circle_05', px - 5, py - 11, 5, '#ffffff', 0.8);
    }

    // Mirror shield bubble
    if (this.shieldTimer > 0) {
      const fading = this.shieldTimer < 40 && Math.floor(this.shieldTimer / 5) % 2 === 0;
      const a = fading ? 0.35 : 0.8;
      drawFx(ctx, 'light_01', px, py - 4, 34, '#7fd4ff', a * 0.45, now * 0.001);
      drawFx(ctx, 'circle_02', px, py - 4, 30 + Math.sin(this.animTimer * 0.2), '#a8e6ff', a);
    }
    ctx.restore();

    // Aiming rune (only for the local player — the mouse already shows where others aim)
    if (isLocal) {
      ctx.save();
      ctx.translate(px + aimCos * 24, py - 3 + aimSin * 24);
      ctx.rotate(now * 0.003);
      ctx.strokeStyle = spellColor;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 2;
        ctx.moveTo(Math.cos(ang) * 3.5, Math.sin(ang) * 3.5);
        ctx.lineTo(Math.cos(ang) * 6, Math.sin(ang) * 6);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Health bar
    const barWidth = 20;
    const barY = footY - (sheep ? 12 : WIZARD_HEIGHT) - 5;
    const hpRatio = Math.max(0, Math.min(1, this.health / this.maxHealth));
    ctx.fillStyle = 'rgba(15, 10, 8, 0.75)';
    ctx.fillRect(px - barWidth / 2 - 0.75, barY - 0.75, barWidth + 1.5, 3.5);
    ctx.fillStyle = hpRatio > 0.5 ? '#2bd461' : hpRatio > 0.25 ? '#ffaa22' : '#ee2b2b';
    ctx.fillRect(px - barWidth / 2, barY, barWidth * hpRatio, 2);

    // Name
    ctx.font = '600 5.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.strokeText(this.name, px, barY - 2);
    ctx.fillStyle = '#ffecb3';
    ctx.fillText(this.name, px, barY - 2);
  }

  /** A fluffy sheep (with a ribbon in the player's colour) standing on (x, footY). */
  private drawSheep(ctx: CanvasRenderingContext2D, x: number, footY: number, f: number, now: number) {
    const moving = Math.abs(this.x - this.prevX) > 0.12;
    const step = moving ? Math.sin(now * 0.025) : 0;
    const by = footY - 5.5 - (moving ? Math.abs(step) * 0.8 : 0);
    ctx.save();
    // Legs
    ctx.strokeStyle = '#2b2420';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [lx, ph] of [[-3, 1], [-1.5, -1], [2, -1], [3.5, 1]] as const) {
      ctx.moveTo(x + lx * f, by + 2);
      ctx.lineTo(x + lx * f + step * ph * 1.2 * f, footY);
    }
    ctx.stroke();
    // Wool
    ctx.fillStyle = '#f6f2e8';
    ctx.strokeStyle = '#cfc7b6';
    ctx.lineWidth = 0.5;
    for (const [cx, cy, r] of [[-3.5, 0.5, 2.6], [-0.5, 1, 2.8], [2.5, 0.5, 2.6], [-2.5, -2, 2.7], [0.8, -2.3, 2.9], [3.2, -1.2, 2.3]] as const) {
      ctx.beginPath();
      ctx.arc(x + cx * f, by + cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Head, ear and eye
    const hx = x + 5.6 * f;
    const hy = by - 2.2 + (moving ? step * 0.4 : Math.sin(now * 0.004) * 0.3);
    ctx.fillStyle = '#2b2420';
    ctx.beginPath();
    ctx.ellipse(hx, hy, 2.3, 1.8, f * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx - 1.4 * f, hy - 1.5, 1.2, 0.6, -f * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hx + 0.6 * f, hy - 0.5, 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Ribbon in the player's colour
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(x + 4 * f, by - 0.5, 0.9, 1.9, f * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
