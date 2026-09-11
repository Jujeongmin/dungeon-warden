import { describe, expect, it } from "vitest";
import { RaidSim, isRaidOver } from "../src/game/sim/RaidSim";
import { TUTORIAL, guideFor, type TutorialContext } from "../src/game/tutorial";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { DIG_COST, connects, dugTile, rockSet, startingDig, type DugTile } from "../src/game/dig";
import { previewParty, wavesFor } from "../src/game/party";
import {
  MINION_COST,
  TRAP_COST,
  type PartyMember,
  type PlacedMinion,
  type PlacedTrap,
} from "../src/game/types";

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

/** Gold a new dungeon starts with. Mirrors START_GOLD in server.js. */
const START_GOLD = 200;

/**
 * Plays the opening exactly as it is taught: open the drawer the step names,
 * take the tool it names, and put it where the ring points. Nothing happens
 * that the guide did not ask for.
 */
function followTheTutorial() {
  const dug: DugTile[] = startingDig(arena);
  const minions: PlacedMinion[] = [];
  const traps: PlacedTrap[] = [];
  let seq = 0;

  const context = (toolId: string, group = ""): TutorialContext => ({
    minions, traps, entrance, core,
    wavesRepelled: 0, coreBreaches: 0, loot: 0, toolId, group,
    dug: dug.length,
    isDug: (x, y) => dug.some((tile) => tile.x === x && tile.y === y),
    connected: connects(arena, dug),
  });

  // Generous bound: a runaway guide should fail the test rather than hang it.
  for (let i = 0; i < 40; i++) {
    const guide = guideFor(context(""));
    if (!guide || !guide.step.tool) break;

    const held = guideFor(context(guide.step.tool, guide.step.group ?? ""));
    const target = held?.target;
    if (!target || target.kind !== "tile") break;

    seq += 1;
    if (guide.step.tool === "dig") {
      dug.push(dugTile(target.x, target.y));
    } else if (guide.step.tool === "warrior") {
      minions.push({ id: `m${seq}`, type: "warrior", x: target.x, y: target.y });
    } else if (guide.step.tool === "spike") {
      traps.push({ id: `t${seq}`, type: "spike", x: target.x, y: target.y });
    } else {
      throw new Error(`the tutorial teaches a tool this test cannot use: ${guide.step.tool}`);
    }
  }

  return { dug, minions, traps };
}

function spend({ dug, minions, traps }: ReturnType<typeof followTheTutorial>) {
  return (
    // Everything past the two tiles a dungeon arrives with was paid for.
    (dug.length - startingDig(arena).length) * DIG_COST +
    minions.reduce((sum, m) => sum + MINION_COST[m.type], 0) +
    traps.reduce((sum, t) => sum + TRAP_COST[t.type], 0)
  );
}

/**
 * The raid the tutorial actually ends with: three waves, built the way
 * useRaid builds them offline.
 *
 * This used to send one party, and that is how a tutorial that loses in the
 * game kept passing here - the opening was measured against a third of the
 * raid it opens.
 */
function raid(built: ReturnType<typeof followTheTutorial>) {
  const waves = [0, 2, 4].slice(0, wavesFor(0)).map((step, wave) =>
    (previewParty([], step, 0) as PartyMember[]).map((member) => ({
      ...member,
      id: `w${wave}-${member.id}`,
    })),
  );
  const sim = new RaidSim({
    minions: built.minions,
    traps: built.traps,
    party: waves[0],
    waves,
    arena, entrance, core, lures: [], seed: 1,
    terrain: rockSet(arena, built.dug),
  });
  // Long enough for three waves and two build windows between them.
  for (let i = 0; i < 30000 && !isRaidOver(sim.state.status); i++) sim.step();
  return sim;
}

describe("the opening it teaches", () => {
  it("does something for every step that names a tool", () => {
    const built = followTheTutorial();
    const toolSteps = TUTORIAL.filter((step) => step.tool).length;
    const done =
      built.dug.length - startingDig(arena).length + built.minions.length + built.traps.length;
    expect(done).toBeGreaterThanOrEqual(toolSteps);
  });

  it("only ever puts things where somebody can stand", () => {
    // The whole point of carving: a minion in the rock would be a purchase
    // that never fires and a trap nothing ever steps on.
    const built = followTheTutorial();
    const rock = rockSet(arena, built.dug);
    for (const at of [...built.minions, ...built.traps]) {
      expect(rock.has(at.y * arena.w + at.x)).toBe(false);
    }
  });

  it("leaves the door still joined to the core", () => {
    expect(connects(arena, followTheTutorial().dug)).toBe(true);
  });

  it("costs less than a new dungeon has", () => {
    expect(spend(followTheTutorial())).toBeLessThanOrEqual(START_GOLD);
  });

  it("repels the first raid", () => {
    /*
     * A tutorial whose own build loses teaches that the things it just sold
     * you do not work.
     */
    expect(raid(followTheTutorial()).state.status).toBe("repelled");
  });

  it("leaves the garrison standing, so the lesson is legible", () => {
    // Winning with everything dead reads as a near miss, not as "this works".
    expect(raid(followTheTutorial()).state.minions.every((m) => m.alive)).toBe(true);
  });
});
