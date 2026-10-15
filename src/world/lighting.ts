import * as THREE from 'three';
import {
  DOORWAYS,
  LEG1,
  LEG2,
  MID,
  ROOMS,
  VEST_H,
  doorRect,
  onSide,
  roomAt,
  type Frame,
  type Rect,
  type RoomId,
} from '../../shared/map.ts';
import { addSmog } from './smog.ts';

/**
 * Baked light (docs/DESIGN.md, 4.1). The cell never moves, so light is worked out once per vertex
 * when the world is built: direct light of every lamp with occlusion by walls, soft daylight from
 * the windows, a rough bounce, and darkening in corners (ambient occlusion). Lamps stay switchable:
 * each vertex keeps the weights of the four lamps that light it most, and the shader multiplies them
 * by each lamp's current colour, so a dead, flickering or red lamp needs no rebake.
 *
 * Units follow three.js: a channel's colour is linear colour times intensity (candela), a weight is
 * the geometric factor (falloff times cosine times visibility), and their product is irradiance,
 * which the shader feeds to the material as indirect diffuse light.
 */

export const MAX_CHANNELS = 32;
/** Channel 0 is daylight from all windows; lamps take the rest in build order. */
export const DAYLIGHT = 0;
/** Current colour of every channel, shared by all baked materials. */
export const CHANNELS = { value: Array.from({ length: MAX_CHANNELS }, () => new THREE.Vector3()) };

/** Faint light from everywhere and nowhere, so the darkest corner isn't pure black. */
const AMBIENT = 0.012;
/** Rough single bounce: a lamp also lifts its whole room by this much per candela per m² of floor. */
const BOUNCE = 0.35;
const LAMP_REACH = 7;
/** Daylight from further than this is under 3% of what it is by the window: not traced. */
const WINDOW_REACH = 8;
/** Within about this distance a lamp stops getting brighter (its bulb has a size). */
const NEAR = 0.5;
/** Inverse square that levels off smoothly near the source: a hard clamp leaves a ring on the ceiling. */
const falloff = (d: number, near = NEAR) => 1 / (d * d + near * near);
const AO_RAYS = 12;
const AO_LEN = 0.55;
const STEP = 0.1;
/** Objects smaller than this (bounding radius) are lit as a whole, from their centre. */
const SMALL = 0.25;
/** Points are lifted this far off their surface before tracing, so they don't hit it. */
const LIFT = 0.012;

export interface LightSource {
  pos: THREE.Vector3;
  channel: number;
  /** Room whose bounce it lifts. */
  room: RoomId | 'vestibule';
  /** Size of the source, where it stops getting brighter (NEAR when left out). */
  near?: number;
}

/** A window as a soft area light: a few points on its opening shining into the room. */
export interface WindowSource {
  points: THREE.Vector3[];
  /** Into the room. */
  normal: THREE.Vector3;
  /** Area each point stands for. */
  area: number;
  room: RoomId;
}

/** Where light can travel: open space is everything between floors, walls and ceilings. */
export interface Space {
  open(x: number, y: number, z: number): boolean;
  /** Nothing solid between a and b (the ends themselves are not checked). */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** Room whose bounce reaches this point, if any. */
  room(x: number, z: number): RoomId | 'vestibule' | null;
  /** Floor area of a room, for the bounce. */
  area(room: RoomId | 'vestibule'): number;
  /**
   * Leaves one solid out (its index in the list cellSpace was given), or none with -1: a piece of
   * furniture must not shadow its own surfaces, which lie inside its box.
   */
  skip(solid: number): void;
}

export interface Box3 extends Rect {
  lo: number;
  hi: number;
}

const GRID = 0.1;

/**
 * Open space of the cell: rooms, doorways up to their lintel, window reveals between sill and top.
 * Vestibules are not part of it: they are lit on their own (vestibuleSpace).
 */
