import { FURNITURE_BLOCKERS } from './furniture.ts';

/**
 * The cell (ячейка) in metres, seen from above (x to the right, z down the page):
 *
 *          back vestibule (north of the landing)
 *   landing ── floor corridor (25.6 m, runs +x) ── end window
 *                                   │ door of flat 49
 *                          pantry ─ hall
 *                       bath, wc ─ passage ─ kitchen
 *                                   │
 *               bedroom ──────── living room (walk-through)
 *                  │
 *   forward ─── loggia
 *   vestibule (west of the loggia)
 *
 * Rooms are rectangles that never touch: between neighbours lies a wall WALL_T thick, and a doorway
 * is a walkable rectangle bridging that gap. The side rooms (pantry, bath, wc, kitchen) are off the
 * main path and have to be checked on purpose.
 */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const WALL_T = 0.12;
export const EYE_H = 1.65;
export const PLAYER_R = 0.3;

export type RoomId =
  | 'landing'
  | 'corridor'
  | 'hall'
  | 'pantry'
  | 'passage'
  | 'bath'
  | 'wc'
  | 'kitchen'
  | 'living'
  | 'bedroom'
  | 'loggia';
export type FloorKind = 'metlakh' | 'concrete' | 'linoleum-parquet' | 'linoleum' | 'parquet-herringbone' | 'parquet' | 'tile';
export type WallKind =
  | 'paint-green'
  | 'paint-blue'
  | 'wallpaper-rhombus'
  | 'wallpaper-flowers'
  | 'wallpaper-stripes'
  | 'tile-half'
  | 'tile'
  | 'whitewash'
  | 'loggia';
/** A side of a room: n is its z0 wall, s z1, w x0, e x1. */
export type Side = 'n' | 's' | 'w' | 'e';

export interface Window {
  side: Side;
  /** Centre along the wall (world x for n/s, world z for w/e). */
  at: number;
  width: number;
  sill: number;
  top: number;
}

export interface Room {
  id: RoomId;
  rect: Rect;
  height: number;
  floor: FloorKind;
  walls: WallKind;
  windows: Window[];
}

const room = (id: RoomId, x0: number, z0: number, w: number, d: number, height: number, floor: FloorKind, walls: WallKind, windows: Window[] = []): Room => ({
  id,
  rect: { x0, x1: x0 + w, z0, z1: z0 + d },
  height,
  floor,
  walls,
  windows,
});

const T = WALL_T;
export const ROOMS: Room[] = [
  room('landing', 0, 0, 3, 3, 2.7, 'metlakh', 'paint-green'),
  room('corridor', 3 + T, 0, 25.6, 3, 2.7, 'concrete', 'paint-blue', [{ side: 'e', at: 1.5, width: 1.3, sill: 0.9, top: 2.3 }]),
  room('hall', 23.5, 3 + T, 2.4, 3, 2.5, 'linoleum-parquet', 'wallpaper-rhombus'),
  room('pantry', 25.9 + T, 3 + T, 1.2, 1.4, 2.5, 'linoleum', 'whitewash'),
  room('passage', 24.3, 6.12 + T, 1.3, 4, 2.5, 'linoleum-parquet', 'wallpaper-rhombus'),
  room('bath', 24.18 - 1.9, 6.24, 1.9, 1.8, 2.5, 'tile', 'tile'),
  room('wc', 24.18 - 1.1, 8.04 + T, 1.1, 1.6, 2.5, 'tile', 'tile'),
  room('kitchen', 25.6 + T, 6.24, 3, 3, 2.5, 'linoleum', 'tile-half', [{ side: 'e', at: 7.74, width: 1.3, sill: 0.85, top: 2.2 }]),
  room('living', 22.5, 10.24 + T, 6.22, 5.5, 2.5, 'parquet-herringbone', 'wallpaper-flowers', [{ side: 'e', at: 13.11, width: 1.6, sill: 0.85, top: 2.2 }]),
  room('bedroom', 22.38 - 4, 10.36, 4, 4.5, 2.5, 'parquet', 'wallpaper-stripes', [{ side: 'w', at: 12.2, width: 1.3, sill: 0.85, top: 2.2 }]),
  room('loggia', 22.38 - 4, 14.86 + T, 4, 1.8, 2.5, 'concrete', 'loggia', [{ side: 's', at: 20.68, width: 3.2, sill: 1.0, top: 2.3 }]),
];
export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<RoomId, Room>;

export type Exit = 'back' | 'forward';

