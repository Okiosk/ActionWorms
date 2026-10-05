import { CONFIG } from '../config';

/**
 * Procedural map layouts. Each generator writes material ids into the grid;
 * Terrain then paints them with the map's theme.
 */

export type MapType = 'cave' | 'volcano' | 'forest' | 'citadel' | 'glacier' | 'sky' | 'desert' | 'mine' | 'hourglass';

type RGB = [number, number, number];

export interface MapTheme {
  skyTop: string;
  skyBottom: string;
  dirt: RGB;
  surface: RGB | null;   // grass / snow / ash on dirt exposed to the air
  leaves?: RGB;          // forest canopy colour
  rock: RGB;
  bricks?: boolean;      // rock drawn as masonry
  backdrop: 'cave' | 'volcano' | 'forest' | 'citadel' | 'glacier' | 'sky' | 'desert' | 'mine' | 'clock';
}

export const MAP_THEMES: Record<MapType, MapTheme> = {
  cave:    { skyTop: '#1c110b', skyBottom: '#0b0705', dirt: [120, 75, 40], surface: null, rock: [80, 82, 92], backdrop: 'cave' },
  volcano: { skyTop: '#2e0b05', skyBottom: '#120403', dirt: [92, 56, 42], surface: [78, 68, 66], rock: [52, 44, 48], backdrop: 'volcano' },
  forest:  { skyTop: '#0e2230', skyBottom: '#06110d', dirt: [100, 68, 40], surface: [70, 150, 55], leaves: [46, 118, 44], rock: [92, 96, 96], backdrop: 'forest' },
  citadel: { skyTop: '#1e1534', skyBottom: '#0b0814', dirt: [118, 88, 60], surface: [78, 128, 58], rock: [122, 118, 128], bricks: true, backdrop: 'citadel' },
  glacier: { skyTop: '#0c1733', skyBottom: '#050a18', dirt: [104, 96, 92], surface: [232, 238, 250], rock: [74, 84, 102], backdrop: 'glacier' },
  sky:     { skyTop: '#22306a', skyBottom: '#0f1533', dirt: [122, 82, 46], surface: [92, 172, 72], rock: [96, 96, 108], backdrop: 'sky' },
  desert:  { skyTop: '#1b1436', skyBottom: '#7a3f2c', dirt: [168, 112, 70], surface: null, rock: [176, 136, 92], bricks: true, backdrop: 'desert' },
  mine:    { skyTop: '#140e0a', skyBottom: '#070504', dirt: [92, 66, 48], surface: null, rock: [74, 74, 82], backdrop: 'mine' },
  hourglass: { skyTop: '#141a33', skyBottom: '#06080f', dirt: [104, 84, 66], surface: [96, 150, 70], rock: [150, 128, 92], bricks: true, backdrop: 'clock' }
};

export interface GeneratedLayout {
  canopyLine?: Int16Array;
}

const { MAT_AIR: AIR, MAT_DIRT: DIRT, MAT_ROCK: ROCK, MAT_ACID: ACID, MAT_ICE: ICE, MAT_WATER: WATER,
  MAT_CRYSTAL: CRYSTAL, MAT_WOOD: WOOD, MAT_LAVA: LAVA, MAT_BOUNCE: BOUNCE, MAT_SAND: SAND, MAT_POWDER: POWDER } = CONFIG;

const BORDER = 10;

export function generateLayout(
  materials: Uint8Array, W: number, H: number, type: MapType, rand: () => number, hazards: boolean
): GeneratedLayout {
  const g = new Grid(materials, W, H, rand);
  let layout: GeneratedLayout = {};
  switch (type) {
    case 'volcano': genVolcano(g, hazards); break;
    case 'forest': layout = genForest(g, hazards); break;
    case 'citadel': genCitadel(g, hazards); break;
    case 'glacier': genGlacier(g); break;
    case 'sky': genSky(g, hazards); break;
    case 'desert': genDesert(g, hazards); break;
    case 'mine': genMine(g, hazards); break;
    case 'hourglass': genHourglass(g, hazards); break;
    case 'cave':
    default: genCave(g, hazards); break;
  }
  g.smoothEdges(2);
  g.border(BORDER);
  return layout;
}

// ═════════════════════════════════════════════════════════════════════════════
// Grid helpers
// ═════════════════════════════════════════════════════════════════════════════

type Filter = number[] | null;

class Grid {
  constructor(public m: Uint8Array, public W: number, public H: number, public rand: () => number) {}

  r(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  ri(min: number, max: number): number {
    return Math.floor(this.r(min, max + 1));
  }

  get(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return ROCK;
    return this.m[y * this.W + x];
  }

  set(x: number, y: number, v: number, only: Filter = null) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    if (only && !only.includes(this.m[i])) return;
    this.m[i] = v;
  }

  fill(v: number) {
    this.m.fill(v);
  }

