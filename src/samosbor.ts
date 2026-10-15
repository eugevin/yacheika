import * as THREE from 'three';
import { FURNITURE } from '../shared/furniture.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOORWAYS, ROOMS, VESTIBULES, canStand, doorRect, toWorld } from '../shared/map.ts';
import { SAMOSBOR, type SamosborTimes } from '../shared/rules.ts';
import { eyeOf, sees } from './gaze.ts';
import { canvasTexture, rng } from './textures.ts';
import { NORMAL } from './world/geometry.ts';
import { CHANNELS, DAYLIGHT } from './world/lighting.ts';
import { VENTS } from './world/rooms/index.ts';
import { SMOG, setSmogColor, smogged } from './world/smog.ts';
import type { World } from './world/index.ts';

/**
 * A samosbor (docs/DESIGN.md, 7.1, 4.7), played over the cell the group got wrong; the cell is
 * rebuilt afterwards, so nothing here is undone. Times are seconds from the verdict (SAMOSBOR, or
 * SAMOSBOR_BIG for the second mistake in a row, which is longer and slower):
 *   0.0  every lamp goes red and dim, the windows grey out, the siren winds up (audio.ts, Sound.samosbor);
 *   0.8  the warning on the loudspeakers (main.ts shows it), the big one says it again later;
 *   2.5  rusty fog pours from the vents and from under the doors, and thickens: you see 40 m, then 2;
 *        dark figures stand at the edge of what can be seen, and are gone when looked at;
 *   6.0  squelching all round, the light stutters, the edges of the screen swim;
 *   8.8  the fog has covered the screen;
 *   9.4  the cell's background goes quiet, and the server starts the next cycle at 10 (SAMOSBOR_MS).
 */
/** Seeing distance, metres, as the fog comes in. */
const SEE_FROM = 40;
const SEE_TO = 2;
/** Emergency light: the lamps' own channels in red, this bright. */
const EMERGENCY = new THREE.Color(1, 0.07, 0.03);
const EMERGENCY_LEVEL = 0.55;
/** Colour of the fog on screen; sRGB, also used by the full-screen veil (index.html, #veil). */
export const SMOG_RGB = [0.36, 0.2, 0.11] as const;

const PUFFS = 320;
const PUFF_LIFE = 5;
/** Dark figures in the fog: how many, and the band of seeing distance they stand in. */
const FIGURES = 5;
const FIGURE_NEAR = 0.45;
const FIGURE_FAR = 0.95;
/** Looked at for this long, a figure is gone for good. */
const FIGURE_SEEN = 0.2;
/** The middle of the view: a figure there is being looked at, not glimpsed. */
const LOOKED_AT = { h: 0.35, v: 0.45 };

interface Source {
  p: THREE.Vector3;
  /** Which way it pours out, horizontal. */
  dir: THREE.Vector3;
  /** Pours from high up: sinks while it spreads. */
  high: boolean;
  /** When it starts, seconds. */
  from: number;
}

interface Puff {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  sink: boolean;
}

export class Samosbor {
  /** Seconds since the verdict. */
  t = 0;
  readonly times: SamosborTimes;
  private readonly world: World;
  private readonly sources: Source[];
  private readonly puffs: Puff[] = [];
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly daylight: THREE.Vector3;
  private readonly r = rng(1711);
  private next: number[];
  private readonly figures: THREE.InstancedMesh;
  /** Where each figure may stand, and how long it has been looked at (Infinity once gone). */
  private readonly spots: { x: number; z: number; seen: number }[];
  /** How far one can see through the fog right now, metres. */
  private see = SEE_FROM;

