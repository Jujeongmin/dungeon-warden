import { describe, expect, it } from "vitest";
import { RaidSim } from "../src/game/sim/RaidSim";
import { TUTORIAL, guideFor, type TutorialContext } from "../src/game/tutorial";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import { decorBlocked } from "../src/game/decor";
import { previewParty } from "../src/game/party";
import {
  MINION_COST,
  OBSTACLE_COST,
  TRAP_COST,
  type PartyMember,
  type PlacedMinion,
  type PlacedObstacle,
  type PlacedTrap,
} from "../src/game/types";

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

/** Gold a new dungeon starts with. Mirrors START_GOLD in server.js. */
const START_GOLD = 200;

/**
 * Plays the opening exactly as it is taught: take the tool each step names,
 * put it on the tile the ring points at, repeat until the tutorial stops
 * asking. Nothing is placed that the guide did not ask for.
 */
function followTheTutorial() {
  const obstacles: PlacedObstacle[] = [];
  const minions: PlacedMinion[] = [];
  const traps: PlacedTrap[] = [];
  let seq = 0;

  // The drawer the step asks for is treated as already open: this test is
  // about what the tutorial teaches you to build, not about the taps that
  // get you to the button.
  const context = (toolId: string, group = ""): TutorialContext => ({
    obstacles, minions, traps, entrance, core,
    wavesRepelled: 0, coreBreaches: 0, toolId, group,
  });

  // Generous bound: every step places at most a handful of things, and a
  // runaway guide should fail the test rather than hang it.
  for (let i = 0; i < 40; i++) {
    const guide = guideFor(context(""));
    if (!guide || !guide.step.tool) break;

    // The player opens the drawer, then picks up the tool the step names,
    // which is what makes the guide point at a tile rather than at a button.
    const held = guideFor(context(guide.step.tool, guide.step.group ?? ""));
    const target = held?.target;
    if (!target || target.kind !== "tile") break;

    seq += 1;
    if (guide.step.tool === "barricade") {
      obstacles.push({ id: `o${seq}`, type: "barricade", x: target.x, y: target.y });
    } else if (guide.step.tool === "warrior") {
      minions.push({ id: `m${seq}`, type: "warrior", x: target.x, y: target.y });
    } else if (guide.step.tool === "spike") {
      traps.push({ id: `t${seq}`, type: "spike", x: target.x, y: target.y });
    } else {
      throw new Error(`the tutorial teaches a tool this test cannot place: ${guide.step.tool}`);
    }
  }

  return { obstacles, minions, traps };
}

function spend({ obstacles, minions, traps }: ReturnType<typeof followTheTutorial>) {
  return (
    obstacles.reduce((sum, o) => sum + OBSTACLE_COST[o.type], 0) +
    minions.reduce((sum, m) => sum + MINION_COST[m.type], 0) +
    traps.reduce((sum, t) => sum + TRAP_COST[t.type], 0)
  );
}

describe("the opening it teaches", () => {
  it("places something for every step that names a tool", () => {
    const built = followTheTutorial();
    const toolSteps = TUTORIAL.filter((step) => step.tool).length;
    expect(built.obstacles.length + built.minions.length + built.traps.length)
      .toBeGreaterThanOrEqual(toolSteps);
  });

  it("costs less than a new dungeon has", () => {
    // A tutorial that asks for more than the player owns cannot be followed.
    expect(spend(followTheTutorial())).toBeLessThanOrEqual(START_GOLD);
  });

  it("repels the first raid", () => {
    /*
     * The point of the whole file. A tutorial whose own build loses teaches
     * that the things it just sold you do not work — and it did lose: one
     * archer and a spike put the knight in the core with 31 of 130hp left,
     * having killed the archer on the way.
     */
    const built = followTheTutorial();
    const sim = new RaidSim({
      ...built,
      party: previewParty([], 0, 0) as PartyMember[],
      arena,
      entrance,
      core,
      lures: [],
      seed: 1,
      terrain: decorBlocked(arena, entrance, core),
    });

    for (let i = 0; i < 6000 && sim.state.status === "running"; i++) sim.step();
    expect(sim.state.status).toBe("repelled");
  });

  it("leaves the garrison standing, so the lesson is legible", () => {
    // Winning with everything dead reads as a near miss, not as "this works".
    const built = followTheTutorial();
    const sim = new RaidSim({
      ...built,
      party: previewParty([], 0, 0) as PartyMember[],
      arena, entrance, core, lures: [], seed: 1,
      terrain: decorBlocked(arena, entrance, core),
    });
    for (let i = 0; i < 6000 && sim.state.status === "running"; i++) sim.step();
    expect(sim.state.minions.every((m) => m.alive)).toBe(true);
  });
});
