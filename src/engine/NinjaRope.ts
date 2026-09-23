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
    this.hookVx = Math.cos(angle) * CONFIG.ROPE_SPEED;
    this.hookVy = Math.sin(angle) * CONFIG.ROPE_SPEED;
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

  public update(worm: { x: number; y: number; vx: number; vy: number }, terrain: Terrain, reelIn: boolean, reelOut: boolean) {
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
          this.length = Math.max(20, dist);
          sound.playRopeLatch();
          return;
        }
      }
    } else if (this.state === 'attached') {
      // If hook point was destroyed, detach rope
      if (!terrain.isSolid(this.hookX, this.hookY)) {
        this.release();
        return;
      }

      // Reeling controls
      if (reelIn) {
        this.length = Math.max(16, this.length - 3.8);
      } else if (reelOut) {
        this.length = Math.min(this.maxLength, this.length + 3.2);
      }

      // Pendulum rope physics constraint
      const dx = worm.x - this.hookX;
      const dy = worm.y - this.hookY;
      const dist = Math.hypot(dx, dy);

      if (dist > this.length && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;

        // Radial velocity of worm relative to hook
        const radialVel = worm.vx * nx + worm.vy * ny;

        // If stretching outward, pull back
        if (radialVel > 0) {
          worm.vx -= radialVel * nx * 0.95;
          worm.vy -= radialVel * ny * 0.95;
        }

        // Spring position restoration
        const excess = dist - this.length;
        const pull = excess * CONFIG.ROPE_PULL_FORCE;
        worm.vx -= nx * pull;
        worm.vy -= ny * pull;

        // Tangential swinging damping
        worm.vx *= CONFIG.ROPE_DAMPING;
        worm.vy *= CONFIG.ROPE_DAMPING;
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D, wormX: number, wormY: number) {
    if (this.state === 'idle') return;

    ctx.save();
    // Rope line
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(wormX, wormY);
    ctx.lineTo(this.hookX, this.hookY);
    ctx.stroke();

    // Hook tip
    ctx.fillStyle = this.state === 'attached' ? '#ff4444' : '#ffffff';
    ctx.fillRect(this.hookX - 2, this.hookY - 2, 4, 4);
    ctx.restore();
  }
}