  /** `seed`: the cycle's id, the same on every screen, so the figures stand in the same places for everyone. */
  constructor(world: World, times: SamosborTimes = SAMOSBOR, seed = 0) {
    this.world = world;
    this.times = times;
    this.sources = sources(world, times.fog);
    this.next = this.sources.map((s) => s.from);
    this.daylight = CHANNELS.value[DAYLIGHT].clone();
    for (const l of world.lamps) l.tint(EMERGENCY);

    // all puffs in one draw call: camera-facing quads placed in the vertex shader
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 4), 4);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 2), 2);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPuff', this.attr);
    geo.setAttribute('aFade', this.fade);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, puffMaterial());
    this.mesh.frustumCulled = false;
    // marks are placed on the cell, not on the fog
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 5;
    world.group.add(this.mesh);

    // the figures: one shape, instanced, each standing at a spot of the cycle's own
    const body = new THREE.CapsuleGeometry(0.2, 1.0, 4, 10).translate(0, 0.95, 0).scale(1, 1, 0.6);
    const head = new THREE.SphereGeometry(0.12, 10, 8).translate(0, 1.68, 0);
    this.figures = new THREE.InstancedMesh(mergeGeometries([body, head])!, smogged(new THREE.MeshBasicMaterial({ color: 0x0e0d0c })), FIGURES);
    body.dispose();
    head.dispose();
    this.figures.frustumCulled = false;
    this.figures.raycast = () => {};
    this.spots = figureSpots(seed);
    world.group.add(this.figures);
    this.update(0);
  }

  /** How much of the screen the fog has covered, 0..1 (the full-screen veil). */
  get veil() {
    return THREE.MathUtils.smoothstep(this.t, this.times.veil, this.times.covered);
  }

  /** How far the swimming at the screen edges has got, 0..1. */
  get warp() {
    return THREE.MathUtils.smoothstep(this.t, this.times.flicker, this.times.covered);
  }

  /** `camera`: ours, for the figures that vanish once looked at. */
  update(dt: number, camera?: THREE.Camera) {
    this.t += dt;
    const t = this.t;
    const times = this.times;
    // the light: red and dim at once, stuttering later, a deterministic stutter
    let level = EMERGENCY_LEVEL;
    if (t >= times.flicker) {
      const k = Math.floor(t * 14);
      const n = Math.sin(k * 12.9898) * 43758.5453;
      const r = n - Math.floor(n);
      level *= r < 0.22 ? 0.08 : r < 0.4 ? 0.5 : 1;
    }
    for (const l of this.world.lamps) l.set(level);
    CHANNELS.value[DAYLIGHT].copy(this.daylight).multiplyScalar(0.3 * (level / EMERGENCY_LEVEL));
    if (t >= times.silence) this.world.silent = true;

    // the fog: seeing distance along the floor falls from 40 m to 2 m; it lies low at first, a
    // layer over the floor, and rises as it thickens
    const f = THREE.MathUtils.smoothstep(t, times.fog, times.covered) ** 1.4;
    const see = (this.see = SEE_FROM * (SEE_TO / SEE_FROM) ** f);
    const per = f > 0 ? 3 / see : 0;
    SMOG.uSmogEven.value = per * 0.12;
    SMOG.uSmogFloor.value = per;
    SMOG.uSmogFall.value = 2.4 - 1.5 * f;
    const light = 0.35 + 0.65 * (level / EMERGENCY_LEVEL);
    setSmogColor(SMOG_RGB[0] * light, SMOG_RGB[1] * light, SMOG_RGB[2] * light);

    this.pour(t, dt);
    this.drift(dt);
    this.draw();
    this.stand(dt, camera);
  }

  /**
   * The figures: each shows only while it stands at the edge of what the fog lets one see, turned
   * to us, and is gone for good once looked at straight.
   */
  private stand(dt: number, camera?: THREE.Camera) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const eye = camera ? eyeOf(camera) : null;
    const on = this.t >= this.times.fog + 1.5 && this.t < this.times.covered;
    this.spots.forEach((s, i) => {
      const d = eye ? Math.hypot(s.x - eye.x, s.z - eye.z) : 0;
      const shown = on && eye !== null && s.seen < FIGURE_SEEN && d > 1.2 && d > this.see * FIGURE_NEAR && d < this.see * FIGURE_FAR;
      if (shown && eye) {
        if (sees(this.world, eye, s.x, 1.3, s.z, LOOKED_AT)) s.seen += dt;
        q.setFromAxisAngle(up, Math.atan2(eye.x - s.x, eye.z - s.z));
        m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(1, 1, 1));
      } else m.makeScale(0, 0, 0);
      this.figures.setMatrixAt(i, m);
    });
    this.figures.instanceMatrix.needsUpdate = true;
  }

  /** New puffs at every source that has started, a few a second each. */
  private pour(t: number, dt: number) {
    if (dt <= 0) return;
    const r = this.r;
    this.sources.forEach((s, i) => {
      while (this.next[i] <= t && this.puffs.length < PUFFS) {
        this.next[i] += 0.28 + r() * 0.2;
        const side = new THREE.Vector3(-s.dir.z, 0, s.dir.x).multiplyScalar((r() - 0.5) * (s.high ? 0.15 : 0.7));
        const speed = s.high ? 0.35 + r() * 0.2 : 0.45 + r() * 0.35;
        this.puffs.push({
          p: s.p.clone().add(side),
          v: s.dir.clone().multiplyScalar(speed).add(side.clone().multiplyScalar(0.6)),
          age: 0,
          life: PUFF_LIFE * (0.8 + r() * 0.4),
          size: s.high ? 0.22 : 0.3,
          grow: 0.25 + r() * 0.2,
          sink: s.high,
        });
      }
    });
  }

  private drift(dt: number) {
    for (const p of this.puffs) {
      p.age += dt;
      p.size += p.grow * dt;
      p.v.multiplyScalar(Math.exp(-dt * 0.45));
      p.p.addScaledVector(p.v, dt);
      // heavy fog: what pours from a vent sinks to the floor, everything hugs it
      const floor = p.size * 0.42;
      if (p.sink && p.p.y > floor) p.p.y = Math.max(floor, p.p.y - dt * 0.45);
      else p.p.y = floor;
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.puffs[i].age >= this.puffs[i].life) this.puffs.splice(i, 1);
  }

  private draw() {
    const a = this.attr.array as Float32Array;
    const f = this.fade.array as Float32Array;
    this.puffs.forEach((p, i) => {
      a.set([p.p.x, p.p.y, p.p.z, p.size], i * 4);
      const x = p.age / p.life;
      f[i * 2] = Math.min(1, x * 4) * (1 - x) ** 1.5 * 0.75;
      f[i * 2 + 1] = i * 2.399;
    });
    this.mesh.geometry.instanceCount = this.puffs.length;
    this.attr.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}

