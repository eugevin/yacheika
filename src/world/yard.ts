import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WING } from '../../shared/map.ts';
import { canvasTexture, rng } from '../textures.ts';
import { SMOG, SMOG_FRAGMENT, SMOG_FRAGMENT_DECL, SMOG_VERTEX_DECL, smogVertex } from './smog.ts';

/**
 * The yard of the Gigakhrushch behind the windows (docs/DESIGN.md, 3.5), at night: rows of identical
 * panel blocks sinking into black murk, their lit windows going on further than anything else can be
 * seen. Down on the ground, sodium lamps along the drives and a bulb over every entrance leave pools
 * of orange light on wet asphalt and old snow, with bare trees standing in them; the murk is lit
 * brown from below by them and is black overhead. Nothing out here is lit by the bake: the yard has
 * its own material, with the street light painted into one map of the ground (streetLight) and its
 * own haze (the scene's fog is the dark indoor one). Built from fixed seeds: the yard is the same in
 * every cycle.
 */

/** Height of one storey. Our floor is at y = 0. */
export const STOREY = 2.8;
/** Storeys under ours: the ground is this far down. */
export const BELOW = 6;
export const GROUND_Y = -BELOW * STOREY;
/** The murk, linear: lit brown by the street lamps near the ground, black higher up. */
export const HAZE_LOW = new THREE.Color(0.03, 0.021, 0.014);
export const HAZE_HIGH = new THREE.Color(0.0035, 0.004, 0.0055);
export const HAZE_DENSITY = 0.0105;
/** Lit windows shine through the murk further than anything lit by them can be seen. */
const GLOW_REACH = 0.55;
/** Light from the sky glow and the town: what an unlit wall gets. */
const NIGHT = 0.035;
/** Lit window glass, and how bright the bulbs of the lamps look: above the bloom threshold. */
export const WINDOW_GLOW = 1.5;
const BULB_GLOW = 9;
/** Sodium lamps on poles, and the bulbs over the entrances: their colours, linear. */
const SODIUM = new THREE.Color(1, 0.5, 0.16);
const PORCH = new THREE.Color(1, 0.72, 0.42);

/**
 * The ground the street light map covers: one texel a metre. Beyond it the murk hides everything
 * that could be lit anyway.
 */
const MAP = { x0: -256, z0: -192, size: 512 };

interface Outdoor {
  map?: THREE.Texture | null;
  /** Scales the texture, for the repeat of `map`. */
  scale?: [number, number];
  color?: THREE.ColorRepresentation;
  /** Light it gets wherever no street lamp reaches (NIGHT for the yard). */
  light?: number;
  /** Lit by the street lamps (see streetLight). */
  street?: boolean;
  /** Glows by itself: `glowMap` times `glow` (lit windows, bulbs). Without a map, the whole surface does. */
  glowMap?: THREE.Texture | null;
  glow?: number;
  /** Walls of our own house: two-sided and black on the inside (see outdoorMaterial). */
  blackInside?: boolean;
  /** Cut out where the map is transparent (trees). */
  cutout?: boolean;
  /** The ground: asphalt where the street light map marks a drive, snowy earth elsewhere. */
  ground?: boolean;
  vertexColors?: boolean;
}

/**
 * Unlit, hazy material for everything outdoors. Walls of our own house are two-sided and black on
 * the inside: sub-pixel cracks where indoor walls meet would otherwise let the yard through,
 * differently in each half of a vestibule.
 */
