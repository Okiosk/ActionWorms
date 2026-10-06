import { CONFIG } from '../config';

/**
 * Flowing sand, water, acid and lava: a cellular automaton on the material grid.
 *
 * Network model (lockstep): the host advances it exactly one step per tick, right before
 * sending its STATE; every client advances it one step per STATE received, after applying
 * that tick's events. The rules only use integers and a hash of (cell, tick) — no
 * Math.random, no floats, a fixed scan order — so every machine computes the very same
 * grid without a single extra byte on the network. A hash of the grid is sent every second
 * to check it; a client that diverged anyway (bug) asks for a snapshot.
 *
 * Cost: the map is cut into 32×32 chunks and only the chunks where something may move are
 * scanned. A chunk falls asleep when nothing moved in it; a move, an explosion or an edit
 * wakes it and its neighbours. Lakes at rest cost nothing.
 *
 * Determinism of the sleeping: a chunk only sleeps if none of its cells could move, and
 * whatever could make one move (a change within the reach of the rules, or a cell that
 * skipped its move on a dice roll) keeps it awake — the awake set is part of the state
 * (sent with snapshots and included in the hash).
 */

const { MAT_AIR: AIR, MAT_DIRT: DIRT, MAT_ACID: ACID, MAT_ICE: ICE, MAT_WATER: WATER, MAT_WOOD: WOOD, MAT_LAVA: LAVA,
  MAT_BOUNCE: BOUNCE, MAT_SAND: SAND, MAT_POWDER: POWDER, MAT_OBSIDIAN: OBSIDIAN } = CONFIG;

const SHIFT = 5;
export const CHUNK = 1 << SHIFT;

/** Moving materials: 1 = grains (sand), 2 = liquids */
const KIND = new Uint8Array(256);
KIND[SAND] = 1;
KIND[WATER] = KIND[ACID] = KIND[LAVA] = 2;

/** What sinks through what: a mover enters any cell of lower density (air = 0, solids = 255) */
const DENS = new Uint8Array(256).fill(255);
DENS[AIR] = 0;
DENS[WATER] = 1;
DENS[ACID] = 2;
DENS[LAVA] = 3;
DENS[SAND] = 4;

/** How far a liquid looks sideways for somewhere lower to flow to, and how fast it goes there */
const REACH = new Uint8Array(256);
REACH[WATER] = 64;
REACH[ACID] = 40;
REACH[LAVA] = 16;
const SPEED = new Uint8Array(256);
SPEED[WATER] = 6;
SPEED[ACID] = 3;
SPEED[LAVA] = 2;
/** Drops deeper than this are all as good */
const MAX_DEPTH = 8;

/** Materials acid eats (rock and mana crystals resist) */
const CORRODIBLE = new Uint8Array(256);
for (const m of [DIRT, SAND, WOOD, ICE, BOUNCE, POWDER, OBSIDIAN]) CORRODIBLE[m] = 1;

/** Chunks woken around a change: a cell may react to anything within its sideways reach */
const WAKE_X = 65;
const WAKE_Y = 2;

/** Odds (1 / n per tick and per cell) of the slow reactions */
const ACID_EAT = 700;
const LAVA_MELT = 20;
const LAVA_BURN = 40;

export const enum Reaction {
  Steam = 0,   // lava met water → obsidian + steam
  Acid = 1,    // acid ate a pixel
  Burn = 2,    // lava set wood on fire
  Melt = 3     // lava melted ice
}

