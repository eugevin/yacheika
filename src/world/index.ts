import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOORWAYS, ROOM_BY_ID, ROOMS, VESTIBULES, leafKey, leafRect, onSide, stairDepth, type Exit, type FloorKind, type RoomId, type Side, type WallKind } from '../../shared/map.ts';
import { FURNITURE, type Piece } from '../../shared/furniture.ts';
import { canvasTexture, signTexture } from '../textures.ts';
import { buildExterior, galleryMaterial } from './exterior.ts';
import { bakedMaterial, type Spec } from './furniture.ts';
import { mount, quad } from './geometry.ts';
import { fittings, makeLamp, type Lamp, type LampSpec } from './lamps.ts';
import {
  CHANNELS,
  DAYLIGHT,
  bakeMesh,
  cellSpace,
  gather,
  kelvin,
  setBaked,
  useBaked,
  vestibuleSpace,
  type Baked,
  type LightSource,
  type Box3,
  type Probe,
  type Space,
  type WindowSource,
} from './lighting.ts';
import { ambience, type Ambient } from './ambience.ts';
import { furnish, type Props } from './rooms/index.ts';
import { REVEAL, buildShell, type Skin } from './shell.ts';
import { isSurfaceTexture, surfaces, type Surface } from './surfaces.ts';
import { buildTambours } from './tambour.ts';
import { buildStairs, stairSpace } from './stairs.ts';
import { buildYard, isYardTexture } from './yard.ts';
import { buildWear, isWearTexture } from './wear.ts';
import { LAYERS } from './layers.ts';

export type { Lamp } from './lamps.ts';
export type { Ambient } from './ambience.ts';
export { LAYERS } from './layers.ts';

/**
 * A sound source placed by an anomaly; the cell itself never makes sounds like these. Steady kinds
 * (hiss, dial tone, whistle, stream, cistern, chute, tv) play all the time; the rest are events,
 * repeated with `every` or played once with `near`. Like the cell's own sources, each has a hard
 * range and is muffled by the walls between (audio.ts).
 */
export interface Emitter {
  kind: 'knock' | 'phone' | 'creak' | 'hiss' | 'dialtone' | 'whistle' | 'stream' | 'cistern' | 'chute' | 'tv' | 'drill' | 'cry' | 'pipes';
  x: number;
  y: number;
  z: number;
  /** Silent beyond this many metres. */
  range: number;
  /** Repeats with this period in seconds, counted in frame time like the clock, so it can keep step with an animation. */
  every?: number;
  /** When within the period, in seconds (default: at its start). */
  at?: number[];
  /** Plays once, when a listener first comes this close. */
  near?: number;
  /** How loud, 1 by default. */
  gain?: number;
}

/** What the hall mirror can show, with a margin: the hall, the passage, the floor corridor by the door. */
const MIRROR_VIEW = new THREE.Box3(new THREE.Vector3(22.4, -0.5, 0), new THREE.Vector3(26, 3, 10.3));

export interface World {
  group: THREE.Group;
  lamps: Lamp[];
  /** The stencilled floor number on the landing: how many cycles in a row the group got right. */
  floorSign: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  floorTexture(text: string, mirrored?: boolean): THREE.Texture;
  /** The cell after the last floor: the vestibules' dead ends open onto stairs down (stairs.ts). */
  won: boolean;
  /** The anomaly applied to this cell, if any (src/anomalies.ts). */
  anomaly: string | null;
  /** Sounds the cell always makes (fridge, radio, clock...); anomalies may switch one off. */
  ambience: Ambient[];
  /** The whole background goes quiet: lamps, appliances, pipes (the "silence" anomaly). */
  silent: boolean;
  emitters: Emitter[];
  /** Footsteps that echo ours from behind. */
  follower: boolean;
  /** Per-frame hooks added by the world itself and by anomalies. */
  updaters: ((t: number, dt: number, camera: THREE.Camera) => void)[];
  /** How long baking the light took, in ms (0 when it came from the cache). */
  bakeMs: number;
  /** Furniture and things anomalies may touch, by room. */
  props: Props;
  /** Light at chest height over a floor point, for people and anything else that moves (lighting.ts, useBaked). */
  probe(x: number, z: number, out: Probe): Probe;
  /** High quality shows the hall mirror's real reflection; low leaves murky glass (and `props.hall.mirror.ghost`, if any). */
  setQuality(high: boolean): void;
  dispose(): void;
}

