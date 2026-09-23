import { CONFIG } from '../config';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { Terrain } from './Terrain';
import { NinjaRope } from './NinjaRope';
import { ParticleManager } from './Particles';
import { sound } from './SoundEffects';

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

  // State
  public health: number = CONFIG.DEFAULT_HEALTH;
  public frags: number = 0;
  public deaths: number = 0;
  public grounded: boolean = false;
  public isDigging: boolean = false;
  public respawnTimer: number = 0;

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

  public resetAmmo() {
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

  public spawn(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.health = CONFIG.DEFAULT_HEALTH;
    this.respawnTimer = 0;
    this.rope.release();
    this.resetAmmo();
  }

  public isAlive(): boolean {
    return this.health > 0;
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
      this.deaths++;
      this.respawnTimer = CONFIG.RESPAWN_DELAY_FRAMES;
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

    // Reeling controls when rope is attached
    const reelIn = this.rope.isAttached() && (input.jump || (input.up && input.aimAngle !== undefined));
    const reelOut = this.rope.isAttached() && (input.down && input.aimAngle !== undefined);
    this.rope.update(this, terrain, reelIn, reelOut);

    // Gravity
    this.vy = Math.min(CONFIG.MAX_FALL_SPEED, this.vy + CONFIG.GRAVITY);

    // Ground & Dig check
    this.grounded = terrain.isSolid(this.x, this.y + this.radius + 1);

    // Movement & Digging
    let moveDir = 0;
    if (input.left) moveDir -= 1;
    if (input.right) moveDir += 1;

    if (moveDir !== 0) {
      if (input.aimAngle === undefined) {
        this.facing = moveDir;
      }

      const checkAheadX = this.x + moveDir * (this.radius + 2);
      const isBlocked = terrain.isSolid(checkAheadX, this.y);

      if (isBlocked && terrain.isDirt(checkAheadX, this.y)) {
        // Digging into soft dirt!
        this.isDigging = true;
        terrain.carveCircle(checkAheadX, this.y, CONFIG.DIG_RADIUS);
        particles.spawn(checkAheadX, this.y, -moveDir * 1.5, -0.8, 'dirt', undefined, 2, 20);

        if (this.digSoundCooldown <= 0) {
          sound.playDig();
          this.digSoundCooldown = 9;
        }

        // Slow burrow speed
        this.vx += moveDir * (CONFIG.WORM_SPEED * CONFIG.DIG_SPEED_FACTOR);
      } else {
        this.isDigging = false;
        // Normal walking
        this.vx += moveDir * (this.grounded ? CONFIG.WORM_SPEED : CONFIG.WORM_SPEED * 0.4);
      }
    } else {
      this.isDigging = false;
    }

    // Downward digging
    if (input.down && !this.rope.isAttached()) {
      const checkBelowY = this.y + this.radius + 2;
      if (terrain.isDirt(this.x, checkBelowY)) {
        this.isDigging = true;
        terrain.carveCircle(this.x, checkBelowY, CONFIG.DIG_RADIUS);
        particles.spawn(this.x, checkBelowY, (Math.random() - 0.5) * 1.5, -1.0, 'dirt', undefined, 2, 20);

        if (this.digSoundCooldown <= 0) {
          sound.playDig();
          this.digSoundCooldown = 9;
        }
        this.vy += CONFIG.WORM_SPEED * CONFIG.DIG_SPEED_FACTOR * 0.5;
      }
    }

    // Jump
    if (input.jump && this.grounded && !this.rope.isAttached()) {
      this.vy = -CONFIG.WORM_JUMP_FORCE;
      this.grounded = false;
    }

    // Friction
    if (this.grounded) {
      this.vx *= CONFIG.GROUND_FRICTION;
    } else {
      this.vx *= CONFIG.AIR_FRICTION;
      this.vy *= CONFIG.AIR_FRICTION;
    }

    // Physics step & Slope climbing
    this.resolvePhysics(terrain);

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
    if (this.clipAmmo <= 0) {
      // Reload clip
      this.clipReloadCooldown = weapon.clipReloadTime;
      return;
    }

    this.clipAmmo--;
    this.shotCooldown = weapon.reloadTime;

    // Apply recoil knockback
    const recoilForce = weapon.recoil;
    this.vx -= Math.cos(this.aimAngle) * recoilForce;
    this.vy -= Math.sin(this.aimAngle) * recoilForce;

    // Play weapon sound
    if (weapon.id === 'bazooka') sound.playBazooka();
    else if (weapon.id === 'minigun') sound.playMinigun();
    else if (weapon.id === 'shotgun') sound.playShotgun();
    else if (weapon.id === 'gauss') sound.playLaser();
    else if (weapon.id === 'grenade' || weapon.id === 'chiquita') sound.playGrenadeBounce();

    // Spawn muzzle sparks
    const muzzleX = this.x + Math.cos(this.aimAngle) * 9;
    const muzzleY = this.y + Math.sin(this.aimAngle) * 9;
    particles.spawn(muzzleX, muzzleY, Math.cos(this.aimAngle) * 2, Math.sin(this.aimAngle) * 2, 'spark', undefined, 2, 10);

    // Shoot weapon
    onShoot(this, weapon, this.aimAngle);

    // Auto-reload when clip empty
    if (this.clipAmmo <= 0) {
      this.clipReloadCooldown = weapon.clipReloadTime;
    }
  }

  private resolvePhysics(terrain: Terrain) {
    // Sub-step movement to prevent clipping
    const steps = 3;
    const stepVx = this.vx / steps;
    const stepVy = this.vy / steps;

    for (let s = 0; s < steps; s++) {
      // Move Horizontal
      const targetX = this.x + stepVx;
      if (!terrain.isSolid(targetX, this.y)) {
        this.x = targetX;
      } else {
        // Try slope climbing (step up 1-3px)
        let climbed = false;
        for (let stepUp = 1; stepUp <= 3; stepUp++) {
          if (!terrain.isSolid(targetX, this.y - stepUp)) {
            this.x = targetX;
            this.y -= stepUp;
            climbed = true;
            break;
          }
        }
        if (!climbed) {
          this.vx = 0;
        }
      }

      // Move Vertical
      const targetY = this.y + stepVy;
      if (!terrain.isSolid(this.x, targetY)) {
        this.y = targetY;
      } else {
        if (this.vy > 0) {
          this.grounded = true;
        }
        this.vy = 0;
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
