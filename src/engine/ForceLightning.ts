import { Terrain } from './Terrain';
import { Worm } from './Worm';
import { drawFx } from './Sprites';

/**
 * Mains Foudroyantes: electric arcs shot from the caster's hands while the button is held.
 * The same geometry is used by the host (damage) and by every client (rendering), so only
 * a "channelling" flag needs to travel on the network.
 */
export const LIGHTNING_RANGE = 105;
const CONE = 0.6;           // half-angle (radians) in which wizards are caught
const CHAIN_RANGE = 55;     // the arcs jump from the first victim to one more wizard

export interface ArcHit { x: number; y: number; worm: Worm | null }
export interface LightningShape {
  ox: number;
  oy: number;
  angle: number;
  hits: ArcHit[];
  chain: { from: ArcHit; to: ArcHit } | null;
}

function clearLine(t: Terrain, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
  for (let i = 1; i < steps; i++) {
    if (t.isSolid(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)) return false;
  }
  return true;
}

const chest = (w: Worm) => ({ x: w.x, y: w.y - 3 });

/** Who the arcs strike (up to 2 wizards in the cone, closest first) — or where they hit the wall. */
export function computeLightning(caster: Worm, worms: Worm[], terrain: Terrain, isEnemy: (w: Worm) => boolean): LightningShape {
  const angle = caster.aimAngle;
  const ox = caster.x + Math.cos(angle) * 7;
  const oy = caster.y - 4 + Math.sin(angle) * 7;

  const found: { w: Worm; d: number }[] = [];
  for (const w of worms) {
    if (w === caster || !w.isAlive() || !isEnemy(w)) continue;
    const c = chest(w);
    const d = Math.hypot(c.x - ox, c.y - oy);
    if (d > LIGHTNING_RANGE) continue;
    let diff = Math.atan2(c.y - oy, c.x - ox) - angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    if (Math.abs(diff) > CONE && d > 10) continue;
    if (!clearLine(terrain, ox, oy, c.x, c.y)) continue;
    found.push({ w, d });
  }
  found.sort((a, b) => a.d - b.d);
  const hits: ArcHit[] = found.slice(0, 2).map(({ w }) => ({ ...chest(w), worm: w }));

  let chain: LightningShape['chain'] = null;
  if (hits.length > 0) {
    const from = hits[0];
    let best: Worm | null = null;
    let bestD = CHAIN_RANGE;
    for (const w of worms) {
      if (w === caster || !w.isAlive() || !isEnemy(w) || hits.some(h => h.worm === w)) continue;
      const c = chest(w);
      const d = Math.hypot(c.x - from.x, c.y - from.y);
      if (d < bestD && clearLine(terrain, from.x, from.y, c.x, c.y)) {
        bestD = d;
        best = w;
      }
    }
    if (best) chain = { from, to: { ...chest(best), worm: best } };
  } else {
    // Nobody in reach: the arcs crackle against the first wall (or fizzle in the air)
    let ex = ox + Math.cos(angle) * LIGHTNING_RANGE;
    let ey = oy + Math.sin(angle) * LIGHTNING_RANGE;
    for (let d = 2; d <= LIGHTNING_RANGE; d += 2) {
      const x = ox + Math.cos(angle) * d;
      const y = oy + Math.sin(angle) * d;
      if (terrain.isSolid(x, y)) {
        ex = x;
        ey = y;
        break;
      }
    }
    hits.push({ x: ex, y: ey, worm: null });
  }
  return { ox, oy, angle, hits, chain };
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** Jagged bolt by midpoint displacement, as a flat [x0, y0, x1, y1, …] list. */
function bolt(x0: number, y0: number, x1: number, y1: number, roughness: number): number[] {
  let pts = [x0, y0, x1, y1];
  let disp = Math.hypot(x1 - x0, y1 - y0) * roughness;
  for (let level = 0; level < 5; level++) {
    const next: number[] = [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (Math.random() - 0.5) * disp;
      next.push(ax, ay, (ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off);
    }
    next.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    disp *= 0.55;
  }
  return pts;
}

function strokeBolts(ctx: CanvasRenderingContext2D, bolts: number[][]) {
  for (const [width, color, alpha] of [[3.2, '#3d6dff', 0.35], [1.5, '#8fc4ff', 0.85], [0.6, '#ffffff', 1]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const b of bolts) {
      ctx.moveTo(b[0], b[1]);
      for (let i = 2; i + 1 < b.length; i += 2) ctx.lineTo(b[i], b[i + 1]);
    }
    ctx.stroke();
  }
}

/** Several flickering arcs per target, with forks; redrawn randomly every frame. */
export function drawLightning(ctx: CanvasRenderingContext2D, s: LightningShape, now: number) {
  const bolts: number[][] = [];
  const addArcs = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const b = bolt(x0, y0, x1 + (Math.random() - 0.5) * 4, y1 + (Math.random() - 0.5) * 6, 0.32);
      bolts.push(b);
      // Forks
      if (Math.random() < 0.7) {
        const i = 2 * (2 + Math.floor(Math.random() * (b.length / 2 - 4)));
        const a = Math.atan2(y1 - y0, x1 - x0) + (Math.random() - 0.5) * 1.6;
        const l = 6 + Math.random() * 14;
        bolts.push(bolt(b[i], b[i + 1], b[i] + Math.cos(a) * l, b[i + 1] + Math.sin(a) * l, 0.4));
      }
    }
  };

  for (const h of s.hits) {
    if (h.worm) {
      addArcs(s.ox, s.oy, h.x, h.y, 3);
      h.worm.shockedAt = now;
    } else {
      // Fizzling arcs spreading in the cone
      for (let k = 0; k < 3; k++) {
        const a = s.angle + (Math.random() - 0.5) * 0.9;
        const d = Math.hypot(h.x - s.ox, h.y - s.oy) * (0.55 + Math.random() * 0.45);
        addArcs(s.ox, s.oy, s.ox + Math.cos(a) * d, s.oy + Math.sin(a) * d, 1);
      }
    }
  }
  if (s.chain) {
    addArcs(s.chain.from.x, s.chain.from.y, s.chain.to.x, s.chain.to.y, 2);
    s.chain.to.worm!.shockedAt = now;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeBolts(ctx, bolts);
  drawFx(ctx, 'circle_05', s.ox, s.oy, 14 + Math.random() * 4, '#7fb0ff', 0.9);
  for (const h of s.hits) drawFx(ctx, 'circle_05', h.x, h.y, h.worm ? 18 : 10, '#8fc4ff', 0.7);
  ctx.restore();
}
