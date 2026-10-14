import * as THREE from 'three';
import { GALLERY_SKIN, LEG1, LEG2, MID, MID_CENTER, VEST_H, VESTIBULES } from '../../shared/map.ts';
import { box, flat } from './geometry.ts';
import { fittings, makeLamp, type Lamp, type LampSpec } from './lamps.ts';
import { wallPiece, type Skin } from './shell.ts';

/** The cable channel runs in the corner of wall and ceiling. */
const CABLE = 0.04;
const CABLE_Y = VEST_H - CABLE / 2;

/** The vestibule's single lamp in a cage, hanging from the centre: dim, warm. */
export const TAMBOUR_LAMP: Omit<LampSpec, 'x' | 'z' | 'ceiling'> = { style: 'grate', kelvin: 2700, power: 6 };

/**
 * Both exit vestibules (layout in shared/map.ts). One half, LEG1 plus the near half of MID, is built
 * once in the vestibule's own frame (x = u, z = v); the four halves of the two vestibules are
 * instances of it, the second half of each turned about MID_CENTER. The halves therefore share
 * every vertex, texture offset and baked light value, and differ only in their instance matrix:
 * that is what lets the loop swap one for the other unnoticed, pixel for pixel. Nothing asymmetric
 * may go inside: no signs, no wear on one side only. The only things outside the halves sit exactly
 * on the centre (the lamp, the cable across the ceiling) or can't be seen from the exit zone (the
 * dead end).
 *
 * Both vestibules share one light channel. Baking runs on the back vestibule's first half (its
 * matrix is in userData.bakeMatrix) and serves all four.
 */
export function buildTambours(
  parent: THREE.Object3D,
  skin: Skin,
  cableMat: THREE.Material,
  outside: THREE.Material,
  channel: number,
  mats: ReturnType<typeof fittings>,
): { lamps: Lamp[]; follow: (camera: THREE.Camera) => void; deadEnds: THREE.Object3D[] } {
  const out: Skin = { wall: outside, floor: outside, ceiling: outside, base: null, cell: 3 };
  const S = GALLERY_SKIN;
  const lo = -S;
  const hi = VEST_H + S;
  const cu = MID_CENTER.u;

  const half = new THREE.Group();
  for (const [x0, z0, x1, z1] of [
    [LEG1.u0, LEG1.v0, LEG1.u1, LEG1.v1],
    [MID.u0, MID.v0, cu, MID.v1],
  ]) {
    flat(half, x0, z0, x1, z1, 0, true, skin.floor, skin.cell);
    flat(half, x0, z0, x1, z1, VEST_H, false, skin.ceiling, skin.cell);
  }
  wallPiece(half, skin, 'px', LEG1.u0, LEG1.v0, MID.v1, 0, VEST_H);
  wallPiece(half, skin, 'nx', LEG1.u1, LEG1.v0, MID.v0, 0, VEST_H);
  wallPiece(half, skin, 'pz', MID.v0, LEG1.u1, cu, 0, VEST_H);
  wallPiece(half, skin, 'nz', MID.v1, MID.u0, cu, 0, VEST_H);
  // cable channel along the outer wall of the bend, up to the middle where it crosses to the lamp
  const along = box(CABLE, CABLE, MID.v1 - LEG1.v0, cableMat);
  along.position.set(LEG1.u0 + CABLE / 2, CABLE_Y, (LEG1.v0 + MID.v1) / 2);
  const across = box(cu - MID.u0, CABLE, CABLE, cableMat);
  across.position.set((MID.u0 + cu) / 2, CABLE_Y, MID.v1 - CABLE / 2);
  half.add(along, across);
  // the gallery's outer skin, seen from the windows of the cell
  wallPiece(half, out, 'nx', LEG1.u0 - S, LEG1.v0, MID.v1 + S, lo, hi);
  wallPiece(half, out, 'px', LEG1.u1 + S, LEG1.v0, MID.v0 - S, lo, hi);
  wallPiece(half, out, 'nz', MID.v0 - S, LEG1.u1 + S, cu, lo, hi);
  wallPiece(half, out, 'pz', MID.v1 + S, MID.u0 - S, cu, lo, hi);
  flat(half, LEG1.u0 - S, LEG1.v0, LEG1.u1 + S, MID.v0 - S, lo, false, outside, 3);
  flat(half, MID.u0 - S, MID.v0 - S, cu, MID.v1 + S, lo, false, outside, 3);
  // the roof too: cracks between the walls and ceiling inside must show black, never the sky
  flat(half, LEG1.u0 - S, LEG1.v0, LEG1.u1 + S, MID.v0 - S, hi, true, outside, 3);
  flat(half, MID.u0 - S, MID.v0 - S, cu, MID.v1 + S, hi, true, outside, 3);

  // once per vestibule: the cable bridge and the lamp at the centre, the dead end
  const whole = new THREE.Group();
  const bridge = box(CABLE, CABLE, MID.v1 - MID.v0 - 2 * CABLE, cableMat);
  bridge.position.set(cu, CABLE_Y, MID_CENTER.v);
  whole.add(bridge);
  // the dead end opens onto the stairs after the last floor (stairs.ts): kept apart to be hidden then
  const end = new THREE.Group();
  wallPiece(end, skin, 'nz', LEG2.v1, LEG2.u0, LEG2.u1, 0, VEST_H);
  wallPiece(end, out, 'pz', LEG2.v1 + S, LEG2.u0 - S, LEG2.u1 + S, lo, hi);
  whole.add(end);
  end.traverse((o) => (o.userData.deadEnd = true));
  const lamp = makeLamp(whole, { ...TAMBOUR_LAMP, x: cu, z: MID_CENTER.v, ceiling: VEST_H }, null, channel, mats);
  const bulbLocal = lamp.pos;

  const roots = (['back', 'forward'] as const).map((exit) => {
    const f = VESTIBULES[exit];
    return new THREE.Matrix4().compose(new THREE.Vector3(f.ox, 0, f.oz), new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(f.fx, f.fz)), ONE);
  });
  // the second half: a half turn about the centre, written as a scale so the matrix is exact
  const turn = new THREE.Matrix4().compose(new THREE.Vector3(2 * cu, 0, 2 * MID_CENTER.v), new THREE.Quaternion(), new THREE.Vector3(-1, 1, -1));
  const meshes = [...instance(parent, half, roots.flatMap((r) => [r, r.clone().multiply(turn)])), ...instance(parent, whole, roots)];

  // one lamp per vestibule for sound and baking, both driving the shared channel
  const lamps = roots.map((r) => ({
    pos: bulbLocal.clone().applyMatrix4(r),
    style: TAMBOUR_LAMP.style,
    // drawn as instances: there is no fitting of its own to move
    group: new THREE.Object3D(),
    room: null,
    channel,
    get level() {
      return lamp.level;
    },
    set: (l: number) => lamp.set(l),
    tint: (c: THREE.ColorRepresentation) => lamp.tint(c),
  }));
  return { lamps, follow: (camera) => follow(meshes, camera), deadEnds: meshes.filter((m) => m.userData.deadEnd) };
}

