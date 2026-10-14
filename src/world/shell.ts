import * as THREE from 'three';
import {
  DOORWAYS,
  ROOM_BY_ID,
  ROOMS,
  VEST_H,
  doorRect,
  doorSide,
  leafKey,
  leafPose,
  leafRect,
  onSide,
  type Doorway,
  type Room,
  type RoomId,
  type Side,
} from '../../shared/map.ts';
import { INWARD, YAW, box, flat, plane, type Facing } from './geometry.ts';

/** What a room's surfaces are made of. A dado is the lower band of a wall in another finish. */
export interface Skin {
  wall: THREE.Material;
  dado?: { mat: THREE.Material; h: number; line?: THREE.Material };
  floor: THREE.Material;
  ceiling: THREE.Material;
  base: THREE.Material | null;
  /** Size of the grid surfaces are split into; baked light needs it finer than the default 1 m. */
  cell?: number;
}

const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' };
/** Outer walls are thicker than partitions: this is how deep window reveals go. */
export const REVEAL = 0.3;
const CASING_W = 0.07;
const CEILING_CELL = 0.15;
/** A threshold under a door: how high it stands and how far it reaches over each floor. */
const THRESHOLD_H = 0.018;
const THRESHOLD_OVER = 0.025;

/**
 * One rectangular piece of wall. Along x when facing ±z (fixed = its z), along z when facing ±x
 * (fixed = its x); a0..a1 is the stretch along that axis, y0..y1 its height. UVs continue across
 * pieces of the same wall.
 */
export function wallPiece(parent: THREE.Object3D, skin: Skin, facing: Facing, fixed: number, a0: number, a1: number, y0: number, y1: number) {
  if (a1 - a0 < 1e-4 || y1 - y0 < 1e-4) return;
  const along = (a0 + a1) / 2;
  const alongX = facing === 'pz' || facing === 'nz';
  // the plane's local +x runs +x (pz), -x (nz), -z (px), +z (nx)
  const u0 = facing === 'pz' || facing === 'nx' ? a0 : -a1;
  const put = (m: THREE.Object3D, y: number, out: number) => {
    const n = out * (facing === 'pz' || facing === 'px' ? 1 : -1);
    m.position.set(alongX ? along : fixed + n, y, alongX ? fixed + n : along);
    m.rotation.y = YAW[facing];
    parent.add(m);
  };
  const piece = (mat: THREE.Material, b0: number, b1: number) => {
    if (b1 - b0 > 1e-4) put(plane(a1 - a0, b1 - b0, mat, skin.cell, u0, b0), (b0 + b1) / 2, 0);
  };
  const dado = skin.dado;
  if (dado) {
    piece(dado.mat, y0, Math.min(y1, dado.h));
    piece(skin.wall, Math.max(y0, dado.h), y1);
    if (dado.line && y0 < dado.h && y1 > dado.h) put(plane(a1 - a0, 0.025, dado.line, 4), dado.h, 0.002);
  } else piece(skin.wall, y0, y1);
  if (y0 === 0 && skin.base) put(plane(a1 - a0, 0.08, skin.base, 4), 0.04, 0.006);
}

interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

/** A room's four walls, cut around its doorways and windows, plus its floor and ceiling. */
function roomShell(parent: THREE.Object3D, room: Room, skin: Skin, holes: Hole[][]) {
  const r = room.rect;
  const H = room.height;
  (['n', 's', 'w', 'e'] as const).forEach((side, i) => {
    const alongX = side === 'n' || side === 's';
    const [e0, e1] = alongX ? [r.x0, r.x1] : [r.z0, r.z1];
    const fixed = onSide(r, side, alongX ? r.x0 : r.z0);
    const at = alongX ? fixed.z : fixed.x;
    const cuts = [...new Set([e0, e1, ...holes[i].flatMap((h) => [h.a0, h.a1])])].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [c0, c1] = [cuts[k], cuts[k + 1]];
      const mid = (c0 + c1) / 2;
      const hole = holes[i].find((h) => h.a0 <= mid && mid <= h.a1);
      if (!hole) wallPiece(parent, skin, INWARD[side], at, c0, c1, 0, H);
      else {
        wallPiece(parent, skin, INWARD[side], at, c0, c1, 0, hole.y0);
        wallPiece(parent, skin, INWARD[side], at, c0, c1, hole.y1, H);
      }
    }
  });
  flat(parent, r.x0, r.z0, r.x1, r.z1, 0, true, skin.floor, skin.cell);
  // the ceiling right above a lamp has the steepest light of all: it needs a finer grid
  flat(parent, r.x0, r.z0, r.x1, r.z1, H, false, skin.ceiling, Math.min(skin.cell ?? 1, CEILING_CELL));
}

