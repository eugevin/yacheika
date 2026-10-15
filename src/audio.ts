import * as THREE from 'three';
import { rng } from './textures.ts';
import { roomAt, type RoomId } from '../shared/map.ts';
import { SAMOSBOR, SAMOSBOR_MS, type SamosborTimes } from '../shared/rules.ts';
import { acousticsAt, creaks, footingAt, listenerRoom, reachesZone, separation, type Acoustics, type Ambient, type Footing } from './world/ambience.ts';
import type { Emitter, Lamp, World } from './world/index.ts';

/**
 * Synthesised sound, no samples (docs/DESIGN.md, 5). The cell always sounds the same: the riser's
 * rumble, every lamp on its own (a dead lamp is silent), the fridge, the radio, the dripping tap,
 * the clock, the meter, the lift behind the wall, and footsteps that depend on the floor. Rhythms
 * are fixed, so nothing in a normal cell is random; anything else is an anomaly (World.emitters,
 * World.follower).
 * Kept low and soft: nothing above a few kHz, every sound has a few-millisecond attack.
 */

/** Lamp buzz fades out within this many metres, so lamps of the cell can't be heard from the middle of a vestibule. */
const BUZZ_RANGE = 5;
const STEP_GAIN = 0.07;
const RUN_GAIN = 0.1;
/** Loudness of the samosbor siren, set by measurement (AGENTS.md): loud, but not above an anomaly's peaks by much. */
const SIREN_GAIN = 0.1;
/** The siren's wail, Hz: the bottom of each swing and the top, where it settles once wound up. */
const SIREN_LOW = 250;
const SIREN_HIGH = 440;
/** One swing of the wail, down and back up, seconds. */
const SIREN_WAIL = 3.2;
/** The lingering siren (linger.ts): another block's, far off, well under the samosbor's own. */
const FAR_SIREN_GAIN = 0.03;
/** The announcer over the building's loudspeakers (the samosbor warning, the all clear). */
const SPEAKER_GAIN = 0.25;
/** How loud each kind of lamp hums, and how much it crackles. Only the kitchen tube really buzzes. */
const LAMP_SOUND: Record<Lamp['style'], { buzz: number; crackle: number }> = {
  tube: { buzz: 1, crackle: 0 },
  grate: { buzz: 0.35, crackle: 1 },
  plafond: { buzz: 0.3, crackle: 0 },
  chandelier: { buzz: 0.25, crackle: 0 },
  bulb: { buzz: 0.25, crackle: 0 },
  sconce: { buzz: 0.2, crackle: 0 },
};
/** Crackle loops, shared by the caged lamps; number 0 belongs to both vestibule lamps, so the loop jump can't be heard. */
const CRACKLES = 3;
/** Rhythmic sounds are scheduled this far ahead of the frame, so they keep time. */
const LOOKAHEAD = 0.2;
/** How much of each source goes to the room's reverb. */
const SEND: Record<Ambient['kind'], number> = { fridge: 0.3, radio: 0.4, drip: 1.5, clock: 0.6, meter: 0.4, lift: 0.3 };
/** Reverb of each kind of room: level, delay taps in seconds, feedback, damping. */
const REVERB: Record<Acoustics, { level: number; taps: number[]; fb: number; damp: number }> = {
  dry: { level: 0.035, taps: [0.011, 0.015, 0.019, 0.023], fb: 0.25, damp: 1500 },
  flat: { level: 0.06, taps: [0.013, 0.019, 0.023, 0.029, 0.031], fb: 0.42, damp: 2000 },
  tile: { level: 0.11, taps: [0.007, 0.011, 0.013, 0.017, 0.019], fb: 0.72, damp: 2400 },
  stair: { level: 0.09, taps: [0.019, 0.027, 0.033, 0.041, 0.047], fb: 0.58, damp: 1800 },
  corridor: { level: 0.1, taps: [0.023, 0.037, 0.047, 0.059, 0.071], fb: 0.66, damp: 1500 },
};

/** What a wall does to a sound, by `separation`: level and lowpass. */
const MUFFLE = [
  { gain: 1, freq: 8000 },
  { gain: 0.6, freq: 1800 },
  { gain: 0.3, freq: 600 },
];

type V3 = { x: number; y: number; z: number };

