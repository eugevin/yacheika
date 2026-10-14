import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaskId, OutfitId } from '../shared/masks.ts';
import { wearGear } from './masks.ts';
import { STEP_LEN } from './player.ts';
import { useBaked, type Probe } from './world/lighting.ts';

export interface Look {
  name: string;
  color: string;
  mask: MaskId;
  outfit: OutfitId;
  /** Flat number on the resident's card; 0 leaves it blank. */
  flat: number;
  /** No face: smooth skin, or a gas mask without its glass (the "faceless" anomaly). */
  blank?: boolean;
}

/** Bones of the rig. Every vertex belongs to exactly one of them, so the body is rigid pieces on pivots. */
export const BONE = { body: 0, chest: 1, head: 2, armL: 3, armR: 4, hipL: 5, hipR: 6, kneeL: 7, kneeR: 8 } as const;
type Bone = (typeof BONE)[keyof typeof BONE];

// [parent, rest position relative to it]; the character faces -z, its left is -x
const RIG: [Bone | -1, number, number, number][] = [
  [-1, 0, 0, 0],
  [BONE.body, 0, 1.19, 0],
  [BONE.body, 0, 1.53, 0],
  [BONE.body, -0.27, 1.44, 0],
  [BONE.body, 0.27, 1.44, 0],
  [BONE.body, -0.1, 0.9, 0],
  [BONE.body, 0.1, 0.9, 0],
  [BONE.hipL, 0, -0.45, 0],
  [BONE.hipR, 0, -0.45, 0],
];

/** Where each bone sits in the rest pose (nothing is rotated at rest, so it's just the sum of offsets). */
const REST = RIG.map(function rest(r): THREE.Vector3 {
  const v = new THREE.Vector3(r[1], r[2], r[3]);
  return r[0] < 0 ? v : v.add(rest(RIG[r[0]]));
});

/**
 * Pieces of one texture shared by the whole character, in pixels of a 256×256 canvas: the face (or
 * the front of a mask), the resident's card, the armband, the quilting of a padded jacket, gauze.
 * Plain parts sample a solid cell at the bottom; glowing ones get a cell of their own in the glow map.
 */
export type Region = readonly [x: number, y: number, w: number, h: number];
export const ATLAS = {
  size: 256,
  face: [0, 0, 128, 128] as Region,
  card: [128, 0, 128, 80] as Region,
  armband: [128, 80, 128, 32] as Region,
  quilt: [128, 112, 64, 64] as Region,
  gauze: [192, 112, 64, 64] as Region,
  /** Solid cells (16 px) start here, a whole free band so mipmaps don't bleed other pictures into them. */
  solids: 192,
};

/** Head-local rectangle the face picture is projected onto, straight from the front: x across, y up. */
export const FACE_FRAME = { x: 0.12, y0: 0, h: 0.24 };

export interface PartOpts {
  at?: [number, number, number];
  rot?: [number, number, number];
  /** Map every face of the part onto this piece of the atlas; the colour then tints the picture. */
  tex?: Region;
  /** Project the picture onto the part from the front (FACE_FRAME), for curved patches on the head. */
  project?: Region;
  /** Lights up with the voice, in this colour. */
  glow?: string;
}

/**
 * Collects the pieces of a character, each in its bone's frame (origin at the bone), and merges
 * them into one skinned geometry: one draw call for the whole body.
 */
export class Parts {
  private list: THREE.BufferGeometry[] = [];
  private glows = new Map<string, number>();

