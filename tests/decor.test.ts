import { describe, expect, it } from "vitest";
import { arenaFor, blockedKey, coreOf, entranceOf, inArena } from "../src/game/arena";
import { decorBlocked, decorFor } from "../src/game/decor";
import { findPath } from "../src/game/sim/pathfinding";

/**
 * The rubble is terrain, and terrain has to hold up.
 *
 * The renderer draws it, the placement rules refuse it, the route preview
 * walks round it and the simulation blocks on it — four readers, one function,
 * and if it is not a pure function of the arena they disagree and the picture
 * stops matching the game.
 */

const LEVELS: Array<[string, string[]]> = [
  ["base", []],
  ["expand1", ["expand1"]],
  ["expand2", ["expand1", "expand2"]],
];

describe("the rubble a room comes with", () => {
  it("is the same room every time it is asked for", () => {
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      const entrance = entranceOf(arena);
      const core = coreOf(arena);

      const once = JSON.stringify(decorFor(arena, entrance, core));
      const twice = JSON.stringify(decorFor(arena, entrance, core));
      expect(twice, `${level} drifted between calls`).toBe(once);
    }
  });

  it("never stands on the entrance, the core, or the step in front of either", () => {
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      const entrance = entranceOf(arena);
      const core = coreOf(arena);
      const taken = decorBlocked(arena, entrance, core);

      const clear = [
        entrance,
        core,
        { x: entrance.x, y: entrance.y + 1 },
        { x: core.x, y: core.y - 1 },
      ];
      for (const tile of clear) {
        expect(
          taken.has(blockedKey(tile.x, tile.y, arena.w)),
          `${level}: (${tile.x}, ${tile.y}) was blocked`,
        ).toBe(false);
      }
    }
  });

  it("always leaves a way from the entrance to the core", () => {
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      const entrance = entranceOf(arena);
      const core = coreOf(arena);

      const route = findPath(arena, entrance, core, decorBlocked(arena, entrance, core));
      expect(route, `${level} sealed its own room`).not.toBeNull();
    }
  });

  it("stays inside the room", () => {
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      for (const prop of decorFor(arena, entranceOf(arena), coreOf(arena))) {
        expect(
          inArena(arena, prop.x, prop.y),
          `${level}: (${prop.x}, ${prop.y}) is outside`,
        ).toBe(true);
      }
    }
  });

  it("leaves most of the room to build in", () => {
    // A room that is mostly rubble is a room with no decisions left in it.
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      const count = decorFor(arena, entranceOf(arena), coreOf(arena)).length;
      const share = count / (arena.w * arena.h);
      expect(share, `${level} is ${Math.round(share * 100)}% rubble`).toBeLessThan(0.2);
      expect(count, `${level} has no rubble at all`).toBeGreaterThan(0);
    }
  });

  it("puts one prop on a tile, never two", () => {
    for (const [level, research] of LEVELS) {
      const arena = arenaFor(research);
      const props = decorFor(arena, entranceOf(arena), coreOf(arena));
      const tiles = new Set(props.map((p) => blockedKey(p.x, p.y, arena.w)));
      expect(tiles.size, `${level} stacked props`).toBe(props.length);
    }
  });
});
