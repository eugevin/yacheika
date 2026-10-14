import * as THREE from 'three';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { surfaces } from '../surfaces.ts';
import { doorNumber, notice } from '../pictures.ts';
import { mount, quad } from '../geometry.ts';
import { Kit, bakedMaterial, keep } from '../furniture.ts';

/** Flats along the floor corridor: number, x of the door, which wall. Ours, 49, is a real doorway. */
const NEIGHBOURS: [string, number, 'n' | 's'][] = [
  ['41', 6.5, 'n'],
  ['42', 8.5, 's'],
  ['43', 11.0, 'n'],
  ['44', 13.0, 's'],
  ['45', 17.5, 'n'],
  ['46', 19.5, 's'],
  ['47', 22.0, 'n'],
  ['48', 27.5, 's'],
];

export interface CommonProps {
  /** The 12 post boxes on the landing, 4 across and 3 high; local x across, local z out of the wall. */
  mailboxes: THREE.Group;
  /** Leaves of the doors of flats 41–48, by number; hinged at their local origin. */
  neighbourDoors: Record<string, THREE.Group>;
  /** The main sheet on the notice board. */
  notice: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** Hatch of the rubbish chute. */
  chuteHatch: THREE.Mesh;
}

/** The landing and the floor corridor (docs/DESIGN.md, 3.2). */
export function furnishCommon(root: THREE.Object3D): CommonProps {
  const k = new Kit(root, 'landing');
  const c = new Kit(root, 'corridor');

  // landing: post boxes on the west wall, the electric panel on the east
  const mail = k.place('mailboxes', 'px');
  const steel = k.paint(0x5d6e78, 0.45);
  const slot = k.mat('black');
  k.box(mail.g, mail.w, mail.h, mail.d - 0.01, steel, 0, 0, -0.005);
  const cols = 4;
  const rows = 3;
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bw = mail.w / cols;
    const bh = mail.h / rows;
    const door = k.box(mail.g, bw - 0.02, bh - 0.02, 0.01, steel, -mail.w / 2 + (col + 0.5) * bw, (rows - 1 - row) * bh + 0.01, mail.d / 2);
    k.box(door, bw * 0.6, 0.012, 0.004, slot, 0, (bh - 0.02) * 0.25, 0.007);
  }
  keep(mail.g);
  const panel = k.place('panel', 'nx');
  const grey = k.paint(0x7c8078, 0.5);
  k.box(panel.g, panel.w, panel.h, panel.d, grey, 0, 0, 0);
  k.box(panel.g, 0.006, panel.h - 0.06, 0.004, slot, 0, 0.03, panel.d / 2);
  k.box(panel.g, 0.03, 0.03, 0.02, k.mat('chrome'), 0.06, panel.h * 0.5, panel.d / 2);

  // floor corridor: neighbours' doors, each with a number, a mat and a casing
  const r = ROOM_BY_ID.corridor.rect;
  const dermatin = c.mat('dermatin');
  const painted = c.paint(0x5b3a26, 0.5);
  const casing = c.paint(0xc8c0ae, 0.5);
  const mat = c.fabric('#4a3b2c');
  const neighbourDoors: CommonProps['neighbourDoors'] = {};
  NEIGHBOURS.forEach(([n, x, side], i) => {
    const facing = side === 'n' ? 'pz' : 'nz';
    const g = c.at(x, side === 'n' ? r.z0 : r.z1, facing);
    for (const sx of [-1, 1]) c.box(g, 0.07, 2.05, 0.02, casing, sx * 0.485, 0, 0.01);
    c.box(g, 1.04, 0.07, 0.02, casing, 0, 2.05, 0.01);
    const leaf = new THREE.Group();
    leaf.name = 'leaf';
    leaf.position.set(-0.45, 0, 0);
    g.add(leaf);
    c.box(leaf, 0.9, 2.05, 0.045, i % 3 === 1 ? painted : dermatin, 0.45, 0, 0.0225);
    c.box(leaf, 0.03, 0.12, 0.03, c.mat('brass'), 0.8, 0.95, 0.05);
    c.cyl(leaf, 0.008, 0.01, c.mat('brass'), 0.45, 1.5, 0.05, 8).rotation.x = Math.PI / 2;
    const plate = quad(0.12, 0.075, bakedMaterial({ color: 0xffffff, roughness: 0.4 }, 'corridor'));
    plate.material.map = doorNumber(n);
    plate.position.set(0.45, 1.68, 0.05);
    leaf.add(plate);
    neighbourDoors[n] = keep(leaf);
    c.box(c.at(x, side === 'n' ? r.z0 + 0.35 : r.z1 - 0.35, facing), 0.7, 0.012, 0.42, mat, 0, 0, 0);
  });
  // our own door mat, outside flat 49
  c.box(c.at(24.7, r.z1 - 0.35, 'nz'), 0.7, 0.012, 0.42, mat, 0, 0, 0);

  // rubbish chute: tiles around it, a housing with a hatch, the pipe up to the ceiling
  const tile = c.custom('tileWhite', { surface: surfaces.tileWhite });
  const tiles = quad(1.6, 2.1, tile);
  mount(root, tiles, 14.4, r.z0, 'pz', 1.05, 0.004);
  const chute = c.place('chute', 'pz');
  const iron = c.mat('iron');
  c.box(chute.g, chute.w, chute.h, chute.d, iron, 0, 0, 0);
  const hatch = c.box(chute.g, chute.w * 0.7, chute.h * 0.55, 0.02, c.mat('steel'), 0, chute.h * 0.3, chute.d / 2 + 0.01);
  c.box(hatch, 0.2, 0.03, 0.03, c.mat('chrome'), 0, chute.h * 0.2, 0.02);
  c.cyl(chute.g, 0.2, 2.7 - 1.3, iron, 0, chute.h, -0.02, 16);
  keep(hatch);

  // notice board with the house committee's notices
  const board = c.at(9.0, r.z0, 'pz', 1.15);
  c.box(board, 1.05, 0.75, 0.02, c.mat('pine'), 0, 0, 0.01);
  const head = quad(0.5, 0.08, bakedMaterial({ color: 0x8a1d1d, roughness: 0.6 }, 'corridor'));
  head.position.set(0, 0.68, 0.025);
  board.add(head);
  const main = quad(0.32, 0.42, bakedMaterial({ roughness: 0.95 }, 'corridor'));
  main.material.map = notice('ОБЪЯВЛЕНИЕ', ['Жильцам 9-го блока!', 'Проверка гермодверей', 'в среду с 10 до 17.', 'Не оставляйте двери', 'без присмотра.', '', 'Домком']);
  main.position.set(-0.22, 0.34, 0.025);
  board.add(main);
  const side = quad(0.26, 0.34, bakedMaterial({ roughness: 0.95 }, 'corridor'));
  side.material.map = notice('ГРАФИК', ['дежурств по этажу', 'кв. 41–44: пн, вт', 'кв. 45–49: ср, чт', 'пт — общий сбор']);
  side.position.set(0.25, 0.3, 0.025);
  side.rotation.z = -0.03;
  board.add(side);

  return { mailboxes: mail.g, neighbourDoors, notice: main, chuteHatch: hatch };
}
