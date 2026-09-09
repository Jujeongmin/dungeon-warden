import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedObstacle } from "../src/game/types";

const arena = arenaFor([]);
const party: PartyMember[] = [
  { id: "a1", cls: "knight", name: "Aldric", level: 1 },
];

function makeSim(obstacles: PlacedObstacle[]) {
  return new RaidSim({
    minions: [],
    traps: [],
    obstacles,
    party,
    arena,
    entrance: entranceOf(arena),
    core: coreOf(arena),
    lures: [],
    seed: 1,
  });
}

/** Runs the simulation for at most `seconds`, stopping early once it resolves. */
function run(sim: RaidSim, seconds: number) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (sim.state.status !== "running") break;
    sim.step();
  }
}

function wallAt(x: number, ys: number[], type: "barricade" | "wall" = "barricade"): PlacedObstacle[] {
  return ys.map((y) => ({ id: `o-${x}-${y}`, type, x, y }));
}

describe("adventurers and obstacles", () => {
  it("walks a long detour without touching a single obstacle", () => {
    // Wall across x=5 with a gap at y=0, forcing a long way round.
    const obstacles = wallAt(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 60);

    expect(sim.state.obstacles.every((o) => o.hp === o.maxHp)).toBe(true);
    expect(sim.state.obstacles.every((o) => o.alive)).toBe(true);
    expect(sim.state.status).toBe("breached");
  });

  it("breaks through when the room is sealed", () => {
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 60);

    const dead = sim.state.obstacles.filter((o) => !o.alive);
    expect(dead.length).toBeGreaterThan(0);
    expect(sim.destroyedObstacleIds).toEqual(dead.map((o) => o.id));
    expect(sim.state.status).toBe("breached");
  });

  it("attacks the obstacle on its own line, not the nearest one", () => {
    // Sealed. The entrance is at y=6, so the obstacle in the way is (5,6).
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 12);

    const hurt = sim.state.obstacles.filter((o) => o.hp < o.maxHp);
    expect(hurt).toHaveLength(1);
    expect(hurt[0]).toMatchObject({ x: 5, y: 6 });
  });

  it("emits obstacleHit and obstacleDown", () => {
    const sim = makeSim(wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    const kinds = new Set<string>();
    for (let i = 0; i < 1200 && sim.state.status === "running"; i++) {
      sim.step();
      for (const event of sim.drainEvents()) kinds.add(event.kind);
    }
    expect(kinds.has("obstacleHit")).toBe(true);
    expect(kinds.has("obstacleDown")).toBe(true);
  });

  it("is deterministic", () => {
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const a = makeSim(obstacles);
    const b = makeSim(obstacles);
    run(a, 45);
    run(b, 45);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
