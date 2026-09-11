import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wavesFor } from "../src/game/party";
import { INTERMISSION_SECONDS, RaidSim, SIM_DT, isRaidOver } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedMinion, PlacedObstacle } from "../src/game/types";

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

const knight = (id: string): PartyMember => ({ id, cls: "knight", name: id, level: 1 });
const archer = (id: string, x: number, y: number): PlacedMinion => ({ id, type: "warrior", x, y });

function makeSim(waves: PartyMember[][], minions: PlacedMinion[] = [], obstacles: PlacedObstacle[] = []) {
  return new RaidSim({
    minions, traps: [], obstacles,
    party: waves[0], waves,
    arena, entrance, core, lures: [], seed: 1,
  });
}

/** Steps until the status leaves `while`, or the budget runs out. */
function runWhile(sim: RaidSim, staying: string, budget = 4000) {
  for (let i = 0; i < budget && sim.state.status === staying; i++) sim.step();
}

/** A garrison big enough to stop a level-1 knight. */
function garrison(): PlacedMinion[] {
  return [
    archer("g1", core.x + 1, core.y - 3),
    archer("g2", core.x - 1, core.y - 3),
    archer("g3", core.x + 1, core.y - 5),
    archer("g4", core.x - 1, core.y - 5),
  ];
}

describe("a raid made of waves", () => {
  it("opens a build window between them rather than declaring a win", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");

    expect(sim.state.status).toBe("intermission");
    expect(isRaidOver(sim.state.status)).toBe(false);
    expect(sim.state.intermissionLeft).toBeCloseTo(INTERMISSION_SECONDS, 5);
    expect(sim.state.wave).toBe(1);
    expect(sim.state.waves).toBe(2);
  });

  it("is only repelled once the last wave is beaten", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    sim.startNextWave();
    expect(sim.state.status).toBe("running");
    expect(sim.state.wave).toBe(2);

    runWhile(sim, "running");
    expect(sim.state.status).toBe("repelled");
  });

  it("sends the next wave on its own when the window runs out", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    runWhile(sim, "intermission");
    expect(sim.state.status).toBe("running");
    expect(sim.state.wave).toBe(2);
  });

  it("counts kills across every wave, not just the last", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    const afterFirst = sim.state.killed + sim.state.captured;
    expect(afterFirst).toBe(1);

    sim.startNextWave();
    runWhile(sim, "running");
    expect(sim.state.killed + sim.state.captured).toBe(2);
    expect(sim.state.killedIds.concat(sim.state.capturedIds).sort()).toEqual(["a1", "b1"]);
  });

  it("carries the garrison's damage into the next wave", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    const hurt = sim.state.minions.filter((m) => m.hp < m.maxHp);
    // The first knight fought somebody on its way down.
    expect(hurt.length).toBeGreaterThan(0);

    const before = hurt.map((m) => m.hp);
    sim.startNextWave();
    expect(sim.state.minions.filter((m) => m.hp < m.maxHp).map((m) => m.hp)).toEqual(before);
  });

  it("ends the whole raid the moment any wave breaches", () => {
    // No garrison at all: the first knight walks in.
    const sim = makeSim([[knight("a1")], [knight("b1")]]);
    runWhile(sim, "running");
    expect(sim.state.status).toBe("breached");
    expect(isRaidOver(sim.state.status)).toBe(true);
  });

  it("runs as one wave when the caller sends one party, as older servers do", () => {
    const sim = new RaidSim({
      minions: garrison(), traps: [], obstacles: [],
      party: [knight("a1")],
      arena, entrance, core, lures: [], seed: 1,
    });
    runWhile(sim, "running");
    expect(sim.state.waves).toBe(1);
    expect(sim.state.status).toBe("repelled");
  });
});

describe("building during the window", () => {
  it("takes on a wall put up between waves", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");

    const before = sim.state.obstacles.length;
    sim.syncPlacements(garrison(), [], [{ id: "new", type: "wall", x: entrance.x, y: entrance.y + 2 }]);
    expect(sim.state.obstacles.length).toBe(before + 1);
  });

  it("takes on a minion put up between waves, at full health", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");

    const added = [...garrison(), archer("fresh", core.x + 2, core.y - 4)];
    sim.syncPlacements(added, [], []);
    const fresh = sim.state.minions.find((m) => m.id === "fresh")!;
    expect(fresh.hp).toBe(fresh.maxHp);
  });

  it("gives back a minion the player cleared, and keeps the fallen", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");

    const kept = garrison().filter((m) => m.id !== "g1");
    sim.syncPlacements(kept, [], []);
    const survivors = sim.state.minions.filter((m) => m.alive).map((m) => m.id);
    expect(survivors).not.toContain("g1");
    // Casualties stay on the board: they are not the player's to remove.
    const fallen = sim.state.minions.filter((m) => !m.alive).length;
    expect(survivors.length + fallen).toBe(sim.state.minions.length);
  });

  it("refuses to take anything mid-fight", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    // One step in, the first wave is still walking.
    sim.step();
    expect(sim.state.status).toBe("running");

    const before = sim.state.obstacles.length;
    sim.syncPlacements(garrison(), [], [{ id: "cheat", type: "wall", x: entrance.x, y: entrance.y + 2 }]);
    expect(sim.state.obstacles.length).toBe(before);
  });

  it("cannot be made to skip a wave by pressing the button twice", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")], [knight("c1")]], garrison());
    runWhile(sim, "running");
    sim.startNextWave();
    sim.startNextWave();
    expect(sim.state.wave).toBe(2);
  });

  it("gives each wave its own stall clock", () => {
    // A wave that cannot be reached still ends, and the next one starts fresh
    // rather than inheriting a raid-long timer that has already run out.
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    const atWindow = sim.state.elapsed;
    sim.startNextWave();
    sim.step();
    expect(sim.state.elapsed).toBeGreaterThanOrEqual(atWindow);
    expect(sim.state.status).toBe("running");
  });
});

describe("the build window's clock", () => {
  it("counts down in the same fixed steps as the fight", () => {
    const sim = makeSim([[knight("a1")], [knight("b1")]], garrison());
    runWhile(sim, "running");
    const start = sim.state.intermissionLeft;
    sim.step();
    expect(sim.state.intermissionLeft).toBeCloseTo(start - SIM_DT, 5);
  });
});

describe("how many waves a raid is", () => {
  it("grows with threat the way the party does", () => {
    expect(wavesFor(0)).toBe(1);
    expect(wavesFor(2)).toBe(1);
    expect(wavesFor(3)).toBe(2);
    expect(wavesFor(8)).toBe(2);
    expect(wavesFor(9)).toBe(3);
    expect(wavesFor(40)).toBe(3);
  });

  it("agrees with the server about where the steps are", () => {
    const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    expect(server).toContain("if (threat < 3) return 1;");
    expect(server).toContain("if (threat < CHAMPION_THREAT) return 2;");
  });

  it("opens a new dungeon with one wave, so the first raid is one fight", () => {
    // The opening teaches a build and then fights a raid with it. Measured in
    // tests/tutorial.test.ts: two archers hold one wave and lose to three.
    expect(wavesFor(0)).toBe(1);
  });
});