/**
 * Each exit opens into a Z-shaped vestibule. In its own frame u runs across the doorway and v
 * runs into the vestibule, and the shape is identical under a half turn about MID_CENTER:
 *
 *     v=0   doorway
 *           LEG1 (u -0.8..0.8)
 *     v=3.4 ┌──────── MID ────────┐
 *     v=5.0 └──────────────── LEG2 (u 5.2..6.8)
 *     v=8.4                    dead end
 *
 * When a cycle resolves, everyone standing in the middle of either vestibule is carried to the
 * matching spot of the back vestibule, turned by that half turn (see loopPose). The view doesn't
 * change, but what was ahead is now LEG1 of the back vestibule: walking on leads into the landing
 * of the next cycle. The back vestibule is also where a cycle starts.
 */
export const VEST_HALF_W = 0.8;
export const VEST_H = 2.7;
export const VEST_DOOR_H = 2.1;
export const LEG1 = { u0: -0.8, u1: 0.8, v0: 0, v1: 3.4 };
export const MID = { u0: -0.8, u1: 6.8, v0: 3.4, v1: 5.0 };
export const LEG2 = { u0: 5.2, u1: 6.8, v0: 5.0, v1: 8.4 };
export const MID_CENTER = { u: 3, v: 4.2 };
/**
 * Whoever stands here when a cycle resolves is carried on seamlessly; anywhere else in a vestibule
 * the exit still counts, but the next cycle comes behind a fade. It is the part of MID from which
 * neither the doorway nor the dead end can be seen (sight past the LEG1 corner needs
 * u < 1.6 * v / 3.4 - 0.8), so the jump can't be noticed. Symmetric about MID_CENTER, like
 * everything else.
 */
export const ZONE = { u0: 1.6, u1: 4.4, v0: 3.4, v1: 5.0 };

type LocalRect = typeof LEG1;

export interface Frame {
  /** Doorway centre, on the vestibule side of the wall. */
  ox: number;
  oz: number;
  /** Unit vector into the vestibule. */
  fx: number;
  fz: number;
  /** Unit vector of +u. Chosen as (fz, -fx), the same turn three.js rotation.y gives local +x. */
  rx: number;
  rz: number;
}

function frame(ox: number, oz: number, fx: number, fz: number): Frame {
  return { ox, oz, fx, fz, rx: fz, rz: -fx };
}

/** Where a vestibule leaves a room: which room, which wall, and the doorway centre along it. */
export const EXIT_DOORS: Record<Exit, { room: RoomId; side: Side; at: number }> = {
  back: { room: 'landing', side: 'n', at: 1.5 },
  forward: { room: 'loggia', side: 'w', at: 15.88 },
};

const OUT: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const OPPOSITE_SIDE: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' };

/** Point on a room's wall: `at` along it, `out` metres outwards from the room's floor edge. */
export function onSide(r: Rect, side: Side, at: number, out = 0) {
  const [dx, dz] = OUT[side];
  if (side === 'n' || side === 's') return { x: at, z: (side === 'n' ? r.z0 : r.z1) + dz * out };
  return { x: (side === 'w' ? r.x0 : r.x1) + dx * out, z: at };
}

function exitFrame(exit: Exit) {
  const d = EXIT_DOORS[exit];
  const o = onSide(ROOM_BY_ID[d.room].rect, d.side, d.at, WALL_T);
  const [fx, fz] = OUT[d.side];
  return frame(o.x, o.z, fx, fz);
}

export const VESTIBULES: Record<Exit, Frame> = { back: exitFrame('back'), forward: exitFrame('forward') };

export function toWorld(f: Frame, u: number, v: number) {
  return { x: f.ox + u * f.rx + v * f.fx, z: f.oz + u * f.rz + v * f.fz };
}

export function toLocal(f: Frame, x: number, z: number) {
  const dx = x - f.ox;
  const dz = z - f.oz;
  return { u: dx * f.rx + dz * f.rz, v: dx * f.fx + dz * f.fz };
}

function worldRect(f: Frame, r: LocalRect): Rect {
  const a = toWorld(f, r.u0, r.v0);
  const b = toWorld(f, r.u1, r.v1);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}

/**
 * A doorway between two rooms, or between a room and an exit vestibule. Its walkable rectangle is
 * the stretch of wall between them, `width` wide around `at`.
 */
export interface Doorway {
  a: RoomId;
  b: RoomId | Exit;
  kind: 'entrance' | 'door' | 'glass' | 'opening' | 'hermo';
  at: number;
  width: number;
  height: number;
  /** Shut by default (the pantry): drawn with its leaf in the opening, not walkable. */
  closed?: boolean;
  /**
   * An open door: its leaf stands at a right angle to the wall inside room `into`, hinged on the
   * `hinge` end of the opening (-1 the lower coordinate, 1 the higher). Players walk around it.
   */
  leaf?: { into: RoomId; hinge: -1 | 1 };
}

