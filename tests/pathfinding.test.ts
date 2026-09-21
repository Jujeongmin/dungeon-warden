import { describe, expect, it } from "vitest";
import { blockedSet, coreOf, entranceOf, type Arena } from "../src/game/arena";
import { findPath } from "../src/game/sim/pathfinding";

const arena: Arena = { w: 12, h: 12 };

describe("arena", () => {
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
