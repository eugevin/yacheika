import * as THREE from 'three';
import type { RoomId } from '../../shared/map.ts';
import { YAW, type Facing } from './geometry.ts';
import { CHANNELS, kelvin, useBaked } from './lighting.ts';
import { smogged } from './smog.ts';

/** How bright a lit bulb looks: far above 1, so it stays white after tone mapping and blooms later. */
const BULB_GLOW = 14;

export interface LampSpec {
  x: number;
  z: number;
  ceiling: number;
  /**
   * 'grate': the stairwell kind in a wire cage; 'bulb': bare, on a cord; 'tube': kitchen fluorescent;
   * 'chandelier': three arms with glass shades; 'plafond': a frosted dome on the ceiling; 'sconce':
   * a wall lamp at height `y`, on the wall it faces away from.
   */
  style: 'grate' | 'bulb' | 'tube' | 'chandelier' | 'plafond' | 'sconce';
  y?: number;
  facing?: Facing;
  kelvin: number;
  /** Intensity in candela, as for a three.js point light. */
  power: number;
  /** A faint green cast, like a cheap fluorescent tube. */
  green?: number;
}

export interface Lamp {
  /** World position of the bulb, where light and buzz come from. Valid once the world's matrices are updated. */
  readonly pos: THREE.Vector3;
  /** The fitting, hung from its mount point; only the chandelier is kept apart from the merge, so it can swing. */
  readonly group: THREE.Object3D;
  /** What kind of lamp, which also sets how it sounds (audio.ts). */
  readonly style: LampSpec['style'];
  /** Room it lights, null for vestibule lamps. */
  room: RoomId | null;
  /** Baked light channel this lamp drives (lighting.ts). */
  channel: number;
  /** Brightness 0..1, as anomalies and the samosbor set it. */
  readonly level: number;
  /** What it gives now: its level times the power in the building (mains); the lamp's buzz follows it. */
  readonly lit: number;
  set(level: number): void;
  tint(color: THREE.ColorRepresentation): void;
  /** Power in the building, 0..1 (a blackout): on top of the level, so neither undoes the other. */
  mains(k: number): void;
}

/** Materials of lamp fittings, shared by all lamps of a world so they merge into a few meshes. */
export function fittings() {
  return {
    metal: useBaked(new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.4 })),
    brass: useBaked(new THREE.MeshStandardMaterial({ color: 0xb59a5a, roughness: 0.3, metalness: 1 })),
    body: useBaked(new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 })),
  };
}

export function makeLamp(parent: THREE.Object3D, spec: LampSpec, room: RoomId | null, channel: number, mats: ReturnType<typeof fittings>): Lamp {
  const g = new THREE.Group();
  g.position.set(spec.x, spec.style === 'sconce' ? spec.y! : spec.ceiling, spec.z);
  if (spec.facing) g.rotation.y = YAW[spec.facing];
  parent.add(g);
  const { metal, brass } = mats;
  const glass = smogged(new THREE.MeshBasicMaterial());
  // frosted glass glows dimmer than a bare filament, being larger
  let glow = BULB_GLOW;
  let bulb: THREE.Object3D;
  if (spec.style === 'chandelier') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), brass);
    stem.position.y = -0.225;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), brass);
    hub.position.y = -0.47;
    g.add(stem, hub);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), brass);
      arm.position.set(Math.cos(a) * 0.13, -0.47, Math.sin(a) * 0.13);
      arm.rotation.set(0, -a, Math.PI / 2);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.04, 0.12, 12, 1, true), glass);
      shade.position.set(Math.cos(a) * 0.26, -0.42, Math.sin(a) * 0.26);
      g.add(arm, shade);
    }
    glow = 2.2;
    bulb = new THREE.Object3D();
    bulb.position.y = -0.42;
    g.add(bulb);
    // kept out of the merge: an anomaly swings it
    g.userData.keepRoot = true;
    g.traverse((o) => (o.userData.keep = true));
  } else if (spec.style === 'plafond') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glass);
    dome.scale.y = 0.6;
    g.add(dome);
    glow = 1.6;
    bulb = new THREE.Object3D();
    bulb.position.y = -0.08;
    g.add(bulb);
  } else if (spec.style === 'sconce') {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), brass);
    plate.rotation.x = Math.PI / 2;
    plate.position.z = 0.01;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), brass);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 0.03, 0.1);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 14, 1, true), glass);
    shade.position.set(0, 0.06, 0.2);
    g.add(plate, arm, shade);
    glow = 1.8;
    bulb = new THREE.Object3D();
    bulb.position.set(0, 0.04, 0.2);
    g.add(bulb);
  } else if (spec.style === 'tube') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.12), mats.body);
    body.position.y = -0.025;
    bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), glass);
    bulb.rotation.z = Math.PI / 2;
    bulb.position.y = -0.075;
    g.add(body, bulb);
  } else {
    const drop = spec.style === 'grate' ? 0.16 : 0.35;
    bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), glass);
    bulb.position.y = -drop;
    bulb.scale.y = 1.3;
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 8), metal);
    socket.position.y = -drop + 0.075;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, drop - 0.1, 4), metal);
    cord.position.y = -(drop - 0.1) / 2;
    g.add(bulb, socket, cord);
    if (spec.style === 'grate') {
      const ring = (y: number, r: number) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 16), metal);
        m.rotation.x = Math.PI / 2;
        m.position.y = y;
        g.add(m);
      };
      ring(-0.04, 0.08);
      ring(-drop, 0.085);
      ring(-drop - 0.07, 0.05);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        // even segment counts everywhere: the vestibule lamp must look the same after a half turn
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, drop, 4), metal);
        wire.position.set(Math.cos(a) * 0.083, -0.04 - drop / 2 + 0.02, Math.sin(a) * 0.083);
        g.add(wire);
      }
    }
  }

  const base = kelvin(spec.kelvin);
  if (spec.green) base.g *= 1 + spec.green;
  let color = base.clone();
  let level = 1;
  let power = 1;
  const apply = () => {
    glass.color.copy(color).multiplyScalar(0.02 + glow * level * power);
    CHANNELS.value[channel].set(color.r, color.g, color.b).multiplyScalar(spec.power * level * power);
  };
  apply();
  return {
    get pos() {
      return bulb.getWorldPosition(new THREE.Vector3());
    },
    group: g,
    style: spec.style,
    room,
    channel,
    get level() {
      return level;
    },
    get lit() {
      return level * power;
    },
    set(l) {
      level = l;
      apply();
    },
    mains(k) {
      power = k;
      apply();
    },
    tint(c) {
      color = c instanceof THREE.Color ? c.clone() : new THREE.Color(c);
      apply();
    },
  };
}
