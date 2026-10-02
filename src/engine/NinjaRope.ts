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
  private animTimer: number = 0;

  public setModifiers(reach: 'normal' | 'infinite') {
    this.isInfinite = reach === 'infinite';
    this.maxLength = this.isInfinite ? 99999 : CONFIG.ROPE_MAX_LENGTH;
  }

  public shoot(originX: number, originY: number, angle: number) {
    this.state = 'flying';
    this.hookX = originX;
    this.hookY = originY;
    const speed = 16.0;
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
    this.animTimer++;

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

      // 1. Smooth, constant-speed reeling controls without propulsion:
      // ReelIn (Z / W / Up) climbs smoothly at constant speed
      // ReelOut (S / Down) descends smoothly
      const reelInSpeed = 1.6;
      const reelOutSpeed = 1.8;

      if (reelIn) {
        this.length = Math.max(16, this.length - reelInSpeed);
        // Smoothly pull worm position inward to prevent slack accumulation
        if (dist > this.length) {
          const pull = Math.min(dist - this.length, reelInSpeed);
          worm.x -= ox * pull;
          worm.y -= oy * pull;
        }
      } else if (reelOut) {
        this.length = Math.min(this.maxLength, this.length + reelOutSpeed);
      }

      // 2. Rigid Inelastic Distance Constraint:
      // Eliminate outward velocity along the rope when taut (preserves tangential swing velocity)
      const radialVel = worm.vx * ox + worm.vy * oy; // > 0 outward, < 0 inward
      if (dist >= this.length - 1.0 && radialVel > 0) {
        worm.vx -= ox * radialVel;
        worm.vy -= oy * radialVel;
      }
    }
  }

  /**
   * Draws the Arcane Tether (Lien Magique) connecting the wizard's staff to the anchor rune.
   */
  public draw(ctx: CanvasRenderingContext2D, wormX: number, wormY: number) {
    if (this.state === 'idle') return;

    ctx.save();

    // 1. Arcane Beam Glow
    const pulse = 0.5 + 0.5 * Math.sin(this.animTimer * 0.15);
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.state === 'attached' ? '#55ddff' : '#aa77ff';

    // Outer magical beam
    ctx.strokeStyle = this.state === 'attached' ? `rgba(60, 200, 255, ${0.7 + pulse * 0.3})` : `rgba(180, 100, 255, ${0.8})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(wormX, wormY);
    ctx.lineTo(this.hookX, this.hookY);
    ctx.stroke();

    // Inner bright energy core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 2. Anchor Point (Arcane Rune Crystal)
    if (this.state === 'attached') {
      const runeSize = 3.5 + pulse * 1.5;
      ctx.fillStyle = '#ffdd44';
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 10;

      // Draw diamond / 4-pointed magic star
      ctx.beginPath();
      ctx.moveTo(this.hookX, this.hookY - runeSize);
      ctx.lineTo(this.hookX + runeSize * 0.7, this.hookY);
      ctx.lineTo(this.hookX, this.hookY + runeSize);
      ctx.lineTo(this.hookX - runeSize * 0.7, this.hookY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.hookX, this.hookY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Flying magical projectile tip
      ctx.fillStyle = '#cc88ff';
      ctx.beginPath();
      ctx.arc(this.hookX, this.hookY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
