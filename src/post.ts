import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Post-processing on high quality (docs/DESIGN.md, 4.5). The scene renders in HDR, multisampled, into
 * a half float target; bloom picks up only what is far brighter than any lit wall (bulbs, lit
 * windows across the yard); then one pass tone maps it exactly as the renderer does without
 * post-processing (ACES, sRGB) and grades it like old Soviet film stock: faded warm highlights,
 * slightly green shadows, a little less colour, a vignette, a faint colour fringe towards the
 * corners and grain. Everything but the grain depends on the frame alone, so the loop stays
 * seamless; the grain can be frozen for the pixel test (`frozen`).
 */

/** Linear HDR luminance a pixel needs to bloom: well above the brightest wall under a lamp. */
const BLOOM_THRESHOLD = 1.8;
const BLOOM_STRENGTH = 0.4;
const BLOOM_RADIUS = 0.4;

/** The vignette and the grade take a little light away; this gives it back, measured (docs/DESIGN.md, 4.9). */
const EXPOSURE_GAIN = 1.06;

const FILM = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1 },
    seed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float seed;
    varying vec2 vUv;

    // three.js's ACESFilmicToneMapping, so high and low quality share one curve
    vec3 filmFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 filmAces(vec3 color) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= exposure / 0.6;
      color = ACESOutputMat * filmFit(ACESInputMat * color);
      return clamp(color, 0.0, 1.0);
    }
    vec3 filmSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // red and blue drift apart a little towards the corners, as through a cheap lens
      vec2 fringe = d * r2 * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv - fringe).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + fringe).b);
      c = filmSRGB(filmAces(c));

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 0.85);
      // shadows a touch green, highlights warm and faded
      c += (1.0 - l) * (1.0 - l) * vec3(-0.004, 0.009, 0.0);
      c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.9), smoothstep(0.3, 1.0, l));
      c = mix(c, vec3(0.93, 0.9, 0.82), 0.04 * smoothstep(0.5, 1.0, l));
      c += 0.008;
      c *= 1.0 - 0.42 * smoothstep(0.06, 0.5, r2);

      // grain: stronger in the dark, as on film; per pixel, a new pattern every frame
      float n = hash(gl_FragCoord.xy + seed * vec2(37.0, 17.0)) + hash(gl_FragCoord.yx * 1.37 + seed * vec2(11.0, 53.0)) - 1.0;
      c += n * mix(0.045, 0.02, l);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Counts the scene's own draw calls, before the passes add their full-screen ones. */
class CountPass extends Pass {
  calls = 0;
  constructor() {
    super();
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer) {
    this.calls = renderer.info.render.calls;
  }
}

export class Post {
  /** The grain stands still (for comparing screenshots pixel for pixel). */
  frozen = false;
  private readonly composer: EffectComposer;
  private readonly film: ShaderPass;
  private readonly count = new CountPass();
  private frame = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(this.count);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
    this.film = new ShaderPass(FILM);
    this.film.uniforms.exposure.value = renderer.toneMappingExposure * EXPOSURE_GAIN;
    this.composer.addPass(this.film);
  }

  /** Draw calls of the scene itself in the last frame. */
  get sceneCalls() {
    return this.count.calls;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render() {
    if (!this.frozen) this.frame = (this.frame + 1) % 997;
    this.film.uniforms.seed.value = this.frame;
    this.composer.render();
  }
}
