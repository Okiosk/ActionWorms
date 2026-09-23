import { CONFIG } from '../config';

export class Terrain {
  public width: number;
  public height: number;
  public materials: Uint8Array;

  // Offscreen canvases for ultra-fast GPU-accelerated 2D rendering
  public dirtCanvas: HTMLCanvasElement;
  public dirtCtx: CanvasRenderingContext2D;
  public rockCanvas: HTMLCanvasElement;
  public rockCtx: CanvasRenderingContext2D;
  public onCarve?: (cx: number, cy: number, radius: number) => void;

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

    this.generateMap();
  }

  public generateMap(seed: number = 123456) {
    const rand = this.createPRNG(seed);

    // 1. Fill entire map with DIRT
    this.materials.fill(CONFIG.MAT_DIRT);

    // 2. Thick indestructible ROCK borders
    const border = 12;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (x < border || x >= this.width - border || y < border || y >= this.height - border) {
          this.materials[y * this.width + x] = CONFIG.MAT_ROCK;
        }
      }
    }

    // 3. Procedural Cavern Generation (Drunken-worm tunnelers + cellular chambers)
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

        // Keep inside bounds
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

      for (let dy = -radiusY; dy <= radiusY; dy++) {
        for (let dx = -radiusX; dx <= radiusX; dx++) {
          if ((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1.0) {
            const px = Math.round(rx + dx);
            const py = Math.round(ry + dy);
            if (this.isInBounds(px, py) && this.materials[py * this.width + px] !== CONFIG.MAT_ROCK) {
              this.materials[py * this.width + px] = CONFIG.MAT_AIR;
            }
          }
        }
      }
    }

    // 5. Scattered indestructible rock pillars and boulders
    const numRocks = 18;
    for (let r = 0; r < numRocks; r++) {
      const rx = border + 40 + rand() * (this.width - 2 * border - 80);
      const ry = border + 40 + rand() * (this.height - 2 * border - 80);
      const rockRadius = 10 + rand() * 15;

      for (let dy = -rockRadius; dy <= rockRadius; dy++) {
        for (let dx = -rockRadius; dx <= rockRadius; dx++) {
          if (dx * dx + dy * dy <= rockRadius * rockRadius) {
            const px = Math.round(rx + dx);
            const py = Math.round(ry + dy);
            if (this.isInBounds(px, py)) {
              this.materials[py * this.width + px] = CONFIG.MAT_ROCK;
            }
          }
        }
      }
    }

    // 6. Bake offscreen canvases
    this.renderInitialCanvases(rand);
  }

  private createPRNG(seed: number) {
    let s = (seed || 123456) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

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

  public isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  public isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.materials[iy * this.width + ix] !== CONFIG.MAT_AIR;
  }

  public isRock(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.materials[iy * this.width + ix] === CONFIG.MAT_ROCK;
  }

  public isDirt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    return this.materials[iy * this.width + ix] === CONFIG.MAT_DIRT;
  }

  // Carves a circular hole in destructible dirt (for explosions & digging)
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
          if (this.materials[idx] === CONFIG.MAT_DIRT) {
            this.materials[idx] = CONFIG.MAT_AIR;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      // Clear out the dirt in the offscreen canvas
      this.dirtCtx.save();
      this.dirtCtx.globalCompositeOperation = 'destination-out';
      this.dirtCtx.beginPath();
      this.dirtCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.dirtCtx.fill();
      this.dirtCtx.restore();

      this.onCarve?.(cx, cy, radius);
    }

    return modified;
  }

  // Stains blood on the dirt canvas
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

  public findSpawnPoint(): { x: number; y: number } {
    const border = 30;
    // Try to find open air with solid ground below
    for (let attempts = 0; attempts < 300; attempts++) {
      const x = border + Math.random() * (this.width - 2 * border);
      const y = border + Math.random() * (this.height - 2 * border);

      if (!this.isSolid(x, y) && !this.isSolid(x, y - 10)) {
        // Trace down to find floor
        for (let checkY = y; checkY < this.height - border; checkY += 2) {
          if (this.isSolid(x, checkY)) {
            return { x, y: checkY - 8 };
          }
        }
      }
    }

    // Fallback: center of map
    return { x: this.width / 2, y: this.height / 2 };
  }

  // Pre-renders dirt and rock textures onto offscreen canvases with authentic Liero grit
  private renderInitialCanvases(rand: () => number = Math.random) {
    this.dirtCtx.clearRect(0, 0, this.width, this.height);
    this.rockCtx.clearRect(0, 0, this.width, this.height);

    const dirtImgData = this.dirtCtx.createImageData(this.width, this.height);
    const dirtData = dirtImgData.data;

    const rockImgData = this.rockCtx.createImageData(this.width, this.height);
    const rockData = rockImgData.data;

    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) {
        const idx = row + x;
        const pixelIdx = idx * 4;
        const mat = this.materials[idx];

        if (mat === CONFIG.MAT_DIRT) {
          // Dirt texture with rich organic noise
          const noise = ((Math.sin(x * 0.15) + Math.cos(y * 0.15) + (rand() - 0.5) * 1.2) / 3);
          const r = Math.floor(120 + noise * 35);
          const g = Math.floor(75 + noise * 25);
          const b = Math.floor(40 + noise * 18);

          dirtData[pixelIdx] = Math.max(0, Math.min(255, r));
          dirtData[pixelIdx + 1] = Math.max(0, Math.min(255, g));
          dirtData[pixelIdx + 2] = Math.max(0, Math.min(255, b));
          dirtData[pixelIdx + 3] = 255;
        } else if (mat === CONFIG.MAT_ROCK) {
          // Indestructible stone texture with granite flecks
          const noise = ((Math.sin(x * 0.3) + Math.sin(y * 0.3) + (rand() - 0.5) * 1.5) / 3);
          const val = Math.floor(80 + noise * 30);

          rockData[pixelIdx] = Math.max(0, Math.min(255, val));
          rockData[pixelIdx + 1] = Math.max(0, Math.min(255, val + 2));
          rockData[pixelIdx + 2] = Math.max(0, Math.min(255, val + 8));
          rockData[pixelIdx + 3] = 255;
        }
      }
    }

    this.dirtCtx.putImageData(dirtImgData, 0, 0);
    this.rockCtx.putImageData(rockImgData, 0, 0);
  }

  // Draw terrain onto active game canvas
  public draw(ctx: CanvasRenderingContext2D) {
    // 1. Cavern background
    ctx.fillStyle = CONFIG.COLORS.SKY;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Destructible dirt layer
    ctx.drawImage(this.dirtCanvas, 0, 0);

    // 3. Indestructible rock layer
    ctx.drawImage(this.rockCanvas, 0, 0);
  }
}
