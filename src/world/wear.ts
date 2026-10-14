import * as THREE from 'three';
import { ROOM_BY_ID, type RoomId } from '../../shared/map.ts';
import { canvasTexture, rng } from '../textures.ts';
import { Kit } from './furniture.ts';
import { mount, type Facing } from './geometry.ts';
import { useBaked } from './lighting.ts';

/**
 * Wear and tear (docs/DESIGN.md, 4.6): grimy wallpaper round the light switches, wallpaper coming
 * away at a seam, water stains on the ceilings, scuffed lino at the thresholds, limescale in the
 * bathroom, soot over the stove, chipped paint and mop dirt along the walls of the landing and the
 * corridor. Translucent decals from one atlas in one material, so all of it merges into a single
 * draw call, a few millimetres off their surfaces and pulled forward in depth. Placed by hand, the
 * same in every cycle; never in the vestibules (they must stay symmetric), and nothing that could
 * pass for an anomaly: no single striking mark where an anomaly could put a similar one.
 * Also the light switches themselves (3.1), old cream plastic by the doors.
 */

const TILE = 128;
const GRID = 8;
type Tile = 'grimeA' | 'grimeB' | 'peel' | 'stainA' | 'stainB' | 'scuff' | 'lime' | 'soot' | 'chipsA' | 'chipsB' | 'strip';
/** Cell of each tile in the atlas: column, row; the strip takes the whole bottom row. */
const CELLS: Record<Exclude<Tile, 'strip'>, [number, number]> = {
  grimeA: [0, 0],
  grimeB: [1, 0],
  peel: [2, 0],
  stainA: [3, 0],
  stainB: [4, 0],
  scuff: [5, 0],
  lime: [6, 0],
  soot: [7, 0],
  chipsA: [0, 1],
  chipsB: [1, 1],
};

let atlas: THREE.Texture | null = null;
export const isWearTexture = (t: THREE.Texture) => t === atlas;