  add(bone: Bone, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, o: PartOpts = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (o.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)));
    if (o.at) g.translate(...o.at);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const n = pos.count;
    const s = ATLAS.size;
    if (o.project) {
      const [x, y, w, h] = o.project;
      for (let i = 0; i < n; i++) {
        const u = (FACE_FRAME.x - pos.getX(i)) / (2 * FACE_FRAME.x);
        const v = (pos.getY(i) - FACE_FRAME.y0) / FACE_FRAME.h;
        uv.setXY(i, (x + u * w) / s, 1 - (y + (1 - v) * h) / s);
      }
    } else if (o.tex) {
      const [x, y, w, h] = o.tex;
      for (let i = 0; i < n; i++) uv.setXY(i, (x + uv.getX(i) * w) / s, 1 - (y + (1 - uv.getY(i)) * h) / s);
    } else {
      const [cx, cy] = this.solid(o.glow ?? null);
      for (let i = 0; i < n; i++) uv.setXY(i, cx / s, 1 - cy / s);
    }
    g.translate(REST[bone].x, REST[bone].y, REST[bone].z);
    const c = new THREE.Color(color);
    const colors = new Float32Array(n * 3);
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      c.toArray(colors, i * 3);
      idx[i * 4] = bone;
      w[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    this.list.push(g);
  }

  box(bone: Bone, w: number, h: number, d: number, color: THREE.ColorRepresentation, at: [number, number, number], o: PartOpts = {}) {
    this.add(bone, new THREE.BoxGeometry(w, h, d), color, { ...o, at });
  }

  /** Centre of the solid cell for a glow colour (null: doesn't glow), in atlas pixels. */
  private solid(glow: string | null) {
    const key = glow ?? '';
    let i = this.glows.get(key);
    if (i === undefined) this.glows.set(key, (i = this.glows.size));
    return [(i % 16) * 16 + 8, ATLAS.solids + Math.floor(i / 16) * 16 + 8];
  }

  /** Glow colours of the solid cells, by cell. */
  get solids() {
    return [...this.glows.keys()];
  }

  merge() {
    const g = mergeGeometries(this.list)!;
    for (const p of this.list) p.dispose();
    return g;
  }
}

/** A sphere patch around the head's centre: theta from the top, phi around, centred on the face (-z). */
export function patch(r: number, theta: [number, number], halfWidth: number, segs = 16) {
  const g = new THREE.SphereGeometry(r, segs, segs, (3 * Math.PI) / 2 - halfWidth, 2 * halfWidth, theta[0], theta[1] - theta[0]);
  g.translate(0, 0.12, 0);
  return g;
}

/** Angle from the top of the head (radius r around its centre) at which a sphere reaches height y. */
export const thetaAt = (y: number, r: number) => Math.acos(THREE.MathUtils.clamp((y - 0.12) / r, -1, 1));

const SKIN = '#d2ad88';
const HAIR = '#2a2018';

/** The player's colour, toned like the cloth: `k` darkens, `pale` mixes in grey. */
const tone = (color: string, k: number, pale = 0.15) => new THREE.Color(color).lerp(new THREE.Color(0x808080), pale).multiplyScalar(k);

interface Sizes {
  /** Torso: width, height, depth and its centre's drop below the chest bone. */
  torso: [number, number, number, number];
  sleeve: number;
}

/**
 * Clothes (docs/DESIGN.md, 3.3), all in the player's colour: a tracksuit with stripes, a padded
 * jacket, a dressing gown, an L-1 chemical suit. Returns the sizes that the card and armband go on.
 */
