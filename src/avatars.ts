import * as THREE from 'three';
import { EYE_H, exitAt, loopPose, stairDepth } from '../shared/map.ts';
import type { PlayerInfo } from '../shared/protocol.ts';
import { Character } from './character.ts';
import type { Beam } from './flashlight.ts';
import type { Eye } from './gaze.ts';
import { STEP_LEN } from './player.ts';
import { shimmer } from './morok.ts';
import { Stranger } from './stranger.ts';
import type { World } from './world/index.ts';

const MARK_LIFE = 4;
/** How far a head turned to us by an anomaly may go: further than a neck should. */
const GAZE_TURN = 2;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Avatar {
  info: PlayerInfo;
  /** The resident as they joined. */
  own: Character;
  /** The one shown: `own`, or a stand-in for one cycle (AvatarOverrides.look). */
  char: Character;
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** Voice level 0..1, measured locally from their audio. */
  talk: number;
  seen: boolean;
  /** Distance walked since the last footstep. */
  stride: number;
  /** How bright their flashlight shines, 0..1. */
  beam: number;
}

/** Other players as residents in their gear, smoothed between position updates. */
export class Avatars {
  readonly root = new THREE.Group();
  private list = new Map<number, Avatar>();
  private marks: { obj: THREE.Group; age: number }[] = [];
  /** Heads that turn to us this cycle (AvatarOverrides.gaze). */
  private gaze = new Set<number>();
  /** One more resident, this cycle only (AvatarOverrides.extra). */
  private stranger: Stranger | null = null;
  /** Called when another player takes a step, derived from how far their avatar moved. */
  onStep: ((x: number, z: number, run: boolean) => void) | null = null;

  add(info: PlayerInfo) {
    this.remove(info.id);
    const char = new Character(info);
    char.root.visible = false;
    this.root.add(char.root);
    this.list.set(info.id, { info, own: char, char, target: new THREE.Vector3(), yaw: 0, pitch: 0, talk: 0, seen: false, stride: 0, beam: 0 });
  }

  remove(id: number) {
    const a = this.list.get(id);
    if (!a) return;
    this.root.remove(a.char.root);
    a.char.dispose();
    if (a.own !== a.char) a.own.dispose();
    this.list.delete(id);
  }

  clear() {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  info(id: number) {
    return this.list.get(id)?.info;
  }

  get all() {
    return [...this.list.values()].map((a) => a.info);
  }

  /** The extra resident, if this cycle has one: for the duty log and the countdown, never for the roster. */
  get extra(): PlayerInfo | null {
    return this.stranger && { id: 0, ...this.stranger.look };
  }

  setPos(id: number, x: number, z: number, yaw: number, pitch: number, beam = 0) {
    const a = this.list.get(id);
    if (!a) return;
    a.target.set(x, stairDepth(x, z), z);
    a.yaw = yaw;
    a.pitch = pitch;
    a.beam = beam / 255;
    if (!a.seen) {
      a.char.root.position.copy(a.target);
      a.seen = a.char.root.visible = true;
    }
  }

  setTalk(levels: Map<number, number>) {
    for (const [id, a] of this.list) a.talk = levels.get(id) ?? 0;
  }

  /**
   * New cycle. 'loop': avatars in an exit zone are carried through the loop exactly like our own
   * camera, so they don't blink; 'stay' (the way out after the last floor): they stay where they
   * are. Everyone else is hidden until their next position in this cycle.
   */
  loop(mode: 'loop' | 'stay' | 'spawn') {
    for (const a of this.list.values()) {
      if (mode === 'stay' && exitAt(a.target.x, a.target.z)) continue;
      const pose = mode === 'loop' ? loopPose(a.target.x, a.target.z, a.yaw) : null;
      if (!pose) {
        a.seen = a.char.root.visible = false;
        continue;
      }
      a.target.set(pose.x, 0, pose.z);
      a.char.root.position.copy(a.target);
      a.yaw = a.char.root.rotation.y = pose.yaw;
    }
  }

  /**
   * What the new cycle's anomaly does to the avatars (World.avatars): the stand-ins of the last one
   * go and the residents come back as they joined. A morok's stand-in shimmers like any morok.
   */
  override(w: World) {
    const o = w.avatars;
    this.gaze = new Set(o.gaze);
    if (this.stranger) {
      this.root.remove(this.stranger.char.root);
      this.stranger.dispose();
    }
    this.stranger = o.extra && new Stranger(o.extra, STEP_LEN, (x, z, run) => this.onStep?.(x, z, run));
    if (this.stranger) this.root.add(this.stranger.char.root);
    for (const [id, a] of this.list) {
      const look = o.look.get(id);
      if (a.char === a.own && !look) {
        a.char.headYaw = 0;
        continue;
      }
      const next = look ? new Character(look) : a.own;
      next.root.position.copy(a.char.root.position);
      next.root.rotation.y = a.char.root.rotation.y;
      next.root.visible = a.char.root.visible;
      next.headYaw = 0;
      this.root.remove(a.char.root);
      if (a.char !== a.own) a.char.dispose();
      this.root.add(next.root);
      a.char = next;
      if (look && w.morok === 'sight') shimmer(w, [next.root]);
    }
  }

  /** Where each teammate looks from, for anomalies that care who sees what (gaze.ts). */
  eyes() {
    const list: Eye[] = [];
    for (const a of this.list.values()) {
      if (!a.char.root.visible) continue;
      const p = a.char.root.position;
      // where they really look, not where the smoothed body has turned to yet
      list.push({ x: p.x, y: p.y + EYE_H, z: p.z, yaw: a.yaw, pitch: a.pitch });
    }
    return list;
  }

  /** Teammates' flashlights, from their hands at about chest height, where they look (flashlight.ts). */
  beams(): Beam[] {
    const list: Beam[] = [];
    for (const a of this.list.values()) {
      if (!a.char.root.visible || a.beam <= 0) continue;
      const p = a.char.root.position;
      list.push({ x: p.x, y: p.y + EYE_H - 0.3, z: p.z, yaw: a.yaw, pitch: a.pitch, k: a.beam });
    }
    return list;
  }

  /** Head positions for spatial voice. */
  heads() {
    const m = new Map<number, THREE.Vector3>();
    for (const [id, a] of this.list) m.set(id, a.char.root.position.clone().setY(a.char.root.position.y + EYE_H));
    return m;
  }

  mark(x: number, y: number, z: number, color: string) {
    const obj = new THREE.Group();
    const c = new THREE.Color(color);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
    );
    obj.add(dot, ring);
    obj.position.set(x, y, z);
    obj.renderOrder = 10;
    this.root.add(obj);
    this.marks.push({ obj, age: 0 });
  }

