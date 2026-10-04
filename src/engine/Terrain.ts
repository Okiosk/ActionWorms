import { CONFIG } from '../config';

/** Supported map layout types */
export type MapType = 'cave' | 'volcano' | 'swiss' | 'fortress' | 'open';

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

export class Terrain {
  public width: number;
  public height: number;

  /** Flat array of material IDs (MAT_AIR=0, MAT_DIRT=1, MAT_ROCK=2, MAT_ACID=3) */
  public materials: Uint8Array;

  // ── Offscreen canvases (GPU-accelerated blit each frame) ──────────────────
  public dirtCanvas: HTMLCanvasElement;
  public dirtCtx: CanvasRenderingContext2D;
  public rockCanvas: HTMLCanvasElement;
  public rockCtx: CanvasRenderingContext2D;
  /** Acid layer – drawn on top with animated alpha each frame */
  public acidCanvas: HTMLCanvasElement;
  public acidCtx: CanvasRenderingContext2D;

  constructor(width: number = CONFIG.MAP_WIDTH, height: number = CONFIG.MAP_HEIGHT) {
    this.width = width;
    this.height = height;
    this.materials = new Uint8Array(width * height);

    this.dirtCanvas = document.createElement('canvas');
    this.dirtCanvas.width = width;
    this.dirtCanvas.height = height;
    this.dirtCtx = this.dirtCanvas.getContext('2d')!;

    this.rockCanvas = document.createElement('canvas');
    this.rockCanvas.width = width;
    this.rockCanvas.height = height;
    this.rockCtx = this.rockCanvas.getContext('2d')!;

    this.acidCanvas = document.createElement('canvas');
    this.acidCanvas.width = width;
    this.acidCanvas.height = height;
    this.acidCtx = this.acidCanvas.getContext('2d')!;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Map Generation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Main entry-point.  Dispatches to the correct per-theme generator.
   * @param seed        Deterministic RNG seed
   * @param mapType     Layout theme ('cave' | 'volcano' | 'swiss' | 'fortress' | 'open')
   * @param acidEnabled Whether acid material is included in this match
   * @param centerZoneRadius King-of-the-hill zone to clear at the centre (0 = none)
   */
  public generateMap(
    seed: number = 123456,
    mapType: MapType = 'cave',
    acidEnabled: boolean = true,
    centerZoneRadius: number = 0
  ) {
    const rand = this.createPRNG(seed);

    switch (mapType) {
      case 'volcano':  this.generateVolcano(rand, acidEnabled);  break;
      case 'swiss':    this.generateSwiss(rand, acidEnabled);    break;
      case 'fortress': this.generateFortress(rand, acidEnabled); break;
      case 'open':     this.generateOpen(rand, acidEnabled);     break;
      case 'cave':
      default:         this.generateCave(rand, acidEnabled);     break;
    }

    // King of the hill: open the central zone and give it a small floor
    if (centerZoneRadius > 0) {
      const cx = Math.round(this.width / 2);
      const cy = Math.round(this.height / 2);
      this.rawFillCircle(cx, cy, centerZoneRadius, CONFIG.MAT_AIR);
      this.rawFillEllipse(cx, cy + centerZoneRadius - 4, Math.round(centerZoneRadius * 0.7), 5, CONFIG.MAT_DIRT);
    }

    this.renderInitialCanvases(rand);
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  /** Fills a rock border around the entire map */
  private addRockBorder(border: number = 12) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (x < border || x >= this.width - border || y < border || y >= this.height - border) {
          this.materials[y * this.width + x] = CONFIG.MAT_ROCK;
        }
      }
    }
  }

  // ── Cave ───────────────────────────────────────────────────────────────────

  /**
   * Classic Liero-style cave: drunken-worm tunnelers + large battle chambers,
   * scattered rock boulders.  Optional acid pools in excavated chambers.
   */
  private generateCave(rand: () => number, acidEnabled: boolean) {
    const border = 12;

    // 1. Fill with dirt
    this.materials.fill(CONFIG.MAT_DIRT);

    // 2. Rock border
    this.addRockBorder(border);

    // 3. Drunken-worm tunnelers
    const numTunnels = 14;
    for (let t = 0; t < numTunnels; t++) {
      let x = border + 40 + rand() * (this.width - 2 * border - 80);
      let y = border + 40 + rand() * (this.height - 2 * border - 80);
      let angle = rand() * Math.PI * 2;
      const steps = 180 + Math.floor(rand() * 200);
      let radius = 16 + rand() * 20;

      for (let s = 0; s < steps; s++) {
        angle += (rand() - 0.5) * 0.45;
        x += Math.cos(angle) * 3;
        y += Math.sin(angle) * 3;
        radius += (rand() - 0.5) * 1.5;
        radius = Math.max(12, Math.min(36, radius));

        x = Math.max(border + 25, Math.min(this.width - border - 25, x));
        y = Math.max(border + 25, Math.min(this.height - border - 25, y));

        this.rawCarve(Math.round(x), Math.round(y), Math.round(radius), CONFIG.MAT_AIR);
      }
    }

    // 4. Large battle chambers
    const numRooms = 5;
    for (let r = 0; r < numRooms; r++) {
      const rx = border + 80 + rand() * (this.width - 2 * border - 160);
      const ry = border + 80 + rand() * (this.height - 2 * border - 160);
      const radiusX = 45 + rand() * 35;
      const radiusY = 30 + rand() * 25;
      this.rawCarveEllipse(Math.round(rx), Math.round(ry), Math.round(radiusX), Math.round(radiusY), CONFIG.MAT_AIR);
    }

    // 5. Scattered indestructible rock boulders
    const numRocks = 18;
    for (let r = 0; r < numRocks; r++) {
      const rx = border + 40 + rand() * (this.width - 2 * border - 80);
      const ry = border + 40 + rand() * (this.height - 2 * border - 80);
      const rockRadius = 10 + rand() * 15;
      this.rawFillCircle(Math.round(rx), Math.round(ry), Math.round(rockRadius), CONFIG.MAT_ROCK);
    }

    // 6. Acid pools inside random chambers
    if (acidEnabled) {
      const numPools = 3 + Math.floor(rand() * 3); // 3-5
      for (let p = 0; p < numPools; p++) {
        const px = border + 60 + rand() * (this.width - 2 * border - 120);
        const py = border + 60 + rand() * (this.height - 2 * border - 120);
        const poolR = Math.round(8 + rand() * 7); // radius 8-15
        this.rawCarveAcid(Math.round(px), Math.round(py), poolR);
      }
    }
  }

  // ── Volcano ────────────────────────────────────────────────────────────────

  /**
   * Volcano: bottom filled with acid/lava, tall rocky columns rising from the
   * floor, hanging dirt stalactites from the ceiling, air corridors weaving
   * between pillars.
   */
  private generateVolcano(rand: () => number, acidEnabled: boolean) {
    const border = 12;
    const W = this.width;
    const H = this.height;

    // 1. Base fill – DIRT
    this.materials.fill(CONFIG.MAT_DIRT);

    // 2. Rock border
    this.addRockBorder(border);

    // 3. Lava / acid lake: bottom 20 %
    const lavaTop = Math.floor(H * 0.80);
    for (let y = lavaTop; y < H - border; y++) {
      for (let x = border; x < W - border; x++) {
        this.materials[y * W + x] = acidEnabled ? CONFIG.MAT_ACID : CONFIG.MAT_ROCK;
      }
    }

    // 4. Carve air space above the lava lake (upper 78 %)
    const airBottom = lavaTop - 5;
    const airTop = border + 20;

    // Wide horizontal air clearance
    for (let y = airTop; y < airBottom; y++) {
      for (let x = border + 5; x < W - border - 5; x++) {
        this.materials[y * W + x] = CONFIG.MAT_AIR;
      }
    }

    // 5. Rocky pillars rising from lava floor
    const numPillars = 6 + Math.floor(rand() * 4);
    for (let p = 0; p < numPillars; p++) {
      const px = border + 30 + Math.floor(rand() * (W - 2 * border - 60));
      const pillarW = 12 + Math.floor(rand() * 18);
      const pillarH = Math.floor((lavaTop - airTop) * (0.3 + rand() * 0.55));
      const pillarTop = lavaTop - pillarH;

      for (let y = pillarTop; y < lavaTop; y++) {
        for (let dx = -pillarW; dx <= pillarW; dx++) {
          const x = px + dx;
          // Taper the pillar slightly toward top
          const taper = Math.floor(pillarW * ((y - pillarTop) / pillarH) * 0.3);
          if (Math.abs(dx) <= pillarW - taper && this.isInBounds(x, y)) {
            this.materials[y * W + x] = CONFIG.MAT_ROCK;
          }
        }
      }
    }

    // 6. Hanging dirt stalactites from ceiling
    const numStalactites = 8 + Math.floor(rand() * 6);
    for (let s = 0; s < numStalactites; s++) {
      const sx = border + 20 + Math.floor(rand() * (W - 2 * border - 40));
      const sLen = 20 + Math.floor(rand() * 50);
      const sW = 5 + Math.floor(rand() * 10);
      for (let dy = 0; dy < sLen; dy++) {
        const sy = airTop + dy;
        const taper = Math.max(1, sW - Math.floor(dy * sW / sLen));
        for (let dx = -taper; dx <= taper; dx++) {
          const x = sx + dx;
          if (this.isInBounds(x, sy) && this.materials[sy * W + x] === CONFIG.MAT_AIR) {
            this.materials[sy * W + x] = CONFIG.MAT_DIRT;
          }
        }
      }
    }

    // 7. Mid-map acid pockets
    if (acidEnabled) {
      const numPockets = 3 + Math.floor(rand() * 3);
      for (let p = 0; p < numPockets; p++) {
        const px = border + 40 + Math.floor(rand() * (W - 2 * border - 80));
        const py = airTop + 20 + Math.floor(rand() * (airBottom - airTop - 40));
        this.rawCarveAcid(px, py, Math.round(6 + rand() * 8));
      }
    }
  }

  // ── Swiss cheese ───────────────────────────────────────────────────────────

  /**
   * Swiss-cheese: completely filled with dirt, then many circular rooms are
   * punched out at random.  Sparse rock boulders for cover.
   */
  private generateSwiss(rand: () => number, acidEnabled: boolean) {
    const border = 12;
    const W = this.width;
    const H = this.height;

    // 1. Solid DIRT everywhere
    this.materials.fill(CONFIG.MAT_DIRT);

    // 2. Rock border
    this.addRockBorder(border);

    // 3. Punch out 30-50 round holes
    const numHoles = 30 + Math.floor(rand() * 21);
    for (let h = 0; h < numHoles; h++) {
      const hx = border + 30 + Math.floor(rand() * (W - 2 * border - 60));
      const hy = border + 30 + Math.floor(rand() * (H - 2 * border - 60));
      const hr = Math.round(10 + rand() * 15); // radius 10-25
      this.rawCarve(hx, hy, hr, CONFIG.MAT_AIR);
    }

    // 4. Scattered indestructible rock boulders
    const numBoulders = 10 + Math.floor(rand() * 8);
    for (let b = 0; b < numBoulders; b++) {
      const bx = border + 40 + Math.floor(rand() * (W - 2 * border - 80));
      const by = border + 40 + Math.floor(rand() * (H - 2 * border - 80));
      const br = Math.round(8 + rand() * 12);
      this.rawFillCircle(bx, by, br, CONFIG.MAT_ROCK);
    }

    // 5. Acid pools near the bottom
    if (acidEnabled) {
      const numPools = 2 + Math.floor(rand() * 3);
      for (let p = 0; p < numPools; p++) {
        const px = border + 40 + Math.floor(rand() * (W - 2 * border - 80));
        const py = Math.floor(H * 0.65) + Math.floor(rand() * Math.floor(H * 0.20));
        this.rawCarveAcid(px, py, Math.round(8 + rand() * 10));
      }
    }
  }

  // ── Fortress ───────────────────────────────────────────────────────────────

  /**
   * Fortress: starts open (AIR), then adds 3-4 horizontal platform layers with
   * gaps, vertical dividing walls, and rock corner pillars.  Feels like a
   * multi-level castle interior.
   */
  private generateFortress(rand: () => number, acidEnabled: boolean) {
    const border = 12;
    const W = this.width;
    const H = this.height;

    // 1. Fill with AIR
    this.materials.fill(CONFIG.MAT_AIR);

    // 2. Rock border
    this.addRockBorder(border);

    // 3. Horizontal platform layers (3-4 layers)
    const numLayers = 3 + Math.floor(rand() * 2);
    const layerSpacing = Math.floor((H - 2 * border) / (numLayers + 1));
    const platformThick = 10 + Math.floor(rand() * 8);

    for (let l = 0; l < numLayers; l++) {
      const ly = border + layerSpacing * (l + 1);
      const mat = rand() < 0.4 ? CONFIG.MAT_ROCK : CONFIG.MAT_DIRT;

      // Draw continuous platform with 1-3 gaps for movement
      const numGaps = 1 + Math.floor(rand() * 3);
      // Track which x columns are in a gap
      const gapRegions: Array<[number, number]> = [];
      for (let g = 0; g < numGaps; g++) {
        const gx = border + 20 + Math.floor(rand() * (W - 2 * border - 80));
        const gw = 30 + Math.floor(rand() * 40);
        gapRegions.push([gx, gx + gw]);
      }

      for (let y = ly; y < Math.min(ly + platformThick, H - border); y++) {
        for (let x = border; x < W - border; x++) {
          const inGap = gapRegions.some(([gx0, gx1]) => x >= gx0 && x <= gx1);
          if (!inGap) {
            this.materials[y * W + x] = mat;
          }
        }
      }
    }

    // 4. Vertical dividing walls (2-3 walls, each with a doorway)
    const numWalls = 2 + Math.floor(rand() * 2);
    for (let w = 0; w < numWalls; w++) {
      const wx = border + 60 + Math.floor(rand() * (W - 2 * border - 120));
      const wallMat = rand() < 0.5 ? CONFIG.MAT_ROCK : CONFIG.MAT_DIRT;
      const doorY = border + layerSpacing + Math.floor(rand() * (H - 2 * border - 2 * layerSpacing));
      const doorH = 30 + Math.floor(rand() * 20);

      for (let y = border; y < H - border; y++) {
        const inDoor = y >= doorY && y <= doorY + doorH;
        if (!inDoor) {
          for (let dx = -4; dx <= 4; dx++) {
            const x = wx + dx;
            if (this.isInBounds(x, y)) this.materials[y * W + x] = wallMat;
          }
        }
      }
    }

    // 5. Rock corner pillars for cover
    const corners = [
      [border + 40, border + 40],
      [W - border - 40, border + 40],
      [border + 40, H - border - 40],
      [W - border - 40, H - border - 40],
    ];
    for (const [cx, cy] of corners) {
      this.rawFillCircle(cx, cy, 14, CONFIG.MAT_ROCK);
    }

    // 6. Scattered small rock boulders for extra cover
    const numBoulders = 6 + Math.floor(rand() * 6);
    for (let b = 0; b < numBoulders; b++) {
      const bx = border + 30 + Math.floor(rand() * (W - 2 * border - 60));
      const by = border + 30 + Math.floor(rand() * (H - 2 * border - 60));
      this.rawFillCircle(bx, by, Math.round(6 + rand() * 10), CONFIG.MAT_ROCK);
    }

    // 7. Acid moat at the very bottom row (inside rock border)
    if (acidEnabled) {
      const moatY = H - border - 18;
      for (let y = moatY; y < H - border; y++) {
        for (let x = border; x < W - border; x++) {
          if (this.materials[y * W + x] !== CONFIG.MAT_ROCK) {
            this.materials[y * W + x] = CONFIG.MAT_ACID;
          }
        }
      }
    }
  }

  // ── Open ───────────────────────────────────────────────────────────────────

  /**
   * Open field: bottom third = solid hilly ground, top two-thirds = open sky
   * with floating dirt islands.  A few rock boulders embedded in the ground
   * and optional acid pits.
   */
  private generateOpen(rand: () => number, acidEnabled: boolean) {
    const border = 12;
    const W = this.width;
    const H = this.height;

    // 1. Fill with AIR
    this.materials.fill(CONFIG.MAT_AIR);

    // 2. Rock border
    this.addRockBorder(border);

    // 3. Hilly ground: bottom ~35 % of the map
    // Ground level oscillates using multiple sine harmonics
    const baseGroundY = Math.floor(H * 0.65);
    const groundAmp1 = 25 + rand() * 20;
    const groundFreq1 = 0.008 + rand() * 0.006;
    const groundAmp2 = 12 + rand() * 10;
    const groundFreq2 = 0.018 + rand() * 0.010;
    const groundPhase1 = rand() * Math.PI * 2;
    const groundPhase2 = rand() * Math.PI * 2;

    const groundLine = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      const wave = Math.sin(x * groundFreq1 + groundPhase1) * groundAmp1
                 + Math.sin(x * groundFreq2 + groundPhase2) * groundAmp2;
      groundLine[x] = Math.round(baseGroundY + wave);
    }

    for (let x = 0; x < W; x++) {
      const gY = Math.max(border + 5, Math.min(H - border - 5, groundLine[x]));
      for (let y = gY; y < H - border; y++) {
        this.materials[y * W + x] = CONFIG.MAT_DIRT;
      }
    }

    // 4. Embedded rock boulders in the ground
    const numBoulders = 8 + Math.floor(rand() * 6);
    for (let b = 0; b < numBoulders; b++) {
      const bx = border + 30 + Math.floor(rand() * (W - 2 * border - 60));
      const gY = groundLine[Math.min(W - 1, Math.max(0, bx))];
      const by = gY + 5 + Math.floor(rand() * 20);
      this.rawFillCircle(bx, by, Math.round(8 + rand() * 14), CONFIG.MAT_ROCK);
    }

    // 5. Floating dirt islands in the upper air zone
    const numIslands = 6 + Math.floor(rand() * 5);
    for (let i = 0; i < numIslands; i++) {
      const ix = border + 40 + Math.floor(rand() * (W - 2 * border - 80));
      const iy = border + 20 + Math.floor(rand() * Math.floor(H * 0.45));
      const iRx = Math.round(25 + rand() * 35);
      const iRy = Math.round(8 + rand() * 14);
      this.rawFillEllipse(ix, iy, iRx, iRy, CONFIG.MAT_DIRT);
    }

    // 6. Acid pits dug into the hilly ground
    if (acidEnabled) {
      const numPits = 2 + Math.floor(rand() * 3);
      for (let p = 0; p < numPits; p++) {
        const px = border + 40 + Math.floor(rand() * (W - 2 * border - 80));
        const gY = groundLine[Math.min(W - 1, Math.max(0, px))];
        const py = gY + 4;
        const pitR = Math.round(10 + rand() * 12);
        // Carve an air pocket first so the acid sits in a pit
        this.rawCarve(px, py, pitR, CONFIG.MAT_AIR);
        this.rawCarveAcid(px, py + Math.floor(pitR * 0.4), Math.floor(pitR * 0.7));
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Low-level carving primitives
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Sets pixels inside a circle to `mat`, skipping MAT_ROCK cells.
   * Used by generators to carve tunnels/rooms or fill large areas.
   */
  private rawCarve(cx: number, cy: number, r: number, mat: number) {
    const r2 = r * r;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(this.width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(this.height - 1, cy + r);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          if (this.materials[rowOffset + x] !== CONFIG.MAT_ROCK) {
            this.materials[rowOffset + x] = mat;
          }
        }
      }
    }
  }

  /**
   * Fills a circle with `mat` unconditionally (even over rock).
   * Used for painting solid rock pillars/boulders.
   */
  private rawFillCircle(cx: number, cy: number, r: number, mat: number) {
    const r2 = r * r;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(this.width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(this.height - 1, cy + r);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          this.materials[rowOffset + x] = mat;
        }
      }
    }
  }

  /**
   * Sets pixels inside an axis-aligned ellipse to `mat`, skipping MAT_ROCK.
   */
  private rawCarveEllipse(cx: number, cy: number, rx: number, ry: number, mat: number) {
    const minX = Math.max(0, cx - rx);
    const maxX = Math.min(this.width - 1, cx + rx);
    const minY = Math.max(0, cy - ry);
    const maxY = Math.min(this.height - 1, cy + ry);

    for (let y = minY; y <= maxY; y++) {
      const dy = (y - cy) / ry;
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const dx = (x - cx) / rx;
        if (dx * dx + dy * dy <= 1.0) {
          if (this.materials[rowOffset + x] !== CONFIG.MAT_ROCK) {
            this.materials[rowOffset + x] = mat;
          }
        }
      }
    }
  }

  /**
   * Fills an axis-aligned ellipse with `mat` unconditionally.
   */
  private rawFillEllipse(cx: number, cy: number, rx: number, ry: number, mat: number) {
    const minX = Math.max(0, cx - rx);
    const maxX = Math.min(this.width - 1, cx + rx);
    const minY = Math.max(0, cy - ry);
    const maxY = Math.min(this.height - 1, cy + ry);

    for (let y = minY; y <= maxY; y++) {
      const dy = (y - cy) / ry;
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const dx = (x - cx) / rx;
        if (dx * dx + dy * dy <= 1.0) {
          this.materials[rowOffset + x] = mat;
        }
      }
    }
  }

  /** Paints acid inside a circle over non-rock pixels (generation only, no canvas update). */
  private rawCarveAcid(cx: number, cy: number, r: number) {
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(this.width - 1, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2 && this.materials[y * this.width + x] !== CONFIG.MAT_ROCK) {
          this.materials[y * this.width + x] = CONFIG.MAT_ACID;
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Public queries
  // ══════════════════════════════════════════════════════════════════════════

  public isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Returns true for DIRT, ROCK, or ACID — anything a worm cannot walk through.
   * Out-of-bounds coordinates are treated as solid.
   */
  public isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.materials[iy * this.width + ix] !== CONFIG.MAT_AIR;
  }

  /**
   * True only for MAT_ACID (solid & indestructible, damages worms on contact).
   */
  public isAcid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    return this.materials[iy * this.width + ix] === CONFIG.MAT_ACID;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Public mutations
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Carves a circular explosion hole.
   * Only MAT_DIRT is destroyed — ROCK and ACID are immune.
   * Updates the dirtCanvas in place and fires onCarve.
   */
  public carveCircle(cx: number, cy: number, radius: number): boolean {
    const r = Math.round(radius);
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + r));

    let modified = false;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          const idx = rowOffset + x;
          // Only carve DIRT – ROCK and ACID are immune to explosions
          if (this.materials[idx] === CONFIG.MAT_DIRT) {
            this.materials[idx] = CONFIG.MAT_AIR;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      // Clear matching region from the offscreen dirt canvas
      this.dirtCtx.save();
      this.dirtCtx.globalCompositeOperation = 'destination-out';
      this.dirtCtx.beginPath();
      this.dirtCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.dirtCtx.fill();
      this.dirtCtx.restore();
    }

    return modified;
  }

  /**
   * Carves a capsule (thick line) — used by piercing spells. Only dirt is removed.
   */
  public carveLine(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const r = Math.max(1, radius);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + r));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + r));
    const sx = x1 - x0;
    const sy = y1 - y0;
    const len2 = sx * sx + sy * sy;
    const r2 = r * r;
    let modified = false;

    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * this.width;
      for (let x = minX; x <= maxX; x++) {
        const idx = rowOffset + x;
        if (this.materials[idx] !== CONFIG.MAT_DIRT) continue;
        let t = len2 > 0 ? ((x - x0) * sx + (y - y0) * sy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = x - (x0 + sx * t);
        const dy = y - (y0 + sy * t);
        if (dx * dx + dy * dy <= r2) {
          this.materials[idx] = CONFIG.MAT_AIR;
          modified = true;
        }
      }
    }

    if (modified) {
      this.dirtCtx.save();
      this.dirtCtx.globalCompositeOperation = 'destination-out';
      this.dirtCtx.lineCap = 'round';
      this.dirtCtx.lineWidth = r * 2;
      this.dirtCtx.beginPath();
      this.dirtCtx.moveTo(x0, y0);
      this.dirtCtx.lineTo(x1 + 0.01, y1);
      this.dirtCtx.stroke();
      this.dirtCtx.restore();
    }
    return modified;
  }

  /** Turns air & dirt inside a circle into acid (alchemist flask) and repaints the area. */
  public addAcid(cx: number, cy: number, r: number) {
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

    const dirtImg = this.dirtCtx.getImageData(minX, minY, w, h);
    const acidImg = this.acidCtx.getImageData(minX, minY, w, h);
    const r2 = r * r;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const idx = y * this.width + x;
        if (dx * dx + dy * dy > r2 || this.materials[idx] === CONFIG.MAT_ROCK) continue;
        this.materials[idx] = CONFIG.MAT_ACID;
        const p = ((y - minY) * w + (x - minX)) * 4;
        dirtImg.data[p + 3] = 0;
        this.paintAcidPixel(acidImg.data, p, Math.random);
      }
    }
    this.dirtCtx.putImageData(dirtImg, minX, minY);
    this.acidCtx.putImageData(acidImg, minX, minY);
  }

  /**
   * Rempart Tellurique: turns air inside a circle into dirt, leaving room around the
   * given points (wizards, as flat [x0, y0, x1, y1, …]) so nobody gets buried.
   */
  public addDirt(cx: number, cy: number, r: number, keepClear: number[]) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(this.width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(this.height - 1, cy + r);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w <= 0 || h <= 0) return;

    const img = this.dirtCtx.getImageData(minX, minY, w, h);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.width + x;
        if (this.materials[idx] !== CONFIG.MAT_AIR) continue;
        // Slightly irregular edge
        const d = Math.hypot(x - cx, y - cy) + Math.sin(x * 0.9 + y * 0.6) * 1.2;
        if (d > r) continue;
        let blocked = false;
        for (let k = 0; k + 1 < keepClear.length; k += 2) {
          if (Math.hypot(x - keepClear[k], y - keepClear[k + 1]) < 9) { blocked = true; break; }
        }
        if (blocked) continue;
        this.materials[idx] = CONFIG.MAT_DIRT;
        this.paintDirtPixel(img.data, ((y - minY) * w + (x - minX)) * 4, x, y, Math.random);
      }
    }
    this.dirtCtx.putImageData(img, minX, minY);
  }

  /** Stains a blood splat onto the dirt canvas (purely visual). */
  public addBlood(x: number, y: number, radius: number = 2) {
    if (!this.isInBounds(x, y)) return;
    this.dirtCtx.save();
    this.dirtCtx.globalCompositeOperation = 'source-over';
    this.dirtCtx.fillStyle = Math.random() > 0.4 ? CONFIG.COLORS.BLOOD_FRESH : CONFIG.COLORS.BLOOD_DARK;
    this.dirtCtx.beginPath();
    this.dirtCtx.arc(x, y, radius + Math.random() * 1.5, 0, Math.PI * 2);
    this.dirtCtx.fill();
    this.dirtCtx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Spawn points
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Finds a spawn point: free space for a wizard, solid (non-acid) ground below,
   * preferably far from the other wizards.
   */
  public findSpawnPoint(avoid: { x: number; y: number }[] = []): { x: number; y: number } {
    const border = 24;
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;

    for (let attempts = 0, found = 0; attempts < 400 && found < 12; attempts++) {
      const x = Math.round(border + Math.random() * (this.width - 2 * border));
      const startY = Math.round(border + Math.random() * (this.height - 2 * border));
      if (this.isSolid(x, startY)) continue;

      // Trace down to the floor
      let floorY = -1;
      for (let y = startY; y < this.height - border; y++) {
        if (this.isSolid(x, y)) { floorY = y; break; }
      }
      if (floorY < 0 || this.isAcid(x, floorY)) continue;

      const sy = floorY - 6;
      // Enough room for the body (12 px tall, 10 px wide) and no acid nearby
      let clear = true;
      for (let dy = -6; dy <= 4 && clear; dy += 2) {
        for (let dx = -5; dx <= 5; dx += 5) {
          if (this.isSolid(x + dx, sy + dy)) { clear = false; break; }
        }
      }
      if (!clear) continue;
      if (this.isAcid(x - 6, floorY + 1) || this.isAcid(x + 6, floorY + 1)) continue;

      found++;
      let score = 0;
      if (avoid.length > 0) {
        score = Math.min(...avoid.map(a => Math.hypot(a.x - x, a.y - sy)));
      }
      score += Math.random() * 20;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y: sy };
      }
    }

    return best ?? { x: this.width / 2, y: this.height / 4 };
  }

  // ── Network snapshot (players joining a match in progress) ───────────────

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

  public loadMaterials(rle: Uint8Array) {
    let p = 0;
    for (let i = 0; i + 1 < rle.length && p < this.materials.length; i += 2) {
      this.materials.fill(rle[i], p, Math.min(this.materials.length, p + rle[i + 1]));
      p += rle[i + 1];
    }
    this.renderInitialCanvases(Math.random);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Canvas rendering
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Bakes all three offscreen canvases (dirt, rock, acid) from the materials
   * array.  Called once after map generation; dirt canvas is then mutated by
   * carveCircle / addBlood at runtime.
   */
  private renderInitialCanvases(rand: () => number) {
    this.dirtCtx.clearRect(0, 0, this.width, this.height);
    this.rockCtx.clearRect(0, 0, this.width, this.height);
    this.acidCtx.clearRect(0, 0, this.width, this.height);

    const dirtImgData = this.dirtCtx.createImageData(this.width, this.height);
    const dirtData    = dirtImgData.data;
    const rockImgData = this.rockCtx.createImageData(this.width, this.height);
    const rockData    = rockImgData.data;
    const acidImgData = this.acidCtx.createImageData(this.width, this.height);
    const acidData    = acidImgData.data;

    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) {
        const idx     = row + x;
        const pixIdx  = idx * 4;
        const mat     = this.materials[idx];

        if (mat === CONFIG.MAT_DIRT) {
          this.paintDirtPixel(dirtData, pixIdx, x, y, rand);

        } else if (mat === CONFIG.MAT_ROCK) {
          // Cold granite with subtle blue-grey flecks
          const noise = (Math.sin(x * 0.3) + Math.sin(y * 0.3) + (rand() - 0.5) * 1.5) / 3;
          const val   = Math.floor(80 + noise * 30);
          rockData[pixIdx]     = Math.max(0, Math.min(255, val));
          rockData[pixIdx + 1] = Math.max(0, Math.min(255, val + 2));
          rockData[pixIdx + 2] = Math.max(0, Math.min(255, val + 8));
          rockData[pixIdx + 3] = 255;

        } else if (mat === CONFIG.MAT_ACID) {
          this.paintAcidPixel(acidData, pixIdx, rand);
        }
      }
    }

    this.dirtCtx.putImageData(dirtImgData, 0, 0);
    this.rockCtx.putImageData(rockImgData, 0, 0);
    this.acidCtx.putImageData(acidImgData, 0, 0);
  }

  /** Organic brown noise – authentic Liero palette */
  private paintDirtPixel(data: Uint8ClampedArray, p: number, x: number, y: number, rand: () => number) {
    const noise = (Math.sin(x * 0.15) + Math.cos(y * 0.15) + (rand() - 0.5) * 1.2) / 3;
    data[p] = Math.floor(120 + noise * 35);
    data[p + 1] = Math.floor(75 + noise * 25);
    data[p + 2] = Math.floor(40 + noise * 18);
    data[p + 3] = 255;
  }

  /** Toxic bright-green with slight luminance noise */
  private paintAcidPixel(data: Uint8ClampedArray, p: number, rand: () => number) {
    const noise = rand() - 0.5;
    data[p] = 20;
    data[p + 1] = Math.floor(220 + noise * 35);
    data[p + 2] = Math.floor(20 + noise * 20);
    data[p + 3] = 255;
  }

  /**
   * Draw terrain layers onto the active game canvas.
   *
   * Draw order: background → dirt → rock → acid (pulsing on top).
   *
   * @param ctx  Target 2D rendering context (the main game canvas)
   * @param time Cumulative game tick counter used to animate the acid pulse
   */
  public draw(ctx: CanvasRenderingContext2D, time: number = 0) {
    // 1. Dark cavern / sky background
    ctx.fillStyle = CONFIG.COLORS.SKY;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Destructible dirt layer
    ctx.drawImage(this.dirtCanvas, 0, 0);

    // 3. Indestructible rock layer
    ctx.drawImage(this.rockCanvas, 0, 0);

    // 4. Acid layer – sinusoidal alpha for a bubbling, toxic glow effect
    this.drawAcid(ctx, time);
  }

  /**
   * Blits the acid canvas with an animated alpha so it pulses like molten
   * liquid.  Called from `draw()` but exposed publicly for post-processing.
   *
   * @param ctx  Target context (may differ from main canvas for FX passes)
   * @param time Game tick counter (60 fps → time increments each frame)
   */
  public drawAcid(ctx: CanvasRenderingContext2D, time: number) {
    // Pulse between 0.40 and 1.00 at ~0.75 Hz (period ≈ 78 ticks @ 60 fps)
    ctx.globalAlpha = 0.7 + Math.sin(time * 0.08) * 0.3;
    ctx.drawImage(this.acidCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Internal utilities
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Mulberry32 pseudo-random number generator – fast, deterministic, uniform.
   * Returns values in [0, 1).
   */
  private createPRNG(seed: number): () => number {
    let s = (seed || 123456) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
