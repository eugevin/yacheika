import { FURNITURE, RUGS } from '../../shared/furniture.ts';
import { DOORWAYS, ROOM_BY_ID, VESTIBULES, ZONE, doorRect, inRect, roomAt, toWorld, type FloorKind, type RoomId } from '../../shared/map.ts';

/**
 * Where the cell sounds from (docs/DESIGN.md, 5). The same every cycle: fixed places, fixed rhythms,
 * nothing random, so any other sound is an anomaly. audio.ts turns these into voices.
 */

/** A sound the cell always makes. Anomalies may silence one (`on`). */
export interface Ambient {
  kind: 'fridge' | 'radio' | 'drip' | 'clock' | 'meter' | 'lift';
  x: number;
  y: number;
  z: number;
  /** Silent beyond this many metres. Must not reach either exit zone, or the loop gives itself away. */
  range: number;
  on: boolean;
  /** Radio only: the tape runs backwards (an anomaly). */
  reversed?: boolean;
  /** Radio only: every so often the music drops and a voice through the static calls this name (an anomaly). */
  announce?: string;
  /** Changed by a morok: no reverb of the room, and walls dull only its loudness (audio.ts, Wall.dry). */
  dry?: boolean;
}

/** Positions match the props in rooms/*.ts. */
export function ambience(): Ambient[] {
  const f = FURNITURE.fridge;
  return [
    // compressor at the bottom of the ZIL
    { kind: 'fridge', x: (f.x0 + f.x1) / 2, y: 0.4, z: (f.z0 + f.z1) / 2, range: 5, on: true },
    // wired radio on the kitchen's west wall
    { kind: 'radio', x: ROOM_BY_ID.kitchen.rect.x0 + 0.08, y: 1.64, z: 8.8, range: 5, on: true },
    // the bath tap
    { kind: 'drip', x: 22.4, y: 0.65, z: 7.1, range: 4, on: true },
    // pendulum clock on the living room's west wall
    { kind: 'clock', x: ROOM_BY_ID.living.rect.x0 + 0.1, y: 1.6, z: 13.8, range: 5, on: true },
    // electricity meter by the flat's door
    { kind: 'meter', x: 23.95, y: 1.85, z: ROOM_BY_ID.hall.rect.z0 + 0.1, range: 3, on: true },
    // the lift shaft behind the landing's south wall, the one with the floor number
    { kind: 'lift', x: 1.5, y: 1.2, z: ROOM_BY_ID.landing.rect.z1 + 1.2, range: 6, on: true },
  ];
}

/** What a footstep sounds like. */
export type Footing = 'carpet' | 'tile' | 'concrete' | 'linoleum' | 'parquet';
const FOOTING: Record<FloorKind, Footing> = {
  metlakh: 'tile',
  tile: 'tile',
  concrete: 'concrete',
  'linoleum-parquet': 'linoleum',
  linoleum: 'linoleum',
  'parquet-herringbone': 'parquet',
  parquet: 'parquet',
};

/** The floor under a point: a rug, a room's floor, a doorway's threshold, or the vestibules' metlakh tiles. */
export function footingAt(x: number, z: number): Footing {
  if (RUGS.some((r) => inRect(r, x, z))) return 'carpet';
  const room = roomAt(x, z) ?? doorwayRoom(x, z);
  return room ? FOOTING[room.floor] : 'tile';
}

/** A few parquet boards creak, always the same ones: a 0.5 m grid, one cell in five. */
export function creaks(x: number, z: number) {
  const ix = Math.floor(x / 0.5);
  const iz = Math.floor(z / 0.5);
  const h = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return h - Math.floor(h) < 0.2;
}

/**
 * How a room answers (reverb): dry where carpets and soft furniture eat sound, ringing in the tiled
 * bathroom, booming in the long concrete corridor.
 */
export type Acoustics = 'dry' | 'flat' | 'tile' | 'stair' | 'corridor';
const ACOUSTICS: Record<RoomId, Acoustics> = {
  landing: 'stair',
  corridor: 'corridor',
  hall: 'flat',
  pantry: 'flat',
  passage: 'flat',
  kitchen: 'flat',
  loggia: 'flat',
  bath: 'tile',
  wc: 'tile',
  living: 'dry',
  bedroom: 'dry',
};

/** Acoustics at a point; null inside a doorway, where the previous room's should carry on. */
export function acousticsAt(x: number, z: number): Acoustics | null {
  const room = listenerRoom(x, z);
  if (room === undefined) return null;
  return room ? ACOUSTICS[room] : 'stair';
}

/** Rooms joined by an open doorway. */
const NEXT_DOOR = new Set(DOORWAYS.filter((d) => !d.closed).flatMap((d) => [`${d.a}|${d.b}`, `${d.b}|${d.a}`]));

/**
 * How much lies between a listener and a source, by the rooms they are in (null: outside the
 * rooms, a vestibule or behind the walls): 0 the same room, 1 the next room through an open
 * doorway, 2 a wall.
 */
export function separation(listener: RoomId | null, source: RoomId | null): 0 | 1 | 2 {
  if (listener === source) return 0;
  return NEXT_DOOR.has(`${listener}|${source}`) ? 1 : 2;
}

/** The room a listener is in for `separation`: undefined in a doorway, where the previous one should carry on. */
export function listenerRoom(x: number, z: number): RoomId | null | undefined {
  const room = roomAt(x, z);
  if (room) return room.id;
  return doorwayRoom(x, z) ? undefined : null;
}

function doorwayRoom(x: number, z: number) {
  const d = DOORWAYS.find((d) => !d.closed && inRect(doorRect(d), x, z));
  return d ? ROOM_BY_ID[d.a] : null;
}

/** Whether a source this loud reaches into an exit zone (a development check). */
export function reachesZone(x: number, z: number, range: number) {
  return Object.values(VESTIBULES).some((f) => {
    const a = toWorld(f, ZONE.u0, ZONE.v0);
    const b = toWorld(f, ZONE.u1, ZONE.v1);
    const dx = Math.max(Math.min(a.x, b.x) - x, 0, x - Math.max(a.x, b.x));
    const dz = Math.max(Math.min(a.z, b.z) - z, 0, z - Math.max(a.z, b.z));
    return Math.hypot(dx, dz) < range;
  });
}
