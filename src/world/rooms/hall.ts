import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { ROOM_BY_ID } from '../../../shared/map.ts';
import { rng } from '../../textures.ts';
import { LAYERS } from '../layers.ts';
import { Kit, cabinet, keep } from '../furniture.ts';
import type { Updater } from './index.ts';

export interface HallProps {
  /** One pair per person in the group. */
  slippers: THREE.Group;
  /** The phone's handset, resting on its cradle. */
  receiver: THREE.Group;
  /** The electricity meter's disk with a black mark on its rim, turning slowly forward (`meter.dir`). */
  meterDisk: THREE.Mesh;
  meter: { dir: number };
  /** The door chain, hanging by the door. */
  chain: THREE.Group;
  /** The mirror on the west wall: murky glass, and a real reflection over it in high quality. */
  mirror: { glass: THREE.Mesh; reflector: Reflector; centre: THREE.Vector3; ghost: THREE.Object3D | null };
  /** The pantry's door, shut in its doorway; it hinges about its north edge (shell.ts). */
  pantryDoor: THREE.Object3D;
}

const SLIPPER_COLORS = ['#7a2e2e', '#4a5a3a', '#3a4a6a', '#8a6a3a', '#5a3a5a', '#6a6a6a', '#8a4a2a'];

/** Prihozhaya: coats, shoes, the phone, the meter, a mirror, cupboards over the door. */
export function furnishHall(root: THREE.Object3D, players: number, updaters: Updater[]): HallProps {
  const k = new Kit(root, 'hall');
  const r = ROOM_BY_ID.hall.rect;
  const wood = k.mat('pine');

  // coat rack: a board with hooks, a hat shelf, coats, a shoe shelf below
  const rack = k.place('coatRack', 'px');
  k.box(rack.g, rack.w, 0.12, 0.02, wood, 0, 1.62, -rack.d / 2 + 0.01);
  k.box(rack.g, rack.w, 0.02, 0.3, wood, 0, 1.82, -rack.d / 2 + 0.15);
  const coat = k.fabric('#2e2a28');
  const coat2 = k.fabric('#4a3e30');
  k.box(rack.g, 0.42, 0.95, 0.2, coat, -0.3, 0.68, -rack.d / 2 + 0.13);
  k.box(rack.g, 0.4, 0.85, 0.18, coat2, 0.25, 0.78, -rack.d / 2 + 0.12);
  k.cyl(rack.g, 0.1, 0.12, k.fabric('#3b3028'), -0.1, 1.84, -rack.d / 2 + 0.15, 12, 0.11);
  k.box(rack.g, rack.w, 0.025, rack.d, wood, 0, 0.28, 0);
  for (const [x, c] of [[-0.35, 0x2a1e18], [-0.05, 0x1a1a1a], [0.3, 0x5a3a24]] as const) {
    k.box(rack.g, 0.11, 0.09, 0.28, k.paint(c, 0.4), x, 0.0, 0.02);
    k.box(rack.g, 0.11, 0.09, 0.28, k.paint(c, 0.4), x + 0.13, 0.0, 0.02);
  }

  // slippers on the floor along the wall, one pair per person (an extra pair is an anomaly)
  const slippers = new THREE.Group();
  const r2 = rng(7);
  for (let i = 0; i < players; i++) {
    const pair = k.at(23.98 + r2() * 0.04, 3.55 + i * 0.25, 'px');
    pair.rotation.y += (r2() - 0.5) * 0.3;
    const m = k.fabric(SLIPPER_COLORS[i % SLIPPER_COLORS.length]);
    for (const dx of [-0.06, 0.06]) k.box(pair, 0.09, 0.045, 0.25, m, dx, 0, 0);
    root.remove(pair);
    slippers.add(pair);
  }
  root.add(keep(slippers));

  // phone stand with a rotary phone on it
  const stand = k.place('phoneStand', 'nx');
  cabinet(k, stand.g, stand.w, stand.h, stand.d, k.mat('veneer'), 1);
  const phone = new THREE.Group();
  phone.position.set(0, stand.h, 0.02);
  stand.g.add(phone);
  const plastic = k.paint(0x1e1c1a, 0.3);
  k.box(phone, 0.22, 0.08, 0.2, plastic, 0, 0, 0);
  const dial = k.cyl(phone, 0.06, 0.012, k.mat('white'), 0, 0.06, 0.06, 16);
  dial.rotation.x = -0.35;
  const receiver = new THREE.Group();
  receiver.position.set(0, 0.1, -0.03);
  phone.add(receiver);
  k.box(receiver, 0.22, 0.035, 0.05, plastic, 0, -0.0175, 0);
  for (const sx of [-1, 1]) k.box(receiver, 0.055, 0.04, 0.06, plastic, sx * 0.09, -0.03, 0);
  keep(receiver);

  // Mirror on the west wall (docs/DESIGN.md, 4.4): a real reflection, rendered only while it is in
  // view and only of the rooms it can show (world/index.ts, LAYERS). In low quality only the murky
  // glass under it is left.
  const mg = k.at(r.x0, 5.4, 'px', 0.95);
  k.box(mg, 0.62, 0.92, 0.025, wood, 0, 0, 0.0125);
  const glass = k.box(mg, 0.54, 0.84, 0.006, k.custom('murkyGlass', { color: 0x6c7476, roughness: 0.25, metalness: 0.2 }), 0, 0.04, 0.028);
  keep(glass);
  const scale = Math.min(devicePixelRatio, 1.5) * 0.5;
  const reflector = new Reflector(new THREE.PlaneGeometry(0.54, 0.84), {
    textureWidth: Math.round(innerWidth * scale),
    textureHeight: Math.round(innerHeight * scale),
    clipBias: 0.003,
  });
  // the colour is overlaid on the reflection: 0.5 (linear) leaves it as it is; old silvering is a little darker
  (reflector.material as THREE.ShaderMaterial).uniforms.color.value.setRGB(0.42, 0.42, 0.41);
  // the reflection sees the near rooms (not `far`) and what only a mirror shows
  const reflected = reflector.getReflectionCamera.bind(reflector);
  reflector.getReflectionCamera = (camera) => {
    const c = reflected(camera);
    c.layers.set(0);
    c.layers.enable(LAYERS.mirror);
    return c;
  };
  reflector.position.set(0, 0.46, 0.032);
  reflector.userData.noEnv = true;
  mg.add(reflector);
  const centre = new THREE.Vector3(r.x0 + 0.032, 1.41, 5.4);

  // electricity meter by the door: a black box, a window, the turning disk
  const meter = k.at(23.95, r.z0, 'pz', 1.75);
  k.box(meter, 0.18, 0.28, 0.1, plastic, 0, 0, 0.05);
  k.box(meter, 0.13, 0.08, 0.004, k.mat('white'), 0, 0.17, 0.102);
  const meterDisk = k.cyl(meter, 0.045, 0.004, k.mat('chrome'), 0, 0.1, 0.09, 16);
  meterDisk.rotation.x = Math.PI / 2;
  // the red mark on the rim shows which way the disk turns
  k.box(meterDisk, 0.012, 0.0045, 0.006, k.paint(0x8a1a14, 0.5), 0, -0.00025, 0.039);
  keep(meterDisk);
  const meterState = { dir: 1 };
  updaters.push((_t, dt) => (meterDisk.rotation.y += dt * 1.2 * meterState.dir));

  // the chain of the front door hangs from its bracket by the frame
  const chain = new THREE.Group();
  chain.position.set(24.15, 1.45, r.z0 + 0.03);
  const link = k.mat('brass');
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.0025, 4, 8), link);
    l.position.y = -i * 0.017;
    l.rotation.y = (i % 2) * (Math.PI / 2);
    chain.add(l);
  }
  k.box(chain, 0.06, 0.02, 0.012, link, 0, 0.01, 0);
  root.add(keep(chain));

  // cupboards above the door to the passage
  const mez = k.place('mezzanine', 'nz');
  cabinet(k, mez.g, mez.w, mez.h, mez.d, k.paint(0xdcd6c8, 0.5), 4);

  const pantryDoor = root.getObjectByName('door:hall-pantry')!;
  return { slippers, receiver, meterDisk, meter: meterState, chain, mirror: { glass, reflector, centre, ghost: null }, pantryDoor };
}