/** The part of a voice that walls act on: a lowpass and a gain in front of its panner. */
interface Wall {
  room: RoomId | null;
  /** A morok's: a wall takes its loudness as usual, but not its top, as if it came from inside the head. */
  dry: boolean;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** A sound repeating with a fixed period: `at` are offsets within it, `origin` where the first period starts (frame time). */
interface Pattern {
  origin: number;
  period: number;
  at: number[];
  play: (when: number, n: number) => void;
  /** Frame time up to which events are already scheduled. */
  until: number;
}

/** A placed source: a switch, the walls, a panner with a hard range, and whatever plays into it. */
interface SourceVoice {
  on: GainNode;
  wall: Wall;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  patterns: Pattern[];
}

interface AmbientVoice extends SourceVoice {
  a: Ambient;
}

interface EmitterVoice extends SourceVoice {
  e: Emitter;
  /** A `near` emitter has had its one go. */
  done: boolean;
  /** Plays one event of an event kind. */
  play: ((when: number, n: number) => void) | null;
}

export class Sound {
  readonly ctx = new AudioContext();
  /** Everything that isn't voice chat goes through here, so N can mute it. */
  private readonly master = this.ctx.createGain();
  /** The cell's background (lamps, appliances, pipes): the "silence" anomaly turns this down. */
  private readonly cell = this.ctx.createGain();
  /** Input of the room reverb (delay lines: ConvolverNode never renders in headless Chromium). */
  private readonly room: GainNode;
  /** Output of each kind of reverb; only the listener's room is open. */
  private readonly reverbs = new Map<Acoustics, GainNode>();
  private acoustics: Acoustics = 'stair';
  /** Room the listener is in, null outside the rooms (a vestibule). */
  private here: RoomId | null = null;
  private readonly noise: AudioBuffer;
  /** Shared ballast buzz, fanned out to one panner per lamp. */
  private readonly buzz: AudioNode;
  private readonly crackles: AudioNode[] = [];
  private tune: AudioBuffer | null = null;
  private sirenWave: PeriodicWave | null = null;
  /** Our own breathing in the GP-5 while a samosbor lasts, made the first time it is needed. */
  private breath: GainNode | null = null;
  /** The lingering siren's output, made the first time it is needed and left running. */
  private farSiren: GainNode | null = null;
  private tuneBack: AudioBuffer | null = null;
  private lampVoices: { lamp: Lamp; gain: GainNode; wall: Wall; nodes: AudioNode[] }[] = [];
  private ambient: AmbientVoice[] = [];
  private emitters: EmitterVoice[] = [];
  private world: World | null = null;
  private listener = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1) };
  /** Frame time of the last update, in seconds. */
  private now = 0;
  muted = false;
  /** The volume slider in the duty log, 0..1; N mutes on top of it. */
  private volume = 1;

  constructor() {
    const ctx = this.ctx;
    // a gentle safety net over everything: nothing bright gets through
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 3600;
    soft.Q.value = 0.5;
    this.master.connect(soft).connect(ctx.destination);
    this.cell.connect(this.master);
    this.room = this.makeReverbs();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // 50 Hz mains: the ballast buzz sits on its even harmonics
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const [f, g] of [[100, 0.02], [200, 0.009], [300, 0.005], [400, 0.0025]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f + Math.random() * 0.4;
      const gain = ctx.createGain();
      gain.gain.value = g;
      osc.connect(gain).connect(lp);
      osc.start();
    }
    this.buzz = lp;

    // caged bulbs tick and crackle faintly; a few fixed loops so neighbours don't crackle in step
    for (let i = 0; i < CRACKLES; i++) {
      const src = ctx.createBufferSource();
      src.buffer = crackle(ctx, 9001 + i);
      src.loop = true;
      const out = ctx.createGain();
      out.gain.value = 0.03;
      src.connect(this.filter('lowpass', 2000, 0.7)).connect(this.filter('lowpass', 2000, 0.7)).connect(out);
      src.start();
      this.crackles.push(out);
    }

    // the riser: a low rumble of water and the building, the same everywhere, vestibules included
    this.loopNoise(110, 0.7, 0.022, 'lowpass').connect(this.cell);
    this.loopNoise(380, 3, 0.002, 'bandpass').connect(this.cell);
  }

  /** Needs a user gesture; call from the click that joins the room. */
  unlock() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }

  setVolume(v: number) {
    this.volume = v;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  /** A new cell was built: one voice per lamp and per ambient source, and the anomaly emitters. */
  attach(world: World) {
    for (const v of this.lampVoices) for (const n of v.nodes) n.disconnect();
    for (const v of [...this.ambient, ...this.emitters]) {
      for (const s of v.sources) s.stop();
      for (const n of v.nodes) n.disconnect();
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.lampVoices = world.lamps.map((lamp, i) => {
      const s = LAMP_SOUND[lamp.style];
      // starts at the lamp's level: vestibule lamps carry on across the loop without a dip
      const gain = this.gain(lamp.lit);
      const panner = this.panner('linear', 0.8, BUZZ_RANGE, 'equalpower');
      place(panner, lamp.pos);
      const wall = this.wall(lamp.room);
      gain.connect(wall.filter);
      wall.gain.connect(panner).connect(this.cell);
      const nodes: AudioNode[] = [gain, wall.filter, wall.gain, panner];
      if (s.buzz) nodes.push(this.into(this.buzz, s.buzz, gain));
      if (s.crackle) nodes.push(this.into(this.crackles[lamp.room ? 1 + (i % (CRACKLES - 1)) : 0], s.crackle, gain));
      if (import.meta.env.DEV && lamp.room && reachesZone(lamp.pos.x, lamp.pos.z, BUZZ_RANGE)) console.error(`lamp in ${lamp.room} can be heard from an exit zone`);
      return { lamp, gain, wall, nodes };
    });
    this.ambient = world.ambience.map((a) => this.ambientVoice(a));
    this.emitters = world.emitters.map((e) => this.emitterVoice(e));
    this.world = world;
  }

  /** Every frame (`now` is frame time in seconds): the listener follows the camera, sources follow the world, rhythms are scheduled. */
  update(camera: THREE.Camera, now: number) {
    this.now = now;
    const t = this.ctx.currentTime;
    camera.getWorldPosition(this.listener.pos);
    camera.getWorldDirection(this.listener.fwd);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    setListener(this.ctx.listener, this.listener.pos, this.listener.fwd, up);

    const { x, z } = this.listener.pos;
    const acoustics = acousticsAt(x, z);
    if (acoustics && acoustics !== this.acoustics) {
      this.acoustics = acoustics;
      for (const [kind, out] of this.reverbs) out.gain.setTargetAtTime(kind === acoustics ? REVERB[kind].level : 0, t, 0.25);
    }
    const room = listenerRoom(x, z);
    const moved = room !== undefined && room !== this.here;
    if (room !== undefined) this.here = room;

    const w = this.world;
    if (!w) return;
    this.cell.gain.setTargetAtTime(w.silent ? 0 : 1, t, 0.05);
    for (const v of this.lampVoices) {
      v.gain.gain.setTargetAtTime(v.lamp.lit, t, 0.015);
      if (moved) this.muffle(v.wall, t);
    }
    const running = this.ctx.state === 'running';
    for (const v of this.ambient) {
      // the reverb send bypasses the cell bus, so silence switches the source off as well
      v.on.gain.setTargetAtTime(v.a.on && !w.silent ? 1 : 0, t, 0.05);
      if (moved) this.muffle(v.wall, t);
      for (const p of v.patterns) this.schedule(p, now, running);
    }

    // sounds an anomaly makes as the cycle goes on: new emitters get their voices now
    while (this.emitters.length < w.emitters.length) this.emitters.push(this.emitterVoice(w.emitters[this.emitters.length]));
    for (const v of this.emitters) {
      if (moved) this.muffle(v.wall, t);
      if (v.e.once && !v.done && running) {
        v.done = true;
        // a moment ahead: the voice was only just wired, and what starts at once is lost
        v.play?.(t + 0.06, 0);
      }
      for (const p of v.patterns) this.schedule(p, now, running);
      const e = v.e;
      if (e.near !== undefined && !v.done && running && Math.hypot(x - e.x, z - e.z) < e.near) {
        v.done = true;
        v.play?.(t, 0);
      }
    }
  }

  /** A footstep: ours when `at` is null, otherwise someone else's at that spot. Sounds like the floor under it. */
  step(at: V3 | null, run: boolean) {
    const t = this.ctx.currentTime;
    const gain = run ? RUN_GAIN : STEP_GAIN;
    const p = at ?? this.listener.pos;
    const floor = footingAt(p.x, p.z);
    const creak = floor === 'parquet' && creaks(p.x, p.z);
    if (at) {
      this.footfall(t, gain, this.at(at), floor, creak);
      return;
    }
    this.footfall(t, gain * 0.7, this.master, floor, creak);
    // the follower anomaly: the same step again, a beat later, a few metres behind us; dry when a morok
    if (this.world?.follower) {
      const back = new THREE.Vector3(this.listener.fwd.x, 0, this.listener.fwd.z).normalize();
      const behind = this.listener.pos.clone().addScaledVector(back, -3.2).setY(0.1);
      this.footfall(t + 0.34, gain * 0.9, this.at(behind), floor, false, this.world.morok === 'sound' ? null : this.room);
    }
  }

  /** Short soft blip: someone placed a mark. */
  blip() {
    this.tone(520, 0.25, 0.05);
  }

  /**
   * The samosbor (docs/DESIGN.md, 7.1), all scheduled at once from now (samosbor.ts, SAMOSBOR): a
   * motor siren on the roof of the next block winds up, wails up and down and runs down at the end;
   * the warning over the loudspeakers; wet squelching all round once the fog is thick;
   * silence by the end. The cell's own background is switched off by the world (samosbor.ts). The
   * big one (SAMOSBOR_BIG) lasts longer and says the warning twice.
   */
  samosbor(times: SamosborTimes = SAMOSBOR, ms = SAMOSBOR_MS) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const end = t + ms / 1000;
    // the rotor's speed: spin up, a slow wail, run down
    const speed = ctx.createConstantSource();
    const f = speed.offset;
    f.setValueAtTime(SIREN_LOW * 0.3, t);
    f.exponentialRampToValueAtTime(SIREN_HIGH, t + 3.5);
    let at = t + 3.5;
    while (at + SIREN_WAIL < end - 2.8) {
      f.exponentialRampToValueAtTime(SIREN_LOW, at + SIREN_WAIL * 0.53);
      f.exponentialRampToValueAtTime(SIREN_HIGH, at + SIREN_WAIL);
      at += SIREN_WAIL;
    }
    f.setValueAtTime(SIREN_HIGH, Math.max(at, end - 2.8));
    f.exponentialRampToValueAtTime(SIREN_LOW * 0.25, end - 0.2);
    speed.start(t);
    speed.stop(end);
    // the air through the rotor's ports: a fat, hollow tone, odd harmonics strong. Band-limited by
    // construction: eight harmonics of at most SIREN_HIGH stay under 4 kHz, so nothing shrill
    this.sirenWave ??= ctx.createPeriodicWave(new Float32Array(9), Float32Array.from([0, 1, 0.42, 0.6, 0.22, 0.32, 0.1, 0.16, 0.06]));
    const tone = this.filter('lowpass', 2400, 0.5);
    // several ports a little out of step, and the housing's lower drone an octave down
    for (const [cents, ratio, level] of [[-9, 1, 0.55], [0, 1, 1], [7, 1, 0.6], [0, 0.5, 0.35]] as const) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.sirenWave);
      o.frequency.value = 0;
      o.detune.value = cents;
      speed.connect(this.gain(ratio)).connect(o.frequency);
      o.connect(this.gain(level * 0.4)).connect(tone);
      o.start(t);
      o.stop(end);
    }
    // gusts of wind across the yard swell and thin it by an eighth
    const swell = this.gain(1);
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.37;
    gust.connect(this.gain(0.12)).connect(swell.gain);
    gust.start(t);
    gust.stop(end);
    const siren = this.gain(0);
    tone.connect(swell).connect(siren);
    siren.gain.setValueAtTime(0, t);
    siren.gain.linearRampToValueAtTime(SIREN_GAIN, t + 3);
    siren.gain.setValueAtTime(SIREN_GAIN, end - 2.8);
    siren.gain.linearRampToValueAtTime(0, end - 0.3);
    // from everywhere: both sides a little apart, the next blocks throwing it back, and the room
    for (const [pan, delay] of [[-0.45, 0], [0.45, 0.013]]) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      siren.connect(d).connect(p).connect(this.master);
    }
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.42;
    const back = this.gain(0.35);
    siren.connect(echo).connect(this.filter('lowpass', 1100, 0.6)).connect(back).connect(echo);
    back.connect(this.gain(0.6)).connect(this.master);
    siren.connect(this.gain(0.25)).connect(this.room);

    // the loudspeakers in every flat: a narrow band, under the siren
    const speaker = this.gain(SPEAKER_GAIN);
    speaker.connect(this.filter('highpass', 300, 0.7)).connect(this.filter('lowpass', 1600, 0.7)).connect(this.master);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const words = ['внимание', 'самосбор', 'всем', 'жильцам', 'немедленно', 'укрыться', 'в', 'гермоблоках'];
    const warning = 'Внимание! Самосбор! Всем жильцам немедленно укрыться в гермоблоках!';
    this.announce(t + times.warn, words, speaker, warning, 0.15, 0.95, 0.6);
    if (times.again !== null) this.announce(t + times.again, words, speaker, warning, 0.15, 0.95, 0.6);

    // something wet, close by and all round, once the fog is thick
    const r = rng(4242);
    for (let i = 0; i < 16; i++) {
      const at = t + times.flicker + r() * (times.covered - times.flicker);
      const p = ctx.createStereoPanner();
      p.pan.value = r() * 1.6 - 0.8;
      p.connect(this.master);
      this.squelch(at, 0.5 + r() * 0.5, 90 + r() * 70, p);
    }
  }

  /**
   * The breaker in the stairwell when the power goes off or comes back (a blackout): a heavy clunk,
   * and the lamps' hum dies or rises with them by itself. The same everywhere, the vestibules too.
   */
  breaker(on: boolean) {
    const t = this.ctx.currentTime + 0.02;
    const out = this.gain(1);
    out.connect(this.filter('lowpass', 1400, 0.7)).connect(this.master);
    this.thump(t, on ? 70 : 58, 0.18, 0.09, out);
    this.burst(t, 0.06, 0.05, 700, 1.2, 'bandpass', out, 0.002, null);
    // the relay's second, smaller clack
    this.thump(t + 0.07, 140, 0.04, 0.025, out);
  }

  /** «Плановое отключение электроэнергии» over the building's loudspeakers, everywhere, like the samosbor's warning. */
  powerCut() {
    const t = this.ctx.currentTime + 0.2;
    for (const [i, f] of [523.25, 392].entries()) this.chime(t + i * 0.5, f, 0.03);
    const speaker = this.gain(SPEAKER_GAIN);
    speaker.connect(this.filter('highpass', 300, 0.7)).connect(this.filter('lowpass', 1600, 0.7)).connect(this.master);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const words = ['плановое', 'отключение', 'электроэнергии'];
    this.announce(t + 1.3, words, speaker, 'Плановое отключение электроэнергии.', 0.16, 0.9, 0.5);
  }

  /** One squeeze of the dynamo flashlight's handle: the gears whirr up and click. Ours, like footsteps. */
  whirr() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.3);
    const g = envelope(ctx, t, 0.02, 0.22, 0.012, 0.08);
    o.connect(this.filter('bandpass', 700, 1.2)).connect(this.filter('lowpass', 1600, 0.7)).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
    this.burst(t, 0.015, 0.012, 1400, 3, 'bandpass', this.master, 0.002, null);
  }

  /**
   * Our own breathing through the GP-5's valve while a samosbor lasts: slow, heavy, close, under
   * whatever we say. Plays for us only, in the middle of the head.
   */
  maskBreath(on: boolean) {
    if (!this.breath && !on) return;
    if (!this.breath) {
      const src = this.ctx.createBufferSource();
      src.buffer = breathing(this.ctx);
      src.loop = true;
      this.breath = this.gain(0);
      this.soft(src.connect(this.filter('bandpass', 520, 0.9))).connect(this.breath).connect(this.master);
      src.start();
    }
    this.breath.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.4);
  }

  /**
   * The siren of a block across the yard when the group lingers (linger.ts), `level` 0..1 every
   * frame. The same everywhere, the vestibules included: not a source of the cell.
   */
  distantSiren(level: number) {
    if (!this.farSiren && level <= 0) return;
    this.farSiren ??= this.makeFarSiren();
    this.farSiren.gain.setTargetAtTime(level * FAR_SIREN_GAIN, this.ctx.currentTime, 0.08);
  }

  /** A slow steady wail, its top taken off by the distance, thrown back by the blocks around. */
  private makeFarSiren() {
    const ctx = this.ctx;
    const speed = ctx.createConstantSource();
    speed.offset.value = (SIREN_LOW + SIREN_HIGH) / 2;
    const wail = ctx.createOscillator();
    wail.frequency.value = 1 / (SIREN_WAIL * 1.4);
    wail.connect(this.gain((SIREN_HIGH - SIREN_LOW) / 2)).connect(speed.offset);
    this.sirenWave ??= ctx.createPeriodicWave(new Float32Array(9), Float32Array.from([0, 1, 0.42, 0.6, 0.22, 0.32, 0.1, 0.16, 0.06]));
    const tone = this.filter('lowpass', 700, 0.5);
    for (const [cents, level] of [[-11, 0.6], [0, 1], [8, 0.6]] as const) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.sirenWave);
      o.frequency.value = 0;
      o.detune.value = cents;
      speed.connect(o.frequency);
      o.connect(this.gain(level * 0.4)).connect(tone);
      o.start();
    }
    speed.start();
    wail.start();
    const out = this.gain(0);
    tone.connect(this.filter('lowpass', 900, 0.6)).connect(out);
    for (const [pan, delay] of [[-0.6, 0], [0.6, 0.021]]) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(d).connect(p).connect(this.master);
    }
    const echo = ctx.createDelay(1.5);
    echo.delayTime.value = 0.71;
    const back = this.gain(0.4);
    out.connect(echo).connect(this.filter('lowpass', 600, 0.6)).connect(back).connect(echo);
    back.connect(this.gain(0.8)).connect(this.master);
    return out;
  }

  /** The all clear on the radio after the last floor: the call sign, then the announcer. */
  allClear() {
    const t = this.ctx.currentTime + 0.3;
    for (const [i, f] of [392, 523.25, 659.25, 523.25].entries()) this.chime(t + i * 0.45, f, 0.035);
    const speaker = this.gain(SPEAKER_GAIN);
    speaker.connect(this.filter('highpass', 300, 0.7)).connect(this.filter('lowpass', 1600, 0.7)).connect(this.master);
    this.announce(t + 2.2, ['самосбор', 'миновал', 'жильцам', 'вернуться', 'в', 'квартиры'], speaker, 'Самосбор миновал. Жильцам вернуться в квартиры.', 0.16, 0.9, 0.5);
  }

  /** A soft bell-like note: a sine and a quiet octave, dying away. */
  private chime(t: number, freq: number, vol: number) {
    for (const [m, v] of [[1, 1], [2, 0.25], [3, 0.08]]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq * m;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * v, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.01, 0.35 / m);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 2);
    }
  }

  /** One wet blob: a low bubble that swells in pitch, and a smack of muffled noise. */
  private squelch(t: number, v: number, freq: number, out: AudioNode) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 3.2, t + 0.09);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * v, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.03, 0.035);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
    this.burst(t, 0.07, 0.05 * v, 450, 1.5, 'lowpass', out, 0.006, null);
  }

  // --- the cell's sources ---

  /** One ambient source: a panner with a hard range, a switch, and whatever the source plays into it. */
  private placed(p: V3, range: number, send: number, bus: AudioNode, on: number, panning: PanningModelType = 'HRTF', dry = false): SourceVoice {
    const panner = this.panner('linear', 0.7, range, panning);
    place(panner, p);
    panner.connect(bus);
    // the reverb is fed after the distance, so a source out of range is silent there too
    const s = this.gain(dry ? 0 : send);
    panner.connect(s).connect(this.room);
    const wall = this.wall(roomAt(p.x, p.z)?.id ?? null, dry);
    wall.gain.connect(panner);
    const g = this.gain(on);
    g.connect(wall.filter);
    return { on: g, wall, nodes: [g, wall.filter, wall.gain, panner, s], sources: [], patterns: [] };
  }

  private ambientVoice(a: Ambient): AmbientVoice {
    // Chromium's HRTF panner idles through silence and then glides from the stale direction, so a
    // click after a head turn comes from where the source used to be: lone clicks pan by equal power
    const clicks = a.kind === 'drip' || a.kind === 'clock' || a.kind === 'meter';
    const v: AmbientVoice = { a, ...this.placed(a, a.range, SEND[a.kind], this.cell, a.on ? 1 : 0, clicks ? 'equalpower' : 'HRTF', a.dry) };
    const every = (period: number, at: number[], play: Pattern['play'], origin = this.now) => v.patterns.push({ origin, period, at, play, until: this.now });
    const ctx = this.ctx;
    const out = v.on;
    if (import.meta.env.DEV && reachesZone(a.x, a.z, a.range)) console.error(`${a.kind} can be heard from an exit zone`);

    if (a.kind === 'fridge') {
      // the ZIL's compressor: a steady low hum, and every so often it shudders and rattles
      const hum = this.gain(1);
      hum.connect(out);
      const saw = this.osc('sawtooth', 100, v);
      saw.connect(this.filter('lowpass', 320, 0.7)).connect(this.gain(0.012)).connect(hum);
      this.osc('sine', 50, v).connect(this.gain(0.01)).connect(hum);
      every(19, [7], (when) => this.rattle(when, out));
    } else if (a.kind === 'radio') {
      // the wired radio plays the same little waltz all day, through a small cheap speaker
      this.tune ??= waltz(ctx);
      const src = ctx.createBufferSource();
      src.buffer = a.reversed ? (this.tuneBack ??= reversed(ctx, this.tune)) : this.tune;
      src.loop = true;
      const speaker = this.filter('peaking', 1400, 1, 5);
      // backwards, every note ends in a sudden cut that clicks: a lower top keeps it from getting bright
      src.connect(this.filter('highpass', 300, 0.7)).connect(this.filter('lowpass', a.reversed ? 1800 : 2600, 0.8)).connect(speaker);
      const music = this.gain(0.025);
      speaker.connect(music).connect(out);
      src.start();
      v.sources.push(src);
      const hiss = this.gain(1);
      this.loopNoise(1600, 0.8, 0.0025, 'bandpass', v).connect(hiss).connect(this.filter('lowpass', 2600, 0.7)).connect(out);
      const name = a.announce;
      if (name) {
        // the music sinks into static, a voice calls the name, the waltz comes back
        every(17, [6], (when) => {
          music.gain.setTargetAtTime(0.003, when, 0.25);
          hiss.gain.setTargetAtTime(3, when, 0.3);
          const end = this.announce(when + 0.9, ['внимание', name, name], out, this.here === 'kitchen' ? `Внимание. ${name}. ${name}.` : null);
          music.gain.setTargetAtTime(0.025, end + 0.6, 0.5);
          hiss.gain.setTargetAtTime(1, end + 0.4, 0.4);
        });
      }
    } else if (a.kind === 'drip') {
      // drops from the bath tap, in an uneven but fixed rhythm
      every(7.3, [1.2, 3.65, 6.3], (when, n) => this.drop(when, [1, 0.93, 1.07][n % 3], out));
    } else if (a.kind === 'clock') {
      // tick and tock at the ends of the pendulum's swing (rooms/living.ts swings it with sin(t * pi))
      every(1, [0.5], (when, n) => this.tick(when, n % 2 ? 0.87 : 1, out), 0);
    } else if (a.kind === 'meter') {
      every(5.3, [1.6], (when) => {
        this.burst(when, 0.01, 0.03, 1500, 2, 'bandpass', out, 0.002, null);
        this.thump(when, 320, 0.015, 0.02, out);
      });
    } else {
      // the lift behind the wall: a clunk, the motor hauls the cabin for ten seconds, another clunk
      const motor = this.gain(0);
      motor.connect(out);
      const drive = this.filter('lowpass', 240, 1);
      drive.connect(motor);
      this.osc('sawtooth', 61, v).connect(drive);
      this.osc('sine', 183, v).connect(this.gain(0.15)).connect(drive);
      every(45, [4, 15.5], (when, n) => {
        if (n % 2 === 0) {
          this.clunk(when, out);
          motor.gain.setTargetAtTime(0.07, when + 0.3, 0.5);
        } else {
          motor.gain.setTargetAtTime(0, when, 0.4);
          this.clunk(when + 1.1, out);
        }
      });
    }
    return v;
  }

  /** Walls between the listener and a source in `room`, set at once to how things stand now. */
  private wall(room: RoomId | null, dry = false): Wall {
    const m = MUFFLE[separation(this.here, room)];
    const w = { room, dry, filter: this.filter('lowpass', dry ? MUFFLE[0].freq : m.freq, 0.7), gain: this.gain(m.gain) };
    w.filter.connect(w.gain);
    return w;
  }

  /** The listener changed rooms: glide to the new muffling. */
  private muffle(w: Wall, t: number) {
    const m = MUFFLE[separation(this.here, w.room)];
    if (!w.dry) w.filter.frequency.setTargetAtTime(m.freq, t, 0.08);
    w.gain.gain.setTargetAtTime(m.gain, t, 0.08);
  }

  /**
   * Queue the events of a rhythm up to a little ahead of this frame. A slow frame plays what it
   * missed at once; after a long gap (a hidden tab) the missed events are dropped.
   */
  private schedule(p: Pattern, now: number, running: boolean) {
    const from = now - p.until > 1 ? now : p.until;
    const to = now + LOOKAHEAD;
    p.until = to;
    // a suspended context (before the first click) would bunch everything up
    if (!running || to <= from) return;
    for (let k = Math.floor((from - p.origin) / p.period); p.origin + k * p.period <= to; k++) {
      p.at.forEach((o, i) => {
        const e = p.origin + k * p.period + o;
        if (e > from && e <= to) p.play(this.ctx.currentTime + Math.max(0, e - now), k * p.at.length + i);
      });
    }
  }

  private rattle(t: number, out: AudioNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const am = this.gain(0.5);
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 23;
    lfo.connect(this.gain(0.5)).connect(am.gain);
    const env = envelope(this.ctx, t, 0.2, 0.35, 0.15, 0.9);
    // the square chopping has sharp edges: twice through the lowpass, or they reach the high end
    src.connect(this.filter('bandpass', 260, 2)).connect(am).connect(this.filter('lowpass', 700, 0.7)).connect(this.filter('lowpass', 900, 0.7)).connect(env).connect(out);
    src.start(t, Math.random(), 1.6);
    lfo.start(t);
    lfo.stop(t + 1.6);
  }

  private drop(t: number, v: number, out: AudioNode) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(650 * v, t);
    osc.frequency.exponentialRampToValueAtTime(1400 * v, t + 0.04);
    const g = envelope(this.ctx, t, 0.002, 0.07, 0.05);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  private tick(t: number, v: number, out: AudioNode) {
    this.burst(t, 0.015, 0.05, 2200 * v, 5, 'bandpass', out, 0.002, null);
    this.thump(t, 900 * v, 0.025, 0.02, out);
  }

  private clunk(t: number, out: AudioNode) {
    this.thump(t, 55, 0.25, 0.2, out);
    this.burst(t, 0.12, 0.12, 350, 1, 'lowpass', out, 0.003, null);
  }

  // --- building blocks ---

  private panner(model: DistanceModelType, ref: number, max: number, panning: PanningModelType = 'HRTF') {
    return new PannerNode(this.ctx, {
      panningModel: panning,
      distanceModel: model,
      refDistance: ref,
      maxDistance: max,
      rolloffFactor: model === 'linear' ? 1 : 1.3,
    });
  }

  /** A one-shot HRTF panner at a point, for footsteps of others and the follower. */
  private at(p: V3) {
    const panner = this.panner('inverse', 1.5, 30);
    place(panner, p);
    panner.connect(this.master);
    return panner;
  }

  private gain(value: number) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  /** A share of a shared source into `to`; returns the node to disconnect later. */
  private into(src: AudioNode, value: number, to: AudioNode) {
    const g = this.gain(value);
    src.connect(g).connect(to);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, gain = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  /** A running oscillator owned by an ambient voice (stopped when the cell is rebuilt). */
  private osc(type: OscillatorType, freq: number, v: SourceVoice) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    v.sources.push(o);
    return o;
  }

  /** Endless filtered noise at a fixed level; owned by `v` if given, otherwise forever. */
  private loopNoise(freq: number, q: number, gain: number, type: BiquadFilterType, v?: SourceVoice) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const g = this.gain(gain);
    src.connect(this.filter(type, freq, q)).connect(g);
    src.start(0, Math.random());
    v?.sources.push(src);
    return g;
  }

  /** A burst of noise through a filter with a soft attack and exponential decay; a little goes to the room unless `room` is null. */
  private burst(t: number, dur: number, gain: number, freq: number, q: number, type: BiquadFilterType, out: AudioNode, attack = 0.004, room: AudioNode | null = this.room) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = envelope(this.ctx, t, attack, dur, gain);
    src.connect(this.filter(type, freq, q)).connect(g).connect(out);
    if (room) g.connect(room);
    src.start(t, Math.random() * 1.5, attack + dur + 0.05);
  }

  private thump(t: number, freq: number, dur: number, gain: number, out: AudioNode) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = envelope(this.ctx, t, 0.003, dur, gain);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * A footstep on a given floor, each one slightly different: muffled on a rug, a hard click on
   * tiles, gritty on concrete, a soft slap on linoleum, a hollow knock on parquet, and a creak on
   * the boards that creak.
   */
  private footfall(t: number, gain: number, out: AudioNode, floor: Footing, creak: boolean, room: AudioNode | null = this.room) {
    const v = 0.85 + Math.random() * 0.3;
    if (floor === 'carpet') {
      this.thump(t, 70 * v, 0.07, gain * 0.8, out);
      this.burst(t, 0.09, gain * 0.8, 500 * v, 0.8, 'lowpass', out, undefined, room);
    } else if (floor === 'tile') {
      this.thump(t, 95 * v, 0.05, gain * 0.7, out);
      this.burst(t, 0.035, gain * 0.8, 1400 * v, 3, 'bandpass', out, 0.003, room);
      this.burst(t, 0.06, gain * 0.5, 700 * v, 1, 'lowpass', out, undefined, room);
    } else if (floor === 'concrete') {
      this.thump(t, 80 * v, 0.06, gain * 0.8, out);
      this.burst(t, 0.07, gain, 900 * v, 0.8, 'lowpass', out, undefined, room);
      this.burst(t + 0.03, 0.08, gain * 0.3, 1200 * v, 2, 'bandpass', out, 0.01, room);
    } else if (floor === 'linoleum') {
      this.thump(t, 75 * v, 0.07, gain * 0.9, out);
      this.burst(t, 0.06, gain * 0.8, 800 * v, 0.9, 'lowpass', out, undefined, room);
      this.burst(t + 0.05, 0.05, gain * 0.2, 1300 * v, 3, 'bandpass', out, 0.01, room);
    } else {
      this.thump(t, 120 * v, 0.08, gain * 0.8, out);
      this.burst(t, 0.06, gain * 0.8, 450 * v, 3, 'bandpass', out, undefined, room);
      this.burst(t, 0.04, gain * 0.4, 1200 * v, 1, 'lowpass', out, undefined, room);
    }
    if (creak) this.creak(t + 0.04, gain * 0.5, v, out);
  }

  /** A floorboard giving under the weight: a buzzy tone sliding up and down in a narrow band. */
  private creak(t: number, gain: number, v: number, out: AudioNode) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(105 * v, t);
    osc.frequency.linearRampToValueAtTime(160 * v, t + 0.12);
    osc.frequency.linearRampToValueAtTime(130 * v, t + 0.28);
    const g = envelope(this.ctx, t, 0.03, 0.2, gain, 0.1);
    osc.connect(this.filter('bandpass', 850 * v, 6)).connect(this.filter('lowpass', 1500, 0.7)).connect(g).connect(out);
    g.connect(this.room);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  // --- anomaly sounds ---

  /** One anomaly sound (World.emitters): placed like the cell's own sources, walls and range included. */
  private emitterVoice(e: Emitter): EmitterVoice {
    const v: EmitterVoice = { e, done: false, play: null, ...this.placed(e, e.range, 0.5, this.master, 1, 'HRTF', e.dry) };
    const out = this.gain(e.gain ?? 1);
    out.connect(v.on);
    v.nodes.push(out);
    if (import.meta.env.DEV && reachesZone(e.x, e.z, e.range)) console.error(`anomaly sound ${e.kind} can be heard from an exit zone`);
    const ctx = this.ctx;
    const noise = (freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') => {
      this.soft(this.loopNoise(freq, q, gain, type, v)).connect(out);
    };
    /** A slow wobble of a gain: the LFO adds `depth` around the gain's own value. */
    const wobble = (g: GainNode, rate: number, depth: number, type: OscillatorType = 'sine') => {
      const lfo = this.osc(type, rate, v);
      lfo.connect(this.gain(depth)).connect(g.gain);
    };

    switch (e.kind) {
      case 'hiss': {
        // gas burning on a ring: a soft roar with a breathy top
        noise(1100, 0.7, 0.05);
        noise(350, 0.7, 0.05, 'lowpass');
        break;
      }
      case 'dialtone': {
        // the Soviet dial tone, 425 Hz, thin from the earpiece of a handset lying on its side
        const tone = this.gain(0.012);
        this.osc('sine', 425, v).connect(this.filter('peaking', 900, 1, 6)).connect(tone).connect(out);
        break;
      }
      case 'whistle': {
        // a kettle on the boil: two close tones beating, with a breathy wobble
        const g = this.gain(0.012);
        g.connect(this.filter('lowpass', 2500, 0.7)).connect(out);
        for (const f of [1640, 1652]) {
          const o = this.osc('sine', f, v);
          this.osc('sine', 5.3, v).connect(this.gain(14)).connect(o.frequency);
          o.connect(g);
        }
        wobble(g, 0.7, 0.004);
        noise(1650, 4, 0.006);
        break;
      }
      case 'stream': {
        // a tap left running into a steel sink
        const g = this.gain(1);
        g.connect(out);
        this.soft(this.loopNoise(900, 0.9, 0.045, 'bandpass', v)).connect(g);
        this.loopNoise(260, 1.5, 0.04, 'bandpass', v).connect(g);
        wobble(g, 9, 0.12);
        break;
      }
      case 'cistern': {
        // water trickling into the pan without end
        const g = this.gain(1);
        g.connect(out);
        this.soft(this.loopNoise(1000, 1.2, 0.03, 'bandpass', v)).connect(g);
        this.loopNoise(500, 2, 0.02, 'bandpass', v).connect(g);
        wobble(g, 6.3, 0.35);
        break;
      }
      case 'chute': {
        // a deep drone up the rubbish chute, swelling slowly
        const g = this.gain(1);
        g.connect(out);
        this.osc('sawtooth', 46, v).connect(this.filter('lowpass', 150, 0.9)).connect(this.gain(0.05)).connect(g);
        this.osc('sine', 69, v).connect(this.gain(0.012)).connect(g);
        this.loopNoise(120, 0.8, 0.04, 'lowpass', v).connect(g);
        wobble(g, 0.23, 0.45);
        break;
      }
      case 'tv': {
        // a set tuned to nothing: hiss, and the low hum of its tube
        noise(1800, 0.5, 0.015);
        this.osc('sine', 50, v).connect(this.gain(0.008)).connect(out);
        break;
      }
      case 'breath':
        v.play = (t) => {
          // a slow breath out right behind the head, and the start of the next one in
          for (const [at, attack, hold, dur, gain, freq] of [[0, 0.35, 0.6, 0.9, 0.1, 650], [2.1, 0.5, 0.5, 0.4, 0.05, 1000]]) {
            const src = ctx.createBufferSource();
            src.buffer = this.noise;
            const g = envelope(ctx, t + at, attack, dur, gain, hold);
            this.soft(src.connect(this.filter('bandpass', freq, 0.8))).connect(g).connect(out);
            src.start(t + at, 0.3, attack + hold + dur + 0.1);
          }
        };
        break;
      case 'shut':
        v.play = (t) => {
          // a door swinging to: its hinges complaining, then the latch
          this.creak(t, 0.1, 1.1, out);
          this.creak(t + 0.35, 0.08, 0.9, out);
          this.thump(t + 0.9, 95, 0.1, 0.2, out);
          this.burst(t + 0.9, 0.04, 0.12, 1300, 3, 'bandpass', out, 0.002, null);
        };
        break;
      case 'slam':
        v.play = (t) => {
          // a door slammed hard: the blow, the frame rattling, the room ringing with it (a sting: under 0.15 peak)
          this.thump(t, 62, 0.22, 0.8, out);
          this.burst(t, 0.12, 0.5, 420, 0.8, 'lowpass', out, 0.002);
          this.burst(t + 0.015, 0.06, 0.18, 1200, 2, 'bandpass', out, 0.002);
          this.thump(t + 0.09, 140, 0.05, 0.13, out);
          this.thump(t + 0.16, 130, 0.04, 0.08, out);
        };
        break;
      case 'ring':
        v.play = (t) => {
          // one ring of the bell, cut short: a sting (under 0.15 peak)
          const g = envelope(ctx, t, 0.004, 0.25, 0.075, 0.45);
          const trem = this.gain(0.5);
          const lfo = ctx.createOscillator();
          lfo.type = 'square';
          lfo.frequency.value = 18;
          lfo.connect(this.gain(0.5)).connect(trem.gain);
          for (const f of [640, 790]) {
            const osc = ctx.createOscillator();
            osc.frequency.value = f;
            osc.connect(trem);
            osc.start(t);
            osc.stop(t + 0.9);
          }
          lfo.start(t);
          lfo.stop(t + 0.9);
          trem.connect(this.filter('lowpass', 1800, 0.7)).connect(this.filter('lowpass', 2200, 0.7)).connect(g).connect(out);
        };
        break;
      case 'step':
        v.play = (t) => this.footfall(t, STEP_GAIN, out, footingAt(e.x, e.z), false, e.dry ? null : this.room);
        break;
      case 'call':
        v.play = (t) => {
          if (e.phrase) {
            const src = ctx.createBufferSource();
            src.buffer = e.phrase;
            src.connect(this.filter('highpass', 200, 0.7)).connect(this.filter('lowpass', 3000, 0.7)).connect(out);
            src.start(t);
            return;
          }
          // someone the other side of the wall saying the name twice, as on the radio
          const name = e.name || 'жилец';
          this.announce(t, [name, name], out, null, 0.19, 0.9, 0.35);
        };
        break;
      case 'knock':
        v.play = (t) => {
          // three knuckle knocks, the last a little softer
          for (const [dt, g] of [[0, 0.22], [0.24, 0.22], [0.5, 0.16]]) {
            this.thump(t + dt, 120, 0.09, g, out);
            this.burst(t + dt, 0.05, g * 0.8, 500, 1, 'lowpass', out, 0.002, null);
          }
        };
        break;
      case 'pipes':
        v.play = (t) => {
          // something metal struck on the heating pipes: a dull knock and a short ring
          this.thump(t, 190, 0.06, 0.22, out);
          for (const [f, g] of [[740, 0.08], [1190, 0.04]]) {
            const o = ctx.createOscillator();
            o.frequency.value = f;
            o.connect(envelope(ctx, t, 0.006, 0.35, g)).connect(out);
            o.start(t);
            o.stop(t + 0.5);
          }
        };
        break;
      case 'phone':
        v.play = (t) => {
          // an old bell phone: two tones under a fast tremolo, rung twice
          for (const start of [0, 0.55]) {
            const g = envelope(ctx, t + start, 0.02, 0.4, 0.05, 0.35);
            const trem = this.gain(0.5);
            const lfo = ctx.createOscillator();
            lfo.type = 'square';
            lfo.frequency.value = 18;
            lfo.connect(this.gain(0.5)).connect(trem.gain);
            for (const f of [640, 790]) {
              const osc = ctx.createOscillator();
              osc.frequency.value = f;
              osc.connect(trem);
              osc.start(t + start);
              osc.stop(t + start + 0.85);
            }
            trem.connect(g).connect(this.filter('lowpass', 2000, 0.7)).connect(out);
            lfo.start(t + start);
            lfo.stop(t + start + 0.85);
          }
        };
        break;
      case 'creak':
        v.play = (t) => {
          // slow hinge creak: a buzzy tone sliding up and back through a narrow band
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(150, t);
          osc.frequency.linearRampToValueAtTime(240, t + 0.45);
          osc.frequency.linearRampToValueAtTime(190, t + 0.9);
          const g = envelope(ctx, t, 0.06, 0.5, 0.1, 0.5);
          osc.connect(this.filter('bandpass', 700, 5)).connect(this.filter('lowpass', 1800, 0.7)).connect(g).connect(out);
          osc.start(t);
          osc.stop(t + 1.2);
        };
        break;
      case 'drill':
        v.play = (t, n) => {
          // a neighbour's drill biting into concrete for a few seconds
          const dur = 2.2 + (n % 3) * 0.7;
          const g = this.gain(0);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.09, t + 0.15);
          g.gain.setValueAtTime(0.09, t + dur);
          g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
          g.connect(out);
          const motor = ctx.createOscillator();
          motor.type = 'sawtooth';
          motor.frequency.setValueAtTime(90, t);
          motor.frequency.linearRampToValueAtTime(160, t + 0.25);
          motor.frequency.linearRampToValueAtTime(150, t + dur);
          motor.frequency.linearRampToValueAtTime(70, t + dur + 0.3);
          // the bit stutters as it hammers
          const am = this.gain(0.6);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 31;
          lfo.connect(this.gain(0.4)).connect(am.gain);
          motor.connect(this.filter('lowpass', 900, 1.2)).connect(am).connect(g);
          const src = ctx.createBufferSource();
          src.buffer = this.noise;
          src.connect(this.filter('bandpass', 700, 1.5)).connect(this.gain(0.6)).connect(am);
          for (const s of [motor, lfo, src]) {
            s.start(t);
            s.stop(t + dur + 0.4);
          }
        };
        break;
      case 'cry':
        v.play = (t, n) => {
          // a small child sobbing: a few wailing breaths, each sliding up and falling away
          const breaths = [[0, 1.1], [1.35, 0.8], [2.35, 1.4]];
          for (const [dt, len] of breaths) {
            const at = t + dt;
            const f0 = 400 + ((n * 3 + dt * 7) % 5) * 12;
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(f0 * 0.9, at);
            o.frequency.linearRampToValueAtTime(f0 * 1.25, at + len * 0.3);
            o.frequency.linearRampToValueAtTime(f0 * 0.85, at + len);
            const vib = ctx.createOscillator();
            vib.frequency.value = 7;
            vib.connect(this.gain(9)).connect(o.frequency);
            const g = envelope(ctx, at, 0.08, 0.25, 0.05, len - 0.2);
            o.connect(this.filter('bandpass', 1100, 1.5)).connect(this.filter('lowpass', 1800, 0.7)).connect(g).connect(out);
            for (const s of [o, vib]) {
              s.start(at);
              s.stop(at + len + 0.4);
            }
          }
        };
        break;
    }
    if (v.play && e.every !== undefined) v.patterns.push({ origin: 0, period: e.every, at: e.at ?? [0], play: v.play, until: this.now });
    return v;
  }

  /**
   * An announcer on the wired radio: "Vnimanie... <name>", or the samosbor warning. With `speech`
   * and a Russian voice in the browser it is speech synthesis (which can't be placed in space, so
   * only for a listener who is meant to hear it plainly), otherwise a murmur of the right vowels
   * from a formant synthesiser, `syl` seconds a syllable. Returns when it ends.
   */
  private announce(t: number, said: string[], out: AudioNode, speech: string | null, syl = 0.2, rate = 0.75, volume = 0.35) {
    const voice = 'speechSynthesis' in window ? speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru')) : undefined;
    if (voice && speech) {
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(speech);
        Object.assign(u, { voice, lang: voice.lang, rate, pitch: 0.5, volume });
        speechSynthesis.speak(u);
      }, Math.max(0, t - this.ctx.currentTime) * 1000);
      return t + 3;
    }
    const ctx = this.ctx;
    const k = syl / 0.2;
    const syll = (w: string) => [...w.toLowerCase()].map((c) => VOWELS[c]).filter((f) => f);
    const words = said.map(syll).map((w) => (w.length ? w : [VOWELS['а']]));
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    const f1 = this.filter('bandpass', 700, 6);
    const f2 = this.filter('bandpass', 1200, 8);
    const env = this.gain(0);
    src.connect(f1).connect(env);
    src.connect(f2).connect(this.gain(0.6)).connect(env);
    // a small speaker on a wire: nothing much above 1.5 kHz
    this.soft(env.connect(this.filter('highpass', 300, 0.7)).connect(this.filter('lowpass', 1500, 0.7))).connect(this.gain(0.6)).connect(out);
    const puff = this.filter('lowpass', 1500, 0.7);
    this.soft(puff).connect(out);
    let at = t;
    for (const w of words) {
      // a slightly falling announcer's pitch over each word
      src.frequency.setValueAtTime(128, at);
      w.forEach(([a, b], i) => {
        const s = at + i * syl;
        // a consonant: a puff of noise, then the vowel
        this.burst(s, 0.04 * k, 0.015, 900, 2, 'bandpass', puff, 0.008, null);
        f1.frequency.setValueAtTime(a, s + 0.04 * k);
        f2.frequency.setValueAtTime(Math.min(b, 1700), s + 0.04 * k);
        env.gain.setValueAtTime(0, s + 0.04 * k);
        env.gain.linearRampToValueAtTime(0.9, s + 0.07 * k);
        env.gain.setValueAtTime(0.9, s + 0.16 * k);
        env.gain.linearRampToValueAtTime(0, s + 0.19 * k);
      });
      at += w.length * syl;
      src.frequency.linearRampToValueAtTime(104, at);
      at += 0.45 * k;
    }
    src.start(t);
    src.stop(at);
    return at;
  }

  /** `src` twice through a gentle lowpass, for noise that has to stay well clear of the high end; returns the output. */
  private soft(src: AudioNode) {
    return src.connect(this.filter('lowpass', 1900, 0.6)).connect(this.filter('lowpass', 1900, 0.6));
  }

  private tone(freq: number, dur: number, vol: number, delay = 0, slideTo?: number) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = envelope(this.ctx, t, 0.008, dur, vol);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * One reverb per kind of room, all fed from one input: short, dense early reflections from
   * feedback delay lines. Only the one for the listener's room is turned up.
   */
  private makeReverbs(): GainNode {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const pre = this.filter('lowpass', 2500, 0.7);
    input.connect(pre);
    for (const [kind, r] of Object.entries(REVERB) as [Acoustics, (typeof REVERB)[Acoustics]][]) {
      const out = this.gain(kind === this.acoustics ? r.level : 0);
      out.connect(this.master);
      r.taps.forEach((time, i) => {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = time;
        const damp = this.filter('lowpass', r.damp, 0.7);
        const fb = this.gain(r.fb);
        const p = ctx.createStereoPanner();
        p.pan.value = (i % 2 ? 1 : -1) * (0.3 + 0.1 * i);
        pre.connect(d).connect(damp).connect(fb).connect(d);
        damp.connect(p).connect(out);
      });
      this.reverbs.set(kind, out);
    }
    return input;
  }
}

