import * as THREE from 'three';
import { LINGER } from '../shared/rules.ts';
import { SMOG_RGB } from './samosbor.ts';
import { SMOG, setSmogColor } from './world/smog.ts';

/** Once anyone is out, everything fades within this many seconds: less than the walk from the blast door to the exit zone. */
const FADE_OUT = 1.2;
const FADE_IN = 3;
/** The siren comes up over this many seconds from LINGER.siren. */
const SIREN_RISE = 12;
/** The fog's colour on screen, darker than a samosbor's: lit by the ordinary lamps, not the red ones. */
const FOG_LIGHT = 0.55;

/**
 * Lingering is dangerous (docs/DESIGN.md): a rule of every cycle, not an anomaly. From LINGER.siren
 * a distant siren from the next block, from LINGER.fog a thin layer of samosbor fog over the floor,
 * thickening until LINGER.samosbor, when the server sets off a samosbor. Timed by the cycle's
 * clock from the server, so every screen agrees. While anyone is out it all fades away and the
 * clock stands still, so nothing of it is left at the loop's transfer, where the next cycle starts
 * without it.
 */
export class Linger {
  /** 0 while anyone is out, 1 otherwise, eased. */
  private gate = 1;
  /** How loud the distant siren is, 0..1 (Sound.distantSiren). */
  siren = 0;
  /** How far the fog has got, 0..1. */
  fog = 0;

  /**
   * `t`: seconds since the cycle began; `out`: someone is past a blast door; `samosbor`: one is
   * going on, which has its own siren and fog. Sets the fog's uniforms when it owns them.
   */
  update(dt: number, t: number, out: boolean, samosbor: boolean) {
    if (samosbor) {
      this.gate = 0;
      this.siren = this.fog = 0;
      return;
    }
    this.gate = THREE.MathUtils.clamp(this.gate + (out ? -dt / FADE_OUT : dt / FADE_IN), 0, 1);
    const s = LINGER.siren / 1000;
    const f = LINGER.fog / 1000;
    const end = LINGER.samosbor / 1000;
    this.siren = this.gate * THREE.MathUtils.clamp((t - s) / SIREN_RISE, 0, 1);
    this.fog = this.gate * THREE.MathUtils.clamp((t - f) / (end - f), 0, 1);
    if (this.fog <= 0) {
      SMOG.uSmogEven.value = 0;
      SMOG.uSmogFloor.value = 0;
      return;
    }
    // a layer a hand's breadth deep at first, knee deep by the end, and a little haze above it
    const k = this.fog ** 1.3;
    SMOG.uSmogEven.value = 0.006 * k;
    SMOG.uSmogFloor.value = 0.05 + 0.75 * k;
    SMOG.uSmogFall.value = 5 - 3 * k;
    setSmogColor(SMOG_RGB[0] * FOG_LIGHT, SMOG_RGB[1] * FOG_LIGHT, SMOG_RGB[2] * FOG_LIGHT);
  }
}
