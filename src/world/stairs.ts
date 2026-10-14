import * as THREE from 'three';
import { GALLERY_SKIN, LEG1, LEG2, MID, STAIRS, VEST_H, VESTIBULES, stairFloor, type Exit, type Frame } from '../../shared/map.ts';
import { signTexture } from '../textures.ts';
import { box, flat, plane } from './geometry.ts';
import { fittings, makeLamp, type Lamp } from './lamps.ts';
import { useBaked, type Space } from './lighting.ts';
import { wallPiece, type Skin } from './shell.ts';
import { TAMBOUR_LAMP } from './tambour.ts';

/** Ceiling over the flight runs parallel to it, this high over the treads. */
const HEADROOM = VEST_H;
const run = (STAIRS.flight1 - STAIRS.flight0) / STAIRS.steps;
const rise = STAIRS.drop / STAIRS.steps;
/** The slope of the flight, metres down per metre along. */
const SLOPE = STAIRS.drop / (STAIRS.flight1 - STAIRS.flight0);
/** Smooth line of the flight at local v: through the nosings. */
const line = (v: number) => -SLOPE * Math.min(STAIRS.flight1 - STAIRS.flight0, Math.max(0, v - STAIRS.flight0));

export interface StairMaterials {
  concrete: THREE.Material;
  rail: THREE.Material;
  posts: THREE.Material;
  door: THREE.Material;
}

/**
 * The way out, built only for the cell after the last floor (docs/DESIGN.md, 7.3): past the dead end
 * of each vestibule, which is hidden for it (tambour.ts), a landing, sixteen steps down and a
 * landing with a lamp and the door out. Built in the vestibule's frame (x = u, z = v), in the
 * vestibule's own finish, and lit on its own (stairSpace): the vestibule itself bakes exactly as
 * always, so nothing changes in view of the exit zone when the stairs appear.
 */
export function buildStairs(parent: THREE.Object3D, exit: Exit, skin: Skin, outside: THREE.Material, mats: StairMaterials, channel: number, fit: ReturnType<typeof fittings>): Lamp {
  const f = VESTIBULES[exit];
  const g = new THREE.Group();
  g.position.set(f.ox, 0, f.oz);
  g.rotation.y = Math.atan2(f.fx, f.fz);
  g.userData.stairs = exit;
  parent.add(g);
  const { u0, u1, v0, flight0, flight1, v1, drop } = STAIRS;
  const low = new THREE.Group();
  low.position.y = -drop;
  g.add(low);

  // the top landing, as high as the vestibule
  flat(g, u0, v0, u1, flight0, 0, true, skin.floor, skin.cell);
  flat(g, u0, v0, u1, flight0, VEST_H, false, skin.ceiling, skin.cell);
  wallPiece(g, skin, 'px', u0, v0, flight0, 0, VEST_H);
  wallPiece(g, skin, 'nx', u1, v0, flight0, 0, VEST_H);
  // the steps: solid blocks down to below the bottom landing, a centimetre clear of the walls
  for (let i = 0; i < STAIRS.steps; i++) {
    const top = -(i + 1) * rise;
    const b = box(u1 - u0 - 0.02, top + drop + 0.1, run, mats.concrete);
    b.position.set((u0 + u1) / 2, (top - drop - 0.1) / 2, flight0 + (i + 0.5) * run);
    g.add(b);
  }
  // the drop from the landing to the first tread
  const riser = plane(u1 - u0 - 0.02, rise, mats.concrete);
  riser.position.set((u0 + u1) / 2, -rise / 2, flight0);
  g.add(riser);
  // walls and ceiling along the flight, sheared to its slope; the green dado follows the steps
  for (const [facing, at] of [['px', u0], ['nx', u1]] as const) {
    slanted(g, skin.dado!.mat, facing, at, -0.2, skin.dado!.h, skin.cell);
    slanted(g, skin.wall, facing, at, skin.dado!.h, HEADROOM, skin.cell);
    if (skin.dado!.line) slanted(g, skin.dado!.line, facing, at, skin.dado!.h - 0.0125, skin.dado!.h + 0.0125, 4, 0.002);
  }
  const ceiling = plane(u1 - u0, Math.hypot(flight1 - flight0, drop), skin.ceiling, skin.cell);
  ceiling.rotation.x = Math.PI / 2 + Math.atan(SLOPE);
  ceiling.position.set((u0 + u1) / 2, HEADROOM - drop / 2, (flight0 + flight1) / 2);
  g.add(ceiling);

  // the bottom landing, one storey down, with the lamp and the door out
  flat(low, u0, flight1, u1, v1, 0, true, skin.floor, skin.cell);
  flat(low, u0, flight1, u1, v1, VEST_H, false, skin.ceiling, skin.cell);
  wallPiece(low, skin, 'px', u0, flight1, v1, 0, VEST_H);
  wallPiece(low, skin, 'nx', u1, flight1, v1, 0, VEST_H);
  wallPiece(low, skin, 'nz', v1, u0, u1, 0, VEST_H);
  const door = box(0.9, 2.0, 0.06, mats.door);
  door.position.set((u0 + u1) / 2, 1.0, v1 - 0.05);
  low.add(door);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.2),
    useBaked(new THREE.MeshStandardMaterial({ roughness: 0.6, map: signTexture(['ВЫХОД'], { w: 256, h: 84, bg: '#ece6d2', fg: '#5a1712', font: 'bold 52px sans-serif', border: '#5a1712' }) })),
  );
  sign.position.set((u0 + u1) / 2, 2.2, v1 - 0.025);
  sign.rotation.y = Math.PI;
  low.add(sign);
  const lamp = makeLamp(low, { ...TAMBOUR_LAMP, x: (u0 + u1) / 2, z: (flight1 + v1) / 2, ceiling: VEST_H }, null, channel, fit);

  // a wooden handrail on steel posts along the outer side
  const ru = u1 - 0.12;
  const len = Math.hypot(flight1 - flight0, drop);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), mats.rail);
  rail.rotation.x = Math.PI / 2 + Math.atan(SLOPE);
  rail.position.set(ru, 0.9 - drop / 2, (flight0 + flight1) / 2);
  g.add(rail);
  for (let i = 0; i < STAIRS.steps; i += 2) {
    const v = flight0 + (i + 0.5) * run;
    const y = stairFloor(v);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9 + line(v) - y, 6), mats.posts);
    post.position.set(ru, y + (0.9 + line(v) - y) / 2, v);
    g.add(post);
  }

  // outside: the gallery's concrete skin goes on and down, black within
  const S = GALLERY_SKIN;
  const out: Skin = { wall: outside, floor: outside, ceiling: outside, base: null, cell: 3 };
  wallPiece(g, out, 'nx', u0 - S, v0, v1 + S, -drop - S, VEST_H + S);
  wallPiece(g, out, 'px', u1 + S, v0, v1 + S, -drop - S, VEST_H + S);
  wallPiece(g, out, 'pz', v1 + S, u0 - S, u1 + S, -drop - S, VEST_H + S);
  flat(g, u0 - S, v0, u1 + S, v1 + S, -drop - S, false, outside, 3);
  flat(g, u0 - S, v0, u1 + S, v1 + S, VEST_H + S, true, outside, 3);
  return lamp;
}

