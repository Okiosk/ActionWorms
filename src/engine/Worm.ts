import { CONFIG } from '../config';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_WEAPON, MONEY_START } from '../weapons/WeaponRegistry';
import { Terrain } from './Terrain';
import { NinjaRope } from './NinjaRope';
import { ParticleManager } from './Particles';
import { MatchModifiers, DEFAULT_MODIFIERS } from '../net/Protocol';

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
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public maxHealth: number = 100;
  public health: number = 0;
  public frags: number = 0;
  public deaths: number = 0;
  public score: number = 0; // King of the hill: ticks spent alone in the zone
  public money: number = MONEY_START;
  public grounded: boolean = false;
  public freezeTimer: number = 0;
  /** Dead and choosing a spell in the grimoire — do not respawn automatically */
  public waitingForShop: boolean = true;
  private regenAccum: number = 0;

  public rope: NinjaRope = new NinjaRope();
  private ropeHeld: boolean = false;
  private animTimer: number = 0;

  public weapon: WeaponDef = WEAPON_REGISTRY[DEFAULT_WEAPON];
  public shotCooldown: number = 0;
  public clipAmmo: number = 0;
  public clipReloadCooldown: number = 0;

  constructor(id: string, name: string, color: string) {
    this.id = id;
    this.name = name;
    this.color = color;
  }

  public setWeapon(id: WeaponId) {
    this.weapon = WEAPON_REGISTRY[id] || WEAPON_REGISTRY[DEFAULT_WEAPON];
    this.resetAmmo();
  }

  public applyModifiers(mods: MatchModifiers) {
    this.modifiers = { ...mods };
    this.maxHealth = mods.maxHealth;
    this.health = Math.min(this.health, this.maxHealth);
    this.rope.setReach(mods.ropeReach);
  }

  public resetAmmo() {
    this.clipAmmo = this.weapon.clipSize;
    this.shotCooldown = 0;
    this.clipReloadCooldown = 0;
  }

  public spawn(x: number, y: number) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.health = this.maxHealth;
    this.freezeTimer = 0;
    this.waitingForShop = false;
    this.rope.release();
    this.resetAmmo();
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
      if (this.clipReloadCooldown > 0 && --this.clipReloadCooldown === 0) {
        this.clipAmmo = this.weapon.clipSize;
      }
    }

    const frozen = this.freezeTimer > 0;
    this.step(input, terrain, fx);
    if (!fx || frozen) return;

    // HP regeneration (HP per second)
    if (this.modifiers.regenRate > 0) {
      this.regenAccum += this.modifiers.regenRate / 60;
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
    const g = CONFIG.GRAVITY * this.modifiers.gravity;

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
      this.aimAngle = input.aimAngle;
      this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
    }

    const playSounds = !!fx?.playSounds;

    // Rope: fires on press (pressing again while attached re-fires), releases on button up
    if (input.rope && !this.ropeHeld) {
      this.rope.shoot(this.x, this.y, this.aimAngle, playSounds);
    } else if (!input.rope && this.rope.state !== 'idle') {
      this.rope.release();
    }
    this.ropeHeld = input.rope;

    const attached = this.rope.isAttached();
    const speedMod = this.modifiers.wormSpeed;
    const walk = CONFIG.WORM_WALK_SPEED * speedMod;
    const moveDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);

    this.applyGravity(g);

    if (this.grounded) {
      if (Math.abs(this.vx) > walk * 1.5) {
        // Sliding after a blast or a swing: keep the momentum, lose it progressively
        this.vx *= 0.9;
      } else {
        if (moveDir !== 0) {
          this.vx = Math.max(-walk, Math.min(walk, this.vx + moveDir * 0.32 * speedMod));
        }
        this.vx *= CONFIG.GROUND_FRICTION;
      }
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
      this.vy = -CONFIG.WORM_JUMP_FORCE;
      this.grounded = false;
    }

    this.rope.update(this.x, this.y, terrain, attached && (input.up || input.jump), attached && input.down, playSounds);
    if (this.rope.isAttached()) this.applyRopeVelocityConstraint();

    this.resolvePhysics(terrain);
  }

  /** Overrides the "rope button held" memory (used when re-syncing with the host). */
  public setRopeHeld(held: boolean) {
    this.ropeHeld = held;
  }

  private applyGravity(g: number) {
    if (this.grounded && this.vy >= 0) {
      // Resting on the ground. Upward velocity (jump, blast) is left untouched.
      this.vy = 0;
    } else {
      this.vy = Math.min(CONFIG.MAX_FALL_SPEED, this.vy + g);
    }
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
    const max = CONFIG.ROPE_MAX_SWING_SPEED * this.modifiers.wormSpeed;
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > max) {
      this.vx *= max / spd;
      this.vy *= max / spd;
    }
  }

  private attemptFire(onShoot: (worm: Worm, weapon: WeaponDef, angle: number) => void) {
    if (this.shotCooldown > 0 || this.clipReloadCooldown > 0) return;
    const weapon = this.weapon;

    if (!this.modifiers.unlimitedAmmo) {
      if (this.clipAmmo <= 0) {
        this.clipReloadCooldown = weapon.clipReloadTime;
        return;
      }
      this.clipAmmo--;
    }
    this.shotCooldown = weapon.reloadTime;
    onShoot(this, weapon, this.aimAngle);

    if (!this.modifiers.unlimitedAmmo && this.clipAmmo <= 0) {
      this.clipReloadCooldown = weapon.clipReloadTime;
    }
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
  // Rendering — the little wizard and his staff
  // ════════════════════════════════════════════════════════════════════════

  public draw(ctx: CanvasRenderingContext2D, alpha: number, isLocal: boolean) {
    if (!this.isAlive()) return;
    this.animTimer++;

    const px = this.prevX + (this.x - this.prevX) * alpha;
    const py = this.prevY + (this.y - this.prevY) * alpha;
    const f = this.facing;

    this.rope.draw(ctx, px, py);

    ctx.save();
    ctx.translate(px, py);

    const bobY = this.grounded ? 0 : Math.sin(this.animTimer * 0.14) * 1.2;
    const spellColor = this.weapon.elementColor;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Robe
    ctx.fillStyle = this.freezeTimer > 0 ? '#aaddff' : this.color;
    ctx.beginPath();
    ctx.moveTo(-4, -1 + bobY);
    ctx.lineTo(4, -1 + bobY);
    ctx.lineTo(5.5 * f, 5.5 + bobY);
    ctx.lineTo(-5.5 * f, 5.5 + bobY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5.5 * f, 5.5 + bobY);
    ctx.lineTo(5.5 * f, 5.5 + bobY);
    ctx.stroke();

    // Hood & glowing eyes
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, -3 + bobY, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f0a1c';
    ctx.beginPath();
    ctx.ellipse(f * 1.5, -3 + bobY, 3.2, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    const eyeX = f * 2;
    const eyeY = -3.2 + bobY;
    ctx.fillStyle = '#66ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 4;
    ctx.fillRect(eyeX - 0.5, eyeY - 0.5, 2, 1.8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(eyeX + (f > 0 ? 0.5 : -0.5), eyeY, 1, 1);
    ctx.shadowBlur = 0;

    // Pointy hat
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, -5.5 + bobY, 6.5, 2.2, -f * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#110a20';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = '#ffdd44';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -6.2 + bobY, 4.2, 1.4, -f * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(-4, -6 + bobY);
    ctx.quadraticCurveTo(-1, -12 + bobY, -f * 4, -15.5 + bobY);
    ctx.lineTo(2.5, -6 + bobY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#110a20';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#ffee44';
    ctx.beginPath();
    ctx.arc(-f * 4, -15.5 + bobY, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Staff
    const handX = f * 2.5;
    const handY = 0.5 + bobY;
    const aimCos = Math.cos(this.aimAngle);
    const aimSin = Math.sin(this.aimAngle);
    const tipX = handX + aimCos * 13.5;
    const tipY = handY + aimSin * 13.5;
    const tailX = handX - aimCos * 4.5;
    const tailY = handY - aimSin * 4.5;
    ctx.strokeStyle = '#5a351e';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = '#8a5530';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Crystal (bigger right after casting)
    const casting = this.shotCooldown > 0;
    const crystalR = casting ? 4.8 : 3.2;
    ctx.shadowColor = spellColor;
    ctx.shadowBlur = casting ? 14 : 7;
    ctx.fillStyle = spellColor;
    ctx.beginPath();
    ctx.arc(tipX + aimCos * 1.5, tipY + aimSin * 1.5, crystalR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tipX + aimCos * 1.5, tipY + aimSin * 1.5, crystalR * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#f5cda8';
    ctx.beginPath();
    ctx.arc(handX, handY, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Aiming rune (only for the local player — the mouse already shows where others aim)
    if (isLocal) {
      ctx.save();
      ctx.translate(aimCos * 22, aimSin * 22);
      ctx.rotate(this.animTimer * 0.05);
      ctx.strokeStyle = spellColor;
      ctx.shadowColor = spellColor;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 4, Math.sin(ang) * 4);
        ctx.lineTo(Math.cos(ang) * 6.5, Math.sin(ang) * 6.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Health bar
    const barWidth = 22;
    const hpRatio = Math.max(0, Math.min(1, this.health / this.maxHealth));
    ctx.fillStyle = 'rgba(15, 10, 8, 0.75)';
    ctx.fillRect(-barWidth / 2 - 1, -20, barWidth + 2, 4.5);
    ctx.fillStyle = hpRatio > 0.5 ? '#2bd461' : hpRatio > 0.25 ? '#ffaa22' : '#ee2b2b';
    ctx.fillRect(-barWidth / 2, -19.25, barWidth * hpRatio, 3);

    // Name
    ctx.font = '600 6px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffecb3';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillText(this.name, 0, -22.5);

    ctx.restore();
  }
}
