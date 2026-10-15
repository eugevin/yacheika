import * as THREE from 'three';
import { DOORWAYS, ROOM_BY_ID, ROOMS, doorRect, doorSide, tambourAt, type Doorway } from '../shared/map.ts';
import { BEAMS, BEAM_OUTER, BEAM_REACH, MAX_BEAMS, VEST_ROOM, kelvin, roomIndex } from './world/lighting.ts';

/** Each squeeze of the handle adds this much charge; a full charge runs down in FADE_S seconds. */
const SQUEEZE = 0.13;
const FADE_S = 20;
/** Holding the key squeezes the handle this often, seconds. */
const SQUEEZE_EVERY = 0.32;
/** Taps faster than this don't count: the handle has to come back. */
const SQUEEZE_MIN = 0.12;
/** A dynamo flashlight's bulb: dim and warm. Candela at full charge, set by measurement (AGENTS.md). */
const BEAM_CD = 10;
const BEAM_COLOR = kelvin(2600);

/**
 * The dynamo flashlight, «жучок»: pumped with a key, held or tapped, it charges a little with each
 * squeeze and fades over about 20 s. Everyone has one; it only works in a blackout, where it is the
 * only light that isn't baked (world/lighting.ts, BEAMS).
 */
export class Dynamo {
  charge = 0;
  private held = false;
  private timer = 0;
  private since = 1;
  /** Called on every squeeze, for its whirr. */
  onSqueeze: (() => void) | null = null;

  press(down: boolean) {
    if (down && !this.held && this.since >= SQUEEZE_MIN) this.squeeze();
    this.held = down;
    this.timer = SQUEEZE_EVERY;
  }

  /** Release the handle (lost focus, a menu): the key's up may never come. */
  release() {
    this.held = false;
  }

  private squeeze() {
    this.charge = Math.min(1, this.charge + SQUEEZE);
    this.since = 0;
    this.onSqueeze?.();
  }

  /** How bright the beam is, 0..1; `usable`: there is a blackout, otherwise it isn't even taken out. */
  update(dt: number, usable: boolean) {
    this.since += dt;
    if (!usable) {
      this.held = false;
      this.charge = 0;
      return 0;
    }
    if (this.held && (this.timer -= dt) <= 0) {
      this.timer = SQUEEZE_EVERY;
      this.squeeze();
    }
    this.charge = Math.max(0, this.charge - dt / FADE_S);
    // the bulb comes up quickly with the first squeezes and browns out at the end
    return Math.min(1, this.charge * 2.2) ** 1.2;
  }
}

/** Someone's beam: where it starts and where it looks, in the camera's convention, and how bright. */
export interface Beam {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  k: number;
}

/** A doorway as a rectangle across the middle of its wall: a corner and two edges, world space. */
interface Gap {
  d: Doorway;
  o: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  centre: THREE.Vector3;
  /** Room numbers either side (roomIndex): a, and b or the vestibule. */
  a: number;
  b: number;
}

const GAPS: Gap[] = DOORWAYS.filter((d) => !d.closed).map((d) => {
  const r = doorRect(d);
  const side = doorSide(d);
  const across = side === 'n' || side === 's';
  const o = across ? new THREE.Vector3(r.x0, 0, (r.z0 + r.z1) / 2) : new THREE.Vector3((r.x0 + r.x1) / 2, 0, r.z0);
  const u = across ? new THREE.Vector3(r.x1 - r.x0, 0, 0) : new THREE.Vector3(0, 0, r.z1 - r.z0);
  const v = new THREE.Vector3(0, d.height, 0);
  const b = d.b === 'back' || d.b === 'forward' ? VEST_ROOM : ROOMS.indexOf(ROOM_BY_ID[d.b]);
  return { d, o, u, v, centre: o.clone().addScaledVector(u, 0.5).addScaledVector(v, 0.5), a: ROOMS.indexOf(ROOM_BY_ID[d.a]), b };
});

const p = new THREE.Vector3();
const dir = new THREE.Vector3();
const to = new THREE.Vector3();
const e = new THREE.Euler(0, 0, 0, 'YXZ');

/** Everyone's flashlights this frame, ours first. */
let current: Beam[] = [];

/** The beams of this frame; the shader gets them for each camera that renders (beamsFor). */
export function setBeams(beams: Beam[]) {
  current = beams;
}

/**
 * Sets the shader's beams relative to the camera about to render: the main one, a mirror's, an
 * environment map's (Scene.onBeforeRender). Each lights its own room and, through the doorway it
 * points into most, the next one.
 */
export function beamsFor(camera: THREE.Camera) {
  const beams = current;
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;
  let n = 0;
  for (const b of beams) {
    if (b.k <= 0.01 || n >= MAX_BEAMS) continue;
    const exit = tambourAt(b.x, b.z);
    const room = exit ? VEST_ROOM : roomIndex(b.x, b.z);
    if (room < 0) continue;
    p.set(b.x, b.y, b.z);
    dir.set(0, 0, -1).applyEuler(e.set(b.pitch, b.yaw, 0));
    // the doorway of this room the beam is most turned to, if it is in the beam at all
    let best: Gap | null = null;
    let cos = BEAM_OUTER - 0.15;
    for (const g of GAPS) {
      const mine = exit ? g.d.b === exit : g.a === room || g.b === room;
      if (!mine) continue;
      to.subVectors(g.centre, p);
      const len = to.length();
      if (len > BEAM_REACH) continue;
      const c = to.dot(dir) / len;
      if (c > cos) [best, cos] = [g, c];
    }
    BEAMS.uBeamPos.value[n].copy(p).applyMatrix4(view);
    BEAMS.uBeamDir.value[n].copy(dir).transformDirection(view);
    BEAMS.uBeamColor.value[n].set(BEAM_COLOR.r, BEAM_COLOR.g, BEAM_COLOR.b).multiplyScalar(BEAM_CD * b.k);
    BEAMS.uBeamRoom.value[n] = room;
    BEAMS.uBeamNext.value[n] = best ? (best.a === room ? best.b : best.a) : -2;
    if (best) {
      const o = BEAMS.uDoorO.value[n].copy(best.o).applyMatrix4(view);
      BEAMS.uDoorU.value[n].copy(best.o).add(best.u).applyMatrix4(view).sub(o);
      BEAMS.uDoorV.value[n].copy(best.o).add(best.v).applyMatrix4(view).sub(o);
    }
    n++;
  }
  BEAMS.uBeamN.value = n;
}