/**
 * The inside of a doorway: two jambs, the soffit and the floor across the wall. A closed doorway
 * also gets its leaf. Exits finish with the lintel on the vestibule's side.
 */
function doorwayShell(parent: THREE.Object3D, d: Doorway, skin: Skin, casing: THREE.Material, leaves: Leaves, far: Skin | null) {
  const r = doorRect(d);
  const alongX = doorSide(d) === 'n' || doorSide(d) === 's';
  // wallpaper stops at the edge of a doorway: a door's frame lines the whole reveal, and an opening
  // in a papered room is lined the same way. Painted walls go on round the corner. Exits keep the
  // vestibule's skin: both sides of the loop have to match.
  const lined = !far && (d.kind !== 'opening' || !skin.dado);
  const reveal: Skin = lined ? { ...skin, wall: casing, dado: undefined, base: null } : skin;
  if (alongX) {
    wallPiece(parent, reveal, 'px', r.x0, r.z0, r.z1, 0, d.height);
    wallPiece(parent, reveal, 'nx', r.x1, r.z0, r.z1, 0, d.height);
  } else {
    wallPiece(parent, reveal, 'pz', r.z0, r.x0, r.x1, 0, d.height);
    wallPiece(parent, reveal, 'nz', r.z1, r.x0, r.x1, 0, d.height);
  }
  flat(parent, r.x0, r.z0, r.x1, r.z1, 0, true, skin.floor, skin.cell);
  flat(parent, r.x0, r.z0, r.x1, r.z1, d.height, false, reveal.wall, skin.cell);

  const sideA = doorSide(d);
  const depth = Math.min(r.x1 - r.x0, r.z1 - r.z0);
  const g = new THREE.Group();
  const p = onSide(ROOM_BY_ID[d.a].rect, sideA, d.at);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = YAW[INWARD[sideA]];
  parent.add(g);
  // in g, +z points into room a and the wall's far face is at z = -WALL_T

  if (far) {
    // exit: the lintel above the doorway, seen from inside the vestibule
    const lintel = new THREE.Group();
    lintel.position.z = -depth;
    lintel.rotation.y = Math.PI;
    g.add(lintel);
    wallPiece(lintel, far, 'pz', 0, -d.width / 2, d.width / 2, d.height, VEST_H);
  }

  // the threshold: covers the line where one room's floor meets the other's, a little over each.
  // An exit's stops at the wall's far face: the vestibule is baked apart and has to match the other
  // one. Sunk half a centimetre, so its underside doesn't lie in the floor's plane
  const over = far ? 0 : THRESHOLD_OVER;
  const sill = box(d.width, THRESHOLD_H + 0.005, depth + THRESHOLD_OVER + over, casing);
  sill.position.set(0, (THRESHOLD_H - 0.005) / 2, (THRESHOLD_OVER - depth - over) / 2);
  g.add(sill);

  if (d.kind === 'opening') return;
  const thick = d.kind === 'hermo' ? 0.04 : 0.015;
  const cw = d.kind === 'hermo' ? 0.1 : CASING_W;
  // an exit's frame only shows on the room side: on the other it would sit inside the vestibule walls
  for (const [z, turn] of far ? [[0, 0]] : [[0, 0], [-depth, Math.PI]]) {
    const c = new THREE.Group();
    c.position.z = z;
    c.rotation.y = turn;
    // posts stop under the top piece: overlapping, their faces would share a plane and flicker
    for (const s of [-1, 1]) {
      const post = box(cw, d.height, thick, casing);
      post.position.set(s * (d.width / 2 + cw / 2), d.height / 2, thick / 2);
      c.add(post);
    }
    const top = box(d.width + 2 * cw, cw, thick, casing);
    top.position.set(0, d.height + cw / 2, thick / 2);
    c.add(top);
    g.add(c);
  }
  if (d.closed) {
    const slab = box(d.width, d.height, 0.04, leaves.door);
    slab.position.set(0, d.height / 2, -depth / 2);
    const knob = box(0.03, 0.03, 0.12, leaves.handle);
    knob.position.set(d.width / 2 - 0.08, 1.0, 0);
    slab.add(knob);
    slab.name = `door:${d.a}-${d.b}`;
    slab.userData.keep = slab.userData.keepRoot = true;
    knob.userData.keep = true;
    g.add(slab);
  }
  if (d.leaf) parent.add(doorLeaf(d, leaves));
}

