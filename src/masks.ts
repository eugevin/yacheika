import * as THREE from 'three';
import { ATLAS, BONE, patch, thetaAt, type Look, type Parts } from './character.ts';

const RUBBER = '#3d433c';

/**
 * Torus arc round the head at height y (head frame), hugging the skull, open in front over `gap` radians: the ties of
 * a gauze mask, the elastic of a respirator.
 */
function band(tube: number, y: number, gap: number) {
  // just off the skull at that height
  const r = Math.sqrt(0.115 ** 2 - (y - 0.12) ** 2) + tube;
  const arc = Math.PI * 2 - gap;
  const g = new THREE.TorusGeometry(r, tube, 4, 24, arc);
  // lie flat (the arc then runs from +x towards +z), then turn its middle to the back of the head
  g.rotateX(Math.PI / 2);
  g.rotateY(arc / 2 - Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/**
 * Protective gear on the head (docs/DESIGN.md, 3.3), in the head bone's frame: the skull is a sphere
 * of 0.115 around (0, 0.12, 0), the face looks down -z, eyes at y 0.14. The face picture itself is
 * painted in character.ts. Whatever glows lights up with the voice. Returns whether hair shows.
 */
export function wearGear(p: Parts, look: Look): { hair: boolean } {
  const H = BONE.head;
  // the L-1 hood goes over everything but the face: a cap and the back and sides down to the neck
  if (look.outfit === 'l1') {
    const hood = new THREE.Color(look.color).lerp(new THREE.Color(0x808080), 0.35).multiplyScalar(0.55);
    p.add(H, new THREE.SphereGeometry(0.135, 16, 6, 0, Math.PI * 2, 0, 0.95), hood, { at: [0, 0.12, 0] });
    p.add(H, new THREE.SphereGeometry(0.135, 16, 8, Math.PI / 2 - 2.25, 4.5, 0.9, 1.45), hood, { at: [0, 0.12, 0] });
  }
  const hood = look.outfit === 'l1';
  switch (look.mask) {
    case 'gp5': {
      // a rubber helmet over the whole head, the round eyepieces painted on its front patch;
      // the valve box at the mouth and the filter can screwed on below it
      p.add(H, new THREE.SphereGeometry(0.126, 18, 14), RUBBER, { at: [0, 0.12, 0] });
      p.add(H, patch(0.1285, [thetaAt(0.22, 0.1285), thetaAt(0.0, 0.1285)], 1.2), 0xffffff, { project: ATLAS.face });
      p.add(H, new THREE.CylinderGeometry(0.034, 0.04, 0.05, 14), '#2f332e', { at: [0, 0.06, -0.135], rot: [Math.PI / 2, 0, 0] });
      p.add(H, new THREE.CylinderGeometry(0.048, 0.048, 0.085, 16), '#56594f', { at: [0, 0.0, -0.15], rot: [0.35, 0, 0] });
      return { hair: false };
    }
    case 'gauze': {
      // a white gauze pad over the nose and the mouth, tied at the back twice
      const r = 0.1215;
      p.add(H, patch(r, [thetaAt(0.115, r), thetaAt(0.025, r)], 1.15), 0xffffff, { project: ATLAS.gauze });
      for (const y of [0.105, 0.055]) p.add(H, band(0.0035, y, 2.2), '#d8d4c8');
      return { hair: !hood };
    }
    case 'petal': {
      // the round white «Lepestok» cup on an elastic
      const cup = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cup.rotateX(-Math.PI / 2);
      cup.scale(0.066, 0.06, 0.05);
      p.add(H, cup, '#e6e3da', { at: [0, 0.075, -0.098], glow: '#cfcabd' });
      p.add(H, band(0.003, 0.085, 1.6), '#d6d0c2');
      return { hair: !hood };
    }
    case 'welder': {
      // a dark shield in front of the face with a green glass slot, on a headband
      p.box(H, 0.25, 0.3, 0.022, '#2b2b29', [0, 0.1, -0.152]);
      for (const side of [-1, 1]) p.box(H, 0.02, 0.28, 0.1, '#2b2b29', [side * 0.13, 0.1, -0.11], { rot: [0, side * 0.3, 0] });
      p.box(H, 0.13, 0.045, 0.01, '#1c3a2b', [0, 0.14, -0.166], { glow: '#58c98a' });
      p.add(H, new THREE.TorusGeometry(0.126, 0.008, 4, 28), '#222220', { at: [0, 0.19, 0], rot: [Math.PI / 2, 0, 0] });
      return { hair: !hood };
    }
    case 'ushanka': {
      // a fur hat with the ear flaps down and a scarf wound up to the eyes
      const fur = '#4b3d30';
      p.add(H, new THREE.CylinderGeometry(0.125, 0.13, 0.1, 20), fur, { at: [0, 0.245, 0] });
      p.add(H, new THREE.CylinderGeometry(0.138, 0.138, 0.06, 20), '#5a4a3b', { at: [0, 0.195, 0] });
      for (const side of [-1, 1]) p.box(H, 0.03, 0.12, 0.11, fur, [side * 0.132, 0.12, 0.005]);
      p.add(H, new THREE.CylinderGeometry(0.126, 0.1, 0.12, 20), '#6e2b25', { at: [0, 0.065, 0], glow: '#a85a48' });
      return { hair: false };
    }
    case 'none':
      return { hair: !hood };
  }
}
