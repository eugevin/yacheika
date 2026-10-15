import { inCell, roomAt } from '../shared/map.ts';
import { seesPoint, type Viewer } from '../shared/sight.ts';
import { Walk, indoors, type Pt } from '../shared/walk.ts';

/** Faster than a walk (2.6 m/s), slower than a run. */
const SPEED = 3.1;
/** It catches whoever it comes this close to. */
const REACH = 0.7;
const RADIUS = 0.3;
/** Where it may appear, at the far end of the flat: the bedroom's corners and the loggia. */
const LAIRS: Pt[] = [
  { x: 18.8, z: 10.9 },
  { x: 18.8, z: 12.8 },
  { x: 18.9, z: 16.3 },
  { x: 20.4, z: 16.3 },
];

export interface Mover extends Viewer, Pt {
  id: number;
  name: string;
}

/**
 * The chaser (docs/DESIGN.md, the anomaly «Преследователь»): a figure at the far end of the flat
 * that, once somebody walks into the living room, comes for the nearest player through the
 * doorways, but only while nobody looks at it (shared/sight.ts, with everyone's positions and yaws);
 * seen, it stands still. It never goes past a blast door. Run by the server, drawn by every client.
 */
export class Chaser {
  readonly walk: Walk;
  yaw = Math.PI / 2;
  awake = false;
  moving = false;

  constructor(seed: number) {
    const lair = LAIRS[seed % LAIRS.length];
    this.walk = new Walk(lair.x, lair.z, RADIUS);
  }

  /**
   * One tick: `players` are those whose positions belong to this cycle. Returns whom it caught, if
   * anyone.
   */
  tick(dt: number, players: Mover[]): Mover | null {
    const inside = players.filter((p) => inCell(p.x, p.z) || indoors(p.x, p.z));
    if (!this.awake) this.awake = players.some((p) => roomAt(p.x, p.z)?.id === 'living');
    this.moving = false;
    if (!this.awake || !inside.length) return null;
    const w = this.walk;
    const caught = inside.find((p) => Math.hypot(p.x - w.x, p.z - w.z) < REACH);
    if (caught) return caught;
    // looked at, it stands like a piece of furniture
    if (players.some((p) => seesPoint(p, w.x, w.z))) return null;
    const near = inside.reduce((a, b) => (Math.hypot(a.x - w.x, a.z - w.z) <= Math.hypot(b.x - w.x, b.z - w.z) ? a : b));
    const [x, z] = [w.x, w.z];
    const moved = w.step(near, SPEED * dt);
    if (moved > 1e-4) {
      this.moving = true;
      this.yaw = Math.atan2(-(w.x - x), -(w.z - z));
    }
    return null;
  }
}
