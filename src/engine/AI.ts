import { Worm, WormInput } from './Worm';
import { Terrain } from './Terrain';

export class AIController {
  private worm: Worm;
  private target: Worm | null = null;
  private thinkCooldown: number = 0;
  private currentInput: WormInput;
  private stuckTimer: number = 0;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(worm: Worm) {
    this.worm = worm;
    this.currentInput = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      fire: false,
      rope: false
    };
  }

  public update(allWorms: Worm[], terrain: Terrain): WormInput {
    if (!this.worm.isAlive()) {
      return {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false,
        fire: false,
        rope: false
      };
    }

    // Stuck detection
    if (Math.hypot(this.worm.x - this.lastX, this.worm.y - this.lastY) < 1.0) {
      this.stuckTimer++;
    } else {
      this.stuckTimer = 0;
    }
    this.lastX = this.worm.x;
    this.lastY = this.worm.y;

    // Pick closest alive enemy target
    this.target = null;
    let minDist = Infinity;
    for (const other of allWorms) {
      if (other.id !== this.worm.id && other.isAlive()) {
        const d = Math.hypot(other.x - this.worm.x, other.y - this.worm.y);
        if (d < minDist) {
          minDist = d;
          this.target = other;
        }
      }
    }

    if (!this.target) {
      return {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false,
        fire: false,
        rope: false
      };
    }

    // AI Decision loop
    const dx = this.target.x - this.worm.x;
    const dy = this.target.y - this.worm.y;
    const dist = Math.hypot(dx, dy);

    // Aim calculation with slight intentional human-like jitter
    const baseAngle = Math.atan2(dy, dx);
    const leadFactor = Math.min(dist * 0.003, 0.25);
    const targetVx = this.target.vx || 0;
    const targetVy = this.target.vy || 0;
    const leadAngle = Math.atan2(dy + targetVy * 10 * leadFactor, dx + targetVx * 10 * leadFactor);

    // Smooth aim towards target
    const currentAngle = this.worm.aimAngle;
    let diff = leadAngle - currentAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const aimSpeed = 0.08;
    const newAimAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), aimSpeed);

    // Line of sight check
    const hasLOS = this.checkLineOfSight(this.worm.x, this.worm.y, this.target.x, this.target.y, terrain);

    // Movement: Move towards target horizontally
    let moveLeft = dx < -15;
    let moveRight = dx > 15;
    let doJump = false;
    let doFire = false;
    let doRope = false;

    // Jump if stuck or if wall in front
    if (this.stuckTimer > 15) {
      doJump = Math.random() > 0.4;
      if (Math.random() > 0.7) {
        moveLeft = !moveLeft;
        moveRight = !moveRight;
      }
    }

    // Try climbing or jumping over obstacles
    const aheadX = this.worm.x + (moveRight ? 10 : moveLeft ? -10 : 0);
    if (terrain.isSolid(aheadX, this.worm.y) && !terrain.isSolid(aheadX, this.worm.y - 12)) {
      doJump = true;
    }

    // Rope usage if target is far above
    if (dy < -60 && Math.abs(dx) < 120 && Math.random() > 0.6) {
      if (!this.worm.rope.isAttached()) {
        doRope = true;
      }
    }

    // Weapon selection based on distance
    if (this.thinkCooldown <= 0) {
      this.thinkCooldown = 40 + Math.floor(Math.random() * 30);
      if (dist < 70) {
        // Prefer shotgun, flamer, minigun
        this.selectWeaponByPref(['shotgun', 'minigun', 'flamer']);
      } else {
        // Prefer bazooka, gauss, grenade
        this.selectWeaponByPref(['bazooka', 'gauss', 'chiquita', 'grenade']);
      }
    } else {
      this.thinkCooldown--;
    }

    // Fire if in line of sight and aiming closely at target
    if (hasLOS && Math.abs(diff) < 0.35 && dist < 350) {
      doFire = true;
    } else if (!hasLOS && dist < 120 && Math.random() > 0.8) {
      // Shoot through soft dirt if close
      doFire = true;
    }

    this.currentInput = {
      left: moveLeft,
      right: moveRight,
      up: false,
      down: false,
      jump: doJump,
      fire: doFire,
      rope: doRope,
      aimAngle: newAimAngle
    };

    return this.currentInput;
  }

  private selectWeaponByPref(preferences: string[]) {
    for (const pref of preferences) {
      const idx = this.worm.weapons.findIndex(w => w.id === pref);
      if (idx !== -1) {
        this.worm.selectWeapon(idx);
        return;
      }
    }
  }

  private checkLineOfSight(x1: number, y1: number, x2: number, y2: number, terrain: Terrain): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / 6);
    const stepX = (x2 - x1) / steps;
    const stepY = (y2 - y1) / steps;

    let curX = x1;
    let curY = y1;
    for (let i = 1; i < steps - 1; i++) {
      curX += stepX;
      curY += stepY;
      if (terrain.isSolid(curX, curY)) {
        return false;
      }
    }
    return true;
  }
}
