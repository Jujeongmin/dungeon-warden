import { blockedKey, coreOf, entranceOf, inArena, type Arena } from "./arena";
import type { Placed } from "./placements";

/**
 * The dungeon is rock. The corridor is what you took out of it.
 *
 * This inverts what the room used to be. Every tile inside the rectangle was
 * floor and the player dropped blockers onto it, which had two problems that
 * ran through everything else:
 *
 *  - The route bent for reasons nobody could see. A* across an open field
 *    picks one staircase out of many equally short ones, and a prop the player
 *    read as scenery blocked a tile, so a corner appeared with nothing in it.
 *  - A wall was a thing sitting ON the floor, so it had to be drawn as an
 *    object, sized to the tile, lined up with its neighbours, and it still
 *    read as furniture rather than as structure.
 *
 * Carve instead and both go away. A corridor one tile wide has exactly one
 * route through it, so there is nothing left to explain; and the wall is not
 * an object at all, it is the edge of the rock the player did not dig.
 *
 * A dug tile carries an id and a type so it prices, refunds and validates
 * through the same machinery every other placement uses — see `addCost` and
 * `removedValue`.
 */
export interface DugTile extends Placed {
  type: "dig";
}

/** What one tile of rock costs to take out, and gives back when filled in. */
export const DIG_COST = 6;

/** The id a tile always has, so digging the same tile twice is one entry. */
export function dugId(x: number, y: number): string {
  return `d${x},${y}`;
}

export function dugTile(x: number, y: number): DugTile {
  return { id: dugId(x, y), type: "dig", x, y };
}

/** Flat keys of everything that has been dug out, for cheap lookup. */
export function dugSet(arena: Arena, dug: DugTile[]): Set<number> {
  const set = new Set<number>();
  for (const tile of dug) {
    if (inArena(arena, tile.x, tile.y)) set.add(blockedKey(tile.x, tile.y, arena.w));
  }
  return set;
}

/**
 * What a walker cannot enter: everything that is still rock.
 *
 * The complement of the dug set rather than a list of blockers, which is the
 * whole shape of the change — there is no list of blockers any more.
 */
export function rockSet(arena: Arena, dug: DugTile[]): Set<number> {
  const open = dugSet(arena, dug);
  const set = new Set<number>();
  for (let y = 0; y < arena.h; y++) {
    for (let x = 0; x < arena.w; x++) {
      const key = blockedKey(x, y, arena.w);
      if (!open.has(key)) set.add(key);
    }
  }
  return set;
}

/**
 * The two tiles that are never rock.
 *
 * The door and the thing behind it are fixed points the whole game is measured
 * between; letting either be filled in would let a player wall the game shut
 * and then wonder why nothing happens.
 */
export function isFixed(arena: Arena, x: number, y: number): boolean {
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  return (x === entrance.x && y === entrance.y) || (x === core.x && y === core.y);
}

/**
 * Whether the door can still reach the core through what has been dug.
 *
 * A flood fill rather than a path search: the question is not how they get
 * there but whether the corridor is one piece, and a fill answers that for
 * every tile at once - which is also what makes it cheap enough to run on
 * every candidate fill before allowing it.
 */
export function connects(arena: Arena, dug: DugTile[]): boolean {
  const open = dugSet(arena, dug);
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  const from = blockedKey(entrance.x, entrance.y, arena.w);
  const goal = blockedKey(core.x, core.y, arena.w);
  if (!open.has(from) || !open.has(goal)) return false;

  const seen = new Set<number>([from]);
  const queue = [entrance];
  while (queue.length > 0) {
    const at = queue.pop()!;
    if (at.x === core.x && at.y === core.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      if (!inArena(arena, nx, ny)) continue;
      const key = blockedKey(nx, ny, arena.w);
      if (seen.has(key) || !open.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen.has(goal);
}

/**
 * The corridor a dungeon starts with: straight down the middle, door to core.
 *
 * Something has to be dug or there is no game to look at, and a straight line
 * is the honest starting point — it is the worst possible maze, and every
 * change the player makes to it is an improvement they can see.
 */
export function startingDig(arena: Arena): DugTile[] {
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  const tiles: DugTile[] = [];
  for (let y = entrance.y; y <= core.y; y++) tiles.push(dugTile(entrance.x, y));
  return tiles;
}

/**
 * An older dungeon, read as a carved one.
 *
 * The player's maze survives exactly: they had a field of floor with walls
 * standing on some of it, so the corridor they built is every tile that was
 * not a wall. Nobody loses the shape they made.
 */
export function digFromWalls(
  arena: Arena,
  walls: Array<{ x: number; y: number }>,
): DugTile[] {
  const blocked = new Set(walls.map((w) => blockedKey(w.x, w.y, arena.w)));
  const tiles: DugTile[] = [];
  for (let y = 0; y < arena.h; y++) {
    for (let x = 0; x < arena.w; x++) {
      if (!blocked.has(blockedKey(x, y, arena.w))) tiles.push(dugTile(x, y));
    }
  }
  return tiles;
}
