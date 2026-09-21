import { describe, expect, it } from "vitest";
import { SIM_DT, type RunEvent } from "../src/game/td/StageRun";
import { DEMO_MAX_SECONDS, createTitleDemo } from "../src/game/titleDemo";

/** Plays one round the way useTitleDemo does, without drawing it. */
function play(round: number) {
  const run = createTitleDemo(round);
  const events: RunEvent[] = [];
  while (run.time < DEMO_MAX_SECONDS && run.status === "wave") events.push(...run.step(SIM_DT));
  return { run, events };
}

/** The fight behind the title screen: a walled room and a party in it. */
describe("the title screen's fight", () => {
  it("is a maze with a way through it", () => {
    const run = createTitleDemo(0);
    expect(run.towers.length).toBeGreaterThan(20);
    expect(run.route()!.length).toBeGreaterThan(30);
  });

  it("has shooting in it, and ends before the next round", () => {
    for (let round = 0; round < 4; round++) {
      const { run, events } = play(round);
      expect(events.some((e) => e.kind === "damage")).toBe(true);
      expect(run.time).toBeLessThanOrEqual(DEMO_MAX_SECONDS + SIM_DT);
    }
  });
});
