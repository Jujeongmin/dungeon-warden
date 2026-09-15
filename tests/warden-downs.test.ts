import { describe, expect, it } from "vitest";
import { RaidSim } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember } from "../src/game/types";

/**
 * Who gets the credit for an adventurer put down.
 *
 * The warden does, for a blow from the body it was riding - and only if that
 * down ends in a kill or a capture. A garrison left to fight on its own earns
 * the dungeon its usual payout and the warden nothing extra.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

// The frailest member of the roster, so one warrior standing in the road
// can finish the fight inside the test's time.
const party: PartyMember[] = [{ id: "a1", cls: "mage", name: "Ilse", level: 1 }];

/** One warrior in the road, a tile inside the door, swinging whenever it can. */
function fight(ridden: boolean) {
  const sim = new RaidSim({
    minions: [{ id: "m1", type: "warrior", x: entrance.x, y: entrance.y + 2 }],
    traps: [],
    terrain: new Set<number>(),
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
  if (ridden) sim.possess("m1");

  for (let i = 0; i < 20 * 120; i++) {
    if (sim.state.status !== "running") break;
    if (sim.state.killedIds.includes("a1") || sim.state.capturedIds.includes("a1")) break;
    if (ridden) {
      sim.setControl({ x: 0, y: 0, facing: 0 });
      sim.requestAttack();
    }
    sim.step();
  }
  return sim;
}

describe("the warden's downs", () => {
  it("credit an adventurer the ridden body put down and saw off", () => {
    const sim = fight(true);
    expect(sim.state.killedIds).toContain("a1");
    expect(sim.state.wardenDownIds).toEqual(["a1"]);
  });

  it("credit nothing when the garrison fought on its own", () => {
    const sim = fight(false);
    expect(sim.state.killedIds).toContain("a1");
    expect(sim.state.wardenDownIds).toEqual([]);
  });
});
