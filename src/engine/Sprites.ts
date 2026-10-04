/**
 * Painted sprites:
 *  - the wizard (animated, the purple robe is recoloured with each player's colour)
 *  - white particle sprites (smoke, flames, stars, rings…), tinted on demand
 *  - spell icons for the grimoire / HUD
 * See CREDITS.md for the authors and licences.
 */
import wizardUrl from '../assets/wizard/wizard.png';
import wizardMeta from '../assets/wizard/wizard.json';
import fxUrl from '../assets/fx/fx.png';
import fxMeta from '../assets/fx/fx.json';
import iconsUrl from '../assets/icons/spells.jpg';
import iconMeta from '../assets/icons/spells.json';

// ── Loading ────────────────────────────────────────────────────────────────

function load(url: string): HTMLImageElement {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img;
}
const isReady = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

const wizardImg = load(wizardUrl);
const fxImg = load(fxUrl);

// ── Wizard ─────────────────────────────────────────────────────────────────

export type WizardAnim = keyof typeof wizardMeta;
interface AnimMeta { w: number; h: number; ax: number; ay: number; frames: number[][] }
const ANIMS = wizardMeta as Record<WizardAnim, AnimMeta>;
/** Height of the standing wizard (hood to feet) in atlas pixels */
const WIZARD_REF_HEIGHT = 106;

export function animFrames(anim: WizardAnim): number {
  return ANIMS[anim].frames.length;
}

const sheets = new Map<string, HTMLCanvasElement>();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Robe pixels of the sheet (computed once): index, blend weight, saturation, value */
let robe: { data: ImageData; idx: Uint32Array; w: Float32Array; s: Float32Array; v: Float32Array } | null = null;

function analyseRobe(): typeof robe {
  const c = document.createElement('canvas');
  c.width = wizardImg.naturalWidth;
  c.height = wizardImg.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(wizardImg, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const idx: number[] = [], ws: number[] = [], ss: number[] = [], vs: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, v] = rgbToHsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    // Smooth selection of the robe hues (≈ 250°), no hard seams on the gold trims
    const wHue = Math.max(0, Math.min(1, Math.min(h - 222, 300 - h) / 8));
    const w = wHue * Math.max(0, Math.min(1, (s - 0.08) / 0.1));
    if (w <= 0) continue;
    idx.push(i); ws.push(w); ss.push(s); vs.push(v);
  }
  return { data, idx: Uint32Array.from(idx), w: Float32Array.from(ws), s: Float32Array.from(ss), v: Float32Array.from(vs) };
}

/**
 * The wizard sheet with the purple robe recoloured to `color`.
 * Light colours (yellow, cyan…) also get a brighter robe so they read as such.
 */
function wizardSheet(color: string): HTMLCanvasElement | null {
  const cached = sheets.get(color);
  if (cached) return cached;
  if (!isReady(wizardImg)) return null;
  robe ??= analyseRobe();
  const { data: src, idx, w, s, v } = robe!;

  const [tr, tg, tb] = hexToRgb(color);
  const [th, ts] = rgbToHsv(tr / 255, tg / 255, tb / 255);
  const gain = Math.min(2.3, Math.max(1, Math.sqrt(luma(...hsvToRgb(th, 1, 1)) / luma(...hsvToRgb(250, 1, 1)))));
  const satBoost = 0.9 + 0.35 * ts;

  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  const d = out.data;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const wk = w[k];
    const [r, g, b] = hsvToRgb(th, Math.min(1, s[k] * satBoost), Math.min(1, v[k] * gain));
    d[i] = d[i] * (1 - wk) + r * 255 * wk;
    d[i + 1] = d[i + 1] * (1 - wk) + g * 255 * wk;
    d[i + 2] = d[i + 2] * (1 - wk) + b * 255 * wk;
  }
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.putImageData(out, 0, 0);
  sheets.set(color, c);
  return c;
}

/** Recolours the sheets ahead of time (e.g. while players pick their spell). */
export function prepareWizards(colors: string[]) {
  for (const c of colors) wizardSheet(c);
}

/**
 * Draws one animation frame with the feet at (x, footY).
 * Returns false while the sprites are still loading.
 */
export function drawWizard(ctx: CanvasRenderingContext2D, color: string, anim: WizardAnim, frame: number,
  x: number, footY: number, facing: number, height: number): boolean {
  const sheet = wizardSheet(color);
  if (!sheet) return false;
  const a = ANIMS[anim];
  const f = a.frames[Math.max(0, Math.min(a.frames.length - 1, frame))];
  const k = height / WIZARD_REF_HEIGHT;
  ctx.save();
  ctx.translate(x, footY);
  ctx.scale(facing * k, k);
  ctx.drawImage(sheet, f[0], f[1], a.w, a.h, -a.ax, -a.ay, a.w, a.h);
  ctx.restore();
  return true;
}

// ── Particle sprites ───────────────────────────────────────────────────────

export type FxName = keyof typeof fxMeta.sprites;
const FX_SIZE = fxMeta.size;
const FX_POS = fxMeta.sprites as Record<FxName, number[]>;
const tinted = new Map<string, HTMLCanvasElement>();

/**
 * The white sprite `name` coloured with `color` (cached).
 * `cpu`: for drawing into CPU-side canvases (terrain decals) without a GPU read-back per draw.
 */
export function fxSprite(name: FxName, color: string, cpu = false): HTMLCanvasElement | null {
  const key = name + color + (cpu ? '|cpu' : '');
  const cached = tinted.get(key);
  if (cached) return cached;
  if (!isReady(fxImg)) return null;
  if (tinted.size > 600) tinted.clear();
  const c = document.createElement('canvas');
  c.width = c.height = cpu ? FX_SIZE / 4 : FX_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: cpu })!;
  const [sx, sy] = FX_POS[name];
  ctx.drawImage(fxImg, sx, sy, FX_SIZE, FX_SIZE, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  tinted.set(key, c);
  return c;
}

/**
 * Draws a sprite centred on (x, y), `size` world pixels wide (× `stretch` along its own x axis),
 * rotated by `rot`. The caller sets the blend mode (`lighter` for glows).
 */
export function drawFx(ctx: CanvasRenderingContext2D, name: FxName, x: number, y: number, size: number,
  color: string, alpha = 1, rot = 0, stretch = 1) {
  const s = fxSprite(name, color);
  if (!s || alpha <= 0.01 || size <= 0) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  const w = size * stretch;
  if (rot === 0) {
    ctx.drawImage(s, x - w / 2, y - size / 2, w, size);
  } else {
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(s, -w / 2, -size / 2, w, size);
    ctx.rotate(-rot);
    ctx.translate(-x, -y);
  }
}

// ── Spell icons (CSS sprite) ───────────────────────────────────────────────

const ICON_COUNT = Object.keys(iconMeta).length;

/** Inline style showing the painted icon of spell `id`. */
export function spellIconStyle(id: string): string {
  const i = (iconMeta as Record<string, number>)[id] ?? 0;
  const pos = ICON_COUNT > 1 ? (i / (ICON_COUNT - 1)) * 100 : 0;
  return `background-image:url(${iconsUrl});background-size:${ICON_COUNT * 100}% 100%;background-position:${pos}% 0`;
}
