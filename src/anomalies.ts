import * as THREE from 'three';
import { ANOMALIES } from '../shared/anomalies.ts';
import { FURNITURE } from '../shared/furniture.ts';
import { ROOM_BY_ID, ROOMS, doorRect, inCell, onSide, roomAt, type RoomId } from '../shared/map.ts';
import { adjacent, alone } from '../shared/walk.ts';
import { MASKS, OUTFITS } from '../shared/masks.ts';
import type { PlayerInfo } from '../shared/protocol.ts';
import { Character, type Look } from './character.ts';
import { anyoneSees, eyeOf, sees } from './gaze.ts';
import { shimmer } from './morok.ts';
import { STRANGER_NAMES } from './stranger.ts';
import { canvasTexture, rng } from './textures.ts';
import { darkenWindows } from './world/exterior.ts';
import { cloth } from './world/furniture.ts';
import { INWARD, YAW } from './world/geometry.ts';
import { STEP_LEN } from './player.ts';
import { reachesZone } from './world/ambience.ts';
import { LAYERS, swingLeaf, type Lamp, type World } from './world/index.ts';
import { kelvin, useBaked, type Probe } from './world/lighting.ts';
import { PORTRAIT_EYES, calendarSheet, carpet, notice, portrait, radioFront } from './world/pictures.ts';
import { SEATS } from './world/rooms/kitchen.ts';
import { REVEAL } from './world/shell.ts';
import { darkenYard, glowMaterial, outdoorMaterial, panelTexture, windowAcross } from './world/yard.ts';

type Rand = () => number;
/** Who is in the room, for anomalies that copy or single out a player: their ids and looks. */
export interface People {
  self: PlayerInfo;
  others: PlayerInfo[];
  /**
   * A phrase one of the others said, recorded on this machine only (voice.ts, the voice mimic), or
   * null when nobody has said anything yet.
   */
  phrase?: (r: Rand) => { from: number; buffer: AudioBuffer } | null;
}
/**
 * What it changed, moved, animates or added: shimmered by a morok (morok.ts), and kept apart from
 * the cell's merged meshes (World.settle). A sound-only anomaly that touches nothing returns nothing.
 */
type Apply = (w: World, r: Rand, cycle: number, people: People) => THREE.Object3D[] | void;

const pick = <T>(list: readonly T[], r: Rand) => list[Math.floor(r() * list.length)];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** A point in an object's frame, in world space. */
const worldAt = (o: THREE.Object3D, x = 0, y = 0, z = 0) => o.localToWorld(V(x, y, z));

/** A material for something an anomaly adds: lit as a whole by the baked light over (x, z) (lighting.ts, useBaked). */
function lit(w: World, at: { x: number; z: number }, params: THREE.MeshStandardMaterialParameters) {
  const probe: Probe = { base: V(), idx: new THREE.Vector4(), w: new THREE.Vector4() };
  w.probe(at.x, at.z, probe);
  return useBaked(new THREE.MeshStandardMaterial(params), probe);
}

function setMap(m: THREE.MeshStandardMaterial, t: THREE.Texture) {
  m.map?.dispose();
  m.map = t;
}

/** Nothing but black: the inside of something opened, where no light gets. */
const darkness = () => new THREE.MeshBasicMaterial({ color: 0x000000 });

