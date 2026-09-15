import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELIEF_FLOOR, isBroke, reliefFor } from "../src/game/relief";
import { MINION_COST } from "../src/game/types";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

/**
 * The floor a lost raid cannot push a dungeon under.
 *
 * Found by playing: a run of breaches took a test dungeon to no gold and a
 * garrison on revive timers, which is a game that has ended without saying
 * so. The floor is the smallest thing that gets a player moving again.
 */
describe("relief after a raid", () => {
  it("is enough to put one warrior back in the road", () => {
    expect(RELIEF_FLOOR).toBeGreaterThanOrEqual(MINION_COST.warrior);
  });

  it("tops a broke dungeon up to the floor", () => {
    expect(reliefFor(0, 0, 0)).toBe(RELIEF_FLOOR);
    expect(reliefFor(20, 8, 3)).toBe(RELIEF_FLOOR - 25);
  });

  it("pays nothing to a dungeon already above it", () => {
    expect(reliefFor(RELIEF_FLOOR, 0, 0)).toBe(0);
    expect(reliefFor(500, 35, 0)).toBe(0);
  });

  it("counts the plunder before deciding", () => {
    // Above the floor going in, under it once the raid has taken its share.
    expect(reliefFor(RELIEF_FLOOR + 5, 0, 15)).toBe(10);
  });

  it("is what the server pays", () => {
    expect(server).toContain(`const RELIEF_FLOOR = ${RELIEF_FLOOR};`);
  });
});

describe("a stuck dungeon", () => {
  const now = 1_000_000;

  it("is one with no gold for a warrior and nobody ready", () => {
    expect(isBroke(10, [{ revivesAt: now + 5000 }], now)).toBe(true);
    expect(isBroke(0, [], now)).toBe(true);
  });

  it("is not stuck while a minion can still fight", () => {
    expect(isBroke(0, [{ revivesAt: null }], now)).toBe(false);
    expect(isBroke(0, [{ revivesAt: now - 1 }], now)).toBe(false);
  });

  it("is not stuck while it can buy one", () => {
    expect(isBroke(MINION_COST.warrior, [], now)).toBe(false);
  });
});