/** The fog off: for the next cell, which is built clean. */
export function clearSmog() {
  SMOG.uSmogEven.value = 0;
  SMOG.uSmogFloor.value = 0;
}

/**
 * Where the fog comes in: the vents of the kitchen and the wet rooms, under the neighbours' doors
 * and the pantry door, out of the rubbish chute, and both vestibules from either end.
 */
function sources(world: World, fogFrom: number): Source[] {
  const list: Source[] = [];
  const add = (p: THREE.Vector3, dir: THREE.Vector3, high: boolean, from: number) => list.push({ p, dir: dir.setY(0).normalize(), high, from });
  for (const v of VENTS) {
    const [nx, nz] = NORMAL[v.facing];
    add(new THREE.Vector3(v.x + nx * 0.15, v.y - 0.05, v.z + nz * 0.15), new THREE.Vector3(nx, 0, nz), true, fogFrom);
  }
  const o = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (const leaf of Object.values(world.props.common.neighbourDoors)) {
    // the door frame's local +z faces the corridor
    const frame = leaf.parent!;
    frame.localToWorld(o.set(0, 0.1, 0.15));
    frame.localToWorld(out.set(0, 0.1, 1.15));
    add(o.clone(), out.clone().sub(o), false, fogFrom + 0.3);
  }
  const pantry = DOORWAYS.find((d) => d.b === 'pantry')!;
  const pr = doorRect(pantry);
  add(new THREE.Vector3(pr.x0 - 0.15, 0.1, (pr.z0 + pr.z1) / 2), new THREE.Vector3(-1, 0, 0), false, fogFrom + 0.2);
  const chute = FURNITURE.chute;
  add(new THREE.Vector3((chute.x0 + chute.x1) / 2, 0.7, chute.z1 + 0.15), new THREE.Vector3(0, 0, 1), true, fogFrom + 0.5);
  for (const f of Object.values(VESTIBULES)) {
    const a = toWorld(f, 0, 0.4);
    const b = toWorld(f, 6, 8.0);
    add(new THREE.Vector3(a.x, 0.1, a.z), new THREE.Vector3(f.fx, 0, f.fz), false, fogFrom);
    add(new THREE.Vector3(b.x, 0.1, b.z), new THREE.Vector3(-f.fx, 0, -f.fz), false, fogFrom + 0.2);
  }
  return list;
}

/** Where the figures of a samosbor stand: a few free spots on the floors of the cell, picked by the seed. */
function figureSpots(seed: number) {
  const r = rng(seed * 7919 + 13);
  const rooms = ROOMS.filter((room) => room.id !== 'pantry');
  const out: { x: number; z: number; seen: number }[] = [];
  for (let tries = 0; out.length < FIGURES && tries < 400; tries++) {
    const room = rooms[Math.floor(r() * rooms.length)].rect;
    const x = room.x0 + 0.4 + r() * (room.x1 - room.x0 - 0.8);
    const z = room.z0 + 0.4 + r() * (room.z1 - room.z0 - 0.8);
    if (canStand(x, z, 0.35)) out.push({ x, z, seen: 0 });
  }
  return out;
}

let puffTexture: THREE.Texture | null = null;

/** A soft lumpy blob: overlapping radial gradients. */
function puffMap() {
  return (puffTexture ??= canvasTexture(128, 128, (g, w, h) => {
    const r = rng(77);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 0.22 * w;
      const x = w / 2 + Math.cos(a) * d;
      const y = h / 2 + Math.sin(a) * d;
      const rad = (0.16 + r() * 0.14) * w;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }));
}

function puffMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: puffMap() }, ...SMOG },
    vertexShader: /* glsl */ `
      attribute vec4 aPuff;
      attribute vec2 aFade;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vY;
      void main() {
        float c = cos(aFade.y), s = sin(aFade.y);
        vUv = mat2(c, -s, s, c) * (uv - 0.5) + 0.5;
        vAlpha = aFade.x;
        // facing the camera: its right and up, in world space
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 p = aPuff.xyz + (right * position.x + up * position.y) * aPuff.w * 2.0;
        vY = p.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uSmogColor;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vY;
      void main() {
        // fades out into the floor rather than being cut by it
        float a = texture2D(map, vUv).a * vAlpha * smoothstep(0.0, 0.3, vY);
        // round off the corners whatever the rotation
        a *= smoothstep(0.5, 0.3, length(vUv - 0.5));
        gl_FragColor = vec4(uSmogColor * 1.45, a);
      }`,
  });
}
