import * as THREE from 'three';
import { FURNITURE, type Piece, type PieceId } from '../../shared/furniture.ts';
import type { RoomId } from '../../shared/map.ts';
import { YAW, type Facing } from './geometry.ts';
import { useBaked } from './lighting.ts';
import { surfaces, type Surface } from './surfaces.ts';

/** Material kinds furniture is made of (docs/DESIGN.md, 4.3 for the gloss). */
const KINDS = {
  veneer: { surface: surfaces.veneer },
  pine: { surface: surfaces.pine },
  enamel: { color: 0xe6e3da, roughness: 0.2 },
  chrome: { color: 0xc8c8c8, roughness: 0.22, metalness: 1 },
  iron: { color: 0x3a3a38, roughness: 0.6, metalness: 0.5 },
  steel: { color: 0x59615a, roughness: 0.5, metalness: 0.4 },
  black: { color: 0x1c1b1a, roughness: 0.35 },
  white: { color: 0xe4e0d6, roughness: 0.5 },
  paper: { color: 0xece6d4, roughness: 0.95 },
  brass: { color: 0xb59a5a, roughness: 0.3, metalness: 1 },
  glass: { color: 0xc8d4d8, roughness: 0.05, transparent: 0.22 },
  crystal: { color: 0xeef4f6, roughness: 0.05, transparent: 0.55 },
  rubber: { color: 0x2a2624, roughness: 0.9 },
  oilcloth: { surface: surfaces.oilcloth },
  dermatin: { surface: surfaces.dermatin },
} as const;
export type Kind = keyof typeof KINDS;

export interface Spec {
  surface?: () => Surface;
  /** Cloth hangs free and is seen from both sides. */
  doubleSide?: boolean;
  color?: number;
  roughness?: number;
  metalness?: number;
  transparent?: number;
}

/** A baked standard material; the room tag gets it that room's reflections (env.ts). */
export function bakedMaterial(spec: Spec, room: RoomId | null) {
  const s = spec.surface?.();
  const m = useBaked(
    new THREE.MeshStandardMaterial({
      color: spec.color ?? 0xffffff,
      map: s?.map ?? null,
      bumpMap: s?.bump ?? null,
      bumpScale: 1,
      roughnessMap: s?.rough ?? null,
      roughness: s ? 1 : (spec.roughness ?? 0.8),
      metalness: spec.metalness ?? 0,
      transparent: spec.transparent !== undefined,
      opacity: spec.transparent ?? 1,
      depthWrite: spec.transparent === undefined,
      side: spec.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }),
  );
  if (room) m.userData.room = room;
  return m;
}

/**
 * Builds the furniture of one room. Materials are shared within the room, so the static pieces merge
 * into a few meshes (index.ts, merge); `keep` marks what anomalies will touch, which stays separate.
 */
export class Kit {
  readonly root: THREE.Object3D;
  readonly room: RoomId;
  private mats = new Map<string, THREE.MeshStandardMaterial>();

  constructor(root: THREE.Object3D, room: RoomId) {
    this.root = root;
    this.room = room;
  }

  mat(kind: Kind) {
    return this.custom(kind, KINDS[kind]);
  }

  fabric(color: string) {
    return this.custom(`fabric${color}`, { surface: () => surfaces.fabric(color, color.length) }, true);
  }

  paint(color: number, roughness = 0.6) {
    return this.custom(`paint${color}`, { color, roughness });
  }

  /**
   * Glossy materials belong to the room, to get its reflections; matte ones reflect nothing worth
   * seeing, so one material serves every room and the pieces merge across rooms.
   */
  custom(key: string, spec: Spec, matte = !spec.metalness && spec.transparent === undefined && (spec.roughness ?? 0) >= 0.6) {
    const cache = matte ? Kit.matte : this.mats;
    let m = cache.get(key);
    if (!m) cache.set(key, (m = bakedMaterial(spec, matte ? null : this.room)));
    return m;
  }

  /** Matte materials shared by all rooms of the world being built; reset for every build. */
  static matte = new Map<string, THREE.MeshStandardMaterial>();

  box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    parent.add(m);
    return m;
  }

  cyl(parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 12, r2 = r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    parent.add(m);
    return m;
  }

  /** A horizontal bar along local x, centred on (x, y, z): curtain rods, a toilet roll. */
  rod(parent: THREE.Object3D, r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 6) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.position.set(x, y, z);
    m.rotation.z = Math.PI / 2;
    parent.add(m);
    return m;
  }

  /**
   * A group standing in a piece's box, its front (local +z) facing `facing`. Local x runs across the
   * front (w wide), local z from back (-d/2) to front (d/2).
   */
  place(id: PieceId, facing: Facing) {
    const p: Piece = FURNITURE[id];
    const y0 = p.y0 ?? 0;
    const g = new THREE.Group();
    g.position.set((p.x0 + p.x1) / 2, y0, (p.z0 + p.z1) / 2);
    // baking: this piece doesn't shadow itself (world/index.ts, solids)
    g.userData.solid = id;
    g.rotation.y = YAW[facing];
    this.root.add(g);
    const sideways = facing === 'px' || facing === 'nx';
    const w = sideways ? p.z1 - p.z0 : p.x1 - p.x0;
    const d = sideways ? p.x1 - p.x0 : p.z1 - p.z0;
    const h = p.h - y0;
    return { g, w, d, h };
  }

  /** A free group at a point on the floor (or at height y), facing `facing`. */
  at(x: number, z: number, facing: Facing, y = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = YAW[facing];
    this.root.add(g);
    return g;
  }
}

