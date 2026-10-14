import * as THREE from 'three';
import { rng } from '../textures.ts';

/**
 * Procedural surfaces of the cell (docs/DESIGN.md, 3.1). Each one is drawn three times over the same
 * layout: colour, height (for bump mapping; mid grey is flat) and roughness (absolute: black is a
 * mirror, white is chalk). Geometry UVs are in metres; `metres` is how much of a wall one tile of
 * the texture covers. Everything is drawn once per page and shared.
 */
export interface Surface {
  map: THREE.Texture;
  bump: THREE.Texture;
  rough: THREE.Texture;
}

type G = CanvasRenderingContext2D;
/** Draws one layer. `layer` tells which: colour, height or roughness. */
type Draw = (g: G, layer: 'c' | 'h' | 'r', s: number) => void;

const cache = new Map<string, Surface>();

function surface(key: string, px: number, metres: number, draw: Draw): Surface {
  const hit = cache.get(key);
  if (hit) return hit;
  const make = (layer: 'c' | 'h' | 'r') => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    draw(c.getContext('2d')!, layer, px);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = layer === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / metres, 1 / metres);
    t.anisotropy = 8;
    return t;
  };
  const s = { map: make('c'), bump: make('h'), rough: make('r') };
  cache.set(key, s);
  return s;
}

export function isSurfaceTexture(t: THREE.Texture) {
  for (const s of cache.values()) if (s.map === t || s.bump === t || s.rough === t) return true;
  return false;
}

// --- drawing helpers ---

const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
/** Roughness as a grey level. */
const rough = (r: number) => grey(Math.round(r * 255));

function fill(g: G, style: string, s: number) {
  g.fillStyle = style;
  g.fillRect(0, 0, s, s);
}

/** Soft blotches: stains on plaster, clouds in concrete. Wraps around the edges. */
function blotches(g: G, s: number, seed: number, n: number, rMin: number, rMax: number, color: (r: () => number) => string) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * s;
    const y = r() * s;
    const rad = rMin + r() * (rMax - rMin);
    const c = color(r);
    for (const dx of [-s, 0, s])
      for (const dy of [-s, 0, s]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, c);
        gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
  }
}

function speckle(g: G, s: number, seed: number, n: number, alpha: number, size = 2) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = grey(v, alpha * r());
    g.fillRect(r() * s, r() * s, 1 + r() * size, 1 + r() * size);
  }
}

/** Square tiles with grout: colour per tile from `tile`, grout `gw` pixels wide. */
function tiles(g: G, layer: 'c' | 'h' | 'r', s: number, n: number, gw: number, tile: (i: number, j: number) => string, groutColor: string, glossy: number) {
  const t = s / n;
  fill(g, layer === 'c' ? groutColor : layer === 'h' ? grey(60) : rough(0.85), s);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = layer === 'c' ? tile(i, j) : layer === 'h' ? grey(180) : rough(glossy);
      g.fillRect(i * t + gw / 2, j * t + gw / 2, t - gw, t - gw);
    }
}

/** Plaster-like unevenness in the height and roughness layers. */
function plasterRelief(g: G, layer: 'h' | 'r', s: number, seed: number, base: number) {
  fill(g, layer === 'h' ? grey(128) : rough(base), s);
  blotches(g, s, seed, 120, s * 0.01, s * 0.05, (r) => (layer === 'h' ? grey(r() < 0.5 ? 90 : 170, 0.25) : grey(r() < 0.5 ? 200 : 255, 0.15)));
  speckle(g, s, seed + 1, s * 8, layer === 'h' ? 0.3 : 0.1);
}

// --- surfaces ---