export const DOORWAYS: Doorway[] = [
  { a: 'landing', b: 'back', kind: 'hermo', at: EXIT_DOORS.back.at, width: 2 * VEST_HALF_W, height: VEST_DOOR_H, leaf: { into: 'landing', hinge: -1 } },
  { a: 'landing', b: 'corridor', kind: 'opening', at: 1.5, width: 1.4, height: 2.2 },
  { a: 'corridor', b: 'hall', kind: 'entrance', at: 24.7, width: 0.9, height: 2.05, leaf: { into: 'hall', hinge: 1 } },
  { a: 'hall', b: 'pantry', kind: 'door', at: 3.8, width: 0.8, height: 2.0, closed: true },
  { a: 'hall', b: 'passage', kind: 'opening', at: 24.95, width: 0.9, height: 2.0 },
  { a: 'passage', b: 'bath', kind: 'door', at: 7.1, width: 0.8, height: 2.0, leaf: { into: 'bath', hinge: -1 } },
  { a: 'passage', b: 'wc', kind: 'door', at: 8.95, width: 0.8, height: 2.0, leaf: { into: 'wc', hinge: 1 } },
  { a: 'passage', b: 'kitchen', kind: 'door', at: 7.65, width: 0.9, height: 2.0, leaf: { into: 'kitchen', hinge: -1 } },
  { a: 'passage', b: 'living', kind: 'glass', at: 24.95, width: 0.9, height: 2.0, leaf: { into: 'living', hinge: 1 } },
  { a: 'living', b: 'bedroom', kind: 'door', at: 11.9, width: 0.9, height: 2.0, leaf: { into: 'bedroom', hinge: -1 } },
  { a: 'bedroom', b: 'loggia', kind: 'glass', at: 20.9, width: 0.8, height: 2.1, leaf: { into: 'bedroom', hinge: -1 } },
  { a: 'loggia', b: 'forward', kind: 'hermo', at: EXIT_DOORS.forward.at, width: 2 * VEST_HALF_W, height: VEST_DOOR_H, leaf: { into: 'loggia', hinge: -1 } },
];

const isExit = (id: RoomId | Exit): id is Exit => id === 'back' || id === 'forward';

/** Which wall of room `a` a doorway is in. */
export function doorSide(d: Doorway): Side {
  if (isExit(d.b)) return EXIT_DOORS[d.b].side;
  const a = ROOM_BY_ID[d.a].rect;
  const b = ROOM_BY_ID[d.b].rect;
  if (b.x0 >= a.x1) return 'e';
  if (b.x1 <= a.x0) return 'w';
  return b.z0 >= a.z1 ? 's' : 'n';
}

/** The stretch of wall a doorway cuts through, from room a's floor edge to the other side. */
export function doorRect(d: Doorway): Rect {
  const r = ROOM_BY_ID[d.a].rect;
  const side = doorSide(d);
  const p = onSide(r, side, d.at);
  const q = onSide(r, side, d.at, WALL_T);
  const h = d.width / 2;
  if (side === 'n' || side === 's') return { x0: d.at - h, x1: d.at + h, z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) };
  return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: d.at - h, z1: d.at + h };
}

/** A name for a doorway's leaf. */
export const leafKey = (d: Doorway) => `leaf:${d.a}-${d.b}`;

/** Thickness of a door leaf; hermetic doors are steel slabs. */
export const leafThickness = (d: Doorway) => (d.kind === 'hermo' ? 0.1 : 0.045);

/**
 * Where an open leaf stands: hinge point on the wall face of its room, and the unit vector it runs
 * along (straight into the room).
 */
export function leafPose(d: Doorway) {
  const leaf = d.leaf!;
  const intoA = leaf.into === d.a;
  const side = intoA ? doorSide(d) : OPPOSITE_SIDE[doorSide(d)];
  const r = ROOM_BY_ID[leaf.into].rect;
  const hinge = onSide(r, side, d.at + (leaf.hinge * d.width) / 2);
  const [ox, oz] = OUT[side];
  return { x: hinge.x, z: hinge.z, dx: -ox, dz: -oz };
}