function dress(p: Parts, look: Look): Sizes {
  const col = look.color;
  const shoe = (color: THREE.ColorRepresentation, h = 0.07, len = 0.25) =>
    [BONE.kneeL, BONE.kneeR].forEach((k) => p.box(k, 0.14, h, len, color, [0, -0.45 + h / 2, -0.04]));
  const hands = (color = SKIN) => [BONE.armL, BONE.armR].forEach((a) => p.box(a, 0.08, 0.1, 0.09, color, [0, -0.57, 0]));
  const legs = (color: THREE.ColorRepresentation, w: number) =>
    [0, 1].forEach((i) => {
      p.box(BONE.hipL + i as Bone, w, 0.47, w + 0.02, color, [0, -0.215, 0]);
      p.box(BONE.kneeL + i as Bone, w - 0.02, 0.4, w, color, [0, -0.2, 0]);
    });
  const sleeves = (color: THREE.ColorRepresentation, w: number, o: PartOpts = {}) =>
    [BONE.armL, BONE.armR].forEach((a) => p.box(a, w, 0.52, w + 0.01, color, [0, -0.25, 0], o));

  switch (look.outfit) {
    case 'tracksuit': {
      // olympic jacket with a white zip, trousers with white stripes down the sides, plimsolls
      const suit = tone(col, 0.72);
      const white = '#e8e6e0';
      p.box(BONE.chest, 0.42, 0.6, 0.24, suit, [0, -0.01, 0]);
      p.box(BONE.chest, 0.22, 0.06, 0.2, suit, [0, 0.31, 0]);
      p.box(BONE.chest, 0.014, 0.52, 0.006, white, [0, 0, -0.123]);
      sleeves(suit, 0.11);
      legs(suit, 0.15);
      // two stripes on the outer side of each sleeve and leg
      for (const [i, side] of [[0, -1], [1, 1]] as const) {
        for (const dz of [-0.012, 0.012]) {
          p.box(BONE.armL + i as Bone, 0.006, 0.5, 0.009, white, [side * 0.057, -0.25, dz]);
          p.box(BONE.hipL + i as Bone, 0.006, 0.45, 0.009, white, [side * 0.077, -0.215, dz]);
          p.box(BONE.kneeL + i as Bone, 0.006, 0.38, 0.009, white, [side * 0.067, -0.2, dz]);
        }
      }
      hands();
      shoe('#d9d4c6', 0.06);
      [BONE.kneeL, BONE.kneeR].forEach((k) => p.box(k, 0.15, 0.022, 0.26, '#6a655c', [0, -0.445, -0.04]));
      return { torso: [0.42, 0.6, 0.24, 0.01], sleeve: 0.11 };
    }
    case 'quilted': {
      // padded jacket: quilted in bands, a little bulky; cotton-wool trousers and tarpaulin boots
      const jacket = tone(col, 0.5, 0.3);
      p.box(BONE.chest, 0.46, 0.64, 0.28, jacket, [0, -0.04, 0], { tex: ATLAS.quilt });
      p.box(BONE.chest, 0.27, 0.07, 0.25, tone(col, 0.38, 0.3), [0, 0.3, 0]);
      for (let i = 0; i < 4; i++) p.box(BONE.chest, 0.025, 0.025, 0.01, '#151410', [0, 0.2 - i * 0.15, -0.143]);
      sleeves(jacket, 0.13, { tex: ATLAS.quilt });
      legs('#34332f', 0.16);
      hands();
      [BONE.kneeL, BONE.kneeR].forEach((k) => p.box(k, 0.155, 0.27, 0.175, '#1a1815', [0, -0.29, 0]));
      shoe('#1a1815', 0.08, 0.26);
      return { torso: [0.46, 0.64, 0.28, 0.04], sleeve: 0.13 };
    }
    case 'robe': {
      // dressing gown to the knees with a shawl collar and a sash; pyjama trousers, slippers
      const robe = tone(col, 0.75, 0.1);
      const trim = tone(col, 1.0, 0.25);
      p.box(BONE.chest, 0.44, 0.6, 0.26, robe, [0, -0.01, 0]);
      for (const side of [-1, 1]) p.box(BONE.chest, 0.05, 0.34, 0.008, trim, [side * 0.055, 0.12, -0.134], { rot: [0, 0, side * 0.32] });
      p.box(BONE.body, 0.45, 0.055, 0.27, trim, [0, 0.95, 0]);
      p.box(BONE.body, 0.04, 0.16, 0.012, trim, [-0.08, 0.86, -0.14]);
      // the skirt: one panel per leg, so it swings with the walk and lies on the lap when sitting
      for (const [i, side] of [[0, -1], [1, 1]] as const) p.box(BONE.hipL + i as Bone, 0.225, 0.45, 0.28, robe, [side * 0.0125, -0.205, 0]);
      sleeves(robe, 0.13);
      legs('#8d909a', 0.14);
      hands();
      shoe('#6b3b2a', 0.05, 0.24);
      return { torso: [0.44, 0.6, 0.26, 0.01], sleeve: 0.13 };
    }
    case 'l1': {
      // rubberised suit: jacket with a hood (on the head, see masks.ts), trousers, gloves and overboots
      const rubber = tone(col, 0.55, 0.35);
      const dark = tone(col, 0.32, 0.35);
      p.box(BONE.chest, 0.44, 0.62, 0.26, rubber, [0, -0.03, 0]);
      p.box(BONE.chest, 0.3, 0.035, 0.27, dark, [0, -0.2, 0]);
      sleeves(rubber, 0.12);
      legs(rubber, 0.16);
      [BONE.armL, BONE.armR].forEach((a) => p.box(a, 0.095, 0.13, 0.105, dark, [0, -0.56, 0]));
      [BONE.kneeL, BONE.kneeR].forEach((k) => p.box(k, 0.155, 0.3, 0.175, dark, [0, -0.27, 0]));
      shoe(dark, 0.08, 0.27);
      return { torso: [0.44, 0.62, 0.26, 0.03], sleeve: 0.12 };
    }
  }
}

