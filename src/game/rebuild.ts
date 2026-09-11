import type { Arena } from "./arena";
import { DIG_COST, dugId, dugTile, startingDig, type DugTile } from "./dig";
import { removedValue } from "./placements";
import {
  MINION_COST,
  ROOM_COST,
  TRAP_COST,
  type PlacedMinion,
  type PlacedRoom,
  type PlacedTrap,
} from "./types";

export interface RebuildInput {
  arena: Arena;
  dug: DugTile[];
  minions: PlacedMinion[];
  traps: PlacedTrap[];
  rooms: PlacedRoom[];
}

export interface RebuildPlan {
  /** What is left dug: the door, the core, and whatever a convert stands on. */
  dug: DugTile[];
  /** What is left standing. */
  minions: PlacedMinion[];
  /** Gold handed back for everything cleared. */
  refund: number;
  /** False when the dungeon is already down to this, so nothing would happen. */
  changed: boolean;
}

/**
 * The whole dungeon taken back down to bare rock, priced.
 *
 * Clearing one tile at a time already gives everything back, so this is not a
 * new rule - it is the same rule applied to the room at once. A player who
 * wants to try a different shape was otherwise tapping the remove tool forty
 * times to get back to where they started.
 *
 * Two things survive. The door and the core, which were never the player's to
 * fill in; and converts, for a different reason - they were taken from
 * prisoners rather than bought, so clearing one pays nothing back and nothing
 * can buy another. A button that silently costs you what you captured is a
 * trap, so each convert keeps its place and the tile under it, even when that
 * leaves it standing in a pocket with no corridor to it yet.
 *
 * Pure, and separate from the hook that calls it, because the arithmetic is
 * the part that can be wrong: a refund that does not match what was charged is
 * either a leak or a theft, and neither shows up on screen.
 */
export function planRebuild({ arena, dug, minions, traps, rooms }: RebuildInput): RebuildPlan {
  const survivors = minions.filter((minion) => minion.type === "convert");

  const base = startingDig(arena);
  for (const minion of survivors) {
    const id = dugId(minion.x, minion.y);
    if (!base.some((tile) => tile.id === id)) base.push(dugTile(minion.x, minion.y));
  }
  const kept = new Set(base.map((tile) => tile.id));

  const refund =
    removedValue(base, dug, { dig: DIG_COST }) +
    removedValue(survivors, minions, MINION_COST) +
    removedValue([], traps, TRAP_COST) +
    removedValue([], rooms, ROOM_COST);

  const changed = !(
    minions.length === survivors.length &&
    traps.length === 0 &&
    rooms.length === 0 &&
    dug.length === base.length &&
    dug.every((tile) => kept.has(tile.id))
  );

  return { dug: base, minions: survivors, refund, changed };
}
