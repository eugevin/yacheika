import { DOORWAYS, ROOM_BY_ID, WALL_T, canStand, doorRect, doorSide, inCell, inRect, onSide, roomAt, type Doorway, type RoomId } from './map.ts';
import { ALONE_M } from './rules.ts';

/**
 * Walking the cell room by room, for whatever the game moves by itself: the extra resident on a
 * client (src/stranger.ts), the chaser on the server. The cell's rooms make a tree joined by its
 * doorways; a walker heads for the doorway into the next room on the way, crosses it, and slides
 * round furniture and door leaves where it can't go straight (canStand).
 */

export interface Pt {
  x: number;
  z: number;
}

/** Doorways one can walk through inside the cell: not the pantry, not the blast doors. */
export const PASSES = DOORWAYS.filter((d): d is Doorway & { b: RoomId } => !d.closed && d.b !== 'back' && d.b !== 'forward');

/** Rooms joined by an open doorway. */
export function adjacent(a: RoomId, b: RoomId) {
  return PASSES.some((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a));
}

/** The rooms to walk through from one room to another, both included (breadth first: the cell is a tree). */
export function route(from: RoomId, to: RoomId): RoomId[] {
  const prev = new Map<RoomId, RoomId | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift()!;
    if (r === to) break;
    for (const d of PASSES) {
      const next = d.a === r ? d.b : d.b === r ? d.a : null;
      if (next && !prev.has(next)) {
        prev.set(next, r);
        queue.push(next);
      }
    }
  }
  const path: RoomId[] = [];
  for (let r: RoomId | null | undefined = to; r; r = prev.get(r)) path.unshift(r);
  return path[0] === from ? path : [from];
}

/** A point just inside `room` in front of the doorway between it and `other`. */
export function before(room: RoomId, other: RoomId): Pt {
  const d = PASSES.find((p) => (p.a === room && p.b === other) || (p.a === other && p.b === room))!;
  const side = doorSide(d);
  // onSide goes outwards from room a's wall: into a is negative, into b is past the wall
  const out = d.a === room ? -0.45 : WALL_T + 0.45;
  return onSide(ROOM_BY_ID[d.a].rect, side, d.at, out);
}

const DOORS = PASSES.map(doorRect);

/** In a room of the cell or in a doorway between two of them: never past a blast door. */
export function indoors(x: number, z: number) {
  return inCell(x, z) || DOORS.some((r) => inRect(r, x, z));
}

/**
 * Something that walks the cell by itself, `radius` wide. It keeps the far side of a doorway it is
 * crossing until it is in the next room, so it doesn't turn back half way.
 */
export class Walk {
  x: number;
  z: number;
  readonly radius: number;
  private through: (Pt & { room: RoomId }) | null = null;

  constructor(x: number, z: number, radius: number) {
    this.x = x;
    this.z = z;
    this.radius = radius;
  }

  /**
   * Walks up to `dist` metres on the way to `target`, through the doorways between their rooms:
   * straight on, or as close to it as whatever is in the way allows. Never leaves the cell's rooms
   * and doorways. Returns how far it went.
   */
  step(target: Pt, dist: number) {
    const goal = this.waypoint(target);
    const step = Math.min(dist, Math.hypot(goal.x - this.x, goal.z - this.z));
    if (step <= 0) return 0;
    const a = Math.atan2(goal.x - this.x, goal.z - this.z);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const x = this.x + Math.sin(a + turn) * step;
      const z = this.z + Math.cos(a + turn) * step;
      if (!indoors(x, z) || !canStand(x, z, this.radius)) continue;
      [this.x, this.z] = [x, z];
      return step;
    }
    return 0;
  }

  /** Where to head for next on the way to `target`. */
  private waypoint(target: Pt): Pt {
    const from = roomAt(this.x, this.z)?.id;
    if (this.through) {
      if (from === this.through.room) this.through = null;
      else return this.through;
    }
    const to = roomAt(target.x, target.z)?.id;
    if (!from || !to || from === to) return target;
    const path = route(from, to);
    if (path.length < 2) return target;
    const door = before(from, path[1]);
    if (Math.hypot(door.x - this.x, door.z - this.z) > 0.2) return door;
    this.through = { ...before(path[1], from), room: path[1] };
    return this.through;
  }
}

/**
 * Whether a player at `me` is alone (docs/DESIGN.md: the alone anomalies): nobody else who is in
 * the cell stands within ALONE_M of them in the same room or one next to it. Only meaningful in
 * the cell itself: in a vestibule nobody is alone.
 */
export function alone(me: Pt, others: Pt[]) {
  const mine = roomAt(me.x, me.z)?.id;
  if (!mine) return false;
  return !others.some((o) => {
    const theirs = roomAt(o.x, o.z)?.id;
    if (!theirs || Math.hypot(o.x - me.x, o.z - me.z) >= ALONE_M) return false;
    return theirs === mine || adjacent(theirs, mine);
  });
}