/**
 * Light of each room (docs/DESIGN.md, 4.2): warm bulbs in the flat and the stairwell, a cold
 * greenish tube in the kitchen, neutral plafonds in the bathroom, a three-armed chandelier in the
 * living room, a dim sconce by the bed. Power is in candela.
 */
const LAMPS: (Omit<LampSpec, 'ceiling'> & { room: RoomId })[] = [
  { room: 'landing', x: 1.5, z: 1.5, style: 'grate', kelvin: 2700, power: 5.6 },
  ...[5.5, 10.5, 15.5, 20.5, 25.5].map((x) => ({ room: 'corridor' as const, x, z: 1.5, style: 'grate' as const, kelvin: 2700, power: 4.8 })),
  { room: 'hall', x: 24.7, z: 4.6, style: 'bulb', kelvin: 2600, power: 3.2 },
  { room: 'passage', x: 24.95, z: 8.24, style: 'bulb', kelvin: 2600, power: 2.4 },
  { room: 'bath', x: 23.4, z: 7.14, style: 'plafond', kelvin: 4000, power: 1.6 },
  { room: 'wc', x: 23.63, z: 8.96, style: 'plafond', kelvin: 4000, power: 1 },
  { room: 'kitchen', x: 27.22, z: 7.74, style: 'tube', kelvin: 5000, power: 4.3, green: 0.08 },
  { room: 'living', x: 25.61, z: 13.11, style: 'chandelier', kelvin: 2700, power: 8 },
  { room: 'bedroom', x: 19.25, z: 10.36, y: 1.55, facing: 'pz', style: 'sconce', kelvin: 2400, power: 12.5 },
  { room: 'loggia', x: 20.38, z: 15.88, style: 'bulb', kelvin: 2700, power: 3.8 },
];
/** Night behind every window: the murk, lit from below by the street lamps. Radiance, linear. */
const NIGHT_RADIANCE = 0.12;

/** What a surface is made of (docs/DESIGN.md, 3.1): a procedural surface, or a plain colour. */
interface Finish {
  surface?: () => Surface;
  color?: number;
  roughness?: number;
}
const FLOORS: Record<FloorKind, Finish> = {
  metlakh: { surface: surfaces.metlakh },
  concrete: { surface: surfaces.concrete },
  'linoleum-parquet': { surface: surfaces.linoleumParquet },
  linoleum: { surface: surfaces.linoleum },
  'parquet-herringbone': { surface: surfaces.parquetHerringbone },
  parquet: { surface: surfaces.parquet },
  tile: { surface: surfaces.tileFloor },
};
const WHITEWASH: Finish = { surface: surfaces.whitewash };
/** Upper part of the wall, and the lower band (dado) with its height. */
const WALLS: Record<WallKind, { wall: Finish; dado?: Finish; h?: number }> = {
  'paint-green': { wall: WHITEWASH, dado: { surface: surfaces.paintGreen }, h: 1.5 },
  'paint-blue': { wall: WHITEWASH, dado: { surface: surfaces.paintBlue }, h: 1.5 },
  'wallpaper-rhombus': { wall: { surface: surfaces.wallpaperRhombus } },
  'wallpaper-flowers': { wall: { surface: surfaces.wallpaperFlowers } },
  'wallpaper-stripes': { wall: { surface: surfaces.wallpaperStripes } },
  'tile-half': { wall: { surface: surfaces.paintYellow }, dado: { surface: surfaces.tileWhite }, h: 1.35 },
  tile: { wall: { surface: surfaces.paintPale }, dado: { surface: surfaces.tileBlue }, h: 1.7 },
  whitewash: { wall: WHITEWASH },
  loggia: { wall: WHITEWASH, dado: { surface: surfaces.lining }, h: 1.0 },
};
/** Painted ceilings where it's damp; whitewash with hairline cracks elsewhere. */
const CEILINGS: Partial<Record<RoomId, Finish>> = { bath: { surface: surfaces.paintPale }, wc: { surface: surfaces.paintPale } };

