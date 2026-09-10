import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import type { PartyMember, PlacedMinion, PlacedObstacle } from "../src/game/types";

/**
 * The rule that decides what a minion is for.
 *
 * Adventurers are here for the core, not the garrison. They attack what stands
 * in their way and nothing else, so a minion beside the route shoots them the
 * whole way past untouched, and a minion in the route is a wall that shoots
 * back. Which of those the player is building is the decision the game is made
 * of, and it lives entirely in `blocked()` and `blockingTarget()`.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

function makeSim(minions: PlacedMinion[], obstacles: PlacedObstacle[] = []) {
  return new RaidSim({
    minions,
    traps: [],
    obstacles,
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
}

function run(sim: RaidSim, seconds: number) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (sim.state.status !== "running") break;
    sim.step();
  }
}

const minion = (id: string, x: number, y: number): PlacedMinion => ({
  id,
  type: "warrior",
  x,
  y,
});

describe("what an adventurer will and will not fight", () => {
  it("walks past a minion beside the route without hitting it", () => {
    // Two tiles off the straight line down the middle: close enough to shoot
    // into it, never standing in it.
    const guard = minion("m1", entrance.x + 2, 5);
    const sim = makeSim([guard]);
    run(sim, 40);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.alive).toBe(true);
    expect(after.hp).toBe(after.maxHp);
  });

  it("shoots from beside the route while being ignored", () => {
    const guard = minion("m1", entrance.x + 2, 5);
    const sim = makeSim([guard]);
    run(sim, 40);

    // It did its job: the party took damage from something it never fought.
    const adventurer = sim.state.adventurers.find((a) => a.id === "a1")!;
    expect(adventurer.hp).toBeLessThan(adventurer.maxHp);
  });

  it("reaches out of the corridor far enough to matter", () => {
    // The warrior's reach has to clear at least one tile of wall, or a minion
    // tucked behind the barricade it is guarding can never fire.
    expect(MINION_STATS.warrior.range).toBeGreaterThan(2);
    expect(MINION_STATS.mage.range).toBeGreaterThan(MINION_STATS.warrior.range);
  });

  it("fights a minion that is the only way through", () => {
    // Seal the room with walls but leave one tile, and stand a minion in it.
    // Now there is no route at all, so the minion is what gets hit.
    const gap = entrance.x;
    const xs = [...Array(arena.w).keys()].filter((x) => x !== gap);
    const obstacles: PlacedObstacle[] = xs.map((x) => ({
      id: `o-${x}`,
      type: "wall",
      x,
      y: 5,
    }));
    const sim = makeSim([minion("m1", gap, 5)], obstacles);
    run(sim, 60);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBeLessThan(after.maxHp);
  });

  it("takes the long way round rather than through a minion", () => {
    // Same seal, but the gap is left open beside the minion. A route exists,
    // so nothing is touched — the minion is scenery with a bow.
    const xs = [...Array(arena.w).keys()].filter((x) => x !== 0 && x !== 1);
    const obstacles: PlacedObstacle[] = xs.map((x) => ({
      id: `o-${x}`,
      type: "wall",
      x,
      y: 5,
    }));
    const sim = makeSim([minion("m1", 1, 5)], obstacles);
    run(sim, 60);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBe(after.maxHp);
    expect(sim.state.obstacles.every((o) => o.hp === o.maxHp)).toBe(true);
  });

  it("re-routes the moment a blocking minion dies", () => {
    // One tile of gap, held by a minion, with a second gap opening behind it
    // only once it falls. The party must not be left walking into a corpse.
    const gap = entrance.x;
    const xs = [...Array(arena.w).keys()].filter((x) => x !== gap);
    const obstacles: PlacedObstacle[] = xs.map((x) => ({
      id: `o-${x}`,
      type: "barricade",
      x,
      y: 5,
    }));
    const sim = makeSim([minion("m1", gap, 5)], obstacles);
    run(sim, 90);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.alive).toBe(false);
    // Having killed the one thing in the way, they walked on through the hole
    // rather than standing on it: the raid resolved.
    expect(sim.state.status).not.toBe("running");
  });
});
