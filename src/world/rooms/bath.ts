import * as THREE from 'three';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { Kit, keep } from '../furniture.ts';

export interface BathProps {
  /** Dark water filling the tub to the brim; hidden. */
  water: THREE.Mesh;
  /** The shower curtain, bunched at the head of the tub; scale.z draws it. */
  curtain: THREE.Mesh;
  /** Small mirror over the washbasin. */
  mirror: THREE.Mesh;
  /** Cistern of the toilet, high on the wall. */
  cistern: THREE.Group;
}

/** Bathroom (cast-iron tub, washbasin, washing machine) and the toilet next door. */
export function furnishBath(root: THREE.Object3D): BathProps {
  const k = new Kit(root, 'bath');
  const enamel = k.mat('enamel');
  const chrome = k.mat('chrome');

  // the tub: a hollow enamel shell on four feet, along the west wall
  const tub = k.place('tub', 'px');
  const t = 0.05;
  const h = tub.h - 0.06;
  k.box(tub.g, tub.w, 0.04, tub.d, enamel, 0, 0.06, 0);
  k.box(tub.g, tub.w, h, t, enamel, 0, 0.06, -tub.d / 2 + t / 2);
  k.box(tub.g, tub.w, h, t, enamel, 0, 0.06, tub.d / 2 - t / 2);
  k.box(tub.g, t, h, tub.d, enamel, -tub.w / 2 + t / 2, 0.06, 0);
  k.box(tub.g, t, h, tub.d, enamel, tub.w / 2 - t / 2, 0.06, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(tub.g, 0.03, 0.06, k.mat('iron'), sx * (tub.w / 2 - 0.12), 0, sz * (tub.d / 2 - 0.1), 8);
  const water = k.box(tub.g, tub.w - 2 * t, 0.005, tub.d - 2 * t, k.custom('darkWater', { color: 0x1a1f1c, roughness: 0.02 }), 0, tub.h - 0.03, 0);
  water.visible = false;
  keep(water);
  const tap = k.at(22.3, 7.1, 'px', 0.75);
  k.cyl(tap, 0.012, 0.14, chrome, 0, 0, 0.06, 8).rotation.x = Math.PI / 2;
  // curtain rod over the front edge, the curtain pushed to the head end
  const rod = k.at(23.04, 7.14, 'px', 2.0);
  // facing +x, local x runs along the tub (world -z)
  k.rod(rod, 0.008, 1.72, chrome);
  const curtain = k.box(rod, 0.2, 1.55, 0.05, k.fabric('#9fb8b0'), 0.74, -1.55, 0);
  keep(curtain);

  // washbasin on a pedestal against the south wall, with a little mirror above
  const basin = k.place('washbasin', 'nz');
  k.cyl(basin.g, 0.07, basin.h - 0.15, enamel, 0, 0, -0.05, 12, 0.09);
  k.box(basin.g, basin.w, 0.15, basin.d, enamel, 0, basin.h - 0.15, 0);
  k.box(basin.g, basin.w - 0.1, 0.004, basin.d - 0.12, k.mat('white'), 0, basin.h + 0.001, 0.02);
  k.cyl(basin.g, 0.01, 0.12, chrome, 0, basin.h, -basin.d / 2 + 0.05, 8);
  const mg = k.at(23.65, ROOM_BY_ID.bath.rect.z1, 'nz', 1.25);
  const mirror = k.box(mg, 0.36, 0.46, 0.006, k.custom('mirror', { color: 0xdfe4e6, roughness: 0.02, metalness: 1 }), 0, 0, 0.006);
  keep(mirror);

  // washing machine: a round-shouldered white tub with a lid and a dial
  const washer = k.place('washer', 'pz');
  k.box(washer.g, washer.w, washer.h - 0.02, washer.d, enamel, 0, 0, 0);
  k.box(washer.g, washer.w - 0.04, 0.02, washer.d - 0.04, k.mat('white'), 0, washer.h - 0.02, 0);
  k.cyl(washer.g, 0.03, 0.02, k.mat('black'), 0.1, washer.h * 0.75, washer.d / 2, 10).rotation.x = Math.PI / 2;

  // toilet: bowl, seat, a cistern high on the wall with a pipe and a pull chain
  const w = new Kit(root, 'wc');
  const toilet = w.place('toilet', 'px');
  w.cyl(toilet.g, 0.12, 0.3, w.mat('enamel'), 0.05, 0, 0, 14, 0.1);
  w.cyl(toilet.g, 0.19, 0.12, w.mat('enamel'), 0.08, 0.3, 0, 16, 0.14);
  const seat = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 16), w.paint(0x2a2420, 0.4));
  seat.rotation.x = Math.PI / 2;
  seat.position.set(0.08, 0.44, 0);
  seat.scale.set(1, 1.15, 1);
  toilet.g.add(seat);
  const cistern = w.at(ROOM_BY_ID.wc.rect.x0, 8.95, 'px', 1.75);
  w.box(cistern, 0.42, 0.26, 0.18, w.mat('iron'), 0, 0, 0.1);
  w.cyl(cistern, 0.02, 1.3, w.mat('iron'), 0, -1.3, 0.12, 8);
  for (let i = 0; i < 10; i++) w.cyl(cistern, 0.004, 0.035, w.mat('chrome'), 0.17, -i * 0.04 - 0.02, 0.2, 4);
  w.box(cistern, 0.03, 0.08, 0.03, w.mat('white'), 0.17, -0.48, 0.2);
  keep(cistern);
  const roll = w.at(23.55, ROOM_BY_ID.wc.rect.z0, 'pz', 0.75);
  w.rod(roll, 0.055, 0.1, w.mat('paper'), 0, 0, 0.07, 14);

  return { water, curtain, mirror, cistern };
}