let bakeCache: Baked[] | null = null;

export function buildWorld(cycle: number, players: number, won = false): World {
  const group = new THREE.Group();
  const updaters: World['updaters'] = [];
  const std = (f: Spec, room: RoomId | null = null) => bakedMaterial(f, room);
  const plain = (color: number, roughness: number) => std({ color, roughness });

  const base = plain(0x3e3024, 0.55);
  const skins = {} as Record<RoomId, Skin>;
  for (const r of ROOMS) {
    const w = WALLS[r.walls];
    const paintLine = r.walls.startsWith('paint') ? plain(0x2c3430, 0.4) : undefined;
    skins[r.id] = {
      wall: std(w.wall, r.id),
      dado: w.dado && { mat: std(w.dado, r.id), h: w.h!, line: paintLine },
      floor: std(FLOORS[r.floor], r.id),
      ceiling: std(CEILINGS[r.id] ?? { surface: surfaces.ceiling }, r.id),
      base: r.walls === 'tile' || r.walls === 'tile-half' ? null : base,
      cell: 0.3,
    };
  }
  // vestibules: no room tag, so no reflections (env.ts)
  const whitewash = std(WHITEWASH);
  const vestibule: Skin = {
    wall: whitewash,
    dado: { mat: std({ surface: surfaces.paintGreen }), h: 1.5, line: plain(0x2c3a2a, 0.5) },
    floor: std({ surface: surfaces.metlakh }),
    // plain whitewash overhead: hairline cracks are too fine to survive the half turn pixel for pixel
    ceiling: whitewash,
    base: null,
    cell: 0.25,
  };
  buildShell(group, {
    skins,
    vestibule,
    casing: plain(0xd6d0c2, 0.45),
    hermo: std({ color: 0x3f4a40, roughness: 0.5 }),
    windowFrame: plain(0xd8d2c4, 0.45),
    leaves: {
      door: plain(0xd9d3c5, 0.45),
      entrance: std({ surface: surfaces.dermatin }),
      hermo: std({ color: 0x4a5248, roughness: 0.45, metalness: 0.4 }),
      glass: std({ color: 0xc8d4d8, roughness: 0.05, transparent: 0.25 }),
      handle: std({ color: 0xc8c8c8, roughness: 0.25, metalness: 1 }),
    },
  });

  const lamps: Lamp[] = [];
  const fit = fittings();
  const cable = plain(0xbab6aa, 0.6);
  const gallery = galleryMaterial();
  // lamps 0 and 1: the back and forward vestibules', sharing channel 1
  const tambours = buildTambours(group, vestibule, cable, gallery, 1, fit);
  lamps.push(...tambours.lamps);
  updaters.push((_t, _dt, camera) => tambours.follow(camera));
  for (const spec of LAMPS) lamps.push(makeLamp(group, { ...spec, ceiling: ROOM_BY_ID[spec.room].height }, spec.room, 1 + lamps.length, fit));
  // the way out after the last floor; its lamps come last, after the cell's
  const stairLamps: Partial<Record<Exit, Lamp>> = {};
  if (won) {
    for (const m of tambours.deadEnds) m.visible = false;
    const mats = {
      concrete: std({ surface: surfaces.concrete }),
      rail: plain(0x5a3a22, 0.5),
      posts: std({ color: 0x2a2a28, roughness: 0.5, metalness: 0.4 }),
      door: plain(0x6a5a48, 0.6),
    };
    for (const exit of ['back', 'forward'] as const) lamps.push((stairLamps[exit] = buildStairs(group, exit, vestibule, gallery, mats, 1 + lamps.length, fit)));
  }
  // the sodium glow of the street, faded half way to grey
  const daylight = kelvin(2100).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(NIGHT_RADIANCE);
  CHANNELS.value[DAYLIGHT].set(daylight.r, daylight.g, daylight.b);

  const props = furnish(group, players, updaters);
  buildWear(group);
  buildExterior(group);
  buildYard(group);

  // the floor number, stencilled on the landing wall that faces whoever comes out of the vestibule
  const floorTexture = (text: string, mirrored = false) =>
    canvasTexture(512, 256, (g, w) => {
      if (mirrored) g.setTransform(-1, 0, 0, 1, w, 0);
      g.fillStyle = '#5a1712';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 64px sans-serif';
      g.fillText('ЭТАЖ', w / 2, 52);
      g.font = 'bold 150px sans-serif';
      g.fillText(text, w / 2, 168);
      // stencil bridges: thin gaps across every glyph
      g.globalCompositeOperation = 'destination-out';
      for (const y of [52, 168]) g.fillRect(0, y - 2, w, 4);
      g.globalCompositeOperation = 'source-over';
    });
  const landing = ROOM_BY_ID.landing.rect;
  const floorSign = quad(1.2, 0.6, useBaked(new THREE.MeshStandardMaterial({ map: floorTexture(String(cycle)), transparent: true, roughness: 0.6 })));
  floorSign.userData.keep = true;
  mount(group, floorSign, (landing.x0 + landing.x1) / 2, landing.z1, 'nz', 1.6, 0.003);

  const rules = quad(
    0.5,
    0.66,
    useBaked(
      new THREE.MeshStandardMaterial({
        roughness: 0.9,
        map: signTexture(
          ['ПАМЯТКА ЖИЛЬЦУ', '', 'При обнаружении отклонений —', 'немедленно вернуться назад.', 'Отклонений не обнаружено —', 'продолжать движение.', 'При самосборе —', 'сохранять спокойствие.'],
          { w: 384, h: 512, bg: '#ece6d2', fg: '#2a2620', font: 'bold 22px serif', border: '#2a2620' },
        ),
      }),
    ),
  );
  rules.userData.keep = true;
  mount(group, rules, 5, ROOM_BY_ID.corridor.rect.z0, 'pz', 1.5, 0.003);

  group.updateMatrixWorld(true);
  const bakeMs = bake(group, lamps, stairLamps);
  merge(group);
  // the mirror draws only what it can show
  const bounds = new THREE.Box3();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && !bounds.setFromObject(o).intersectsBox(MIRROR_VIEW)) o.layers.set(LAYERS.far);
  });
  const light = lightContext(lamps, stairLamps);
  const chest = new THREE.Vector3();

  return {
    group,
    lamps,
    floorSign,
    floorTexture,
    won,
    anomaly: null,
    ambience: ambience(),
    silent: false,
    emitters: [],
    follower: false,
    updaters,
    bakeMs,
    props,
    probe(x, z, out) {
      chest.set(x, 1.2, z);
      const v = [...light.flights, ...light.vest].find((v) => v.space.open(x, 1.2 + stairDepth(x, z), z));
      chest.y += stairDepth(x, z);
      return v ? gather(v.space, v.lamps, [], chest, null, out) : gather(light.cell, light.cellLamps, light.windows, chest, null, out);
    },
    setQuality(high) {
      const m = props.hall.mirror;
      m.reflector.visible = high;
      if (m.ghost) m.ghost.visible = !high;
    },
    dispose() {
      props.hall.mirror.reflector.dispose();
      const textures = new Set<THREE.Texture>();
      const materials = new Set<THREE.Material>();
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        materials.add(o.material);
      });
      const shared = (t: THREE.Texture) => isSurfaceTexture(t) || isYardTexture(t) || isWearTexture(t);
      for (const m of materials) {
        const s = m as THREE.MeshStandardMaterial & { uniforms?: Record<string, { value: unknown }> };
        const own = [s.uniforms?.map?.value, s.uniforms?.glowMap?.value].filter((t) => t instanceof THREE.Texture);
        for (const t of [s.map, s.bumpMap, s.roughnessMap, ...own]) if (t && !shared(t)) textures.add(t);
        m.dispose();
      }
      for (const t of textures) t.dispose();
    },
  };
}