export function outdoorMaterial(o: Outdoor = {}) {
  const defines: Record<string, string> = {};
  if (o.map) defines.USE_ALBEDO = '';
  if (o.glow) defines.USE_GLOW = '';
  if (o.glowMap) defines.USE_GLOW_MAP = '';
  if (o.street ?? true) defines.USE_STREET = '';
  if (o.cutout) defines.CUTOUT = '';
  if (o.ground) defines.GROUND = '';
  if (o.blackInside) defines.BLACK_INSIDE = '';
  return new THREE.ShaderMaterial({
    side: o.blackInside || o.cutout ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
    defines,
    uniforms: {
      map: { value: o.map ?? null },
      scale: { value: new THREE.Vector2(...(o.scale ?? [1, 1])) },
      tint: { value: new THREE.Color(o.color ?? 0xffffff) },
      light: { value: o.light ?? NIGHT },
      glowMap: { value: o.glowMap ?? null },
      glow: { value: o.glow ?? 0 },
      street: { value: streetLight() },
      ...HAZE_UNIFORMS,
      ...SMOG,
    },
    vertexShader: /* glsl */ `
      uniform vec2 scale;
      ${SMOG_VERTEX_DECL}
      varying vec2 vUv;
      varying float vDist;
      varying vec3 vWorld;
      #ifdef USE_COLOR
        varying vec3 vColor;
      #endif
      void main() {
        vUv = uv * scale;
        #ifdef USE_COLOR
          vColor = color;
        #endif
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; // the gallery skin is instanced with its vestibule (tambour.ts)
        #endif
        vec4 mv = modelViewMatrix * p;
        vDist = length(mv.xyz);
        vWorld = (modelMatrix * p).xyz;
        ${smogVertex('modelMatrix * p')}
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D glowMap;
      uniform vec3 tint;
      uniform float light;
      uniform float glow;
      varying vec2 vUv;
      varying float vDist;
      varying vec3 vWorld;
      #ifdef USE_COLOR
        varying vec3 vColor;
      #endif
      ${HAZE_DECL}
      ${SMOG_FRAGMENT_DECL}
      void main() {
        #ifdef BLACK_INSIDE
          if (!gl_FrontFacing) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }
        #endif
        vec3 albedo = tint;
        #ifdef USE_COLOR
          albedo *= vColor;
        #endif
        #ifdef USE_ALBEDO
          vec4 tex = texture2D(map, vUv);
          #ifdef CUTOUT
            if (tex.a < 0.5) discard;
          #endif
          albedo *= tex.rgb;
        #endif
        vec3 lit = vec3(light);
        #ifdef USE_STREET
          vec4 s = streetAt(vWorld);
          #ifdef GROUND
            // drives: dark wet asphalt, a little glossy in the light; snow and frozen earth elsewhere
            albedo = mix(albedo, vec3(0.05, 0.05, 0.052) * (0.7 + 0.6 * albedo.r), s.b);
            // snow takes the murk's glow from above as well
            lit += ${(NIGHT * 0.8).toFixed(3)} * (1.0 - s.b);
          #endif
          float up = vWorld.y - ${GROUND_Y.toFixed(2)};
          // lamps on poles reach higher up a wall than the bulbs over the entrances
          lit += s.r * (1.0 - smoothstep(3.0, 12.0, up)) * ${vec3(SODIUM)} + s.g * (1.0 - smoothstep(1.5, 7.0, up)) * ${vec3(PORCH)};
        #endif
        vec3 c = albedo * lit;
        float f = haze(vDist);
        c = mix(c, hazeColor(vWorld.y), f);
        #ifdef USE_GLOW
          #ifdef USE_GLOW_MAP
            vec3 g = texture2D(glowMap, vUv).rgb;
          #else
            vec3 g = tint;
          #endif
          // what glows shines through the murk further, and lights none of it
          c += g * glow * (1.0 - haze(vDist * ${GLOW_REACH.toFixed(2)}));
        #endif
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        ${SMOG_FRAGMENT}
      }`,
  });
}

const vec3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

const HAZE_UNIFORMS = {
  hazeLow: { value: HAZE_LOW },
  hazeHigh: { value: HAZE_HIGH },
};

const HAZE_DECL = /* glsl */ `
  uniform vec3 hazeLow;
  uniform vec3 hazeHigh;
  float haze(float d) {
    return 1.0 - exp(-pow(d * ${HAZE_DENSITY}, 1.6));
  }
  vec3 hazeColor(float y) {
    return mix(hazeLow, hazeHigh, smoothstep(${GROUND_Y.toFixed(2)}, ${(GROUND_Y + 60).toFixed(2)}, y));
  }
  uniform sampler2D street;
  vec4 streetAt(vec3 p) {
    return texture2D(street, (p.xz - vec2(${MAP.x0.toFixed(1)}, ${MAP.z0.toFixed(1)})) / ${MAP.size.toFixed(1)});
  }
`;

