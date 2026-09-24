import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { sound } from './SoundEffects';

export type RopeState = 'idle' | 'flying' | 'attached';

export class NinjaRope {
  public state: RopeState = 'idle';
  public hookX: number = 0;
  public hookY: number = 0;
  public hookVx: number = 0;
  public hookVy: number = 0;
  public length: number = 0;
  public maxLength: number = CONFIG.ROPE_MAX_LENGTH;
  public isInfinite: boolean = false;

  public setModifiers(reach: 'normal' | 'infinite') {
    this.isInfinite = reach === 'infinite';
    this.maxLength = this.isInfinite ? 99999 : CONFIG.ROPE_MAX_LENGTH;
  }

  public shoot(originX: number, originY: number, angle: number) {
    this.state = 'flying';
    this.hookX = originX;
    this.hookY = originY;
    const speed = 15.5;
    this.hookVx = Math.cos(angle) * speed;
    this.hookVy = Math.sin(angle) * speed;
    this.length = 0;
    sound.playRopeShoot();
  }

  public release() {
    this.state = 'idle';
  }

  public isAttached(): boolean {
    return this.state === 'attached';
  }

  public isActive(): boolean {
    return this.state !== 'idle';
  }

  public update(
    worm: { x: number; y: number; vx: number; vy: number },
    terrain: Terrain,
    reelIn: boolean,
    reelOut: boolean
  ) {
    if (this.state === 'idle') return;

    if (this.state === 'flying') {
      // Step along hook trajectory with sub-stepping for precise collision
      const steps = 4;
      const stepVx = this.hookVx / steps;
      const stepVy = this.hookVy / steps;

      for (let s = 0; s < steps; s++) {
        this.hookX += stepVx;
        this.hookY += stepVy;

        const dist = Math.hypot(this.hookX - worm.x, this.hookY - worm.y);
        if (!this.isInfinite && dist > this.maxLength) {
          this.release();
          return;
        }

        if (terrain.isSolid(this.hookX, this.hookY)) {
          // Latch onto terrain!
          this.state = 'attached';
          this.length = Math.max(22, dist);
          sound.playRopeLatch();
          return;
        }
      }
    } else if (this.state === 'attached') {
      // If hook point was destroyed by explosion, detach rope
      if (!terrain.isSolid(this.hookX, this.hookY)) {
        this.release();
        return;
      }

      // Vector from hook to worm
      const hx = worm.x - this.hookX;
      const hy = worm.y - this.hookY;
      const dist = Math.hypot(hx, hy);
      if (dist < 0.001) return;

      const ox = hx / dist; // outward unit vector pointing from hook to worm
      const oy = hy / dist;

      // 1. Reeling controls:
      // Z / W / Jump -> reelIn (shorten cable, pull inward toward hook)
      // S / Down -> reelOut (lengthen cable, descend downward)
      // Idle -> cable length stays strictly fixed, pure pendulum swing!
      if (reelIn) {
        this.length = Math.max(16, this.length - 2.8);
        worm.vx -= ox * 0.38;
        worm.vy -= oy * 0.38;
      } else if (reelOut) {
        this.length = Math.min(this.maxLength, this.length + 2.8);
        worm.vx += ox * 0.12;
        worm.vy += oy * 0.12;
      }

      // 2. Rigid Inelastic Distance Constraint:
      // If worm reaches or exceeds cable length, cancel outward radial velocity
      if (dist >= this.length) {
        const outwardVel = worm.vx * ox + worm.vy * oy;
        if (outwardVel > 0) {
          // Cancel outward component - preserves 100% of tangential swing velocity
          worm.vx -= ox * outwardVel;
          worm.vy -= oy * outwardVel;
        }

        // Clamp worm distance to cable length without teleporting inside solid terrain
        const targetX = this.hookX + ox * this.length;
        const targetY = this.hookY + oy * this.length;
        if (!terrain.isSolid(targetX, targetY)) {
          worm.x = targetX;
          worm.y = targetY;
        }
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D, wormX: number, wormY: number) {
    if (this.state === 'idle') return;

    ctx.save();
    // Rope cable
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(wormX, wormY);
    ctx.lineTo(this.hookX, this.hookY);
    ctx.stroke();

    // Hook tip
    ctx.fillStyle = this.state === 'attached' ? '#ff3333' : '#ffffff';
    ctx.fillRect(this.hookX - 2, this.hookY - 2, 4, 4);
    ctx.restore();
  }
}
