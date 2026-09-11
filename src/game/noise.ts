/**
 * A stable number in [0, 1) for a tile.
 *
 * Deterministic and stateless, so the same tile answers the same way for the
 * life of the dungeon and across a reload — which is what lets the torches be
 * decided on the fly rather than stored.
 *
 * This is all that is left of src/game/decor.ts. That file scattered barrels
 * and pillars across the floor and made them block the walk, which was the old
 * answer to "what stops a walker". The rock answers it now, and it is a better
 * answer for one reason: the player can see exactly where it is, because they
 * are the one who left it there.
 */
export function tileNoise(x: number, y: number, salt: number): number {
  let hash = 0x811c9dc5;
  for (const value of [x + 1, y + 1, salt + 1]) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 100000) / 100000;
}
