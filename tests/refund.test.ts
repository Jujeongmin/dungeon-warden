import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFUND_RATE, addCost, removedValue } from "../src/game/placements";
import { MINION_COST, OBSTACLE_COST } from "../src/game/types";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

const wall = (id: string) => ({ id, type: "wall", x: 0, y: 0 });
const barricade = (id: string) => ({ id, type: "barricade", x: 0, y: 0 });

describe("taking something down", () => {
  it("pays back the same share the server pays", () => {
    expect(server).toContain(`const REFUND_RATE = ${REFUND_RATE};`);
  });

  it("cannot pay back more than it cost, at any price", () => {
    // The whole reason the rate is pinned: a refund above cost is an infinite
    // supply of gold in a build-and-sell loop, and the server mints.
    expect(REFUND_RATE).toBeLessThan(1);
    for (const price of Object.values({ ...OBSTACLE_COST, ...MINION_COST })) {
      expect(removedValue([], [{ id: "x", type: "t", x: 0, y: 0 }], { t: price }))
        .toBeLessThanOrEqual(price);
    }
  });

  it("gives back half of what was cleared", () => {
    const saved = [wall("o1"), barricade("o2")];
    expect(removedValue([], saved, OBSTACLE_COST)).toBe(
      Math.floor((OBSTACLE_COST.wall + OBSTACLE_COST.barricade) * REFUND_RATE),
    );
  });

  it("pays nothing for what is still standing", () => {
    const saved = [wall("o1")];
    expect(removedValue(saved, saved, OBSTACLE_COST)).toBe(0);
  });

  it("pays nothing for something that was never saved", () => {
    // Placed and cleared before a save: it was never charged, so there is
    // nothing to give back — the pending cost simply drops.
    expect(removedValue([], [], OBSTACLE_COST)).toBe(0);
    expect(addCost([wall("o1")], [], OBSTACLE_COST)).toBe(OBSTACLE_COST.wall);
    expect(addCost([], [], OBSTACLE_COST)).toBe(0);
  });

  it("treats an id reused for a different type as a sale and a purchase", () => {
    // Both sides have to agree, or the round trip settles at whatever the two
    // functions happen to disagree by.
    const saved = [wall("o1")];
    const next = [barricade("o1")];
    expect(addCost(next, saved, OBSTACLE_COST)).toBe(OBSTACLE_COST.barricade);
    expect(removedValue(next, saved, OBSTACLE_COST)).toBe(
      Math.floor(OBSTACLE_COST.wall * REFUND_RATE),
    );
  });

  it("loses money on a build-and-sell round trip, never makes it", () => {
    const built = addCost([wall("o1")], [], OBSTACLE_COST);
    const sold = removedValue([], [wall("o1")], OBSTACLE_COST);
    expect(sold).toBeLessThan(built);
    expect(built - sold).toBeGreaterThan(0);
  });

  it("nets one save's charges against its refunds", () => {
    // Swap a wall for a barricade in one save: pay for the new one, get half
    // the old one back, and settle the difference.
    const saved = [wall("o1")];
    const next = [barricade("o2")];
    const net =
      addCost(next, saved, OBSTACLE_COST) - removedValue(next, saved, OBSTACLE_COST);
    expect(net).toBe(
      OBSTACLE_COST.barricade - Math.floor(OBSTACLE_COST.wall * REFUND_RATE),
    );
  });
});
