import { Terrain } from './Terrain';
import { drawFx, FxName } from './Sprites';

/**
 * Fiole Pestilentielle: a toxic cloud that spreads through the free space around the impact
 * (it follows tunnels, stops at walls), lingers, then dissipates.
 * The shape only depends on the terrain at the moment of the impact, so host and clients
 * compute the same cloud from a single event; only the host deals the damage.
 */
const CELL = 5;          // world pixels per gas cell
const MAX_CELLS = 130;   // volume of gas
const SPREAD_TICKS = 70; // time to reach full volume
const LIFE = 420;        // 7 s
const FADE = 150;        // dissipation at the end
const PUFFS: FxName[] = ['smoke_01', 'smoke_04', 'smoke_07'];
const COLORS = ['#5fbf2e', '#8fdc3c', '#b4e85a'];

export class GasCloud {
  public readonly ownerId: string;
  public age = 0;
  /** Cell centres in spreading order (flat [x, y, …]) */
  private cells: number[] = [];
  private index = new Map<number, number>();
  private gw = 0;

  constructor(x: number, y: number, terrain: Terrain, ownerId: string) {
    this.ownerId = ownerId;
    const gw = Math.ceil(terrain.width / CELL);
    const free = (gx: number, gy: number) => {
      const cx = gx * CELL + CELL / 2;
      const cy = gy * CELL + CELL / 2;
      return terrain.isInBounds(cx, cy) && !terrain.isSolid(cx, cy) && !terrain.fluidAt(cx, cy);
    };
    // Breadth-first flood through the air; upwards first, the gas tends to rise
    let sx = Math.floor(x / CELL);
    let sy = Math.floor(y / CELL);
    if (!free(sx, sy)) {
      // The flask burst against a wall: start from a free neighbour
      const n = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1]].find(([dx, dy]) => free(sx + dx, sy + dy));
      if (!n) return;
      sx += n[0];
      sy += n[1];
    }
    const queue: number[] = [sx, sy];
    const seen = new Set<number>([sy * gw + sx]);
    for (let q = 0; q < queue.length && this.cells.length < MAX_CELLS * 2; q += 2) {
      const gx = queue[q], gy = queue[q + 1];
      this.index.set(gy * gw + gx, this.cells.length / 2);
      this.cells.push(gx * CELL + CELL / 2, gy * CELL + CELL / 2);
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nx = gx + dx, ny = gy + dy;
        const k = ny * gw + nx;
        if (nx < 0 || ny < 0 || nx >= gw || seen.has(k) || !free(nx, ny)) continue;
        seen.add(k);
        queue.push(nx, ny);
      }
    }
    this.gw = gw;
  }

  public get alive(): boolean {
    return this.age < LIFE && this.cells.length > 0;
  }

  public update() {
    this.age++;
  }

  private get count(): number {
    return this.cells.length / 2;
  }

  /** 0…1 gas density of cell i (it appears in spreading order, everything fades at the end) */
  private density(i: number): number {
    const appear = (i / Math.max(1, this.count)) * SPREAD_TICKS;
    const grow = Math.max(0, Math.min(1, (this.age - appear) / 18));
    const fade = this.age > LIFE - FADE ? Math.max(0, (LIFE - this.age) / FADE) : 1;
    return grow * fade;
  }

  /** Gas density at a world point (0 outside the cloud) */
  public densityAt(x: number, y: number): number {
    const i = this.index.get(Math.floor(y / CELL) * this.gw + Math.floor(x / CELL));
    return i === undefined ? 0 : this.density(i);
  }

  /** A random point inside the visible cloud (for bubbles), or null */
  public randomPoint(): { x: number; y: number } | null {
    if (this.count === 0) return null;
    const i = Math.floor(Math.random() * this.count);
    if (this.density(i) < 0.3) return null;
    return { x: this.cells[i * 2] + (Math.random() - 0.5) * CELL, y: this.cells[i * 2 + 1] + (Math.random() - 0.5) * CELL };
  }

  /** Billowing green puffs, slowly swirling */
  public draw(ctx: CanvasRenderingContext2D, now: number) {
    const t = now * 0.001;
    for (let i = 0; i < this.count; i++) {
      const d = this.density(i);
      if (d <= 0.01) continue;
      const x = this.cells[i * 2] + Math.sin(t * 0.9 + i * 1.7) * 2;
      const y = this.cells[i * 2 + 1] + Math.cos(t * 0.7 + i * 2.3) * 1.5 - (1 - d) * 3;
      const size = CELL * (3 + (i % 3) * 0.5) * (0.7 + 0.3 * d);
      drawFx(ctx, PUFFS[i % 3], x, y, size, COLORS[i % 3], d * 0.26, i * 1.3 + t * (i % 2 ? 0.3 : -0.3));
    }
    ctx.globalAlpha = 1;
  }
}
