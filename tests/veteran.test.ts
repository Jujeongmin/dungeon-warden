import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MINION_STATS, minionStatsFor } from "../src/game/sim/units";
import {
  VETERAN_MAX_RANK,
  VETERAN_RAIDS,
  veteranHpScale,
  veteranRank,
} from "../src/game/veteran";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * A minion that has lived through raids.
 *
 * Counted by the server, a star at each threshold, and harder to put down for
 * it - only that, and only a little.
 */
describe("a veteran minion", () => {
  it("earns a star at each threshold, and no more past the last", () => {
    expect(veteranRank(0)).toBe(0);
    expect(veteranRank(VETERAN_RAIDS[0] - 1)).toBe(0);
    expect(veteranRank(VETERAN_RAIDS[0])).toBe(1);
    expect(veteranRank(1000)).toBe(VETERAN_MAX_RANK);
  });

  it("is tougher, and only tougher", () => {
    const green = minionStatsFor({ type: "warrior" });
    const old = minionStatsFor({ type: "warrior", veteran: 1000 });
    expect(green).toEqual(MINION_STATS.warrior);
    expect(old.hp).toBe(Math.round(MINION_STATS.warrior.hp * veteranHpScale(VETERAN_MAX_RANK)));
    expect(old.damage).toBe(green.damage);
    expect(old.range).toBe(green.range);
    expect(old.attackInterval).toBe(green.attackInterval);
  });

  it("stays a small bonus", () => {
    expect(veteranHpScale(VETERAN_MAX_RANK)).toBeLessThanOrEqual(1.3);
  });

  it("is seasoned by the server, for raids it sent the minion into and saw it survive", () => {
    expect(server).toContain("veteran: (minion.veteran || 0) + 1");
    expect(server).toContain("const fielded = Array.isArray(pending.minionIds) ? pending.minionIds : [];");
  });

  it("keeps the server's count when the client saves", () => {
    expect(server).toContain("veteran: stored.veteran || 0,");
  });
});
