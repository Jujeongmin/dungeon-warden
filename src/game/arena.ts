import type { Point } from "./sim/pathfinding";

/**
 * The room the whole game happens in.
 *
 * The rectangle a stage is played in. Its size is the stage's: see
 * src/game/td/stages.ts.
 */
export interface Arena {
  w: number;
  h: number;
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
