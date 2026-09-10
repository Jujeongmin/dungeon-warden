import { describe, expect, it } from "vitest";
import { RaidSim } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedObstacle } from "../src/game/types";
import { OBSTACLE_COST, MINION_COST, TRAP_COST } from "../src/game/types";

const arena = arenaFor([]);

function secondsToBreak(type: "barricade" | "wall", party: PartyMember[]): number {
  const obstacles: PlacedObstacle[] = [];
  for (let x = 0; x < 12; x++) obstacles.push({ id: `o${x}`, type, x, y: 5 });
  const sim = new RaidSim({
    minions: [], traps: [], obstacles, party, arena,
    entrance: entranceOf(arena), core: coreOf(arena), lures: [], seed: 1,
  });
  for (let i = 0; i < 6000; i++) {
    sim.step();
    if (sim.destroyedObstacleIds.length > 0) return sim.state.elapsed;
  }
  return Infinity;
}

describe("obstacle balance", () => {
  const solo: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

  it("a barricade costs a lone level-1 knight between 5 and 15 seconds", () => {
    const seconds = secondsToBreak("barricade", solo);
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(15);
  });

  it("a stone wall costs at least twice as much time as a barricade", () => {
    expect(secondsToBreak("wall", solo)).toBeGreaterThan(secondsToBreak("barricade", solo) * 2);
  });

  // --- Beyond the brief: does a wall still buy meaningful time once the
  // defender has been playing a while, not just against the easiest raid
  // in the game? A late-game party is bigger and hits harder, so several
  // adventurers pile onto the same blocking tile (only one obstacle sits on
  // the direct line) and their attacks land in the same simulated seconds.

  const lvl5Party = (count: number): PartyMember[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      cls: (["knight", "barbarian", "rogue", "mage"] as const)[i % 4],
      name: `Adv${i}`,
      level: 5,
    }));

  it("a level-5 party of three breaks a barricade faster than a lone level-1 knight does", () => {
    const soloSeconds = secondsToBreak("barricade", solo);
    const partySeconds = secondsToBreak("barricade", lvl5Party(3));
    expect(partySeconds).toBeLessThan(soloSeconds);
  });

  it("a stone wall still costs a level-5 party of four more time than a barricade costs the same party", () => {
    const party = lvl5Party(4);
    const barricadeSeconds = secondsToBreak("barricade", party);
    const wallSeconds = secondsToBreak("wall", party);
    expect(wallSeconds).toBeGreaterThan(barricadeSeconds);
  });

  it("a stone wall still buys a late-game defender at least a couple of seconds against a party of four", () => {
    // Not a win by itself, but not nothing either: sealing has to still be
    // worth doing once the player is fielding a real party against it.
    const wallSeconds = secondsToBreak("wall", lvl5Party(4));
    expect(wallSeconds).toBeGreaterThan(2);
  });

  // --- Cost side: with digging gone, obstacles are the early gold sink.
  // A first-time player starts with START_GOLD (200) and should be able to
  // afford a short sealed route, plus one minion, plus one trap.

  it("200 starting gold affords a short sealed route, a minion, and a trap", () => {
    const START_GOLD = 200;
    const shortRoute = OBSTACLE_COST.barricade * 6; // enough to fold a small room shut
    const cheapestMinion = Math.min(...Object.values(MINION_COST).filter((c) => c > 0));
    const cheapestTrap = Math.min(...Object.values(TRAP_COST));
    expect(shortRoute + cheapestMinion + cheapestTrap).toBeLessThan(START_GOLD);
  });
});
