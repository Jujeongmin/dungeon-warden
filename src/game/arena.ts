import type { Point } from "./sim/pathfinding";

/**
 * The room the whole game happens in.
 *
 * The rectangle is the outer edge of the rock, not a floor: what a walker may
 * enter is whatever the player has dug out of it. Size comes from research
 * rather than the save, so a dungeon cannot claim to be bigger than what its
 * owner has unlocked.
 */
export interface Arena {
  w: number;
  h: number;
}

export const BASE_ARENA: Arena = { w: 12, h: 12 };

/** Mirrors the expand1/expand2 entries of RESEARCH in server.js. */
const EXPANSIONS: Array<{ id: string; h: number }> = [
  { id: "expand1", h: 16 },
  { id: "expand2", h: 20 },
];

export function arenaFor(research: string[]): Arena {
  let h = BASE_ARENA.h;
  for (const step of EXPANSIONS) {
    if (research.includes(step.id)) h = Math.max(h, step.h);
  }
  return { w: BASE_ARENA.w, h };
}

export function entranceOf(arena: Arena): Point {
  return { x: Math.floor(arena.w / 2), y: 0 };
}

export function coreOf(arena: Arena): Point {
  return { x: Math.floor(arena.w / 2), y: arena.h - 1 };
}

export function blockedKey(x: number, y: number, w: number): number {
  return y * w + x;
}

/** The given coordinates as flat keys, for cheap lookup. */
export function blockedSet(
  arena: Arena,
  tiles: Array<{ x: number; y: number }>,
): Set<number> {
  const set = new Set<number>();
  for (const tile of tiles) set.add(blockedKey(tile.x, tile.y, arena.w));
  return set;
}

export function inArena(arena: Arena, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < arena.w && y < arena.h;
}
