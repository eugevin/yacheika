import type * as THREE from 'three';
import { Kit, vent } from '../furniture.ts';
import type { Facing } from '../geometry.ts';
import { furnishBath, type BathProps } from './bath.ts';
import { furnishBedroom, type BedroomProps } from './bedroom.ts';
import { furnishCommon, type CommonProps } from './common.ts';
import { furnishHall, type HallProps } from './hall.ts';
import { furnishKitchen, type KitchenProps } from './kitchen.ts';
import { furnishLiving, type LivingProps } from './living.ts';

export type Updater = (t: number, dt: number, camera: THREE.Camera) => void;

/** Everything in the cell that anomalies may touch, by room. */
export interface Props {
  common: CommonProps;
  hall: HallProps;
  kitchen: KitchenProps;
  bath: BathProps;
  living: LivingProps;
  bedroom: BedroomProps;
}

/**
 * Ventilation grilles of the wet rooms, high on their walls: where the fog of a samosbor pours in
 * (samosbor.ts). Facing is the way the grille looks, into the room.
 */
export const VENTS: { x: number; z: number; y: number; facing: Facing }[] = [
  { x: 25.72, z: 6.86, y: 2.24, facing: 'px' },
  { x: 22.9, z: 6.24, y: 2.22, facing: 'pz' },
  { x: 23.63, z: 9.76, y: 2.22, facing: 'nz' },
];

/** Furnishes every room (docs/DESIGN.md, 3.2). `players` sets how many slippers and plates there are. */
export function furnish(root: THREE.Object3D, players: number, updaters: Updater[]): Props {
  Kit.matte = new Map();
  const vents = new Kit(root, 'bath');
  for (const v of VENTS) vent(vents, v.x, v.z, v.facing, v.y);
  return {
    common: furnishCommon(root),
    hall: furnishHall(root, players, updaters),
    kitchen: furnishKitchen(root, players),
    bath: furnishBath(root),
    living: furnishLiving(root, updaters),
    bedroom: furnishBedroom(root),
  };
}
