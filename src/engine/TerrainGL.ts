import { CONFIG } from '../config';
import { Terrain, Rect } from './Terrain';

/**
 * Smooth terrain renderer (WebGL2).
 *
 * The simulation keeps its exact pixel grid (collisions, craters and the network stay
 * identical); only the picture changes. Each material is uploaded as a 0/1 mask, the
 * GPU samples the masks with bilinear filtering + a small blur and draws the 0.5
 * iso-line with screen-space anti-aliasing: edges become smooth curves instead of
 * staircases. Materials are textured procedurally at screen resolution, so there are
 * no visible pixels at any zoom level.
 *
 * Only the regions modified by explosions are re-uploaded (texSubImage2D), so carving
 * costs almost nothing. If WebGL2 is not available, the game keeps the 2D renderer.
 */

export interface TerrainView {
  camX: number;     // world coordinates of the screen centre
  camY: number;
  zoom: number;     // screen pixels per world pixel
  time: number;     // animation ticks
}

// Mask channels: tex0 = dirt, rock, ice, crystal · tex1 = wood, mushroom, acid, water · tex2 = lava
const CHANNEL: Record<number, [number, number]> = {
  [CONFIG.MAT_DIRT]: [0, 0],
  [CONFIG.MAT_ROCK]: [0, 1],
  [CONFIG.MAT_ICE]: [0, 2],
  [CONFIG.MAT_CRYSTAL]: [0, 3],
  [CONFIG.MAT_WOOD]: [1, 0],
  [CONFIG.MAT_BOUNCE]: [1, 1],
  [CONFIG.MAT_ACID]: [1, 2],
  [CONFIG.MAT_WATER]: [1, 3],
  [CONFIG.MAT_LAVA]: [2, 0]
};

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uMask0, uMask1, uMask2, uBg, uNoise, uStain, uCanopy;
uniform vec2 uWorld;   // map size in world pixels
uniform vec2 uView;    // viewport size in screen pixels
uniform vec2 uCam;
uniform float uZoom, uTime;
uniform int uPass;     // 0 = background + solids, 1 = liquids
uniform vec3 uDirt, uSurface, uRock, uLeaves;
uniform float uHasSurface, uBricks, uHasCanopy;
out vec4 outColor;

vec2 texel;

// Smooth field from the 0/1 mask:
//  - "wide" = 3×3 gaussian (rounds everything, fills the corners of craters)
//  - averaged with the plain bilinear sample so that 1-pixel details stay visible
//    (nothing solid is ever invisible) and straight edges stay exactly in place.
vec4 smoothMask(sampler2D t, vec2 uv) {
  vec2 o = texel;
  vec4 c = texture(t, uv);
  vec4 axis = texture(t, uv + vec2(o.x, 0.0)) + texture(t, uv - vec2(o.x, 0.0))
            + texture(t, uv + vec2(0.0, o.y)) + texture(t, uv - vec2(0.0, o.y));
  vec4 diag = texture(t, uv + o) + texture(t, uv - o)
            + texture(t, uv + vec2(o.x, -o.y)) + texture(t, uv + vec2(-o.x, o.y));
  vec4 wide = 0.25 * c + 0.125 * axis + 0.0625 * diag;
  return 0.5 * c + 0.5 * wide;
}

float solidAt(vec2 uv) {
  vec4 a = texture(uMask0, uv);
  vec4 b = texture(uMask1, uv);
  return clamp(a.r + a.g + a.b + a.a + b.r + b.g + b.b, 0.0, 1.0);
}

