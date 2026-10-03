import { CONFIG } from '../config';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_LOADOUT, FREE_WEAPONS, MONEY_START } from '../weapons/WeaponRegistry';
import { Terrain } from './Terrain';
import { NinjaRope } from './NinjaRope';
import { ParticleManager } from './Particles';
import { sound } from './SoundEffects';
import { MatchModifiers, DEFAULT_MODIFIERS } from '../net/Protocol';

export interface WormInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  fire: boolean;
  rope: boolean;
  weaponSlot?: number; // 0..4
  nextWeapon?: boolean;
  prevWeapon?: boolean;
  aimAngle?: number; // optional direct mouse aim angle
}

export class Worm {
  public id: string;
  public name: string;
  public color: string;
  public isAI: boolean;

  // Transform & Kinematics
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 5.5; // collision sphere
  public facing: number = 1; // 1 = right, -1 = left
  public aimAngle: number = 0; // radians

  // State & Modifiers
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public maxHealth: number = CONFIG.DEFAULT_HEALTH;
  public health: number = CONFIG.DEFAULT_HEALTH;
  public frags: number = 0;
  public deaths: number = 0;
  public money: number = MONEY_START; // current money balance
  public grounded: boolean = false;
  public isDigging: boolean = false;
  public respawnTimer: number = 0;
  public freezeTimer: number = 0;     // frames remaining frozen
  /** true = le joueur est en train de choisir son arme dans la boutique, NE PAS respawner */
  public waitingForShop: boolean = false;
  private regenAccum: number = 0;     // fractional HP accumulator for regen

  // Rope & Animation
  public rope: NinjaRope;
  public animTimer: number = 0;

  // Weapons & Inventory
  public weapons: WeaponDef[] = [];
  public currentWeaponIndex: number = 0;
  public shotCooldown: number = 0;
  public clipAmmo: number = 0;
  public clipReloadCooldown: number = 0;

  // Sound cooldowns
  private digSoundCooldown: number = 0;

  constructor(id: string, name: string, color: string, isAI: boolean = false, loadout: WeaponId[] = DEFAULT_LOADOUT) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.isAI = isAI;
    this.rope = new NinjaRope();

