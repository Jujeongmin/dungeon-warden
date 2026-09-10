import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { MINION_STATS } from "../src/game/sim/units";
import type { PartyMember, PlacedMinion, PlacedObstacle } from "../src/game/types";

/**
 * What an adventurer will turn aside for, and what it walks past.
 *
 * Three rules decide every fight in this game:
 *
 *   1. A minion standing in the road is fought. Routes are built without the
 *      garrison in them, so there is never a way round one to prefer - if it
 *      is on the route, the route goes through it.
 *   2. A minion that shoots is fought if a way to reach it exists, however far
 *      round that way runs.
 *   3. A minion that shoots from somewhere unreachable is ignored.
 *
 * Together they are the reason to build a wall in front of your archers rather
 * than leaving them standing in the open, which is the decision the whole game
 * is made of.
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

const wall = (id: string, x: number, y: number): PlacedObstacle => ({
  id,
  type: "wall",
  x,
  y,
});

/** Every tile of a row except the ones listed, walled off. */
function rowExcept(y: number, gaps: number[], type: "wall" | "barricade" = "wall") {
  return [...Array(arena.w).keys()]
    .filter((x) => !gaps.includes(x))
    .map((x) => ({ id: `o-${x}`, type, x, y }) as PlacedObstacle);
}

describe("a minion in the road", () => {
  it("does not bend the route it is standing on", () => {
    // The bug this rule replaced: dropping a minion on the drawn route made
    // the route go round it, so the thing the player had just paid for was
    // never fought and the line they were building against moved under them.
    const empty = makeSim([]).state.adventurers[0].path;
    const onRoute = empty[4];
    const guarded = makeSim([minion("m1", onRoute.x, onRoute.y)]);
    expect(guarded.state.adventurers[0].path).toEqual(empty);
  });

  it("is fought even with the whole room open to walk round it", () => {
    const empty = makeSim([]).state.adventurers[0].path;
    const onRoute = empty[4];
    // No walls at all: under the old rule the party strolled round it.
    const sim = makeSim([minion("m1", onRoute.x, onRoute.y)]);
    run(sim, 6);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBeLessThan(after.maxHp);

    // Stopped by it rather than walking past: its tile is still a step on
    // the route they are walking, and they are not yet beyond it.
    const adventurer = sim.state.adventurers[0];
    expect(after.alive).toBe(true);
    expect(adventurer.path.some((p) => p.x === onRoute.x && p.y === onRoute.y)).toBe(true);
    expect(adventurer.y).toBeLessThan(onRoute.y + 1);
  });

  it("is fought when it is the only way through", () => {
    const gap = entrance.x;
    const sim = makeSim([minion("m1", gap, 5)], rowExcept(5, [gap]));
    run(sim, 60);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBeLessThan(after.maxHp);
  });

  it("re-routes the party the moment it dies", () => {
    const gap = entrance.x;
    const sim = makeSim([minion("m1", gap, 5)], rowExcept(5, [gap], "barricade"));
    run(sim, 90);

    expect(sim.state.minions.find((m) => m.id === "m1")!.alive).toBe(false);
    // They walked on through the hole rather than standing on the corpse.
    expect(sim.state.status).not.toBe("running");
  });
});

describe("a minion that shoots", () => {
  it("hits the party from beside the route", () => {
    const sim = makeSim([minion("m1", entrance.x + 2, 5)]);
    run(sim, 40);

    const adventurer = sim.state.adventurers.find((a) => a.id === "a1")!;
    expect(adventurer.hp).toBeLessThan(adventurer.maxHp);
  });

  it("is hunted down when it stands in the open", () => {
    const sim = makeSim([minion("m1", entrance.x + 2, 5)]);
    run(sim, 90);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBeLessThan(after.maxHp);
  });

  it("lets the party carry on to the core once it is dead", () => {
    const sim = makeSim([minion("m1", entrance.x + 2, 5)]);
    run(sim, 180);

    expect(sim.state.minions.find((m) => m.id === "m1")!.alive).toBe(false);
    expect(sim.state.status).not.toBe("running");
  });

  it("is left alone when there is no way in to it", () => {
    // Boxed into the corner it stands in. It shoots the whole raid and nothing
    // can reach it — and the party does not start breaking walls to try.
    const sim = makeSim(
      [minion("m1", 0, 5)],
      [
        wall("w1", 1, 5),
        wall("w2", 0, 4),
        wall("w3", 0, 6),
        wall("w4", 1, 4),
        wall("w5", 1, 6),
      ],
    );
    run(sim, 90);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.alive).toBe(true);
    expect(after.hp).toBe(after.maxHp);
    expect(sim.state.obstacles.every((o) => o.hp === o.maxHp)).toBe(true);
  });
});

describe("a minion that never fires", () => {
  it("is never touched", () => {
    // Far corner, well outside its own reach of any route to the core: it
    // never shoots, so nothing ever comes for it.
    const sim = makeSim([minion("m1", arena.w - 1, core.y)]);
    run(sim, 90);

    const after = sim.state.minions.find((m) => m.id === "m1")!;
    expect(after.hp).toBe(after.maxHp);
  });
});

describe("reach", () => {
  it("clears at least a tile of wall", () => {
    // A minion tucked behind the barricade it is guarding has to be able to
    // fire over it, or standing it there does nothing at all.
    expect(MINION_STATS.warrior.range).toBeGreaterThan(2);
    expect(MINION_STATS.mage.range).toBeGreaterThan(MINION_STATS.warrior.range);
  });
});

/**
 * Rally moves the garrison mid-raid, which is terrain surgery now that minions
 * occupy their tiles: every route in the room was computed against where they
 * used to be.
 */
describe("rallying the garrison", () => {
  it("re-routes everyone after moving them", () => {
    // One gap, held by a minion, so the party is committed to breaking it.
    const gap = entrance.x;
    const sim = makeSim([minion("m1", gap, 5)], rowExcept(5, [gap]));
    run(sim, 8);

    // Pull it out of the doorway. The way through is now open, and nobody
    // should still be swinging at an empty tile.
    sim.useSkill("rally", { x: gap, y: 9 });
    run(sim, 120);

    expect(sim.state.status).not.toBe("running");
  });

  it("refuses a tile a minion could not stand on, and keeps the skill", () => {
    const sim = makeSim([minion("m1", entrance.x + 2, 5)]);
    run(sim, 4);

    expect(sim.useSkill("rally", { x: core.x, y: core.y })).toBe(false);
    // Refused, so it is still there to use.
    expect(sim.useSkill("rally", { x: entrance.x, y: 7 })).toBe(true);
  });
});
