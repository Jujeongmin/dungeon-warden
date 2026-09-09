import { describe, expect, it } from "vitest";
import { OBSTACLE_COST, maxObstaclesFor, BASE_MAX_OBSTACLES } from "../src/game/types";
import { OBSTACLE_STATS } from "../src/game/sim/obstacles";
import { addCost } from "../src/game/placements";

describe("obstacle data", () => {
  it("prices a barricade below a wall", () => {
    expect(OBSTACLE_COST.barricade).toBe(12);
    expect(OBSTACLE_COST.wall).toBe(35);
  });

  it("gives a wall more hit points than a barricade", () => {
    expect(OBSTACLE_STATS.barricade.hp).toBe(120);
    expect(OBSTACLE_STATS.wall.hp).toBe(380);
  });

  it("raises the budget with the expansion research", () => {
    expect(BASE_MAX_OBSTACLES).toBe(20);
    expect(maxObstaclesFor([])).toBe(20);
    expect(maxObstaclesFor(["expand1"])).toBe(28);
    expect(maxObstaclesFor(["expand1", "expand2"])).toBe(36);
  });

  it("charges only for obstacles that are new or changed type", () => {
    const saved = [{ id: "o1", type: "barricade", x: 1, y: 1 }];
    const next = [
      { id: "o1", type: "wall", x: 1, y: 1 },
      { id: "o2", type: "barricade", x: 2, y: 1 },
    ];
    expect(addCost(next, saved, OBSTACLE_COST)).toBe(35 + 12);
    expect(addCost(saved, saved, OBSTACLE_COST)).toBe(0);
  });
});
