import * as THREE from 'three';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { canvasTexture, rng } from '../../textures.ts';
import { flat, quad } from '../geometry.ts';
import { Kit, cabinet, cloth, keep, legs, radiator } from '../furniture.ts';
import { surfaces } from '../surfaces.ts';
import { carpet, clockDial, deadScreen, portrait } from '../pictures.ts';
import type { Updater } from './index.ts';

export interface LivingProps {
  wallCarpet: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  tvScreen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** The crystal on each shelf of the glass cabinet, top to bottom (the shelves themselves stay). */
  crystal: THREE.Group[];
  armchairs: THREE.Group[];
  portrait: THREE.Group;
  /** The portrait's canvas; the eyes are painted on it. */
  portraitCanvas: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** The clock's pendulum; it swings in an updater while `clock.running`. */
  pendulum: THREE.Group;
  clock: { running: boolean };
  tulle: THREE.Mesh;
}

/** Zal: sofa under a wall carpet, two armchairs, the wall unit with crystal, a TV on legs, a pendulum clock. */
export function furnishLiving(root: THREE.Object3D, updaters: Updater[]): LivingProps {
  const k = new Kit(root, 'living');
  const r = ROOM_BY_ID.living.rect;
  const veneer = k.mat('veneer');
  const upholstery = k.fabric('#7a4a2c');

  // sofa against the north wall, a carpet hanging above it
  const sofa = k.place('sofa', 'pz');
  k.box(sofa.g, sofa.w - 0.2, 0.42, sofa.d - 0.15, upholstery, 0, 0.0, 0.07);
  k.box(sofa.g, sofa.w - 0.2, 0.46, 0.18, upholstery, 0, 0.42, -sofa.d / 2 + 0.09);
  for (const sx of [-1, 1]) k.box(sofa.g, 0.1, 0.6, sofa.d, veneer, sx * (sofa.w / 2 - 0.05), 0, 0);
  const wallCarpet = quad(2.4, 1.35, k.custom('wallCarpet', { roughness: 0.95 }));
  wallCarpet.material.map = carpet(3);
  wallCarpet.position.set(27.0, 1.65, r.z0 + 0.012);
  root.add(keep(wallCarpet));

  const table = k.place('coffeeTable', 'pz');
  legs(k, table.g, table.w, table.d, table.h - 0.03, 0.04, veneer);
  k.box(table.g, table.w, 0.03, table.d, veneer, 0, table.h - 0.03, 0);
  k.cyl(table.g, 0.05, 0.22, k.mat('crystal'), 0.2, table.h, 0, 10, 0.07);
  k.box(table.g, 0.3, 0.01, 0.42, k.mat('paper'), -0.2, table.h, 0.02).rotation.y = 0.2;

  // two armchairs facing the sofa
  const armchairs = (['armchairA', 'armchairB'] as const).map((id) => {
    const a = k.place(id, 'nz');
    k.box(a.g, a.w - 0.16, 0.4, a.d - 0.12, upholstery, 0, 0.0, 0.06);
    k.box(a.g, a.w - 0.16, 0.45, 0.14, upholstery, 0, 0.4, -a.d / 2 + 0.07);
    for (const sx of [-1, 1]) k.box(a.g, 0.08, 0.58, a.d, veneer, sx * (a.w / 2 - 0.04), 0, 0);
    return keep(a.g);
  });

  // the wall unit along the south wall: a wardrobe, the glass cabinet with crystal, shelves, a cupboard
  const unit = k.place('wallUnit', 'nz');
  const { g, w, d, h } = unit;
  const left = -w / 2;
  cabinet(k, wrapAt(g, left + 0.5), 1.0, h, d, veneer, 2);
  const glassX = left + 1.0 + 0.7;
  const base = wrapAt(g, glassX);
  cabinet(k, base, 1.4, 0.8, d, veneer, 2);
  k.box(base, 1.4, 0.03, d, veneer, 0, h - 0.03, 0);
  k.box(base, 0.03, h - 0.8, d, veneer, -0.685, 0.8, 0);
  k.box(base, 0.03, h - 0.8, d, veneer, 0.685, 0.8, 0);
  k.box(base, 1.34, h - 0.83, 0.01, k.paint(0x3a2416, 0.6), 0, 0.8, -d / 2 + 0.01);
  const glass = k.mat('glass');
  k.box(base, 1.34, h - 0.83, 0.006, glass, 0, 0.8, d / 2 - 0.01);
  const crystalMat = k.mat('crystal');
  const rr = rng(11);
  const crystal: THREE.Group[] = [];
  for (const [i, y] of [1.72, 1.36, 1.0].entries()) {
    const shelf = new THREE.Group();
    shelf.position.y = y;
    base.add(shelf);
    k.box(shelf, 1.34, 0.012, d - 0.04, glass, 0, -0.012, 0);
    const items = new THREE.Group();
    shelf.add(items);
    for (let x = -0.55; x <= 0.56; x += 0.16) {
      const tall = rr() < 0.4;
      k.cyl(items, tall ? 0.035 : 0.045, tall ? 0.2 : 0.09, crystalMat, x + (rr() - 0.5) * 0.04, 0, (rr() - 0.5) * 0.12, 10, tall ? 0.025 : 0.035);
    }
    items.name = `crystal-${i}`;
    crystal.push(keep(items));
  }
  const books = wrapAt(g, left + 2.4 + 0.4);
  cabinet(k, books, 0.8, 0.8, d, veneer, 1);
  k.box(books, 0.8, 0.03, d, veneer, 0, h - 0.03, 0);
  for (const sx of [-1, 1]) k.box(books, 0.03, h - 0.8, d, veneer, sx * 0.385, 0.8, 0);
  k.box(books, 0.74, 0.02, d, veneer, 0, 1.45, 0);
  const spines = ['#6a2a22', '#2a4a5a', '#5a5a2a', '#3a2a4a', '#7a6a4a', '#2a3a2a'];
  for (let i = 0; i < 18; i++) {
    const bw = 0.03 + rr() * 0.02;
    k.box(books, bw, 0.22 + rr() * 0.06, d * 0.7, k.paint(Number.parseInt(spines[i % spines.length].slice(1), 16), 0.7), -0.35 + i * 0.039, i < 9 ? 0.82 : 1.47, 0);
  }
  cabinet(k, wrapAt(g, left + 3.2 + 0.4), 0.8, h, d, veneer, 1);

  // TV on legs in the corner, turned towards the armchairs
  const tvp = k.place('tv', 'nz');
  tvp.g.rotation.y += 0.45;
  legs(k, tvp.g, 0.6, 0.4, 0.5, 0.025, k.mat('iron'), 0.05);
  k.box(tvp.g, 0.66, 0.52, 0.46, veneer, 0, 0.5, 0);
  const tvScreen = quad(0.42, 0.33, k.custom('tvScreen', { roughness: 0.1 }));
  tvScreen.material.map = deadScreen();
  // dark, but ready to glow: switching the set on (an anomaly) then needs no new shader
  tvScreen.material.emissiveMap = tvScreen.material.map;
  tvScreen.material.emissive.set(0x000000);
  tvScreen.position.set(-0.08, 0.78, 0.232);
  tvp.g.add(keep(tvScreen));
  for (const y of [0.88, 0.78, 0.68]) k.cyl(tvp.g, 0.015, 0.02, k.mat('black'), 0.24, y, 0.23, 8).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const ant = k.cyl(tvp.g, 0.004, 0.5, k.mat('chrome'), s * 0.05, 1.02, -0.05, 4);
    ant.rotation.z = s * 0.5;
  }

  // floor lamp in the south-west corner
  const fl = k.place('floorLamp', 'pz');
  k.cyl(fl.g, 0.13, 0.03, k.mat('iron'), 0, 0, 0, 12);
  k.cyl(fl.g, 0.012, 1.35, k.mat('brass'), 0, 0.03, 0, 6);
  k.cyl(fl.g, 0.12, 0.25, k.fabric('#c8a874'), 0, 1.35, 0, 12, 0.18);

  // pendulum clock on the west wall
  const cg = k.at(r.x0, 13.8, 'px', 1.25);
  k.box(cg, 0.32, 0.75, 0.12, veneer, 0, 0, 0.06);
  k.box(cg, 0.22, 0.42, 0.005, k.mat('glass'), 0, 0.06, 0.122);
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), k.custom('clockDial', { roughness: 0.5 }));
  (dial.material as THREE.MeshStandardMaterial).map = clockDial();
  dial.position.set(0, 0.6, 0.121);
  cg.add(dial);
  for (const [len, a] of [[0.06, 2.1], [0.085, 0.3]] as const) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.006, len, 0.003).translate(0, len / 2, 0), k.mat('black'));
    cg.add(hand);
    hand.position.set(0, 0.6, 0.124);
    hand.rotation.z = -a;
  }
  const pendulum = new THREE.Group();
  pendulum.position.set(0, 0.48, 0.09);
  cg.add(pendulum);
  k.cyl(pendulum, 0.004, 0.3, k.mat('brass'), 0, -0.3, 0, 4);
  const bob = k.cyl(pendulum, 0.04, 0.008, k.mat('brass'), 0, -0.34, 0, 16);
  bob.rotation.x = Math.PI / 2;
  keep(pendulum);
  const clock = { running: true };
  updaters.push((t) => {
    if (clock.running) pendulum.rotation.z = Math.sin(t * Math.PI) * 0.12;
  });

  // portrait on the north wall, west of the door
  const pg = k.at(23.45, r.z0, 'pz', 1.35);
  k.box(pg, 0.48, 0.58, 0.03, k.mat('brass'), 0, 0, 0.015);
  const canvas = quad(0.4, 0.5, k.custom('portrait', { roughness: 0.6 }));
  canvas.material.map = portrait();
  canvas.position.set(0, 0.29, 0.032);
  pg.add(canvas);
  keep(pg);

  // tulle over the window, a rod above it, the radiator below
  const tulle = cloth(k.custom('tulle', { surface: surfaces.tulle, transparent: 1, doubleSide: true }), 2.0, 1.6, 9, 0.035);
  tulle.position.set(r.x1 - 0.1, 2.35, 13.11);
  tulle.rotation.y = -Math.PI / 2;
  root.add(keep(tulle));
  k.rod(k.at(r.x1 - 0.08, 13.11, 'nx'), 0.01, 2.0, k.mat('brass'), 0, 2.36);
  radiator(k, r.x1, 13.11, 'nx', 1.1);

  // a yellow stain on the ceiling near the chandelier: old, the same every time
  const stain = canvasTexture(128, 128, (c, s) => {
    const gr = c.createRadialGradient(s * 0.45, s * 0.5, 4, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(150,115,40,0.18)');
    gr.addColorStop(0.7, 'rgba(150,115,40,0.12)');
    gr.addColorStop(0.95, 'rgba(120,85,30,0.2)');
    gr.addColorStop(1, 'rgba(120,85,30,0)');
    c.fillStyle = gr;
    c.fillRect(0, 0, s, s);
  });
  const stainMat = k.custom('stain', { roughness: 1, transparent: 1 });
  stainMat.map = stain;
  flat(root, 26.3, 13.6, 27.1, 14.4, ROOM_BY_ID.living.height - 0.003, false, stainMat, 4);

  return { wallCarpet, tvScreen, crystal, armchairs, portrait: pg, portraitCanvas: canvas, pendulum, clock, tulle };
}

/** A group inside `parent` at local x. */
function wrapAt(parent: THREE.Object3D, x: number) {
  const g = new THREE.Group();
  g.position.x = x;
  parent.add(g);
  return g;
}
