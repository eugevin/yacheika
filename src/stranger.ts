import { DOORWAYS, ROOM_BY_ID, WALL_T, canStand, doorSide, inCell, onSide, roomAt, type Doorway, type RoomId } from '../shared/map.ts';
import { Character, type Look } from './character.ts';

/** Where it waits for the group: in the corner of the landing, by the stencil. */
const START = { x: 2.4, z: 2.4 };
/** It sets off after whoever it follows once they are further than this. */
const FAR = 2.4;
const WALK = 1.35;
const RUN = 2.6;
const RADIUS = 0.25;

type Pt = { x: number; z: number };

/** Doorways one can walk through inside the cell: not the pantry, not the blast doors. */
const PASSES = DOORWAYS.filter((d): d is Doorway & { b: RoomId } => !d.closed && d.b !== 'back' && d.b !== 'forward');

/** The rooms to walk through from one room to another, both included (breadth first: the cell is a tree). */
function route(from: RoomId, to: RoomId): RoomId[] {
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
function before(room: RoomId, other: RoomId): Pt {
  const d = PASSES.find((p) => (p.a === room && p.b === other) || (p.a === other && p.b === room))!;
  const side = doorSide(d);
  // onSide goes outwards from room a's wall: into a is negative, into b is past the wall
  const out = d.a === room ? -0.45 : WALL_T + 0.45;
  return onSide(ROOM_BY_ID[d.a].rect, side, d.at, out);
}

/**
 * One more resident walking with the group (the "extra" anomaly): waits on the landing, then keeps
 * a couple of metres behind whoever is nearest, room by room through the doorways, and stops in
 * the doorway when the group leaves the cell. Never speaks. Moves only on this screen.
 */
export class Stranger {
  readonly char: Character;
  readonly look: Look;
  private x = START.x;
  private z = START.z;
  private yaw = Math.PI / 2;
  /** The far side of a doorway it is walking through, kept until it is in the next room. */
  private through: (Pt & { room: RoomId }) | null = null;
  private stride = 0;
  private readonly stepLen: number;
  private readonly onStep: (x: number, z: number, run: boolean) => void;

  constructor(look: Look, stepLen: number, onStep: (x: number, z: number, run: boolean) => void) {
    this.look = look;
    this.stepLen = stepLen;
    this.onStep = onStep;
    this.char = new Character(look);
    this.char.root.position.set(this.x, 0, this.z);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(1, 0, 0, 0, 0);
  }

  get position() {
    return this.char.root.position;
  }

  /** `people`: where everyone in the group stands (ourselves included). */
  update(dt: number, t: number, people: Pt[]) {
    const here = { x: this.x, z: this.z };
    const near = people
      .filter((p) => inCell(p.x, p.z))
      .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
    let moved = 0;
    let run = false;
    const dist = near ? Math.hypot(near.x - here.x, near.z - here.z) : 0;
    // close through a wall is still far: it comes round through the doorways
    const apart = near && roomAt(near.x, near.z) && roomAt(this.x, this.z) && roomAt(near.x, near.z) !== roomAt(this.x, this.z);
    // someone left the cell: it doesn't follow past the blast door, it stays where it is
    if (near && (dist > FAR || apart)) {
      const goal = this.waypoint(near);
      run = dist > 6;
      const step = Math.min((run ? RUN : WALK) * dt, Math.hypot(goal.x - this.x, goal.z - this.z));
      const a = Math.atan2(goal.x - this.x, goal.z - this.z);
      // straight on, or as close to it as whatever is in the way allows
      for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const x = this.x + Math.sin(a + turn) * step;
        const z = this.z + Math.cos(a + turn) * step;
        if (!canStand(x, z, RADIUS)) continue;
        [this.x, this.z] = [x, z];
        break;
      }
      moved = Math.hypot(this.x - here.x, this.z - here.z);
      if (moved > 1e-4) this.yaw = Math.atan2(-(this.x - here.x), -(this.z - here.z));
    } else if (near) {
      // standing: it turns to the one it follows
      this.yaw = Math.atan2(-(near.x - this.x), -(near.z - this.z));
    }
    const root = this.char.root;
    root.position.set(this.x, 0, this.z);
    let d = this.yaw - root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    root.rotation.y += d * Math.min(1, dt * 6);
    if ((this.stride += moved) >= this.stepLen) {
      this.stride -= this.stepLen;
      this.onStep(this.x, this.z, run);
    }
    this.char.animate(dt, t, moved, -0.1, 0);
  }

  /** Where to head for next on the way to `target`: through the doorways between their rooms. */
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

  dispose() {
    this.char.dispose();
  }
}

/** Surnames for the extra resident's card. */
export const STRANGER_NAMES = ['Сидоров', 'Морозов', 'Лебедев', 'Тихонов', 'Зайцев', 'Беляев', 'Гусев', 'Филиппов'];