const cache = new Map<string, THREE.Texture>();
function once<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t as T;
}
export const isYardTexture = (t: THREE.Texture) => [...cache.values()].includes(t);

/** Plain concrete panels with seams, 3 m x 2.8 m to a panel. Our own house, the gallery. */
export function panelTexture() {
  return once('panels', () => {
    const t = canvasTexture(
      256,
      240,
      (g, w, h) => {
        g.fillStyle = '#8d8a84';
        g.fillRect(0, 0, w, h);
        const r = rng(201);
        for (let i = 0; i < 800; i++) {
          g.fillStyle = `rgba(${r() < 0.5 ? '50,48,45' : '170,166,160'},${r() * 0.12})`;
          g.fillRect(r() * w, r() * h, 2 + r() * 8, 2 + r() * 8);
        }
        // rust streaks under the joints
        for (let i = 0; i < 6; i++) {
          g.fillStyle = `rgba(110,75,40,${0.08 + r() * 0.1})`;
          g.fillRect(r() * w, h - 4, 2, -r() * h * 0.6);
        }
        g.fillStyle = '#4e4b46';
        g.fillRect(0, 0, w, 4);
        g.fillRect(0, 0, 4, h);
      },
      true,
    );
    return t;
  });
}

/** One facade texture covers this much wall: four windows across, four storeys up. */
const SECTION: [number, number] = [14.4, 11.2];

/**
 * Four storeys of a panel block, four windows wide (14.4 x 11.2 m): windows, some with balconies
 * and washing. `seed` changes which. With `glow`, the same layout as light: black, and the windows
 * that are lit at night in warm colours, the odd one blue with a television.
 */
function blockTexture(seed: number, glow: boolean) {
  return once(`block${seed}${glow ? 'glow' : ''}`, () =>
    canvasTexture(
      512,
      400,
      (g, w, h) => {
        const r = rng(300 + seed);
        g.fillStyle = glow ? '#000' : '#93908a';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 1200; i++) {
          const s = `rgba(${r() < 0.5 ? '50,48,45' : '170,166,160'},${r() * 0.1})`;
          const [x, y, a, b] = [r() * w, r() * h, 2 + r() * 10, 2 + r() * 10];
          if (glow) continue;
          g.fillStyle = s;
          g.fillRect(x, y, a, b);
        }
        const cw = w / 4;
        const fh = h / 4;
        for (let c = 0; c < 4; c++)
          for (let f = 0; f < 4; f++) {
            const x = c * cw;
            const y = f * fh;
            if (!glow) {
              g.fillStyle = '#6a6862';
              g.fillRect(x, y, cw, 2);
              g.fillRect(x, y, 2, fh);
            }
            const lit = r() < 0.18;
            const wx = x + cw * 0.28;
            const wy = y + fh * 0.22;
            const ww = cw * 0.44;
            const wh = fh * 0.5;
            const tone = r() < 0.5;
            const tv = r() < 0.12;
            if (glow) {
              if (lit) {
                // a lamp somewhere in the room: brighter in the middle, curtains darker at the sides
                const grad = g.createRadialGradient(wx + ww / 2, wy + wh * 0.45, 2, wx + ww / 2, wy + wh * 0.45, ww * 0.7);
                const [hot, edge] = tv ? ['#7f9cc8', '#2c3a52'] : tone ? ['#f2c27a', '#8a5426'] : ['#e9a659', '#6e3a18'];
                grad.addColorStop(0, hot);
                grad.addColorStop(1, edge);
                g.fillStyle = grad;
                g.fillRect(wx, wy, ww, wh);
                g.fillStyle = '#000';
                g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
                g.fillRect(wx, wy + wh * 0.3, ww, 2);
              }
            } else {
              g.fillStyle = tone ? '#1c1f21' : '#25292a';
              g.fillRect(wx, wy, ww, wh);
              g.fillStyle = '#c9c4b8';
              g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
              g.fillRect(wx, wy + wh * 0.3, ww, 2);
            }
            if (r() < 0.35) {
              // a balcony slab with railings, sometimes washing hanging on it: in front of the light
              g.fillStyle = glow ? '#000' : '#7d7a74';
              g.fillRect(x + cw * 0.15, wy + wh, cw * 0.7, fh * 0.2);
              g.fillStyle = glow ? '#000' : '#5f5c56';
              for (let k = 0; k < 8; k++) g.fillRect(x + cw * 0.15 + k * cw * 0.1, wy + wh - fh * 0.05, 1.5, fh * 0.25);
              if (r() < 0.5) {
                g.fillStyle = glow ? '#000' : ['#c9c2b0', '#8a5a5a', '#5a6a8a'][Math.floor(r() * 3)];
                g.fillRect(x + cw * 0.3, wy + wh * 0.55, cw * 0.12, fh * 0.15);
              }
            }
          }
      },
      true,
    ),
  );
}

