import { CONFIG } from '../config';
import { generateLayout, MapTheme, MapType, MAP_THEMES } from './MapGenerator';
import { fxSprite, FxName } from './Sprites';

export type { MapType };

const { MAT_AIR: AIR, MAT_DIRT: DIRT, MAT_ROCK: ROCK, MAT_ACID: ACID, MAT_ICE: ICE, MAT_WATER: WATER,
  MAT_CRYSTAL: CRYSTAL, MAT_WOOD: WOOD, MAT_LAVA: LAVA, MAT_BOUNCE: BOUNCE } = CONFIG;

/** Materials removed by explosions (wood only partially, unless the spell is a fire spell) */
const DESTRUCTIBLE = new Set([DIRT, ICE, CRYSTAL, WOOD, BOUNCE]);
/** Blood decal colours and splat shapes */
const BLOOD_STAIN = ['#7d0a0a', '#640606', '#931010'];
const SPLATS: FxName[] = ['dirt_01', 'dirt_02', 'dirt_03'];
/** Fraction of the blast radius that eats into wood for non-fire spells */
const WOOD_RESISTANCE = 0.4;

export interface CarveResult {
  modified: boolean;
  crystals: number; // crystal pixels destroyed (→ gold for the caster)
}

type RGB = [number, number, number];

/**
 * Destructible pixel terrain.
 *
 * Layers (offscreen canvases, blitted each frame):
 *  - background : sky gradient and scenery (never changes)
 *  - ground     : destructible solids (dirt, ice, crystal, wood, mushroom)
 *  - rock       : indestructible rock
 *  - acid       : acid (pulsing)
 *  - liquid     : water & lava, drawn over the wizards so they look submerged
 *  - stains     : blood decals, always restricted to solid pixels
 */
export class Terrain {
  public width: number;
  public height: number;
  public materials: Uint8Array;

  /** Scenery behind the terrain, painted at 2× resolution so it stays sharp when zoomed */
  public bgCanvas: HTMLCanvasElement;
  /** Blood decals (transparent), used by the smooth GPU renderer */
  public stainCanvas: HTMLCanvasElement;
  private stainCtx: CanvasRenderingContext2D;
  private groundCanvas: HTMLCanvasElement;
  private groundCtx: CanvasRenderingContext2D;
  private rockCanvas: HTMLCanvasElement;
  private rockCtx: CanvasRenderingContext2D;
  private acidCanvas: HTMLCanvasElement;
  private acidCtx: CanvasRenderingContext2D;
  private liquidCanvas: HTMLCanvasElement;
  private liquidCtx: CanvasRenderingContext2D;

  public theme: MapTheme = MAP_THEMES.cave;
  /** Dirt above this line (per column) is foliage (forest canopy) */
  public canopyLine: Int16Array | null = null;
  public mapType: MapType = 'cave';

  // Change tracking for the GPU renderers (each one remembers how far it has read)
  /** Incremented when the whole map changed (new map / snapshot) */
  public version = 0;
  /** Regions where materials changed / blood was added, in order */
  public readonly changes = new ChangeLog();
  public readonly stains = new ChangeLog();