/** Every decal, drawn once; each tile keeps a transparent margin so mipmaps don't bleed between them. */
function wearAtlas() {
  return (atlas ??= canvasTexture(GRID * TILE, GRID * TILE, (g) => {
    const r = rng(907);
    const cell = (t: Exclude<Tile, 'strip'>) => [CELLS[t][0] * TILE, CELLS[t][1] * TILE] as const;
    const blob = (x: number, y: number, rx: number, ry: number, style: string) => {
      g.fillStyle = style;
      g.beginPath();
      g.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    };
    // grime: many faint smudges, thickest where hands go, a little right of the middle
    for (const t of ['grimeA', 'grimeB'] as const) {
      const [x, y] = cell(t);
      for (let i = 0; i < 220; i++) {
        const a = r() * Math.PI * 2;
        const d = (r() * r()) ** 0.7 * 44;
        blob(x + 64 + 8 + Math.cos(a) * d, y + 64 + Math.sin(a) * d * 1.2, 2 + r() * 6, 2 + r() * 5, `rgba(58,44,30,${0.03 + r() * 0.07})`);
      }
    }
    // wallpaper coming away at a seam under the ceiling: the plaster it bared, the flap curling down
    {
      const [x, y] = cell('peel');
      const cx = x + 52;
      const top = y + 6;
      g.fillStyle = '#b4ad9f';
      g.beginPath();
      g.moveTo(cx, top);
      g.lineTo(cx + 46, top);
      g.lineTo(cx, top + 70);
      g.closePath();
      g.fill();
      for (let i = 0; i < 30; i++) blob(cx + r() * 20, top + r() * 30, 1 + r() * 3, 1 + r() * 3, `rgba(90,80,62,${r() * 0.25})`);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.moveTo(cx + 46, top);
      g.lineTo(cx + 3, top + 72);
      g.lineTo(cx + 40, top + 66);
      g.closePath();
      g.fill();
      const grad = g.createLinearGradient(cx + 40, top, cx + 10, top + 60);
      grad.addColorStop(0, '#d9d0b8');
      grad.addColorStop(1, '#a89f88');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx + 46, top);
      g.lineTo(cx, top + 70);
      g.quadraticCurveTo(cx + 30, top + 64, cx + 36, top + 58);
      g.closePath();
      g.fill();
    }
    // water stains: rings of rusty yellow, darker at the edge where the water stopped
    for (const t of ['stainA', 'stainB'] as const) {
      const [x, y] = cell(t);
      for (let ring = 0; ring < 3; ring++) {
        const rad = 50 - ring * 13 - r() * 6;
        g.beginPath();
        for (let k = 0; k <= 40; k++) {
          const a = (k / 40) * Math.PI * 2;
          const w = rad * (0.85 + 0.15 * Math.sin(a * 3 + ring + r() * 0.4) + 0.06 * Math.sin(a * 7));
          const px = x + 64 + Math.cos(a) * w;
          const py = y + 64 + Math.sin(a) * w * 0.85;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fillStyle = `rgba(150,112,48,${0.08 + ring * 0.03})`;
        g.fill();
        g.strokeStyle = `rgba(120,82,30,${0.22 - ring * 0.05})`;
        g.lineWidth = 2.5;
        g.stroke();
      }
    }
    // lino worn pale where feet turn, with scratches
    {
      const [x, y] = cell('scuff');
      const grad = g.createRadialGradient(x + 64, y + 64, 4, x + 64, y + 64, 56);
      grad.addColorStop(0, 'rgba(214,204,182,0.34)');
      grad.addColorStop(1, 'rgba(214,204,182,0)');
      g.fillStyle = grad;
      g.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      g.strokeStyle = 'rgba(50,40,30,0.18)';
      g.lineWidth = 1;
      for (let i = 0; i < 24; i++) {
        const sx = x + 24 + r() * 80;
        const sy = y + 24 + r() * 80;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + (r() - 0.5) * 30, sy + (r() - 0.5) * 8);
        g.stroke();
      }
    }
    // limescale running down tiles from a tap
    {
      const [x, y] = cell('lime');
      for (let i = 0; i < 16; i++) {
        const sx = x + 40 + r() * 48;
        const len = 30 + r() * 80;
        const grad = g.createLinearGradient(0, y + 8, 0, y + 8 + len);
        grad.addColorStop(0, 'rgba(236,236,226,0.5)');
        grad.addColorStop(1, 'rgba(236,236,226,0)');
        g.fillStyle = grad;
        g.fillRect(sx, y + 8, 1.5 + r() * 4, len);
      }
      blob(x + 64, y + 14, 26, 8, 'rgba(230,230,218,0.35)');
    }
    // soot rising from the stove: dense low down, thinning out upwards, soft all round
    {
      const [x, y] = cell('soot');
      for (let i = 0; i < 26; i++) {
        const rise = r();
        const px = x + 64 + (r() - 0.5) * 30 * (0.4 + rise);
        const py = y + 104 - rise * 70;
        const rad = 14 + rise * 22;
        const grad = g.createRadialGradient(px, py, 1, px, py, rad);
        grad.addColorStop(0, `rgba(26,20,14,${0.16 * (1 - rise * 0.6)})`);
        grad.addColorStop(1, 'rgba(26,20,14,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, rad, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 80; i++) blob(x + 34 + r() * 60, y + 30 + r() * 76, 1 + r() * 3, 1 + r() * 3, `rgba(26,20,14,${r() * 0.1})`);
    }
    // oil paint chipped off down to the plaster
    for (const t of ['chipsA', 'chipsB'] as const) {
      const [x, y] = cell(t);
      for (let i = 0; i < 7; i++) {
        const px = x + 26 + r() * 76;
        const py = y + 26 + r() * 76;
        const rad = 5 + r() * 16;
        g.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const w = rad * (0.5 + r() * 0.6);
          if (k) g.lineTo(px + Math.cos(a) * w, py + Math.sin(a) * w);
          else g.moveTo(px + Math.cos(a) * w, py + Math.sin(a) * w);
        }
        g.closePath();
        g.fillStyle = '#b2ab9b';
        g.fill();
        g.strokeStyle = 'rgba(40,36,30,0.55)';
        g.lineWidth = 1.2;
        g.stroke();
      }
    }
    // mop water dried along the foot of a wall: a dusty film, thickest at the bottom, splashed upwards
    {
      const y = (GRID - 1) * TILE;
      const grad = g.createLinearGradient(0, y + TILE - 4, 0, y + 8);
      grad.addColorStop(0, 'rgba(84,72,58,0.6)');
      grad.addColorStop(0.45, 'rgba(84,72,58,0.25)');
      grad.addColorStop(1, 'rgba(84,72,58,0)');
      g.fillStyle = grad;
      g.fillRect(0, y + 8, GRID * TILE, TILE - 12);
      for (let i = 0; i < 400; i++) {
        const h = 10 + r() * 70;
        g.fillStyle = `rgba(84,72,58,${0.05 + r() * 0.12})`;
        g.fillRect(r() * GRID * TILE, y + TILE - 4 - h, 2 + r() * 10, h);
      }
    }
  }));
}

