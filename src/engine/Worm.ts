import { CONFIG } from '../config';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { Terrain } from './Terrain';
import { NinjaRope } from './NinjaRope';
import { ParticleManager } from './Particles';
import { sound } from './SoundEffects';
import { MatchModifiers, DEFAULT_MODIFIERS } from '../net/Protocol';
import RAPIER from '@dimforge/rapier2d-compat';
import { RapierWorld, pxToM, mToPx, DynamicEntityAABB } from '../physics/RapierWorld';

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

  // Rapier Physics
  public rapierBody?: RAPIER.RigidBody;
  public rapierWorld?: RapierWorld;
  public onDeathRagdoll?: (worm: Worm, knockX: number, knockY: number) => void;

  // State & Modifiers
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public maxHealth: number = CONFIG.DEFAULT_HEALTH;
  public health: number = CONFIG.DEFAULT_HEALTH;
  public frags: number = 0;
  public deaths: number = 0;
  public grounded: boolean = false;
  public isDigging: boolean = false;
  public respawnTimer: number = 0;
  public freezeTimer: number = 0;     // frames remaining frozen
  private regenAccum: number = 0;     // fractional HP accumulator for regen

  // Rope
  public rope: NinjaRope;

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
    this.weapons = loadout.map(id => WEAPON_REGISTRY[id]);
    this.currentWeaponIndex = 0;
    this.resetAmmo();
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
    return this.weapons[this.currentWeaponIndex] || this.weapons[0];
  }

  public selectWeapon(index: number) {
    if (index >= 0 && index < this.weapons.length && index !== this.currentWeaponIndex) {
      this.currentWeaponIndex = index;
      this.resetAmmo();
    }
  }

  public nextWeapon() {
    this.selectWeapon((this.currentWeaponIndex + 1) % this.weapons.length);
  }

  public prevWeapon() {
    this.selectWeapon((this.currentWeaponIndex - 1 + this.weapons.length) % this.weapons.length);
  }

  public initRapier(rw: RapierWorld) {
    this.rapierWorld = rw;
    this.rope.setRapierWorld(rw);

    if (this.rapierBody) {
      try { rw.world.removeRigidBody(this.rapierBody); } catch {}
      this.rapierBody = undefined;
    }

    const bodyDesc = rw.rapier.RigidBodyDesc.dynamic()
      .setTranslation(pxToM(this.x), pxToM(this.y))
      .lockRotations()
      .setLinearDamping(0.2)
      .setCcdEnabled(true);
    this.rapierBody = rw.world.createRigidBody(bodyDesc);

    const colDesc = rw.rapier.ColliderDesc.capsule(pxToM(2.5), pxToM(4.2))
      .setFriction(0.4)
      .setRestitution(0.05)
      .setDensity(1.5);
    rw.world.createCollider(colDesc, this.rapierBody);
  }

  public syncFromRapier(terrain: Terrain) {
    if (!this.rapierBody || !this.isAlive()) return;

    const pos = this.rapierBody.translation();
    const vel = this.rapierBody.linvel();

    this.x = mToPx(pos.x);
    this.y = mToPx(pos.y);
    this.vx = mToPx(vel.x) / 60;
    this.vy = mToPx(vel.y) / 60;

    // Boundaries
    const clampedX = Math.max(14, Math.min(terrain.width - 14, this.x));
    const clampedY = Math.max(14, Math.min(terrain.height - 14, this.y));
    if (clampedX !== this.x || clampedY !== this.y) {
      this.x = clampedX;
      this.y = clampedY;
      this.rapierBody.setTranslation({ x: pxToM(this.x), y: pxToM(this.y) }, true);
    }

    // Grounded check based on terrain pixels below the worm
    this.grounded = terrain.isSolid(this.x, this.y + this.radius + 1) ||
                    terrain.isSolid(this.x - 3, this.y + this.radius + 1) ||
                    terrain.isSolid(this.x + 3, this.y + this.radius + 1);
  }

  public getAABB(): DynamicEntityAABB {
    return { x: this.x, y: this.y, radius: 28 };
  }

  public destroy() {
    this.rope.release();
    if (this.rapierBody && this.rapierWorld) {
      try {
        this.rapierWorld.world.removeRigidBody(this.rapierBody);
      } catch {}
      this.rapierBody = undefined;
    }
  }

  public spawn(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.health = this.maxHealth;
    this.respawnTimer = 0;
    this.rope.release();
    this.resetAmmo();

    if (this.rapierBody) {
      this.rapierBody.setTranslation({ x: pxToM(x), y: pxToM(y) }, true);
      this.rapierBody.setLinvel({ x: 0, y: 0 }, true);
      this.rapierBody.setEnabled(true);
    }
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

    if (this.rapierBody) {
      this.rapierBody.applyImpulse({ x: pxToM(knockX * 45), y: pxToM(knockY * 45) }, true);
    }

    if (amount > 0) {
      sound.playHurt();
    }

    if (this.health <= 0) {
      this.deaths++;
      this.respawnTimer = CONFIG.RESPAWN_DELAY_FRAMES;
      this.rope.release();
      sound.playDie();

      // Trigger ragdoll spawn in physics world!
      if (this.rapierWorld) {
        this.onDeathRagdoll?.(this, knockX, knockY);
        if (this.rapierBody) {
          this.rapierBody.setEnabled(false);
        }
      }
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

    // Weapon slot input
    if (input.weaponSlot !== undefined) {
      this.selectWeapon(input.weaponSlot);
    } else if (input.nextWeapon) {
      this.nextWeapon();
    } else if (input.prevWeapon) {
      this.prevWeapon();
    }

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

    if (this.rapierBody) {
      const curVel = this.rapierBody.linvel();
      const maxWalkM = pxToM(maxWalkSpeed * 60);

      if (this.rope.isAttached()) {
        // Swing pumping
        if (moveDir !== 0) {
          this.rapierBody.applyImpulse({ x: pxToM(moveDir * 0.12 * 60), y: 0 }, true);
        }
      } else if (this.grounded) {
        // Ground walking: direct crisp velocity with friction
        if (moveDir !== 0) {
          this.rapierBody.setLinvel({ x: moveDir * maxWalkM, y: curVel.y }, true);
        } else {
          this.rapierBody.setLinvel({ x: curVel.x * 0.72, y: curVel.y }, true);
        }
      } else {
        // Air steering
        if (moveDir !== 0) {
          this.rapierBody.applyImpulse({ x: pxToM(moveDir * 0.04 * 60), y: 0 }, true);
        }
      }

      // Jump
      if (input.jump && this.grounded && !this.rope.isAttached()) {
        this.rapierBody.setLinvel({ x: curVel.x, y: pxToM(-CONFIG.WORM_JUMP_FORCE * 60) }, true);
        this.grounded = false;
      }
    } else {
      // Classic Movement Fallback
      if (this.rope.isAttached()) {
        const maxSwingSpeed = 2.4 * this.modifiers.wormSpeed;
        if (moveDir !== 0) {
          this.vx += moveDir * (0.11 * this.modifiers.wormSpeed);
          this.vx = Math.max(-maxSwingSpeed, Math.min(maxSwingSpeed, this.vx));
        }
        this.vx *= 0.999;
      } else if (this.grounded) {
        if (moveDir !== 0) {
          this.vx += moveDir * (0.32 * this.modifiers.wormSpeed);
          this.vx = Math.max(-maxWalkSpeed, Math.min(maxWalkSpeed, this.vx));
        }
        this.vx *= CONFIG.GROUND_FRICTION;
      } else {
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

        if (Math.abs(this.vx) > maxWalkSpeed) {
          this.vx *= 0.992;
        } else if (moveDir === 0) {
          this.vx *= 0.96;
        }
      }

      // Jump
      if (input.jump && this.grounded && !this.rope.isAttached()) {
        this.vy = -CONFIG.WORM_JUMP_FORCE;
        this.grounded = false;
      }
    }
    this.isDigging = false;

    // Reeling controls when rope is attached (Z/W/Jump to climb, S/Down to descend)
    const reelIn = this.rope.isAttached() && (input.up || input.jump);
    const reelOut = this.rope.isAttached() && input.down;
    this.rope.update(this, terrain, reelIn, reelOut);

    // Physics step (only if not simulated by Rapier)
    if (!this.rapierBody) {
      this.resolvePhysics(terrain);
    }

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

    // Apply recoil knockback
    const recoilForce = weapon.recoil;
    this.vx -= Math.cos(this.aimAngle) * recoilForce;
    this.vy -= Math.sin(this.aimAngle) * recoilForce;

    if (this.rapierBody) {
      this.rapierBody.applyImpulse({
        x: pxToM(-Math.cos(this.aimAngle) * recoilForce * 40),
        y: pxToM(-Math.sin(this.aimAngle) * recoilForce * 40)
      }, true);
    }

    // Play weapon sound
    if (weapon.id === 'bazooka') sound.playBazooka();
    else if (weapon.id === 'minigun') sound.playMinigun();
    else if (weapon.id === 'shotgun') sound.playShotgun();
    else if (weapon.id === 'gauss' || weapon.id === 'railgun' || weapon.id === 'sniper') sound.playRailgun();
    else if (weapon.id === 'homing_missile' || weapon.id === 'mortar') sound.playHoming();
    else if (weapon.id === 'bouncy_ball' || weapon.id === 'boomerang') sound.playBouncy();
    else if (weapon.id === 'dart_gun') sound.playDart();
    else if (weapon.id === 'vortex') sound.playVortex();
    else if (weapon.id === 'grenade' || weapon.id === 'chiquita' || weapon.id === 'acid_bomb' || weapon.id === 'freeze_bomb') sound.playGrenadeBounce();
    else if (weapon.id === 'laser') sound.playDart();

    // Spawn muzzle sparks
    const muzzleX = this.x + Math.cos(this.aimAngle) * 9;
    const muzzleY = this.y + Math.sin(this.aimAngle) * 9;
    particles.spawn(muzzleX, muzzleY, Math.cos(this.aimAngle) * 2, Math.sin(this.aimAngle) * 2, 'spark', undefined, 2, 10);

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
    // Instead of a single teleport snap (which can tunnel through walls), move
    // incrementally toward the constraint point so the perimeter checks catch walls.
    if (this.rope.isAttached()) {
      const hx = this.x - this.rope.hookX;
      const hy = this.y - this.rope.hookY;
      const dist = Math.hypot(hx, hy);
      const slack = dist - this.rope.length;
      if (slack > 0.5) {
        const ox = hx / dist;
        const oy = hy / dist;
        // Move in small steps toward the constraint point
        const stepSize = 1.5;
        const snapSteps = Math.ceil(slack / stepSize);
        const snapDx = -ox * slack / snapSteps;
        const snapDy = -oy * slack / snapSteps;
        for (let i = 0; i < snapSteps; i++) {
          const nx = this.x + snapDx;
          const ny = this.y + snapDy;
          // Check horizontal move
          const hBlocked =
            terrain.isSolid(nx + Math.sign(snapDx) * 4.8, this.y) ||
            terrain.isSolid(nx + Math.sign(snapDx) * 3.5, this.y - 3.5) ||
            terrain.isSolid(nx + Math.sign(snapDx) * 3.5, this.y + 1.8);
          if (!hBlocked || Math.abs(snapDx) < 0.01) this.x = nx;
          // Check vertical move
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

  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.isAlive()) return;

    // 1. Draw Rope first (under worm)
    this.rope.draw(ctx, this.x, this.y);

    ctx.save();
    ctx.translate(this.x, this.y);

    // 2. Draw Worm Body (segmented authentic pixel-art worm)
    // Shadow / outline
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 1, 0, Math.PI * 2);
    ctx.fill();

    // Body base
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Tail segment
    const tailOffsetX = -this.facing * 3;
    ctx.beginPath();
    ctx.arc(tailOffsetX, 2, this.radius * 0.75, 0, Math.PI * 2);
    ctx.fill();

    // Eye (white + black pupil looking forward)
    const eyeX = this.facing * 2;
    const eyeY = -2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(eyeX - 1, eyeY - 1, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(eyeX + (this.facing > 0 ? 0 : -1), eyeY, 1, 2);

    // 3. Draw Gun & Aim reticle
    const curWeapon = this.getCurrentWeapon();
    const gunLen = 7;
    const aimCos = Math.cos(this.aimAngle);
    const aimSin = Math.sin(this.aimAngle);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(aimCos * gunLen, aimSin * gunLen);
    ctx.stroke();

    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(aimCos * gunLen, aimSin * gunLen);
    ctx.stroke();

    // Reticle
    const reticleDist = 20;
    const rx = aimCos * reticleDist;
    const ry = aimSin * reticleDist;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
    ctx.moveTo(rx - 5, ry);
    ctx.lineTo(rx + 5, ry);
    ctx.moveTo(rx, ry - 5);
    ctx.lineTo(rx, ry + 5);
    ctx.stroke();

    // 4. Floating Mini Health Bar above worm
    const barWidth = 20;
    const barHeight = 3;
    const hpRatio = Math.max(0, this.health / CONFIG.DEFAULT_HEALTH);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-barWidth / 2, -14, barWidth, barHeight);

    ctx.fillStyle = hpRatio > 0.5 ? '#33ee44' : hpRatio > 0.25 ? '#eeaa22' : '#ee2222';
    ctx.fillRect(-barWidth / 2, -14, barWidth * hpRatio, barHeight);

    // Name label
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.name, 0, -16);

    ctx.restore();
  }
}
