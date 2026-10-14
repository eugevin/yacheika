import * as THREE from 'three';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { canvasTexture } from '../../textures.ts';
import { flat, quad } from '../geometry.ts';
import { Kit, cabinet, cloth, keep, legs, radiator } from '../furniture.ts';
import { surfaces } from '../surfaces.ts';
import { calendarSheet, radioFront } from '../pictures.ts';

export const CALENDAR_YEAR = 1986;
/** Where plates stand, as world offsets from the table's centre: the long sides first, then the ends. */
export const SEATS = [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25], [-0.42, 0], [0.42, 0], [0, -0.25], [0, 0.25]];

export interface KitchenProps {
  /** Four burner rings; each has a hidden flame child named `flame`. */
  burners: THREE.Group[];
  kettle: THREE.Group;
  /** The fridge door, hinged on its right edge; rotation.y opens it. */
  fridgeDoor: THREE.Group;
  tap: THREE.Group;
  /** One plate per person at the table. */
  plates: THREE.Group;
  radio: THREE.Group;
  /** The radio's cloth front with the maker's name. */
  radioFront: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  calendar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
}

/** Kitchen: stove, sink, the ZIL fridge, cupboards, a table with oilcloth and three stools. */
export function furnishKitchen(root: THREE.Object3D, players: number): KitchenProps {
  const k = new Kit(root, 'kitchen');
  const r = ROOM_BY_ID.kitchen.rect;
  const enamel = k.mat('enamel');
  const black = k.mat('black');
  const chrome = k.mat('chrome');
  const front = k.paint(0xd8d2be, 0.45);
  const top = k.paint(0x8a8478, 0.4);

  const counter = k.place('counter', 'pz');
  cabinet(k, counter.g, counter.w, counter.h - 0.03, counter.d - 0.02, front, 2);
  k.box(counter.g, counter.w, 0.03, counter.d, top, 0, counter.h - 0.03, 0);

  // gas stove: four burners on a black top, an oven with a window, knobs along the front
  const stove = k.place('stove', 'pz');
  k.box(stove.g, stove.w, stove.h - 0.02, stove.d - 0.02, enamel, 0, 0, 0);
  k.box(stove.g, stove.w, 0.02, stove.d, black, 0, stove.h - 0.02, 0);
  k.box(stove.g, stove.w * 0.8, stove.h * 0.4, 0.01, black, 0, stove.h * 0.18, stove.d / 2 - 0.005);
  for (let i = 0; i < 4; i++) k.cyl(stove.g, 0.012, 0.02, black, -0.18 + i * 0.12, stove.h - 0.12, stove.d / 2 - 0.01, 8).rotation.x = Math.PI / 2;
  const burners: THREE.Group[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4a7cff).multiplyScalar(3), transparent: true, opacity: 0.8 });
  for (const [bx, bz] of [[-0.12, -0.13], [0.12, -0.13], [-0.12, 0.13], [0.12, 0.13]]) {
    const b = new THREE.Group();
    b.position.set(bx, stove.h, bz);
    stove.g.add(b);
    k.cyl(b, 0.07, 0.015, k.mat('iron'), 0, 0, 0, 12);
    k.cyl(b, 0.045, 0.025, black, 0, 0, 0, 12);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.05, 12, 1, true), flameMat);
    flame.position.y = 0.05;
    flame.name = 'flame';
    flame.visible = false;
    b.add(flame);
    burners.push(keep(b));
  }
  // the kettle sits on the back left burner, cold
  const kettle = new THREE.Group();
  kettle.position.set(-0.12, stove.h + 0.015, -0.13);
  stove.g.add(kettle);
  const ketMat = k.paint(0xb8c4c8, 0.25);
  k.cyl(kettle, 0.085, 0.14, ketMat, 0, 0, 0, 16, 0.1);
  k.cyl(kettle, 0.03, 0.03, ketMat, 0, 0.14, 0, 12);
  const spout = k.cyl(kettle, 0.012, 0.11, ketMat, 0.1, 0.05, 0, 8, 0.02);
  spout.rotation.z = -0.9;
  k.box(kettle, 0.02, 0.02, 0.12, black, 0, 0.19, 0);
  keep(kettle);

  // sink: a steel bowl in a cabinet, a tap from the wall
  const sink = k.place('sink', 'pz');
  cabinet(k, sink.g, sink.w, sink.h - 0.03, sink.d - 0.02, front, 2);
  k.box(sink.g, sink.w, 0.03, sink.d, k.mat('chrome'), 0, sink.h - 0.03, 0);
  k.box(sink.g, sink.w * 0.7, 0.005, sink.d * 0.6, k.mat('iron'), 0, sink.h + 0.001, 0.02);
  const tap = new THREE.Group();
  tap.position.set(0, sink.h, -sink.d / 2 + 0.05);
  sink.g.add(tap);
  k.cyl(tap, 0.012, 0.22, chrome, 0, 0, 0, 8);
  k.cyl(tap, 0.01, 0.16, chrome, 0, 0.2, 0.08, 8).rotation.x = Math.PI / 2;
  keep(tap);

  // ZIL fridge: rounded-looking white box, chrome handle, the door separate so it can open
  const fridge = k.place('fridge', 'pz');
  k.box(fridge.g, fridge.w, fridge.h - 0.05, fridge.d - 0.04, enamel, 0, 0.05, -0.02);
  k.box(fridge.g, fridge.w - 0.06, 0.05, fridge.d - 0.08, black, 0, 0, -0.02);
  const fridgeDoor = new THREE.Group();
  fridgeDoor.position.set(fridge.w / 2, 0.08, fridge.d / 2 - 0.04);
  fridge.g.add(fridgeDoor);
  k.box(fridgeDoor, fridge.w, fridge.h - 0.12, 0.04, enamel, -fridge.w / 2, 0, 0.02);
  k.box(fridgeDoor, 0.03, 0.22, 0.05, chrome, -fridge.w + 0.06, fridge.h * 0.55, 0.06);
  k.box(fridgeDoor, 0.16, 0.035, 0.005, chrome, -fridge.w / 2, fridge.h - 0.3, 0.043);
  keep(fridgeDoor);

  const cab = k.place('wallCabinets', 'pz');
  cabinet(k, cab.g, cab.w, cab.h, cab.d, front, 4);

  // table with oilcloth, plates for everyone, three stools
  const table = k.place('table', 'nx');
  const pine = k.mat('pine');
  legs(k, table.g, table.w, table.d, table.h - 0.03, 0.045, pine);
  k.box(table.g, table.w, 0.03, table.d, pine, 0, table.h - 0.03, 0);
  k.box(table.g, table.w + 0.04, 0.004, table.d + 0.04, k.mat('oilcloth'), 0, table.h, 0);
  const plates = new THREE.Group();
  plates.position.copy(table.g.position).setY(table.h + 0.004);
  const white = k.mat('white');
  for (let i = 0; i < players; i++) {
    const [dx, dz] = SEATS[i % SEATS.length];
    k.cyl(plates, 0.1, 0.015, white, dx, 0, dz, 20, 0.07);
  }
  root.add(keep(plates));
  for (const id of ['stoolA', 'stoolB', 'stoolC'] as const) {
    const s = k.place(id, 'pz');
    legs(k, s.g, s.w, s.d, s.h - 0.03, 0.035, pine, 0.02);
    k.box(s.g, s.w, 0.03, s.d, pine, 0, s.h - 0.03, 0);
  }

  // wired radio on the wall, its cloth front and one knob
  const radio = k.at(r.x0, 8.8, 'px', 1.55);
  k.box(radio, 0.24, 0.17, 0.08, k.paint(0x6a5a44, 0.5), 0, 0, 0.04);
  const speaker = quad(0.2, 0.13, k.custom('radioFront', { roughness: 0.9 }));
  speaker.material.map = radioFront();
  speaker.position.set(-0.01, 0.085, 0.081);
  radio.add(speaker);
  k.cyl(radio, 0.015, 0.02, black, 0.1, 0.06, 0.09, 10).rotation.x = Math.PI / 2;
  keep(radio);

  // tear-off calendar on the south wall
  const cal = k.at(26.3, r.z1, 'nz', 1.35);
  k.box(cal, 0.2, 0.3, 0.01, k.paint(0x9a2a24, 0.6), 0, 0, 0.005);
  const calendar = quad(0.15, 0.19, k.custom('calendar', { roughness: 0.95 }));
  calendar.material.map = calendarSheet(CALENDAR_YEAR);
  calendar.position.set(0, 0.13, 0.012);
  cal.add(calendar);
  keep(calendar);

  // chintz curtains drawn aside on a rod over the window, down to the sill; a radiator under it
  const chintz = k.custom('chintz', { surface: surfaces.chintz, doubleSide: true }, true);
  const rodY = 2.32;
  for (const z of [7.19, 8.29]) {
    const c = cloth(chintz, 0.5, rodY - 0.92, 4, 0.025);
    c.position.set(r.x1 - 0.07, rodY, z);
    c.rotation.y = -Math.PI / 2;
    root.add(c);
  }
  k.rod(k.at(r.x1 - 0.07, 7.74, 'nx'), 0.008, 1.7, chrome, 0, rodY + 0.01);
  radiator(k, r.x1, 7.74, 'nx', 0.9);

  // soot over the stove
  const soot = canvasTexture(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(30,25,20,0.45)');
    gr.addColorStop(1, 'rgba(30,25,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });
  const sootMat = k.custom('soot', { color: 0xffffff, roughness: 1, transparent: 1 });
  sootMat.map = soot;
  flat(root, 26.45, 6.24, 27.65, 7.3, ROOM_BY_ID.kitchen.height - 0.003, false, sootMat, 4);

  return { burners, kettle, fridgeDoor, tap, plates, radio, radioFront: speaker, calendar };
}