/** A soft round spot, for glows and the like. */
function spot(rgb: string) {
  return canvasTexture(128, 128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    gr.addColorStop(0.4, `rgba(${rgb},0.45)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
}

/** A glow on the floor: light spilling from something that shouldn't be shining. */
function floorGlow(w: World, x: number, z: number, size: number, rgb: string, strength: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: spot(rgb), transparent: true, opacity: strength, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.006, z);
  // a morok casts no light
  if (w.morok !== 'sight') w.group.add(m);
  return m;
}

const roomLamps = (w: World, room: RoomId) => w.lamps.filter((l) => l.room === room);
/** Rooms with a lamp of their own, for the light anomalies. */
const LIT_ROOMS: RoomId[] = ['landing', 'corridor', 'hall', 'passage', 'bath', 'wc', 'kitchen', 'living', 'bedroom', 'loggia'];

/** Somebody from the room to copy or to name: another player, or yourself when alone. */
const someone = (people: People, r: Rand) => (people.others.length ? pick(people.others, r) : people.self);

/** Where a player's look sits when not walking around: a still Character, lit where it stands. */
function figure(w: World, look: Look, x: number, z: number) {
  const c = new Character(look);
  c.root.position.set(x, 0, z);
  c.animate(1, 0, 0, 0, 0);
  w.probe(x, z, c.probe);
  w.group.add(c.root);
  return c;
}

/** Yaw that faces local -z (people, the camera) from (x, z) towards (tx, tz). */
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A dark human shape: a body and a head, unlit. */
function silhouette() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x141412 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 12), mat);
  body.position.y = 0.95;
  body.scale.z = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), mat);
  head.position.y = 1.68;
  g.add(body, head);
  return g;
}

/** Alone for this long before an alone anomaly comes. */
const ALONE_HOLD = 1.5;

/**
 * For the alone anomalies (shared/anomalies.ts, `alone`): waits until our player is alone in the
 * cell (shared/walk.ts, alone; teammates as this screen sees them) for a moment, then calls `come`
 * with where we are, once it returns true. It may return false to wait for a better moment (a door
 * behind us, a sound that would reach an exit zone). `track` sees every frame, alone or not.
 */
function whenAlone(w: World, come: (eye: THREE.Vector3, cam: THREE.Camera, dt: number) => boolean, track?: (eye: THREE.Vector3) => void) {
  const eye = V();
  let held = 0;
  let done = false;
  w.updaters.push((_t, dt, cam) => {
    cam.getWorldPosition(eye);
    track?.(eye);
    if (done) return;
    const by = inCell(eye.x, eye.z) && alone(eye, w.teammates);
    held = by ? held + dt : 0;
    if (held >= ALONE_HOLD) done = come(eye, cam, dt);
  });
}

/** A sound of an alone anomaly, placed now: plays at once, dry when it is a morok. */
function cue(w: World, e: Omit<Parameters<World['emitters']['push']>[0], 'once' | 'dry'>) {
  if (reachesZone(e.x, e.z, e.range)) return false;
  w.emitters.push({ ...e, once: true, dry: w.morok === 'sound' });
  return true;
}

/** How each anomaly from shared/anomalies.ts changes a freshly built cell. */
const APPLY: Record<string, Apply> = {
  // --- landing and floor corridor ---

  floor_wrong: (w, r, cycle) => {
    const n = cycle + pick(cycle > 0 ? [1, 2, -1] : [1, 2], r);
    setMap(w.floorSign.material, w.floorTexture(String(n)));
    return [w.floorSign];
  },
  floor_mirror: (w, _r, cycle) => {
    setMap(w.floorSign.material, w.floorTexture(String(cycle), true));
    return [w.floorSign];
  },
  neighbour_ajar: (w, r) => {
    // one of flats 43-48 stands ajar onto the corridor, nothing but dark behind it (the creak of 41 and 42 would reach the vestibule)
    const doors = Object.entries(w.props.common.neighbourDoors).filter(([n]) => Number(n) >= 43);
    const leaf = pick(doors, r)[1];
    leaf.rotation.y = -0.38;
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.05), darkness());
    gap.position.set(0, 1.025, 0.002);
    leaf.parent!.add(gap);
    const p = worldAt(leaf.parent!, 0, 1.2, 0.3);
    w.emitters.push({ kind: 'creak', x: p.x, y: p.y, z: p.z, range: 8, near: 3.5 });
    return [leaf, gap];
  },
  notice_other: (w, r) => {
    const text = pick(
      [
        ['Жильцам 9-го блока!', 'НЕ ОТКРЫВАЙТЕ ДВЕРЬ.', 'Даже если вас', 'позовут по имени.', 'Даже если голос', 'знакомый.', 'Домком'],
        ['Жильцам 9-го блока!', 'Проверка гермодверей', 'отменена.', 'Гермодвери', 'больше не закрываются.', '', 'Домком'],
        ['Жильцам 9-го блока!', 'Если вы читаете это', 'второй раз —', 'вернитесь назад.', 'Не оборачивайтесь.', '', 'Домком'],
      ],
      r,
    );
    setMap(w.props.common.notice.material, notice('ОБЪЯВЛЕНИЕ', text));
    return [w.props.common.notice];
  },
  chute_hum: (w) => {
    // a drone up the rubbish chute, and the hatch trembling with it
    const hatch = w.props.common.chuteHatch;
    const z0 = hatch.position.z;
    w.updaters.push((t) => {
      const swell = 0.6 + 0.4 * Math.sin(t * 1.45);
      hatch.position.z = z0 + 0.0025 * swell * Math.sin(t * 2 * Math.PI * 23);
      hatch.rotation.x = 0.012 * swell * Math.sin(t * 2 * Math.PI * 11.5);
    });
    const p = worldAt(hatch);
    w.emitters.push({ kind: 'chute', x: p.x, y: p.y, z: p.z, range: 7 });
    return [hatch];
  },
  lamp_broken: (w, r) => {
    // a dead corridor bulb and its glass on the floor under it
    const lamp = pick(roomLamps(w, 'corridor'), r);
    lamp.set(0);
    const { x, z } = lamp.pos;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = 0.08 + r() * 0.45;
      const c = V(x + Math.cos(a) * d, 0.004, z + Math.sin(a) * d);
      const s = 0.02 + r() * 0.035;
      const turn = r() * Math.PI * 2;
      // a jagged triangle of glass lying flat
      for (const [u, v] of [[-s, 0], [s * (0.4 + r()), -s * 0.6], [0, s * (0.6 + r())]]) points.push(V(u, 0, v).applyAxisAngle(V(0, 1, 0), turn).add(c));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    geo.computeVertexNormals();
    // a faint glint of their own: under a dead lamp they would be lost in the dark
    const glass = lit(w, { x, z }, { color: 0xe8eef0, emissive: 0x30383c, roughness: 0.08, metalness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    w.group.add(new THREE.Mesh(geo, glass));
  },
  mailbox_open: (w, r) => {
    // one of the twelve boxes hangs open with letters sticking out
    const g = w.props.common.mailboxes;
    const p = FURNITURE.mailboxes;
    const width = p.z1 - p.z0;
    const height = p.h - (p.y0 ?? 0);
    const depth = p.x1 - p.x0;
    const i = Math.floor(r() * 12);
    const bw = width / 4;
    const bh = height / 3;
    const cx = -width / 2 + ((i % 4) + 0.5) * bw;
    const cy = (2 - Math.floor(i / 4)) * bh + bh / 2;
    const front = depth / 2 + 0.006;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.03, bh - 0.03), darkness());
    hole.position.set(cx, cy, front + 0.0055);
    g.add(hole);
    const at = worldAt(g, cx, cy, 0.3);
    const steel = lit(w, at, { color: 0x5d6e78, roughness: 0.45 });
    const hinge = new THREE.Group();
    hinge.position.set(cx - bw / 2 + 0.01, cy, front + 0.006);
    hinge.rotation.y = -1.9;
    g.add(hinge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.02, bh - 0.02, 0.01), steel);
    door.position.set((bw - 0.02) / 2, 0, 0.005);
    hinge.add(door);
    const paper = lit(w, at, { color: 0xe8e2d0, roughness: 0.9 });
    const letters = [0, 1, 2].map((k) => {
      const letter = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.003), paper);
      letter.position.set(cx + (k - 1) * 0.05, cy - 0.04 + k * 0.02, front + 0.02 + k * 0.012);
      letter.rotation.set(-0.5 - r() * 0.3, 0, (r() - 0.5) * 0.5);
      g.add(letter);
      return letter;
    });
    return [hole, hinge, ...letters];
  },

  // --- hall and pantry ---

  slippers_extra: (w, r) => {
    // one pair more than there are people: a copy of a pair, a step further along the wall
    const pairs = w.props.hall.slippers.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    const zOf = (m: THREE.Mesh) => (m.geometry.computeBoundingBox(), m.geometry.boundingBox!.max.z);
    const last = pairs.reduce((a, b) => (zOf(a) > zOf(b) ? a : b));
    const extra = last.clone();
    extra.material = pick(pairs, r).material;
    extra.position.z += 0.25;
    w.props.hall.slippers.add(extra);
    return [extra];
  },
  receiver_off: (w) => {
    // the handset lies beside the phone, purring the dial tone
    const rec = w.props.hall.receiver;
    rec.position.set(-0.24, 0.031, 0.06);
    rec.rotation.set(0, 0.5, 0);
    rec.updateMatrixWorld(true);
    const p = worldAt(rec);
    w.emitters.push({ kind: 'dialtone', x: p.x, y: p.y, z: p.z, range: 3.5 });
    return [rec];
  },
  phone_ringing: (w) => {
    const p = worldAt(w.props.hall.receiver.parent!);
    w.emitters.push({ kind: 'phone', x: p.x, y: p.y, z: p.z, range: 9, every: 4, at: [1] });
  },
  meter_backwards: (w) => {
    w.props.hall.meter.dir = -1;
    return [w.props.hall.meterDisk];
  },
  chain_extra: (w) => {
    const chain = w.props.hall.chain;
    const second = chain.clone();
    second.position.x += 0.075;
    second.position.y -= 0.03;
    chain.parent!.add(second);
    return [second];
  },
  mirror_extra: (w, r) => {
    // Somebody stands in the doorway to the passage, looking into the mirror; seen only in the
    // mirror, from anywhere in the hall. In low quality a dark shape shows through the murky glass.
    const m = w.props.hall.mirror;
    const [x, z] = [24.95, 6.22];
    const stranger = figure(w, { name: '', color: '#5c5a54', mask: pick(MASKS, r).id, outfit: pick(OUTFITS, r).id, flat: 0 }, x, z);
    stranger.root.rotation.y = yawTo(x, z, m.centre.x, m.centre.z);
    stranger.root.traverse((o) => o.layers.set(LAYERS.mirror));
    const shape = canvasTexture(128, 256, (g) => {
      g.filter = 'blur(6px)';
      g.fillStyle = 'rgba(12,12,10,0.7)';
      g.beginPath();
      g.ellipse(64, 70, 22, 28, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(64, 200, 44, 100, 0, 0, Math.PI * 2);
      g.fill();
    });
    const ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.44),
      lit(w, m.centre, { map: shape, transparent: true, depthWrite: false, roughness: 1 }),
    );
    ghost.position.set(0, 0.4, 0.0315);
    m.glass.parent!.add(ghost);
    m.ghost = ghost;
    return [stranger.root, ghost];
  },
  pantry_open: (w) => {
    // the pantry door stands open into the hall: nothing inside but dark
    const slab = w.props.hall.pantryDoor;
    const d = 0.8;
    const hinge = new THREE.Group();
    hinge.position.set(-d / 2, 0, slab.position.z + 0.02);
    slab.parent!.add(hinge);
    hinge.attach(slab);
    hinge.rotation.y = -0.87;
    // the pantry has no lamp: from the hall it is just a dark hole
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(d, 2), darkness());
    hole.position.set(0, 1, -0.119);
    slab.parent!.parent!.add(hole);
    const p = worldAt(hinge, d / 2, 1.2, 0.3);
    w.emitters.push({ kind: 'creak', x: p.x, y: p.y, z: p.z, range: 7, near: 3 });
    return [hinge, hole];
  },

  // --- kitchen ---

  burner_on: (w, r) => {
    const i = Math.floor(r() * 4);
    const b = w.props.kitchen.burners[i];
    const flame = b.getObjectByName('flame')!;
    flame.visible = true;
    w.updaters.push((t) => flame.scale.set(1 + 0.06 * Math.sin(t * 37 + i), 0.85 + 0.2 * Math.abs(Math.sin(t * 13.3 + i * 2)), 1 + 0.06 * Math.sin(t * 29)));
    const p = worldAt(b, 0, 0.05, 0);
    w.emitters.push({ kind: 'hiss', x: p.x, y: p.y, z: p.z, range: 4 });
    return [flame];
  },
  fridge_open: (w) => {
    // the ZIL stands open, its lamp lighting the shelves and a patch of floor
    const door = w.props.kitchen.fridgeDoor;
    door.rotation.y = 1.75;
    const body = door.parent!;
    const p = FURNITURE.fridge;
    const fw = p.x1 - p.x0;
    const fd = p.z1 - p.z0;
    const inside = canvasTexture(128, 256, (g, cw, ch) => {
      const gr = g.createLinearGradient(0, 0, 0, ch);
      gr.addColorStop(0, '#fffaf0');
      gr.addColorStop(1, '#b8b4aa');
      g.fillStyle = gr;
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = 'rgba(90,90,85,0.6)';
      for (const y of [0.3, 0.52, 0.74]) g.fillRect(4, y * ch, cw - 8, 4);
      // a jar, a bottle, a pan on the shelves
      g.fillStyle = '#8a6a3a';
      g.fillRect(20, 0.3 * ch - 26, 22, 26);
      g.fillStyle = '#4a6a4a';
      g.fillRect(80, 0.52 * ch - 44, 12, 44);
      g.fillStyle = '#9a9a96';
      g.fillRect(30, 0.74 * ch - 20, 60, 20);
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.08, p.h - 0.25), new THREE.MeshBasicMaterial({ map: inside, color: new THREE.Color(1.25, 1.2, 1.1) }));
    glow.position.set(0, 0.12 + (p.h - 0.25) / 2, fd / 2 - 0.04 + 0.002);
    body.add(glow);
    const f = worldAt(body, 0, 0, fd / 2 + 0.5);
    floorGlow(w, f.x, f.z, 1.4, '255,248,230', 0.18);
    return [door, glow];
  },
  calendar_year: (w, r) => {
    setMap(w.props.kitchen.calendar.material, calendarSheet(pick([1985, 1987, 1968, 1991, 2026], r)));
    return [w.props.kitchen.calendar];
  },
  plate_extra: (w, r, _c, people) => {
    // one plate more than there are people at the table
    const n = 1 + people.others.length;
    const [dx, dz] = n < SEATS.length ? SEATS[n] : pick(SEATS, r);
    const at = w.props.kitchen.plates.position;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.015, 20), lit(w, at, { color: 0xe4e0d6, roughness: 0.5 }));
    plate.position.set(at.x + dx, at.y + 0.0075, at.z + dz);
    w.group.add(plate);
    return [plate];
  },
  radio_reversed: (w) => {
    w.ambience.find((a) => a.kind === 'radio')!.reversed = true;
  },
  radio_name: (w, r, _c, people) => {
    const name = someone(people, r).name || 'жилец';
    w.ambience.find((a) => a.kind === 'radio')!.announce = name;
    setMap(w.props.kitchen.radioFront.material, radioFront(name));
  },
  tap_running: (w) => {
    // water running from the tap into the sink
    const tap = w.props.kitchen.tap;
    const top = worldAt(tap, 0, 0.27, 0.155);
    const len = top.y - 0.885;
    const water = lit(w, top, { color: 0xd8e6ea, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.6, depthWrite: false });
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, len, 8), water);
    stream.position.set(top.x, top.y - len / 2, top.z);
    const splash = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), water);
    splash.rotation.x = -Math.PI / 2;
    splash.position.set(top.x, 0.887, top.z);
    w.group.add(stream, splash);
    w.updaters.push((t) => {
      stream.scale.set(1 + 0.12 * Math.sin(t * 41), 1, 1 + 0.12 * Math.sin(t * 37 + 1));
      splash.scale.setScalar(0.8 + 0.25 * Math.abs(Math.sin(t * 9)));
    });
    w.emitters.push({ kind: 'stream', x: top.x, y: 0.95, z: top.z, range: 4.5 });
    return [stream, splash];
  },
  kettle_whistle: (w) => {
    // the cold kettle on the cold stove whistles, and steam curls from its spout
    const kettle = w.props.kitchen.kettle;
    const spout = worldAt(kettle, 0.15, 0.15, 0);
    w.emitters.push({ kind: 'whistle', x: spout.x, y: spout.y, z: spout.z, range: 6 });
    const N = 16;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const steam = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.09, map: spot('255,255,255'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    steam.frustumCulled = false;
    w.group.add(steam);
    const LIFE = 1.8;
    w.updaters.push((t) => {
      for (let i = 0; i < N; i++) {
        const a = ((t / LIFE + i / N) % 1 + 1) % 1;
        const sway = Math.sin(t * 1.7 + i * 2.3) * 0.04 * a;
        pos.set([spout.x + 0.05 * a + sway, spout.y + 0.4 * a, spout.z + Math.cos(t * 1.3 + i) * 0.03 * a], i * 3);
        const v = 0.22 * Math.sin(Math.PI * a);
        col.set([v, v, v], i * 3);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    });
  },

  // --- bathroom and toilet ---

  tub_full: (w) => {
    w.props.bath.water.visible = true;
    return [w.props.bath.water];
  },
  curtain_closed: (w) => {
    // the shower curtain is drawn, and somebody stands in the tub behind it
    const old = w.props.bath.curtain;
    old.visible = false;
    const src = old.material as THREE.MeshStandardMaterial;
    const at = { x: 22.66, z: 7.14 };
    const mat = lit(w, at, { map: src.map, bumpMap: src.bumpMap, roughness: 0.9, transparent: true, opacity: 0.84, side: THREE.DoubleSide, depthWrite: false });
    const c = cloth(mat, 1.68, 1.55, 7, 0.04);
    c.position.set(23.04, 2.0, 7.14);
    c.rotation.y = Math.PI / 2;
    const shape = silhouette();
    shape.position.set(22.62, 0.08, 7.35);
    w.group.add(c, shape);
    return [old, c, shape];
  },
  mirror_writing: (w) => {
    // "you have been here before", written with a finger on the steamed-up mirror
    const m = w.props.bath.mirror;
    const fog = canvasTexture(256, 320, (g, cw, ch) => {
      const r = rng(17);
      g.fillStyle = 'rgba(236,240,240,0.62)';
      g.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
        g.fillRect(r() * cw, r() * ch, 2, 2);
      }
      g.globalCompositeOperation = 'destination-out';
      g.font = 'bold 50px sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = g.fillStyle = 'rgba(0,0,0,0.9)';
      ['ВЫ УЖЕ', 'БЫЛИ', 'ЗДЕСЬ'].forEach((line, i) => {
        g.fillText(line, cw / 2, 90 + i * 80);
        g.strokeText(line, cw / 2, 90 + i * 80);
      });
      // drips running down from the strokes
      for (let i = 0; i < 9; i++) {
        const x = 40 + r() * (cw - 80);
        const y = 80 + Math.floor(r() * 3) * 80;
        g.fillRect(x, y, 2, 20 + r() * 40);
      }
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.46), lit(w, { x: 23.65, z: 7.8 }, { map: fog, transparent: true, depthWrite: false, roughness: 0.9 }));
    glass.position.set(0, 0.23, 0.0105);
    m.parent!.add(glass);
    return [glass];
  },
  cistern_running: (w) => {
    const p = worldAt(w.props.bath.cistern, 0, 0.13, 0.1);
    w.emitters.push({ kind: 'cistern', x: p.x, y: p.y, z: p.z, range: 4 });
  },

  // --- living room ---

  carpet_flipped: (w) => {
    const map = w.props.living.wallCarpet.material.map!;
    map.center.set(0.5, 0.5);
    map.rotation = Math.PI;
    return [w.props.living.wallCarpet];
  },
  carpet_other: (w) => {
    setMap(w.props.living.wallCarpet.material, carpet(3, 1));
    return [w.props.living.wallCarpet];
  },
  tv_on: (w, r) => {
    // The TV is on: snow, or a line of text through it, and its flicker on the floor. The snow is
    // a data texture: redrawing a canvas this often stalls some browsers on the read back.
    const noise = rng(Math.floor(r() * 1e9));
    const W = 96;
    const H = 72;
    const data = new Uint8Array(W * H * 4);
    const tex = new THREE.DataTexture(data, W, H);
    tex.colorSpace = THREE.SRGBColorSpace;
    let bright = 0.5;
    const draw = () => {
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const v = 40 + noise() * 170;
        sum += v;
        data[i] = data[i + 1] = v;
        data[i + 2] = Math.min(255, v * 1.05);
        data[i + 3] = 255;
      }
      bright = sum / (W * H) / 255;
      tex.needsUpdate = true;
    };
    draw();
    const screen = w.props.living.tvScreen;
    const m = screen.material;
    m.map?.dispose();
    m.map = m.emissiveMap = tex;
    m.color.set(0x111111);
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 1.4;
    if (r() < 0.5) {
      const caption = canvasTexture(128, 96, (g, cw) => {
        g.fillStyle = 'rgba(10,10,12,0.8)';
        g.fillRect(4, 30, cw - 8, 40);
        g.fillStyle = '#e8e8e0';
        g.font = 'bold 15px sans-serif';
        g.textAlign = 'center';
        g.fillText('НЕ', cw / 2, 47);
        g.fillText('ВЫКЛЮЧАЙТЕ', cw / 2, 64);
      });
      const text = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.33), new THREE.MeshBasicMaterial({ map: caption, transparent: true, color: new THREE.Color(1.3, 1.3, 1.3) }));
      text.position.z = 0.001;
      screen.add(text);
    }
    const tv = screen.parent!;
    const front = worldAt(tv, -0.08, 0, 1.1);
    const pool = floorGlow(w, front.x, front.z, 2.6, '170,190,230', 0.12);
    let next = 0;
    w.updaters.push((t) => {
      if (t < next) return;
      next = t + 0.06;
      draw();
      pool.material.opacity = 0.06 + 0.16 * bright * (0.8 + 0.4 * noise());
    });
    const p = worldAt(screen);
    w.emitters.push({ kind: 'tv', x: p.x, y: p.y, z: p.z, range: 5 });
    return [screen];
  },
  crystal_gone: (w, r) => {
    const set = pick(w.props.living.crystal, r);
    set.visible = false;
    return [set];
  },
  chandelier_swing: (w) => {
    // the chandelier swings slowly on its hook, its light breathing with it, the hook creaking
    const lamp = roomLamps(w, 'living')[0];
    const g = lamp.group;
    const P = 3.4;
    w.updaters.push((t) => {
      const s = Math.sin((2 * Math.PI * t) / P);
      g.rotation.x = 0.1 * s;
      g.rotation.z = 0.035 * Math.sin((2 * Math.PI * t) / P + 1.2);
      // a morok's light doesn't breathe with it
      if (w.morok !== 'sight') lamp.set(1 - 0.05 * Math.abs(s));
    });
    w.emitters.push({ kind: 'creak', x: g.position.x, y: g.position.y, z: g.position.z, range: 6, every: P / 2, at: [P / 4], gain: 0.6 });
    return [g];
  },
  armchair_turned: (w, r) => {
    const chair = pick(w.props.living.armchairs, r);
    chair.rotation.y += Math.PI;
    return [chair];
  },
  portrait_eyes: (w) => {
    // the pupils follow whoever is in the room
    const c = w.props.living.portraitCanvas;
    setMap(c.material, portrait(false));
    const e = PORTRAIT_EYES;
    const px = 0.4 / 256;
    const pupils = [-e.dx, e.dx].map((dx) => {
      const p = new THREE.Mesh(new THREE.CircleGeometry(4 * px, 12), new THREE.MeshBasicMaterial({ color: 0x14110e }));
      p.userData.home = V(dx * px, 0.25 - e.y * 0.5, 0.0015);
      p.position.copy(p.userData.home);
      c.add(p);
      return p;
    });
    const eye = V();
    w.updaters.push((_t, _dt, cam) => {
      c.worldToLocal(cam.getWorldPosition(eye));
      const d = Math.max(eye.z, 0.3);
      const ox = THREE.MathUtils.clamp(eye.x / d, -1, 1) * (e.white - 3) * px;
      const oy = THREE.MathUtils.clamp((eye.y - 0.05) / d, -1, 1) * 2 * px;
      for (const p of pupils) p.position.set(p.userData.home.x + ox, p.userData.home.y + oy, p.userData.home.z);
    });
    return [c];
  },
  clock_stopped: (w) => {
    w.props.living.clock.running = false;
    w.props.living.pendulum.rotation.z = 0;
    w.ambience.find((a) => a.kind === 'clock')!.on = false;
  },

  // --- bedroom and loggia ---

  wardrobe_ajar: (w) => {
    const door = w.props.bedroom.wardrobeDoor;
    door.rotation.y = 0.55;
    const p = FURNITURE.wardrobe;
    const ww = p.z1 - p.z0;
    const wd = p.x1 - p.x0;
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(ww / 2 - 0.03, p.h - 0.14), darkness());
    gap.position.set(ww / 4, p.h / 2, wd / 2 - 0.02 + 0.002);
    door.parent!.add(gap);
    const at = worldAt(door.parent!, ww / 4, 1.2, wd / 2 + 0.3);
    w.emitters.push({ kind: 'creak', x: at.x, y: at.y, z: at.z, range: 4.5, near: 3 });
    return [door, gap];
  },
  eyes_under_bed: (w, r) => {
    // two points shining from under the bed, blinking now and then
    const z = 11.45 + r() * 0.4;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.4) });
    const eyes = new THREE.Group();
    for (const dx of [-0.05, 0.05]) {
      // round, so they shine at whoever looks from the side too
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), mat);
      // side by side across the group's local x, which the turn lays along the bed's edge
      e.position.x = dx;
      e.scale.y = 0.7;
      eyes.add(e);
    }
    // right at the edge: any further in and the side rail hides them from someone standing
    eyes.position.set(21.19, 0.06, z);
    eyes.rotation.y = Math.PI / 2;
    w.group.add(eyes);
    // their faint light on the floor in front of the bed: what catches the eye first
    const pool = floorGlow(w, 21.45, z, 0.9, '255,214,140', 0.4);
    const period = 4 + r() * 3;
    w.updaters.push((t) => {
      const shut = t % period < 0.14;
      eyes.scale.y = shut ? 0.1 : 1;
      pool.visible = !shut;
    });
    return [eyes];
  },
  bed_unmade: (w, r) => {
    // the bedspread lies crumpled on the floor; a dent in one pillow
    const spread = w.props.bedroom.bedspread;
    spread.visible = false;
    const src = spread.material as THREE.MeshStandardMaterial;
    const at = { x: 20.6, z: 12.75 };
    const geo = new THREE.BoxGeometry(1.3, 0.1, 0.45, 16, 1, 6);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const hump = 0.5 + 0.5 * Math.sin(x * 9 + r() * 0.6) * Math.cos(z * 7);
      pos.setY(i, pos.getY(i) > 0 ? 0.03 + 0.09 * hump : 0.004);
    }
    geo.computeVertexNormals();
    const heap = new THREE.Mesh(geo, lit(w, at, { map: src.map, bumpMap: src.bumpMap, roughness: 0.95 }));
    heap.position.set(at.x, 0.006, at.z);
    heap.rotation.y = 0.15;
    w.group.add(heap);
    const dent = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.24),
      lit(w, { x: 20.0, z: 10.7 }, { map: spot('40,34,30'), transparent: true, opacity: 0.5, depthWrite: false, roughness: 1 }),
    );
    dent.rotation.x = -Math.PI / 2;
    dent.position.set(20.02, 0.642, 10.66);
    w.group.add(dent);
    return [spread, heap, dent];
  },
  cot_rocking: (w) => {
    const cot = w.props.bedroom.cot;
    const P = 2.6;
    w.updaters.push((t) => (cot.rotation.x = 0.06 * Math.sin((2 * Math.PI * t) / P)));
    w.emitters.push({ kind: 'creak', x: cot.position.x, y: 0.6, z: cot.position.z, range: 5, every: P / 2, at: [P / 4], gain: 0.7 });
    return [cot];
  },
  jars_extra: (w) => {
    // a fourth jar on the lower shelf, its brine gone cloudy
    const shelf = w.props.bedroom.jars.parent!;
    const at = worldAt(shelf);
    const jar = new THREE.Group();
    jar.position.set(0.18, 0.27, 0.02);
    shelf.add(jar);
    const glass = lit(w, at, { color: 0xc8d4d8, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false });
    const murk = lit(w, at, { color: 0x8c8a6a, roughness: 0.9, transparent: true, opacity: 0.92 });
    const cap = lit(w, at, { color: 0xc8c8c8, roughness: 0.22, metalness: 1 });
    const cyl = (r: number, h: number, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
      m.position.y = y + h / 2;
      jar.add(m);
    };
    cyl(0.068, 0.17, murk, 0.005);
    cyl(0.075, 0.22, glass, 0);
    cyl(0.06, 0.02, cap, 0.22);
    return [jar];
  },

  // --- light ---

  light_off: (w, r) => {
    for (const l of roomLamps(w, pick(LIT_ROOMS, r))) l.set(0);
  },
  lamp_flicker: (w, r) => {
    // one lamp keeps dying and catching again, in a pattern of its own
    const lamp: Lamp = pick(roomLamps(w, pick(LIT_ROOMS, r)), r);
    const steps: [number, number][] = [];
    let total = 0;
    while (total < 12) {
      const on = 0.4 + r() * 2.2;
      steps.push([total, 1]);
      total += on;
      const bursts = 1 + Math.floor(r() * 4);
      for (let k = 0; k < bursts; k++) {
        steps.push([total, 0.04], [total + 0.05 + r() * 0.12, 1]);
        total += 0.25 + r() * 0.2;
      }
      if (r() < 0.35) {
        steps.push([total, 0.02]);
        total += 0.6 + r() * 1.2;
      }
    }
    w.updaters.push((t) => {
      const ph = t % total;
      let level = 1;
      for (const [s, l] of steps) if (s <= ph) level = l;
      if (level !== lamp.level) lamp.set(level);
    });
  },
  light_wrong: (w, r) => {
    // the kitchen tube warm as a bulb, or the chandelier cold and greenish as a tube
    if (r() < 0.5) for (const l of roomLamps(w, 'kitchen')) l.tint(kelvin(2600));
    else {
      const c = kelvin(5200);
      c.g *= 1.08;
      for (const l of roomLamps(w, 'living')) l.tint(c);
    }
  },

  // --- windows ---

  window_watcher: (w, r) => {
    // In a lit window of the block across the yard, somebody stands and looks this way. Only the
    // loggia faces a block near enough (35 m) for a person in a window to be made out.
    const win = windowAcross(20.68, ROOM_BY_ID.loggia.rect.z1, 'pz', Math.floor(r() * 3) - 1)!;
    win.x += pick([-3.6, 0, 3.6], r);
    // lit like the other windows at night (yard.ts, blockTexture): a lamp deep in the room
    const tex = canvasTexture(64, 56, (g, cw, ch) => {
      const grad = g.createRadialGradient(cw / 2, ch * 0.45, 2, cw / 2, ch * 0.45, cw * 0.7);
      grad.addColorStop(0, '#f2c27a');
      grad.addColorStop(1, '#8a5426');
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#1a1612';
      g.beginPath();
      g.ellipse(cw * 0.36, ch * 0.36, 6.5, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(cw * 0.36, ch * 1.05, 15, 30, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(cw / 2 - 1, 0, 2, ch);
      g.fillRect(0, ch * 0.3, cw, 2);
    });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 1.4), glowMaterial(tex));
    pane.position.set(win.x, win.y, win.z);
    pane.rotation.y = YAW[win.facing];
    w.group.add(pane);
    return [pane];
  },
  windows_dark: (w) => {
    darkenYard(w.group.getObjectByName('yard')!);
    darkenWindows(w.group.getObjectByName('exterior')!);
  },
  window_wall: (w, r) => {
    // right outside one window, where the yard should be, a blank concrete wall
    const rooms = ROOMS.filter((room) => room.windows.length);
    const room = pick(rooms, r);
    const win = room.windows[0];
    const p = onSide(room.rect, win.side, win.at, REVEAL + 1.2);
    // wide enough to fill the window from inside, narrow enough to miss the next window and the gallery
    const width = win.width + 3.6;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, 9), outdoorMaterial({ map: panelTexture(), light: 0.1, street: false, scale: [width / 3, 9 / 2.8] }));
    wall.position.set(p.x, 1, p.z);
    wall.rotation.y = YAW[INWARD[win.side]];
    w.group.add(wall);
    return [wall];
  },
  fog_horizon: (w) => {
    // A rusty glow creeping through the night murk above the roofs: a samosbor somewhere else. It is
    // drawn over the sky only, behind every block, so it shows wherever the sky does.
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(470, 48, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: { time: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float time;
          varying vec3 vDir;
          void main() {
            float a = atan(vDir.z, vDir.x);
            float billow = 0.6 + 0.25 * sin(a * 5.0 + time * 0.07) + 0.15 * sin(a * 13.0 - time * 0.11);
            float up = vDir.y;
            float band = smoothstep(0.05, 0.4, up) * (1.0 - smoothstep(0.55 * billow, 0.95 * billow + 0.1, up));
            gl_FragColor = vec4(0.17, 0.065, 0.025, band * billow * 0.75);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    glow.position.set(14, 0, 9);
    w.group.add(glow);
    const mat = glow.material;
    w.updaters.push((t) => (mat.uniforms.time.value = t));
  },

  // --- players and sounds ---

  double: (w, r, _c, people) => {
    // A copy of a teammate (of yourself, when alone) sits at the kitchen table and turns its head to follow you.
    const stools = (['stoolA', 'stoolB', 'stoolC'] as const).map((id) => FURNITURE[id]);
    const s = pick(stools, r);
    const x = (s.x0 + s.x1) / 2;
    const z = (s.z0 + s.z1) / 2;
    const t = FURNITURE.table;
    const body = yawTo(x, z, (t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
    // snap to the side of the table it sits at
    const yaw = Math.round(body / (Math.PI / 2)) * (Math.PI / 2);
    const c = figure(w, someone(people, r), x, z);
    c.sit(s.h);
    c.root.rotation.y = yaw;
    const eye = V();
    w.updaters.push((time, dt, cam) => {
      cam.getWorldPosition(eye);
      const want = THREE.MathUtils.clamp(wrap(yawTo(x, z, eye.x, eye.z) - yaw), -1.3, 1.3);
      c.headYaw += (want - c.headYaw) * Math.min(1, dt * 3);
      c.animate(dt, time, 0, -0.15, 0);
    });
    return [c.root];
  },
  gaze: (w, r, _c, people) => {
    // On this screen alone, one teammate's head keeps turning to us, whatever they look at.
    if (people.others.length) w.avatars.gaze.add(pick(people.others, r).id);
  },
  faceless: (w, r, _c, people) => {
    // One resident has no face, or wears gear other than the one picked in the lobby. Picked from
    // the whole roster in the same order on every screen, so everyone sees the same one, and they
    // alone don't; a morok, seen by one, is always somebody else.
    const all = w.morok ? people.others : [people.self, ...people.others].sort((a, b) => a.id - b.id);
    if (!all.length) return;
    const p = pick(all, r);
    // the welding mask hides the face anyway
    const blank = p.mask !== 'welder' && r() < 0.6;
    w.avatars.look.set(p.id, blank ? { ...p, blank } : { ...p, mask: pick(MASKS.filter((m) => m.id !== p.mask), r).id });
  },
  extra: (w, r) => {
    // One more resident walks with the group, from flat 49: the one they walk through, nobody's.
    w.avatars.extra = { name: pick(STRANGER_NAMES, r), color: '#7d776b', mask: pick(MASKS, r).id, outfit: pick(OUTFITS, r).id, flat: 49 };
  },
  dont_look: (w, r) => {
    // Something moves while nobody looks at it: a dark figure at the far end of the corridor stands
    // a step closer each time, or an armchair turns a little further. A step comes after two
    // seconds out of everyone's sight (gaze.ts); each screen goes by its own view of the group.
    let subject: THREE.Object3D;
    let step: (n: number) => void;
    let max: number;
    let y: number;
    if (r() < 0.5) {
      const shape = silhouette();
      const z = 0.9 + r() * 1.2;
      shape.position.set(28, 0, z);
      w.group.add(shape);
      // from the window up the corridor, every other step under a lamp (where it shows best),
      // stopping well short of the landing
      step = (n) => (shape.position.x = 28 - 2.5 * n);
      [subject, max, y] = [shape, 7, 1.3];
    } else {
      const chair = pick(w.props.living.armchairs, r);
      const y0 = chair.rotation.y;
      const dir = r() < 0.5 ? -1 : 1;
      step = (n) => (chair.rotation.y = y0 + dir * 0.3 * n);
      // above the seat: a point inside the chair would be hidden by the chair itself
      [subject, max, y] = [chair, 5, 1.05];
    }
    const p = V();
    let n = 0;
    let away = 0;
    let check = 0;
    let seen = true;
    w.updaters.push((_t, dt, cam) => {
      if ((check -= dt) <= 0) {
        check = 0.2;
        subject.getWorldPosition(p);
        seen = anyoneSees(w, cam, p.x, y, p.z);
      }
      away = seen ? 0 : away + dt;
      if (away >= 2 && n < max) {
        step(++n);
        away = 0;
      }
    });
    return [subject];
  },
  together: (w, r) => {
    // Seen only while two people look at it at once: «ВЫ НЕ ОДНИ» in chalk on the green paint under
    // the floor stencil, where a group coming out of the tambour looks together, or a figure at the
    // window at the end of the corridor. It fades in when we and a teammate both see it, and out
    // when not.
    let thing: THREE.Object3D;
    let mats: THREE.Material[];
    let at: THREE.Vector3;
    if (r() < 0.5) {
      const words = canvasTexture(512, 128, (g, cw, ch) => {
        g.fillStyle = 'rgba(222,218,204,0.85)';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 84px sans-serif';
        // fitted to the sheet whatever the system's sans is
        g.font = `bold ${Math.floor(84 * Math.min(1, (cw - 40) / g.measureText('ВЫ НЕ ОДНИ').width))}px sans-serif`;
        g.fillText('ВЫ НЕ ОДНИ', cw / 2, ch / 2);
      });
      const landing = ROOM_BY_ID.landing.rect;
      const mat = lit(w, { x: 1.5, z: 2.5 }, { map: words, transparent: true, opacity: 0, depthWrite: false, roughness: 0.6 });
      thing = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), mat);
      thing.position.set((landing.x0 + landing.x1) / 2, 1.05, landing.z1 - 0.03);
      thing.rotation.y = Math.PI;
      [mats, at] = [[mat], V(thing.position.x, 1.05, landing.z1 - 0.1)];
    } else {
      thing = silhouette();
      thing.position.set(28.35, 0, 1.5 + (r() - 0.5) * 0.6);
      mats = [];
      thing.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0;
          mats.push(o.material);
        }
      });
      at = V(thing.position.x, 1.3, thing.position.z);
    }
    w.group.add(thing);
    let check = 0;
    let both = false;
    let shown = 0;
    w.updaters.push((_t, dt, cam) => {
      if ((check -= dt) <= 0) {
        check = 0.2;
        both = sees(w, eyeOf(cam), at.x, at.y, at.z) && w.teammates.some((e) => sees(w, e, at.x, at.y, at.z));
      }
      shown = THREE.MathUtils.clamp(shown + (both ? dt / 0.6 : -dt), 0, 1);
      for (const m of mats) m.opacity = shown;
    });
  },
  follower: (w) => {
    w.follower = true;
  },
  radiator_knock: (w, r) => {
    // somebody knocking on the heating pipes, in a rhythm: knock-knock-knock, knock-knock
    const spots = [
      { x: ROOM_BY_ID.living.rect.x1 - 0.1, z: 13.11 },
      { x: ROOM_BY_ID.kitchen.rect.x1 - 0.1, z: 7.74 },
      { x: ROOM_BY_ID.bedroom.rect.x0 + 0.1, z: 12.2 },
    ];
    const p = pick(spots, r);
    w.emitters.push({ kind: 'pipes', x: p.x, y: 0.4, z: p.z, range: 5.5, every: 7, at: [0, 0.32, 0.64, 1.5, 1.82], gain: 0.5 });
  },
  drill: (w, r) => {
    // a drill behind a neighbour's door, half way down the corridor (the ones near the stairs could be heard from the vestibule)
    const doors = Object.entries(w.props.common.neighbourDoors).filter(([n]) => Number(n) >= 43);
    const leaf = pick(doors, r)[1];
    const p = worldAt(leaf.parent!, 0, 1.2, -1.2);
    w.emitters.push({ kind: 'drill', x: p.x, y: p.y, z: p.z, range: 9, every: 9, at: [1.5], gain: 2.2 });
  },
  crying: (w, r) => {
    // a child crying in the flat next door: behind the bedroom wall, or behind a door on the corridor
    let p = V(19.6, 1.0, ROOM_BY_ID.bedroom.rect.z0 - 0.7);
    if (r() < 0.5) {
      const doors = Object.entries(w.props.common.neighbourDoors).filter(([n]) => Number(n) >= 43);
      p = worldAt(pick(doors, r)[1].parent!, 0, 1.0, -1.0);
    }
    w.emitters.push({ kind: 'cry', x: p.x, y: p.y, z: p.z, range: 7, every: 6.5, at: [0.5], gain: 6 });
  },
  silence: (w) => {
    w.silent = true;
  },

  // --- the voice mimic ---

  voice_mimic: (w, r, _c, people) => {
    // A teammate's own words, as this machine heard them, said again from where nobody is: behind
    // a neighbour's door (43-48: 41 and 42 would reach the vestibule), in the shut pantry, in the
    // bathroom or the toilet. Without a recording, a murmur of someone's name.
    const said = people.phrase?.(r) ?? null;
    const doors = Object.entries(w.props.common.neighbourDoors).filter(([n]) => Number(n) >= 43);
    const room = (id: RoomId) => {
      const rect = ROOM_BY_ID[id].rect;
      return V((rect.x0 + rect.x1) / 2, 1.5, (rect.z0 + rect.z1) / 2);
    };
    const spots = [() => worldAt(pick(doors, r)[1].parent!, 0, 1.5, -1.0), () => room('pantry'), () => room('bath'), () => room('wc')];
    const p = pick(spots, r)();
    w.emitters.push({ kind: 'call', x: p.x, y: p.y, z: p.z, range: 8, every: 12, at: [3], name: someone(people, r).name, phrase: said?.buffer });
  },

  // --- alone: only to a player with nobody near ---

  alone_breath: (w) => {
    // somebody breathes out right behind your head
    whenAlone(w, (eye, cam) => {
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const p = eye.clone().addScaledVector(back, 0.45);
      return cue(w, { kind: 'breath', x: p.x, y: eye.y + 0.05, z: p.z, range: 2.5 });
    });
  },
  alone_door: (w) => {
    // the door of the room you have just left swings shut behind you; it gives when someone comes up to it
    const doors = w.doors.filter(({ d }) => d.kind !== 'hermo');
    let here: RoomId | null = null;
    let last: RoomId | null = null;
    let shut: (typeof doors)[number] | null = null;
    let swing = 0;
    let open = false;
    const me = V();
    whenAlone(
      w,
      (eye, cam) => {
        if (!here || !last) return false;
        const door = doors.find(({ d }) => (d.a === here && d.b === last) || (d.a === last && d.b === here));
        if (!door) return false;
        const r = doorRect(door.d);
        const cx = (r.x0 + r.x1) / 2;
        const cz = (r.z0 + r.z1) / 2;
        // behind us, a few steps off, out of sight
        if (Math.hypot(cx - eye.x, cz - eye.z) < 1.6 || sees(w, eyeOf(cam), cx, 1.2, cz)) return false;
        if (!cue(w, { kind: 'shut', x: cx, y: 1.2, z: cz, range: 9 })) return false;
        shut = door;
        return true;
      },
      (eye) => {
        const room = roomAt(eye.x, eye.z)?.id ?? null;
        if (room && room !== here) [last, here] = [here, room];
      },
    );
    w.updaters.push((_t, dt, cam) => {
      if (!shut) return;
      const r = doorRect(shut.d);
      const [cx, cz] = [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
      const near = [cam.getWorldPosition(me), ...w.teammates].some((p) => Math.hypot(p.x - cx, p.z - cz) < 0.9);
      if (near && !open && swing > 0.9) {
        open = true;
        cue(w, { kind: 'creak', x: cx, y: 1.2, z: cz, range: 6 });
      }
      swing = THREE.MathUtils.clamp(swing + (open ? -dt / 0.5 : dt / 1.1), 0, 1);
      swingLeaf(shut.d, shut.leaf, THREE.MathUtils.smoothstep(swing, 0, 1) * 0.97);
    });
    return doors.map(({ leaf }) => leaf);
  },
  alone_call: (w, r, _c, people) => {
    // your name, from the next room: a teammate's voice the cell took, or a murmur saying it
    const said = people.phrase?.(r) ?? null;
    whenAlone(w, (eye) => {
      const mine = roomAt(eye.x, eye.z)?.id;
      if (!mine) return false;
      const next = ROOMS.filter((room) => room.id !== 'pantry' && room.id !== mine && adjacent(room.id, mine));
      const empty = next.filter((room) => !w.teammates.some((t) => roomAt(t.x, t.z)?.id === room.id));
      const room = pick(empty.length ? empty : next, r);
      if (!room) return false;
      const x = (room.rect.x0 + room.rect.x1) / 2;
      const z = (room.rect.z0 + room.rect.z1) / 2;
      return cue(w, { kind: 'call', x, y: 1.6, z, range: 9, gain: 1.4, name: people.self.name, phrase: said?.buffer });
    });
  },
  alone_steps: (w) => {
    // a few steps behind you, keeping step with yours, and they stop when you do
    let steps = 0;
    let walked = 0;
    const was = V();
    whenAlone(w, (eye, cam) => {
      if (was.lengthSq() === 0) was.copy(eye);
      walked += Math.hypot(eye.x - was.x, eye.z - was.z);
      was.copy(eye);
      if (walked < STEP_LEN) return false;
      walked -= STEP_LEN;
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const p = eye.clone().addScaledVector(back, 3);
      if (inCell(p.x, p.z) && cue(w, { kind: 'step', x: p.x, y: 0.05, z: p.z, range: 8 })) steps++;
      return steps >= 9;
    });
  },
};


// Every catalogued anomaly must have an implementation; fail loudly during development.
for (const a of ANOMALIES) if (!APPLY[a.id]) console.error(`anomaly "${a.id}" has no implementation`);

/**
 * Changes a freshly built cell. A morok (an anomaly that isn't there, shown to this player alone)
 * is the same anomaly with its tell: one seen shimmers and makes no sound and no light, one heard
 * plays dry.
 */
export function applyAnomaly(w: World, id: string, seed: number, cycle: number, people: People, morok = false): THREE.Object3D[] {
  if (!APPLY[id]) return [];
  w.anomaly = id;
  const kind = morok ? ANOMALIES.find((a) => a.id === id)?.morok : undefined;
  if (morok && !kind) {
    if (import.meta.env.DEV) console.error(`anomaly "${id}" can't be a morok`);
    return [];
  }
  w.morok = kind ?? null;
  const emitters = w.emitters.length;
  const changed = APPLY[id](w, rng(seed), cycle, people) ?? [];
  if (kind === 'sight') {
    w.emitters.length = emitters;
    // a teammate's stand-in shimmers once the avatars put it on (avatars.ts)
    if (import.meta.env.DEV && !changed.length && !w.avatars.look.size) console.error(`anomaly "${id}" doesn't say what to shimmer`);
    shimmer(w, changed);
  } else if (kind === 'sound') {
    for (const e of w.emitters) e.dry = true;
    for (const a of w.ambience) if (a.reversed || a.announce) a.dry = true;
  }
  return changed;
}
