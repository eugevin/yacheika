import * as THREE from 'three';
import { EYE_H, PLAYER_R, canStand, stairDepth } from '../shared/map.ts';

const WALK = 2.6;
const RUN = 4.2;
const SENSITIVITY = 0.0022;
/** Metres per footstep; the head bob dips once per step. */
export const STEP_LEN = 0.85;

/** First-person walker: pointer-lock mouse look, WASD by physical key so any layout works. */
export class Walker {
  x = 0;
  z = 0;
  yaw = Math.PI;
  pitch = 0;
  /** Mouse sensitivity multiplier, from the duty log. */
  sensitivity = 1;
  /** The stairs down are open (the cell after the last floor). */
  stairs = false;
  private keys = new Set<string>();
  private bob = 0;
  private bobAmp = 0;
  /** Called on every footstep we take. */
  onStep: ((run: boolean) => void) | null = null;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      const k = SENSITIVITY * this.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * k, -1.45, 1.45);
    });
  }

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.keys.clear();
  }

  update(dt: number, active: boolean) {
    let f = 0;
    let s = 0;
    if (active) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    }
    const len = Math.hypot(f, s);
    if (len > 0) {
      const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = run ? RUN : WALK;
      const [px, pz] = [this.x, this.z];
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = ((-sin * f + cos * s) / len) * speed * dt;
      const dz = ((-cos * f - sin * s) / len) * speed * dt;
      // slide along walls: try each axis on its own; if already caught in something (placed there),
      // walk out freely as long as the feet stay on the floor
      const fits = (x: number, z: number) => canStand(x, z, PLAYER_R, this.stairs);
      const free = (x: number, z: number) => fits(x, z) || (!fits(this.x, this.z) && canStand(x, z, 0.05, this.stairs));
      if (free(this.x + dx, this.z)) this.x += dx;
      if (free(this.x, this.z + dz)) this.z += dz;
      // walking into a wall doesn't make footsteps
      const before = Math.floor(this.bob / Math.PI);
      this.bob += (Math.hypot(this.x - px, this.z - pz) * Math.PI) / STEP_LEN;
      if (Math.floor(this.bob / Math.PI) > before) this.onStep?.(run);
    }
    this.bobAmp += ((len > 0 ? 1 : 0) - this.bobAmp) * Math.min(1, dt * 8);
    // the lowest point of the bob lands on the footstep
    const bobY = -Math.abs(Math.cos(this.bob)) * 0.04 * this.bobAmp;
    this.camera.position.set(this.x, EYE_H + bobY + stairDepth(this.x, this.z), this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