export const surfaces = {
  /** Oil paint of stairwells: dull green, brush streaks, a little gloss. */
  paintGreen: () => paint('paintGreen', '#4f6b4a', 31),
  /** The floor corridor's paint: faded blue-green. */
  paintBlue: () => paint('paintBlue', '#56706f', 32),
  /** Kitchen wall above the tiles: pale yellow oil paint. */
  paintYellow: () => paint('paintYellow', '#c9bc8a', 33),
  /** Bathroom walls above the tiles and its ceiling. */
  paintPale: () => paint('paintPale', '#c8cbc4', 34),

  /** Whitewash (побелка): chalky, uneven, dead matte. */
  whitewash: () =>
    surface('whitewash', 256, 1, (g, l, s) => {
      if (l !== 'c') return plasterRelief(g, l, s, 41, 0.97);
      fill(g, '#d6d2c6', s);
      blotches(g, s, 42, 30, s * 0.08, s * 0.25, (r) => `rgba(150,140,120,${0.04 + r() * 0.05})`);
      speckle(g, s, 43, 3000, 0.07);
    }),

  /** Ceiling whitewash with faint hairline cracks; 2 m to a tile, so they don't repeat too often. */
  ceiling: () =>
    surface('ceiling', 512, 2, (g, l, s) => {
      if (l === 'r') return fill(g, rough(0.98), s);
      fill(g, l === 'c' ? '#d8d4ca' : grey(128), s);
      if (l === 'c') blotches(g, s, 51, 25, s * 0.05, s * 0.2, (r) => `rgba(140,130,110,${0.03 + r() * 0.04})`);
      const r = rng(52);
      g.strokeStyle = l === 'c' ? 'rgba(90,85,75,0.35)' : grey(70, 0.8);
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        let x = r() * s;
        let y = r() * s;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 14; k++) {
          x += (r() - 0.5) * 30;
          y += (r() - 0.3) * 22;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      speckle(g, s, 53, 4000, l === 'c' ? 0.06 : 0.25);
    }),

  /** Metlakh tile: 10 cm squares, terracotta with a beige border and diagonal accents. */
  metlakh: () =>
    surface('metlakh', 512, 1, (g, l, s) => {
      const r = rng(15);
      tiles(
        g,
        l,
        s,
        10,
        3,
        (i, j) => {
          const border = i === 0 || j === 0 || i === 9 || j === 9;
          const accent = (i + j) % 4 === 0;
          const k = 0.9 + r() * 0.2;
          const [cr, cg, cb] = border ? [176, 158, 120] : accent ? [190, 172, 132] : [140, 68, 48];
          return `rgb(${cr * k},${cg * k},${cb * k})`;
        },
        '#3a3128',
        0.5,
      );
      speckle(g, s, 16, 6000, l === 'c' ? 0.1 : 0.2);
    }),

  /** Bare concrete with a few cracks: corridor and loggia floors. */
  concrete: () =>
    surface('concrete', 512, 2, (g, l, s) => {
      if (l === 'r') return plasterRelief(g, 'r', s, 61, 0.85);
      fill(g, l === 'c' ? '#7d7a74' : grey(128), s);
      blotches(g, s, 62, 60, s * 0.03, s * 0.15, (r) => (l === 'c' ? `rgba(${r() < 0.5 ? '60,58,55' : '150,146,138'},0.12)` : grey(r() < 0.5 ? 90 : 170, 0.2)));
      speckle(g, s, 63, 20000, 0.25, 3);
      const r = rng(64);
      g.strokeStyle = l === 'c' ? 'rgba(40,38,35,0.5)' : grey(30);
      g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        let x = r() * s;
        let y = r() * s;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 10; k++) g.lineTo((x += (r() - 0.5) * 50), (y += (r() - 0.5) * 50));
        g.stroke();
      }
    }),

  /** Linoleum printed to look like parquet boards (hall and passage). */
  linoleumParquet: () =>
    surface('linoleumParquet', 512, 1, (g, l, s) => {
      const r = rng(71);
      if (l !== 'c') {
        fill(g, l === 'h' ? grey(128) : rough(0.55), s);
        speckle(g, s, 72, 3000, l === 'h' ? 0.15 : 0.1);
        return;
      }
      const w = s / 8;
      for (let i = 0; i < 8; i++) {
        let y = -r() * s * 0.5;
        while (y < s) {
          const len = s * (0.3 + r() * 0.3);
          const k = 0.85 + r() * 0.25;
          g.fillStyle = `rgb(${150 * k},${102 * k},${62 * k})`;
          g.fillRect(i * w, y, w, len);
          g.fillStyle = 'rgba(60,35,15,0.5)';
          g.fillRect(i * w, y, w, 2);
          y += len;
        }
        g.fillStyle = 'rgba(60,35,15,0.5)';
        g.fillRect(i * w, 0, 2, s);
      }
      woodGrain(g, s, 73, 0.12);
    }),

  /** Kitchen linoleum: a beige and brown chequer with marbling. */
  linoleum: () =>
    surface('linoleum', 512, 0.6, (g, l, s) => {
      if (l !== 'c') {
        fill(g, l === 'h' ? grey(128) : rough(0.6), s);
        speckle(g, s, 81, 4000, 0.12);
        return;
      }
      const t = s / 2;
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? '#a08d6c' : '#6e5a43';
          g.fillRect(i * t, j * t, t, t);
        }
      blotches(g, s, 82, 60, s * 0.02, s * 0.08, (r) => `rgba(${r() < 0.5 ? '40,30,20' : '220,205,175'},0.12)`);
      speckle(g, s, 83, 5000, 0.12);
    }),

  /**
   * Lacquered herringbone parquet: slats 7 x 28 cm. Each slat is four cells long; a horizontal slat
   * and a vertical one rising from its left end make a step, the steps climb diagonally, and bands
   * of them repeat every 8 cells, so the texture tiles every 8 x 8 cells (56 cm).
   */
  parquetHerringbone: () =>
    surface('parquetHerringbone', 512, 0.56, (g, l, s) => {
      const N = 4;
      const P = 2 * N;
      const c = s / P;
      // which slat every cell of the period belongs to (named by its first cell, wrapped into the
      // period, so a slat crossing the edge of the texture keeps one name), and its direction
      const wrap = (v: number) => ((v % P) + P) % P;
      const slat = new Map<string, { id: string; along: boolean }>();
      for (let k = -2; k <= 2; k++)
        for (let t = -P; t <= P; t++)
          for (const along of [true, false]) {
            const [sx, sy] = along ? [k * P + t, t] : [k * P + t, t + 1];
            const id = `${wrap(sx)},${wrap(sy)},${along}`;
            for (let i = 0; i < N; i++) slat.set(`${wrap(along ? sx + i : sx)},${wrap(along ? sy : sy + i)}`, { id, along });
          }
      const at = (x: number, y: number) => slat.get(`${wrap(x)},${wrap(y)}`)!;
      const shade = (sid: string) => {
        let h = 0;
        for (const ch of sid) h = (h * 31 + ch.charCodeAt(0)) | 0;
        return 0.8 + rng(h)() * 0.32;
      };
      for (let y = 0; y < P; y++)
        for (let x = 0; x < P; x++) {
          const { id: sid, along } = at(x, y);
          const k = shade(sid);
          g.fillStyle = l === 'c' ? `rgb(${168 * k},${110 * k},${60 * k})` : l === 'h' ? grey(175) : rough(0.28 + (k - 0.8) * 0.4);
          g.fillRect(x * c, y * c, c, c);
          if (l === 'c') {
            // grain along the slat
            const r = rng(x * 13 + y * 101);
            g.strokeStyle = 'rgba(60,32,12,0.18)';
            g.lineWidth = 1;
            for (let m = 0; m < 5; m++) {
              const o = r() * c;
              g.beginPath();
              if (along) {
                g.moveTo(x * c, y * c + o);
                g.lineTo(x * c + c, y * c + o + (r() - 0.5) * 3);
              } else {
                g.moveTo(x * c + o, y * c);
                g.lineTo(x * c + o + (r() - 0.5) * 3, y * c + c);
              }
              g.stroke();
            }
          }
          // joints only where the neighbour is another slat
          g.fillStyle = l === 'c' ? 'rgba(40,22,10,0.9)' : l === 'h' ? grey(40) : rough(0.7);
          if (at(x - 1, y).id !== sid) g.fillRect(x * c, y * c, 2, c);
          if (at(x + 1, y).id !== sid) g.fillRect(x * c + c - 2, y * c, 2, c);
          if (at(x, y - 1).id !== sid) g.fillRect(x * c, y * c, c, 2);
          if (at(x, y + 1).id !== sid) g.fillRect(x * c, y * c + c - 2, c, 2);
        }
    }),

  /** Plain parquet boards for the bedroom. */
  parquet: () =>
    surface('parquet', 512, 1, (g, l, s) => boards(g, l, s, 93, 7, [150, 104, 64], 0.38)),

  /** Wall tiles 15 x 15 cm, pale blue, here and there a white one (bathroom, toilet). */
  tileBlue: () =>
    surface('tileBlue', 512, 0.9, (g, l, s) => {
      const r = rng(101);
      tiles(g, l, s, 6, 4, () => (r() < 0.12 ? '#dfe3e0' : `rgb(${172 + r() * 8},${196 + r() * 6},${204 + r() * 6})`), '#c8ccc8', 0.12);
    }),

  /** White kitchen tiles, 15 x 15 cm. */
  tileWhite: () =>
    surface('tileWhite', 512, 0.9, (g, l, s) => {
      const r = rng(102);
      tiles(g, l, s, 6, 4, () => `rgb(${228 + r() * 10},${226 + r() * 10},${215 + r() * 10})`, '#b4b0a4', 0.12);
    }),

  /** Floor tiles 10 x 10 cm, brown and beige (bathroom, toilet). */
  tileFloor: () =>
    surface('tileFloor', 512, 1, (g, l, s) => {
      const r = rng(103);
      tiles(g, l, s, 10, 4, (i, j) => ((i + j) % 2 ? `rgb(${120 + r() * 15},${78 + r() * 10},${55})` : `rgb(${190 + r() * 10},${170 + r() * 10},${135})`), '#5a5048', 0.25);
    }),

  /** Hall wallpaper: small rhombus print on beige, slightly embossed. */
  wallpaperRhombus: () =>
    surface('wallpaperRhombus', 512, 0.53, (g, l, s) => {
      fill(g, l === 'c' ? '#c9b98f' : l === 'h' ? grey(128) : rough(0.85), s);
      const n = 8;
      const t = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const x = (i + (j % 2) * 0.5) * t;
          const y = j * t;
          g.fillStyle = l === 'c' ? 'rgba(120,90,50,0.45)' : l === 'h' ? grey(160) : rough(0.8);
          g.beginPath();
          g.moveTo(x, y - t * 0.22);
          g.lineTo(x + t * 0.16, y);
          g.lineTo(x, y + t * 0.22);
          g.lineTo(x - t * 0.16, y);
          g.fill();
        }
      if (l === 'c') speckle(g, s, 111, 3000, 0.06);
    }),

  /** Living room wallpaper: big faded flowers on a greenish ground. */
  wallpaperFlowers: () =>
    surface('wallpaperFlowers', 512, 0.53, (g, l, s) => {
      fill(g, l === 'c' ? '#b3ae8a' : l === 'h' ? grey(128) : rough(0.85), s);
      const flower = (x: number, y: number, rad: number) => {
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          g.fillStyle = l === 'c' ? 'rgba(150,95,70,0.55)' : l === 'h' ? grey(150) : rough(0.78);
          g.beginPath();
          g.ellipse(x + Math.cos(a) * rad * 0.55, y + Math.sin(a) * rad * 0.55, rad * 0.5, rad * 0.28, a, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = l === 'c' ? 'rgba(120,110,60,0.8)' : l === 'h' ? grey(165) : rough(0.78);
        g.beginPath();
        g.arc(x, y, rad * 0.22, 0, Math.PI * 2);
        g.fill();
        // leaves
        g.fillStyle = l === 'c' ? 'rgba(95,110,75,0.5)' : l === 'h' ? grey(145) : rough(0.8);
        for (const a of [0.7, 2.6]) {
          g.beginPath();
          g.ellipse(x + Math.cos(a) * rad * 1.2, y + Math.sin(a) * rad * 1.2, rad * 0.45, rad * 0.16, a, 0, Math.PI * 2);
          g.fill();
        }
      };
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.75], [1.25, 0.25], [-0.25, 0.75], [0.25, 1.25], [0.75, -0.25]]) flower(x * s, y * s, s * 0.13);
      if (l === 'c') speckle(g, s, 121, 3000, 0.06);
    }),

  /** Bedroom wallpaper: stripes with a tiny dotted ornament. */
  wallpaperStripes: () =>
    surface('wallpaperStripes', 512, 0.53, (g, l, s) => {
      fill(g, l === 'c' ? '#c2b6a0' : l === 'h' ? grey(128) : rough(0.85), s);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = l === 'c' ? 'rgba(130,95,95,0.35)' : l === 'h' ? grey(150) : rough(0.8);
        g.fillRect(i * (s / 4), 0, s / 10, s);
        g.fillStyle = l === 'c' ? 'rgba(110,80,70,0.5)' : grey(150);
        for (let y = 0; y < s; y += s / 16) g.fillRect(i * (s / 4) + s / 6, y, 4, 4);
      }
      if (l === 'c') speckle(g, s, 131, 3000, 0.06);
    }),

  /** Loggia lining: varnished pine tongue-and-groove boards, 9 cm. */
  lining: () =>
    surface('lining', 512, 1, (g, l, s) => {
      const r = rng(141);
      const n = 11;
      const w = s / n;
      for (let i = 0; i < n; i++) {
        const k = 0.85 + r() * 0.25;
        g.fillStyle = l === 'c' ? `rgb(${190 * k},${145 * k},${90 * k})` : l === 'h' ? grey(170) : rough(0.5);
        g.fillRect(i * w, 0, w, s);
        g.fillStyle = l === 'c' ? 'rgba(70,45,20,0.6)' : l === 'h' ? grey(40) : rough(0.8);
        g.fillRect(i * w, 0, 3, s);
      }
      if (l === 'c') woodGrain(g, s, 142, 0.15, true);
    }),

  // --- furniture ---

  /** Polished dark veneer: the wall unit, wardrobe, dresser. */
  veneer: () =>
    surface('veneer', 512, 1, (g, l, s) => {
      if (l === 'r') return fill(g, rough(0.28), s);
      fill(g, l === 'c' ? '#5a3420' : grey(128), s);
      if (l === 'c') woodGrain(g, s, 151, 0.25, true);
    }),
  /** Painted or plain light wood: kitchen furniture, stools, cot. */
  pine: () =>
    surface('pine', 512, 1, (g, l, s) => {
      if (l === 'r') return fill(g, rough(0.55), s);
      fill(g, l === 'c' ? '#b8915c' : grey(128), s);
      if (l === 'c') woodGrain(g, s, 152, 0.2, true);
    }),
  /** Coarse woven upholstery. */
  fabric: (color: string, seed: number) =>
    surface(`fabric${color}`, 256, 0.25, (g, l, s) => {
      fill(g, l === 'c' ? color : l === 'h' ? grey(128) : rough(0.95), s);
      for (let y = 0; y < s; y += 4) {
        g.fillStyle = l === 'c' ? 'rgba(0,0,0,0.12)' : grey(l === 'h' ? 90 : 230, 0.5);
        g.fillRect(0, y, s, 2);
      }
      for (let x = 0; x < s; x += 4) {
        g.fillStyle = l === 'c' ? 'rgba(255,255,255,0.05)' : grey(l === 'h' ? 160 : 230, 0.3);
        g.fillRect(x, 0, 2, s);
      }
      speckle(g, s, seed, 2000, 0.1);
    }),
  /**
   * Tulle: a fine net with lace flowers, mostly see-through. The colour layer carries the
   * transparency; the material only needs to be transparent.
   */
  tulle: () =>
    surface('tulle', 256, 0.35, (g, l, s) => {
      if (l !== 'c') return fill(g, l === 'h' ? grey(128) : rough(0.9), s);
      g.fillStyle = 'rgba(245,242,232,0.22)';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(250,248,240,0.35)';
      g.lineWidth = 1;
      for (let i = 0; i <= s; i += 6) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, s);
        g.moveTo(0, i);
        g.lineTo(s, i);
        g.stroke();
      }
      g.fillStyle = 'rgba(252,250,244,0.75)';
      for (const [x, y] of [[0.25, 0.3], [0.75, 0.8], [0.75, -0.2], [-0.25, 0.3], [1.25, 0.3]]) {
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          g.beginPath();
          g.ellipse(x * s + Math.cos(a) * 14, y * s + Math.sin(a) * 14, 10, 5, a, 0, Math.PI * 2);
          g.fill();
        }
      }
    }),
  /** Chintz for the kitchen curtains: cream with small red and blue flowers. */
  chintz: () =>
    surface('chintz', 256, 0.25, (g, l, s) => {
      fill(g, l === 'c' ? '#ece4cc' : l === 'h' ? grey(128) : rough(0.92), s);
      if (l !== 'c') return;
      const r = rng(171);
      for (let i = 0; i < 26; i++) {
        const x = r() * s;
        const y = r() * s;
        g.fillStyle = r() < 0.6 ? 'rgba(170,40,40,0.8)' : 'rgba(50,70,140,0.75)';
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          g.beginPath();
          g.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 3.5, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(80,110,60,0.7)';
        g.fillRect(x + 6, y + 4, 8, 3);
      }
    }),
  /** Oilcloth on the kitchen table: red and white check. */
  oilcloth: () =>
    surface('oilcloth', 256, 0.2, (g, l, s) => {
      if (l !== 'c') return fill(g, l === 'h' ? grey(128) : rough(0.4), s);
      fill(g, '#e8e2d6', s);
      g.fillStyle = 'rgba(170,40,35,0.55)';
      g.fillRect(0, 0, s / 2, s);
      g.fillRect(0, 0, s, s / 2);
    }),
  /** Quilted leatherette of the flat's front door, with buttons. */
  dermatin: () =>
    surface('dermatin', 256, 0.25, (g, l, s) => {
      fill(g, l === 'c' ? '#3b2418' : l === 'h' ? grey(150) : rough(0.45), s);
      g.strokeStyle = l === 'c' ? 'rgba(0,0,0,0.5)' : l === 'h' ? grey(60) : rough(0.6);
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(s, s);
      g.moveTo(s, 0);
      g.lineTo(0, s);
      g.stroke();
      g.fillStyle = l === 'c' ? '#b8a070' : l === 'h' ? grey(200) : rough(0.2);
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]]) {
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }),
};

