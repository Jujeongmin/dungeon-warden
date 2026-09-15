import { MINION_COST } from "./types";

/**
 * The least gold a raid ever leaves a dungeon with.
 *
 * Losing used to be able to end the game without saying so. A breach takes
 * a share of the purse, the fallen garrison sits out a revive timer, and a
 * dungeon with no defenders and no gold loses the next raid too - which takes
 * more. The ways out existed (the ad pays, starting over refunds everything)
 * but nothing pointed at them, and a new player in that spiral simply stops.
 *
 * So the raid itself tops the purse back up to the price of one warrior and a
 * little digging: enough to put something back in the road, never enough to
 * be worth losing on purpose. Mirrored in server.js, which is what pays it.
 */
export const RELIEF_FLOOR = MINION_COST.warrior + 10;

/**
 * How much relief a finished raid owes.
 *
 * Measured after the raid's own payout and plunder, so it only ever fills the
 * gap to the floor: a raid that already leaves the dungeon above it pays
 * nothing extra, whatever the outcome.
 */
export function reliefFor(goldBefore: number, reward: number, plundered: number): number {
  const after = goldBefore + reward - plundered;
  return after >= RELIEF_FLOOR ? 0 : RELIEF_FLOOR - after;
}

/**
 * Whether the dungeon is stuck: nothing it can afford, and nobody ready to
 * stand in the road.
 *
 * The moment to say out loud how to get unstuck, rather than a moment later.
 */
export function isBroke(gold: number, minions: Array<{ revivesAt?: number | null }>, now: number): boolean {
  const ready = minions.some((m) => !m.revivesAt || m.revivesAt <= now);
  return gold < MINION_COST.warrior && !ready;
}