  /** Takes each avatar's light from where it stands. */
  light(probe: (x: number, z: number, out: Character['probe']) => void) {
    for (const a of this.list.values()) if (a.char.root.visible) probe(a.char.root.position.x, a.char.root.position.z, a.char.probe);
    const s = this.stranger?.char;
    if (s) probe(s.root.position.x, s.root.position.z, s.probe);
  }

  /** `eye`: the camera, for heads that turn to it. */
  update(dt: number, t: number, eye: THREE.Vector3) {
    const k = 1 - Math.exp(-dt * 12);
    for (const a of this.list.values()) {
      const pos = a.char.root.position;
      const [px, pz] = [pos.x, pos.z];
      pos.lerp(a.target, k);
      let moved = Math.hypot(pos.x - px, pos.z - pz);
      // big jumps are respawns, not walking
      if (moved >= 0.5) moved = 0;
      if (a.seen && (a.stride += moved) >= STEP_LEN) {
        a.stride -= STEP_LEN;
        this.onStep?.(pos.x, pos.z, moved / dt > 3.4);
      }
      let d = a.yaw - a.char.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.char.root.rotation.y += d * k;
      let pitch = a.pitch;
      if (this.gaze.has(a.info.id)) {
        // the head turns to us whatever the body does, and keeps up as we move
        const head = pos.y + EYE_H;
        const turn = Math.atan2(-(eye.x - pos.x), -(eye.z - pos.z)) - a.char.root.rotation.y;
        const want = THREE.MathUtils.clamp(wrap(turn), -GAZE_TURN, GAZE_TURN);
        a.char.headYaw += (want - a.char.headYaw) * Math.min(1, dt * 4);
        pitch = Math.atan2(eye.y - head, Math.hypot(eye.x - pos.x, eye.z - pos.z));
      }
      a.char.animate(dt, t, moved, pitch, a.talk);
    }
    if (this.stranger) {
      const people = [{ x: eye.x, z: eye.z }];
      for (const a of this.list.values()) if (a.char.root.visible) people.push(a.char.root.position);
      this.stranger.update(dt, t, people);
    }
    this.marks = this.marks.filter((m) => {
      m.age += dt;
      const ring = m.obj.children[1] as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      ring.scale.setScalar(1 + (m.age % 1) * 1.5);
      ring.material.opacity = 0.35 * (1 - (m.age % 1)) * (1 - m.age / MARK_LIFE);
      if (m.age < MARK_LIFE) return true;
      this.root.remove(m.obj);
      m.obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      return false;
    });
  }
}
