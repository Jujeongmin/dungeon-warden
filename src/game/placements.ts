/**
 * Shared rules for the four things a player puts down: minions, traps,
 * rooms and obstacles. All four price the same way, so the logic lives here
 * instead of being written out once per collection.
 */
export interface Placed {
  id: string;
  type: string;
  x: number;
  y: number;
}

/**
 * What the player gets back for taking something down, as a share of what it
 * cost. Mirrored in server.js, which is where the gold actually moves.
 *
 * All of it. The whole loop is: watch a raid, read where the fighting
 * actually happened, move the walls. Charging to move a wall taxes the one
 * thing the game wants the player doing, and the raid they spent learning it
 * was the price already. Gold stays scarce through what things cost and how
 * many of them you may have, not through a fee on changing your mind.
 *
 * Never above one, which is the line that matters: at exactly one a
 * build-and-sell round trip nets zero, and above it the same loop is an
 * infinite supply of gold - and the server is the side that mints.
 */
export const REFUND_RATE = 1;

/**
 * Charges only for entries that are new or changed type, matching server.js.
 * Reusing an id with a different type pays full price, so a cheap unit cannot
 * be swapped for an expensive one.
 */
export function addCost<T extends Placed>(
  next: T[],
  saved: T[],
  prices: Record<string, number>,
): number {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  let cost = 0;
  for (const item of next) {
    const previous = savedById.get(item.id);
    if (!previous || previous.type !== item.type) cost += prices[item.type] ?? 0;
  }
  return cost;
}

/**
 * Pays back for entries that were saved and are now gone, or whose id has
 * been reused for a different type - the exact mirror of what addCost
 * charges, so a place-then-remove round trip settles at the refund rate
 * rather than at some accident of the two functions disagreeing.
 */
export function removedValue<T extends Placed>(
  next: T[],
  saved: T[],
  prices: Record<string, number>,
): number {
  const nextById = new Map(next.map((item) => [item.id, item]));
  let value = 0;
  for (const item of saved) {
    const current = nextById.get(item.id);
    if (!current || current.type !== item.type) value += prices[item.type] ?? 0;
  }
  return Math.floor(value * REFUND_RATE);
}

export function sameList<T extends Placed>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const key = (item: T) => `${item.id}:${item.type}:${item.x}:${item.y}`;
  return a.map(key).sort().join("|") === b.map(key).sort().join("|");
}