export function cellSpace(reveal: number, solids: Box3[]): Space {
  const boxes: Box3[] = [
    ...ROOMS.map((r) => ({ ...r.rect, lo: 0, hi: r.height })),
    ...DOORWAYS.filter((d) => d.b !== 'back' && d.b !== 'forward').map((d) => ({ ...doorRect(d), lo: 0, hi: d.height })),
    ...ROOMS.flatMap((r) =>
      r.windows.map((w) => {
        const a = onSide(r.rect, w.side, w.at - w.width / 2);
        const b = onSide(r.rect, w.side, w.at + w.width / 2, reveal);
        return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), lo: w.sill, hi: w.top };
      }),
    ),
  ];
  // A fine grid answers most lookups at once: a cell lies wholly inside one box (then only the
  // height matters), wholly in solid wall, or on a boundary, where the boxes it touches are tested.
  const x0 = Math.min(...boxes.map((b) => b.x0)) - GRID;
  const z0 = Math.min(...boxes.map((b) => b.z0)) - GRID;
  const nx = Math.ceil((Math.max(...boxes.map((b) => b.x1)) - x0) / GRID) + 2;
  const nz = Math.ceil((Math.max(...boxes.map((b) => b.z1)) - z0) / GRID) + 2;
  // cells: a box index when wholly inside it, -1 when solid, otherwise -2 - offset into `lists`,
  // where a count is followed by the indices of the boxes the cell touches; indices past the open
  // boxes are furniture, which is solid inside open space
  const all = [...boxes, ...solids];
  const nOpen = boxes.length;
  const cells = new Int32Array(nx * nz).fill(-1);
  const lists: number[] = [];
  const B = new Float64Array(all.flatMap((b) => [b.x0, b.x1, b.z0, b.z1, b.lo, b.hi]));
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const cx0 = x0 + i * GRID;
      const cz0 = z0 + j * GRID;
      const touching = all.filter((b) => b.x0 < cx0 + GRID && b.x1 > cx0 && b.z0 < cz0 + GRID && b.z1 > cz0);
      if (touching.length === 0) continue;
      const b = touching[0];
      if (touching.length === 1 && all.indexOf(b) < nOpen && b.x0 <= cx0 && b.x1 >= cx0 + GRID && b.z0 <= cz0 && b.z1 >= cz0 + GRID) cells[j * nx + i] = all.indexOf(b);
      else {
        cells[j * nx + i] = -2 - lists.length;
        lists.push(touching.length, ...touching.map((t) => all.indexOf(t)));
      }
    }
  const L = Int32Array.from(lists);
  const areas = new Map(ROOMS.map((r) => [r.id, (r.rect.x1 - r.rect.x0) * (r.rect.z1 - r.rect.z0)]));
  let skipped = -1;
  const open = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / GRID);
    const j = Math.floor((z - z0) / GRID);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const c = cells[j * nx + i];
    if (c >= 0) return y > B[c * 6 + 4] && y < B[c * 6 + 5];
    if (c === -1) return false;
    const at = -2 - c;
    let inside = false;
    for (let m = 1; m <= L[at]; m++) {
      const k = L[at + m];
      const o = k * 6;
      if (y > B[o + 4] && y < B[o + 5] && x >= B[o] && x <= B[o + 1] && z >= B[o + 2] && z <= B[o + 3]) {
        if (k >= nOpen && k !== skipped) return false;
        inside = true;
      }
    }
    return inside;
  };
  return {
    open,
    clear: (ax, ay, az, bx, by, bz) => clearWith(open, ax, ay, az, bx, by, bz),
    room: (x, z) => roomAt(x, z)?.id ?? null,
    area: (r) => areas.get(r as RoomId) ?? 1,
    skip: (k) => (skipped = k < 0 ? -1 : nOpen + k),
  };
}

/**
 * Open space of one vestibule, worked out in its own frame, with the doorway treated as a wall.
 * The shape is then exactly symmetric under the half turn, so both halves bake alike.
 */
