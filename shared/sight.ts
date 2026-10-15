import { walls, type Rect } from './map.ts';

/**
 * Who sees what, in plan only (docs/DESIGN.md: the chaser): a point is seen from a player's
 * position and yaw when it lies inside their view cone and the line to it crosses no wall. Doorways
 * are gaps in the walls; furniture, door leaves and lintels are ignored. The server decides with it
 * (the chaser moves only while nobody looks); src/gaze.ts keeps the finer check with furniture and
 * height for what only a client decides.
 */

export interface Viewer {
  x: number;
  z: number;
  /** The camera's yaw: 0 looks towards -z. */
  yaw: number;
}

/**
 * Half the view the server counts as looking, radians: a little wider than the widest screen (72°
 * high, so about 52° each side at 16:9 and 60° at 21:9), to cover how late positions arrive.
 */
export const SIGHT_CONE = 1.15;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Inside the viewer's cone, whatever is in between. */
export function inCone(v: Viewer, x: number, z: number, half = SIGHT_CONE) {
  return Math.abs(wrap(Math.atan2(-(x - v.x), -(z - v.z)) - v.yaw)) <= half;
}

/** Whether a segment passes through the inside of a rectangle (touching its edge doesn't count). */
function crosses(r: Rect, ax: number, az: number, bx: number, bz: number) {
  const e = 1e-6;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (const [p, q] of [
    [-dx, ax - (r.x0 + e)],
    [dx, r.x1 - e - ax],
    [-dz, az - (r.z0 + e)],
    [dz, r.z1 - e - az],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** No wall between two points of the floor plan. */
export function lineClear(ax: number, az: number, bx: number, bz: number) {
  return !walls().some((r) => crosses(r, ax, az, bx, bz));
}

/** The viewer sees the point: in the cone, and no wall in between. */
export function seesPoint(v: Viewer, x: number, z: number, half = SIGHT_CONE) {
  return inCone(v, x, z, half) && lineClear(v.x, v.z, x, z);
}
