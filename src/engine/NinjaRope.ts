import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { sound } from './SoundEffects';

export type RopeState = 'idle' | 'flying' | 'attached';

/**
 * Arcane tether (ninja rope). This class only handles the hook (flight, latch, length).
 * The pendulum constraint on the wizard is applied in Worm.resolvePhysics so that
 * the wizard is always moved with collision detection.
 */
export class NinjaRope {
  public state: RopeState = 'idle';
  public hookX: number = 0;
  public hookY: number = 0;
  private hookVx: number = 0;
  private hookVy: number = 0;
  public length: number = 0;
  public maxLength: number = CONFIG.ROPE_MAX_LENGTH;
  private animTimer: number = 0;

  public setReach(reach: 'normal' | 'infinite') {
    this.maxLength = reach === 'infinite' ? 99999 : CONFIG.ROPE_MAX_LENGTH;
  }

  public shoot(originX: number, originY: number, angle: number, playSound: boolean) {
    this.state = 'flying';
    this.hookX = originX;
    this.hookY = originY;
    this.hookVx = Math.cos(angle) * CONFIG.ROPE_HOOK_SPEED;
    this.hookVy = Math.sin(angle) * CONFIG.ROPE_HOOK_SPEED;
    this.length = 0;
    if (playSound) sound.playRopeShoot();
  }

  public release() {
    this.state = 'idle';
  }

  public isAttached(): boolean {
    return this.state === 'attached';
  }

  public update(wormX: number, wormY: number, terrain: Terrain, reelIn: boolean, reelOut: boolean, playSound: boolean) {
    if (this.state === 'idle') return;
    this.animTimer++;

    if (this.state === 'flying') {
      // 2 px sub-steps so thin walls are never skipped
      const steps = Math.ceil(CONFIG.ROPE_HOOK_SPEED / 2);
      for (let s = 0; s < steps; s++) {
        this.hookX += this.hookVx / steps;
        this.hookY += this.hookVy / steps;

        const dist = Math.hypot(this.hookX - wormX, this.hookY - wormY);
        if (dist > this.maxLength || !terrain.isInBounds(this.hookX, this.hookY)) {
          this.release();
          return;
        }
        if (terrain.isSolid(this.hookX, this.hookY)) {
          this.state = 'attached';
          this.length = Math.max(CONFIG.ROPE_MIN_LENGTH, dist);
          if (playSound) sound.playRopeLatch();
          return;
        }
      }
      return;
    }

    // Attached: the anchor was blown away → detach
    if (!terrain.isSolid(this.hookX, this.hookY)) {
      this.release();
      return;
    }

    const dist = Math.hypot(wormX - this.hookX, wormY - this.hookY);
    if (reelIn) {
      // Never let the length get far below the real distance (e.g. when blocked by a wall),
      // otherwise the wizard gets yanked violently once free.
      this.length = Math.max(CONFIG.ROPE_MIN_LENGTH, Math.min(this.length, dist + 2) - CONFIG.ROPE_REEL_SPEED);
    } else if (reelOut) {
      this.length = Math.min(this.maxLength, this.length + CONFIG.ROPE_REEL_SPEED * 1.1);
    }
  }

  /** Draws the arcane tether from the wizard to the anchor rune. */
  public draw(ctx: CanvasRenderingContext2D, wormX: number, wormY: number) {
    if (this.state === 'idle') return;

    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(this.animTimer * 0.15);
    const attached = this.state === 'attached';
    ctx.shadowBlur = 8;
    ctx.shadowColor = attached ? '#55ddff' : '#aa77ff';

    ctx.strokeStyle = attached ? `rgba(60, 200, 255, ${0.7 + pulse * 0.3})` : 'rgba(180, 100, 255, 0.8)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(wormX, wormY);
    ctx.lineTo(this.hookX, this.hookY);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    if (attached) {
      const runeSize = 3.5 + pulse * 1.5;
      ctx.fillStyle = '#ffdd44';
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 10;
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
      ctx.fillStyle = '#cc88ff';
      ctx.beginPath();
      ctx.arc(this.hookX, this.hookY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