export function vestibuleSpace(f: Frame): Space {
  const parts = [LEG1, MID, LEG2];
  const area = parts.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
  // Lenient by EPS: points lying exactly on a wall (edges of the cable channel) must come out the
  // same in both halves, whichever way rounding goes.
  const EPS = 1e-6;
  const open = (x: number, y: number, z: number) => {
    if (y < -EPS || y > VEST_H + EPS) return false;
    // toLocal, inlined: this runs millions of times while baking
    const dx = x - f.ox;
    const dz = z - f.oz;
    const u = dx * f.rx + dz * f.rz;
    const v = dx * f.fx + dz * f.fz;
    for (const r of parts) if (u >= r.u0 - EPS && u <= r.u1 + EPS && v >= r.v0 - EPS && v <= r.v1 + EPS) return true;
    return false;
  };
  return {
    open,
    clear: (ax, ay, az, bx, by, bz) => clearWith(open, ax, ay, az, bx, by, bz),
    room: () => 'vestibule',
    area: () => area,
    skip: () => {},
  };
}

/**
 * Samples a segment every STEP. Walls are WALL_T (0.12 m) thick, more than a step, so a segment
 * can't slip through one. Each space calls it with its own `open`, so the call stays monomorphic
 * and gets inlined: this is the hot loop of the bake.
 */
function clearWith(
  open: (x: number, y: number, z: number) => boolean,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const n = Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / STEP);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!open(ax + dx * t, ay + dy * t, az + dz * t)) return false;
  }
  return true;
}

const visible = (space: Space, p: THREE.Vector3, q: THREE.Vector3) => space.clear(p.x, p.y, p.z, q.x, q.y, q.z);

/**
 * Fixed directions on the hemisphere around +z, cosine weighted: rings of four, a quarter turn
 * apart. The set looks the same after any quarter turn about the normal, and the tangent frame
 * (openness) follows the walls, so a vestibule turned by 90° or 180° gets exactly the same rays.
 */
const HEMI_DIRS = Array.from({ length: AO_RAYS }, (_, i) => {
  const ring = Math.floor(i / 4);
  const rings = AO_RAYS / 4;
  const r = Math.sqrt((ring + 0.5) / rings);
  const a = ring * 0.6 + ((i % 4) * Math.PI) / 2;
  return new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - r * r));
});

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tan = new THREE.Vector3();
const bit = new THREE.Vector3();
const ray = new THREE.Vector3();

/** Share of short rays from p around normal n that escape: 1 in the open, lower in corners. */
function openness(space: Space, p: THREE.Vector3, n: THREE.Vector3) {
  // tangent: "up" along a wall, world x on floors and ceilings
  tan.copy(Math.abs(n.y) < 0.99 ? Y : X).addScaledVector(n, -(Math.abs(n.y) < 0.99 ? n.y : n.x)).normalize();
  bit.crossVectors(n, tan);
  let free = 0;
  for (const d of HEMI_DIRS) {
    ray.set(0, 0, 0).addScaledVector(tan, d.x).addScaledVector(bit, d.y).addScaledVector(n, d.z);
    if (space.clear(p.x, p.y, p.z, p.x + ray.x * AO_LEN, p.y + ray.y * AO_LEN, p.z + ray.z * AO_LEN)) free++;
  }
  return free / AO_RAYS;
}

export interface Probe {
  base: THREE.Vector3;
  idx: THREE.Vector4;
  w: THREE.Vector4;
  /** Which room it stands in (roomIndex), for the flashlights' beams; set by World.probe. */
  room?: { value: number };
}

/**
 * Rooms by number, for the beams (flashlight.ts): the cell's rooms in ROOMS order, then one number
 * for both vestibules and their stairs (a beam can't reach from one to the other: they are 20 m
 * apart), -1 for anything outside.
 */
export const VEST_ROOM = ROOMS.length;
const DOOR_ROOMS = DOORWAYS.filter((d) => !d.closed).map((d) => ({ r: doorRect(d), a: ROOMS.findIndex((room) => room.id === d.a) }));
export function roomIndex(x: number, z: number) {
  const r = roomAt(x, z);
  if (r) return ROOMS.indexOf(r);
  // in a doorway: the room it belongs to
  return DOOR_ROOMS.find((d) => x >= d.r.x0 && x <= d.r.x1 && z >= d.r.z0 && z <= d.r.z1)?.a ?? -1;
}

const toL = new THREE.Vector3();

/**
 * Light reaching point p. With a normal it is the irradiance of a surface; without one it is a
 * rough average over directions, for things that move around (people).
 */
