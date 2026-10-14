import type * as THREE from 'three';
import type { World } from './world/index.ts';

/**
 * Someone's eyes: where they are and where they look, in the camera's convention (yaw 0 looks
 * towards -z, pitch up is positive). Ours come from the camera, a teammate's from their avatar
 * and the yaw and pitch in their last position.
 */
export interface Eye {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/**
 * Half the view, in radians, that counts as looking at something: a little inside the camera's
 * (72° high, about 105° wide on a wide screen), so a thing at the very edge isn't "seen".
 */
export const CONE = { h: 0.75, v: 0.5 };

/** Our own eye: the camera (player.ts turns it yaw first, then pitch). */
export function eyeOf(camera: THREE.Camera): Eye {
  const p = camera.position;
  return { x: p.x, y: p.y, z: p.z, yaw: camera.rotation.y, pitch: camera.rotation.x };
}

/** Whether we or any teammate (World.teammates) see the point. */
export function anyoneSees(w: World, camera: THREE.Camera, x: number, y: number, z: number) {
  return [eyeOf(camera), ...w.teammates].some((e) => sees(w, e, x, y, z));
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Whether the eye sees a point: inside its cone and with nothing solid in between (walls and
 * furniture as the bake knows them, World.clear). Cheap enough to ask a few times a second for
 * every player.
 */
export function sees(w: World, eye: Eye, x: number, y: number, z: number, cone = CONE) {
  const dx = x - eye.x;
  const dz = z - eye.z;
  if (Math.abs(wrap(Math.atan2(-dx, -dz) - eye.yaw)) > cone.h) return false;
  if (Math.abs(Math.atan2(y - eye.y, Math.hypot(dx, dz)) - eye.pitch) > cone.v) return false;
  return w.clear(eye.x, eye.y, eye.z, x, y, z);
}
