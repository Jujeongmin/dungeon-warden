import { describe, expect, it } from "vitest";
import { MILESTONES, tierFor } from "../src/game/milestones";

/**
 * The only measure of progress this game has.
 *
 * There are no stages and no last wave, so the threat number is the whole
 * scoreboard — and these names are what turn it into something a player can
 * say out loud. The thresholds are pinned because they are not decoration:
 * they sit where the server's pickParty changes what it sends.
 */
describe("threat tiers", () => {
  it("names nothing before the first threshold", () => {
    expect(tierFor(0)).toBeNull();
    expect(tierFor(MILESTONES[0].threat - 1)).toBeNull();
  });

  it("names each tier from its own threshold", () => {
    for (const milestone of MILESTONES) {
      expect(tierFor(milestone.threat)?.label).toBe(milestone.label);
    }
  });

  it("keeps the highest tier reached, not the nearest", () => {
    const last = MILESTONES[MILESTONES.length - 1];
    expect(tierFor(last.threat + 50)?.label).toBe(last.label);
  });

  it("rises, never falls, as thresholds are listed", () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].threat).toBeGreaterThan(MILESTONES[i - 1].threat);
    }
  });

  it("matches the thresholds server.js uses", () => {
    // Mirrored by hand — server.js cannot be imported, it runs in isolated-vm.
    expect(MILESTONES.map((m) => [m.threat, m.label])).toEqual([
      [3, "tier_scouts"],
      [9, "tier_company"],
      [20, "tier_crusade"],
    ]);
  });
});