float liquidAt(vec2 uv) {
  return clamp(texture(uMask1, uv).a + texture(uMask2, uv).r, 0.0, 1.0);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 world = (screen - uView * 0.5) / uZoom + uCam;
  vec2 uv = world / uWorld;
  texel = 1.0 / uWorld;
  bool outside = uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0;

  vec4 N = texture(uNoise, world / 256.0);   // r: 32px blobs … a: 4px grain
  vec4 F = texture(uNoise, world / 61.0);

  if (uPass == 1) {
    // ── Liquids (drawn over the wizards) ──
    if (outside) { outColor = vec4(0.0); return; }
    vec4 m1 = clamp(smoothMask(uMask1, uv), 0.0, 1.0);
    vec4 m2 = clamp(smoothMask(uMask2, uv), 0.0, 1.0);
    float water = m1.a, lava = m2.r;
    float total = clamp(water + lava, 0.0, 1.0);
    float fw = max(fwidth(total), 0.02);
    float alpha = smoothstep(0.5 - fw, 0.5 + fw, total);
    if (alpha <= 0.0) { outColor = vec4(0.0); return; }
    float surface = 1.0 - smoothstep(0.3, 0.6, liquidAt(uv - vec2(0.0, 2.0) * texel));
    float wave = sin(world.x * 0.35 + uTime * 0.08 + F.r * 6.0) * 0.5 + 0.5;
    vec3 wcol = mix(vec3(0.10, 0.36, 0.72), vec3(0.20, 0.55, 0.92), N.g * 0.6 + wave * 0.25);
    wcol = mix(wcol, vec3(0.75, 0.90, 1.0), surface * 0.85);
    float flow = texture(uNoise, world / 90.0 + vec2(uTime * 0.0015, uTime * 0.0008)).r;
    vec3 lcol = mix(vec3(0.85, 0.18, 0.02), vec3(1.0, 0.72, 0.15), smoothstep(0.35, 0.8, flow + N.a * 0.3));
    lcol = mix(lcol, vec3(1.0, 0.95, 0.55), surface * 0.8);
    float lw = lava / max(total, 0.001);
    vec3 col = mix(wcol, lcol, lw);
    float a = alpha * mix(0.62 + surface * 0.3, 0.97, lw);
    outColor = vec4(col * a, a);
    return;
  }

  // ── Background + solids ──
  vec3 bg = texture(uBg, uv).rgb;
  if (outside) { outColor = vec4(bg * 0.4, 1.0); return; }

  vec4 m0 = clamp(smoothMask(uMask0, uv), 0.0, 1.0);
  vec4 m1 = clamp(smoothMask(uMask1, uv), 0.0, 1.0);
  float dirt = m0.r, rock = m0.g, ice = m0.b, crystal = m0.a;
  float wood = m1.r, bounce = m1.g, acid = m1.b;
  float total = clamp(dirt + rock + ice + crystal + wood + bounce + acid, 0.0, 1.0);
  float fw = max(fwidth(total), 0.02);
  float alpha = smoothstep(0.5 - fw, 0.5 + fw, total);
  if (alpha <= 0.0) { outColor = vec4(bg, 1.0); return; }

  // Sharpened soft-max between materials: smooth but crisp borders
  float wd = pow(dirt, 6.0), wr = pow(rock, 6.0), wi = pow(ice, 6.0), wc = pow(crystal, 6.0);
  float ww = pow(wood, 6.0), wb = pow(bounce, 6.0), wa = pow(acid, 6.0);
  float wsum = wd + wr + wi + wc + ww + wb + wa + 1e-5;

  vec3 col = vec3(0.0);
  float above = solidAt(uv - vec2(0.0, 2.2) * texel);
  float exposedTop = 1.0 - smoothstep(0.25, 0.65, above);

  if (wd > 0.0005) {
    vec3 c = uDirt * (0.74 + 0.30 * N.r + 0.16 * N.b + 0.10 * F.a);
    c *= 1.0 - 0.18 * smoothstep(0.78, 0.86, F.g);                 // pebbles
    if (uHasCanopy > 0.5) {
      float canopy = texture(uCanopy, vec2(uv.x, 0.5)).r * 512.0;
      float leaf = 1.0 - smoothstep(canopy - 1.5, canopy + 1.5, world.y);
      c = mix(c, uLeaves * (0.6 + 0.45 * N.b + 0.25 * F.a), leaf);
    }
    if (uHasSurface > 0.5) c = mix(c, uSurface * (0.85 + 0.25 * F.a), exposedTop);
    col += c * wd;
  }
  if (wr > 0.0005) {
    vec3 c = uRock * (0.72 + 0.28 * N.g + 0.14 * F.b);
    float ridge = 1.0 - abs(N.b * 2.0 - 1.0);
    c *= 1.0 - 0.28 * smoothstep(0.90, 0.97, ridge);                // cracks
    if (uBricks > 0.5) {
      float row = floor(world.y / 7.0);
      float bx = fract((world.x + mod(row, 2.0) * 8.0) / 16.0) * 16.0;
      float by = fract(world.y / 7.0) * 7.0;
      float mortar = 1.0 - smoothstep(0.0, 0.9, min(min(bx, 16.0 - bx), min(by, 7.0 - by)));
      c *= 1.0 - 0.35 * mortar;
    }
    col += c * wr;
  }
  if (wi > 0.0005) {
    float streak = smoothstep(0.86, 0.98, sin((world.x + world.y * 1.8) * 0.45 + N.r * 6.0));
    vec3 c = vec3(0.64, 0.84, 0.95) * (0.88 + 0.18 * N.g) + streak * 0.12 + exposedTop * 0.18;
    col += c * wi;
  }
  if (wc > 0.0005) {
    float facet = floor(N.g * 6.0 + F.r * 2.0) / 7.0;
    vec3 c = vec3(0.62, 0.28, 0.95) * (0.65 + 0.6 * facet);
    c += vec3(1.0, 0.9, 1.0) * pow(F.a, 10.0) * (0.6 + 0.4 * sin(uTime * 0.1 + N.r * 30.0));
    col += c * wc;
  }
  if (ww > 0.0005) {
    float grain = sin(world.y * 1.1 + N.r * 9.0 + F.b * 3.0);
    vec3 c = vec3(0.47, 0.30, 0.15) * (0.82 + 0.16 * grain + 0.08 * F.a);
    col += c * ww;
  }
  if (wb > 0.0005) {
    vec2 cell = fract(world / 7.0) - 0.5 + (F.rg - 0.5) * 0.25;
    float spot = 1.0 - smoothstep(0.17, 0.23, length(cell));
    vec3 c = mix(vec3(0.86, 0.26, 0.60), vec3(1.0, 0.88, 0.94), spot) * (0.9 + 0.15 * exposedTop);
    col += c * wb;
  }
  if (wa > 0.0005) {
    float pulse = 0.75 + 0.25 * sin(uTime * 0.08);
    float bubble = smoothstep(0.85, 0.95, texture(uNoise, world / 40.0 + vec2(0.0, uTime * 0.002)).a);
    vec3 c = vec3(0.10, 0.85, 0.12) * pulse * (0.85 + 0.2 * N.g) + bubble * 0.25;
    col += c * wa;
  }
  col /= wsum;

  // Blood decals (premultiplied: no dark fringe when filtered), slightly glossy on top surfaces
  vec4 stain = texture(uStain, uv) * 0.92;
  col = col * (1.0 - stain.a) + stain.rgb * (1.0 + exposedTop * 0.35);

  // Rim: dark outline on the edges, light catching the top surfaces
  float rim = smoothstep(0.5, 0.92, total);
  col *= mix(0.55, 1.0, rim);
  col += exposedTop * (1.0 - rim) * 0.10;

  outColor = vec4(mix(bg, col, alpha), 1.0);
}`;

export class TerrainGL {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private masks: WebGLTexture[] = [];
  private maskData: Uint8Array[] = [];
  private bgTex: WebGLTexture;
  private stainTex: WebGLTexture;
  private canopyTex: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private terrainVersion = -1;
  private terrain: Terrain | null = null;
  private changeSeq = 0;
  private stainSeq = 0;
  private lost = false;
  private readonly pass: 'solid' | 'liquid';

  /**
   * Returns null when WebGL2 is not available, or when it only runs in software
   * (no GPU: drawing the terrain on the CPU would be slower than the 2D renderer).
   */
  static create(pass: 'solid' | 'liquid', allowSoftware = false): TerrainGL | null {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false });
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      if (!allowSoftware && /swiftshader|llvmpipe|software|basic render/i.test(renderer)) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return null;
      }
      return new TerrainGL(canvas, gl, pass);
    } catch (err) {
      console.warn('Smooth terrain renderer unavailable:', err);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, pass: 'solid' | 'liquid') {
    this.canvas = canvas;
    this.gl = gl;
    this.pass = pass;
    canvas.className = 'terrain-layer';
    this.program = this.buildProgram();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });

    // Full-screen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['uMask0', 'uMask1', 'uMask2', 'uBg', 'uNoise', 'uStain', 'uCanopy', 'uWorld', 'uView', 'uCam', 'uZoom',
      'uTime', 'uPass', 'uDirt', 'uSurface', 'uRock', 'uLeaves', 'uHasSurface', 'uBricks', 'uHasCanopy']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    this.masks = [0, 1, 2].map(() => this.makeTexture(gl.LINEAR, gl.CLAMP_TO_EDGE));
    this.bgTex = this.makeTexture(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.stainTex = this.makeTexture(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.canopyTex = this.makeTexture(gl.LINEAR, gl.CLAMP_TO_EDGE);
    const noiseTex = this.makeTexture(gl.LINEAR, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeNoiseTexture(256));

    gl.useProgram(this.program);
    const units: [string, WebGLTexture][] = [
      ['uMask0', this.masks[0]], ['uMask1', this.masks[1]], ['uMask2', this.masks[2]],
      ['uBg', this.bgTex], ['uNoise', noiseTex], ['uStain', this.stainTex], ['uCanopy', this.canopyTex]
    ];
    units.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.uniforms[name], i);
    });
  }

  public get ok(): boolean {
    return !this.lost && !this.gl.isContextLost();
  }

  private buildProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    return prog;
  }

  private makeTexture(filter: number, wrap: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  // ── Synchronisation with the simulation grid ──────────────────────────────

  private sync(t: Terrain) {
    const gl = this.gl;
    const W = t.width;
    const H = t.height;

    if (this.terrain !== t || this.terrainVersion !== t.version) {
      // New map: upload everything
      this.terrain = t;
      this.terrainVersion = t.version;
      this.changeSeq = t.changes.seq;
      this.stainSeq = t.stains.seq;
      this.maskData = [0, 1, 2].map(() => new Uint8Array(W * H * 4));
      this.uploadMasks(t, { x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
      if (this.pass === 'solid') {
        gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.bgCanvas);
        gl.bindTexture(gl.TEXTURE_2D, this.stainTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.stainCanvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        const canopy = new Uint8Array(W);
        if (t.canopyLine) for (let x = 0; x < W; x++) canopy[x] = Math.max(0, Math.min(255, Math.round(t.canopyLine[x] / 2)));
        gl.bindTexture(gl.TEXTURE_2D, this.canopyTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, 1, 0, gl.RED, gl.UNSIGNED_BYTE, canopy);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      }
      return;
    }

    // Re-upload only the rectangles touched by explosions since the last frame
    const changed = t.changes.since(this.changeSeq);
    this.changeSeq = t.changes.seq;
    if (changed) this.uploadMasks(t, changed === 'all' ? { x0: 0, y0: 0, x1: W - 1, y1: H - 1 } : changed);

    if (this.pass === 'solid') {
      const stained = t.stains.listSince(this.stainSeq);
      this.stainSeq = t.stains.seq;
      const rects = stained === 'all' ? [{ x0: 0, y0: 0, x1: W - 1, y1: H - 1 }] : stained;
      if (rects.length > 0) {
        const sctx = t.stainCanvas.getContext('2d')!;
        gl.bindTexture(gl.TEXTURE_2D, this.stainTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        for (const r of rects) {
          const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0);
          const x1 = Math.min(W - 1, r.x1), y1 = Math.min(H - 1, r.y1);
          if (x1 < x0 || y1 < y0) continue;
          const img = sctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, gl.RGBA, gl.UNSIGNED_BYTE, img);
        }
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
    }
  }

  private uploadMasks(t: Terrain, r: Rect) {
    const gl = this.gl;
    const W = t.width;
    const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0);
    const x1 = Math.min(W - 1, r.x1), y1 = Math.min(t.height - 1, r.y1);
    if (x1 < x0 || y1 < y0) return;
    this.fillMasks(t, x0, y0, x1, y1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
    const full = x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === t.height - 1;
    this.masks.forEach((tex, i) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (full) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.maskData[i]);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, this.maskData[i]);
    });
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  private fillMasks(t: Terrain, x0: number, y0: number, x1: number, y1: number) {
    const W = t.width;
    const [a, b, c] = this.maskData;
    const data = [a, b, c];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const p = i * 4;
        a[p] = a[p + 1] = a[p + 2] = a[p + 3] = 0;
        b[p] = b[p + 1] = b[p + 2] = b[p + 3] = 0;
        c[p] = 0;
        const ch = CHANNEL[t.materials[i]];
        if (ch) data[ch[0]][p + ch[1]] = 255;
      }
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /**
   * Renders this layer (sized to the screen): 'solid' = background + solid terrain,
   * 'liquid' = water & lava only (transparent elsewhere, stacked over the wizards).
   */
  public render(t: Terrain, view: TerrainView, width: number, height: number) {
    const pass = this.pass;
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    this.sync(t);

    const u = this.uniforms;
    const th = t.theme;
    gl.useProgram(this.program);
    gl.uniform2f(u.uWorld, t.width, t.height);
    gl.uniform2f(u.uView, width, height);
    gl.uniform2f(u.uCam, view.camX, view.camY);
    gl.uniform1f(u.uZoom, view.zoom);
    gl.uniform1f(u.uTime, view.time);
    gl.uniform1i(u.uPass, pass === 'solid' ? 0 : 1);
    const rgb = (c: number[]) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;
    gl.uniform3f(u.uDirt, ...rgb(th.dirt));
    gl.uniform3f(u.uSurface, ...rgb(th.surface ?? th.dirt));
    gl.uniform3f(u.uRock, ...rgb(th.rock));
    gl.uniform3f(u.uLeaves, ...rgb(th.leaves ?? th.dirt));
    gl.uniform1f(u.uHasSurface, th.surface ? 1 : 0);
    gl.uniform1f(u.uBricks, th.bricks ? 1 : 0);
    gl.uniform1f(u.uHasCanopy, t.canopyLine && th.leaves ? 1 : 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** Tileable multi-octave value noise: r = 32px features, g = 16px, b = 8px, a = 4px. */
function makeNoiseTexture(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const cells = [8, 16, 32, 64];
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  cells.forEach((n, ch) => {
    const grid = Array.from({ length: n * n }, rand);
    const g = (x: number, y: number) => grid[((y + n) % n) * n + ((x + n) % n)];
    const s = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = s(fx - ix), ty = s(fy - iy);
        const v = (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
        out[(y * size + x) * 4 + ch] = Math.round(v * 255);
      }
    }
  });
  return out;
}
