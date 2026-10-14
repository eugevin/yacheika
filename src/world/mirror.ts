import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { roomAt, type RoomId } from '../../shared/map.ts';
import { LAYERS } from './layers.ts';

/**
 * A real reflection (docs/DESIGN.md, 4.4), laid over a mirror's glass. It draws only what it can
 * show: its own `view` layer (world/index.ts puts the rooms around each mirror there), whatever is
 * added to the world later on layer 0 (players, anomalies) and `extra` layers. It renders only while
 * on screen and the camera stands in one of `from`, so a mirror seen through walls costs nothing.
 * Hidden in low quality, where the glass under it is left.
 */
export function realMirror(w: number, h: number, view: number, from: RoomId[], extra: number[] = []) {
  const scale = Math.min(devicePixelRatio, 1.5) * 0.5;
  const reflector = new Reflector(new THREE.PlaneGeometry(w, h), {
    textureWidth: Math.round(innerWidth * scale),
    textureHeight: Math.round(innerHeight * scale),
    clipBias: 0.003,
  });
  // the colour is overlaid on the reflection: 0.5 (linear) leaves it as it is; old silvering is a little darker
  (reflector.material as THREE.ShaderMaterial).uniforms.color.value.setRGB(0.42, 0.42, 0.41);
  const reflected = reflector.getReflectionCamera.bind(reflector);
  reflector.getReflectionCamera = (camera) => {
    const c = reflected(camera);
    c.layers.set(0);
    c.layers.enable(view);
    for (const l of extra) c.layers.enable(l);
    return c;
  };
  const render = reflector.onBeforeRender.bind(reflector);
  const here = new THREE.Vector3();
  // in a doorway (no room) the camera is still where it last was
  let room: RoomId | undefined;
  reflector.onBeforeRender = (renderer, scene, camera, ...rest) => {
    camera.getWorldPosition(here);
    room = roomAt(here.x, here.z)?.id ?? room;
    if (room && from.includes(room)) render(renderer, scene, camera, ...rest);
  };
  // not part of the room's environment map, and seen by the main camera only: one mirror in another's
  // view would render inside its render
  reflector.userData.noEnv = true;
  reflector.userData.mirror = true;
  reflector.layers.set(LAYERS.far);
  return reflector;
}
