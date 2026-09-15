import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A raid walked away from costs what losing it costs.
 *
 * Closing the game mid-fight used to count a breach and lower threat, and
 * nothing else: no minion went down and no gold was taken, so a raid going
 * badly was one reload from costing nothing. server.js runs in a sandbox with
 * no exports, so these pin the source the way the other mirror tests do.
 */

// Line endings normalised: the checkout may be CRLF, and body() looks for a
// closing brace alone on its line.
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const server = lf(readFileSync(new URL("../server.js", import.meta.url), "utf8"));
const save = lf(readFileSync(new URL("../src/game/useDungeonSave.ts", import.meta.url), "utf8"));

/** The body of a top-level function in server.js, up to its closing brace. */
function body(name: string): string {
  const start = server.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = server.indexOf("\n}\n", start);
  return server.slice(start, end);
}

describe("a raid left open", () => {
  it("records who fought when it opens", () => {
    expect(server).toContain("minionIds: availableMinionIds,");
  });

  it("puts every minion that fought on the revive timer", () => {
    const abandon = body("abandonPendingRaid");
    expect(abandon).toContain("pending.minionIds");
    expect(abandon).toContain("revivesAt: now + downTime");
  });

  it("is plundered like a breach, but never under the floor and never topped up", () => {
    const settle = body("settleAbandonedRaid");
    expect(settle).toContain("RAID_PLUNDER_RATE * effects.plunderScale");
    expect(settle).toContain("RAID_PLUNDER_CAP");
    expect(settle).toContain("goldBefore - RELIEF_FLOOR");
    expect(settle).not.toContain("mint");
  });

  it("writes the save before the gold moves, so a retry cannot burn twice", () => {
    const settle = body("settleAbandonedRaid");
    const write = settle.indexOf("updateMyState({ dungeon, pendingRaid: null })");
    const burn = settle.indexOf('$asset.burn("gold"');
    expect(write).toBeGreaterThan(-1);
    expect(burn).toBeGreaterThan(write);
  });

  it("is settled when the game opens and when the next raid does", () => {
    expect(server).toContain("async loadGame({ settle } = {})");
    expect(server).toContain("settle ? await settleAbandonedRaid(");
    expect(server).toContain("const abandoned = await settleAbandonedRaid(state, now);");
  });

  it("is settled only by the load that opens the game, not a recovery reload mid-raid", () => {
    expect(save.split('remoteFunction("loadGame", [{ settle: true }])')).toHaveLength(2);
    expect(save).toContain('remoteFunction("loadGame", [])');
  });
});
