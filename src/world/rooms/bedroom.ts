import * as THREE from 'three';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { RUGS } from '../../../shared/furniture.ts';
import { rng } from '../../textures.ts';
import { flat } from '../geometry.ts';
import type { Reflector } from 'three/addons/objects/Reflector.js';
import { Kit, cabinet, cloth, keep, legs, radiator } from '../furniture.ts';
import { LAYERS } from '../layers.ts';
import { realMirror } from '../mirror.ts';
import { surfaces } from '../surfaces.ts';
import { carpet } from '../pictures.ts';

export interface BedroomProps {
  bedspread: THREE.Mesh;
  pillows: THREE.Group;
  cot: THREE.Group;
  /** The wardrobe's right door, hinged on its outer edge; rotation.y opens it. */
  wardrobeDoor: THREE.Group;
  /** Jars of pickles on the loggia shelf. */
  jars: THREE.Group;
  /** The real reflection on the dresser's middle mirror, in high quality (mirror.ts). */
  reflector: Reflector;
}

/** Bedroom (double bed, cot, wardrobe, dresser with a triple mirror) and the loggia. */
export function furnishBedroom(root: THREE.Object3D): BedroomProps {
  const k = new Kit(root, 'bedroom');
  const r = ROOM_BY_ID.bedroom.rect;
  const veneer = k.mat('veneer');

  // double bed, head to the north wall
  const bed = k.place('bed', 'pz');
  k.box(bed.g, bed.w, bed.h, 0.05, veneer, 0, 0, -bed.d / 2 + 0.025);
  k.box(bed.g, bed.w, 0.5, 0.05, veneer, 0, 0, bed.d / 2 - 0.025);
  for (const sx of [-1, 1]) k.box(bed.g, 0.04, 0.3, bed.d - 0.1, veneer, sx * (bed.w / 2 - 0.02), 0.12, 0);
  k.box(bed.g, bed.w - 0.08, 0.2, bed.d - 0.1, k.mat('white'), 0, 0.3, 0);
  const bedspread = k.box(bed.g, bed.w - 0.02, 0.03, bed.d - 0.5, k.fabric('#6a3a4a'), 0, 0.5, 0.2);
  keep(bedspread);
  const pillows = new THREE.Group();
  bed.g.add(pillows);
  for (const sx of [-0.38, 0.38]) k.box(pillows, 0.6, 0.14, 0.4, k.fabric('#e2dccb'), sx, 0.5, -bed.d / 2 + 0.28);
  keep(pillows);

  // cot in the corner: a frame of thin bars
  const c = k.place('cot', 'pz');
  const pine = k.mat('pine');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(c.g, 0.04, c.h, 0.04, pine, sx * (c.w / 2 - 0.02), 0, sz * (c.d / 2 - 0.02));
  k.box(c.g, c.w - 0.04, 0.08, c.d - 0.04, k.mat('white'), 0, 0.35, 0);
  for (const y of [0.3, c.h - 0.04]) {
    k.box(c.g, c.w, 0.03, 0.03, pine, 0, y, c.d / 2 - 0.015);
    k.box(c.g, c.w, 0.03, 0.03, pine, 0, y, -c.d / 2 + 0.015);
  }
  for (let x = -c.w / 2 + 0.08; x < c.w / 2 - 0.05; x += 0.08)
    for (const sz of [-1, 1]) k.box(c.g, 0.015, c.h - 0.34, 0.015, pine, x, 0.33, sz * (c.d / 2 - 0.015));
  keep(c.g);

  // wardrobe on the west wall: the right door is separate so it can stand ajar
  const wr = k.place('wardrobe', 'px');
  k.box(wr.g, wr.w, wr.h, wr.d - 0.02, veneer, 0, 0, -0.01);
  k.box(wr.g, 0.006, wr.h - 0.1, 0.004, k.mat('black'), 0, 0.05, wr.d / 2);
  k.box(wr.g, 0.015, 0.12, 0.02, k.mat('chrome'), -0.05, wr.h * 0.5, wr.d / 2 + 0.01);
  const wardrobeDoor = new THREE.Group();
  wardrobeDoor.position.set(wr.w / 2, 0.05, wr.d / 2 - 0.01);
  wr.g.add(wardrobeDoor);
  k.box(wardrobeDoor, wr.w / 2 - 0.005, wr.h - 0.1, 0.02, veneer, -wr.w / 4, 0, 0.01);
  k.box(wardrobeDoor, 0.015, 0.12, 0.02, k.mat('chrome'), -wr.w / 2 + 0.05, wr.h * 0.5 - 0.05, 0.03);
  keep(wardrobeDoor);

  // dresser with a triple mirror
  const dr = k.place('dresser', 'nx');
  cabinet(k, dr.g, dr.w, dr.h, dr.d, veneer, 2);
  const mirror = k.custom('mirror', { color: 0xdfe4e6, roughness: 0.02, metalness: 1 });
  k.box(dr.g, 0.5, 0.8, 0.02, mirror, 0, dr.h + 0.02, -dr.d / 2 + 0.06);
  // the middle one reflects for real; the wings, turned towards it, keep the room's environment map
  const reflector = realMirror(0.5, 0.8, LAYERS.bedroomView, ['bedroom', 'living', 'loggia']);
  reflector.position.set(0, dr.h + 0.42, -dr.d / 2 + 0.0715);
  dr.g.add(reflector);
  for (const s of [-1, 1]) {
    const wing = k.box(dr.g, 0.24, 0.65, 0.02, mirror, s * 0.36, dr.h + 0.05, -dr.d / 2 + 0.1);
    wing.rotation.y = -s * 0.5;
  }

  // floor carpet in front of the bed
  const rug = k.custom('rug', { roughness: 0.95 });
  rug.map = carpet(9, 0, ['#3a4a6a', '#1e2230', '#b8a070', '#d0c8b0']);
  const rugAt = RUGS[0];
  const rugMesh = flat(root, rugAt.x0, rugAt.z0, rugAt.x1, rugAt.z1, 0.005, true, rug, 4);
  const uv = rugMesh.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - rugAt.x0) / (rugAt.x1 - rugAt.x0), (uv.getY(i) + rugAt.z1) / (rugAt.z1 - rugAt.z0));

  // heavy curtains drawn aside, the radiator under the window
  const drape = k.custom('drape', { surface: () => surfaces.fabric('#7a5a46', 7), doubleSide: true }, true);
  for (const z of [11.28, 13.12]) {
    const c = cloth(drape, 0.55, 2.1, 4, 0.05);
    c.position.set(r.x0 + 0.1, 2.4, z);
    c.rotation.y = Math.PI / 2;
    root.add(c);
  }
  k.rod(k.at(r.x0 + 0.1, 12.2, 'px'), 0.012, 2.4, k.mat('brass'), 0, 2.42);
  radiator(k, r.x0, 12.2, 'px', 0.9);

  // loggia: skis, jars of pickles on a shelf, a stool, washing lines
  const l = new Kit(root, 'loggia');
  const lr = ROOM_BY_ID.loggia.rect;
  const skis = l.place('skis', 'nx');
  for (const sx of [-0.05, 0.05]) {
    const ski = l.box(skis.g, 0.06, 1.75, 0.015, l.paint(0x8a2a22, 0.5), sx, 0, 0);
    ski.rotation.x = -0.08;
  }
  for (const sx of [-0.1, 0.1]) l.cyl(skis.g, 0.008, 1.3, l.mat('chrome'), sx, 0, 0.03, 4).rotation.x = -0.1;
  const shelf = l.place('jarShelf', 'nz');
  const plank = l.mat('pine');
  legs(l, shelf.g, shelf.w, shelf.d, shelf.h, 0.03, plank, 0.01);
  for (const y of [0.25, shelf.h - 0.02]) l.box(shelf.g, shelf.w, 0.02, shelf.d, plank, 0, y, 0);
  const jars = new THREE.Group();
  jars.position.y = shelf.h;
  shelf.g.add(jars);
  const glass = l.mat('glass');
  const pickles = l.paint(0x5a6a2a, 0.4);
  for (const x of [-0.26, 0, 0.26]) {
    l.cyl(jars, 0.075, 0.22, glass, x, 0, 0, 12);
    l.cyl(jars, 0.068, 0.17, pickles, x, 0.005, 0, 10);
    l.cyl(jars, 0.06, 0.02, l.mat('chrome'), x, 0.22, 0, 10);
  }
  keep(jars);
  const stool = l.place('loggiaStool', 'pz');
  legs(l, stool.g, stool.w, stool.d, stool.h - 0.03, 0.035, plank, 0.02);
  l.box(stool.g, stool.w, 0.03, stool.d, plank, 0, stool.h - 0.03, 0);
  const rope = l.mat('white');
  const rr = rng(5);
  for (const z of [15.6, 16.25]) {
    l.cyl(l.at(18.6, z, 'px', 2.28), 0.004, 3.6, rope, 0, 0, 1.8, 4).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) l.box(l.at(19.0 + rr() * 3, z, 'pz', 2.23), 0.012, 0.06, 0.012, l.mat('pine'), 0, 0, 0);
    for (const x of [18.42, lr.x1 - 0.04]) l.box(l.at(x, z, 'pz', 2.26), 0.04, 0.04, 0.04, l.mat('iron'), 0, 0, 0);
  }

  return { bedspread, pillows, cot: c.g, wardrobeDoor, jars, reflector };
}
