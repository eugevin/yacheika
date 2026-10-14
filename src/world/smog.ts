import * as THREE from 'three';

/**
 * The fog of a samosbor (docs/DESIGN.md, 4.7): rusty brown, thick at the floor and thinning towards
 * the ceiling. Density falls off with height as floor * exp(-falloff * y), plus an even part
 * everywhere; the shader integrates it along the view ray in closed form. All zero outside a
 * samosbor, and then the shaders skip it altogether, so an ordinary cell renders exactly as without it
 * (the loop is checked pixel for pixel). Shared by every material that has it, like CHANNELS.
 */
export const SMOG = {
  /** Even density everywhere, per metre. */
  uSmogEven: { value: 0 },
  /** Extra density at floor level, per metre. */
  uSmogFloor: { value: 0 },
  /** How fast the extra density thins with height, per metre. */
  uSmogFall: { value: 1.2 },
  /** Colour of the fog: on screen, or linear before tone mapping with post-processing (setSmogColor). */
  uSmogColor: { value: new THREE.Color() },
};

/**
 * Where the fog is mixed in. Rendered straight to the screen, materials mix it in after tone mapping,
 * in screen colours; with post-processing (post.ts) they render linear HDR, and the colour has to
 * be the one that comes out as the same screen colour once tone mapped (setSmogColor).
 */
export const SMOG_SPACE = { linear: false };

/** Sets the fog's colour as it should reach the screen, sRGB 0..1. */
export function setSmogColor(r: number, g: number, b: number) {
  const c = SMOG.uSmogColor.value;
  if (!SMOG_SPACE.linear) return c.setRGB(r, g, b);
  // invert ACES and sRGB by iteration: three steps of the ratio are near enough, thirty are exact
  const want = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const x = [want.r, want.g, want.b];
  for (let i = 0; i < 30; i++) {
    const y = aces(x);
    for (let k = 0; k < 3; k++) x[k] *= Math.min(4, (([want.r, want.g, want.b][k] + 1e-5) / (y[k] + 1e-5)) ** 0.8);
  }
  return c.setRGB(x[0], x[1], x[2]);
}

/** three.js's ACESFilmicToneMapping at exposure 1, linear in and out. */
function aces([r, g, b]: number[]) {
  const s = 1 / 0.6;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b].map((v) => {
    v *= s;
    return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  });
  return [1.60475 * i[0] - 0.53108 * i[1] - 0.07367 * i[2], -0.10208 * i[0] + 1.10813 * i[1] - 0.00605 * i[2], -0.00327 * i[0] - 0.07276 * i[1] + 1.07602 * i[2]].map((v) =>
    Math.min(1, Math.max(0, v)),
  );
}

export const SMOG_VERTEX_DECL = /* glsl */ `varying float vSmogY;\nvarying float vSmogDist;`;

/** World height and distance to the camera of `wp`, a world position. */
export const smogVertex = (wp: string) => /* glsl */ `
  vSmogY = (${wp}).y;
  vSmogDist = distance((${wp}).xyz, cameraPosition);
`;

export const SMOG_FRAGMENT_DECL = /* glsl */ `
  uniform float uSmogEven;
  uniform float uSmogFloor;
  uniform float uSmogFall;
  uniform vec3 uSmogColor;
  varying float vSmogY;
  varying float vSmogDist;
  vec3 smog(vec3 c) {
    float k = uSmogFall;
    float yc = cameraPosition.y;
    float dy = vSmogY - yc;
    // mean of exp(-k y) along the ray, from the eye's height to the fragment's
    float h = abs(dy) < 1e-3 ? exp(-k * yc) : (exp(-k * yc) - exp(-k * vSmogY)) / (k * dy);
    float depth = vSmogDist * (uSmogEven + uSmogFloor * h);
    return mix(uSmogColor, c, exp(-depth));
  }
`;

export const SMOG_FRAGMENT = /* glsl */ `if (uSmogEven + uSmogFloor > 0.0) gl_FragColor.rgb = smog(gl_FragColor.rgb);`;

/** Adds the fog to a built-in material's shader, from onBeforeCompile. */
export function addSmog(sh: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(sh.uniforms, SMOG);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SMOG_VERTEX_DECL}`).replace(
    '#include <project_vertex>',
    `#include <project_vertex>
    vec4 smogWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      smogWorld = instanceMatrix * smogWorld;
    #endif
    smogWorld = modelMatrix * smogWorld;
    ${smogVertex('smogWorld')}`,
  );
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${SMOG_FRAGMENT_DECL}`)
    .replace('#include <fog_fragment>', `#include <fog_fragment>\n${SMOG_FRAGMENT}`);
}

/** A material that only needs the fog (lamp glass): glowing bulbs sink into it like everything else. */
export function smogged<M extends THREE.Material>(mat: M): M {
  mat.onBeforeCompile = addSmog;
  return mat;
}
