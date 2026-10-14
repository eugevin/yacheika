import * as THREE from 'three';

/** Deterministic PRNG (mulberry32): textures and anomaly placement must look the same for everyone. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTexture(w: number, h: number, draw: Draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A sign with lines of text, centred. Not cached: anomalies need variants. */
export function signTexture(
  lines: string[],
  opt: { w?: number; h?: number; bg?: string; fg?: string; font?: string; border?: string } = {},
) {
  const { w = 256, h = 128, bg = '#f4f1e6', fg = '#222', font = 'bold 34px sans-serif', border } = opt;
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 8;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = h / (lines.length + 1);
    lines.forEach((l, i) => g.fillText(l, w / 2, step * (i + 1)));
  });
}
