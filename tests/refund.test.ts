import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFUND_RATE, addCost, removedValue } from "../src/game/placements";
import { DIG_COST } from "../src/game/dig";
import { MINION_COST, TRAP_COST } from "../src/game/types";

/** What the player can put down and take up again, priced in one table. */
const COST = { ...MINION_COST, ...TRAP_COST, dig: DIG_COST };

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

const warrior = (id: string) => ({ id, type: "warrior", x: 0, y: 0 });
const mage = (id: string) => ({ id, type: "mage", x: 0, y: 0 });

describe("taking something down", () => {
  it("pays back the same share the server pays", () => {
    expect(server).toContain(`const REFUND_RATE = ${REFUND_RATE};`);
  });

  it("cannot pay back more than it cost, at any price", () => {
    // The whole reason the rate is pinned: a refund above cost is an infinite
    // supply of gold in a build-and-sell loop, and the server mints. At
    // exactly one the loop nets zero, which is the line, not over it.
    expect(REFUND_RATE).toBeLessThanOrEqual(1);
    for (const price of Object.values(COST)) {
      expect(removedValue([], [{ id: "x", type: "t", x: 0, y: 0 }], { t: price }))
        .toBeLessThanOrEqual(price);
    }
  });

  it("gives back what was paid for whatever was cleared", () => {
    const saved = [warrior("m1"), mage("m2")];
    expect(removedValue([], saved, COST)).toBe(
      Math.floor((COST.warrior + COST.mage) * REFUND_RATE),
    );
  });

  it("pays nothing for what is still standing", () => {
    const saved = [warrior("m1")];
    expect(removedValue(saved, saved, COST)).toBe(0);
  });

  it("pays nothing for something that was never saved", () => {
    // Placed and cleared before a save: it was never charged, so there is
    // nothing to give back — the pending cost simply drops.
    expect(removedValue([], [], COST)).toBe(0);
    expect(addCost([warrior("m1")], [], COST)).toBe(COST.warrior);
    expect(addCost([], [], COST)).toBe(0);
  });

  it("treats an id reused for a different type as a sale and a purchase", () => {
    // Both sides have to agree, or the round trip settles at whatever the two
    // functions happen to disagree by.
    const saved = [warrior("m1")];
    const next = [mage("m1")];
    expect(addCost(next, saved, COST)).toBe(COST.mage);
    expect(removedValue(next, saved, COST)).toBe(
      Math.floor(COST.warrior * REFUND_RATE),
    );
  });

  it("settles a place-then-clear round trip at exactly nothing", () => {
    // The design decision, not just the safety bound: digging a tile and
    // filling it back in leaves the player exactly where they started, so
    // reshaping the maze after a raid is free and only new ground costs.
    const built = addCost([{ id: "d1", type: "dig", x: 0, y: 0 }], [], COST);
    const sold = removedValue([], [{ id: "d1", type: "dig", x: 0, y: 0 }], COST);
    expect(built - sold).toBe(0);
  });

  it("never makes money on a build-and-sell round trip", () => {
    const built = addCost([warrior("m1")], [], COST);
    const sold = removedValue([], [warrior("m1")], COST);
    expect(sold).toBeLessThanOrEqual(built);
  });

  it("nets one save's charges against its refunds", () => {
    // Swap a warrior for a mage in one save: pay for the new one, get the old
    // one back, and settle the difference.
    const saved = [warrior("m1")];
    const next = [mage("m2")];
    const net = addCost(next, saved, COST) - removedValue(next, saved, COST);
    expect(net).toBe(COST.mage - Math.floor(COST.warrior * REFUND_RATE));
  });
});