/**
 * A strip of side wall along the flight, from `y0` to `y1` above its slope, facing into the stairs
 * from the wall at u = `at`. UVs are in metres, like every wall.
 */
function slanted(parent: THREE.Object3D, mat: THREE.Material, facing: 'px' | 'nx', at: number, y0: number, y1: number, cell = 1, out = 0) {
  const { flight0, flight1 } = STAIRS;
  const len = flight1 - flight0;
  const m = plane(len, y1 - y0, mat, cell);
  const pos = m.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const along = pos.getX(i) + len / 2;
    const y = pos.getY(i) + (y0 + y1) / 2;
    // facing +x the plane's +x has to run towards -v, facing -x towards +v, to face the right way
    const v = facing === 'px' ? flight1 - along : flight0 + along;
    pos.setXYZ(i, at + (facing === 'px' ? out : -out), y + line(v), v);
  }
  m.geometry.computeVertexNormals();
  m.geometry.computeBoundingSphere();
  parent.add(m);
}

/**
 * Where the stairs' light goes: the vestibule and the stairwell, in the vestibule's frame. Lit by
 * its own lamp and the vestibule's, which shines in through the opened end.
 */
export function stairSpace(f: Frame): Space {
  const parts = [LEG1, MID, LEG2];
  const { u0, u1, v0, v1 } = STAIRS;
  const EPS = 1e-6;
  const open = (x: number, y: number, z: number) => {
    const dx = x - f.ox;
    const dz = z - f.oz;
    const u = dx * f.rx + dz * f.rz;
    const v = dx * f.fx + dz * f.fz;
    if (u >= u0 - EPS && u <= u1 + EPS && v >= v0 - EPS && v <= v1 + EPS) {
      const floor = stairFloor(v);
      const ceiling = v <= STAIRS.flight0 ? VEST_H : line(v) + HEADROOM;
      return y > floor - EPS && y < ceiling + EPS;
    }
    if (y < -EPS || y > VEST_H + EPS) return false;
    for (const r of parts) if (u >= r.u0 - EPS && u <= r.u1 + EPS && v >= r.v0 - EPS && v <= r.v1 + EPS) return true;
    return false;
  };
  const area = (u1 - u0) * (v1 - v0);
  return {
    open,
    clear: (ax, ay, az, bx, by, bz) => {
      const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.1);
      for (let i = 1; i < n; i++) if (!open(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, az + ((bz - az) * i) / n)) return false;
      return true;
    },
    room: () => 'vestibule',
    area: () => area,
    skip: () => {},
  };
}