/** Faint ticks of a caged bulb: clusters of tiny clicks at uneven but fixed moments, 6 s around. */
function crackle(ctx: BaseAudioContext, seed: number) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * 6, sr);
  const data = buf.getChannelData(0);
  const r = rng(seed);
  const len = Math.round(0.004 * sr);
  for (let t = 0.2 + r() * 0.5; t < 5.8; t += 0.25 + r() * r() * 1.6) {
    const clicks = 1 + Math.floor(r() * 4);
    let at = t;
    for (let c = 0; c < clicks; c++) {
      const amp = 0.3 + r() * 0.7;
      const i0 = Math.floor(at * sr);
      for (let j = 0; j < len && i0 + j < data.length; j++) data[i0 + j] += amp * (r() * 2 - 1) * Math.exp(-j / (0.0008 * sr));
      at += 0.004 + r() * 0.03;
    }
  }
  return buf;
}

/**
 * A little waltz in A minor for the wired radio, 16 bars at 132 beats per minute (about 22 s): a
 * reedy melody, a bass note on the one, chords on two and three. Rendered once into a buffer.
 */
function waltz(ctx: BaseAudioContext) {
  // melody per bar as [midi note, beats], and the bar's chord: bass note and triad
  const A = { bass: 45, triad: [57, 60, 64] };
  const E = { bass: 40, triad: [56, 59, 64] };
  const G = { bass: 43, triad: [55, 59, 62] };
  const C = { bass: 48, triad: [55, 60, 64] };
  const D = { bass: 50, triad: [57, 62, 65] };
  const bars: [number[][], typeof A][] = [
    [[[69, 2], [72, 1]], A], [[[76, 2], [74, 1]], A], [[[72, 1], [71, 1], [69, 1]], A], [[[71, 3]], E],
    [[[67, 2], [71, 1]], G], [[[74, 2], [72, 1]], G], [[[71, 1], [69, 1], [68, 1]], E], [[[69, 3]], A],
    [[[72, 2], [76, 1]], A], [[[81, 2], [79, 1]], C], [[[77, 1], [76, 1], [74, 1]], D], [[[76, 3]], A],
    [[[74, 2], [77, 1]], D], [[[76, 1], [72, 1], [69, 1]], A], [[[71, 2], [68, 1]], E], [[[69, 3]], A],
  ];
  const beat = 60 / 132;
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.round(bars.length * 3 * beat * sr), sr);
  const data = buf.getChannelData(0);
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  /** Adds one note: harmonics as [multiple, level], held `dur` s, decaying with `tau` (0 = held), wrapping around the loop. */
  const note = (start: number, m: number, dur: number, vol: number, harmonics: number[][], tau: number, vibrato = 0) => {
    const f = hz(m);
    const n = Math.round((dur + 0.08) * sr);
    const i0 = Math.round(start * sr);
    let phase = 0;
    for (let j = 0; j < n; j++) {
      const s = j / sr;
      const env = Math.min(1, s / 0.02) * (tau ? Math.exp(-s / tau) : 1) * (s > dur ? Math.max(0, 1 - (s - dur) / 0.08) : 1);
      phase += (2 * Math.PI * f * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * s))) / sr;
      let v = 0;
      for (const [k, a] of harmonics) v += a * Math.sin(k * phase);
      data[(i0 + j) % data.length] += vol * env * v;
    }
  };
  bars.forEach(([melody, chord], b) => {
    const t0 = b * 3 * beat;
    let t = t0;
    for (const [m, beats] of melody) {
      note(t, m, beats * beat * 0.92, 0.5, [[1, 1], [2, 0.2], [3, 0.35], [5, 0.12]], 0, 0.004);
      t += beats * beat;
    }
    note(t0, chord.bass, beat * 0.9, 0.45, [[1, 1], [2, 0.4]], 0.35);
    for (const k of [1, 2]) for (const m of chord.triad) note(t0 + k * beat, m, beat * 0.5, 0.12, [[1, 1], [2, 0.3]], 0.15);
  });
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < data.length; i++) data[i] /= peak;
  return buf;
}