export function gather(space: Space, lamps: LightSource[], windows: WindowSource[], p: THREE.Vector3, n: THREE.Vector3 | null, out: Probe) {
  const ao = n ? openness(space, p, n) : 1;
  const room = space.room(p.x, p.z);
  const w = new Map<number, number>();
  const add = (ch: number, v: number) => w.set(ch, (w.get(ch) ?? 0) + v);
  for (const l of lamps) {
    toL.subVectors(l.pos, p);
    const d = toL.length();
    if (d > LAMP_REACH) continue;
    const cos = n ? n.dot(toL) / d : 0.5;
    if (cos <= 0) continue;
    if (!visible(space, p, l.pos)) continue;
    const fall = falloff(d, l.near) * Math.max(0, 1 - (d / LAMP_REACH) ** 4) ** 2;
    // corners also dim direct light a little: softer, more solid-looking shapes
    add(l.channel, fall * cos * (0.55 + 0.45 * ao));
  }
  for (const l of lamps) if (l.room === room) add(l.channel, (BOUNCE / space.area(room)) * ao);
  // daylight stays in the room of its window: what gets through a doorway is too faint to trace
  for (const win of windows) {
    if (win.room !== room) continue;
    add(DAYLIGHT, ((BOUNCE * win.area * win.points.length) / space.area(room)) * ao);
    for (const q of win.points) {
      toL.subVectors(q, p);
      const d = toL.length();
      if (d > WINDOW_REACH) continue;
      const cosR = n ? n.dot(toL) / d : 0.5;
      const cosS = -win.normal.dot(toL) / d;
      if (cosR <= 0 || cosS <= 0) continue;
      if (!visible(space, p, q)) continue;
      add(DAYLIGHT, win.area * cosS * cosR * falloff(d) * ao);
    }
  }
  // the strongest four stay switchable; the rest is frozen into the base at today's colours
  const top = [...w.entries()].sort((a, b) => b[1] - a[1]);
  out.base.setScalar(AMBIENT * ao);
  out.idx.set(0, 0, 0, 0);
  out.w.set(0, 0, 0, 0);
  top.forEach(([ch, v], i) => {
    if (i < 4) {
      out.idx.setComponent(i, ch);
      out.w.setComponent(i, v);
    } else out.base.addScaledVector(CHANNELS.value[ch], v);
  });
  return out;
}

const pw = new THREE.Vector3();
const toC = new THREE.Vector3();
const nw = new THREE.Vector3();
const nmat = new THREE.Matrix3();

/** Bakes every vertex of a mesh into the attributes bakeBase, bakeIdx and bakeW. */
export function bakeMesh(mesh: THREE.Mesh, space: Space, lamps: LightSource[], windows: WindowSource[]) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const base = new Float32Array(pos.count * 3);
  const idx = new Float32Array(pos.count * 4);
  const wt = new Float32Array(pos.count * 4);
  mesh.updateWorldMatrix(true, false);
  // instanced vestibule halves are baked where their first instance stands (tambour.ts)
  const world: THREE.Matrix4 = mesh.userData.bakeMatrix ?? mesh.matrixWorld;
  nmat.getNormalMatrix(world);
  const room = new Float32Array(pos.count);
  const vest = space.room(0, 0) === 'vestibule';
  const where = (p: THREE.Vector3) => (vest ? VEST_ROOM : roomIndex(p.x, p.z));
  const probe: Probe = { base: new THREE.Vector3(), idx: new THREE.Vector4(), w: new THREE.Vector4() };
  // small things (lamp fittings, wires) take one sample for the whole object: their own vertices
  // would cost a third of the bake and show nothing more
  geo.computeBoundingSphere();
  const sphere = geo.boundingSphere!.clone().applyMatrix4(world);
  if (sphere.radius < SMALL) {
    gather(space, lamps, windows, sphere.center, null, probe);
    room.fill(where(sphere.center));
    for (let i = 0; i < pos.count; i++) {
      probe.base.toArray(base, i * 3);
      probe.idx.toArray(idx, i * 4);
      probe.w.toArray(wt, i * 4);
    }
    return { base, idx, w: wt, room };
  }
  for (let i = 0; i < pos.count; i++) {
    nw.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
    pw.fromBufferAttribute(pos, i).applyMatrix4(world);
    // Off the surface, and a little in from its edges: a vertex exactly where wall meets ceiling
    // would otherwise be in or out by rounding, differently in the two halves of a vestibule.
    toC.subVectors(sphere.center, pw);
    toC.addScaledVector(nw, -toC.dot(nw));
    const len = toC.length();
    if (len > 1e-6) pw.addScaledVector(toC, Math.min(LIFT, len) / len);
    pw.addScaledVector(nw, LIFT);
    gather(space, lamps, windows, pw, nw, probe);
    probe.base.toArray(base, i * 3);
    probe.idx.toArray(idx, i * 4);
    probe.w.toArray(wt, i * 4);
    // a wall's vertex belongs to the room it faces
    room[i] = where(pw.addScaledVector(nw, 0.05));
  }
  return { base, idx, w: wt, room };
}

