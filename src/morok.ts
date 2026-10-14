import * as THREE from 'three';
import type { World } from './world/index.ts';

/**
 * The tell of a morok one can see (docs/DESIGN.md, 6): what it is made of shimmers like air over a
 * stove. Every vertex sways by a few pixels on screen, whatever the distance; textures ripple; the
 * shading flickers in fine moving stripes, more at the edges. Faint out of the corner of the eye,
 * plain when looked at straight. It lives in the materials, so it shows on both qualities and in
 * the mirrors, and costs no draw calls: each mesh gets a copy of its material with the shimmer
 * patched in, the shared ones stay as they were.
 */

/** Sway in clip space, as a share of the half screen: about two pixels at full strength on 1080p. */
const SWAY = 0.004;
/** Ripple of a texture, in its UVs. */
const RIPPLE = 0.0035;
/** Strength out of the corner of the eye; full strength within FOCUS of the screen centre. */
const FAINT = 0.25;
const FOCUS = 0.08;
const SIDE = 0.35;

interface Shimmer {
  uShimmer: { value: number };
  uShimmerT: { value: number };
}

const VERTEX = /* glsl */ `
  {
    vec3 sp = position * 9.0;
    gl_Position.xy += gl_Position.w * uShimmer * ${SWAY.toFixed(5)} * vec2(
      sin(uShimmerT * 5.1 + sp.y * 2.3 + sp.x * 0.7),
      sin(uShimmerT * 4.3 + sp.x * 1.9 + sp.z * 1.1)
    );
  }
`;
/** Fine stripes drifting up the screen, like heat over a stove. */
const STRIPES = 'sin(uShimmerT * 13.0 - gl_FragCoord.y * 0.11 + sin(gl_FragCoord.x * 0.05 + uShimmerT * 3.0) * 2.0)';

function patch(sh: THREE.WebGLProgramParametersWithUniforms, kind: 'lit' | 'basic' | 'shader', mapped: boolean, u: Shimmer) {
  sh.uniforms.uShimmer = u.uShimmer;
  sh.uniforms.uShimmerT = u.uShimmerT;
  const decl = 'uniform float uShimmer;\nuniform float uShimmerT;\n';
  const beforeLast = (src: string, code: string) => {
    const i = src.lastIndexOf('}');
    return src.slice(0, i) + code + src.slice(i);
  };
  sh.vertexShader = decl + beforeLast(sh.vertexShader, VERTEX);
  let frag = decl + sh.fragmentShader;
  if (kind === 'shader') {
    frag = beforeLast(frag, `gl_FragColor.rgb *= 1.0 + uShimmer * 0.12 * ${STRIPES};\n`);
  } else {
    if (mapped)
      frag = frag.replace(
        '#include <map_fragment>',
        `vec2 shimmerUv = vMapUv + uShimmer * ${RIPPLE.toFixed(5)} * vec2(sin(vMapUv.y * 70.0 + uShimmerT * 9.0), cos(vMapUv.x * 70.0 + uShimmerT * 8.0));\n` +
          THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'shimmerUv'),
      );
    // lit materials know the surface's slope to the eye: the edges flicker more than the middle
    const rim = kind === 'lit' ? '(0.5 + 1.5 * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.0))' : '1.0';
    frag = frag.replace('#include <opaque_fragment>', `outgoingLight *= 1.0 + uShimmer * 0.1 * ${rim} * ${STRIPES};\n#include <opaque_fragment>`);
  }
  sh.fragmentShader = frag;
}

function shimmering(m: THREE.Material, u: Shimmer): THREE.Material {
  const kind =
    m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial ? 'lit'
    : m instanceof THREE.MeshBasicMaterial ? 'basic'
    : m instanceof THREE.ShaderMaterial ? 'shader'
    : null;
  if (!kind) {
    if (import.meta.env.DEV) console.error(`a morok can't shimmer a ${m.type}`);
    return m;
  }
  const c = m.clone();
  // a copy would get its own copies of shared uniforms (the samosbor's fog among them)
  if (m instanceof THREE.ShaderMaterial) (c as THREE.ShaderMaterial).uniforms = { ...m.uniforms };
  const mapped = 'map' in m && !!m.map;
  const own = m.onBeforeCompile;
  c.onBeforeCompile = (sh, r) => {
    own.call(c, sh, r);
    patch(sh, kind, mapped, u);
  };
  const key = m.customProgramCacheKey();
  c.customProgramCacheKey = () => `${key}|shimmer-${kind}${mapped ? '-map' : ''}`;
  return c;
}

/** Makes what a morok put in the cell shimmer, more the closer to the middle of the view it is. */
export function shimmer(w: World, subjects: THREE.Object3D[]) {
  const u: Shimmer = { uShimmer: { value: FAINT }, uShimmerT: { value: 0 } };
  const done = new Map<THREE.Material, THREE.Material>();
  for (const s of subjects)
    s.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
      const swap = (m: THREE.Material) => done.get(m) ?? done.set(m, shimmering(m, u)).get(m)!;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  w.updaters.push((t, _dt, cam) => {
    u.uShimmerT.value = t % 1000;
    // things that move (the cot, the chandelier) carry their middle with them
    box.makeEmpty();
    for (const s of subjects) box.expandByObject(s);
    box.getCenter(centre);
    cam.getWorldPosition(eye);
    cam.getWorldDirection(look);
    const angle = look.angleTo(centre.sub(eye));
    u.uShimmer.value = FAINT + (1 - FAINT) * (1 - THREE.MathUtils.smoothstep(angle, FOCUS, SIDE));
  });
}