/** The same buffer played backwards. */
function reversed(ctx: BaseAudioContext, buf: AudioBuffer) {
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  out.getChannelData(0).set(buf.getChannelData(0).slice().reverse());
  return out;
}

/** First two formants of Russian (and Latin) vowels, Hz, for the radio's murmur. */
const VOWELS: Record<string, [number, number]> = Object.fromEntries(
  (
    [
      ['аaя', [750, 1250]],
      ['оoё', [500, 850]],
      ['уuю', [320, 700]],
      ['ыy', [320, 1500]],
      ['эеe', [500, 1800]],
      ['иi', [300, 2200]],
    ] as [string, [number, number]][]
  ).flatMap(([cs, f]) => [...cs].map((c) => [c, f])),
);

/** Gain envelope: soft linear attack, optional hold, exponential release. */
function envelope(ctx: AudioContext, t: number, attack: number, dur: number, gain: number, hold = 0) {
  const g = ctx.createGain();
  // shut until it starts: whatever plays into it early stays silent
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  if (hold > 0) g.gain.setValueAtTime(gain, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
  return g;
}

function place(p: PannerNode, at: V3) {
  p.positionX.value = at.x;
  p.positionY.value = at.y;
  p.positionZ.value = at.z;
}

/** Firefox still lacks AudioParams on the listener. */
function setListener(l: AudioListener, pos: V3, fwd: V3, up: V3) {
  if (l.positionX) {
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}

/**
 * One breath through a gas mask, looped: a drawn-in hiss through the filter, a click of the valve,
 * a longer breath out. Noise from a fixed seed: the same breath every time.
 */
function breathing(ctx: BaseAudioContext) {
  const len = 3.8;
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(len * rate), rate);
  const d = buf.getChannelData(0);
  const r = rng(5150);
  let lp = 0;
  const shape = (t: number) => {
    // in 0.2..1.3 s, out 1.6..3.2 s, a smooth swell each
    const swell = (a: number, b: number) => (t > a && t < b ? Math.sin((Math.PI * (t - a)) / (b - a)) ** 2 : 0);
    return 0.5 * swell(0.2, 1.3) + 0.35 * swell(1.6, 3.2);
  };
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    lp += 0.25 * (r() * 2 - 1 - lp);
    d[i] = lp * shape(t);
  }
  // the exhale valve opening: a small soft tick
  for (const at of [1.6]) {
    const s = Math.floor(at * rate);
    for (let i = 0; i < 0.012 * rate; i++) d[s + i] += 0.25 * Math.sin(i * 0.09) * Math.exp(-i / (0.003 * rate));
  }
  return buf;
}
