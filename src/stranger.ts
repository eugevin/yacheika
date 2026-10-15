import { inCell, roomAt } from '../shared/map.ts';
import { Walk, type Pt } from '../shared/walk.ts';
import { Character, type Look } from './character.ts';

/** Where it waits for the group: in the corner of the landing, by the stencil. */
const START = { x: 2.4, z: 2.4 };
/** It sets off after whoever it follows once they are further than this. */
const FAR = 2.4;
const WALK = 1.35;
const RUN = 2.6;
const RADIUS = 0.25;

/**
 * One more resident walking with the group (the "extra" anomaly): waits on the landing, then keeps
 * a couple of metres behind whoever is nearest, room by room through the doorways, and stops in
 * the doorway when the group leaves the cell. Never speaks. Moves only on this screen.
 */
export class Stranger {
  readonly char: Character;
  readonly look: Look;
  private walk = new Walk(START.x, START.z, RADIUS);
  private yaw = Math.PI / 2;
  private stride = 0;
  private readonly stepLen: number;
  private readonly onStep: (x: number, z: number, run: boolean) => void;

  constructor(look: Look, stepLen: number, onStep: (x: number, z: number, run: boolean) => void) {
    this.look = look;
    this.stepLen = stepLen;
    this.onStep = onStep;
    this.char = new Character(look);
    this.char.root.position.set(START.x, 0, START.z);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(1, 0, 0, 0, 0);
  }

  get position() {
    return this.char.root.position;
  }

  /** `people`: where everyone in the group stands (ourselves included). */
  update(dt: number, t: number, people: Pt[]) {
    const w = this.walk;
    const here = { x: w.x, z: w.z };
    const near = people
      .filter((p) => inCell(p.x, p.z))
      .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
    let moved = 0;
    let run = false;
    const dist = near ? Math.hypot(near.x - here.x, near.z - here.z) : 0;
    // close through a wall is still far: it comes round through the doorways
    const apart = near && roomAt(near.x, near.z) && roomAt(w.x, w.z) && roomAt(near.x, near.z) !== roomAt(w.x, w.z);
    // someone left the cell: it doesn't follow past the blast door, it stays where it is
    if (near && (dist > FAR || apart)) {
      run = dist > 6;
      moved = w.step(near, (run ? RUN : WALK) * dt);
      if (moved > 1e-4) this.yaw = Math.atan2(-(w.x - here.x), -(w.z - here.z));
    } else if (near) {
      // standing: it turns to the one it follows
      this.yaw = Math.atan2(-(near.x - w.x), -(near.z - w.z));
    }
    const root = this.char.root;
    root.position.set(w.x, 0, w.z);
    let d = this.yaw - root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    root.rotation.y += d * Math.min(1, dt * 6);
    if ((this.stride += moved) >= this.stepLen) {
      this.stride -= this.stepLen;
      this.onStep(w.x, w.z, run);
    }
    this.char.animate(dt, t, moved, -0.1, 0);
  }

  dispose() {
    this.char.dispose();
  }
}

/** Surnames for the extra resident's card. */
export const STRANGER_NAMES = ['Сидоров', 'Морозов', 'Лебедев', 'Тихонов', 'Зайцев', 'Беляев', 'Гусев', 'Филиппов'];