  rect(x0: number, y0: number, x1: number, y1: number, v: number, only: Filter = null) {
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) this.set(x, y, v, only);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, v: number, only: Filter = null, upperHalfOnly = false) {
    for (let y = Math.floor(cy - ry); y <= cy + (upperHalfOnly ? 0 : ry); y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, v, only);
      }
    }
  }

  circle(cx: number, cy: number, r: number, v: number, only: Filter = null) {
    this.ellipse(cx, cy, r, r, v, only);
  }

  /** Irregular round blob */
  blob(cx: number, cy: number, r: number, v: number, only: Filter = null) {
    const phase = this.rand() * 10;
    const lobes = this.ri(3, 6);
    for (let y = Math.floor(cy - r * 1.3); y <= cy + r * 1.3; y++) {
      for (let x = Math.floor(cx - r * 1.3); x <= cx + r * 1.3; x++) {
        const a = Math.atan2(y - cy, x - cx);
        const rr = r * (1 + 0.25 * Math.sin(a * lobes + phase));
        if (Math.hypot(x - cx, y - cy) <= rr) this.set(x, y, v, only);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, thick: number, v: number, only: Filter = null) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick / 2, v, only);
    }
  }

  /**
   * Majority filter on dirt/air: removes the 1-pixel bumps and holes left by noise,
   * so edges are smooth curves (deterministic: same result for every player).
   */
  smoothEdges(passes: number) {
    const { W, H, m } = this;
    for (let pass = 0; pass < passes; pass++) {
      const src = m.slice();
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const v = src[i];
          if (v !== AIR && v !== DIRT) continue;
          let solid = 0;
          let other = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const n = src[i + dy * W + dx];
              if (n === DIRT) solid++;
              else if (n !== AIR) other = true;
            }
          }
          if (other) continue; // leave borders with other materials untouched
          if (v === AIR && solid >= 6) m[i] = DIRT;
          else if (v === DIRT && solid <= 2) m[i] = AIR;
        }
      }
    }
  }

  border(b: number) {
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (x < b || y < b || x >= this.W - b || y >= this.H - b) this.m[y * this.W + x] = ROCK;
      }
    }
  }

  /** Smooth value noise in [0, 1] with features about `scale` pixels wide */
  noise(scale: number): (x: number, y: number) => number {
    const gw = Math.ceil(this.W / scale) + 2;
    const gh = Math.ceil(this.H / scale) + 2;
    const grid = new Float32Array(gw * gh).map(() => this.rand());
    const s = (t: number) => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / scale;
      const fy = y / scale;
      const ix = Math.max(0, Math.min(gw - 2, Math.floor(fx)));
      const iy = Math.max(0, Math.min(gh - 2, Math.floor(fy)));
      const tx = s(fx - ix);
      const ty = s(fy - iy);
      const a = grid[iy * gw + ix];
      const b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix];
      const d = grid[(iy + 1) * gw + ix + 1];
      return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
  }

  /** Fractal noise (several octaves) in [0, 1] */
  fbm(scale: number, octaves: number): (x: number, y: number) => number {
    const layers = Array.from({ length: octaves }, (_, i) => this.noise(scale / 2 ** i));
    let norm = 0;
    for (let i = 0; i < octaves; i++) norm += 0.5 ** i;
    return (x, y) => {
      let v = 0;
      for (let i = 0; i < octaves; i++) v += layers[i](x, y) * 0.5 ** i;
      return v / norm;
    };
  }

  /** First non-air y below (x, y), or -1 */
  floorBelow(x: number, y: number): number {
    for (let yy = Math.floor(y); yy < this.H - BORDER; yy++) {
      if (this.get(x, yy) !== AIR) return yy;
    }
    return -1;
  }

  /**
   * Fills the air pocket under a water level with a liquid: drop from (x, y) to the floor,
   * the level is `depth` px above it. Aborts if the pocket is open (too big / reaches the edges).
   */
  basin(x: number, y: number, depth: number, v: number, maxPixels: number): boolean {
    const floor = this.floorBelow(x, y);
    if (floor < 0 || this.get(x, floor) === WATER || this.get(x, floor) === LAVA) return false;
    const level = floor - depth;
    const start = (floor - 1) * this.W + Math.floor(x);
    if (this.m[start] !== AIR) return false;
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      const px = i % this.W;
      const py = (i - px) / this.W;
      if (px <= BORDER + 2 || px >= this.W - BORDER - 3 || py >= this.H - BORDER - 1) return false;
      for (const n of [i - 1, i + 1, i - this.W, i + this.W]) {
        const ny = Math.floor(n / this.W);
        if (ny < level || seen.has(n) || this.m[n] !== AIR) continue;
        seen.add(n);
        if (seen.size > maxPixels) return false;
        queue.push(n);
      }
    }
    for (const i of seen) this.m[i] = v;
    return true;
  }

  /** A random air point that has solid ground right below it */
  floorSpot(x0 = BORDER + 20, x1 = this.W - BORDER - 20, y0 = BORDER + 20, y1 = this.H - BORDER - 20): { x: number; y: number } | null {
    for (let i = 0; i < 200; i++) {
      const x = this.ri(x0, x1);
      const y = this.ri(y0, y1);
      if (this.get(x, y) !== AIR) continue;
      const f = this.floorBelow(x, y);
      if (f < 0 || f > y1 + 40) continue;
      const m = this.get(x, f);
      if (m === WATER || m === LAVA || m === ACID) continue;
      return { x, y: f };
    }
    return null;
  }

  /** A solid pixel of the given materials touching the air (cave wall) */
  wallSpot(of: number[]): { x: number; y: number } | null {
    for (let i = 0; i < 400; i++) {
      const x = this.ri(BORDER + 10, this.W - BORDER - 10);
      const y = this.ri(BORDER + 10, this.H - BORDER - 10);
      if (!of.includes(this.get(x, y))) continue;
      if (this.get(x + 3, y) === AIR || this.get(x - 3, y) === AIR || this.get(x, y - 3) === AIR || this.get(x, y + 3) === AIR) {
        return { x, y };
      }
    }
    return null;
  }

  /** Small bouncy mushroom standing on the floor at (x, floorY) */
  mushroom(x: number, floorY: number, size: number) {
    const stemH = Math.round(size * 0.9);
    this.rect(x - 2, floorY - stemH, x + 2, floorY + 1, WOOD, [AIR, DIRT]);
    this.ellipse(x, floorY - stemH, size, size * 0.45, BOUNCE, [AIR, DIRT, WOOD], true);
  }

  /** Crystal cluster growing out of a wall */
  crystals(count: number, on: number[]) {
    for (let i = 0; i < count; i++) {
      const p = this.wallSpot(on);
      if (p) this.blob(p.x, p.y, this.r(5, 9), CRYSTAL, [...on, AIR]);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Grottes de Cristal — organic caverns, crystal veins, underground lakes
// ═════════════════════════════════════════════════════════════════════════════

function genCave(g: Grid, hazards: boolean) {
  const { W, H } = g;
  g.fill(DIRT);

  // Organic caverns from fractal noise, a bit more open in the middle band
  const n = g.fbm(90, 3);
  for (let y = 0; y < H; y++) {
    const band = 1 - Math.abs(y / H - 0.5) * 0.5;
    for (let x = 0; x < W; x++) {
      if (n(x, y) * band > 0.45) g.m[y * W + x] = AIR;
    }
  }

  // Tunnels so every cavern is reachable
  for (let t = 0; t < 8; t++) {
    let x = g.r(60, W - 60);
    let y = g.r(60, H - 60);
    let a = g.r(0, Math.PI * 2);
    const r = g.r(8, 12);
    for (let s = 0; s < 120; s++) {
      a += g.r(-0.35, 0.35);
      x = Math.max(30, Math.min(W - 30, x + Math.cos(a) * 3));
      y = Math.max(30, Math.min(H - 30, y + Math.sin(a) * 2));
      g.circle(x, y, r, AIR, [DIRT]);
    }
  }

  // Rock veins and boulders
  const v = g.fbm(55, 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(v(x, y) - 0.5) < 0.016 && g.m[y * W + x] === DIRT) g.m[y * W + x] = ROCK;
    }
  }
  for (let i = 0; i < 9; i++) g.blob(g.r(40, W - 40), g.r(40, H - 40), g.r(7, 14), ROCK);

  // Underground lakes in the bottoms of caverns
  for (let i = 0, lakes = 0; i < 40 && lakes < 5; i++) {
    const p = g.floorSpot(40, W - 40, H * 0.35, H - 40);
    if (p && g.basin(p.x, p.y - 2, g.ri(10, 22), WATER, 5000)) lakes++;
  }

  if (hazards) {
    for (let i = 0, pools = 0; i < 30 && pools < 2; i++) {
      const p = g.floorSpot();
      if (p && g.basin(p.x, p.y - 2, 6, ACID, 900)) pools++;
    }
  }

  g.crystals(18, [DIRT, ROCK]);

  for (let i = 0; i < 4; i++) {
    const p = g.floorSpot();
    if (p) g.mushroom(p.x, p.y, g.r(7, 10));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Cœur du Volcan — lava lake, central cone with a magma chimney, wooden bridges
// ═════════════════════════════════════════════════════════════════════════════

function genVolcano(g: Grid, hazards: boolean) {
  const { W, H } = g;
  const liquid = hazards ? LAVA : WATER;
  const lavaTop = Math.round(H * 0.82);
  const cx = W / 2;
  g.fill(AIR);

  // Lava lake and basalt bed
  g.rect(0, lavaTop, W, H, liquid);
  g.rect(0, H - 26, W, H, ROCK);

  // Side cliffs with caves
  const wob = g.noise(40);
  const cave = g.fbm(45, 2);
  for (let y = Math.round(H * 0.18); y < H - 26; y++) {
    for (let x = 0; x < W; x++) {
      const edge = 70 + (wob(x, y) - 0.5) * 40 + (y / H) * 25;
      const inCliff = x < edge || x > W - edge;
      if (!inCliff) continue;
      g.m[y * W + x] = cave(x, y) > 0.6 && y < lavaTop - 6 ? AIR : DIRT;
    }
  }

  // The volcano cone
  const top = Math.round(H * 0.3);
  const base = lavaTop + 10;
  const n = g.noise(25);
  for (let y = top; y < H - 26; y++) {
    const t = Math.min(1, (y - top) / (base - top));
    const hw = 40 + t * 105 + (n(cx, y) - 0.5) * 16;
    for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
      g.set(x, y, Math.abs(x - cx) > hw - 5 && y > lavaTop - 40 ? ROCK : DIRT);
    }
  }
  // Rocky streaks in the cone
  const streak = g.fbm(30, 2);
  for (let y = top; y < lavaTop; y++) {
    for (let x = cx - 190; x < cx + 190; x++) {
      if (g.get(x, y) === DIRT && Math.abs(streak(x, y) - 0.5) < 0.02) g.set(x, y, ROCK);
    }
  }
  // Crater and magma chimney (blast the cone open to reach it!)
  g.ellipse(cx, top, 36, 24, AIR);
  g.rect(cx - 7, top + 18, cx + 7, lavaTop, liquid);
  g.ellipse(cx, top + 20, 22, 6, liquid, [DIRT, ROCK, AIR]);
  g.rect(cx - 30, top + 6, cx + 30, top + 13, AIR, [liquid]);
  // Side chambers inside the cone with obsidian crystals
  for (const side of [-1, 1]) {
    const chx = cx + side * g.r(55, 75);
    const chy = g.r(H * 0.5, H * 0.66);
    g.blob(chx, chy, g.r(18, 24), AIR, [DIRT]);
    g.crystals(3, [DIRT]);
    // Tunnel from the chamber to the outside of the cone
    g.line(chx, chy, cx + side * 160, chy - g.r(10, 30), 16, AIR, [DIRT, ROCK]);
  }

  // Basalt stepping stones rising from the lava
  for (const x of [g.r(120, 150), g.r(190, 225), W - g.r(120, 150), W - g.r(190, 225)]) {
    const h = g.r(40, 110);
    const w = g.r(7, 11);
    g.rect(x - w, lavaTop - h, x + w, lavaTop + 5, ROCK);
    g.ellipse(x, lavaTop - h, w + 3, 4, DIRT, [AIR]);
  }

  // Wooden bridges from the cliffs to the cone (fire spells burn them!)
  const bridgeY = Math.round(H * g.r(0.58, 0.64));
  for (const side of [-1, 1]) {
    const from = side < 0 ? 60 : W - 60;
    const to = cx + side * 95;
    g.rect(Math.min(from, to), bridgeY, Math.max(from, to), bridgeY + 3, WOOD, [AIR]);
    for (let x = Math.min(from, to); x < Math.max(from, to); x += 26) {
      g.line(x, bridgeY + 3, x + 13, bridgeY + 16, 2, WOOD, [AIR]);
    }
  }

  // Floating obsidian
  for (let i = 0; i < 6; i++) g.blob(g.r(130, W - 130), g.r(H * 0.12, H * 0.45), g.r(5, 10), ROCK, [AIR]);

  // Mushroom-free volcano, but bouncy lichen on the cliff tops
  for (let i = 0; i < 2; i++) {
    const p = g.floorSpot(20, 90, H * 0.1, H * 0.4);
    if (p) g.mushroom(p.x, p.y, 8);
    const q = g.floorSpot(W - 90, W - 20, H * 0.1, H * 0.4);
    if (q) g.mushroom(q.x, q.y, 8);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Forêt Ancestrale — hills, giant trees, a river, bouncy mushrooms, roots
// ═════════════════════════════════════════════════════════════════════════════

function genForest(g: Grid, hazards: boolean): GeneratedLayout {
  const { W, H } = g;
  g.fill(AIR);
  const hill = g.noise(120);
  const valleyX = W * g.r(0.42, 0.58);
  const ground = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    const dip = Math.max(0, 1 - Math.abs(x - valleyX) / 110);
    ground[x] = Math.round(H * 0.64 + (hill(x, 0) - 0.5) * 70 + Math.sin(dip * Math.PI / 2) * 70);
  }
  for (let x = 0; x < W; x++) g.rect(x, ground[x], x, H, DIRT);
  g.rect(0, H - 22, W, H, ROCK);

  // Burrows under the forest floor
  const burrow = g.fbm(40, 2);
  for (let y = 0; y < H - 22; y++) {
    for (let x = 0; x < W; x++) {
      if (y > ground[x] + 28 && burrow(x, y) > 0.62) g.set(x, y, AIR);
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = g.r(30, W - 30);
    g.blob(x, ground[Math.floor(x)] + g.r(15, 60), g.r(6, 12), ROCK, [DIRT]);
  }

  // River in the valley
  g.basin(valleyX, ground[Math.floor(valleyX)] - 2, 38, WATER, 12000);
  if (hazards) {
    // Acid bog somewhere on the hills
    const bx = valleyX < W / 2 ? g.r(W * 0.72, W * 0.85) : g.r(W * 0.15, W * 0.28);
    g.ellipse(bx, ground[Math.floor(bx)] + 2, 22, 7, AIR, [DIRT]);
    g.basin(bx, ground[Math.floor(bx)], 5, ACID, 600);
  }

  // Giant trees (wood resists explosions, fire burns it) with leafy canopies
  const canopy = new Int16Array(W);
  for (let x = 0; x < W; x++) canopy[x] = ground[x] - 6;
  const trees = [W * 0.1, W * 0.27, W * 0.73, W * 0.9].map(x => x + g.r(-25, 25)).filter(x => Math.abs(x - valleyX) > 120);
  for (const tx of trees) {
    const gy = ground[Math.floor(tx)];
    const h = g.r(140, 210);
    const topY = gy - h;
    g.rect(tx - 5, topY, tx + 5, gy + 10, WOOD);
    // Roots
    for (let k = 0; k < 4; k++) g.line(tx, gy + 4, tx + g.r(-45, 45), gy + g.r(25, 55), 3, WOOD, [DIRT, AIR]);
    // Branches and leaf clusters
    for (let k = 0; k < 4; k++) {
      const by = topY + g.r(15, h * 0.6);
      const dir = k % 2 === 0 ? -1 : 1;
      const len = g.r(35, 65);
      const ex = tx + dir * len;
      const ey = by - g.r(12, 30);
      g.line(tx, by, ex, ey, 4, WOOD, [AIR, DIRT]);
      g.blob(ex, ey - 4, g.r(12, 18), DIRT, [AIR]);
    }
    g.blob(tx, topY - 6, g.r(22, 30), DIRT, [AIR]);
  }

  // Giant mushrooms: trampolines
  for (let i = 0, made = 0; i < 20 && made < 4; i++) {
    const x = g.r(40, W - 40);
    if (Math.abs(x - valleyX) < 80 || trees.some(t => Math.abs(t - x) < 45)) continue;
    const gy = ground[Math.floor(x)];
    const h = g.r(18, 40);
    g.rect(x - 3, gy - h, x + 3, gy + 2, WOOD, [AIR, DIRT]);
    g.ellipse(x, gy - h, g.r(14, 22), 9, BOUNCE, [AIR, DIRT, WOOD], true);
    made++;
  }

  g.crystals(8, [DIRT, ROCK]);
  return { canopyLine: canopy };
}

// ═════════════════════════════════════════════════════════════════════════════
// Citadelle — two mirrored castles, a moat and a bridge, a treasure vault each
// ═════════════════════════════════════════════════════════════════════════════

function genCitadel(g: Grid, hazards: boolean) {
  const { W, H } = g;
  const half = W / 2;
  const gy = Math.round(H * 0.78);
  g.fill(AIR);

  // Ground (left half — mirrored at the end)
  const n = g.noise(60);
  for (let x = 0; x < half; x++) {
    const y = gy + Math.round((n(x, 0) - 0.5) * 8);
    g.rect(x, y, x, H, DIRT);
  }
  g.rect(0, H - 20, half, H, ROCK);

  // Moat in the middle, with a wooden drawbridge
  g.rect(half - 72, gy - 2, half, gy + 44, AIR);
  g.rect(half - 72, gy + 44, half, gy + 50, ROCK);
  g.rect(half - 72, gy + 8, half, gy + 43, WATER);
  g.rect(half - 80, gy - 3, half, gy, WOOD);

  // Castle
  const x0 = 34;
  const x1 = 250;
  const floors = [gy - 62, gy - 124, gy - 186];
  const roof = gy - 200;
  // Rock towers on both sides
  g.rect(x0, roof - 34, x0 + 22, gy, ROCK);
  g.rect(x1 - 18, roof, x1, gy, ROCK);
  // Merlons
  for (let x = x0; x <= x0 + 22; x += 8) g.rect(x, roof - 42, x + 4, roof - 34, ROCK);
  for (let x = x1 - 18; x <= x1; x += 8) g.rect(x, roof - 8, x + 4, roof, ROCK);
  // Wooden floors with a trapdoor alternating sides
  floors.forEach((fy, i) => {
    g.rect(x0 + 22, fy, x1 - 18, fy + 4, WOOD);
    const gapX = i % 2 === 0 ? x1 - 50 : x0 + 30;
    g.rect(gapX, fy, gapX + 22, fy + 4, AIR);
  });
  g.rect(x0 + 22, roof, x1 - 18, roof + 5, ROCK);
  // Destructible inner walls between floors (dirt), with doorways
  floors.forEach((fy, i) => {
    const wx = i % 2 === 0 ? 120 : 170;
    g.rect(wx, fy - 58, wx + 7, fy, DIRT, [AIR]);
    g.rect(wx, fy - 24, wx + 7, fy - 1, AIR);
  });
  // Windows in the front tower
  for (const fy of [gy, ...floors]) g.rect(x1 - 18, fy - 30, x1, fy - 12, AIR);
  // Bouncy mushroom by the gate to reach the upper floors from outside
  g.mushroom(x1 + 26, gy, 10);

  // Treasure vault under the castle, with a crystal hoard
  g.rect(70, gy + 14, 200, gy + 52, AIR);
  g.rect(70, gy + 52, 200, gy + 56, ROCK, [DIRT]);
  for (let i = 0; i < 5; i++) g.blob(g.r(85, 185), gy + g.r(44, 52), g.r(4, 7), CRYSTAL, [AIR, DIRT]);
  g.rect(95, gy - 1, 115, gy + 14, AIR); // shaft down from the ground floor
  if (hazards) g.rect(150, gy + 49, 180, gy + 52, ACID);

  // Floating keep in the middle (only the left half — mirrored)
  const ky = Math.round(H * 0.4);
  g.rect(half - 55, ky, half, ky + 6, ROCK);
  g.rect(half - 55, ky - 3, half, ky - 1, DIRT);
  g.rect(half - 55, ky - 26, half - 49, ky, ROCK);
  for (let i = 0; i < 2; i++) g.blob(half - g.r(10, 40), ky - g.r(6, 12), 4, CRYSTAL, [AIR]);

  // Earth mounds between the castle and the moat (cover)
  g.ellipse(g.r(290, 305), gy, g.r(18, 26), g.r(14, 22), DIRT, [AIR], true);
  g.blob(g.r(330, 340), gy - g.r(70, 100), g.r(8, 11), DIRT);

  // Sky stepping stones between the castle roof and the keep
  g.ellipse(g.r(285, 300), H * 0.28, 16, 4, DIRT);

  // Mirror the left half onto the right half → fair for both teams
  for (let y = 0; y < H; y++) {
    for (let x = Math.ceil(half); x < W; x++) g.m[y * W + x] = g.m[y * W + (W - 1 - x)];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Pics Gelés — icy mountains (slippery!), a frozen lake, icicles and ice caves
// ═════════════════════════════════════════════════════════════════════════════

function genGlacier(g: Grid) {
  const { W, H } = g;
  g.fill(AIR);
  const peaks = [g.r(0.12, 0.22), g.r(0.45, 0.55), g.r(0.78, 0.88)].map(p => ({ x: p * W, h: g.r(200, 290), w: g.r(90, 130) }));
  const wob = g.fbm(50, 3);
  const surface = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    let h = 40;
    for (const p of peaks) h = Math.max(h, p.h * Math.exp(-(((x - p.x) / p.w) ** 2)));
    surface[x] = Math.round(H - 30 - h + (wob(x, 0) - 0.5) * 40);
  }

  const core = g.noise(30);
  for (let x = 0; x < W; x++) {
    for (let y = surface[x]; y < H; y++) {
      const depth = y - surface[x];
      let m = DIRT;
      if (depth < 7) m = ICE;
      else if (depth > 95 + core(x, y) * 60) m = ROCK;
      g.m[y * W + x] = m;
    }
  }

  // Ice caves inside the mountains
  const caves = g.fbm(38, 2);
  for (let y = 0; y < H - 20; y++) {
    for (let x = 0; x < W; x++) {
      if (y > surface[x] + 22 && caves(x, y) > 0.6) g.m[y * W + x] = AIR;
    }
  }

  // Frozen lakes in the valleys between peaks: water under a crust of ice
  const sorted = [...peaks].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length - 1; i++) {
    let vx = Math.floor((sorted[i].x + sorted[i + 1].x) / 2);
    for (let x = Math.floor(sorted[i].x); x < sorted[i + 1].x; x++) if (surface[x] > surface[vx]) vx = x;
    const lakeTop = surface[vx] - g.ri(14, 24);
    g.ellipse(vx, surface[vx] + 6, g.r(55, 75), 26, AIR, [DIRT, ICE]);
    if (g.basin(vx, surface[vx] - 4, surface[vx] + 30 - lakeTop, WATER, 9000)) {
      // Ice crust on top
      for (let x = vx - 90; x < vx + 90; x++) {
        for (let y = lakeTop - 30; y < lakeTop + 40; y++) {
          if (g.get(x, y) === WATER && g.get(x, y - 1) === AIR) g.rect(x, y, x, y + 5, ICE, [WATER]);
        }
      }
    }
  }

  // Floating ice platforms with icicles
  for (let i = 0; i < 5; i++) {
    const px = g.r(60, W - 60);
    const py = g.r(40, H * 0.4);
    if (py > surface[Math.floor(px)] - 30) continue;
    const rx = g.r(22, 40);
    g.ellipse(px, py, rx, 5, ICE);
    for (let k = 0; k < 4; k++) {
      const ix = px + g.r(-rx * 0.8, rx * 0.8);
      const len = g.r(8, 20);
      for (let d = 0; d < len; d++) g.rect(ix - (1 - d / len) * 3, py + 4 + d, ix + (1 - d / len) * 3, py + 4 + d, ICE, [AIR]);
    }
  }

  g.crystals(12, [DIRT, ROCK]);
  for (let i = 0; i < 2; i++) {
    const p = g.floorSpot();
    if (p && g.get(p.x, p.y) !== ICE) g.mushroom(p.x, p.y, 8);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Archipel Céleste — floating islands over the ocean, mushrooms and hanging roots
// ═════════════════════════════════════════════════════════════════════════════

function genSky(g: Grid, hazards: boolean) {
  const { W, H } = g;
  g.fill(AIR);
  g.rect(0, Math.round(H * 0.9), W, H, WATER);
  g.rect(0, H - 14, W, H, ROCK);
  if (hazards) {
    // A few acid-coated reefs in the sea
    for (let i = 0; i < 3; i++) g.ellipse(g.r(80, W - 80), H * 0.9 + 6, g.r(12, 20), 5, ACID);
  }

  const islands: { x: number; y: number; w: number }[] = [];
  islands.push({ x: W / 2 + g.r(-40, 40), y: H * g.r(0.5, 0.58), w: g.r(150, 190) });
  for (let tries = 0; tries < 600 && islands.length < 11; tries++) {
    const w = g.r(80, 150);
    const x = g.r(30 + w / 2, W - 30 - w / 2);
    const y = g.r(50, H * 0.76);
    if (islands.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 28 && Math.abs(o.y - y) < 75)) continue;
    islands.push({ x, y, w });
  }

  const n = g.noise(14);
  for (const isl of islands) {
    const depth = isl.w * g.r(0.45, 0.7);
    for (let x = Math.floor(isl.x - isl.w / 2); x <= isl.x + isl.w / 2; x++) {
      const t = Math.abs(x - isl.x) / (isl.w / 2);
      const top = isl.y + (n(x, isl.y) - 0.5) * 6 + t * t * 6;
      const bottom = isl.y + depth * (1 - t ** 1.6) + (n(x, isl.y + 50) - 0.5) * 8;
      for (let y = Math.floor(top); y <= bottom; y++) {
        const inCore = t < 0.3 && y > top + 16 && y < bottom - 10;
        g.set(x, y, inCore ? ROCK : DIRT);
      }
    }
    // Crystal under the tip, hanging roots, decorations on top
    if (g.rand() < 0.5) g.blob(isl.x + g.r(-6, 6), isl.y + depth - 4, g.r(4, 7), CRYSTAL);
    for (let k = 0; k < 3; k++) {
      const rx = isl.x + g.r(-isl.w * 0.3, isl.w * 0.3);
      const ry = g.floorBelow(rx, isl.y + 5);
      if (ry > 0) g.line(rx, ry - 3, rx + g.r(-10, 10), ry + g.r(15, 35), 2, WOOD, [AIR, DIRT]);
    }
    const deco = g.rand();
    if (deco < 0.35) {
      g.mushroom(isl.x + g.r(-isl.w * 0.25, isl.w * 0.25), Math.floor(isl.y - 2), g.r(8, 12));
    } else if (deco < 0.6) {
      // Little shrine: stone pillar topped with a crystal
      const tx = isl.x + g.r(-isl.w * 0.25, isl.w * 0.25);
      const ty = isl.y - 2;
      g.rect(tx - 3, ty - 22, tx + 3, ty + 2, ROCK, [AIR, DIRT]);
      g.blob(tx, ty - 27, 4, CRYSTAL, [AIR]);
    }
  }

  // Tiny rocks floating between islands (rope anchors)
  for (let i = 0; i < 10; i++) {
    const x = g.r(30, W - 30);
    const y = g.r(30, H * 0.8);
    if (g.get(x, y) === AIR && g.get(x, y + 12) === AIR && g.get(x, y - 12) === AIR) g.blob(x, y, g.r(3, 5), ROCK);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Pyramide des Sables — dunes over hidden caves, a pyramid with a trapped tomb, an oasis
// ═════════════════════════════════════════════════════════════════════════════

function genDesert(g: Grid, hazards: boolean) {
  const { W, H } = g;
  g.fill(AIR);
  const cx = W / 2;

  // Sandstone bedrock with dunes of loose sand on top
  const dune = g.fbm(110, 2);
  const rockLine = new Int16Array(W);
  const sandTop = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    rockLine[x] = Math.round(H * 0.74 + (dune(x, 300) - 0.5) * 30);
    sandTop[x] = Math.round(rockLine[x] - 18 - dune(x, 0) * 55);
    g.rect(x, rockLine[x], x, H, DIRT);
    g.rect(x, sandTop[x], x, rockLine[x] - 1, SAND);
  }
  g.rect(0, H - 22, W, H, ROCK);

  // Caves in the sandstone — some right under the dunes: blast their roof and the sand pours in
  const caves = g.fbm(40, 2);
  for (let y = 0; y < H - 24; y++) {
    for (let x = 0; x < W; x++) {
      if (y > rockLine[x] + 8 && caves(x, y) > 0.6) g.set(x, y, AIR, [DIRT]);
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = g.r(60, W - 60);
    if (Math.abs(x - cx) < 170) continue;
    g.ellipse(x, rockLine[Math.floor(x)] + 14, g.r(18, 30), g.r(8, 12), AIR, [DIRT]);
  }

  // The pyramid: sandstone blocks (indestructible shell) around a destructible core
  const baseY = Math.round(H * 0.74);
  const half = 150;
  const apex = baseY - 150;
  for (let y = apex; y <= baseY + 6; y++) {
    const hw = ((y - apex) / (baseY - apex)) * half;
    for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
      const shell = Math.abs(x - cx) > hw - 6 || y < apex + 8;
      g.set(x, y, shell ? ROCK : DIRT);
    }
  }
  // Steps on the faces (to climb it)
  for (let y = apex + 14; y < baseY; y += 14) {
    const hw = ((y - apex) / (baseY - apex)) * half;
    g.rect(cx - hw - 4, y, cx - hw + 2, y + 3, ROCK);
    g.rect(cx + hw - 2, y, cx + hw + 4, y + 3, ROCK);
  }
  // Entrances, corridors and the tomb
  const tombY = baseY - 30;
  for (const side of [-1, 1]) {
    const ex = cx + side * 112;
    g.rect(Math.min(ex, cx + side * 40), tombY - 12, Math.max(ex, cx + side * 40), tombY + 6, AIR, [DIRT, ROCK]);
    g.line(cx + side * 70, tombY - 10, cx + side * 30, apex + 52, 14, AIR, [DIRT]);
  }
  g.rect(cx - 40, tombY - 22, cx + 40, tombY + 6, AIR);
  g.rect(cx - 40, tombY + 6, cx + 40, tombY + 9, ROCK);
  // Treasure… guarded by blasting powder
  for (let i = 0; i < 4; i++) g.blob(cx + g.r(-30, 30), tombY + g.r(0, 4), g.r(3, 5), CRYSTAL, [AIR]);
  g.rect(cx - 38, tombY - 2, cx - 28, tombY + 5, POWDER);
  g.rect(cx + 28, tombY - 2, cx + 38, tombY + 5, POWDER);
  // Upper chamber with sand that spills out when opened
  g.ellipse(cx, apex + 50, 26, 12, AIR, [DIRT]);
  g.ellipse(cx, apex + 54, 24, 8, SAND, [AIR]);

  // Oasis on one side, with palm trees
  const ox = g.rand() < 0.5 ? W * 0.14 : W * 0.86;
  // Firm sandstone banks around the water (loose sand would slide into it)
  g.ellipse(ox, rockLine[Math.floor(ox)] - 6, 100, 60, DIRT, [SAND]);
  g.ellipse(ox, rockLine[Math.floor(ox)] - 4, 60, 30, AIR, [SAND, DIRT]);
  g.rect(ox - 60, 0, ox + 60, rockLine[Math.floor(ox)] - 34, AIR, [DIRT]);
  g.basin(ox, rockLine[Math.floor(ox)] - 10, 22, WATER, 6000);
  for (const dx of [-70, 66]) {
    const px = ox + dx;
    const top = g.floorBelow(px, 20);
    if (top < 0) continue;
    const h = g.r(55, 80);
    for (let k = 0; k < h; k++) g.rect(px - 2 + Math.sin(k * 0.05) * 6, top - k, px + 2 + Math.sin(k * 0.05) * 6, top - k, WOOD, [AIR, SAND]);
    const tx = px + Math.sin(h * 0.05) * 6;
    for (let a = 0; a < 5; a++) {
      const ang = -Math.PI / 2 + (a - 2) * 0.55;
      g.line(tx, top - h, tx + Math.cos(ang) * 24, top - h + Math.sin(ang) * 10 + 10, 3, DIRT, [AIR]);
    }
  }
  // Quicksand-like acid bog on the other side
  if (hazards) {
    const bx = ox < cx ? W * 0.8 : W * 0.2;
    g.ellipse(bx, sandTop[Math.floor(bx)] + 6, 20, 8, AIR, [SAND]);
    g.basin(bx, sandTop[Math.floor(bx)] + 4, 4, ACID, 500);
  }
  // Buried crystals and a powder cache in the bedrock
  g.crystals(8, [DIRT]);
  for (let i = 0; i < 3; i++) {
    const p = g.wallSpot([DIRT]);
    if (p && Math.abs(p.x - cx) > 160) g.blob(p.x, p.y, g.r(4, 7), POWDER, [DIRT]);
  }
  // Floating sandstone ledges (rope anchors)
  for (let i = 0; i < 5; i++) {
    const x = g.r(50, W - 50);
    const y = g.r(40, H * 0.35);
    if (g.get(x, y) === AIR) g.rect(x - g.r(12, 22), y, x + g.r(12, 22), y + 5, ROCK, [AIR]);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Mine Abandonnée — galleries on several levels, timbering, powder kegs, crystal veins
// ═════════════════════════════════════════════════════════════════════════════

function genMine(g: Grid, hazards: boolean) {
  const { W, H } = g;
  g.fill(DIRT);
  const surface = 46;
  g.rect(0, 0, W, surface, AIR);
  const n = g.noise(40);
  for (let x = 0; x < W; x++) g.rect(x, surface, x, surface + Math.round(n(x, 0) * 10), AIR);
  g.rect(0, H - 18, W, H, ROCK);

  // Rock strata
  const strata = g.fbm(70, 2);
  for (let y = surface + 20; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(strata(x, y) - 0.5) < 0.018) g.set(x, y, ROCK, [DIRT]);
    }
  }

  // Galleries on 4 levels, each with a floor of rails (rock) and timber supports
  const levels = [118, 210, 300, 392];
  const shafts: number[] = [];
  levels.forEach((ly, li) => {
    const x0 = g.r(30, 120);
    const x1 = W - g.r(30, 120);
    const wob = g.noise(60);
    for (let x = Math.floor(x0); x <= x1; x++) {
      const y = ly + Math.round((wob(x, li * 50) - 0.5) * 10);
      g.rect(x, y - 24, x, y, AIR);
      g.set(x, y + 1, ROCK);
    }
    for (let x = x0 + 20; x < x1 - 10; x += g.r(38, 52)) {
      const y = g.floorBelow(x, ly - 20);
      if (y < 0) continue;
      g.rect(x, y - 24, x + 2, y - 1, WOOD, [AIR]);
      g.rect(x - 8, y - 26, x + 10, y - 23, WOOD, [AIR, DIRT]);
    }
    // Side chambers
    for (let k = 0; k < 2; k++) g.blob(g.r(x0 + 40, x1 - 40), ly - g.r(30, 40), g.r(12, 18), AIR, [DIRT]);
  });

  // Shafts between the levels (some with wooden ladders/platforms)
  for (let i = 0; i < 4; i++) {
    const x = g.r(80, W - 80);
    shafts.push(x);
    g.rect(x - 9, surface, x + 9, levels[levels.length - 1], AIR, [DIRT, ROCK]);
    for (let y = surface + 30; y < levels[levels.length - 1]; y += 46) g.rect(x - 9, y, x - 2, y + 2, WOOD, [AIR]);
  }
  // Head frame over the main shaft
  const mx = shafts[0];
  g.rect(mx - 16, surface - 30, mx - 13, surface + 4, WOOD, [AIR]);
  g.rect(mx + 13, surface - 30, mx + 16, surface + 4, WOOD, [AIR]);
  g.rect(mx - 18, surface - 33, mx + 18, surface - 30, WOOD, [AIR]);

  // Blasting powder: veins and kegs in the galleries
  for (let i = 0; i < 6; i++) {
    const p = g.wallSpot([DIRT]);
    if (p) g.blob(p.x, p.y, g.r(5, 9), POWDER, [DIRT]);
  }
  for (const ly of levels) {
    for (let k = 0; k < 2; k++) {
      const x = g.r(60, W - 60);
      const y = g.floorBelow(x, ly - 20);
      if (y > 0 && g.get(x, y - 2) === AIR) g.rect(x - 4, y - 9, x + 4, y - 1, POWDER, [AIR]);
    }
  }
  // Rich crystal veins
  g.crystals(22, [DIRT, ROCK]);
  // Loose sand pockets in the ceilings (they cave in when undermined)
  for (let i = 0; i < 7; i++) {
    const x = g.r(40, W - 40);
    const y = levels[g.ri(0, levels.length - 1)] - g.r(32, 46);
    g.blob(x, y, g.r(8, 14), SAND, [DIRT]);
  }
  // Flooded bottom gallery
  const deep = levels[levels.length - 1];
  for (let x = 30; x < W - 30; x += 50) g.basin(x, deep - 4, 8, hazards && x > W / 2 ? LAVA : WATER, 3000);
}

// ═════════════════════════════════════════════════════════════════════════════
// Le Sablier — a giant hourglass: break the crystal neck and the sand pours down
// ═════════════════════════════════════════════════════════════════════════════

function genHourglass(g: Grid, hazards: boolean) {
  const { W, H } = g;
  g.fill(AIR);
  const cx = W / 2;
  const top = 58;
  const neck = Math.round(H * 0.5);
  const bottom = H - 62;
  const bulb = 108;

  // Bottom pool and floor
  g.rect(0, H - 24, W, H, ROCK);
  g.rect(0, H - 40, W, H - 24, hazards ? LAVA : WATER);

  // The two glass bulbs (ice, 3 px), wide at the ends and pinched at the neck
  const widthAt = (y: number) => {
    const t = Math.abs(y - neck) / (neck - top);
    return 5 + bulb * Math.sin(Math.min(1, t) * Math.PI * 0.5) ** 1.4;
  };
  for (let y = top; y <= bottom; y++) {
    const hw = widthAt(y);
    g.rect(cx - hw - 3, y, cx - hw, y, ICE);
    g.rect(cx + hw, y, cx + hw + 3, y, ICE);
  }
  // Brass/stone frame: plates and pillars
  g.rect(cx - bulb - 30, top - 14, cx + bulb + 30, top, ROCK);
  g.rect(cx - bulb - 30, bottom, cx + bulb + 30, bottom + 14, ROCK);
  for (const side of [-1, 1]) g.rect(cx + side * (bulb + 22) - 4, top, cx + side * (bulb + 22) + 4, bottom, ROCK);
  // Sand in the upper bulb, held by a crystal plug in the neck
  for (let y = top + 40; y < neck - 4; y++) {
    const hw = widthAt(y);
    g.rect(cx - hw + 1, y, cx + hw - 1, y, SAND, [AIR]);
  }
  g.rect(cx - 6, neck - 4, cx + 6, neck + 2, CRYSTAL);
  // A bit of sand already in the lower bulb, and a powder charge to blow the glass
  for (let y = bottom - 16; y < bottom; y++) {
    const hw = widthAt(y) * Math.min(1, (y - (bottom - 16)) / 16);
    g.rect(cx - hw, y, cx + hw, y, SAND, [AIR]);
  }
  g.rect(cx - 5, bottom - 22, cx + 5, bottom - 17, POWDER, [AIR]);
  // Doors in the glass so wizards can get inside the bulbs
  for (const side of [-1, 1]) {
    const yy = bottom - 50;
    g.rect(cx + side * widthAt(yy) - 5, yy - 14, cx + side * widthAt(yy) + 5, yy, AIR, [ICE]);
  }

  // Clock towers on both sides with wooden floors
  for (const side of [-1, 1]) {
    const tx = side < 0 ? 70 : W - 70;
    g.rect(tx - 34, H * 0.3, tx - 28, H - 40, ROCK);
    g.rect(tx + 28, H * 0.3, tx + 34, H - 40, ROCK);
    for (let y = Math.round(H * 0.3) + 40; y < H - 50; y += 50) {
      g.rect(tx - 28, y, tx + 28, y + 3, WOOD);
      const gap = (y / 50) % 2 < 1 ? tx - 26 : tx + 8;
      g.rect(gap, y, gap + 18, y + 3, AIR);
    }
    g.ellipse(tx, H * 0.3, 40, 16, DIRT, [AIR], true);
    g.rect(tx - 34, H * 0.3 - 2, tx + 34, H * 0.3 + 3, ROCK);
    g.rect(tx + side * 34 - 2, H * 0.5, tx + side * 34 + 2, H * 0.5 + 16, AIR); // window
    g.mushroom(tx + side * -48, H - 40, 9);
  }

  // Floating islands of earth between the towers and the hourglass, with sand caps
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = cx + side * g.r(bulb + 50, bulb + 90);
    const y = g.r(H * 0.2, H * 0.78);
    g.blob(x, y, g.r(10, 16), DIRT);
    g.ellipse(x, y - 10, g.r(10, 14), 5, SAND, [AIR]);
    if (g.rand() < 0.4) g.blob(x, y + 6, 3, CRYSTAL);
  }
  g.crystals(6, [DIRT]);
  // Top ledge above the hourglass (rope anchor, sniper spot)
  g.ellipse(cx, top - 40, 40, 6, DIRT);
}
