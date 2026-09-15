import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRACE_COOLDOWN,
  BRACE_SECONDS,
  LUNGE_COOLDOWN,
  LUNGE_MULTIPLIER,
  RaidSim,
  WARDEN_MIGHT,
} from "../src/game/sim/RaidSim";
import { arenaFor, blockedKey, coreOf, entranceOf } from "../src/game/arena";
import { RESEARCH, researchEffects } from "../src/game/research";
import { MINION_STATS } from "../src/game/sim/units";
import { MINION_COST, type MinionType, type PartyMember } from "../src/game/types";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

/**
 * The guard and the grunt.
 *
 * One holds the road for longer than it hurts anyone; the other is the cheap
 * body there are many of. Each is ridden with a move of its own - a guard
 * braces, a grunt lunges - and both are bought the way the mage is: research
 * first, then gold.
 */

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);
const party: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

function ridden(type: MinionType, at: { x: number; y: number }, rock: Array<{ x: number; y: number }> = []) {
  const sim = new RaidSim({
    minions: [{ id: "m1", type, x: at.x, y: at.y }],
    traps: [],
    terrain: new Set(rock.map((t) => blockedKey(t.x, t.y, arena.w))),
    party,
    arena,
    entrance,
    core,
    lures: [],
    seed: 1,
  });
  sim.possess("m1");
  return sim;
}

/** Steps until the adventurer has walked to within `reach` tiles of the body. */
function waitFor(sim: RaidSim, reach: number) {
  for (let i = 0; i < 20 * 30; i++) {
    sim.setControl({ x: 0, y: 0, facing: 0 });
    const a = sim.state.adventurers[0];
    const me = sim.state.minions[0];
    if (a.spawned && Math.hypot(a.x - me.x, a.y - me.y) <= reach) return;
    sim.step();
  }
  throw new Error("the adventurer never came");
}

describe("a guard's brace", () => {
  it("shields the body and waits before it can again", () => {
    const sim = ridden("guard", { x: core.x, y: core.y - 1 });
    sim.requestSkill();
    sim.step();

    expect(sim.state.minions[0].shield).toBeGreaterThan(BRACE_SECONDS - 0.2);
    expect(sim.state.possessedSkill).toBeGreaterThan(BRACE_COOLDOWN - 0.2);
  });

  it("is spent with nothing in reach, because bracing is for what is coming", () => {
    // Alone at the core: the other skills would refuse here.
    const sim = ridden("guard", { x: core.x, y: core.y - 1 });
    sim.requestSkill();
    sim.step();
    expect(sim.state.possessedSkill).toBeGreaterThan(0);
  });
});

describe("a grunt's lunge", () => {
  it("closes on the nearest adventurer and hits it twice as hard", () => {
    // Beside the road, so the lunge is the only thing that brings it close.
    const sim = ridden("grunt", { x: entrance.x + 1, y: entrance.y + 6 });
    waitFor(sim, 3.5);
    const before = { ...sim.state.minions[0] };
    const hp = sim.state.adventurers[0].hp;

    sim.requestSkill();
    sim.step();

    const after = sim.state.minions[0];
    const a = sim.state.adventurers[0];
    expect(Math.hypot(a.x - after.x, a.y - after.y)).toBeLessThan(Math.hypot(a.x - before.x, a.y - before.y));
    expect(hp - a.hp).toBeCloseTo(MINION_STATS.grunt.damage * WARDEN_MIGHT * LUNGE_MULTIPLIER, 5);
    expect(sim.state.possessedSkill).toBeGreaterThan(LUNGE_COOLDOWN - 0.2);
  });

  it("spends nothing with nobody to lunge at", () => {
    const sim = ridden("grunt", { x: core.x, y: core.y - 1 });
    sim.requestSkill();
    sim.step();
    expect(sim.state.possessedSkill).toBe(0);
  });

  it("stops at the rock instead of going through it", () => {
    // Rock on every side but back towards the core: the lunge has nowhere to go.
    const at = { x: entrance.x + 2, y: entrance.y + 6 };
    const rock = [
      { x: at.x - 1, y: at.y },
      { x: at.x, y: at.y - 1 },
      { x: at.x - 1, y: at.y - 1 },
      { x: at.x - 1, y: at.y + 1 },
    ];
    const sim = ridden("grunt", at, rock);
    waitFor(sim, 3.9);

    sim.requestSkill();
    sim.step();

    const me = sim.state.minions[0];
    expect(rock.some((t) => Math.round(me.x) === t.x && Math.round(me.y) === t.y)).toBe(false);
  });
});

describe("buying them", () => {
  it("is research first", () => {
    expect(researchEffects([]).unlockedMinions).not.toContain("guard");
    expect(researchEffects([]).unlockedMinions).not.toContain("grunt");
    expect(researchEffects(["guard", "grunt"]).unlockedMinions).toEqual(
      expect.arrayContaining(["guard", "grunt"]),
    );
  });

  it("costs what the server charges, and unlocks where the server unlocks", () => {
    for (const type of ["guard", "grunt"] as const) {
      expect(server).toContain(`${type}: ${MINION_COST[type]}`);
      const node = RESEARCH.find((n) => n.unlockMinion === type)!;
      expect(server).toContain(`${node.id}: { cost: ${node.cost}, unlockMinion: "${type}" }`);
    }
  });

  it("makes a guard a wall and a grunt a coin", () => {
    // The two roles, pinned loosely so a retune keeps the shape.
    expect(MINION_STATS.guard.hp).toBeGreaterThan(MINION_STATS.warrior.hp * 2);
    expect(MINION_STATS.guard.damage / MINION_STATS.guard.attackInterval).toBeLessThan(
      MINION_STATS.warrior.damage / MINION_STATS.warrior.attackInterval,
    );
    expect(MINION_COST.grunt).toBeLessThan(MINION_COST.warrior);
    expect(MINION_STATS.grunt.hp).toBeLessThan(MINION_STATS.warrior.hp);
  });
});