/** Floor taken by an open leaf, a little inside the opening edge so the jamb stays clear. */
export function leafRect(d: Doorway): Rect {
  const p = leafPose(d);
  const t = leafThickness(d);
  const alongX = p.dx !== 0;
  const end = { x: p.x + p.dx * d.width, z: p.z + p.dz * d.width };
  // the leaf sits just inside the opening, on the side of its hinge
  const s = -(d.leaf!.hinge as number);
  const off = alongX ? { x: 0, z: s * (t / 2 + 0.01) } : { x: s * (t / 2 + 0.01), z: 0 };
  return {
    x0: Math.min(p.x, end.x) + off.x - (alongX ? 0 : t / 2),
    x1: Math.max(p.x, end.x) + off.x + (alongX ? 0 : t / 2),
    z0: Math.min(p.z, end.z) + off.z - (alongX ? t / 2 : 0),
    z1: Math.max(p.z, end.z) + off.z + (alongX ? t / 2 : 0),
  };
}

/** Where nobody can stand: open door leaves and furniture standing on the floor. */
export const BLOCKERS: Rect[] = [...DOORWAYS.filter((d) => d.leaf).map(leafRect), ...FURNITURE_BLOCKERS];

export const WALKABLE = [
  ...ROOMS.filter((r) => r.id !== 'pantry').map((r) => r.rect),
  ...DOORWAYS.filter((d) => !d.closed).map(doorRect),
  ...Object.values(VESTIBULES).flatMap((f) => [LEG1, MID, LEG2].map((r) => worldRect(f, r))),
];

/**
 * After the last floor the dead end of each vestibule opens onto a flight of stairs down, one
 * storey (docs/DESIGN.md, 7.3). In the vestibule's frame: a short landing past the dead end, the
 * flight, a landing at the bottom. Nobody can get there before: canStand only lets players onto it
 * when asked to, in the cell built for the win.
 */
export const STAIRS = { u0: LEG2.u0, u1: LEG2.u1, v0: LEG2.v1, flight0: 9.0, flight1: 13.8, v1: 15.4, drop: 2.8, steps: 16 };
const STAIR_RECTS = Object.values(VESTIBULES).map((f) => worldRect(f, { u0: STAIRS.u0, u1: STAIRS.u1, v0: STAIRS.v0, v1: STAIRS.v1 }));

/** The concrete skin of a vestibule's gallery stands this far out around its inside. */
export const GALLERY_SKIN = 0.3;

/**
 * The bedroom and loggia windows look out where the forward gallery leaves the house. Seen from
 * there, a Z-shaped tube hanging in mid-air would give the loop away, so it runs inside a wing of
 * the house: a plain block from the ground to the roof around the whole gallery and its stairs,
 * clear of their skin. Its east side is the house's west facade.
 */
export const WING: Rect = (() => {
  const gap = GALLERY_SKIN + 0.3;
  const r = worldRect(VESTIBULES.forward, { u0: MID.u0 - gap, u1: MID.u1 + gap, v0: 0, v1: STAIRS.v1 + gap });
  return { ...r, x1: ROOM_BY_ID.bedroom.rect.x0 };
})();

/** Floor height on the stairs at local v: the top of the tread there. */
export function stairFloor(v: number) {
  if (v <= STAIRS.flight0) return 0;
  if (v >= STAIRS.flight1) return -STAIRS.drop;
  const run = (STAIRS.flight1 - STAIRS.flight0) / STAIRS.steps;
  return -(STAIRS.drop / STAIRS.steps) * Math.ceil((v - STAIRS.flight0) / run - 1e-9);
}

/** How far below the cell's floor a point is: a smooth slope over the flight, for walking eyes and feet; 0 off the stairs. */
export function stairDepth(x: number, z: number) {
  for (const f of Object.values(VESTIBULES)) {
    const { u, v } = toLocal(f, x, z);
    if (u < STAIRS.u0 || u > STAIRS.u1 || v < STAIRS.v0 || v > STAIRS.v1) continue;
    return -STAIRS.drop * Math.min(1, Math.max(0, (v - STAIRS.flight0) / (STAIRS.flight1 - STAIRS.flight0)));
  }
  return 0;
}

const inLocal = (r: LocalRect, u: number, v: number) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

/** Which exit's vestibule a point is in, if any: anywhere past the blast door counts as taking that exit. */
export function tambourAt(x: number, z: number): Exit | null {
  for (const exit of ['back', 'forward'] as const) {
    const { u, v } = toLocal(VESTIBULES[exit], x, z);
    if (v > 0 && [LEG1, MID, LEG2].some((r) => inLocal(r, u, v))) return exit;
  }
  return null;
}

/** Which exit's zone a point stands in, if any: from there the next cycle comes seamlessly. */
export function exitAt(x: number, z: number): Exit | null {
  for (const exit of ['back', 'forward'] as const) {
    const { u, v } = toLocal(VESTIBULES[exit], x, z);
    if (inLocal(ZONE, u, v)) return exit;
  }
  return null;
}

