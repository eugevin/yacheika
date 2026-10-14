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
 * heard out, twice.
 */
export const SAMOSBOR_MS = 15_000;
/** When each part of it comes, seconds from the verdict (src/samosbor.ts tells them in order). */
export const SAMOSBOR = { warn: 0.8, rewarn: 8, fog: 3, flicker: 8, veil: 11.5, covered: 13, silence: 14.2 };

/** Hardest anomaly tier allowed at a given streak. */
export function maxDifficulty(cycle: number) {
  return cycle < 2 ? 1 : cycle < 5 ? 2 : 3;
}

/** Chance that an anomaly is shown to only one player. Needs at least two players. */
export function privateChance(cycle: number, players: number) {
  return players < 2 ? 0 : Math.min(0.5, 0.1 * cycle);
}
