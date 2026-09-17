import { describe, expect, it } from "vitest";
import { connects } from "../src/game/dig";
import { isRaidOver, type SimEvent } from "../src/game/sim/RaidSim";
import { DEMO_MAX_SECONDS, createTitleDemo, demoDug, demoUnits, demoWaves } from "../src/game/titleDemo";

/** Plays one round the way useTitleDemo does, without drawing it. */
function play(round: number) {
  const demo = createTitleDemo(round);
  const sim = demo.sim;
  const events: SimEvent[] = [];
  while (sim.state.elapsed < DEMO_MAX_SECONDS && !isRaidOver(sim.state.status)) {
    if (sim.state.status === "intermission") sim.startNextWave();
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { demo, state: sim.state, events };
}

/**
 * The fight behind the title screen: a built dungeon and a party in it,
 * played by the real simulation.
 */
describe("the title screen's fight", () => {
  it("is fought in a dungeon the party can walk through", () => {
    const demo = createTitleDemo(0);
    expect(connects(demo.arena, demoDug())).toBe(true);
  });

  it("lasts long enough to watch and has fighting in it", () => {
    for (let round = 0; round < 4; round++) {
      const { state, events } = play(round);
      expect(state.elapsed, `round ${round}`).toBeGreaterThan(20);
      expect(events.filter((e) => e.kind === "damage").length, `round ${round}`).toBeGreaterThan(30);
      expect(state.killed + state.captured, `round ${round}`).toBeGreaterThan(0);
    }
  });

  it("does not always end the same way", () => {
    const outcomes = new Set([0, 1, 2, 3, 4, 5].map((round) => play(round).state.status));
    expect(outcomes.has("repelled")).toBe(true);
    expect(outcomes.has("breached")).toBe(true);
  });

  it("sends a different party each round, under new names on the board", () => {
    const first = demoWaves(0).flat();
    const second = demoWaves(1).flat();
    expect(first.map((m) => m.cls)).not.toEqual(second.map((m) => m.cls));
    // New ids, so the board draws fresh figures instead of reusing last round's.
    const ids = new Set(first.map((m) => m.id));
    expect(second.some((m) => ids.has(m.id))).toBe(false);
    expect(demoWaves(0)[1].filter((m) => m.champion)).toHaveLength(1);
  });

  it("draws the party with health bars and the garrison without", () => {
    const { demo } = play(0);
    const fresh = createTitleDemo(0);
    for (let i = 0; i < 40; i++) fresh.sim.step();
    const units = demoUnits(fresh.sim.state, false);
    expect(units.some((u) => u.id.startsWith("m:") && !u.showHealth)).toBe(true);
    expect(units.filter((u) => u.id.startsWith("a:")).every((u) => u.showHealth)).toBe(true);
    expect(demoUnits(demo.sim.state, true).every((u) => u.action === "idle")).toBe(true);
  });
});
