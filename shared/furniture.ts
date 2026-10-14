import type { Rect, RoomId } from './map.ts';

/**
 * Where the furniture stands, in metres, one box per piece: the client builds each piece to fill its
 * box (src/world/rooms), players can't walk through pieces standing on the floor, and baked light is
 * blocked by them. Heights are from the floor unless y0 is given (things on walls, overhead).
 */
export interface Piece extends Rect {
  room: RoomId;
  /** Top of the piece. */
  h: number;
  /** Bottom, for wall cabinets and the like. */
  y0?: number;
  /** Doesn't cast shadows (thin legs, open frames). */
  airy?: boolean;
}

const at = (room: RoomId, x0: number, x1: number, z0: number, z1: number, h: number, extra: Partial<Piece> = {}): Piece => ({ room, x0, x1, z0, z1, h, ...extra });

export const FURNITURE = {
  // landing
  mailboxes: at('landing', 0, 0.22, 1.6, 2.8, 1.6, { y0: 0.9 }),
  panel: at('landing', 2.82, 3, 2.3, 2.9, 1.95, { y0: 1.05 }),
  // floor corridor
  chute: at('corridor', 14.0, 14.8, 0, 0.3, 1.3, { y0: 0.55 }),
  // hall
  coatRack: at('hall', 23.5, 23.88, 3.45, 4.75, 1.85),
  phoneStand: at('hall', 25.45, 25.9, 4.6, 5.3, 0.75),
  mezzanine: at('hall', 23.5, 25.9, 5.7, 6.12, 2.5, { y0: 2.05 }),
  // kitchen
  counter: at('kitchen', 25.75, 26.75, 6.24, 6.84, 0.88),
  stove: at('kitchen', 26.8, 27.3, 6.24, 6.84, 0.88),
  sink: at('kitchen', 27.35, 27.95, 6.24, 6.84, 0.88),
  fridge: at('kitchen', 28.0, 28.65, 6.26, 6.9, 1.5),
  wallCabinets: at('kitchen', 25.75, 27.95, 6.24, 6.56, 2.15, { y0: 1.45 }),
  table: at('kitchen', 27.3, 28.4, 8.0, 8.8, 0.76, { airy: true }),
  stoolA: at('kitchen', 26.75, 27.1, 8.22, 8.57, 0.45, { airy: true }),
  stoolB: at('kitchen', 27.68, 28.03, 8.86, 9.21, 0.45, { airy: true }),
  stoolC: at('kitchen', 27.68, 28.03, 7.58, 7.93, 0.45, { airy: true }),
  // bathroom and toilet
  tub: at('bath', 22.3, 23.02, 6.28, 8.0, 0.6),
  washbasin: at('bath', 23.4, 23.9, 7.62, 8.04, 0.85, { airy: true }),
  washer: at('bath', 23.7, 24.15, 6.25, 6.62, 0.85),
  toilet: at('wc', 23.1, 23.78, 8.72, 9.18, 0.45),
  // living room
  sofa: at('living', 26.0, 28.0, 10.4, 11.3, 0.88),
  coffeeTable: at('living', 26.5, 27.5, 11.85, 12.45, 0.45, { airy: true }),
  armchairA: at('living', 25.85, 26.6, 12.9, 13.65, 0.85),
  armchairB: at('living', 27.25, 28.0, 12.9, 13.65, 0.85),
  wallUnit: at('living', 22.9, 26.9, 15.4, 15.86, 2.2),
  tv: at('living', 27.45, 28.3, 14.85, 15.55, 1.1),
  floorLamp: at('living', 22.65, 22.95, 14.95, 15.25, 1.6, { airy: true }),
  // bedroom
  bed: at('bedroom', 19.6, 21.2, 10.36, 12.4, 0.95),
  cot: at('bedroom', 21.45, 22.33, 10.4, 11.02, 0.95, { airy: true }),
  wardrobe: at('bedroom', 18.38, 18.98, 13.3, 14.6, 1.95),
  dresser: at('bedroom', 21.95, 22.38, 12.85, 13.85, 0.8),
  // loggia
  skis: at('loggia', 22.2, 22.36, 15.3, 15.62, 1.8, { airy: true }),
  jarShelf: at('loggia', 21.5, 22.35, 16.35, 16.76, 0.62),
  loggiaStool: at('loggia', 21.55, 21.9, 15.6, 15.95, 0.45, { airy: true }),
} satisfies Record<string, Piece>;

export type PieceId = keyof typeof FURNITURE;

/** Rugs on the floor: nothing to walk around, but footsteps on them are muffled. */
export const RUGS: Rect[] = [{ x0: 19.3, x1: 21.6, z0: 12.6, z1: 14.2 }];

/** Pieces standing on the floor, which players have to walk around. */
export const FURNITURE_BLOCKERS: Rect[] = Object.values(FURNITURE).filter((p: Piece) => (p.y0 ?? 0) < 1.2);
