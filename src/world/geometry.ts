import * as THREE from 'three';
import type { Side } from '../../shared/map.ts';

/** Which way a wall (or anything hung on it) faces. */
export type Facing = 'px' | 'nx' | 'pz' | 'nz';

export const YAW: Record<Facing, number> = { pz: 0, nz: Math.PI, px: Math.PI / 2, nx: -Math.PI / 2 };
export const NORMAL: Record<Facing, [number, number]> = { pz: [0, 1], nz: [0, -1], px: [1, 0], nx: [-1, 0] };
/** A room's wall on this side faces into the room. */
export const INWARD: Record<Side, Facing> = { n: 'pz', s: 'nz', w: 'px', e: 'nx' };

/**
 * A plane whose UVs are in metres, so repeating textures keep their scale on any size; u0 and v0
 * shift them, so pieces of one wall line up. Planes are split into cells of about `cell` metres: a
 * huge triangle with a vertex right beside the camera interpolates badly (a 42 m wall turns black
 * when standing at its end).
 */
export function plane<M extends THREE.Material>(w: number, h: number, mat: M, cell = 1, u0 = 0, v0 = 0) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(1, Math.ceil(w / cell)), Math.max(1, Math.ceil(h / cell)));
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * w, v0 + uv.getY(i) * h);
  return new THREE.Mesh(geo, mat);
}

/** A small single quad with the texture stretched over it once (signs, pictures). */
export function quad<M extends THREE.Material>(w: number, h: number, mat: M) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

export function box<M extends THREE.Material>(w: number, h: number, d: number, mat: M) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/** Puts an object on a wall at height y; its local +z points out of the wall, `out` metres from it. */
export function mount(parent: THREE.Object3D, obj: THREE.Object3D, x: number, z: number, facing: Facing, y: number, out = 0) {
  const [nx, nz] = NORMAL[facing];
  obj.position.set(x + nx * out, y, z + nz * out);
  obj.rotation.y = YAW[facing];
  parent.add(obj);
  return obj;
}

/** Horizontal rectangle at height y, facing up (floor) or down (ceiling); UVs are world x, z. */
export function flat<M extends THREE.Material>(parent: THREE.Object3D, x0: number, z0: number, x1: number, z1: number, y: number, up: boolean, mat: M, cell = 1) {
  const w = x1 - x0;
  const d = z1 - z0;
  // facing up, the plane's local +y is world -z; facing down, it is world +z
  const m = plane(w, d, mat, cell, x0, up ? -z1 : z0);
  m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  parent.add(m);
  return m;
}
