import type { Point } from "./sim/pathfinding";

/**
 * The room the whole game happens in.
 *
 * There is no terrain any more: every tile inside the rectangle is floor, and
 * the only thing that stops a walker is an obstacle the player put there. Size
 * comes from research rather than the save, so a dungeon cannot claim to be
 * bigger than what its owner has unlocked.
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

/** The coordinates a walker cannot enter, as flat keys for cheap lookup. */
export function blockedSet(
  arena: Arena,
  obstacles: Array<{ x: number; y: number }>,
): Set<number> {
  const set = new Set<number>();
  for (const o of obstacles) set.add(blockedKey(o.x, o.y, arena.w));
  return set;
}

export function inArena(arena: Arena, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < arena.w && y < arena.h;
}