/** Head, neck and hair (unless the gear hides it); the gear itself is in masks.ts. */
function head(p: Parts, look: Look) {
  p.add(BONE.body, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), SKIN, { at: [0, 1.52, 0] });
  p.add(BONE.head, new THREE.SphereGeometry(0.115, 16, 12), SKIN, { at: [0, 0.12, 0] });
  // the face: a patch just off the skull with the picture projected from the front
  p.add(BONE.head, patch(0.1175, [thetaAt(0.21, 0.1175), thetaAt(0.02, 0.1175)], 1.25), 0xffffff, { project: ATLAS.face });
  const { hair } = wearGear(p, look);
  if (!hair) return;
  // a cap on top and the back of the head, leaving the forehead and the face clear
  p.add(BONE.head, new THREE.SphereGeometry(0.122, 16, 6, 0, Math.PI * 2, 0, 0.62), HAIR, { at: [0, 0.12, 0] });
  p.add(BONE.head, new THREE.SphereGeometry(0.122, 16, 8, Math.PI / 2 - 1.9, 3.8, 0.6, 1.35), HAIR, { at: [0, 0.12, 0] });
}

/**
 * Paints the character's atlas: colour on one canvas, glow on another (black where nothing glows).
 */
function paintAtlas(look: Look, solids: string[]) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS.size;
    return [c, c.getContext('2d')!] as const;
  };
  const [color, g] = make();
  const [glow, gg] = make();
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, ATLAS.size, ATLAS.size);
  g.fillStyle = '#fff';
  g.fillRect(0, ATLAS.solids, ATLAS.size, ATLAS.size - ATLAS.solids);
  solids.forEach((c, i) => {
    if (!c) return;
    gg.fillStyle = c;
    gg.fillRect((i % 16) * 16, ATLAS.solids + Math.floor(i / 16) * 16, 16, 16);
  });
  const at = (r: Region, ctx: CanvasRenderingContext2D, draw: (w: number, h: number) => void) => {
    ctx.save();
    ctx.translate(r[0], r[1]);
    ctx.beginPath();
    ctx.rect(0, 0, r[2], r[3]);
    ctx.clip();
    draw(r[2], r[3]);
    ctx.restore();
  };
  at(ATLAS.face, g, () => paintFace(g, look.mask, false, look.blank));
  at(ATLAS.face, gg, () => paintFace(gg, look.mask, true, look.blank));
  at(ATLAS.card, g, (w, h) => paintCard(g, w, h, look));
  at(ATLAS.armband, g, (w, h) => paintArmband(g, w, h, look.color));
  at(ATLAS.quilt, g, (w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    // stitched bands: a dark seam, a little shade under it
    for (let i = 0; i < 7; i++) {
      const y = (i + 0.5) * (h / 7);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(0, y, w, 1.6);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, y + 1.6, w, 2.4);
    }
  });
  const weave = (ctx: CanvasRenderingContext2D, w: number, h: number, base: string, line: string) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = line;
    for (let i = 0; i < w; i += 3) {
      ctx.fillRect(i, 0, 1, h);
      ctx.fillRect(0, i, w, 1);
    }
  };
  at(ATLAS.gauze, g, (w, h) => weave(g, w, h, '#ebe8df', 'rgba(150,140,120,0.35)'));
  at(ATLAS.gauze, gg, (w, h) => weave(gg, w, h, '#b0ada4', 'rgba(0,0,0,0.3)'));
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(color), glow: tex(glow) };
}

/** The resident's card: a header, the surname, the flat. Readable only up close. */
function paintCard(g: CanvasRenderingContext2D, w: number, h: number, look: Look) {
  g.fillStyle = '#ece6d2';
  g.fillRect(0, 0, w, h);
  g.fillStyle = look.color;
  g.fillRect(0, 0, w, 16);
  g.fillStyle = '#1a1a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 10px monospace';
  g.fillText('ЖИЛЕЦ', w / 2, 8.5);
  g.font = 'bold 22px sans-serif';
  g.fillText(look.name, w / 2, 37, w - 10);
  g.font = '17px monospace';
  g.fillText(look.flat ? `кв. ${look.flat}` : 'кв.', w / 2, 63);
  g.strokeStyle = '#6d6650';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
}

