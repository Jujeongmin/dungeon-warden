import { describe, expect, it } from "vitest";
import { planRebuild } from "../src/game/rebuild";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { DIG_COST, dugTile, startingDig } from "../src/game/dig";
import { MINION_COST, ROOM_COST, TRAP_COST } from "../src/game/types";
import type { PlacedMinion, PlacedRoom, PlacedTrap } from "../src/game/types";

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

/** A corridor from the door to the core, which is what a player digs first. */
function corridor() {
  const tiles = [];
  for (let y = entrance.y; y <= core.y; y++) tiles.push(dugTile(entrance.x, y));
  return tiles;
}

const warrior = (id: string, x: number, y: number): PlacedMinion => ({ id, type: "warrior", x, y });
const convert = (id: string, x: number, y: number): PlacedMinion => ({ id, type: "convert", x, y });
const spike = (id: string, x: number, y: number): PlacedTrap => ({ id, type: "spike", x, y });
const vault = (id: string, x: number, y: number): PlacedRoom => ({ id, type: "treasury", x, y });

const bare = { arena, dug: startingDig(arena), minions: [], traps: [], rooms: [] };

describe("taking the dungeon back down", () => {
  it("leaves the door and the core, and nothing else", () => {
    const plan = planRebuild({ ...bare, dug: corridor() });

    expect(plan.dug.map((t) => `${t.x},${t.y}`).sort()).toEqual(
      [`${entrance.x},${entrance.y}`, `${core.x},${core.y}`].sort(),
    );
  });

  it("hands back every gold piece that was spent on what it cleared", () => {
    const dug = corridor();
    const plan = planRebuild({
      arena,
      dug,
      minions: [warrior("m1", entrance.x, 3)],
      traps: [spike("t1", entrance.x, 5)],
      rooms: [vault("r1", entrance.x, 7)],
    });

    // Every dug tile except the two that are never filled in.
    const filled = dug.length - 2;
    expect(plan.refund).toBe(
      filled * DIG_COST + MINION_COST.warrior + TRAP_COST.spike + ROOM_COST.treasury,
    );
  });

  it("keeps a convert, and the tile it is standing on", () => {
    const plan = planRebuild({
      arena,
      dug: [...corridor(), dugTile(entrance.x + 1, 4)],
      minions: [convert("c-a1", entrance.x + 1, 4)],
      traps: [],
      rooms: [],
    });

    expect(plan.minions.map((m) => m.id)).toEqual(["c-a1"]);
    expect(plan.dug.some((t) => t.x === entrance.x + 1 && t.y === 4)).toBe(true);
  });

  it("pays nothing for a convert, which cost nothing to get", () => {
    const kept = planRebuild({
      arena,
      dug: corridor(),
      minions: [convert("c-a1", entrance.x, 4)],
      traps: [],
      rooms: [],
    });
    const alone = planRebuild({ ...bare, dug: corridor() });

    // The convert sits on a corridor tile, so that tile is kept rather than
    // refunded — which is the only difference between the two.
    expect(kept.refund).toBe(alone.refund - DIG_COST);
  });

  it("says nothing would happen when the room is already bare", () => {
    expect(planRebuild(bare).changed).toBe(false);
  });

  it("says nothing would happen when all that is left is a convert", () => {
    const plan = planRebuild({
      arena,
      dug: [...startingDig(arena), dugTile(entrance.x + 1, 4)],
      minions: [convert("c-a1", entrance.x + 1, 4)],
      traps: [],
      rooms: [],
    });

    expect(plan.changed).toBe(false);
    expect(plan.refund).toBe(0);
  });

  it("says something would happen when one tile is dug", () => {
    expect(planRebuild({ ...bare, dug: [...startingDig(arena), dugTile(entrance.x, 1)] }).changed)
      .toBe(true);
  });

  it("never pays back more than a round trip cost", () => {
    // The same bound the refund rate carries: build, then clear, and the purse
    // is where it started - never above it.
    const dug = corridor();
    const spent = (dug.length - 2) * DIG_COST + MINION_COST.warrior;
    const plan = planRebuild({
      arena,
      dug,
      minions: [warrior("m1", entrance.x, 3)],
      traps: [],
      rooms: [],
    });

    expect(plan.refund).toBeLessThanOrEqual(spent);
  });
});
