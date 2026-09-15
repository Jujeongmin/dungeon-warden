/**
 * The warden's own growth.
 *
 * Adventurers level every time they die, and the dungeon grows by research
 * and gold - but the warden itself never grew at all, however many it put
 * down with its own hands. It does now, by one number the server keeps: every
 * adventurer the warden has put down itself and seen killed or taken. Enough
 * of them and the body it rides hits a little harder and takes a little less.
 *
 * A little. The level is for playing well in person, and it must never be
 * worth more than building well; only the ridden body is affected, and the
 * top level adds less than a single research tier does to the whole garrison.
 */

/** Lifetime downs at which each level after the first is reached. */
export const WARDEN_LEVEL_DOWNS = [5, 15, 30, 50, 80];
export const WARDEN_MAX_LEVEL = WARDEN_LEVEL_DOWNS.length + 1;

/** What each level past the first adds to the ridden body's blows. */
export const MIGHT_PER_LEVEL = 0.03;
/** And takes off the blows it receives. */
export const GUARD_PER_LEVEL = 0.02;

export function wardenLevel(downs: number): number {
  let level = 1;
  for (const need of WARDEN_LEVEL_DOWNS) if (downs >= need) level += 1;
  return level;
}

/** Multiplier on the ridden body's blows, on top of WARDEN_MIGHT. */
export function wardenMightScale(level: number): number {
  return 1 + MIGHT_PER_LEVEL * (clampLevel(level) - 1);
}

/** Multiplier on the blows it takes, on top of WARDEN_GUARD. */
export function wardenGuardScale(level: number): number {
  return 1 - GUARD_PER_LEVEL * (clampLevel(level) - 1);
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(WARDEN_MAX_LEVEL, Math.floor(level)));
}
