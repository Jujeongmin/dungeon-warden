import { describe, expect, it } from "vitest";
import {
  BLAST_MULTIPLIER,
  RaidSim,
  SHOVE_COOLDOWN,
  SIM_DT,
  WARDEN_MIGHT,
} from "../src/game/sim/RaidSim";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import type { MinionType, PartyMember } from "../src/game/types";

/**
 * Each body's own skill, used from inside it.
 *
 * A warrior shoves what it hits back along its road; a mage blasts it. Both
 * are the ridden body's alone, both wait between uses, and neither spends
 * that wait on a skill with nothing in reach.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);
const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

/**
 * A body beside the road, ridden, with the first adventurer walked level with it.
 *
 * Walled in by rock on every side: the party turns on a ridden body it can
 * reach (see warden-notice.test.ts), and these tests are about what the skill
 * does to someone walking past, not about a fight that comes to the body.
 */
function riddenBesideTheRoad(type: MinionType, aside = 2) {
  const at = { x: entrance.x + aside, y: entrance.y + 5 };
  const rock = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) rock.add(blockedKey(at.x + dx, at.y + dy, arena.w));
    }
  }
  const sim = new RaidSim({
    minions: [{ id: "m1", type, x: at.x, y: at.y }],
    traps: [],
    terrain: rock,
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
  sim.possess("m1");
  for (let i = 0; i < 20 * 30; i++) {
    sim.setControl({ x: 0, y: 0, facing: 0 });
    const adventurer = sim.state.adventurers[0];
    if (adventurer.spawned && Math.abs(adventurer.y - (entrance.y + 5)) < 0.5) break;
    sim.step();
  }
  return sim;
}

describe("a warrior's shove", () => {
  it("puts what it hits back along its road, towards the door", () => {
    const sim = riddenBesideTheRoad("warrior");
    const before = { ...sim.state.adventurers[0] };

    sim.requestSkill();
    sim.step();

    const after = sim.state.adventurers[0];
    expect(after.y).toBeLessThan(before.y);
    // Onto a tile of its own route, which it has already stood on.
    expect(after.path[after.pathIndex]).toMatchObject({ x: after.x, y: after.y });
  });

  it("waits before it can shove again", () => {
    const sim = riddenBesideTheRoad("warrior");
    sim.requestSkill();
    sim.step();
    const once = sim.state.adventurers[0].y;

    sim.requestSkill();
    sim.step();

    expect(sim.state.possessedSkill).toBeGreaterThan(SHOVE_COOLDOWN - 3 * SIM_DT);
    // Not thrown back a second time: one step of walking at most.
    expect(sim.state.adventurers[0].y).toBeGreaterThanOrEqual(once);
  });

  it("spends nothing on a shove with nobody in reach", () => {
    const sim = new RaidSim({
      minions: [{ id: "m1", type: "warrior", x: core.x, y: core.y - 1 }],
      traps: [],
      terrain: new Set<number>(),
      party,
      arena,
      entrance,
      core,
      lures: [],
      seed: 1,
    });
    sim.possess("m1");
    sim.requestSkill();
    sim.step();
    expect(sim.state.possessedSkill).toBe(0);
  });
});

describe("a mage's blast", () => {
  it("is one blow worth several", () => {
    const sim = riddenBesideTheRoad("mage", 2);
    const before = sim.state.adventurers[0].hp;

    sim.requestSkill();
    sim.step();

    expect(before - sim.state.adventurers[0].hp).toBeCloseTo(
      MINION_STATS.mage.damage * WARDEN_MIGHT * BLAST_MULTIPLIER,
      5,
    );
  });
});

describe("a skill with nobody riding", () => {
  it("does nothing", () => {
    const sim = riddenBesideTheRoad("warrior");
    sim.release();
    const before = { ...sim.state.adventurers[0] };

    sim.requestSkill();
    sim.step();

    expect(sim.state.possessedSkill).toBe(0);
    expect(sim.state.adventurers[0].y).toBeGreaterThanOrEqual(before.y);
  });
});