/** Integer hash of (cell, tick): the dice of the automaton, identical everywhere */
function hash(i: number, t: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(t + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export class FluidSim {
  private readonly W: number;
  private readonly H: number;
  private readonly m: Uint8Array;
  private readonly cw: number;
  private readonly ch: number;
  /** Chunks scanned at the next step (edits between steps add to it) */
  private awake: Uint8Array;
  /** Chunks to scan at the step after (filled while stepping) */
  private next: Uint8Array;
  /** Tick at which a cell last moved: a cell moves at most once per step */
  private readonly stamp: Int32Array;
  private tick = 0;
  private corrode = true;
  // Bounding box of the cells changed in each chunk during the step (for the renderers)
  private readonly bx0: Int16Array;
  private readonly by0: Int16Array;
  private readonly bx1: Int16Array;
  private readonly by1: Int16Array;
  private touched: number[] = [];
  private readonly isTouched: Uint8Array;
  /** Visual effects of this step, flat [Reaction, x, y, …] (read and cleared by the game) */
  public readonly reactions: number[] = [];

  constructor(materials: Uint8Array, width: number, height: number) {
    this.m = materials;
    this.W = width;
    this.H = height;
    this.cw = Math.ceil(width / CHUNK);
    this.ch = Math.ceil(height / CHUNK);
    const n = this.cw * this.ch;
    this.awake = new Uint8Array(n).fill(1);
    this.next = new Uint8Array(n);
    this.stamp = new Int32Array(width * height);
    this.bx0 = new Int16Array(n);
    this.by0 = new Int16Array(n);
    this.bx1 = new Int16Array(n);
    this.by1 = new Int16Array(n);
    this.isTouched = new Uint8Array(n);
  }

  // ── Wake / sleep ──────────────────────────────────────────────────────────

  /** New map / snapshot: forget the past steps, everything may move */
  public reset() {
    this.stamp.fill(0);
    for (const c of this.touched) this.isTouched[c] = 0;
    this.touched.length = 0;
    this.reactions.length = 0;
    this.wakeAll();
  }

  /** Everything may move */
  public wakeAll() {
    this.awake.fill(1);
    this.next.fill(0);
  }

  /** The cells of this rectangle changed outside the automaton (crater, flood…) */
  public wakeRect(x0: number, y0: number, x1: number, y1: number) {
    this.wake(this.awake, x0 - WAKE_X, y0 - WAKE_Y, x1 + WAKE_X, y1 + WAKE_Y);
  }

  private wake(set: Uint8Array, x0: number, y0: number, x1: number, y1: number) {
    const cx0 = Math.max(0, x0 >> SHIFT), cx1 = Math.min(this.cw - 1, x1 >> SHIFT);
    const cy0 = Math.max(0, y0 >> SHIFT), cy1 = Math.min(this.ch - 1, y1 >> SHIFT);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) set[cy * this.cw + cx] = 1;
    }
  }

  /** Awake chunks (part of the synchronised state: sent with snapshots) */
  public getAwake(): Uint8Array {
    return this.awake.slice();
  }

  public setAwake(a: Uint8Array) {
    if (a.length === this.awake.length) this.awake.set(a);
    else this.awake.fill(1);
    this.next.fill(0);
  }

  public get activeChunks(): number {
    let n = 0;
    for (let i = 0; i < this.awake.length; i++) n += this.awake[i];
    return n;
  }

  /** Fingerprint of the grid + awake chunks (compared between host and clients) */
  public hash(): number {
    const m = this.m;
    let h = 0x811c9dc5 | 0;
    const words = m.length >> 2;
    const u32 = new Uint32Array(m.buffer, m.byteOffset, words);
    for (let k = 0; k < words; k++) h = Math.imul(h ^ u32[k], 16777619);
    for (let k = words << 2; k < m.length; k++) h = Math.imul(h ^ m[k], 16777619);
    const a = this.awake;
    for (let k = 0; k < a.length; k++) h = Math.imul(h ^ (a[k] + k), 16777619);
    return h >>> 0;
  }

  // ── Step ──────────────────────────────────────────────────────────────────

  /**
   * One step of the automaton. `onDirty` receives the rectangles that changed.
   * `corrode` = false: no acid erosion (used to settle a map before it is played).
   */
  public step(tick: number, onDirty: (x0: number, y0: number, x1: number, y1: number) => void, corrode = true) {
    this.tick = tick;
    this.corrode = corrode;
    const { W, H, m, cw, ch, awake } = this;
    for (let cy = ch - 1; cy >= 0; cy--) {
      const row = cy * cw;
      let any = 0;
      for (let cx = 0; cx < cw; cx++) any |= awake[row + cx];
      if (!any) continue;
      const yTop = cy << SHIFT;
      const yBot = Math.min(H, yTop + CHUNK) - 1;
      // Bottom to top (falling things make room for the ones above), alternating sideways
      for (let y = yBot; y >= yTop; y--) {
        const ltr = ((y ^ tick) & 1) === 0;
        const base = y * W;
        for (let k = 0; k < cw; k++) {
          const cx = ltr ? k : cw - 1 - k;
          if (!awake[row + cx]) continue;
          const x0 = cx << SHIFT;
          const x1 = Math.min(W, x0 + CHUNK) - 1;
          if (ltr) {
            for (let x = x0; x <= x1; x++) if (KIND[m[base + x]] !== 0) this.cell(x, y, base + x);
          } else {
            for (let x = x1; x >= x0; x--) if (KIND[m[base + x]] !== 0) this.cell(x, y, base + x);
          }
        }
      }
    }
    // The chunks to scan next time
    const done = this.awake;
    this.awake = this.next;
    this.next = done;
    this.next.fill(0);
    for (const c of this.touched) {
      onDirty(this.bx0[c], this.by0[c], this.bx1[c], this.by1[c]);
      this.isTouched[c] = 0;
    }
    this.touched.length = 0;
  }

  private cell(x: number, y: number, i: number) {
    const tick = this.tick;
    if (this.stamp[i] === tick) return;
    const m = this.m;
    const v = m[i];
    const h = hash(i, tick);

    if (v === LAVA) {
      if (this.lavaReacts(x, y, i, h)) return;
      // Lava is thick: it drips down normally but only spreads one step in two
      if ((h & 0x100000) !== 0) {
        if (y + 1 < this.H && this.m[i + this.W] === AIR) this.swap(i, x, y, i + this.W, x, y + 1);
        else if (this.move(x, y, i, v, h, true)) this.keep(x, y);
        return;
      }
    } else if (v === ACID && this.corrode) {
      if (this.acidEats(x, y, i, h)) return;
    }
    this.move(x, y, i, v, h, false);
  }

  /**
   * Falls, slides down diagonally, or (liquids) flows sideways towards somewhere lower.
   * `dry`: only tells whether it could move.
   */
  private move(x: number, y: number, i: number, v: number, h: number, dry: boolean): boolean {
    const { m, W, H } = this;
    if (y + 1 >= H) return false;
    const d = DENS[v];

    // 1. Straight down (through air, or sinking through a lighter liquid)
    const below = m[i + W];
    if (DENS[below] < d) {
      if (dry) return true;
      if (below !== AIR && (h & 8) !== 0) {
        this.keep(x, y); // sinking is slower than falling
        return true;
      }
      // Free fall: up to 3 pixels per tick through the air (lava: 1)
      let ny = y + 1;
      if (below === AIR && v !== LAVA) {
        while (ny < y + 3 && ny + 1 < H && m[(ny + 1) * W + x] === AIR) ny++;
      }
      this.swap(i, x, y, ny * W + x, x, ny);
      return true;
    }

    // 2. Diagonally down, if the side is open too (piles at 45°, no leaking through corners)
    const s0 = (h & 1) !== 0 ? 1 : -1;
    for (let n = 0; n < 2; n++) {
      const s = n === 0 ? s0 : -s0;
      const nx = x + s;
      if (nx < 0 || nx >= W) continue;
      if (DENS[m[i + s]] < d && DENS[m[i + W + s]] < d) {
        if (!dry) this.swap(i, x, y, i + W + s, nx, y + 1);
        return true;
      }
    }
    if (KIND[v] !== 2) return false;

    // 3. Liquids: flow sideways over the surface towards somewhere lower — the deepest drop
    //    within reach (so a tilted surface levels out quickly). Only towards a drop: a level
    //    surface never moves, so lakes fall asleep.
    const reach = REACH[v];
    // A cell of the surface glides over the rest of the surface (no traffic jam behind the first one).
    // (Not under a little air bubble: the lake would turn into foam.)
    const surface = y < 2 || (KIND[m[i - W]] !== 2 && KIND[m[i - 2 * W]] !== 2);
    let bestK = 0;
    let bestS = 0;
    let bestDepth = 0;
    for (let n = 0; n < 2; n++) {
      const s = n === 0 ? s0 : -s0;
      for (let k = 1; k <= reach; k++) {
        const nx = x + s * k;
        if (nx < 0 || nx >= W) break;
        const j = i + s * k;
        const c = m[j];
        if (c !== AIR) {
          if (c === v && surface) continue;
          break;
        }
        if (DENS[m[j + W]] >= d) continue;
        if (dry) return true;
        let depth = 1;
        while (depth < MAX_DEPTH && y + depth + 1 < H && DENS[m[j + (depth + 1) * W]] < d) depth++;
        if (depth > bestDepth) {
          bestDepth = depth;
          bestK = k;
          bestS = s;
          if (depth === MAX_DEPTH) break;
        }
      }
      if (bestDepth === MAX_DEPTH) break;
    }
    if (bestDepth === 0) return false;
    // At most SPEED cells per tick, landing on air (the path may cross other surface cells)
    let step = Math.min(bestK, SPEED[v]);
    while (m[i + bestS * step] !== AIR) step++;
    this.swap(i, x, y, i + bestS * step, x + bestS * step, y);
    return true;
  }

  /** Lava: water → obsidian + steam; slowly melts ice and burns wood. Returns true if the lava is gone. */
  private lavaReacts(x: number, y: number, i: number, h: number): boolean {
    const { m, W, H } = this;
    let slow = false;
    for (let n = 0; n < 4; n++) {
      const nx = n === 1 ? x - 1 : n === 2 ? x + 1 : x;
      const ny = n === 0 ? y + 1 : n === 3 ? y - 1 : y;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      const o = m[j];
      if (o === WATER) {
        m[i] = OBSIDIAN;
        m[j] = AIR;
        this.changed(i, x, y);
        this.changed(j, nx, ny);
        this.fx(Reaction.Steam, nx, ny);
        return true;
      }
      if (o === ICE) {
        slow = true;
        if ((h >>> 4) % LAVA_MELT === 0) {
          m[j] = WATER;
          this.changed(j, nx, ny);
          this.fx(Reaction.Melt, nx, ny);
        }
      } else if (o === WOOD) {
        slow = true;
        if ((h >>> 9) % LAVA_BURN === 0) {
          m[j] = AIR;
          this.changed(j, nx, ny);
          this.fx(Reaction.Burn, nx, ny);
        }
      }
    }
    if (slow) this.keep(x, y);
    return false;
  }

  /** Acid slowly dissolves soft materials (and itself, half of the time). Returns true if the acid is gone. */
  private acidEats(x: number, y: number, i: number, h: number): boolean {
    const { m, W, H } = this;
    for (let n = 0; n < 4; n++) {
      const nx = n === 1 ? x - 1 : n === 2 ? x + 1 : x;
      const ny = n === 0 ? y + 1 : n === 3 ? y - 1 : y;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (!CORRODIBLE[m[j]]) continue;
      this.keep(x, y);
      if ((h >>> 5) % ACID_EAT !== 0) return false;
      m[j] = AIR;
      this.changed(j, nx, ny);
      this.fx(Reaction.Acid, nx, ny);
      if ((h & 0x30000) === 0) { // the acid is used up one time in four
        m[i] = AIR;
        this.changed(i, x, y);
        return true;
      }
      return false;
    }
    return false;
  }

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  private swap(i: number, x: number, y: number, j: number, nx: number, ny: number) {
    const m = this.m;
    const a = m[i];
    m[i] = m[j];
    m[j] = a;
    this.changed(i, x, y);
    this.changed(j, nx, ny);
  }

  /** A cell changed during the step: it can't move again, its surroundings wake up, the renderers repaint it */
  private changed(i: number, x: number, y: number) {
    this.stamp[i] = this.tick;
    this.wake(this.next, x - WAKE_X, y - WAKE_Y, x + WAKE_X, y + WAKE_Y);
    // Also this step, for the rows not scanned yet (same on every machine: it only depends on the grid)
    this.wake(this.awake, x - WAKE_X, y - WAKE_Y, x + WAKE_X, y - 1);
    const c = (y >> SHIFT) * this.cw + (x >> SHIFT);
    if (this.isTouched[c]) {
      if (x < this.bx0[c]) this.bx0[c] = x;
      if (x > this.bx1[c]) this.bx1[c] = x;
      if (y < this.by0[c]) this.by0[c] = y;
      if (y > this.by1[c]) this.by1[c] = y;
    } else {
      this.isTouched[c] = 1;
      this.touched.push(c);
      this.bx0[c] = this.bx1[c] = x;
      this.by0[c] = this.by1[c] = y;
    }
  }

  /** The cell wanted to move but the dice said no: scan its chunk again next step */
  private keep(x: number, y: number) {
    this.next[(y >> SHIFT) * this.cw + (x >> SHIFT)] = 1;
  }

  private fx(kind: Reaction, x: number, y: number) {
    if (this.reactions.length < 600) this.reactions.push(kind, x, y);
  }
}
