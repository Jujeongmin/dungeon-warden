import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RaidSim, WARDEN_MIGHT } from "../src/game/sim/RaidSim";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import {
  WARDEN_LEVEL_DOWNS,
  WARDEN_MAX_LEVEL,
  wardenGuardScale,
  wardenLevel,
  wardenMightScale,
} from "../src/game/warden";
import type { PartyMember } from "../src/game/types";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * The warden growing by what it puts down itself.
 *
 * One lifetime count on the server, a handful of levels on the client, and a
 * body that gets a little heavier with each - never enough to be worth more
 * than building well.
 */

describe("the warden's level", () => {
  it("starts at 1 and steps at each threshold", () => {
    expect(wardenLevel(0)).toBe(1);
    expect(wardenLevel(WARDEN_LEVEL_DOWNS[0] - 1)).toBe(1);
    expect(wardenLevel(WARDEN_LEVEL_DOWNS[0])).toBe(2);
    expect(wardenLevel(10_000)).toBe(WARDEN_MAX_LEVEL);
  });

  it("weights the ridden body a little, and no further past the top", () => {
    expect(wardenMightScale(1)).toBe(1);
    expect(wardenGuardScale(1)).toBe(1);
    expect(wardenMightScale(WARDEN_MAX_LEVEL)).toBeGreaterThan(1);
    expect(wardenMightScale(WARDEN_MAX_LEVEL)).toBeLessThanOrEqual(1.2);
    expect(wardenGuardScale(WARDEN_MAX_LEVEL)).toBeLessThan(1);
    expect(wardenGuardScale(WARDEN_MAX_LEVEL)).toBeGreaterThanOrEqual(0.85);
    expect(wardenMightScale(99)).toBe(wardenMightScale(WARDEN_MAX_LEVEL));
  });

  it("is counted by the server from the same downs it pays for", () => {
    expect(server).toContain("dungeon.wardenDowns = (dungeon.wardenDowns || 0) + wardenDowns;");
    expect(server).toContain("wardenDownsTotal: dungeon.wardenDowns,");
  });
});

describe("a levelled warden in a body", () => {
  const arena = arenaFor([]);
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

  /** One swing from a body walled in beside the road, at the warden's level. */
  function swingAt(level: number): number {
    const at = { x: entrance.x + 2, y: entrance.y + 5 };
    const rock = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) if (dx || dy) rock.add(blockedKey(at.x + dx, at.y + dy, arena.w));
    }
    const sim = new RaidSim({
      minions: [{ id: "m1", type: "warrior", x: at.x, y: at.y }],
      traps: [],
      terrain: rock,
      party,
      arena,
      entrance,
      core,
      lures: [],
      seed: 1,
      wardenLevel: level,
    });
    sim.possess("m1");
    for (let i = 0; i < 20 * 30; i++) {
      sim.setControl({ x: 0, y: 0, facing: 0 });
      const a = sim.state.adventurers[0];
      if (a.spawned && Math.abs(a.y - at.y) < 0.5) break;
      sim.step();
    }
    const before = sim.state.adventurers[0].hp;
    sim.requestAttack();
    sim.step();
    return before - sim.state.adventurers[0].hp;
  }

  it("hits with the base weight at level 1, and harder at the top", () => {
    expect(swingAt(1)).toBeCloseTo(MINION_STATS.warrior.damage * WARDEN_MIGHT, 5);
    expect(swingAt(WARDEN_MAX_LEVEL)).toBeCloseTo(
      MINION_STATS.warrior.damage * WARDEN_MIGHT * wardenMightScale(WARDEN_MAX_LEVEL),
      5,
    );
  });
});