const Y = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Every mesh of a template, drawn once per placement. The first placement is the one baked. */
function instance(parent: THREE.Object3D, template: THREE.Object3D, placements: THREE.Matrix4[]) {
  template.updateMatrixWorld(true);
  const list: THREE.InstancedMesh[] = [];
  template.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
    const world = placements.map((p) => new THREE.Matrix4().multiplyMatrices(p, o.matrixWorld));
    world.forEach((w, i) => im.setMatrixAt(i, w));
    im.userData.placements = world;
    im.userData.bakeMatrix = world[0];
    im.userData.vestibule = 'back';
    im.userData.deadEnd = !!o.userData.deadEnd;
    // the instances are far apart; one bounding sphere around the template would cull wrongly
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    im.matrixWorldAutoUpdate = false;
    parent.add(im);
    list.push(im);
  });
  return list;
}

const rel = new THREE.Matrix4();

/**
 * Every frame, before rendering: instance matrices relative to the camera, worked out here in double
 * precision. The GPU then only gets small numbers, the same ones in both vestibules for the same
 * view. Left to multiply world-sized matrices in single precision, the back and forward vestibules
 * round differently (one is 20 m further from the origin), and the loop shows a few pixels.
 */
function follow(meshes: THREE.InstancedMesh[], camera: THREE.Camera) {
  camera.updateMatrixWorld();
  for (const m of meshes) {
    m.matrixWorld.copy(camera.matrixWorld);
    const placements: THREE.Matrix4[] = m.userData.placements;
    placements.forEach((p, i) => m.setMatrixAt(i, rel.multiplyMatrices(camera.matrixWorldInverse, p)));
    m.instanceMatrix.needsUpdate = true;
  }
}
