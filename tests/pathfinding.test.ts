import { describe, expect, it } from "vitest";
import { arenaFor, blockedSet, coreOf, entranceOf } from "../src/game/arena";
import { buildRaidPath, findPath } from "../src/game/sim/pathfinding";

const arena = arenaFor([]);

describe("arena", () => {
  it("is 12x12 with no research and grows with it", () => {
    expect(arenaFor([])).toEqual({ w: 12, h: 12 });
    expect(arenaFor(["expand1"])).toEqual({ w: 16, h: 12 });
    expect(arenaFor(["expand1", "expand2"])).toEqual({ w: 20, h: 12 });
  });

  it("puts the entrance and core on opposite edges", () => {
    expect(entranceOf(arena)).toEqual({ x: 0, y: 6 });
    expect(coreOf(arena)).toEqual({ x: 11, y: 6 });
  });
});

describe("findPath", () => {
  it("walks straight across an empty room", () => {
    const path = findPath(arena, entranceOf(arena), coreOf(arena), new Set());
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 6 });
    expect(path![path!.length - 1]).toEqual({ x: 11, y: 6 });
    expect(path!.length).toBe(12);
  });

  it("detours around a blocking wall however long the detour is", () => {
    // A full-height wall at x=5 with one gap at the top edge.
    const wall = [];
    for (let y = 1; y < 12; y++) wall.push({ x: 5, y });
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 5 && p.y === 0)).toBe(true);
    expect(path!.length).toBeGreaterThan(12);
  });

  it("returns null when the room is sealed", () => {
    const wall = [];
    for (let y = 0; y < 12; y++) wall.push({ x: 5, y });
    expect(findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall))).toBeNull();
  });

  it("never routes through a blocked tile", () => {
    const blocked = blockedSet(arena, [{ x: 3, y: 6 }]);
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blocked);
    expect(path!.some((p) => p.x === 3 && p.y === 6)).toBe(false);
  });
});

describe("buildRaidPath", () => {
  it("detours through the nearest lure", () => {
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 4, y: 2 }], new Set());
    expect(path!.some((p) => p.x === 4 && p.y === 2)).toBe(true);
  });

  it("falls back to the direct route when no lure is reachable", () => {
    const box = [
      { x: 3, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 1 }, { x: 4, y: 3 },
    ];
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 4, y: 2 }], blockedSet(arena, box));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 4 && p.y === 2)).toBe(false);
  });
});