export type Baked = ReturnType<typeof bakeMesh>;

export function setBaked(geo: THREE.BufferGeometry, b: Baked) {
  geo.setAttribute('bakeBase', new THREE.BufferAttribute(b.base, 3));
  geo.setAttribute('bakeIdx', new THREE.BufferAttribute(b.idx, 4));
  geo.setAttribute('bakeW', new THREE.BufferAttribute(b.w, 4));
  geo.setAttribute('bakeRoom', new THREE.BufferAttribute(b.room, 1));
}

const CHANNEL_SUM = /* glsl */ `
  uniform vec3 uChan[${MAX_CHANNELS}];
  vec3 bakedLight(vec3 base, vec4 idx, vec4 w) {
    return base + w.x * uChan[int(idx.x)] + w.y * uChan[int(idx.y)] + w.z * uChan[int(idx.z)] + w.w * uChan[int(idx.w)];
  }
`;

/** How many flashlight beams the shader takes at once: one per player. */
export const MAX_BEAMS = 6;
const v3s = () => Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3());
/**
 * The flashlights' beams (flashlight.ts), shared by every baked material like CHANNELS: the only
 * light that isn't baked. All in view space, worked out on the CPU in double precision every frame,
 * so a beam lights both vestibules' instances the same (the loop). Each lights the room it is in
 * (by the bakeRoom attribute) and the next room only through the doorway it points through: no
 * shadow maps, so a beam doesn't go through walls, but furniture casts no shadow.
 */
export const BEAMS = {
  uBeamN: { value: 0 },
  /** Origin and unit direction. */
  uBeamPos: { value: v3s() },
  uBeamDir: { value: v3s() },
  /** Colour times intensity, candela. */
  uBeamColor: { value: v3s() },
  /** The room it is in, and the room past the doorway it points through (-2: none). */
  uBeamRoom: { value: new Array<number>(MAX_BEAMS).fill(-2) },
  uBeamNext: { value: new Array<number>(MAX_BEAMS).fill(-2) },
  /** That doorway: a corner and its two edges. */
  uDoorO: { value: v3s() },
  uDoorU: { value: v3s() },
  uDoorV: { value: v3s() },
};
/** cos of the half angles of a beam: the bright middle, and where it fades out. */
export const BEAM_INNER = Math.cos(0.16);
export const BEAM_OUTER = Math.cos(0.4);
/** A beam reaches no further than this, metres; the two vestibules are 20 m apart. */
export const BEAM_REACH = 9;

