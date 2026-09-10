import { describe, expect, it } from "vitest";
import { arenaFor, blockedSet, coreOf, entranceOf } from "../src/game/arena";
import { buildRaidPath, findPath } from "../src/game/sim/pathfinding";

const arena = arenaFor([]);

describe("arena", () => {
  it("is 12x12 with no research and grows with it", () => {
    expect(arenaFor([])).toEqual({ w: 12, h: 12 });
    expect(arenaFor(["expand1"])).toEqual({ w: 12, h: 16 });
    expect(arenaFor(["expand1", "expand2"])).toEqual({ w: 12, h: 20 });
  });

  it("puts the entrance and core on opposite edges", () => {
    expect(entranceOf(arena)).toEqual({ x: 6, y: 0 });
    expect(coreOf(arena)).toEqual({ x: 6, y: 11 });
  });
});

describe("findPath", () => {
  it("walks straight down an empty room", () => {
    const path = findPath(arena, entranceOf(arena), coreOf(arena), new Set());
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 6, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 6, y: 11 });
    expect(path!.length).toBe(12);
  });

  it("detours around a blocking wall however long the detour is", () => {
    // A full-width wall at y=5 with one gap at the left edge.
    const wall = [];
    for (let x = 1; x < 12; x++) wall.push({ x, y: 5 });
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 0 && p.y === 5)).toBe(true);
    expect(path!.length).toBeGreaterThan(12);
  });

  it("returns null when the room is sealed", () => {
    const wall = [];
    for (let x = 0; x < 12; x++) wall.push({ x, y: 5 });
    expect(findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall))).toBeNull();
  });

  it("never routes through a blocked tile", () => {
    const blocked = blockedSet(arena, [{ x: 6, y: 3 }]);
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blocked);
    expect(path!.some((p) => p.x === 6 && p.y === 3)).toBe(false);
  });
});

describe("buildRaidPath", () => {
  it("detours through the nearest lure", () => {
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 2, y: 4 }], new Set());
    expect(path!.some((p) => p.x === 2 && p.y === 4)).toBe(true);
  });

  it("falls back to the direct route when no lure is reachable", () => {
    const box = [
      { x: 2, y: 3 }, { x: 2, y: 5 }, { x: 1, y: 4 }, { x: 3, y: 4 },
    ];
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 2, y: 4 }], blockedSet(arena, box));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 2 && p.y === 4)).toBe(false);
  });
});
