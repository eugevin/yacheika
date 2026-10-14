import * as THREE from 'three';
import { EYE_H, exitAt, loopPose, stairDepth } from '../shared/map.ts';
import type { PlayerInfo } from '../shared/protocol.ts';
import { Character } from './character.ts';
import { STEP_LEN } from './player.ts';

const MARK_LIFE = 4;

interface Avatar {
  info: PlayerInfo;
  char: Character;
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** Voice level 0..1, measured locally from their audio. */
  talk: number;
  seen: boolean;
  /** Distance walked since the last footstep. */
  stride: number;
}

/** Other players as residents in their gear, smoothed between position updates. */
export class Avatars {
  readonly root = new THREE.Group();
  private list = new Map<number, Avatar>();
  private marks: { obj: THREE.Group; age: number }[] = [];
  /** Called when another player takes a step, derived from how far their avatar moved. */
  onStep: ((x: number, z: number, run: boolean) => void) | null = null;

  add(info: PlayerInfo) {
    this.remove(info.id);
    const char = new Character(info);
    char.root.visible = false;
    this.root.add(char.root);
    this.list.set(info.id, { info, char, target: new THREE.Vector3(), yaw: 0, pitch: 0, talk: 0, seen: false, stride: 0 });
  }

  remove(id: number) {
    const a = this.list.get(id);
    if (!a) return;
    this.root.remove(a.char.root);
    a.char.dispose();
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

  setPos(id: number, x: number, z: number, yaw: number, pitch: number) {
    const a = this.list.get(id);
    if (!a) return;
    a.target.set(x, stairDepth(x, z), z);
    a.yaw = yaw;
    a.pitch = pitch;
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
  }

  update(dt: number, t: number) {
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
      a.char.animate(dt, t, moved, a.pitch, a.talk);
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