/** Materials of door leaves, by kind of doorway. */
export interface Leaves {
  door: THREE.Material;
  entrance: THREE.Material;
  hermo: THREE.Material;
  glass: THREE.Material;
  handle: THREE.Material;
}

/**
 * An open door, standing at a right angle to its wall (map.ts, leafRect). Doors are things a
 * closed-door anomaly will swing, so each is kept as one separate group.
 */
function doorLeaf(d: Doorway, m: Leaves) {
  const r = leafRect(d);
  const g = new THREE.Group();
  g.name = 'leaf';
  g.userData.solid = leafKey(d);
  g.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
  // local x along the leaf, local z across it
  if (r.z1 - r.z0 > r.x1 - r.x0) g.rotation.y = Math.PI / 2;
  const w = Math.max(r.x1 - r.x0, r.z1 - r.z0);
  const t = Math.min(r.x1 - r.x0, r.z1 - r.z0);
  const h = d.height - 0.01;
  const add = (o: THREE.Mesh, x: number, y: number, z = 0) => {
    o.position.set(x, y, z);
    g.add(o);
  };
  if (d.kind === 'glass') {
    const frame = m.door;
    const bar = 0.08;
    add(box(bar, h, t, frame), -w / 2 + bar / 2, h / 2);
    add(box(bar, h, t, frame), w / 2 - bar / 2, h / 2);
    for (const y of [bar / 2 + 0.05, h * 0.42, h - bar / 2]) add(box(w - 2 * bar, y < 0.2 ? bar + 0.1 : bar, t, frame), 0, y);
    for (const [y0, y1] of [[0.18 + bar, h * 0.42 - bar / 2], [h * 0.42 + bar / 2, h - bar]]) add(box(w - 2 * bar, y1 - y0, 0.006, m.glass), 0, (y0 + y1) / 2);
  } else add(box(w, h, t, d.kind === 'hermo' ? m.hermo : d.kind === 'entrance' ? m.entrance : m.door), 0, h / 2);
  // handles on both faces, at the free end: away from the hinge (rotated by a quarter turn, local x is world -z)
  const hinge = leafPose(d);
  const hingeX = g.rotation.y ? -(hinge.z - g.position.z) : hinge.x - g.position.x;
  const free = hingeX > 0 ? -1 : 1;
  for (const s of [-1, 1]) {
    if (d.kind === 'hermo') {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 20), m.handle);
      add(wheel, 0, 1.1, s * (t / 2 + 0.05));
    } else add(box(0.12, 0.025, 0.03, m.handle), free * (w / 2 - 0.1), 1.0, s * (t / 2 + 0.02));
  }
  g.userData.keepRoot = true;
  g.traverse((o) => (o.userData.keep = true));
  return g;
}