/** Inside one of the cell's rooms (not a vestibule). */
export function inCell(x: number, z: number) {
  return ROOMS.some((r) => inRect(r.rect, x, z));
}

export function roomAt(x: number, z: number): Room | null {
  return ROOMS.find((r) => inRect(r.rect, x, z)) ?? null;
}

/** Yaw as used by the camera: yaw 0 looks down -z. */
const dirOf = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawOf = (x: number, z: number) => Math.atan2(-x, -z);

/**
 * Where a pose in an exit zone continues in the next cycle: the same spot of the back vestibule
 * after a half turn about its centre. Null outside the zones.
 */
export function loopPose(x: number, z: number, yaw: number) {
  const exit = exitAt(x, z);
  if (!exit) return null;
  const from = VESTIBULES[exit];
  const to = VESTIBULES.back;
  const { u, v } = toLocal(from, x, z);
  const d = dirOf(yaw);
  const du = d.x * from.rx + d.z * from.rz;
  const dv = d.x * from.fx + d.z * from.fz;
  const p = toWorld(to, 2 * MID_CENTER.u - u, 2 * MID_CENTER.v - v);
  // the half turn flips the local direction
  return { x: p.x, z: p.z, yaw: yawOf(-du * to.rx - dv * to.fx, -du * to.rz - dv * to.fz) };
}

export function inRect(r: Rect, x: number, z: number) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Squared distance from a point to a rectangle; 0 inside it. */
function dist2(r: Rect, x: number, z: number) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return dx * dx + dz * dz;
}

/**
 * Everything that isn't floor, as rectangles: the walkable rectangles' edges cut the plane into a
 * grid, and every cell outside them (plus the world beyond the grid) is solid. Edges closer than a
 * micron are one edge, so a rounding sliver between a room and its doorway doesn't block it.
 */
function solidOf(floor: Rect[]): Rect[] {
  const cuts = (vs: number[]) => {
    const out: number[] = [];
    for (const v of [...vs].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v);
    return out;
  };
  const xs = cuts(floor.flatMap((r) => [r.x0, r.x1]));
  const zs = cuts(floor.flatMap((r) => [r.z0, r.z1]));
  const far = 1e4;
  const solid: Rect[] = [
    { x0: -far, x1: xs[0], z0: -far, z1: far },
    { x0: xs[xs.length - 1], x1: far, z0: -far, z1: far },
    { x0: -far, x1: far, z0: -far, z1: zs[0] },
    { x0: -far, x1: far, z0: zs[zs.length - 1], z1: far },
  ];
  for (let i = 0; i + 1 < xs.length; i++) {
    // runs of solid cells down each column, merged into one rectangle
    let start = -1;
    for (let j = 0; j <= zs.length - 1; j++) {
      const free = j < zs.length - 1 && floor.some((r) => inRect(r, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2));
      const open = j < zs.length - 1 && !free;
      if (open && start < 0) start = j;
      if (!open && start >= 0) {
        solid.push({ x0: xs[i], x1: xs[i + 1], z0: zs[start], z1: zs[j] });
        start = -1;
      }
    }
  }
  return solid;
}

let solidCell: Rect[] | null = null;
let solidWon: Rect[] | null = null;

/** Everything that isn't floor as rectangles (walls, the world around), with the stairs open or not. */
export function walls(stairs = false) {
  return stairs ? (solidWon ??= solidOf([...WALKABLE, ...STAIR_RECTS])) : (solidCell ??= solidOf(WALKABLE));
}

/**
 * A player circle fits if it overlaps no wall, furniture or open leaf; the stairs count as floor
 * once they are open. Exact, not sampled: between a few points on the rim a door jamb or a 4.5 cm
 * leaf would slip in and catch the player.
 */
export function canStand(x: number, z: number, r = PLAYER_R, stairs = false) {
  const solid = walls(stairs);
  const r2 = r * r;
  return !solid.some((b) => dist2(b, x, z) < r2) && !BLOCKERS.some((b) => dist2(b, x, z) < r2);
}

/** Fresh start (game start, a missed cycle): in the back vestibule, facing the way into the landing. */
export function spawnPoint(index: number) {
  const slots = [[3, 4.2], [2.3, 3.8], [3.7, 4.6], [2.3, 4.6], [3.7, 3.8], [3, 3.8]];
  const [u, v] = slots[index % slots.length];
  const f = VESTIBULES.back;
  const p = toWorld(f, u, v);
  return { x: p.x, z: p.z, yaw: yawOf(-f.rx, -f.rz) };
}
