/** Cycles in a row the group must get right to escape. */
export const GOAL = 10;
/** Once the first player steps into an exit, the rest have this long to follow. */
export const COUNTDOWN_MS = 20_000;
/** Chance that a cycle (other than the very first) hides an anomaly. */
export const ANOMALY_CHANCE = 0.6;
/** Anomalies seen in the last N cycles are not rolled again. */
export const RECENT_LIMIT = 6;
export const MAX_PLAYERS = 6;
/**
 * A wrong verdict sets off a samosbor (docs/DESIGN.md, 7): siren, red light, fog. The next cycle
 * starts this long after it, from floor 0, behind a fade.
 */
export const SAMOSBOR_MS = 6000;

/** Hardest anomaly tier allowed at a given streak. */
export function maxDifficulty(cycle: number) {
  return cycle < 2 ? 1 : cycle < 5 ? 2 : 3;
}

/** Chance that an anomaly is shown to only one player. Needs at least two players. */
export function privateChance(cycle: number, players: number) {
  return players < 2 ? 0 : Math.min(0.5, 0.1 * cycle);
}