/** UVs of a tile, inside its margin. */
function tileUv(t: Tile): [number, number, number, number] {
  const n = GRID * TILE;
  if (t === 'strip') return [0, 4 / n, 1, (TILE - 4) / n];
  const [c, row] = CELLS[t];
  // canvas rows run down, texture v runs up
  return [(c * TILE + 4) / n, 1 - ((row + 1) * TILE - 4) / n, ((c + 1) * TILE - 4) / n, 1 - (row * TILE + 4) / n];
}

/** A decal of `w` x `h` metres, split into cells of about half a metre so long ones take the bake along their length. */
function decal(t: Tile, w: number, h: number, mat: THREE.Material, flipX = false) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(1, Math.ceil(w / 0.5)), Math.max(1, Math.ceil(h / 0.5)));
  const [u0, v0, u1, v1] = tileUv(t);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = flipX ? 1 - uv.getX(i) : uv.getX(i);
    uv.setXY(i, u0 + u * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  const m = new THREE.Mesh(geo, mat);
  // drawn before the cell's other see-through things (glass), which may stand in front of it
  m.renderOrder = -1;
  return m;
}

const FACE: Record<'n' | 's' | 'w' | 'e', Facing> = { n: 'pz', s: 'nz', w: 'px', e: 'nx' };