/** Old snow trodden grey, with thawed patches of earth, 8 m to a tile; the drives are painted over it from the street light map. */
function groundTexture() {
  return once('ground', () =>
    canvasTexture(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = '#7a7d82';
        g.fillRect(0, 0, w, h);
        const r = rng(401);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(48,42,36,${0.08 + r() * 0.18})`;
          g.beginPath();
          g.ellipse(r() * w, r() * h, 8 + r() * 30, 3 + r() * 10, r() * 3, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 600; i++) {
          g.fillStyle = r() < 0.5 ? `rgba(30,28,26,${r() * 0.2})` : `rgba(220,222,226,${r() * 0.15})`;
          g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
        }
      },
      true,
    ),
  );
}

/** Four bare trees side by side, black against the light, for crossed cards. */
function treeTexture() {
  return once('trees', () => {
    const t = canvasTexture(512, 256, (g, w, h) => {
      const r = rng(503);
      g.strokeStyle = '#2a2622';
      g.lineCap = 'round';
      const branch = (x: number, y: number, len: number, a: number, width: number, depth: number) => {
        const x1 = x + Math.cos(a) * len;
        const y1 = y - Math.sin(a) * len;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x1, y1);
        g.stroke();
        if (depth === 0) return;
        const n = depth > 3 ? 2 : 3;
        for (let i = 0; i < n; i++) {
          const spread = (r() - 0.5) * 1.3 + (i - (n - 1) / 2) * 0.5;
          branch(x1, y1, len * (0.62 + r() * 0.2), a + spread, width * 0.66, depth - 1);
        }
      };
      for (let k = 0; k < 4; k++) {
        const x = (k + 0.5) * (w / 4);
        // a poplar, a birch, two limes: tall trunk, crowns of different width
        const trunk = k === 0 ? 70 : 45 + r() * 15;
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x, h - trunk);
        g.stroke();
        for (let i = 0; i < (k === 0 ? 4 : 3); i++) branch(x, h - trunk + i * 8, 40 + r() * 20, Math.PI / 2 + (r() - 0.5) * (k === 0 ? 0.6 : 1.4), 5, 5);
      }
    });
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

interface Block {
  x: number;
  z: number;
  /** Along x, along z. */
  w: number;
  d: number;
  storeys: number;
}

/** Four walls (and a roof) with UVs in units of one texture, merged into one geometry. */
function blockGeometry(b: Block, sectionW: number, sectionH: number) {
  const parts: THREE.BufferGeometry[] = [];
  const h = b.storeys * STOREY;
  const cy = GROUND_Y + h / 2;
  const wall = (len: number, x: number, z: number, rotY: number) => {
    const p = new THREE.PlaneGeometry(len, h);
    const uv = p.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / sectionW, (uv.getY(i) * h) / sectionH);
    p.rotateY(rotY);
    p.translate(x, cy, z);
    parts.push(p);
  };
  wall(b.w, b.x, b.z + b.d / 2, 0);
  wall(b.w, b.x, b.z - b.d / 2, Math.PI);
  wall(b.d, b.x + b.w / 2, b.z, Math.PI / 2);
  wall(b.d, b.x - b.w / 2, b.z, -Math.PI / 2);
  return mergeGeometries(parts);
}

function roofGeometry(blocks: Block[]) {
  return mergeGeometries(
    blocks.map((b) => {
      const p = new THREE.PlaneGeometry(b.w, b.d);
      p.rotateX(-Math.PI / 2);
      p.translate(b.x, GROUND_Y + b.storeys * STOREY, b.z);
      return p;
    }),
  );
}

/**
 * The blocks around the cell. The cell's windows look east, south and west; the rows run on
 * further than the murk lets anyone see.
 */
export function layout(): Block[] {
  const r = rng(77);
  const blocks: Block[] = [];
  const storeys = () => [9, 9, 12, 16][Math.floor(r() * 4)];
  // east: long slabs along z
  for (const x of [62, 104, 150, 200, 255])
    for (let z = -150; z < 170; z += 95 + r() * 20) blocks.push({ x: x + (r() - 0.5) * 8, z, w: 13, d: 80 + r() * 10, storeys: storeys() });
  // south: slabs along x
  for (const z of [58, 100, 148, 200])
    for (let x = -160; x < 220; x += 95 + r() * 20) blocks.push({ x, z: z + (r() - 0.5) * 8, w: 80 + r() * 10, d: 13, storeys: storeys() });
  // west: slabs along z
  for (const x of [-48, -92, -140, -195])
    for (let z = -60; z < 170; z += 95 + r() * 20) blocks.push({ x: x + (r() - 0.5) * 8, z, w: 13, d: 80 + r() * 10, storeys: storeys() });
  // nothing may stand close to our own house or the gallery
  return blocks.filter((b) => !(b.x + b.w / 2 > -30 && b.x - b.w / 2 < 45 && b.z + b.d / 2 > -30 && b.z - b.d / 2 < 45));
}

/** Our own house, as the yard sees it: entrances, and no trees growing into it (nor into its wing, WING). */
const HOME = { x0: -0.2, x1: 28.9, z0: -0.2, z1: 17 };

/**
 * Drives between the rows, each with sodium lamps on poles. `at` is the fixed coordinate; a drive
 * along x has a fixed z.
 */
const DRIVES: { along: 'x' | 'z'; at: number; from: number; to: number }[] = [
  ...[36, 79, 124, 174].map((at) => ({ along: 'x' as const, at, from: -200, to: 240 })),
  ...[45, 83, 127, 175, 228].map((at) => ({ along: 'z' as const, at, from: -170, to: 200 })),
  ...[-24, -70, -116, -167].map((at) => ({ along: 'z' as const, at, from: -80, to: 190 })),
];
const DRIVE_HALF = 3;
const POLE_H = 6.5;
const POLE_STEP = 42;
const PORCH_H = 2.7;

const inside = (b: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
const home = (x: number, z: number, m: number) => inside(HOME, x, z, m) || inside(WING, x, z, m);
const rectOf = (b: Block) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 });

interface Porch {
  /** Foot of the wall under the lamp. */
  x: number;
  z: number;
  /** Out of the wall. */
  nx: number;
  nz: number;
}

/** Where the street lamps stand and where the entrances are: fixed, like the rest of the yard. */
function streetPlan() {
  const blocks = layout().map(rectOf);
  const poles: { x: number; z: number }[] = [];
  for (const d of DRIVES)
    for (let a = d.from; a <= d.to; a += POLE_STEP) {
      // on the kerb, alternately on either side
      const side = (Math.round((a - d.from) / POLE_STEP) % 2 ? 1 : -1) * (DRIVE_HALF + 0.6);
      const [x, z] = d.along === 'x' ? [a, d.at + side] : [d.at + side, a];
      if (!blocks.some((b) => inside(b, x, z, 1.5)) && !home(x, z, 1.5)) poles.push({ x, z });
    }
  // entrances on the long side facing our house, one every 20 m or so; ours too
  const porches: Porch[] = [];
  for (const b of layout()) {
    const alongZ = b.d > b.w;
    const len = alongZ ? b.d : b.w;
    const n = Math.max(1, Math.round(len / 20));
    for (let k = 0; k < n; k++) {
      const a = (alongZ ? b.z - b.d / 2 : b.x - b.w / 2) + (len * (k + 0.5)) / n;
      if (alongZ) {
        const s = b.x > 14 ? -1 : 1;
        porches.push({ x: b.x + (s * b.w) / 2, z: a, nx: s, nz: 0 });
      } else {
        const s = b.z > 9 ? -1 : 1;
        porches.push({ x: a, z: b.z + (s * b.d) / 2, nx: 0, nz: s });
      }
    }
  }
  porches.push({ x: 25.6, z: HOME.z1, nx: 0, nz: 1 }, { x: 10, z: HOME.z1 - 13.9, nx: 0, nz: 1 }, { x: HOME.x1, z: 6, nx: 1, nz: 0 });
  // porches hidden inside another block (where rows overlap) are left out
  return { poles, porches: porches.filter((p) => !blocks.some((b) => inside(b, p.x + p.nx * 1.5, p.z + p.nz * 1.5))) };
}

/**
 * Light on the ground from every street lamp, one texel a metre (MAP): red is the sodium lamps,
 * green the bulbs over the entrances, blue marks the drives. Worked out once, as the irradiance of a
 * point source at the lamp's height, and stored in half floats, so the pools fade without banding.
 * Walls take the light at their foot, fading with height (outdoorMaterial).
 */
function streetLight() {
  return once('street', () => {
    const { poles, porches } = streetPlan();
    const n = MAP.size;
    const data = new Float32Array(n * n * 4);
    const pool = (x: number, z: number, h: number, power: number, reach: number, ch: number) => {
      const cx = x - MAP.x0;
      const cz = z - MAP.z0;
      for (let j = Math.max(0, Math.floor(cz - reach)); j <= Math.min(n - 1, Math.ceil(cz + reach)); j++)
        for (let i = Math.max(0, Math.floor(cx - reach)); i <= Math.min(n - 1, Math.ceil(cx + reach)); i++) {
          const d2 = (i + 0.5 - cx) ** 2 + (j + 0.5 - cz) ** 2;
          if (d2 > reach * reach) continue;
          const fade = 1 - d2 / (reach * reach);
          data[(j * n + i) * 4 + ch] += ((power * h) / (d2 + h * h) ** 1.5) * fade * fade;
        }
    };
    for (const p of poles) pool(p.x, p.z, POLE_H, 36, 19, 0);
    for (const p of porches) pool(p.x + p.nx * 0.6, p.z + p.nz * 0.6, PORCH_H, 5, 11, 1);
    for (const d of DRIVES)
      for (let a = d.from; a <= d.to; a++)
        for (let s = -DRIVE_HALF; s <= DRIVE_HALF; s++) {
          const [x, z] = d.along === 'x' ? [a, d.at + s] : [d.at + s, a];
          const i = Math.floor(x - MAP.x0);
          const j = Math.floor(z - MAP.z0);
          if (i >= 0 && j >= 0 && i < n && j < n) data[(j * n + i) * 4 + 2] = 1;
        }
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const t = new THREE.DataTexture(half, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
}

/** Every window of the yard goes dark (an anomaly). */
export function darkenYard(yard: THREE.Object3D) {
  yard.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.facade !== undefined) o.material.uniforms.glow.value = 0;
  });
}

/**
 * The window of the block across the yard straight ahead of a point, looking along `dir`: its
 * centre, a little in front of the facade, at the height of storey `storey` (0 is ours), and which
 * way the facade faces. Windows sit every 3.6 m along a facade, as drawn by blockTexture.
 */
export function windowAcross(x: number, z: number, dir: 'px' | 'nx' | 'pz', storey = 0) {
  const ahead = (b: Block) =>
    dir === 'pz' ? b.x - b.w / 2 < x && x < b.x + b.w / 2 && b.z - b.d / 2 > z : b.z - b.d / 2 < z && z < b.z + b.d / 2 && (dir === 'px' ? b.x - b.w / 2 > x : b.x + b.w / 2 < x);
  const dist = (b: Block) => (dir === 'pz' ? b.z - b.d / 2 - z : dir === 'px' ? b.x - b.w / 2 - x : x - b.x - b.w / 2);
  const b = layout()
    .filter(ahead)
    .sort((p, q) => dist(p) - dist(q))[0];
  if (!b) return null;
  // distance along the facade, as its texture runs (blockGeometry: u from the plane's left edge)
  const [sw] = SECTION;
  const col = (along: number) => Math.round((along - sw / 8) / (sw / 4)) * (sw / 4) + sw / 8;
  // window centres: 0.53 of a storey above each floor, counted from the ground
  const y = GROUND_Y + (BELOW + storey) * STOREY + 0.53 * STOREY;
  if (dir === 'pz') {
    const left = b.x + b.w / 2;
    return { x: left - col(left - x), y, z: b.z - b.d / 2 - 0.05, facing: 'nz' as const };
  }
  if (dir === 'px') {
    const left = b.z - b.d / 2;
    return { x: b.x - b.w / 2 - 0.05, y, z: left + col(z - left), facing: 'nx' as const };
  }
  const left = b.z + b.d / 2;
  return { x: b.x + b.w / 2 + 0.05, y, z: left - col(left - z), facing: 'px' as const };
}

/** Light glowing on its own: a lit window seen across the yard (an anomaly), a bulb. */
export function glowMaterial(map: THREE.Texture | null, glow = WINDOW_GLOW, color: THREE.ColorRepresentation = 0xffffff) {
  return outdoorMaterial({ map, glowMap: map, glow, color, light: 0, street: false });
}

/**
 * Lamp posts with their heads, and the entrances: a door, a concrete canopy over it and the bulb
 * under the canopy. Boxes in vertex colours, merged into one mesh, and the bulbs into another.
 */
function streetFurniture() {
  const { poles, porches } = streetPlan();
  const solid: THREE.BufferGeometry[] = [];
  const bulbs: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY = 0) => {
    const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    b.rotateY(rotY);
    b.translate(x, y, z);
    const c = new THREE.Color(color);
    b.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: b.attributes.position.count }, () => [c.r, c.g, c.b]).flat(), 3));
    b.deleteAttribute('uv');
    b.deleteAttribute('normal');
    solid.push(b);
  };
  const bulb = (r: number, x: number, y: number, z: number) => {
    const s = new THREE.OctahedronGeometry(r);
    s.translate(x, y, z);
    s.deleteAttribute('uv');
    s.deleteAttribute('normal');
    bulbs.push(s);
  };
  for (const p of poles) {
    box(0.14, POLE_H, 0.14, p.x, GROUND_Y + POLE_H / 2, p.z, 0x55524c);
    box(0.5, 0.12, 0.25, p.x, GROUND_Y + POLE_H + 0.02, p.z, 0x3a3834);
    bulb(0.13, p.x, GROUND_Y + POLE_H - 0.08, p.z);
  }
  for (const p of porches) {
    const rot = p.nx !== 0 ? Math.PI / 2 : 0;
    const [ox, oz] = [p.nx, p.nz];
    // the door sits 3 cm proud of the wall, the canopy well clear of it
    box(1.5, 2.2, 0.06, p.x + ox * 0.03, GROUND_Y + 1.1, p.z + oz * 0.03, 0x3d3a2c, rot);
    box(2.6, 0.16, 1.4, p.x + ox * 0.72, GROUND_Y + PORCH_H + 0.25, p.z + oz * 0.72, 0x8d8a84, rot);
    // steps
    box(2.2, 0.15, 1.2, p.x + ox * 0.62, GROUND_Y + 0.075, p.z + oz * 0.62, 0x6e6b66, rot);
    bulb(0.07, p.x + ox * 0.25, GROUND_Y + PORCH_H + 0.08, p.z + oz * 0.25);
  }
  return { solid: mergeGeometries(solid), bulbs: mergeGeometries(bulbs) };
}

/** Bare trees on crossed cards, in the yards between the drives, none against a wall or on a drive. */
function treeGeometry() {
  const r = rng(611);
  const blocks = layout().map(rectOf);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 900 && parts.length < 260; i++) {
    const x = -180 + r() * 420;
    const z = -150 + r() * 330;
    const kind = Math.floor(r() * 4);
    const h = kind === 0 ? 11 + r() * 3 : 6 + r() * 3;
    if (blocks.some((b) => inside(b, x, z, 4)) || home(x, z, 6)) continue;
    if (DRIVES.some((d) => Math.abs((d.along === 'x' ? z : x) - d.at) < DRIVE_HALF + 2.5)) continue;
    const yaw = r() * Math.PI;
    for (const turn of [0, Math.PI / 2]) {
      const p = new THREE.PlaneGeometry(h, h);
      const uv = p.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (kind + uv.getX(k)) / 4);
      p.rotateY(yaw + turn);
      p.translate(x, GROUND_Y + h / 2, z);
      parts.push(p);
    }
  }
  return mergeGeometries(parts);
}

export function buildYard(parent: THREE.Object3D) {
  const blocks = layout();
  const yard = new THREE.Group();
  yard.name = 'yard';
  // three facade variants, so lit windows don't repeat from one block to the next
  for (let v = 0; v < 3; v++) {
    const mine = blocks.filter((_, i) => i % 3 === v);
    if (!mine.length) continue;
    const geo = mergeGeometries(mine.map((b) => blockGeometry(b, ...SECTION)));
    const m = new THREE.Mesh(geo, outdoorMaterial({ map: blockTexture(v, false), glowMap: blockTexture(v, true), glow: WINDOW_GLOW }));
    m.userData.facade = v;
    yard.add(m);
  }
  yard.add(new THREE.Mesh(roofGeometry(blocks), outdoorMaterial({ color: 0x5a5854 })));
  // the ground in cells: one huge pair of triangles goes wrong when a corner is far to the side
  const ground = new THREE.PlaneGeometry(1000, 1000, 50, 50);
  ground.rotateX(-Math.PI / 2);
  ground.translate(14, GROUND_Y, 9);
  const uv = ground.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 125, uv.getY(i) * 125);
  yard.add(new THREE.Mesh(ground, outdoorMaterial({ map: groundTexture(), ground: true })));
  const street = streetFurniture();
  yard.add(new THREE.Mesh(street.solid, outdoorMaterial({ vertexColors: true })));
  yard.add(new THREE.Mesh(street.bulbs, outdoorMaterial({ color: SODIUM.clone().lerp(new THREE.Color(1, 1, 1), 0.35), glow: BULB_GLOW, light: 0, street: false })));
  yard.add(new THREE.Mesh(treeGeometry(), outdoorMaterial({ map: treeTexture(), cutout: true, color: 0xb0aaa0 })));
  // the murk all round: lit brown from below, black overhead
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...HAZE_UNIFORMS, street: { value: streetLight() }, ...SMOG },
      vertexShader: /* glsl */ `
        varying float vUp;
        ${SMOG_VERTEX_DECL}
        void main() {
          vUp = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          ${smogVertex('modelMatrix * vec4(position, 1.0)')}
        }`,
      fragmentShader: /* glsl */ `
        ${HAZE_DECL}
        varying float vUp;
        ${SMOG_FRAGMENT_DECL}
        void main() {
          gl_FragColor = vec4(hazeColor(vUp * 120.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          ${SMOG_FRAGMENT}
        }`,
    }),
  );
  sky.renderOrder = -1;
  yard.add(sky);
  parent.add(yard);
  return yard;
}