/** A window in an outer wall: reveals, a sill board, the frame with a mullion. The yard is behind it (yard.ts). */
function windowShell(parent: THREE.Object3D, room: Room, w: Room['windows'][number], skin: Skin, frameMat: THREE.Material) {
  const g = new THREE.Group();
  const p = onSide(room.rect, w.side, w.at);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = YAW[INWARD[w.side]];
  parent.add(g);
  // in g, +z points into the room and +x along the wall
  const h = w.top - w.sill;
  const my = (w.sill + w.top) / 2;
  const plain: Skin = { ...skin, dado: undefined, base: null };
  const reveal = new THREE.Group();
  g.add(reveal);
  wallPiece(reveal, plain, 'px', -w.width / 2, -REVEAL, 0, w.sill, w.top);
  wallPiece(reveal, plain, 'nx', w.width / 2, -REVEAL, 0, w.sill, w.top);
  flat(reveal, -w.width / 2, -REVEAL, w.width / 2, 0, w.top, false, skin.wall);
  flat(reveal, -w.width / 2, -REVEAL, w.width / 2, 0, w.sill, true, skin.wall);

  // The frame reaches a centimetre into the reveals: faces lying exactly in the reveal planes would
  // fight them for depth and flicker.
  const bar = 0.06;
  const fz = -0.14;
  const sink = 0.01;
  for (const s of [-1, 1]) {
    const post = box(bar + sink, h + 2 * sink, 0.07, frameMat);
    post.position.set(s * (w.width / 2 - bar / 2 + sink / 2), my, fz);
    g.add(post);
  }
  for (const [y, grow] of [[w.sill + bar / 2 - sink / 2, sink], [w.top - bar / 2 + sink / 2, sink], [w.top - 0.5, 0]]) {
    // rails a little shallower than the posts and the mullion: where they cross, no two faces share a plane
    const rail = box(w.width + 2 * sink, bar + grow, 0.064, frameMat);
    rail.position.set(0, y, fz);
    g.add(rail);
  }
  const mullion = box(bar, h, 0.07, frameMat);
  mullion.position.set(0, my, fz);
  g.add(mullion);
  // the board's top a centimetre above the reveal's floor: level with it, the two flickered in turn
  const sill = box(w.width + 0.12, 0.03, 0.26, frameMat);
  sill.position.set(0, w.sill + 0.01 - 0.015, -0.05);
  g.add(sill);
}

export interface ShellMaterials {
  skins: Record<RoomId, Skin>;
  /** The vestibules' skin: exit doorways are finished in it. */
  vestibule: Skin;
  casing: THREE.Material;
  hermo: THREE.Material;
  windowFrame: THREE.Material;
  leaves: Leaves;
}

/** Every room, doorway and window of the cell. */
export function buildShell(parent: THREE.Object3D, m: ShellMaterials) {
  const holes = new Map(ROOMS.map((r) => [r.id, [[], [], [], []] as Hole[][]]));
  const sideIndex = { n: 0, s: 1, w: 2, e: 3 } as const;
  const addHole = (id: RoomId, side: Side, at: number, width: number, y0: number, y1: number) =>
    holes.get(id)![sideIndex[side]].push({ a0: at - width / 2, a1: at + width / 2, y0, y1 });

  for (const d of DOORWAYS) {
    addHole(d.a, doorSide(d), d.at, d.width, 0, d.height);
    const exit = d.b === 'back' || d.b === 'forward';
    if (!exit) addHole(d.b as RoomId, OPPOSITE[doorSide(d)], d.at, d.width, 0, d.height);
    const skin = exit ? m.vestibule : m.skins[d.a];
    doorwayShell(parent, d, skin, d.kind === 'hermo' ? m.hermo : m.casing, m.leaves, exit ? m.vestibule : null);
  }
  for (const room of ROOMS) {
    for (const w of room.windows) {
      addHole(room.id, w.side, w.at, w.width, w.sill, w.top);
      windowShell(parent, room, w, m.skins[room.id], m.windowFrame);
    }
    roomShell(parent, room, m.skins[room.id], holes.get(room.id)!);
  }
}
