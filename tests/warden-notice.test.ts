import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT, WARDEN_NOTICE_RADIUS, type SimEvent } from "../src/game/sim/RaidSim";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import type { PartyMember, PlacedMinion } from "../src/game/types";

/**
 * The party knowing the warden when it sees it.
 *
 * An adventurer turns on a minion only once that minion has hurt it, and only
 * on the first one that did. The body the warden is riding is the exception:
 * come near enough and the party goes for it on sight, dropping whatever else
 * it was after - unless there is no way to reach it at all.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);
const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

const warrior = (id: string, x: number, y: number): PlacedMinion => ({ id, type: "warrior", x, y });

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

/** Steps with the ridden body held still, stopping early once `until` holds. */
function run(sim: RaidSim, seconds: number, until?: () => boolean): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    if (sim.state.status !== "running") break;
    if (sim.state.possessedId) sim.setControl({ x: 0, y: 0, facing: 0 });
    sim.step();
    events.push(...sim.drainEvents());
    if (until?.()) break;
  }
  return events;
}

const hunting = (sim: RaidSim) => sim.state.adventurers[0].hunting;
const noticed = (events: SimEvent[]) => events.filter((e) => e.kind === "noticed" && e.targetId === "a1");

// Three tiles off the road: past a warrior's reach, inside the notice.
const aside = { x: entrance.x + 3, y: entrance.y + 5 };

describe("the party seeing the warden", () => {
  it("is set up past a warrior's reach and inside the notice", () => {
    expect(3).toBeGreaterThan(MINION_STATS.warrior.range);
    expect(3).toBeLessThanOrEqual(WARDEN_NOTICE_RADIUS);
  });

  it("turns on a ridden body it passes, before that body has struck", () => {
    const sim = makeSim([warrior("m1", aside.x, aside.y)]);
    sim.possess("m1");

    const events = run(sim, 30, () => hunting(sim) === "m1");

    expect(hunting(sim)).toBe("m1");
    expect(noticed(events)).toHaveLength(1);
    // Never swung: the only thing that drew it was being the warden.
    expect(sim.state.adventurers[0].hp).toBe(sim.state.adventurers[0].maxHp);
  });

  it("says so once, not every time it looks", () => {
    const sim = makeSim([warrior("m1", aside.x, aside.y)]);
    sim.possess("m1");
    const events = run(sim, 20);
    expect(noticed(events)).toHaveLength(1);
  });

  it("walks past the same minion left to itself", () => {
    const sim = makeSim([warrior("m1", aside.x, aside.y)]);
    let everHunted = false;
    run(sim, 30, () => {
      if (hunting(sim) === "m1") everHunted = true;
      return false;
    });
    expect(everHunted).toBe(false);
    const body = sim.state.minions[0];
    expect(body.hp).toBe(body.maxHp);
  });

  it("drops what it was hunting for the warden", () => {
    // m2 is near enough to the road to shoot, so it is hunted first; chasing
    // it brings the party within sight of the ridden m1.
    const sim = makeSim([warrior("m1", entrance.x + 3, entrance.y + 5), warrior("m2", entrance.x + 2, entrance.y + 3)]);
    sim.possess("m1");

    run(sim, 30, () => hunting(sim) === "m2" || hunting(sim) === "m1");
    expect(hunting(sim)).toBe("m2");

    run(sim, 30, () => hunting(sim) === "m1");
    expect(hunting(sim)).toBe("m1");
  });

  it("leaves a ridden body alone when there is no way in to it", () => {
    const at = aside;
    const rock = [
      { x: at.x - 1, y: at.y },
      { x: at.x + 1, y: at.y },
      { x: at.x, y: at.y - 1 },
      { x: at.x, y: at.y + 1 },
      { x: at.x - 1, y: at.y - 1 },
      { x: at.x + 1, y: at.y - 1 },
      { x: at.x - 1, y: at.y + 1 },
      { x: at.x + 1, y: at.y + 1 },
    ];
    const sim = makeSim([warrior("m1", at.x, at.y)], rock);
    sim.possess("m1");

    let everHunted = false;
    const events = run(sim, 30, () => {
      if (hunting(sim) === "m1") everHunted = true;
      return false;
    });

    expect(everHunted).toBe(false);
    expect(noticed(events)).toHaveLength(0);
  });
});
