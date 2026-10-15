/** Cycles in a row the group must get right to escape. */
export const GOAL = 10;
/** Once the first player steps into an exit, the rest have this long to follow. */
export const COUNTDOWN_MS = 20_000;
/**
 * Once the whole group is in the vestibules, the verdict waits this long (unless everyone already
 * stands in a zone), so whoever has just crossed the threshold can walk on to the zone and loop
 * seamlessly.
 */
export const SETTLE_MS = 2500;
/** Chance that a cycle (other than the very first) hides an anomaly. */
export const ANOMALY_CHANCE = 0.6;
/** Anomalies seen in the last N cycles are not rolled again. */
export const RECENT_LIMIT = 6;
export const MAX_PLAYERS = 6;
/**
 * A wrong verdict sets off a samosbor (docs/DESIGN.md, 7): siren, red light, fog. The next cycle
 * starts this long after it, from floor 0, behind a fade. Long enough for the spoken warning to be
 * heard out.
 */
export const SAMOSBOR_MS = 10_000;
/** When each part of it comes, seconds from the verdict (src/samosbor.ts tells them in order). */
export const SAMOSBOR = { warn: 0.8, again: null as number | null, fog: 2.5, flicker: 6, veil: 7.8, covered: 8.8, silence: 9.4 };
/**
 * The second mistake in a row without a right pass between them brings a big samosbor: longer, the
 * warning twice, the fog reaching the screen later, the siren running down at the end.
 */
export const SAMOSBOR_BIG_MS = 18_000;
export const SAMOSBOR_BIG = { warn: 0.8, again: 6.5, fog: 3, flicker: 12.5, veil: 15.6, covered: 16.8, silence: 17.4 };
export type SamosborTimes = typeof SAMOSBOR;

/**
 * Lingering is dangerous (docs/DESIGN.md): ms from the start of a cycle. A distant siren from the
 * next block, then a thin layer of fog over the floor, thickening, then the server sets off a
 * samosbor. The clock doesn't run while anyone is out: a group that is leaving is never caught.
 */
export const LINGER = { siren: 90_000, fog: 110_000, samosbor: 150_000 };

/**
 * A player is alone when nobody else in the cell stands within this many metres of them in the same
 * room or the next one (shared/walk.ts, alone): then the alone anomalies come for them.
 */
export const ALONE_M = 5;

/** Hardest anomaly tier allowed at a given streak. */
export function maxDifficulty(cycle: number) {
  return cycle < 2 ? 1 : cycle < 5 ? 2 : 3;
}

/**
 * Chance that a clean cycle shows one player a morok: an anomaly that isn't there, with a tell of
 * its own (docs/DESIGN.md, 6). From floor 3, with two players or more.
 */
export function morokChance(cycle: number, players: number) {
  return players < 2 ? 0 : Math.max(0, Math.min(0.35, 0.1 * (cycle - 2)));
}

/** Chance that an anomaly is shown to only one player. Needs at least two players. */
export function privateChance(cycle: number, players: number) {
  return players < 2 ? 0 : Math.min(0.5, 0.1 * cycle);
}