export function buildWear(root: THREE.Object3D) {
  const mat = useBaked(
    new THREE.MeshStandardMaterial({
      map: wearAtlas(),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  const rect = (id: RoomId) => ROOM_BY_ID[id].rect;
  /** On a wall of a room: `at` along it, centre at height y. */
  const wall = (t: Tile, id: RoomId, side: 'n' | 's' | 'w' | 'e', at: number, y: number, w: number, h: number, flipX = false) => {
    const r = rect(id);
    const [x, z] = side === 'n' ? [at, r.z0] : side === 's' ? [at, r.z1] : side === 'w' ? [r.x0, at] : [r.x1, at];
    mount(root, decal(t, w, h, mat, flipX), x, z, FACE[side], y, 0.004);
  };
  /** On the floor (y = 0) or the ceiling of a room. */
  const flatDecal = (t: Tile, id: RoomId, x: number, z: number, w: number, d: number, ceiling = false, turn = 0) => {
    const m = decal(t, w, d, mat);
    m.rotation.set(ceiling ? Math.PI / 2 : -Math.PI / 2, 0, turn);
    m.position.set(x, ceiling ? ROOM_BY_ID[id].height - 0.004 : 0.004, z);
    root.add(m);
  };

  // light switches by the doors, on the side away from the hinge, with grime round them; the
  // bathroom and toilet ones side by side in the passage, as they always are
  const k = new Kit(root, 'hall');
  const plastic = k.mat('paper');
  const switches: [RoomId, 'n' | 's' | 'w' | 'e', number, number][] = [
    ['hall', 'n', 24.1, 1],
    ['passage', 'w', 7.75, 2],
    ['kitchen', 'w', 8.25, 1],
    ['living', 'n', 24.35, 1],
    ['bedroom', 'e', 12.5, 1],
  ];
  switches.forEach(([id, side, at, n], i) => {
    const r = rect(id);
    const [x, z] = side === 'n' ? [at, r.z0] : side === 's' ? [at, r.z1] : side === 'w' ? [r.x0, at] : [r.x1, at];
    const g = k.at(x, z, FACE[side], 1.45);
    const w = 0.075 * n;
    k.box(g, w, 0.085, 0.014, plastic, 0, 0, 0.007);
    for (let s = 0; s < n; s++) k.box(g, 0.03, 0.045, 0.012, plastic, -w / 2 + 0.0375 + s * 0.075, 0.02, 0.019);
    wall(i % 2 ? 'grimeB' : 'grimeA', id, side, at, 1.47, 0.3 + w, 0.36);
  });

  // wallpaper coming away at seams, up under the ceiling and one down by the floor
  wall('peel', 'living', 'e', 10.95, 2.5 - 0.26, 0.5, 0.5);
  wall('peel', 'passage', 'e', 9.6, 2.5 - 0.26, 0.5, 0.5, true);
  wall('peel', 'bedroom', 'w', 11.05, 2.5 - 0.26, 0.5, 0.5);
  // water from the flat upstairs: the bathroom ceiling, the hall's corner, the living room by the chandelier
  flatDecal('stainA', 'bath', 22.75, 6.7, 0.7, 0.6, true);
  flatDecal('stainB', 'hall', 23.95, 3.55, 0.6, 0.5, true, 0.6);
  flatDecal('stainB', 'living', 26.35, 12.45, 0.85, 0.7, true, 1.9);
  flatDecal('stainA', 'kitchen', 28.3, 9.0, 0.6, 0.5, true, 0.4);
  // the stove's soot on the wall between it and the cabinets, and on the ceiling in front
  wall('soot', 'kitchen', 'n', 27.05, 1.17, 0.62, 0.55);
  flatDecal('soot', 'kitchen', 27.05, 6.9, 0.9, 0.7, true, Math.PI);
  // lino worn at the thresholds
  flatDecal('scuff', 'hall', 24.7, 3.45, 0.8, 0.55);
  flatDecal('scuff', 'hall', 24.95, 5.85, 0.8, 0.5, false, 0.3);
  flatDecal('scuff', 'kitchen', 26.05, 7.65, 0.55, 0.8, false, Math.PI / 2);
  // limescale under the tap of the tub and under the washbasin
  wall('lime', 'bath', 'w', 7.15, 0.95, 0.3, 0.45);
  wall('lime', 'bath', 's', 23.65, 0.55, 0.3, 0.4);

  // the landing and the corridor: chipped paint low on the walls, mop dirt along their feet
  const chips: ['landing' | 'corridor', 'n' | 's' | 'w' | 'e', number, number][] = [
    ['landing', 'w', 0.6, 0.45],
    ['corridor', 'n', 3.9, 0.5],
    ['corridor', 's', 10.6, 0.9],
    ['corridor', 's', 15.8, 0.6],
    ['corridor', 'n', 19.6, 0.35],
    ['corridor', 's', 23.4, 1.15],
    ['corridor', 'n', 25.9, 0.7],
  ];
  chips.forEach(([id, side, at, y], i) => wall(i % 2 ? 'chipsB' : 'chipsA', id, side, at, y, 0.45, 0.45, i % 3 === 0));
  const c = rect('corridor');
  const l = rect('landing');
  const entrance = 24.7;
  const strips: ['landing' | 'corridor', 'n' | 's' | 'w', number, number][] = [
    ['landing', 's', l.x0, l.x1],
    ['landing', 'w', l.z0, l.z1],
    ['corridor', 'n', c.x0, c.x1],
    ['corridor', 's', c.x0, entrance - 0.47],
    ['corridor', 's', entrance + 0.47, c.x1],
  ];
  for (const [id, side, a0, a1] of strips) wall('strip', id, side, (a0 + a1) / 2, 0.085 + 0.11, a1 - a0 - 0.02, 0.22);
}