const INWARD: Record<Side, THREE.Vector3> = {
  n: new THREE.Vector3(0, 0, 1),
  s: new THREE.Vector3(0, 0, -1),
  w: new THREE.Vector3(1, 0, 0),
  e: new THREE.Vector3(-1, 0, 0),
};

/** Every window as a soft light: four points spread over its opening, at the frame. */
function windowSources(): WindowSource[] {
  return ROOMS.flatMap((r) =>
    r.windows.map((w) => {
      const points: THREE.Vector3[] = [];
      for (const s of [-1 / 4, 1 / 4])
        for (const t of [0.25, 0.75]) {
          const p = onSide(r.rect, w.side, w.at + s * w.width, 0.15);
          points.push(new THREE.Vector3(p.x, w.sill + t * (w.top - w.sill), p.z));
        }
      return { points, normal: INWARD[w.side], area: (w.width * (w.top - w.sill)) / points.length, room: r.id };
    }),
  );
}

const isBaked = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh && !!(o.material as THREE.Material).userData.baked;

let cellSpaceCache: Space | null = null;

/**
 * What blocks light inside rooms: furniture (shared/furniture.ts) and open door leaves, a little
 * smaller than drawn so the surfaces of a piece don't shadow themselves. Leaves are thickened to a
 * full trace step, or rays would slip through them.
 */
