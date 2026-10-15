import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOM_BY_ID, ROOMS, WING, type Side } from '../../shared/map.ts';
import { canvasTexture, rng } from '../textures.ts';
import { YAW, type Facing } from './geometry.ts';
import { REVEAL } from './shell.ts';
import { GROUND_Y, STOREY, WINDOW_GLOW, outdoorMaterial, panelTexture } from './yard.ts';

/** Storeys above ours. */
const ABOVE = 2;
const ROOF_Y = (ABOVE + 1) * STOREY;
/** Panel size on our own facade, for the texture scale. */
const PANEL: [number, number] = [3, STOREY];

interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

interface Face {
  facing: Facing;
  /** z of a face along x (facing ±z), x of a face along z. */
  fixed: number;
  a0: number;
  a1: number;
  holes: Hole[];
  /** Window columns repeated on the other storeys: centre along the face, width, sill, top. */
  columns: { at: number; width: number; sill: number; top: number }[];
  /** No room of ours behind it: its windows go on through our storey too (the wing). */
  blind?: boolean;
}

const SIDE_FACING: Record<Side, Facing> = { n: 'nz', s: 'pz', w: 'nx', e: 'px' };

/**
 * The outside of our own house (an L of a corridor wing and the flat, and the wing the forward
 * gallery runs in), built so that no window can see past it into the cell: plain panels, with holes
 * only where our windows are, and the windows of the other storeys repeated above and below ours.
 */
function faces(): Face[] {
  const corridor = ROOM_BY_ID.corridor.rect;
  const living = ROOM_BY_ID.living.rect;
  const loggia = ROOM_BY_ID.loggia.rect;
  const bedroom = ROOM_BY_ID.bedroom.rect;
  const landing = ROOM_BY_ID.landing.rect;
  const east = corridor.x1 + REVEAL;
  const west = bedroom.x0 - REVEAL;
  const south = living.z1 + REVEAL;
  const front = loggia.z1 + REVEAL;
  const wing = corridor.z1 + REVEAL;
  const list: Face[] = [
    { facing: 'px', fixed: east, a0: corridor.z0 - REVEAL, a1: south, holes: [], columns: [] },
    { facing: 'pz', fixed: south, a0: living.x0, a1: east, holes: [], columns: [] },
    { facing: 'px', fixed: living.x0, a0: south, a1: front, holes: [], columns: [] },
    { facing: 'pz', fixed: front, a0: west, a1: living.x0, holes: [], columns: [] },
    // the west facade goes as far as the wing, and the wing (shared/map.ts, WING) stands on to the south
    { facing: 'nx', fixed: west, a0: wing, a1: WING.z0, holes: [], columns: [] },
    { facing: 'nz', fixed: WING.z0, a0: WING.x0, a1: west, holes: [], columns: [], blind: true },
    { facing: 'nx', fixed: WING.x0, a0: WING.z0, a1: WING.z1, holes: [], columns: [], blind: true },
    { facing: 'pz', fixed: WING.z1, a0: WING.x0, a1: west, holes: [], columns: [], blind: true },
    { facing: 'px', fixed: west, a0: front, a1: WING.z1, holes: [], columns: [], blind: true },
    { facing: 'pz', fixed: wing, a0: landing.x0 - REVEAL, a1: west, holes: [], columns: [] },
    { facing: 'nx', fixed: landing.x0 - REVEAL, a0: landing.z0 - REVEAL, a1: wing, holes: [], columns: [] },
  ];
  // our windows: a hole on our storey, and the same window on every other storey
  for (const r of ROOMS)
    for (const w of r.windows) {
      const facing = SIDE_FACING[w.side];
      const fixed = w.side === 'e' ? r.rect.x1 + REVEAL : w.side === 'w' ? r.rect.x0 - REVEAL : w.side === 's' ? r.rect.z1 + REVEAL : r.rect.z0 - REVEAL;
      const f = list.find((f) => f.facing === facing && Math.abs(f.fixed - fixed) < 1e-6);
      if (!f) throw new Error(`no facade for the window of ${r.id}`);
      f.holes.push({ a0: w.at - w.width / 2, a1: w.at + w.width / 2, y0: w.sill, y1: w.top });
      f.columns.push({ at: w.at, width: w.width, sill: w.sill, top: w.top });
    }
  // plain walls get windows of other flats every 3.6 m on the other storeys
  for (const f of list)
    if (f.columns.length === 0 && f.a1 - f.a0 > 3)
      for (let a = f.a0 + 1.8; a < f.a1 - 1.2; a += 3.6) f.columns.push({ at: a, width: 1.3, sill: 0.85, top: 2.2 });
  return list;
}

/** A tall wall with rectangular holes, UVs in metres. */
function holeyWall(f: Face, y0: number, y1: number) {
  const parts: THREE.BufferGeometry[] = [];
  const cuts = [...new Set([f.a0, f.a1, ...f.holes.flatMap((h) => [h.a0, h.a1])])].sort((a, b) => a - b);
  const piece = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4) return;
    const p = new THREE.PlaneGeometry(a1 - a0, b1 - b0, Math.ceil((a1 - a0) / 6), Math.ceil((b1 - b0) / 6));
    const uv = p.attributes.uv as THREE.BufferAttribute;
    // u along the face (a), v up; panels line up across pieces
    const flip = f.facing === 'nz' || f.facing === 'px';
    for (let i = 0; i < uv.count; i++) {
      const a = flip ? a1 - uv.getX(i) * (a1 - a0) : a0 + uv.getX(i) * (a1 - a0);
      uv.setXY(i, (flip ? -a : a) / PANEL[0], (b0 + uv.getY(i) * (b1 - b0)) / PANEL[1]);
    }
    p.rotateY(YAW[f.facing]);
    const mid = (a0 + a1) / 2;
    const alongX = f.facing === 'pz' || f.facing === 'nz';
    p.translate(alongX ? mid : f.fixed, (b0 + b1) / 2, alongX ? f.fixed : mid);
    parts.push(p);
  };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [c0, c1] = [cuts[k], cuts[k + 1]];
    const hole = f.holes.find((h) => h.a0 <= (c0 + c1) / 2 && (c0 + c1) / 2 <= h.a1);
    if (!hole) piece(c0, c1, y0, y1);
    else {
      piece(c0, c1, y0, hole.y0);
      piece(c0, c1, hole.y1, y1);
    }
  }
  return mergeGeometries(parts);
}

