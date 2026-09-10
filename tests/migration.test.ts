import { describe, expect, it } from "vitest";
import { arenaFor, coreOf, entranceOf, inArena } from "../src/game/arena";

/**
 * The rule the version 1 -> version 2 save migration rests on.
 *
 * `migrate()` in server.js carries an old save across by swapping x and y,
 * because version 1 was the same room in landscape: 12 tall and widening to
 * 16 and 20 with the expansion research, entrance on the left wall at
 * `(0, midY)` and core on the right at `(w - 1, midY)`.
 *
 * The server is a single file with no exports — it runs inside an isolated-vm
 * sandbox — so its `migrate` cannot be imported here. What can be pinned is
 * the correspondence the migration assumes between the two layouts. If anyone
 * changes `arenaFor`, `entranceOf` or `coreOf` in a way that breaks it, these
 * fail and say why, which is the warning the migration itself cannot give.
 */

const V1_HEIGHT = 12;
const V1_MID_Y = Math.floor(V1_HEIGHT / 2);
/** Version 1 widths, in the same order as the research that unlocked them. */
const V1_WIDTH: Record<string, number> = { none: 12, expand1: 16, expand2: 20 };

const RESEARCH: Array<[string, string[]]> = [
  ["none", []],
  ["expand1", ["expand1"]],
  ["expand2", ["expand1", "expand2"]],
];

const transpose = (p: { x: number; y: number }) => ({ x: p.y, y: p.x });

describe("version 1 to version 2 save migration", () => {
  it("turns each old board into the new one of the same size", () => {
    for (const [level, research] of RESEARCH) {
      const arena = arenaFor(research);
      // Old width becomes new height, old height becomes new width.
      expect(arena.h, `height at ${level}`).toBe(V1_WIDTH[level]);
      expect(arena.w, `width at ${level}`).toBe(V1_HEIGHT);
    }
  });

  it("puts the old entrance and core where the new ones are", () => {
    for (const [level, research] of RESEARCH) {
      const arena = arenaFor(research);
      const oldEntrance = { x: 0, y: V1_MID_Y };
      const oldCore = { x: V1_WIDTH[level] - 1, y: V1_MID_Y };

      expect(transpose(oldEntrance), `entrance at ${level}`).toEqual(entranceOf(arena));
      expect(transpose(oldCore), `core at ${level}`).toEqual(coreOf(arena));
    }
  });

  it("keeps every placement on the board, including the far column", () => {
    for (const [level, research] of RESEARCH) {
      const arena = arenaFor(research);
      const width = V1_WIDTH[level];

      for (let y = 0; y < V1_HEIGHT; y++) {
        for (let x = 0; x < width; x++) {
          const moved = transpose({ x, y });
          expect(
            inArena(arena, moved.x, moved.y),
            `(${x}, ${y}) at ${level} landed off the board`,
          ).toBe(true);
        }
      }
    }
  });

  it("would push an expanded save off the board without the swap", () => {
    // The failure this migration exists to prevent: a version 1 board expanded
    // to 20 wide has placements at x = 19, and the version 2 room is 12 wide.
    const arena = arenaFor(["expand1", "expand2"]);
    expect(inArena(arena, 19, 6)).toBe(false);
  });

  it("keeps a 2x2 room whole", () => {
    // Rooms are anchored at their top-left tile and cover a 2x2 block, so the
    // anchor has to stay at least one tile inside on both axes after the swap.
    const arena = arenaFor(["expand1", "expand2"]);
    const anchor = transpose({ x: V1_WIDTH.expand2 - 2, y: V1_HEIGHT - 2 });
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      expect(inArena(arena, anchor.x + dx, anchor.y + dy)).toBe(true);
    }
  });
});