function solids(): { key: string; box: Box3 }[] {
  const inset = 0.02;
  const pieces = (Object.entries(FURNITURE) as [string, Piece][])
    .filter(([, p]) => !p.airy)
    .map(([key, p]) => ({ key, box: { x0: p.x0 + inset, x1: p.x1 - inset, z0: p.z0 + inset, z1: p.z1 - inset, lo: (p.y0 ?? 0) + inset, hi: p.h - inset } }));
  const leaves = DOORWAYS.filter((d) => d.leaf).map((d) => {
    const r = leafRect(d);
    const grow = (a: number, b: number) => (b - a < 0.12 ? [(a + b) / 2 - 0.06, (a + b) / 2 + 0.06] : [a, b]);
    const [x0, x1] = grow(r.x0, r.x1);
    const [z0, z1] = grow(r.z0, r.z1);
    return { key: leafKey(d), box: { x0, x1, z0, z1, lo: 0, hi: d.height - 0.05 } };
  });
  return [...pieces, ...leaves];
}
const SOLIDS = solids();
const SOLID_INDEX = new Map(SOLIDS.map((s, i) => [s.key, i]));

/**
 * What light can reach where: the cell's open space and lamps, and each vestibule with its own lamp.
 * With the stairs open, they come first, each with the vestibule it leads from.
 */
function lightContext(lamps: Lamp[], stairs: Partial<Record<Exit, Lamp>> = {}) {
  cellSpaceCache ??= cellSpace(
    REVEAL,
    SOLIDS.map((s) => s.box),
  );
  const source = (l: Lamp): LightSource => ({ pos: l.pos, channel: l.channel, room: l.room ?? 'vestibule' });
  const exits = ['back', 'forward'] as const;
  // lamps 0 and 1 are the back and forward vestibules'
  const vest = exits.map((exit, i) => ({ space: vestibuleSpace(VESTIBULES[exit]), lamps: [source(lamps[i])] }));
  const flights = exits.flatMap((exit, i) => {
    const l = stairs[exit];
    return l ? [{ exit, space: stairSpace(VESTIBULES[exit]), lamps: [source(l), source(lamps[i])] }] : [];
  });
  return {
    cell: cellSpaceCache,
    cellLamps: lamps.filter((l) => l.room !== null).map(source),
    windows: windowSources(),
    vest,
    flights,
  };
}