/**
 * Glass of the other storeys' windows: left half of the texture dark, right half lit. With `glow`,
 * the light of the lit half alone, a lamp behind curtains.
 */
function windowTexture(glow = false) {
  return canvasTexture(128, 64, (g) => {
    for (const x of [0, 64]) {
      g.fillStyle = glow ? '#000' : '#c9c4b8';
      g.fillRect(x, 0, 64, 64);
      if (glow && x === 64) {
        const grad = g.createRadialGradient(x + 32, 28, 2, x + 32, 28, 40);
        grad.addColorStop(0, '#f0bf78');
        grad.addColorStop(1, '#7a4420');
        g.fillStyle = grad;
      } else g.fillStyle = glow ? '#000' : '#1f2325';
      g.fillRect(x + 4, 4, 56, 56);
      g.fillStyle = glow ? '#000' : '#c9c4b8';
      g.fillRect(x + 30, 4, 4, 56);
      g.fillRect(x + 4, 20, 56, 3);
    }
  });
}

function fakeWindows(list: Face[]) {
  const r = rng(91);
  const parts: THREE.BufferGeometry[] = [];
  for (const f of list)
    for (const c of f.columns)
      for (let s = -6; s <= ABOVE; s++) {
        if (s === 0 && !f.blind) continue;
        const h = c.top - c.sill;
        const p = new THREE.PlaneGeometry(c.width, h);
        const lit = r() < 0.15;
        const uv = p.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (lit ? 0.5 : 0));
        p.rotateY(YAW[f.facing]);
        const alongX = f.facing === 'pz' || f.facing === 'nz';
        const [nx, nz] = { pz: [0, 1], nz: [0, -1], px: [1, 0], nx: [-1, 0] }[f.facing];
        // in front of the wall, so it doesn't fight with it for depth (seen at a glancing angle it flickered)
        p.translate((alongX ? c.at : f.fixed) + nx * 0.03, s * STOREY + (c.sill + c.top) / 2, (alongX ? f.fixed : c.at) + nz * 0.03);
        parts.push(p);
      }
  return mergeGeometries(parts);
}

export function buildExterior(parent: THREE.Object3D) {
  const list = faces();
  const panels = outdoorMaterial({ map: panelTexture(), blackInside: true });
  const ext = new THREE.Group();
  ext.name = 'exterior';
  ext.add(new THREE.Mesh(mergeGeometries(list.map((f) => holeyWall(f, GROUND_Y, ROOF_Y))), panels));
  const glass = outdoorMaterial({ map: windowTexture(), glowMap: windowTexture(true), glow: WINDOW_GLOW });
  glass.polygonOffset = true;
  glass.polygonOffsetFactor = -2;
  glass.polygonOffsetUnits = -4;
  const windows = new THREE.Mesh(fakeWindows(list), glass);
  windows.name = 'other-windows';
  ext.add(windows);
  ext.add(slabs());
  parent.add(ext);
  return ext;
}

/** Every other flat of our own house goes dark too (an anomaly). */
export function darkenWindows(parent: THREE.Object3D) {
  windowsGlow(parent, 0);
}

/** How lit the other storeys' windows are, 0..1: off in a blackout, which is our building's alone. */
export function windowsGlow(parent: THREE.Object3D, k: number) {
  const m = parent.getObjectByName('other-windows') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  m.material.uniforms.glow.value = WINDOW_GLOW * k;
}

/**
 * Black floor and roof slabs over the footprint of the house, just outside its rooms: whatever
 * shows through a crack between two indoor planes is black, not the sky.
 */
function slabs() {
  const corridor = ROOM_BY_ID.corridor.rect;
  const living = ROOM_BY_ID.living.rect;
  const loggia = ROOM_BY_ID.loggia.rect;
  const bedroom = ROOM_BY_ID.bedroom.rect;
  const landing = ROOM_BY_ID.landing.rect;
  const [east, west, wing] = [corridor.x1 + REVEAL, bedroom.x0 - REVEAL, corridor.z1 + REVEAL];
  const footprint = [
    [landing.x0 - REVEAL, east, landing.z0 - REVEAL, wing],
    [west, living.x0, wing, loggia.z1 + REVEAL],
    [living.x0, east, wing, living.z1 + REVEAL],
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const [x0, x1, z0, z1] of footprint)
    for (const [y, up] of [[-0.25, true], [2.95, false]] as const) {
      const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      p.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
      p.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      parts.push(p);
    }
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ color: 0x000000 }));
}

/** Concrete skin of a vestibule's gallery, outside its walls: seen from the windows, never from inside. */
export function galleryMaterial() {
  return outdoorMaterial({ map: panelTexture(), scale: [1 / PANEL[0], 1 / PANEL[1]], blackInside: true });
}
