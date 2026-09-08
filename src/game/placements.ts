/**
 * Shared rules for the three things a player puts down: minions, traps and
 * rooms. All three price the same way, so the logic lives here instead of
 * being written out once per collection.
 */
export interface Placed {
  id: string;
  type: string;
  x: number;
  y: number;
}

/**
 * Charges only for entries that are new or changed type, matching server.js.
 * Removing something refunds nothing, and reusing an id with a different type
 * pays full price so a cheap unit cannot be swapped for an expensive one.
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

export function sameList<T extends Placed>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const key = (item: T) => `${item.id}:${item.type}:${item.x}:${item.y}`;
  return a.map(key).sort().join("|") === b.map(key).sort().join("|");
}
