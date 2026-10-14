import * as THREE from 'three';
import { Character, type Look } from './character.ts';
import { rng } from './textures.ts';

/**
 * The lobby's photo for the resident's card: your character turning slowly in a small renderer of
 * its own, rebuilt on every change. It also draws the picker's icons. Disposed once you join, so
 * only the game's renderer is left.
 */
export class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 3 / 4, 0.1, 20);
  private char: Character | null = null;
  private frame = 0;
  private last = 0;
  private turn = 0.5;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // the drawing buffer is kept so the icons can be copied off it right after each render
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 180, canvas.clientHeight || 240, false);
    this.camera.position.set(0, 1.05, -4.1);
    this.camera.lookAt(0, 0.92, 0);
  }

  set(look: Look) {
    this.char?.dispose();
    if (this.char) this.scene.remove(this.char.root);
    this.char = this.make(look);
    this.scene.add(this.char.root);
  }

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.turn += dt * 0.55;
      if (this.char) {
        this.char.root.rotation.y = Math.sin(this.turn) * 0.9;
        this.char.animate(dt, now / 1000, 0, 0, 0);
      }
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** Draws `look` onto an icon: the whole figure, or just the head. */
  icon(target: HTMLCanvasElement, look: Look, part: 'body' | 'head') {
    const c = this.make(look);
    c.root.rotation.y = -0.45;
    c.animate(1, 0, 0, 0, 0);
    const scene = new THREE.Scene();
    scene.add(c.root);
    const cam = new THREE.PerspectiveCamera(30, this.canvas.width / this.canvas.height, 0.1, 20);
    if (part === 'head') {
      cam.position.set(0, 1.7, -1.05);
      cam.lookAt(0, 1.68, 0);
    } else {
      cam.position.copy(this.camera.position);
      cam.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(scene, cam);
    const g = target.getContext('2d')!;
    g.clearRect(0, 0, target.width, target.height);
    // the render is 3:4; an icon is square, cut from the middle
    const { width: w, height: h } = this.canvas;
    const side = part === 'head' ? w * 0.75 : h * 0.6;
    g.drawImage(this.canvas, (w - side) / 2, (h - side) / 2, side, side, 0, 0, target.width, target.height);
    c.dispose();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.char?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private make(look: Look) {
    const c = new Character(look);
    // no bake here: an even, slightly warm light, like a photographer's lamp
    c.probe.base.set(2.7, 2.55, 2.3);
    return c;
  }
}

/** Cork for the notice board: specks of darker and lighter bark on a warm brown, tileable. */
export function corkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a6c40';
  g.fillRect(0, 0, 256, 256);
  const r = rng(49);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const s = 0.6 + r() * 2.4;
    const l = r();
    g.fillStyle = l < 0.45 ? `rgba(70,40,18,${0.25 + r() * 0.4})` : l < 0.8 ? `rgba(196,150,96,${0.2 + r() * 0.35})` : `rgba(40,22,10,${0.3 + r() * 0.4})`;
    const ry = s * (0.6 + r() * 0.5);
    const turn = r() * Math.PI;
    // wrap round the edges so the tile repeats without seams
    for (const dx of [-256, 0, 256])
      for (const dy of [-256, 0, 256]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, s, ry, turn, 0, Math.PI * 2);
        g.fill();
      }
  }
  return c.toDataURL();
}
