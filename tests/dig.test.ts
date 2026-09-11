import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import {
  DIG_COST,
  connects,
  digFromWalls,
  dugSet,
  dugTile,
  LOOSE_TILES,
  THIN_GARRISON,
  TIGHT_TILES,
  garrisonScale,
  isFixed,
  rockSet,
  startingDig,
} from "../src/game/dig";
import { buildRaidPath } from "../src/game/sim/pathfinding";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

/** The straight corridor a player cuts first, which the room no longer arrives with. */
function straightCorridor() {
  const tiles = [];
  for (let y = entrance.y; y <= core.y; y++) tiles.push(dugTile(entrance.x, y));
  return tiles;
}

describe("the room as carved rock", () => {
  it("charges what the server charges", () => {
    expect(server).toContain(`const DIG_COST = ${DIG_COST};`);
  });

  it("starts as the door, the core, and rock between them", () => {
    /*
     * The room used to arrive with the whole corridor already cut, which
     * handed the player the first and most defining move of the game - and
     * handed them a straight line, which is the worst maze there is.
     */
    const dug = startingDig(arena);
    expect(dug).toHaveLength(2);
    expect(connects(arena, dug)).toBe(false);
    const open = dugSet(arena, dug);
    expect(open.has(blockedKey(entrance.x, entrance.y, arena.w))).toBe(true);
    expect(open.has(blockedKey(core.x, core.y, arena.w))).toBe(true);
  });

  it("makes everything it did not dig into rock", () => {
    const dug = straightCorridor();
    const rock = rockSet(arena, dug);
    expect(rock.size).toBe(arena.w * arena.h - dug.length);
    expect(rock.has(blockedKey(entrance.x, entrance.y, arena.w))) .toBe(false);
    expect(rock.has(blockedKey(entrance.x + 1, entrance.y, arena.w))).toBe(true);
  });

  it("leaves the party exactly one way to walk", () => {
    /*
     * The reason for the whole change. A one-tile corridor has one route
     * through it, so the line the player is shown cannot bend for a reason
     * they cannot see — which is what it did across an open floor.
     */
    const dug = straightCorridor();
    const path = buildRaidPath(arena, entrance, core, [], rockSet(arena, dug));
    expect(path).not.toBeNull();
    expect(path!.every((step) => step.x === entrance.x)).toBe(true);
    expect(path!).toHaveLength(dug.length);
  });

  it("routes through a bend the player dug, and only through it", () => {
    // An L: down the middle, across, then down again.
    const dug = [
      ...Array.from({ length: 4 }, (_, y) => dugTile(entrance.x, y)),
      ...Array.from({ length: 3 }, (_, i) => dugTile(entrance.x + i + 1, 3)),
      ...Array.from({ length: core.y - 3 }, (_, i) => dugTile(entrance.x + 3, 4 + i)),
      ...Array.from({ length: 3 }, (_, i) => dugTile(entrance.x + 2 - i, core.y)),
    ];
    expect(connects(arena, dug)).toBe(true);
    const path = buildRaidPath(arena, entrance, core, [], rockSet(arena, dug));
    expect(path).not.toBeNull();
    // Every step of the route is a tile somebody chose to dig.
    const open = dugSet(arena, dug);
    expect(path!.every((step) => open.has(blockedKey(step.x, step.y, arena.w)))).toBe(true);
  });
});

describe("connectedness", () => {
  it("holds while the corridor is one piece", () => {
    expect(connects(arena, straightCorridor())).toBe(true);
  });

  it("breaks the moment the corridor is cut in two", () => {
    const dug = straightCorridor().filter((tile) => tile.y !== 5);
    expect(connects(arena, dug)).toBe(false);
  });

  it("is false when the door or the core was never dug", () => {
    expect(connects(arena, straightCorridor().filter((t) => t.y !== entrance.y))).toBe(false);
    expect(connects(arena, straightCorridor().filter((t) => t.y !== core.y))).toBe(false);
    expect(connects(arena, [])).toBe(false);
  });

  it("does not care about tiles that are open but not joined on", () => {
    // A pocket off to one side: dug, but no part of the way through.
    const dug = [...straightCorridor(), dugTile(0, 0), dugTile(1, 0)];
    expect(connects(arena, dug)).toBe(true);
  });
});

describe("the two fixed tiles", () => {
  it("are the door and the core, and nothing else", () => {
    expect(isFixed(arena, entrance.x, entrance.y)).toBe(true);
    expect(isFixed(arena, core.x, core.y)).toBe(true);
    expect(isFixed(arena, entrance.x + 1, entrance.y)).toBe(false);
  });
});

describe("reading an older dungeon", () => {
  it("keeps the maze its owner built, tile for tile", () => {
    /*
     * They had a field of floor with walls standing on some of it, so the
     * corridor they built is every tile that was not a wall. Nobody logs in
     * to a dungeon they do not recognise.
     */
    const walls = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 7 }];
    const dug = digFromWalls(arena, walls);
    expect(dug).toHaveLength(arena.w * arena.h - walls.length);

    const open = dugSet(arena, dug);
    for (const wall of walls) {
      expect(open.has(blockedKey(wall.x, wall.y, arena.w))).toBe(false);
    }
    expect(connects(arena, dug)).toBe(true);
  });

  it("hands a dungeon that never built anything the straight corridor", () => {
    // digFromWalls on an empty wall list would open the entire room, which is
    // not a maze — the caller uses startingDig for that case instead.
    expect(straightCorridor().length).toBeLessThan(digFromWalls(arena, []).length);
  });
});

describe("how thin the garrison is spread", () => {
  it("costs nothing while the dungeon is tight", () => {
    // Every number measured against the old open-floor model was measured at
    // this end of the curve, so this end has to stay worth exactly 1.
    expect(garrisonScale(0)).toBe(1);
    expect(garrisonScale(straightCorridor().length)).toBe(1);
    expect(garrisonScale(TIGHT_TILES)).toBe(1);
  });

  it("slides down as the corridor sprawls, and stops", () => {
    expect(garrisonScale(TIGHT_TILES + 1)).toBeLessThan(1);
    expect(garrisonScale(LOOSE_TILES)).toBeCloseTo(THIN_GARRISON, 5);
    // Weakened, never disarmed: a big dungeon is still a dungeon.
    expect(garrisonScale(arena.w * arena.h)).toBeCloseTo(THIN_GARRISON, 5);
    expect(garrisonScale(10_000)).toBeCloseTo(THIN_GARRISON, 5);
  });

  it("never rewards digging more", () => {
    let last = garrisonScale(0);
    for (let tiles = 1; tiles <= arena.w * arena.h; tiles++) {
      const now = garrisonScale(tiles);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });

  it("halves the distance at the halfway point, so the slide is readable", () => {
    const middle = (TIGHT_TILES + LOOSE_TILES) / 2;
    expect(garrisonScale(middle)).toBeCloseTo(1 - (1 - THIN_GARRISON) / 2, 5);
  });

  it("gives the tutorial's dungeon the strength it was measured with", () => {
    // The opening digs two nooks off the starting corridor. If that landed on
    // the slide, the balance the tutorial test pins would quietly move.
    expect(garrisonScale(straightCorridor().length + 2)).toBe(1);
  });
});
