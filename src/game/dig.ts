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

/**
 * What one tile of rock costs to take out, and gives back when filled in.
 *
 * Cheap, because it is the verb of the game and a new dungeon has to cut the
 * whole way from the door to the core before it can do anything else - ten
 * tiles at six put the opening two gold over what a dungeon starts with.
 */
export const DIG_COST = 5;

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
  return [dugTile(entrance.x, entrance.y), dugTile(core.x, core.y)];
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

/**
 * How far a corridor can sprawl before the garrison starts to thin out.
 *
 * Up to TIGHT tiles the dungeon is dense enough that nothing is lost; past
 * LOOSE it is stretched as thin as it will go. Between the two it slides.
 */
export const TIGHT_TILES = 24;
export const LOOSE_TILES = 72;

/** What a stretched garrison is worth at its weakest. */
export const THIN_GARRISON = 0.7;

/**
 * How much more room a deeper dungeon is allowed before it thins out.
 *
 * What the shop's deeper_dungeon sells. The only thing that has ever
 * limited digging is this - gold buys the tile, and sprawl costs the
 * garrison - so room to dig is the one thing left for that product to be.
 * It moves where thinning starts and where it bottoms out, so it buys a
 * bigger dungeon at the same strength rather than a stronger one.
 *
 * Not a win. Threat climbs with every raid repelled, so a player who digs
 * further settles at a higher threat against bigger parties - which is
 * what the rest of the shop already sells.
 */
export const DEEP_TILES = 24;

/**
 * What the garrison is worth at this size of dungeon.
 *
 * Digging used to be free of consequence: a longer corridor meant more time
 * under fire and cost nothing but gold, so there was never a reason to stop.
 * A dungeon that sprawls now spreads the same garrison over more ground and
 * each of them is weaker for it — which is the first time the shape of the
 * maze has been a choice rather than a budget.
 *
 * One-sided on purpose. A tight dungeon is worth exactly what it was worth
 * before this existed, so every number measured against the old model still
 * holds; it is sprawl that costs. Making tightness a bonus instead is one
 * constant away, and it is a balance decision rather than a design one.
 *
 * Bounded at both ends: a dungeon cannot be made arbitrarily strong by being
 * small, and one that has grown large is weakened, not disarmed.
 */
export function garrisonScale(dugTiles: number, roomier = false): number {
  const tight = TIGHT_TILES + (roomier ? DEEP_TILES : 0);
  const loose = LOOSE_TILES + (roomier ? DEEP_TILES : 0);

  if (dugTiles <= tight) return 1;
  if (dugTiles >= loose) return THIN_GARRISON;

  const across = (dugTiles - tight) / (loose - tight);
  return 1 - across * (1 - THIN_GARRISON);
}