/**
 * Marks an object (and everything in it) as touched by anomalies: it isn't merged with the rest
 * when the cell is built, only once the cycle's anomaly has left it alone (world/index.ts, settle).
 */
export function keep<T extends THREE.Object3D>(o: T): T {
  o.userData.keepRoot = true;
  o.traverse((c) => (c.userData.keep = true));
  return o;
}

/** Kept apart for good: something the cell itself moves every frame (the clock, the meter's disk). */
export function live<T extends THREE.Object3D>(o: T): T {
  o.userData.live = true;
  return keep(o);
}

// --- common pieces ---

/** A cabinet body with door seams and small handles on its front. */
export function cabinet(k: Kit, parent: THREE.Object3D, w: number, h: number, d: number, body: THREE.Material, doors: number, y = 0, z = 0) {
  k.box(parent, w, h, d, body, 0, y, z);
  const seam = k.mat('black');
  for (let i = 1; i < doors; i++) k.box(parent, 0.006, h - 0.04, 0.004, seam, -w / 2 + (i * w) / doors, y + 0.02, z + d / 2);
  const handle = k.mat('chrome');
  // handles sit by the free edge of each door: pairs open from the middle, a single door on the right
  for (let i = 0; i < doors; i++) {
    const left = -w / 2 + (i * w) / doors;
    const cx = doors === 1 || i % 2 ? left + 0.05 : left + w / doors - 0.05;
    k.box(parent, 0.015, 0.08, 0.02, handle, doors === 1 ? w / 2 - 0.05 : cx, y + h * 0.55, z + d / 2 + 0.01);
  }
}

/** Four square legs under a top. */
export function legs(k: Kit, parent: THREE.Object3D, w: number, d: number, h: number, t: number, mat: THREE.Material, inset = 0.03) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(parent, t, h, t, mat, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2));
}

/**
 * Cloth hanging in folds from its top edge (local y = 0, hanging down), rippled across its width.
 * UVs are in metres, like the walls.
 */
export function cloth(mat: THREE.Material, width: number, height: number, folds: number, depth: number) {
  const geo = new THREE.PlaneGeometry(width, height, folds * 8, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, depth * Math.sin(((x / width + 0.5) * folds * 2 - 0.5) * Math.PI));
    pos.setY(i, pos.getY(i) - height / 2);
    uv.setXY(i, uv.getX(i) * width, uv.getY(i) * height);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** A cast-iron radiator under a window: a row of fins. */
export function radiator(k: Kit, x: number, z: number, facing: Facing, width: number) {
  const g = k.at(x, z, facing);
  const iron = k.paint(0xd4cfc2, 0.45);
  const n = Math.max(4, Math.round(width / 0.09));
  for (let i = 0; i < n; i++) k.box(g, 0.07, 0.55, 0.09, iron, -width / 2 + (i + 0.5) * (width / n), 0.12, 0.08);
  k.cyl(g, 0.012, 0.12, iron, -width / 2 + 0.04, 0, 0.08, 6);
  k.cyl(g, 0.012, 0.12, iron, width / 2 - 0.04, 0, 0.08, 6);
  return g;
}

/** A ventilation grille high on a wall: a frame and slanted louvres over a dark duct. */
export function vent(k: Kit, x: number, z: number, facing: Facing, y: number) {
  const g = k.at(x, z, facing, y);
  // materials every build already has: a grille adds no draw calls
  const plastic = k.mat('paper');
  const [w, h] = [0.22, 0.22];
  k.box(g, w, 0.025, 0.025, plastic, 0, h / 2 - 0.025, 0.0125);
  k.box(g, w, 0.025, 0.025, plastic, 0, -h / 2, 0.0125);
  k.box(g, 0.025, h - 0.05, 0.025, plastic, -w / 2 + 0.0125, -h / 2 + 0.025, 0.0125);
  k.box(g, 0.025, h - 0.05, 0.025, plastic, w / 2 - 0.0125, -h / 2 + 0.025, 0.0125);
  k.box(g, w - 0.05, h - 0.05, 0.004, k.fabric('#4a3b2c'), 0, -h / 2 + 0.025, 0.004);
  for (let i = 0; i < 5; i++) k.box(g, w - 0.05, 0.006, 0.018, plastic, 0, -h / 2 + 0.045 + i * 0.033, 0.012).rotation.x = -0.5;
  return g;
}
