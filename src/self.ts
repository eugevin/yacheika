import * as THREE from 'three';
import { stairDepth } from '../shared/map.ts';
import { Character, type Look } from './character.ts';
import { LAYERS } from './world/layers.ts';

/**
 * How far behind the camera our own body stands: looking down, the eye is just in front of the
 * chest, not inside it.
 */
const BACK = 0.25;

/**
 * Our own resident, in the same clothes and gear the others see. Two of them: the one our camera
 * sees, without a head (we look out of it), set a little back; and a whole one on the `self` layer,
 * which only the mirrors draw (world/mirror.ts), standing exactly where we are. The camera's `far`
 * layer keeps the first out of the mirrors.
 */
export class SelfBody {
  readonly root = new THREE.Group();
  private readonly body: Character;
  private readonly whole: Character;
  private readonly last = new THREE.Vector2(NaN, NaN);

  constructor(look: Look) {
    this.body = new Character(look);
    this.body.hideHead();
    this.body.root.traverse((o) => o.layers.set(LAYERS.far));
    this.whole = new Character(look);
    this.whole.root.traverse((o) => o.layers.set(LAYERS.self));
    this.root.add(this.body.root, this.whole.root);
  }

  /** One frame: follow the walker, and walk as far as it walked (big jumps are respawns). */
  update(dt: number, t: number, x: number, z: number, yaw: number, pitch: number) {
    let moved = Math.hypot(x - this.last.x, z - this.last.y);
    if (!(moved < 0.5)) moved = 0;
    this.last.set(x, z);
    const y = stairDepth(x, z);
    this.whole.root.position.set(x, y, z);
    this.body.root.position.set(x + Math.sin(yaw) * BACK, y, z + Math.cos(yaw) * BACK);
    for (const c of [this.body, this.whole]) {
      c.root.rotation.y = yaw;
      c.animate(dt, t, moved, pitch, 0);
    }
  }

  /** Takes the light from where we stand. */
  light(probe: (x: number, z: number, out: Character['probe']) => void) {
    const p = this.whole.probe;
    probe(this.last.x, this.last.y, p);
    this.body.probe.base.copy(p.base);
    this.body.probe.idx.copy(p.idx);
    this.body.probe.w.copy(p.w);
  }

  dispose() {
    this.body.dispose();
    this.whole.dispose();
  }
}