/**
 * Bakes every lit mesh. The cell is the same every cycle and is built in the same order, so the
 * result of the first build is kept and reused by mesh order. Vestibules take only their own lamp
 * and are traced in their own frame, which keeps both halves (and both vestibules) identical.
 */
function bake(group: THREE.Group, lamps: Lamp[], stairLamps: Partial<Record<Exit, Lamp>>) {
  const meshes: { mesh: THREE.Mesh; exit: Exit | null; solid: number }[] = [];
  const flights: { mesh: THREE.Mesh; exit: Exit }[] = [];
  const walk = (o: THREE.Object3D, exit: Exit | null, solid: number, stairs: Exit | null) => {
    const e: Exit | null = o.userData.vestibule ?? exit;
    const s = o.userData.solid ? (SOLID_INDEX.get(o.userData.solid) ?? -1) : solid;
    const st: Exit | null = o.userData.stairs ?? stairs;
    if (isBaked(o)) {
      if (st) flights.push({ mesh: o, exit: st });
      else meshes.push({ mesh: o, exit: e, solid: s });
    }
    for (const c of o.children) walk(c, e, s, st);
  };
  walk(group, null, -1, null);
  // the stairs are small and only there once a run: baked every time, outside the cache
  if (flights.length) {
    const ctx = lightContext(lamps, stairLamps);
    for (const { mesh, exit } of flights) {
      const f = ctx.flights.find((f) => f.exit === exit)!;
      setBaked(mesh.geometry, bakeMesh(mesh, f.space, f.lamps, []));
    }
  }
  const cache = bakeCache;
  if (cache?.length === meshes.length && meshes.every(({ mesh }, i) => cache[i].w.length === mesh.geometry.attributes.position.count * 4)) {
    meshes.forEach(({ mesh }, i) => setBaked(mesh.geometry, cache[i]));
    return 0;
  }
  const t0 = performance.now();
  const { cell, cellLamps, windows, vest } = lightContext(lamps);
  bakeCache = meshes.map(({ mesh, exit, solid }) => {
    const v = vest[exit === 'forward' ? 1 : 0];
    cell.skip(solid);
    const b = exit ? bakeMesh(mesh, v.space, v.lamps, []) : bakeMesh(mesh, cell, cellLamps, windows);
    cell.skip(-1);
    setBaked(mesh.geometry, b);
    return b;
  });
  return performance.now() - t0;
}

/**
 * Merges meshes that share a material, to keep draw calls low (docs/DESIGN.md, 4.8). Merging happens
 * within units, each in its own frame: the cell itself, everything an anomaly may move (keep roots)
 * and every named part inside one. A unit can still be moved or hidden as a whole. Vestibules are
 * instanced instead (tambour.ts) and left alone.
 */
function merge(group: THREE.Group) {
  const units = new Set<THREE.Object3D>([group]);
  group.traverse((o) => {
    if (o.userData.keepRoot || (o.name && o !== group)) units.add(o);
  });
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  for (const unit of units) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    const walk = (o: THREE.Object3D) => {
      if (o !== unit && units.has(o)) return;
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
        const mat = o.material as THREE.Material;
        byMat.set(mat, [...(byMat.get(mat) ?? []), o]);
      }
      for (const c of o.children) walk(c);
    };
    walk(unit);
    inv.copy(unit.matrixWorld).invert();
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => m.geometry.clone().applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld)));
      const merged = new THREE.Mesh(mergeGeometries(geos), mat);
      merged.renderOrder = list[0].renderOrder;
      merged.userData.keep = unit !== group;
      for (const g of geos) g.dispose();
      for (const m of list) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      unit.add(merged);
      merged.updateMatrixWorld();
    }
  }
}
