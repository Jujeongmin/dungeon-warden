import { describe, expect, it } from "vitest";
import { RaidSim } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { buildRaidPath } from "../src/game/sim/pathfinding";
import { emptyTally, recordEvents, tallyCells } from "../src/game/aftermath";
import type { PartyMember, PlacedMinion, PlacedTrap } from "../src/game/types";

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);
const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

/** Runs a raid to its end, folding events exactly as App.tsx does. */
function raid(options: { minions?: PlacedMinion[]; traps?: PlacedTrap[] }) {
  const sim = new RaidSim({
    minions: options.minions ?? [],
    traps: options.traps ?? [],
    obstacles: [],
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
  const tally = emptyTally();
  for (let i = 0; i < 4000 && sim.state.status === "running"; i++) {
    sim.step();
    recordEvents(tally, sim.drainEvents());
  }
  recordEvents(tally, sim.drainEvents());
  return { sim, tally };
}

/** A tile the party actually walks over, so a minion put there is in the road. */
function routeTile(index: number) {
  const path = buildRaidPath(arena, entrance, core, [], new Set());
  return path[Math.min(index, path.length - 1)];
}

describe("the aftermath map", () => {
  it("draws nothing when nothing happened", () => {
    const { sim, tally } = raid({});
    expect(sim.state.status).not.toBe("running");
    // An undefended dungeon: the party walks in and the floor has nothing to
    // say about it. A blank wash over every tile would be worse than no map.
    expect(tallyCells(tally)).toBeNull();
    expect(tally.marks).toHaveLength(0);
  });

  it("lights the tiles where the party was actually hit", () => {
    const spot = routeTile(4);
    const { tally } = raid({
      minions: [
        { id: "m1", type: "warrior", x: spot.x, y: spot.y + 1 },
        { id: "m2", type: "warrior", x: spot.x, y: spot.y - 1 },
      ],
    });

    const cells = tallyCells(tally);
    expect(cells).not.toBeNull();
    expect(cells!.length).toBeGreaterThan(0);

    // Every lit tile is somewhere the party stood, and the hottest of them is
    // within reach of a minion — otherwise the map is pointing at scenery.
    const hottest = cells!.reduce((a, b) => (a.heat >= b.heat ? a : b));
    expect(hottest.heat).toBe(1);
    const reach = Math.hypot(hottest.x - spot.x, hottest.y - spot.y);
    expect(reach).toBeLessThanOrEqual(4);
  });

  it("marks where an adventurer went down", () => {
    // Enough of a garrison to actually finish a level-1 knight.
    const spot = routeTile(4);
    const minions: PlacedMinion[] = [];
    for (let i = 0; i < 6; i++) {
      minions.push({
        id: `m${i}`,
        type: "warrior",
        x: spot.x + (i % 2 === 0 ? 1 : -1),
        y: spot.y + (i - 2),
      });
    }
    const { sim, tally } = raid({ minions });
    expect(sim.state.killed + sim.state.captured).toBeGreaterThan(0);
    expect(tally.marks.filter((m) => m.kind === "fell").length).toBe(
      sim.state.killed + sim.state.captured,
    );
  });

  it("normalises heat against the raid's own worst tile, not an absolute", () => {
    const tally = emptyTally();
    recordEvents(tally, [
      { kind: "damage", targetId: "a1", amount: 3, x: 1, y: 1, source: "melee" },
      { kind: "damage", targetId: "a1", amount: 1, x: 2, y: 2, source: "melee" },
    ]);
    const cells = tallyCells(tally)!;
    expect(cells.find((c) => c.x === 1)!.heat).toBe(1);
    expect(cells.find((c) => c.x === 2)!.heat).toBeCloseTo(1 / 3);
  });

  it("sums repeated hits on one tile rather than keeping only the last", () => {
    const tally = emptyTally();
    for (let i = 0; i < 4; i++) {
      recordEvents(tally, [
        { kind: "damage", targetId: "a1", amount: 5, x: 3, y: 3, source: "trap" },
      ]);
    }
    expect(tally.heat.get("3,3")).toBe(20);
  });

  it("counts burn ticks, so a flame corridor does not read as dead floor", () => {
    const tally = emptyTally();
    recordEvents(tally, [
      { kind: "damage", targetId: "a1", amount: 0.45, x: 2, y: 5, source: "burn" },
    ]);
    expect(tally.heat.get("2,5")).toBeCloseTo(0.45);
  });

  it("marks the player's own losses apart from the party's", () => {
    const tally = emptyTally();
    recordEvents(tally, [
      { kind: "minionDown", targetId: "m1", x: 4, y: 4 },
      { kind: "killed", targetId: "a1", x: 5, y: 5 },
      { kind: "captured", targetId: "a2", x: 6, y: 6 },
    ]);
    expect(tally.marks).toEqual([
      { x: 4, y: 4, kind: "lost" },
      { x: 5, y: 5, kind: "fell" },
      { x: 6, y: 6, kind: "fell" },
    ]);
  });
});