    this.setLoadout(loadout);
  }

  public setLoadout(loadout: WeaponId[]) {
    const id = loadout[0] || 'bazooka';
    this.weapons = [WEAPON_REGISTRY[id] || WEAPON_REGISTRY.bazooka];
    this.currentWeaponIndex = 0;
    this.resetAmmo();
  }

  /** Ajoute une arme à l'arsenal sans coût (used lors du respawn) */
  public addWeapon(id: WeaponId) {
    const def = WEAPON_REGISTRY[id];
    if (!def) return;
    this.weapons = [def];
    this.currentWeaponIndex = 0;
    this.resetAmmo();
  }

  /** Achète une arme si assez d'argent et l'ajoute. Retourne true si succès. */
  public buyWeapon(id: WeaponId): boolean {
    const def = WEAPON_REGISTRY[id];
    if (!def) return false;
    if (this.money < def.price) return false;
    this.money -= def.price;
    // Remplace tout le loadout par une seule arme achetée
    this.weapons = [def];
    this.currentWeaponIndex = 0;
    this.resetAmmo();
    return true;
  }

  public applyModifiers(mods: MatchModifiers) {
    this.modifiers = { ...mods };
    this.maxHealth = mods.maxHealth;
    this.health = Math.min(this.health, this.maxHealth);
    this.rope.setModifiers(mods.ropeReach);
    if (mods.unlimitedAmmo) {
      this.clipAmmo = 999;
    }
  }

  public resetAmmo() {
    if (this.modifiers.unlimitedAmmo) {
      this.clipAmmo = 999;
      this.shotCooldown = 0;
      this.clipReloadCooldown = 0;
      return;
    }
    const cur = this.getCurrentWeapon();
    if (cur) {
      this.clipAmmo = cur.clipSize;
      this.shotCooldown = 0;
      this.clipReloadCooldown = 0;
    }
  }

  public getCurrentWeapon(): WeaponDef {
    return this.weapons[0] || WEAPON_REGISTRY.bazooka;
  }

  public selectWeapon(_index: number) {
    // Single weapon mode — no switching
  }

  public nextWeapon() {
    // Single weapon mode — no switching
  }

  public prevWeapon() {
    // Single weapon mode — no switching
  }

  public spawn(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.health = this.maxHealth;
    this.respawnTimer = 0;
    this.waitingForShop = false;
    this.rope.release();
    this.resetAmmo();
  }

  public isAlive(): boolean {
    return this.health > 0;
  }

  public freeze(frames: number) {
    this.freezeTimer = Math.max(this.freezeTimer, frames);
  }

  public takeDamage(amount: number, knockX: number, knockY: number, attackerId: string) {
    if (!this.isAlive()) return;

    this.health = Math.max(0, this.health - amount);
    this.vx += knockX;
    this.vy += knockY;

    if (amount > 0) {
      sound.playHurt();
    }

    if (this.health <= 0) {
      // respawnTimer and waitingForShop are set by Game.ts depending on local/remote
      this.rope.release();
      sound.playDie();
    }
  }

  public update(
    input: WormInput,
    terrain: Terrain,
    particles: ParticleManager,
    onShoot: (worm: Worm, weapon: WeaponDef, angle: number) => void
  ) {
    if (!this.isAlive()) {
      if (this.respawnTimer > 0) {
        this.respawnTimer--;
      }
      return;
    }

    // Reset grounded each frame — resolvePhysics will set it again accurately
    const wasGrounded = this.grounded;
    this.grounded = terrain.isSolid(this.x, this.y + this.radius + 1) ||
                    terrain.isSolid(this.x - 3, this.y + this.radius + 1) ||
                    terrain.isSolid(this.x + 3, this.y + this.radius + 1);
    // Clamp downward velocity to 0 when landing to prevent accumulation
    if (this.grounded && !wasGrounded && this.vy > 0) {
      this.vy = 0;
    }

    // Freeze effect: can't move or shoot while frozen
    if (this.freezeTimer > 0) {
      this.freezeTimer--;
      // Spawn ice-blue particles every 10 frames as a visual cue
      if (this.freezeTimer % 10 === 0) {
        particles.spawn(this.x, this.y, (Math.random() - 0.5) * 0.5, -0.5, 'spark', '#aaddff', 2, 20);
      }
      // Still apply gravity and physics, but skip movement input
      const frozenGravity = CONFIG.GRAVITY * this.modifiers.gravity;
      this.vy = Math.min(CONFIG.MAX_FALL_SPEED, this.vy + frozenGravity);
      this.resolvePhysics(terrain);
      return; // skip rest of update
    }

    // Cooldown timers
    if (this.shotCooldown > 0) this.shotCooldown--;
    if (this.clipReloadCooldown > 0) {
      this.clipReloadCooldown--;
      if (this.clipReloadCooldown === 0) {
        this.clipAmmo = this.getCurrentWeapon().clipSize;
      }
    }
    if (this.digSoundCooldown > 0) this.digSoundCooldown--;

    // Aiming angle
    if (input.aimAngle !== undefined) {
      this.aimAngle = input.aimAngle;
      this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
    } else {
      // Classic Keyboard aiming
      const aimSpeed = 0.055;
      if (input.up) {
        this.aimAngle -= this.facing * aimSpeed;
      }
      if (input.down) {
        this.aimAngle += this.facing * aimSpeed;
      }
    }

    // Rope Handling
    if (input.rope) {
      if (!this.rope.isActive()) {
        this.rope.shoot(this.x, this.y, this.aimAngle);
      }
    } else {
      if (this.rope.isActive()) {
        this.rope.release();
      }
    }

    // Gravity with modifier — only apply if not grounded (prevents vy accumulation on ground)
    const effGravity = CONFIG.GRAVITY * this.modifiers.gravity;
    if (!this.grounded) {
      this.vy = Math.min(CONFIG.MAX_FALL_SPEED, this.vy + effGravity);
    } else {
      // Keep a small downward push to maintain ground contact on slopes
      this.vy = Math.min(CONFIG.MAX_FALL_SPEED, Math.max(0, this.vy) + effGravity * 0.3);
    }

    // Movement
    let moveDir = 0;
    if (input.left) moveDir -= 1;
    if (input.right) moveDir += 1;

    if (moveDir !== 0 && input.aimAngle === undefined) {
      this.facing = moveDir;
    }

    const maxWalkSpeed = 1.2 * this.modifiers.wormSpeed;

    if (this.rope.isAttached()) {
      // ── Physique de balancement pendulaire fluide (Liero-style) ──────────
      // 1. Accélération de balancement dans la direction demandée (Left/Right)
      if (moveDir !== 0) {
        this.vx += moveDir * 0.16 * this.modifiers.wormSpeed;
      }

      // 2. Contrainte radiale de vitesse le long du filin
      const hx = this.x - this.rope.hookX;
      const hy = this.y - this.rope.hookY;
      const dist = Math.hypot(hx, hy);
      if (dist > 0.001) {
        const ox = hx / dist;
        const oy = hy / dist;
        const radialVel = this.vx * ox + this.vy * oy;
        // Supprimer la vitesse d'éloignement radial dès que la corde est tendue
        if (dist >= this.rope.length - 1.0 && radialVel > 0) {
          this.vx -= ox * radialVel;
          this.vy -= oy * radialVel;
        }
      }

      // 3. Cap de vitesse totale lors du swing
      const maxSwingSpeed = 4.2 * this.modifiers.wormSpeed;
      const spd = Math.hypot(this.vx, this.vy);
      if (spd > maxSwingSpeed) {
        const ratio = maxSwingSpeed / spd;
        this.vx *= ratio;
        this.vy *= ratio;
      }

      // Friction d'air naturelle
      this.vx *= 0.996;
      this.vy *= 0.996;

    } else if (this.grounded) {
      // Ground movement: crisp acceleration capped at walking speed
      if (moveDir !== 0) {
        this.vx += moveDir * (0.32 * this.modifiers.wormSpeed);
        this.vx = Math.max(-maxWalkSpeed, Math.min(maxWalkSpeed, this.vx));
      }
      this.vx *= CONFIG.GROUND_FRICTION;
    } else {
      // Air movement: gentle steering that NEVER exceeds walking speed
      if (moveDir !== 0) {
        if (moveDir > 0) {
          if (this.vx < maxWalkSpeed) {
            this.vx = Math.min(maxWalkSpeed, this.vx + 0.08 * this.modifiers.wormSpeed);
          }
        } else if (moveDir < 0) {
          if (this.vx > -maxWalkSpeed) {
            this.vx = Math.max(-maxWalkSpeed, this.vx - 0.08 * this.modifiers.wormSpeed);
          }
        }
      }

      // Air drag: high speeds (slingshot or explosion knockback) are preserved,
      // while regular jump velocities decelerate smoothly if keys are released
      if (Math.abs(this.vx) > maxWalkSpeed) {
        this.vx *= 0.992;
      } else if (moveDir === 0) {
        this.vx *= 0.96;
      }
    }
    this.isDigging = false;

    // Jump
    if (input.jump && this.grounded && !this.rope.isAttached()) {
      this.vy = -CONFIG.WORM_JUMP_FORCE;
      this.grounded = false;
    }

    // Reeling controls when rope is attached (Z/W/Jump to climb, S/Down to descend)
    const reelIn = this.rope.isAttached() && (input.up || input.jump);
    const reelOut = this.rope.isAttached() && input.down;
    this.rope.update(this, terrain, reelIn, reelOut);

    // Physics step & Slope climbing with Continuous Collision Detection
    this.resolvePhysics(terrain);

    // HP Regeneration (from modifiers) — regenRate is HP/second, game runs at 60fps
    if (this.modifiers.regenRate > 0 && this.isAlive()) {
      this.regenAccum += this.modifiers.regenRate / 60;
      if (this.regenAccum >= 1) {
        const healed = Math.floor(this.regenAccum);
        this.regenAccum -= healed;
        this.health = Math.min(this.health + healed, this.maxHealth);
      }
    }

    // Firing Weapons
    if (input.fire) {
      this.attemptFire(onShoot, particles);
    }
  }

  private attemptFire(
    onShoot: (worm: Worm, weapon: WeaponDef, angle: number) => void,
    particles: ParticleManager
  ) {
    if (this.shotCooldown > 0 || this.clipReloadCooldown > 0) return;

    const weapon = this.getCurrentWeapon();
    if (this.modifiers.unlimitedAmmo) {
      this.clipAmmo = 999;
    } else {
      if (this.clipAmmo <= 0) {
        this.clipReloadCooldown = weapon.clipReloadTime;
        return;
      }
      this.clipAmmo--;
    }

    this.shotCooldown = weapon.reloadTime;

    // Recoil knockback disabled for spells
    const recoilForce = weapon.recoil || 0;
    if (recoilForce > 0) {
      this.vx -= Math.cos(this.aimAngle) * recoilForce;
      this.vy -= Math.sin(this.aimAngle) * recoilForce;
    }

    // Play spell audio (sampled + synth)
    sound.playSpellForWeapon(weapon.id);

    // Spawn magical staff flare sparks with spell element color
    const elemColor = weapon.elementColor || '#ffd700';
    const muzzleX = this.x + Math.cos(this.aimAngle) * 12;
    const muzzleY = this.y + Math.sin(this.aimAngle) * 12;
    particles.spawn(muzzleX, muzzleY, Math.cos(this.aimAngle) * 2, Math.sin(this.aimAngle) * 2, 'spark', elemColor, 2.5, 12);

    // Shoot weapon
    onShoot(this, weapon, this.aimAngle);

    // Auto-reload when clip empty
    if (!this.modifiers.unlimitedAmmo && this.clipAmmo <= 0) {
      this.clipReloadCooldown = weapon.clipReloadTime;
    }
  }

  private resolvePhysics(terrain: Terrain) {
    // 1. Anti-embed safety: if worm center is inside solid terrain, nudge to safety
    if (terrain.isSolid(this.x, this.y)) {
      for (let offset = 1; offset <= 12; offset++) {
        if (!terrain.isSolid(this.x, this.y - offset)) { this.y -= offset; break; }
        if (!terrain.isSolid(this.x, this.y + offset)) { this.y += offset; break; }
        if (!terrain.isSolid(this.x - offset, this.y)) { this.x -= offset; break; }
        if (!terrain.isSolid(this.x + offset, this.y)) { this.x += offset; break; }
      }
    }

    // 2. Continuous Collision Detection (CCD) with dynamic sub-stepping
    // Maximum step distance is 1.5 pixels, making wall tunneling impossible even at high speed
    const speed = Math.hypot(this.vx, this.vy);
    const maxStep = 1.5;
    const steps = Math.max(2, Math.ceil(speed / maxStep));
    const stepVx = this.vx / steps;
    const stepVy = this.vy / steps;

    for (let s = 0; s < steps; s++) {
      // Horizontal movement
      if (Math.abs(stepVx) > 0.0001) {
        const targetX = this.x + stepVx;
        const dirX = stepVx > 0 ? 1 : -1;
        const rX = 4.8;

        // Front perimeter points (chest, head, and lower body)
        const isBlocked =
          terrain.isSolid(targetX + dirX * rX, this.y) ||
          terrain.isSolid(targetX + dirX * 3.5, this.y - 3.5) ||
          terrain.isSolid(targetX + dirX * 3.5, this.y + 1.8);

        if (!isBlocked) {
          this.x = targetX;
        } else {
          // Slope climbing (step up 1 to 4px)
          let climbed = false;
          for (let stepUp = 1; stepUp <= 4; stepUp++) {
            const testY = this.y - stepUp;
            const headBlocked =
              terrain.isSolid(targetX, testY - 5.0) ||
              terrain.isSolid(targetX + dirX * 3.0, testY - 4.5);
            const wallBlocked =
              terrain.isSolid(targetX + dirX * rX, testY) ||
              terrain.isSolid(targetX + dirX * 3.5, testY - 3.5);

            if (!headBlocked && !wallBlocked) {
              this.x = targetX;
              this.y = testY;
              climbed = true;
              break;
            }
          }
          if (!climbed) {
            this.vx = 0;
          }
        }

        // Downhill slope adherence when walking on ground
        if (this.grounded && !this.rope.isAttached() && Math.abs(stepVx) > 0.0001) {
          for (let stepDown = 1; stepDown <= 3; stepDown++) {
            if (terrain.isSolid(this.x, this.y + 5.0 + stepDown)) {
              this.y += stepDown;
              break;
            }
          }
        }
      }

      // Vertical movement
      if (Math.abs(stepVy) > 0.0001) {
        const targetY = this.y + stepVy;
        if (stepVy > 0) {
          // Moving down (feet)
          const feetY = targetY + 5.0;
          const hitGround =
            terrain.isSolid(this.x, feetY) ||
            terrain.isSolid(this.x - 3.2, feetY - 0.5) ||
            terrain.isSolid(this.x + 3.2, feetY - 0.5);

          if (!hitGround) {
            this.y = targetY;
          } else {
            this.grounded = true;
            this.vy = 0;
          }
        } else {
          // Moving up (head)
          const headY = targetY - 5.0;
          const hitCeiling =
            terrain.isSolid(this.x, headY) ||
            terrain.isSolid(this.x - 3.2, headY + 0.5) ||
            terrain.isSolid(this.x + 3.2, headY + 0.5);

          if (!hitCeiling) {
            this.y = targetY;
          } else {
            this.vy = Math.max(0, this.vy);
          }
        }
      }
    }

    // 3. Rope distance constraint post-movement via CCD stepped projection
    if (this.rope.isAttached()) {
      const hx = this.x - this.rope.hookX;
      const hy = this.y - this.rope.hookY;
      const dist = Math.hypot(hx, hy);
      const slack = dist - this.rope.length;
      if (slack > 0.5) {
        const ox = hx / dist;
        const oy = hy / dist;
        // Keep radial velocity in sync
        const rVel = this.vx * ox + this.vy * oy;
        if (rVel > 0) {
          this.vx -= ox * rVel;
          this.vy -= oy * rVel;
        }
        // Move in small steps toward the constraint point
        const stepSize = 1.5;
        const snapSteps = Math.ceil(slack / stepSize);
        const snapDx = -ox * slack / snapSteps;
        const snapDy = -oy * slack / snapSteps;
        for (let i = 0; i < snapSteps; i++) {
          const nx = this.x + snapDx;
          const ny = this.y + snapDy;
          const hBlocked =
            terrain.isSolid(nx + Math.sign(snapDx) * 4.8, this.y) ||
            terrain.isSolid(nx + Math.sign(snapDx) * 3.5, this.y - 3.5) ||
            terrain.isSolid(nx + Math.sign(snapDx) * 3.5, this.y + 1.8);
          if (!hBlocked || Math.abs(snapDx) < 0.01) this.x = nx;
          if (snapDy > 0) {
            const feetY = this.y + snapDy + 5.0;
            const vBlocked =
              terrain.isSolid(this.x, feetY) ||
              terrain.isSolid(this.x - 3.2, feetY - 0.5) ||
              terrain.isSolid(this.x + 3.2, feetY - 0.5);
            if (!vBlocked) this.y = this.y + snapDy;
          } else if (snapDy < 0) {
            const headY = this.y + snapDy - 5.0;
            const vBlocked =
              terrain.isSolid(this.x, headY) ||
              terrain.isSolid(this.x - 3.2, headY + 0.5) ||
              terrain.isSolid(this.x + 3.2, headY + 0.5);
            if (!vBlocked) this.y = this.y + snapDy;
          }
        }
      }
    }

    // Keep in world bounds
    this.x = Math.max(14, Math.min(terrain.width - 14, this.x));
    this.y = Math.max(14, Math.min(terrain.height - 14, this.y));
  }

  /**
   * Renders the Little Wizard ("Petit Sorcier") holding their Magic Staff ("Bâton de Sorcier").
   */
  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.isAlive()) return;

    this.animTimer = (this.animTimer || 0) + 1;

    // 1. Draw Arcane Tether first (under wizard)
    this.rope.draw(ctx, this.x, this.y);

    ctx.save();
    ctx.translate(this.x, this.y);

    const bobY = this.grounded ? 0 : Math.sin(this.animTimer * 0.14) * 1.2;
    const curWeapon = this.getCurrentWeapon();
    const spellColor = curWeapon.elementColor || '#ffaa33';

    // 2. Soft Shadow on ground
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Wizard Robe (Robe de Mage)
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(-4, -1 + bobY);
    ctx.lineTo(4, -1 + bobY);
    ctx.lineTo(5.5 * this.facing, 5.5 + bobY);
    ctx.lineTo(-5.5 * this.facing, 5.5 + bobY);
    ctx.closePath();
    ctx.fill();

    // Robe golden trim (Galon d'or)
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5.5 * this.facing, 5.5 + bobY);
    ctx.lineTo(5.5 * this.facing, 5.5 + bobY);
    ctx.stroke();

    // 4. Wizard Hood & Glowing Eyes
    // Hood circle
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, -3 + bobY, 4.8, 0, Math.PI * 2);
    ctx.fill();

    // Shadow interior of the hood
    ctx.fillStyle = '#0f0a1c';
    ctx.beginPath();
    ctx.ellipse(this.facing * 1.5, -3 + bobY, 3.2, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glowing Sorcerer Eyes (Yeux enchantés)
    const eyeX = this.facing * 2;
    const eyeY = -3.2 + bobY;
    ctx.fillStyle = '#66ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 4;
    ctx.fillRect(eyeX - 0.5, eyeY - 0.5, 2, 1.8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(eyeX + (this.facing > 0 ? 0.5 : -0.5), eyeY, 1, 1);
    ctx.shadowBlur = 0;

    // 5. Wizard Pointy Hat (Chapeau pointu de sorcier)
    // Hat brim
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, -5.5 + bobY, 6.5, 2.2, -this.facing * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#110a20';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Golden ribbon on hat
    ctx.strokeStyle = '#ffdd44';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -6.2 + bobY, 4.2, 1.4, -this.facing * 0.1, 0, Math.PI * 2);
    ctx.stroke();

    // Pointy cone with a charming backward crook
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(-4, -6 + bobY);
    ctx.quadraticCurveTo(-1, -12 + bobY, -this.facing * 4, -15.5 + bobY);
    ctx.lineTo(2.5, -6 + bobY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#110a20';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Golden Star at the tip of the hat
    ctx.fillStyle = '#ffee44';
    ctx.beginPath();
    ctx.arc(-this.facing * 4, -15.5 + bobY, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 6. Magic Staff ("Bâton de Sorcier")
    const handX = this.facing * 2.5;
    const handY = 0.5 + bobY;
    const aimCos = Math.cos(this.aimAngle);
    const aimSin = Math.sin(this.aimAngle);
    const staffLen = 13.5;
    const staffTipX = handX + aimCos * staffLen;
    const staffTipY = handY + aimSin * staffLen;
    const staffTailX = handX - aimCos * 4.5;
    const staffTailY = handY - aimSin * 4.5;

    // Staff Shaft (Bois ancien poli)
    ctx.strokeStyle = '#5a351e';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(staffTailX, staffTailY);
    ctx.lineTo(staffTipX, staffTipY);
    ctx.stroke();

    // Inner highlight on staff
    ctx.strokeStyle = '#8a5530';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(staffTailX, staffTailY);
    ctx.lineTo(staffTipX, staffTipY);
    ctx.stroke();

    // Staff Golden Crescent Mount at tip
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(staffTipX, staffTipY, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Arcane Spell Crystal (Orbe élémentaire radiant)
    const isCasting = this.shotCooldown > 0;
    const crystalRadius = isCasting ? 4.8 : 3.2;

    ctx.shadowColor = spellColor;
    ctx.shadowBlur = isCasting ? 14 : 7;
    ctx.fillStyle = spellColor;
    ctx.beginPath();
    ctx.arc(staffTipX + aimCos * 1.5, staffTipY + aimSin * 1.5, crystalRadius, 0, Math.PI * 2);
    ctx.fill();

    // Blazing white hot core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(staffTipX + aimCos * 1.5, staffTipY + aimSin * 1.5, crystalRadius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wizard Hand clasping the staff
    ctx.fillStyle = '#f5cda8';
    ctx.beginPath();
    ctx.arc(handX, handY, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 7. Arcane Aiming Glyph (Viseur runique)
    const reticleDist = 22;
    const rx = aimCos * reticleDist;
    const ry = aimSin * reticleDist;
    const runeRotation = this.animTimer * 0.05;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(runeRotation);

    // Glowing runic circle
    ctx.strokeStyle = spellColor;
    ctx.shadowColor = spellColor;
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.stroke();

    // Cardinal rune spikes
    for (let a = 0; a < 4; a++) {
      const ang = (a * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 4, Math.sin(ang) * 4);
      ctx.lineTo(Math.cos(ang) * 6.5, Math.sin(ang) * 6.5);
      ctx.stroke();
    }
    ctx.restore();

    // 8. Mini Health Bar (Barre de Vitalité)
    const barWidth = 22;
    const barHeight = 3.5;
    const hpRatio = Math.max(0, this.health / CONFIG.DEFAULT_HEALTH);

    // Parchment / stone frame
    ctx.fillStyle = 'rgba(15, 10, 8, 0.75)';
    ctx.fillRect(-barWidth / 2 - 1, -19, barWidth + 2, barHeight + 2);
    ctx.strokeStyle = '#8b6f47';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-barWidth / 2 - 1, -19, barWidth + 2, barHeight + 2);

    // HP fill
    ctx.fillStyle = hpRatio > 0.5 ? '#2bd461' : hpRatio > 0.25 ? '#ffaa22' : '#ee2b2b';
    ctx.fillRect(-barWidth / 2, -18, barWidth * hpRatio, barHeight);

    // Sorcerer Name
    ctx.font = '8px "MedievalSharp", "Press Start 2P", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffecb3';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillText(`🧙 ${this.name}`, 0, -22);

    ctx.restore();
  }
}