/** The volunteer patrol's armband in the player's colour: white edges and letters, readable from the side. */
function paintArmband(g: CanvasRenderingContext2D, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, w, 4);
  g.fillRect(0, h - 4, w, 4);
  g.font = 'bold 17px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ДНД', w / 2, h / 2 + 1);
}

/**
 * The face picture: a plain painted face under open gear, the rubber front of the gas mask under
 * the GP-5. The glow version is black where nothing lights up when talking. A blank one has
 * nothing on it.
 */
function paintFace(g: CanvasRenderingContext2D, mask: MaskId, glow: boolean, blank = false) {
  const ell = (x: number, y: number, rx: number, ry: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  // pixel rows: 64 is the middle of the skull; eyes at 53, the mouth at 92 (FACE_FRAME)
  if (mask === 'gp5') {
    g.fillStyle = glow ? '#000' : '#3d433c';
    g.fillRect(0, 0, 128, 128);
    if (blank) return;
    for (const x of [38, 90]) {
      ell(x, 54, 17, 17, glow ? '#000' : '#7b7f77');
      ell(x, 54, 13, 13, glow ? '#a6d4c0' : '#14201e');
      if (!glow) ell(x - 4, 49, 3, 3, 'rgba(255,255,255,0.45)');
    }
    return;
  }
  g.fillStyle = glow ? '#000' : SKIN;
  g.fillRect(0, 0, 128, 128);
  if (glow || blank) return;
  // brows, eyes, a hint of a nose, a mouth
  g.fillStyle = '#3a2a1e';
  g.fillRect(31, 41, 18, 3);
  g.fillRect(79, 41, 18, 3);
  for (const x of [40, 88]) {
    ell(x, 53, 7, 4, '#efe9dc');
    ell(x, 53, 3.2, 3.6, '#2a1d14');
  }
  g.fillStyle = 'rgba(120,70,40,0.35)';
  g.fillRect(62, 58, 4, 18);
  g.fillRect(58, 74, 12, 3);
  g.fillStyle = '#8a4a3a';
  g.fillRect(52, 90, 24, 3);
}

/**
 * A resident: clothes and protective gear (docs/DESIGN.md, 3.3) in the player's colour, an armband on
 * the left arm, the resident's card on the chest. One skinned mesh of rigid pieces, one draw call;
 * the walk is a few bone rotations driven by distance walked: one swing per STEP_LEN, in step with
 * the footsteps. Faces local -z, like the camera.
 */
export class Character {
  readonly root = new THREE.Group();
  /** Light where the character stands; set it from World.probe as it moves. */
  readonly probe: Probe = { base: new THREE.Vector3(0.3, 0.3, 0.3), idx: new THREE.Vector4(), w: new THREE.Vector4() };
  private readonly bones: THREE.Bone[];
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly mesh: THREE.SkinnedMesh;
  private phase = 0;
  private amp = 0;
  private talk = 0;
  private seated = false;
  /** Head turn to the left (radians), on top of where the body faces. */
  headYaw = 0;

  constructor(look: Look) {
    const p = new Parts();
    const size = dress(p, look);
    head(p, look);
    // the card on the left of the chest, the armband round the left upper arm
    const [, th, td, drop] = size.torso;
    p.box(BONE.chest, 0.1, 0.065, 0.004, 0xffffff, [-0.1, th / 2 - drop - 0.17, -td / 2 - (look.outfit === 'robe' ? 0.012 : 0.004)], { tex: ATLAS.card });
    const s = size.sleeve + 0.014;
    p.box(BONE.armL, s, 0.075, s + 0.01, 0xffffff, [0, -0.14, 0], { tex: ATLAS.armband });

    const atlas = paintAtlas(look, p.solids);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas.map, emissive: 0xffffff, emissiveMap: atlas.glow, emissiveIntensity: 0 });
    // lit by the bake like everything else, through one probe for the whole body
    useBaked(this.mat, this.probe);
    const baked = this.mat.onBeforeCompile;
    this.mat.onBeforeCompile = (sh, r) => {
      baked.call(this.mat, sh, r);
      // a little shape on top of the flat probe light: lighter on top, darker underneath
      sh.vertexShader = sh.vertexShader.replace(
        'vBaked = bakedLight(uProbeBase, uProbeIdx, uProbeW);',
        '$&\nvBaked *= 0.86 + 0.2 * normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;',
      );
    };
    this.mat.customProgramCacheKey = () => 'baked-probe-figure';

    this.mesh = new THREE.SkinnedMesh(p.merge(), this.mat);
    this.bones = RIG.map((r) => {
      const b = new THREE.Bone();
      b.position.set(r[1], r[2], r[3]);
      return b;
    });
    RIG.forEach((r, i) => (r[0] < 0 ? this.mesh : this.bones[r[0]]).add(this.bones[i]));
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    // walking and sitting stay well inside this
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.2);
    this.root.add(this.mesh);
  }

  private get b() {
    return this.bones;
  }

  /**
   * One frame of animation. `moved` is the distance walked this frame, `pitch` where the head
   * looks (camera convention, up is positive), `talk` the voice level 0..1.
   */
  animate(dt: number, t: number, moved: number, pitch: number, talk: number) {
    const b = this.b;
    if (this.seated) {
      b[BONE.head].rotation.set(THREE.MathUtils.clamp(pitch, -0.7, 0.7) * 0.8, this.headYaw, 0);
      b[BONE.chest].scale.set(1, 1 + Math.sin(t * 1.8) * 0.012, 1);
      return;
    }
    const speed = moved / Math.max(dt, 1e-3);
    this.phase += (moved * Math.PI) / STEP_LEN;
    this.amp += (Math.min(1, speed / 2.6) - this.amp) * Math.min(1, dt * 8);
    const a = this.amp;
    const s = Math.sin(this.phase);
    // legs swing opposite each other; the trailing knee bends
    b[BONE.hipL].rotation.x = s * 0.55 * a;
    b[BONE.hipR].rotation.x = -s * 0.55 * a;
    b[BONE.kneeL].rotation.x = -Math.max(0, -s) * 0.8 * a;
    b[BONE.kneeR].rotation.x = -Math.max(0, s) * 0.8 * a;
    // arms swing against the legs; at rest they hang slightly apart
    b[BONE.armL].rotation.set(-s * 0.45 * a, 0, -0.06);
    b[BONE.armR].rotation.set(s * 0.45 * a, 0, 0.06);
    // the body dips as each foot lands, and breathes when standing
    b[BONE.body].position.y = -Math.abs(s) * 0.035 * a;
    b[BONE.chest].scale.set(1, 1 + Math.sin(t * 1.8) * 0.012 * (1 - a), 1);

    this.talk += (talk - this.talk) * Math.min(1, dt * 15);
    b[BONE.head].rotation.x = THREE.MathUtils.clamp(pitch, -0.7, 0.7) * 0.8 + Math.sin(t * 13) * 0.05 * this.talk;
    b[BONE.head].rotation.y = this.headYaw;
    this.mat.emissiveIntensity = this.talk * 0.7;
  }

  /**
   * Sits down on something `seat` metres high in front of where it stands: thighs forward, shins
   * down, hands resting on the knees. The body stops walking; only the head moves (`headYaw`).
   */
  sit(seat = 0.45) {
    const b = this.b;
    this.seated = true;
    // hips sink to just above the seat; the thighs (0.45 long) then reach forward
    b[BONE.body].position.set(0, seat + 0.07 - 0.9, 0.12);
    for (const h of [BONE.hipL, BONE.hipR]) b[h].rotation.set(Math.PI / 2, 0, 0);
    for (const k of [BONE.kneeL, BONE.kneeR]) b[k].rotation.set(-Math.PI / 2, 0, 0);
    b[BONE.armL].rotation.set(0.75, 0, -0.04);
    b[BONE.armR].rotation.set(0.75, 0, 0.04);
  }

  /** Our own body seen from inside the head: the head and all it wears fold to a point. */
  hideHead() {
    this.b[BONE.head].scale.setScalar(0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.emissiveMap?.dispose();
    this.mat.dispose();
    this.mesh.skeleton.dispose();
  }
}