const BEAM_LIGHT = /* glsl */ `
  uniform int uBeamN;
  uniform vec3 uBeamPos[${MAX_BEAMS}];
  uniform vec3 uBeamDir[${MAX_BEAMS}];
  uniform vec3 uBeamColor[${MAX_BEAMS}];
  uniform float uBeamRoom[${MAX_BEAMS}];
  uniform float uBeamNext[${MAX_BEAMS}];
  uniform vec3 uDoorO[${MAX_BEAMS}];
  uniform vec3 uDoorU[${MAX_BEAMS}];
  uniform vec3 uDoorV[${MAX_BEAMS}];
  flat varying float vRoom;
  vec3 beamLight(vec3 p, vec3 n) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${MAX_BEAMS}; i++) {
      if (i >= uBeamN) break;
      vec3 d = p - uBeamPos[i];
      float len = length(d);
      if (len > ${BEAM_REACH.toFixed(1)} || len < 1e-3) continue;
      vec3 l = d / len;
      float cone = smoothstep(${BEAM_OUTER.toFixed(5)}, ${BEAM_INNER.toFixed(5)}, dot(l, uBeamDir[i]));
      if (cone <= 0.0) continue;
      float here = abs(vRoom - uBeamRoom[i]) < 0.5 ? 1.0 : 0.0;
      if (here == 0.0 && abs(vRoom - uBeamNext[i]) < 0.5) {
        // only what is seen through the doorway: the way to it crosses the doorway's rectangle
        vec3 nd = cross(uDoorU[i], uDoorV[i]);
        float den = dot(nd, d);
        if (abs(den) > 1e-6) {
          float t = dot(nd, uDoorO[i] - uBeamPos[i]) / den;
          vec3 x = uBeamPos[i] + d * t - uDoorO[i];
          float a = dot(x, uDoorU[i]) / dot(uDoorU[i], uDoorU[i]);
          float b = dot(x, uDoorV[i]) / dot(uDoorV[i], uDoorV[i]);
          here = t > 0.0 && t < 1.0 && a >= 0.0 && a <= 1.0 && b >= 0.0 && b <= 1.0 ? 1.0 : 0.0;
        }
      }
      float fade = 1.0 - smoothstep(${(BEAM_REACH * 0.65).toFixed(1)}, ${BEAM_REACH.toFixed(1)}, len);
      // the bulb sits in a reflector: close up the spot spreads instead of burning out
      sum += uBeamColor[i] * (here * cone * fade * max(dot(n, -l), 0.0) / (len * len + 1.0));
    }
    return sum;
  }
`;

/**
 * Makes a material take its light from the bake instead of from scene lights: per vertex
 * (meshes with bake attributes) or from one probe for the whole object (people, props that move).
 * The light goes in where three.js puts image-based diffuse light, so an environment map still adds
 * its reflections but not its diffuse glow.
 */
export function useBaked<M extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(mat: M, probe?: Probe): M {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uChan = CHANNELS;
    Object.assign(sh.uniforms, BEAMS);
    if (probe) {
      sh.uniforms.uProbeBase = { value: probe.base };
      sh.uniforms.uProbeIdx = { value: probe.idx };
      sh.uniforms.uProbeW = { value: probe.w };
      sh.uniforms.uProbeRoom = probe.room ?? { value: -1 };
    }
    const decl = probe
      ? 'uniform vec3 uProbeBase; uniform vec4 uProbeIdx; uniform vec4 uProbeW; uniform float uProbeRoom;'
      : 'attribute vec3 bakeBase; attribute vec4 bakeIdx; attribute vec4 bakeW; attribute float bakeRoom;';
    const value = probe ? 'bakedLight(uProbeBase, uProbeIdx, uProbeW)' : 'bakedLight(bakeBase, bakeIdx, bakeW)';
    const room = probe ? 'uProbeRoom' : 'bakeRoom';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${CHANNEL_SUM}\n${decl}\nvarying vec3 vBaked;\nflat varying float vRoom;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBaked = ${value};\nvRoom = ${room};`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBaked;\n${BEAM_LIGHT}`)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\niblIrradiance = vBaked + beamLight(-vViewPosition, normal);');
    addSmog(sh);
  };
  mat.customProgramCacheKey = () => (probe ? 'baked-probe' : 'baked');
  // only per-vertex baked materials take part in the bake (index.ts); probe-lit ones carry their own light
  mat.userData.baked = !probe;
  return mat;
}

/** Colour temperature that looks white, as a camera's white balance: warmer lamps look warm, not orange. */
const WHITE_K = 3500;

/** Light colour at this temperature, white balanced to WHITE_K, brightest channel 1. */
export function kelvin(k: number) {
  const c = blackBody(k);
  const w = blackBody(WHITE_K);
  c.r /= w.r;
  c.g /= w.g;
  c.b /= w.b;
  return c.multiplyScalar(1 / Math.max(c.r, c.g, c.b));
}

/** Approximate colour of a black body at this temperature (Tanner Helland's fit). */
function blackBody(k: number) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}
