import * as THREE from 'three';
import { ROOMS, type RoomId } from '../../shared/map.ts';
import { LAYERS } from './layers.ts';
import type { World } from './index.ts';

const SIZE = 128;
const EYE = 1.5;

/** One prefiltered environment map per room, captured once: the cell never changes. */
const maps = new Map<RoomId, THREE.Texture>();

/**
 * Reflections (docs/DESIGN.md, 4.3): every room gets a cube map shot from its centre after the light
 * is baked, so glossy floors, tiles and paint mirror the lamps and windows of their own room. The
 * shots are taken the first time a world is shown and reused for every later cycle. `hidden` are
 * things to leave out of them, like other players. Off in low quality. A cell with an anomaly is
 * never shot (it would be reflected forever): it waits for the next clean one.
 */
export function applyEnv(renderer: THREE.WebGLRenderer, scene: THREE.Scene, world: World, enabled: boolean, hidden: THREE.Object3D[] = []) {
  if (enabled && maps.size === 0 && !world.anomaly) {
    // the hall mirror's reflection isn't part of the room
    world.group.traverse((o) => o.userData.noEnv && hidden.push(o));
    capture(renderer, scene, hidden);
  }
  world.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    const room = m.userData.room as RoomId | undefined;
    if (!room || !m.isMeshStandardMaterial) return;
    const env = enabled ? (maps.get(room) ?? null) : null;
    if (m.envMap === env) return;
    m.envMap = env;
    m.needsUpdate = true;
  });
}

function capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hidden: THREE.Object3D[]) {
  const was = hidden.map((o) => o.visible);
  for (const o of hidden) o.visible = false;
  const target = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType });
  const camera = new THREE.CubeCamera(0.05, 40, target);
  for (const c of camera.children) c.layers.enable(LAYERS.far);
  const pmrem = new THREE.PMREMGenerator(renderer);
  for (const r of ROOMS) {
    camera.position.set((r.rect.x0 + r.rect.x1) / 2, Math.min(EYE, r.height - 0.3), (r.rect.z0 + r.rect.z1) / 2);
    camera.update(renderer, scene);
    maps.set(r.id, pmrem.fromCubemap(target.texture).texture);
  }
  pmrem.dispose();
  target.dispose();
  hidden.forEach((o, i) => (o.visible = was[i]));
}