  constructor(width: number = CONFIG.MAP_WIDTH, height: number = CONFIG.MAP_HEIGHT) {
    this.width = width;
    this.height = height;
    this.materials = new Uint8Array(width * height);
    const layer = () => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      return c;
    };
    this.bgCanvas = layer();
    this.bgCanvas.width = width * 2;
    this.bgCanvas.height = height * 2;
    this.stainCanvas = layer();
    this.stainCtx = this.stainCanvas.getContext('2d', { willReadFrequently: true })!;
    this.groundCanvas = layer();
    this.rockCanvas = layer();
    this.acidCanvas = layer();
    this.liquidCanvas = layer();
    this.groundCtx = this.groundCanvas.getContext('2d', { willReadFrequently: true })!;
    this.rockCtx = this.rockCanvas.getContext('2d')!;
    this.acidCtx = this.acidCanvas.getContext('2d', { willReadFrequently: true })!;
    this.liquidCtx = this.liquidCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Generation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * @param hazards          acid & lava enabled (otherwise lava becomes water and acid is skipped)
   * @param centerZoneRadius King-of-the-hill zone to clear at the centre (0 = none)
   */
  public generateMap(seed: number, mapType: MapType, hazards: boolean, centerZoneRadius: number = 0) {
    const rand = createPRNG(seed);
    const layout = generateLayout(this.materials, this.width, this.height, mapType, rand, hazards);
    this.mapType = mapType;
    this.theme = MAP_THEMES[mapType] ?? MAP_THEMES.cave;
    this.canopyLine = layout.canopyLine ?? null;

    if (centerZoneRadius > 0) {
      const cx = Math.round(this.width / 2);
      const cy = Math.round(this.height / 2);
      const r2 = centerZoneRadius * centerZoneRadius;
      for (let y = cy - centerZoneRadius; y <= cy + centerZoneRadius; y++) {
        for (let x = cx - centerZoneRadius; x <= cx + centerZoneRadius; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) this.materials[y * this.width + x] = AIR;
        }
      }
      // Small floor at the bottom of the zone
      const fy = cy + centerZoneRadius - 4;
      const rx = Math.round(centerZoneRadius * 0.7);
      for (let y = fy - 5; y <= fy + 5; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          if (((x - cx) / rx) ** 2 + ((y - fy) / 5) ** 2 <= 1) this.materials[y * this.width + x] = DIRT;
        }
      }
    }

    this.renderAll(rand);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Queries
  // ══════════════════════════════════════════════════════════════════════════

  public isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Material at a point; outside the map counts as rock. */
  public materialAt(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return ROCK;
    return this.materials[iy * this.width + ix];
  }

  /** Anything a wizard cannot go through (liquids are not solid). */
  public isSolid(x: number, y: number): boolean {
    const m = this.materialAt(x, y);
    return m !== AIR && m !== WATER && m !== LAVA;
  }

  public isAcid(x: number, y: number): boolean {
    return this.isInBounds(x, y) && this.materialAt(x, y) === ACID;
  }

  /** WATER, LAVA, or 0 when not in a liquid. */
  public fluidAt(x: number, y: number): number {
    if (!this.isInBounds(x, y)) return 0;
    const m = this.materialAt(x, y);
    return m === WATER || m === LAVA ? m : 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Mutations
  // ══════════════════════════════════════════════════════════════════════════

  /** Explosion crater. Fire spells burn wood entirely; other spells barely dent it. */
  public carveCircle(cx: number, cy: number, radius: number, fire: boolean = false): CarveResult {
    const r = radius;
    return this.carve(cx - r, cy - r, cx + r, cy + r, (x, y) => Math.hypot(x - cx, y - cy) / r, fire);
  }

  /** Capsule (thick line) — tunnel of a piercing spell. */
  public carveLine(x0: number, y0: number, x1: number, y1: number, radius: number, fire: boolean = false): CarveResult {
    const r = Math.max(1, radius);
    const sx = x1 - x0;
    const sy = y1 - y0;
    const len2 = sx * sx + sy * sy;
    return this.carve(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, (x, y) => {
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * sx + (y - y0) * sy) / len2)) : 0;
      return Math.hypot(x - (x0 + sx * t), y - (y0 + sy * t)) / r;
    }, fire);
  }

  /** Removes destructible pixels whose normalised distance (0 = centre, 1 = edge) is ≤ 1. */
  private carve(fx0: number, fy0: number, fx1: number, fy1: number, distance: (x: number, y: number) => number, fire: boolean): CarveResult {
    const minX = Math.max(0, Math.floor(fx0));
    const maxX = Math.min(this.width - 1, Math.ceil(fx1));
    const minY = Math.max(0, Math.floor(fy0));
    const maxY = Math.min(this.height - 1, Math.ceil(fy1));
    const result: CarveResult = { modified: false, crystals: 0 };
    if (minX > maxX || minY > maxY) return result;

    const changed: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.width + x;
        const m = this.materials[idx];
        if (!DESTRUCTIBLE.has(m)) continue;
        const d = distance(x, y);
        if (d > 1) continue;
        if (m === WOOD && !fire && d > WOOD_RESISTANCE) continue;
        if (m === CRYSTAL) result.crystals++;
        this.materials[idx] = AIR;
        changed.push(x, y);
      }
    }
    if (changed.length > 0) {
      result.modified = true;
      this.markDirty(minX, minY, maxX, maxY);
      const w = maxX - minX + 1;
      const img = this.groundCtx.getImageData(minX, minY, w, maxY - minY + 1);
      for (let i = 0; i < changed.length; i += 2) {
        img.data[((changed[i + 1] - minY) * w + (changed[i] - minX)) * 4 + 3] = 0;
      }
      this.groundCtx.putImageData(img, minX, minY);
      this.clearStains(changed, minX, minY, maxX, maxY);
    }
    return result;
  }

  /** Blood disappears with the pixels it was on (flat [x, y, …] list inside the rect). */
  private clearStains(pixels: number[], minX: number, minY: number, maxX: number, maxY: number) {
    const w = maxX - minX + 1;
    const img = this.stainCtx.getImageData(minX, minY, w, maxY - minY + 1);
    let any = false;
    for (let i = 0; i < pixels.length; i += 2) {
      const a = ((pixels[i + 1] - minY) * w + (pixels[i] - minX)) * 4 + 3;
      if (img.data[a] !== 0) {
        img.data[a] = 0;
        any = true;
      }
    }
    if (!any) return;
    this.stainCtx.putImageData(img, minX, minY);
    this.stains.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
  }

  /** Runs `fn` on every pixel of a disc (returns the new material or null) and repaints. */
  private editDisc(cx: number, cy: number, r: number, fn: (idx: number, x: number, y: number) => number | null) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    r = Math.round(r);
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(this.width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(this.height - 1, cy + r);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w <= 0 || h <= 0) return;

    const ground = this.groundCtx.getImageData(minX, minY, w, h);
    const acid = this.acidCtx.getImageData(minX, minY, w, h);
    const liquid = this.liquidCtx.getImageData(minX, minY, w, h);
    const changed: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const idx = y * this.width + x;
        const next = fn(idx, x, y);
        if (next === null || next === this.materials[idx]) continue;
        this.materials[idx] = next;
        changed.push(x, y);
        const p = ((y - minY) * w + (x - minX)) * 4;
        ground.data[p + 3] = 0;
        acid.data[p + 3] = 0;
        liquid.data[p + 3] = 0;
        this.paintPixel(next, x, y, Math.random, ground.data, acid.data, liquid.data, p);
      }
    }
    this.groundCtx.putImageData(ground, minX, minY);
    this.acidCtx.putImageData(acid, minX, minY);
    this.liquidCtx.putImageData(liquid, minX, minY);
    this.markDirty(minX, minY, maxX, maxY);
    if (changed.length > 0) this.clearStains(changed, minX, minY, maxX, maxY);
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number) {
    this.changes.push({ x0, y0, x1, y1 });
  }

  /** Alchemist flask: turns everything but rock and lava into acid. */
  public addAcid(cx: number, cy: number, r: number) {
    this.editDisc(cx, cy, r, (idx) => {
      const m = this.materials[idx];
      return m === ROCK || m === LAVA ? null : ACID;
    });
  }

  /**
   * Earth rampart: fills air (and water) with dirt, leaving room around the given points
   * (wizards, as flat [x0, y0, x1, y1, …]) so nobody gets buried.
   */
  public addDirt(cx: number, cy: number, r: number, keepClear: number[]) {
    this.editDisc(cx, cy, r, (idx, x, y) => {
      const m = this.materials[idx];
      if (m !== AIR && m !== WATER) return null;
      if (Math.hypot(x - cx, y - cy) + Math.sin(x * 0.9 + y * 0.6) * 1.2 > r) return null;
      for (let k = 0; k + 1 < keepClear.length; k += 2) {
        if (Math.hypot(x - keepClear[k], y - keepClear[k + 1]) < 9) return null;
      }
      return DIRT;
    });
  }

  /** Frost orb: water freezes into (walkable, slippery) ice. Returns true if anything froze. */
  public freezeWater(cx: number, cy: number, r: number): boolean {
    let froze = false;
    this.editDisc(cx, cy, r, (idx) => {
      if (this.materials[idx] !== WATER) return null;
      froze = true;
      return ICE;
    });
    return froze;
  }

  /**
   * Blood splat (purely visual) where a droplet hit the solid pixel (x, y), on any solid
   * material. Faster droplets leave bigger splats stretched along their direction.
   */
  public addBlood(x: number, y: number, size: number, vx = 0, vy = 0) {
    if (!this.isSolid(x, y) || !this.isInBounds(x, y)) return;
    const speed = Math.hypot(vx, vy);
    const r = Math.min(4.5, size * (0.9 + speed * 0.3));
    const stretch = 1 + Math.min(1.4, speed * 0.25);
    const ctx = this.stainCtx;
    const color = BLOOD_STAIN[(Math.random() * BLOOD_STAIN.length) | 0];
    const sprite = fxSprite(SPLATS[(Math.random() * SPLATS.length) | 0], color, true);
    ctx.globalAlpha = 0.8 + Math.random() * 0.2;
    if (sprite) {
      const d = r * 2.6;
      ctx.translate(x, y);
      ctx.rotate(speed > 0.3 ? Math.atan2(vy, vx) : Math.random() * Math.PI * 2);
      ctx.drawImage(sprite, -d * stretch * 0.5, -d * 0.5, d * stretch, d);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Keep the decal on solid pixels only (no blood floating in the air or in water)
    const m = Math.ceil(r * 1.3 * stretch) + 1;
    const x0 = Math.max(0, Math.floor(x) - m), y0 = Math.max(0, Math.floor(y) - m);
    const x1 = Math.min(this.width - 1, Math.floor(x) + m), y1 = Math.min(this.height - 1, Math.floor(y) + m);
    const w = x1 - x0 + 1;
    const img = ctx.getImageData(x0, y0, w, y1 - y0 + 1);
    const data = img.data;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const a = ((py - y0) * w + (px - x0)) * 4 + 3;
        if (data[a] === 0) continue;
        const mat = this.materials[py * this.width + px];
        if (mat === AIR || mat === WATER || mat === LAVA) data[a] = 0;
      }
    }
    ctx.putImageData(img, x0, y0);
    this.stains.push({ x0, y0, x1, y1 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Spawn points
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Free space for a wizard, standing on safe solid ground (no acid, mushroom or liquid),
   * preferably far from the other wizards.
   */
  public findSpawnPoint(avoid: { x: number; y: number }[] = []): { x: number; y: number } {
    const border = 24;
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;

    for (let attempts = 0, found = 0; attempts < 600 && found < 12; attempts++) {
      const x = Math.round(border + Math.random() * (this.width - 2 * border));
      const startY = Math.round(border + Math.random() * (this.height - 2 * border));
      if (this.materialAt(x, startY) !== AIR) continue;

      let floorY = -1;
      for (let y = startY; y < this.height - border; y++) {
        const m = this.materialAt(x, y);
        if (m === AIR) continue;
        if (m !== WATER && m !== LAVA) floorY = y;
        break;
      }
      if (floorY < 0) continue;
      const floorMat = this.materialAt(x, floorY);
      if (floorMat === ACID || floorMat === BOUNCE) continue;

      const sy = floorY - 6;
      let clear = true;
      for (let dy = -6; dy <= 4 && clear; dy += 2) {
        for (let dx = -5; dx <= 5; dx += 5) {
          if (this.materialAt(x + dx, sy + dy) !== AIR) { clear = false; break; }
        }
      }
      if (!clear) continue;
      if (this.isAcid(x - 6, floorY + 1) || this.isAcid(x + 6, floorY + 1)) continue;

      found++;
      let score = avoid.length > 0 ? Math.min(...avoid.map(a => Math.hypot(a.x - x, a.y - sy))) : 0;
      score += Math.random() * 20;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y: sy };
      }
    }
    return best ?? { x: this.width / 2, y: this.height / 4 };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Network snapshot (players joining a match in progress)
  // ══════════════════════════════════════════════════════════════════════════

  /** Run-length encodes the material grid as [material, runLength(1..255)] byte pairs. */
  public encodeMaterials(): Uint8Array {
    const out: number[] = [];
    const m = this.materials;
    let i = 0;
    while (i < m.length) {
      const v = m[i];
      let run = 1;
      while (i + run < m.length && m[i + run] === v && run < 255) run++;
      out.push(v, run);
      i += run;
    }
    return new Uint8Array(out);
  }

  /** Replaces the material grid (call generateMap first so the theme and scenery are right). */
  public loadMaterials(rle: Uint8Array) {
    let p = 0;
    for (let i = 0; i + 1 < rle.length && p < this.materials.length; i += 2) {
      this.materials.fill(rle[i], p, Math.min(this.materials.length, p + rle[i + 1]));
      p += rle[i + 1];
    }
    this.renderAll(Math.random);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ══════════════════════════════════════════════════════════════════════════

  private renderAll(rand: () => number) {
    const W = this.width;
    const H = this.height;
    this.version++;
    this.changes.clear();
    this.stains.clear();
    this.stainCtx.clearRect(0, 0, W, H);
    this.paintBackground(rand);

    const ground = this.groundCtx.createImageData(W, H);
    const rock = this.rockCtx.createImageData(W, H);
    const acid = this.acidCtx.createImageData(W, H);
    const liquid = this.liquidCtx.createImageData(W, H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const m = this.materials[y * W + x];
        if (m === AIR) continue;
        const p = (y * W + x) * 4;
        if (m === ROCK) this.paintRock(rock.data, p, x, y, rand);
        else this.paintPixel(m, x, y, rand, ground.data, acid.data, liquid.data, p);
      }
    }
    this.groundCtx.putImageData(ground, 0, 0);
    this.rockCtx.putImageData(rock, 0, 0);
    this.acidCtx.putImageData(acid, 0, 0);
    this.liquidCtx.putImageData(liquid, 0, 0);
  }

  private airAbove(x: number, y: number, depth: number): boolean {
    for (let d = 1; d <= depth; d++) {
      if (y - d >= 0 && this.materials[(y - d) * this.width + x] === AIR) return true;
    }
    return false;
  }

  private paintPixel(m: number, x: number, y: number, rand: () => number,
    ground: Uint8ClampedArray, acid: Uint8ClampedArray, liquid: Uint8ClampedArray, p: number) {
    const n = rand() - 0.5;
    const t = this.theme;
    let c: RGB;
    let a = 255;
    let target = ground;

    switch (m) {
      case DIRT: {
        if (this.canopyLine && y < this.canopyLine[x] && t.leaves) {
          // Leaf clumps: per-cluster brightness + per-pixel noise
          const clump = Math.sin(x * 0.21 + Math.sin(y * 0.17) * 3) * Math.cos(y * 0.23 + Math.sin(x * 0.13) * 2);
          c = shade(t.leaves, clump * 22 + n * 34);
        } else if (t.surface && this.airAbove(x, y, 3)) {
          c = shade(t.surface, n * 22);
        } else {
          c = shade(t.dirt, (Math.sin(x * 0.15) + Math.cos(y * 0.15) + n * 1.2) / 3 * 35);
        }
        break;
      }
      case ICE: {
        const streak = (x + y * 2) % 11 === 0 ? 35 : 0;
        c = shade([165, 215, 240], n * 14 + streak + (this.airAbove(x, y, 2) ? 30 : 0));
        a = 235;
        break;
      }
      case CRYSTAL: {
        const facet = (x * 3 + y) % 7 < 3 ? 30 : -10;
        c = rand() < 0.04 ? [255, 235, 255] : shade([175, 80, 245], facet + n * 25);
        break;
      }
      case WOOD:
        c = shade([120, 76, 38], Math.sin(y * 0.9 + Math.sin(x * 0.25) * 2.5) * 18 + n * 12);
        break;
      case BOUNCE: {
        const spot = Math.sin(x * 0.55) * Math.sin(y * 0.7) > 0.72;
        c = spot ? [255, 225, 240] : shade([225, 70, 155], n * 20 + (this.airAbove(x, y, 2) ? 25 : 0));
        break;
      }
      case ACID:
        target = acid;
        c = [20, Math.floor(220 + n * 35), Math.floor(20 + n * 20)];
        break;
      case WATER: {
        target = liquid;
        const surface = this.airAbove(x, y, 2);
        c = surface ? [150, 205, 255] : shade([35, 105, 200], n * 10 + Math.sin(x * 0.2 + y * 0.3) * 8);
        a = surface ? 210 : 150;
        break;
      }
      case LAVA: {
        target = liquid;
        c = this.airAbove(x, y, 2)
          ? [255, 225, 90]
          : [255, Math.floor(85 + Math.sin(x * 0.18 + y * 0.12) * 35 + n * 40), 20];
        a = 245;
        break;
      }
      default:
        return;
    }
    target[p] = c[0];
    target[p + 1] = c[1];
    target[p + 2] = c[2];
    target[p + 3] = a;
  }

  private paintRock(data: Uint8ClampedArray, p: number, x: number, y: number, rand: () => number) {
    const t = this.theme;
    let v = (Math.sin(x * 0.3) + Math.sin(y * 0.3) + (rand() - 0.5) * 1.5) / 3 * 30;
    if (t.bricks) {
      const row = Math.floor(y / 7);
      if (y % 7 === 0 || (x + (row % 2) * 8) % 16 === 0) v -= 35;
    }
    const c = shade(t.rock, v);
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = 255;
  }

  private paintBackground(rand: () => number) {
    const ctx = this.bgCanvas.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const W = this.width;
    const H = this.height;
    const t = this.theme;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, t.skyTop);
    grad.addColorStop(1, t.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const stars = (count: number, maxY: number) => {
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.5})`;
        ctx.fillRect(rand() * W, rand() * maxY, rand() < 0.1 ? 2 : 1, 1);
      }
    };
    const mountains = (color: string, baseY: number, amp: number, step: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      const phase = rand() * 10;
      for (let x = 0; x <= W + step; x += step) {
        ctx.lineTo(x, baseY - Math.abs(Math.sin(x * 0.011 + phase)) * amp - rand() * amp * 0.25);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };

    switch (t.backdrop) {
      case 'cave':
        for (let i = 0; i < 40; i++) {
          const x = rand() * W;
          const w = 8 + rand() * 18;
          const h = 20 + rand() * 70;
          ctx.fillStyle = `rgba(60, 38, 24, ${0.25 + rand() * 0.25})`;
          ctx.beginPath();
          if (rand() < 0.5) { ctx.moveTo(x - w, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x, h); }
          else { ctx.moveTo(x - w, H); ctx.lineTo(x + w, H); ctx.lineTo(x, H - h); }
          ctx.fill();
        }
        break;
      case 'volcano':
        mountains('rgba(45, 12, 8, 0.85)', H * 0.6, 130, 30);
        for (let i = 0; i < 70; i++) {
          ctx.fillStyle = `rgba(255, ${Math.floor(100 + rand() * 100)}, 30, ${0.2 + rand() * 0.4})`;
          ctx.fillRect(rand() * W, rand() * H, 1.5, 1.5);
        }
        break;
      case 'forest':
        stars(80, H * 0.5);
        ctx.fillStyle = 'rgba(240, 240, 210, 0.75)';
        ctx.beginPath();
        ctx.arc(W * 0.8, H * 0.14, 22, 0, Math.PI * 2);
        ctx.fill();
        for (const [color, base] of [['rgba(12, 38, 30, 0.9)', H * 0.58], ['rgba(7, 24, 18, 0.95)', H * 0.66]] as const) {
          ctx.fillStyle = color;
          for (let x = -10; x < W + 10; x += 14 + rand() * 18) {
            const h = 50 + rand() * 80;
            ctx.beginPath();
            ctx.moveTo(x - 14, base);
            ctx.lineTo(x, base - h);
            ctx.lineTo(x + 14, base);
            ctx.fill();
          }
          ctx.fillRect(0, base, W, H - base);
        }
        break;
      case 'citadel':
        stars(120, H * 0.6);
        ctx.fillStyle = 'rgba(255, 230, 200, 0.6)';
        ctx.beginPath();
        ctx.arc(W * 0.5, H * 0.12, 14, 0, Math.PI * 2);
        ctx.fill();
        mountains('rgba(32, 24, 52, 0.9)', H * 0.62, 100, 25);
        break;
      case 'glacier':
        stars(140, H * 0.7);
        for (let b = 0; b < 3; b++) {
          ctx.strokeStyle = `rgba(${80 + b * 30}, 255, ${170 + b * 20}, 0.10)`;
          ctx.lineWidth = 18 - b * 4;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 10) {
            const y = H * (0.16 + b * 0.07) + Math.sin(x * 0.012 + b) * 22;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        mountains('rgba(30, 45, 80, 0.85)', H * 0.62, 170, 40);
        break;
      case 'sky':
        stars(100, H * 0.5);
        for (let i = 0; i < 14; i++) {
          const cx = rand() * W;
          const cy = H * 0.3 + rand() * H * 0.55;
          ctx.fillStyle = 'rgba(150, 170, 230, 0.07)';
          for (let k = 0; k < 6; k++) {
            ctx.beginPath();
            ctx.arc(cx + (rand() - 0.5) * 60, cy + (rand() - 0.5) * 14, 12 + rand() * 22, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
    }
  }

  /** Background, ground, rock and acid — drawn under the wizards. */
  public draw(ctx: CanvasRenderingContext2D, time: number) {
    ctx.drawImage(this.bgCanvas, 0, 0, this.width, this.height);
    ctx.drawImage(this.groundCanvas, 0, 0);
    ctx.drawImage(this.rockCanvas, 0, 0);
    ctx.drawImage(this.stainCanvas, 0, 0);
    ctx.globalAlpha = 0.7 + Math.sin(time * 0.08) * 0.3;
    ctx.drawImage(this.acidCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** Water & lava — drawn over the wizards so they look submerged. */
  public drawLiquids(ctx: CanvasRenderingContext2D, time: number) {
    ctx.globalAlpha = 0.9 + Math.sin(time * 0.05) * 0.1;
    ctx.drawImage(this.liquidCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** Scaled-down picture of the whole map (lobby preview). */
  public drawPreview(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.imageSmoothingEnabled = true;
    for (const layer of [this.bgCanvas, this.groundCanvas, this.rockCanvas, this.stainCanvas, this.acidCanvas, this.liquidCanvas]) {
      ctx.drawImage(layer, 0, 0, w, h);
    }
  }
}

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Append-only list of modified rectangles; readers keep their own position (sequence number). */
export class ChangeLog {
  private rects: Rect[] = [];
  private base = 0; // sequence number of rects[0]

  public get seq(): number {
    return this.base + this.rects.length;
  }

  public push(r: Rect) {
    this.rects.push(r);
    if (this.rects.length > 512) {
      this.rects.splice(0, 256);
      this.base += 256;
    }
  }

  public clear() {
    this.base += this.rects.length;
    this.rects = [];
  }

  /**
   * Rectangles added since `from`, overlapping / close ones merged (so far-apart splats
   * don't turn into one huge upload); 'all' if they were dropped.
   */
  public listSince(from: number, gap = 8): Rect[] | 'all' {
    if (from < this.base) return 'all';
    const out: Rect[] = [];
    for (let i = from - this.base; i < this.rects.length; i++) {
      const r = { ...this.rects[i] };
      for (let j = 0; j < out.length; j++) {
        const o = out[j];
        if (r.x0 - gap <= o.x1 && o.x0 - gap <= r.x1 && r.y0 - gap <= o.y1 && o.y0 - gap <= r.y1) {
          r.x0 = Math.min(r.x0, o.x0); r.y0 = Math.min(r.y0, o.y0);
          r.x1 = Math.max(r.x1, o.x1); r.y1 = Math.max(r.y1, o.y1);
          out.splice(j, 1);
          j = -1; // the grown rect may now touch others
        }
      }
      out.push(r);
    }
    return out;
  }

  /** Union of the rectangles added since `from`; 'all' if they were dropped; null if none. */
  public since(from: number): Rect | 'all' | null {
    if (from < this.base) return 'all';
    let u: Rect | null = null;
    for (let i = from - this.base; i < this.rects.length; i++) {
      const r = this.rects[i];
      u = u ? { x0: Math.min(u.x0, r.x0), y0: Math.min(u.y0, r.y0), x1: Math.max(u.x1, r.x1), y1: Math.max(u.y1, r.y1) } : { ...r };
    }
    return u;
  }
}

function shade(c: RGB, v: number): RGB {
  return [clamp(c[0] + v), clamp(c[1] + v * 0.8), clamp(c[2] + v * 0.6)];
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.floor(v);
}

/** Mulberry32 — fast deterministic PRNG in [0, 1) */
export function createPRNG(seed: number): () => number {
  let s = (seed || 123456) >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
