import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import type { PartyMember, PlacedMinion } from "../src/game/types";

/**
 * The warden climbing into one of its own minions.
 *
 * The rule the whole feature rests on: a ridden body is still a minion. It
 * has the stats it was bought with, it stands where a minion may stand, it is
 * fought when it blocks the road, and when it dies the warden is put back on
 * the board with nothing to show for it. The only two things it gains are the
 * two a placed minion has never had - it walks, and it swings when told.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

function makeSim(minions: PlacedMinion[], rock: Array<{ x: number; y: number }> = []) {
  return new RaidSim({
    minions,
    traps: [],
    terrain: new Set(rock.map((t) => blockedKey(t.x, t.y, arena.w))),
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
}

const minion = (id: string, x: number, y: number): PlacedMinion => ({
  id,
  type: "warrior",
  x,
  y,
});

/** Steps while holding one control input, the way a held key would. */
function drive(
  sim: RaidSim,
  seconds: number,
  input: { x: number; y: number; facing?: number },
) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (sim.state.status !== "running") break;
    sim.setControl({ x: input.x, y: input.y, facing: input.facing ?? 0 });
    sim.step();
  }
}

describe("taking a body", () => {
  it("takes a living minion of its own", () => {
    const sim = makeSim([minion("m1", core.x, core.y - 2)]);
    expect(sim.possess("m1")).toBe(true);
    expect(sim.possessed?.id).toBe("m1");
    expect(sim.state.possessedId).toBe("m1");
  });

  it("refuses a body that is not there", () => {
    const sim = makeSim([minion("m1", core.x, core.y - 2)]);
    expect(sim.possess("nobody")).toBe(false);
    expect(sim.state.possessedId).toBe(null);
  });

  it("gives the body back", () => {
    const sim = makeSim([minion("m1", core.x, core.y - 2)]);
    sim.possess("m1");
    sim.release();
    expect(sim.state.possessedId).toBe(null);
    expect(sim.possessed).toBe(null);
  });
});

describe("walking a body", () => {
  it("moves it under the control it is given", () => {
    const start = { x: core.x, y: core.y - 2 };
    const sim = makeSim([minion("m1", start.x, start.y)]);
    sim.possess("m1");

    drive(sim, 1, { x: 0, y: -1 });

    const body = sim.possessed!;
    expect(body.y).toBeLessThan(start.y - 2);
    expect(body.x).toBeCloseTo(start.x, 5);
  });

  it("leaves it where it stands when nothing is pressed", () => {
    const start = { x: core.x, y: core.y - 2 };
    const sim = makeSim([minion("m1", start.x, start.y)]);
    sim.possess("m1");

    drive(sim, 1, { x: 0, y: 0 });

    expect(sim.possessed!.x).toBeCloseTo(start.x, 5);
    expect(sim.possessed!.y).toBeCloseTo(start.y, 5);
  });

  it("does not walk into rock", () => {
    // A wall one tile north, and a body told to walk north for a full second.
    const start = { x: core.x, y: core.y - 2 };
    const sim = makeSim([minion("m1", start.x, start.y)], [{ x: start.x, y: start.y - 1 }]);
    sim.possess("m1");

    drive(sim, 1, { x: 0, y: -1 });

    // Still on its own tile: the tile it was pushed at is not standable.
    expect(Math.round(sim.possessed!.y)).toBe(start.y);
  });

  it("stops moving the moment the warden lets go", () => {
    const start = { x: core.x, y: core.y - 2 };
    const sim = makeSim([minion("m1", start.x, start.y)]);
    sim.possess("m1");
    drive(sim, 0.5, { x: 0, y: -1 });
    const held = sim.possessed!.y;

    sim.release();
    // The released body is back on garrison duty, which is to stand still.
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.state.minions[0].y).toBeCloseTo(held, 5);
  });
});

/**
 * Beside the road rather than in it, so the body is not fought while the test
 * is about what it chooses to do. Steps until the first adventurer has walked
 * level with it, and leaves them standing there.
 */
function bodyBesideTheRoad() {
  const sim = makeSim([minion("m1", entrance.x + 1, entrance.y + 5)]);
  sim.possess("m1");
  for (let i = 0; i < 20 * 30; i++) {
    sim.setControl({ x: 0, y: 0, facing: 0 });
    const adventurer = sim.state.adventurers[0];
    if (adventurer.spawned && Math.abs(adventurer.y - (entrance.y + 5)) < 0.5) break;
    sim.step();
  }
  return sim;
}

describe("swinging a body", () => {
  it("hits nothing until it is told to", () => {
    // Well inside its own reach - 2.4 tiles - and never asked to swing. A
    // placed minion would have fired on its own several times over by now.
    const sim = bodyBesideTheRoad();
    for (let i = 0; i < 40; i++) {
      sim.setControl({ x: 0, y: 0, facing: 0 });
      sim.step();
    }

    const hurt = sim.state.adventurers.some((a) => a.hp < a.maxHp);
    expect(hurt).toBe(false);
  });

  it("hits what is in reach when it is", () => {
    const sim = bodyBesideTheRoad();
    const before = sim.state.adventurers[0].hp;

    sim.requestAttack();
    sim.step();

    expect(sim.state.adventurers[0].hp).toBe(before - MINION_STATS.warrior.damage);
  });

  it("spends the cooldown on a swing that connects with nothing", () => {
    // Alone at the core, nothing in reach, and one swing thrown anyway.
    const sim = makeSim([minion("m1", core.x, core.y - 1)]);
    sim.possess("m1");
    sim.requestAttack();
    sim.step();

    expect(sim.state.minions[0].cooldown).toBeGreaterThan(0);
  });
});

describe("losing a body", () => {
  it("puts the warden back on the board when the body dies", () => {
    // In the doorway, where the party walks into it, and never fighting back.
    const sim = makeSim([minion("m1", entrance.x, entrance.y + 1)]);
    sim.possess("m1");

    for (let i = 0; i < 20 * 120; i++) {
      if (!sim.state.minions[0].alive) break;
      sim.setControl({ x: 0, y: 0, facing: 0 });
      sim.step();
    }

    expect(sim.state.minions[0].alive).toBe(false);
    expect(sim.state.possessedId).toBe(null);
  });
});