function paint(key: string, color: string, seed: number) {
  return surface(key, 256, 1, (g, l, s) => {
    if (l !== 'c') {
      fill(g, l === 'h' ? grey(128) : rough(0.45), s);
      const r = rng(seed);
      for (let i = 0; i < 50; i++) {
        g.fillStyle = l === 'h' ? grey(r() < 0.5 ? 110 : 150, 0.3) : rough(0.35 + r() * 0.2);
        g.fillRect(r() * s, 0, 2 + r() * 8, s);
      }
      return;
    }
    fill(g, color, s);
    const r = rng(seed);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.01 + r() * 0.02})`;
      g.fillRect(r() * s, 0, 2 + r() * 8, s);
    }
    speckle(g, s, seed + 1, 3000, 0.06);
  });
}

function boards(g: G, l: 'c' | 'h' | 'r', s: number, seed: number, n: number, [cr, cg, cb]: number[], gloss: number) {
  const r = rng(seed);
  const w = s / n;
  fill(g, l === 'c' ? '#3a2412' : l === 'h' ? grey(60) : rough(0.7), s);
  for (let i = 0; i < n; i++) {
    let y = -r() * s;
    while (y < s) {
      const len = s * (0.5 + r() * 0.5);
      const k = 0.85 + r() * 0.25;
      g.fillStyle = l === 'c' ? `rgb(${cr * k},${cg * k},${cb * k})` : l === 'h' ? grey(175) : rough(gloss + r() * 0.1);
      g.fillRect(i * w + 1, y + 1, w - 2, len - 2);
      y += len;
    }
  }
  if (l === 'c') woodGrain(g, s, seed + 1, 0.12);
}

/** Thin wavy grain lines over whatever is drawn, along y (or along x when `across`). */
function woodGrain(g: G, s: number, seed: number, alpha: number, across = false) {
  const r = rng(seed);
  g.save();
  if (across) {
    g.translate(s, 0);
    g.rotate(Math.PI / 2);
  }
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(40,22,8,${alpha * (0.3 + r() * 0.7)})`;
    g.lineWidth = 0.5 + r() * 1.5;
    const x = r() * s;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 12, s / 3, x + (r() - 0.5) * 12, (2 * s) / 3, x, s);
    g.stroke();
  }
  g.restore();
}
