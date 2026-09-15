import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WARDEN_BONUS_PER_DOWN, creditedDowns } from "../src/game/wardenBonus";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

/**
 * The warden's own share of a raid.
 *
 * Small on purpose, and only for downs that actually ended somewhere: a knock
 * that the adventurer got up from earned the dungeon nothing.
 */
describe("the warden's bonus", () => {
  it("credits a down that ended in a kill or a capture", () => {
    expect(creditedDowns(["a1", "a2"], ["a1"], ["a2"])).toEqual(["a1", "a2"]);
  });

  it("does not credit a down the adventurer walked away from", () => {
    expect(creditedDowns(["a1", "a3"], ["a1"], [])).toEqual(["a1"]);
  });

  it("counts the same adventurer once", () => {
    expect(creditedDowns(["a1", "a1"], ["a1"], [])).toEqual(["a1"]);
  });

  it("is worth less than killing them was anyway", () => {
    // RAID_REWARD_PER_KILL in server.js is what a kill pays the dungeon.
    const perKill = Number(server.match(/const RAID_REWARD_PER_KILL = (\d+);/)?.[1]);
    expect(WARDEN_BONUS_PER_DOWN).toBeLessThan(perKill);
  });

  it("is what the server pays", () => {
    expect(server).toContain(`const WARDEN_BONUS_PER_DOWN = ${WARDEN_BONUS_PER_DOWN};`);
  });
});
