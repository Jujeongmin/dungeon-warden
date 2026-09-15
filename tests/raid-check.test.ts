import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RAID_BLEED_SECONDS,
  RAID_CLOCK_SLACK_MS,
  RAID_MAX_SPEED,
  RAID_SPAWN_INTERVAL,
  earliestFates,
  raidSeconds,
  timelyFates,
} from "../src/game/raidCheck";
import { DOWNED_SECONDS, RaidSim, SIM_DT, SPAWN_INTERVAL_SECONDS } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedMinion, PlacedTrap } from "../src/game/types";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const server = lf(readFileSync(new URL("../server.js", import.meta.url), "utf8"));
const useRaid = lf(readFileSync(new URL("../src/game/useRaid.ts", import.meta.url), "utf8"));

function body(name: string): string {
  const start = server.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return server.slice(start, server.indexOf("\n}\n", start));
}

const arena = arenaFor([]);
const entrance = entranceOf(arena);
const core = coreOf(arena);

const knight = (id: string): PartyMember => ({ id, cls: "knight", name: id, level: 1 });
const twoWaves = (): PartyMember[][] => [
  [knight("a1"), knight("a2"), knight("a3")],
  [knight("b1"), knight("b2"), knight("b3")],
];

/** As fast a door as the game allows: every trap and blade on the threshold. */
function killingDoor(): { minions: PlacedMinion[]; traps: PlacedTrap[] } {
  const minions: PlacedMinion[] = [
    { id: "m1", type: "mage", x: entrance.x - 1, y: entrance.y + 1 },
    { id: "m2", type: "mage", x: entrance.x + 1, y: entrance.y + 1 },
    { id: "w1", type: "warrior", x: entrance.x - 1, y: entrance.y + 2 },
    { id: "w2", type: "warrior", x: entrance.x + 1, y: entrance.y + 2 },
    { id: "g1", type: "grunt", x: entrance.x - 1, y: entrance.y + 3 },
    { id: "g2", type: "grunt", x: entrance.x + 1, y: entrance.y + 3 },
  ];
  const traps: PlacedTrap[] = [
    { id: "t1", type: "flame", x: entrance.x, y: entrance.y + 1 },
    { id: "t2", type: "spike", x: entrance.x, y: entrance.y + 2 },
    { id: "t3", type: "rockfall", x: entrance.x, y: entrance.y + 3 },
    { id: "t4", type: "arrow", x: entrance.x, y: entrance.y + 4 },
  ];
  return { minions, traps };
}

/**
 * Plays a raid the way the fastest honest player would: detonating the moment
 * it is ready and skipping every build window. Records when each adventurer's
 * fate landed, in simulated seconds.
 */
function playFast(waves: PartyMember[][], jailFree: number) {
  const { minions, traps } = killingDoor();
  const sim = new RaidSim({
    minions, traps, party: waves[0], waves,
    arena, entrance, core, lures: [], seed: 7, jailFree,
  });
  const fates = new Map<string, { at: number; how: "killed" | "captured" }>();
  for (let i = 0; i < 20000; i++) {
    const status = sim.state.status;
    if (status === "repelled" || status === "breached") break;
    if (status === "intermission") sim.startNextWave();
    sim.useSkill("detonate");
    sim.step();
    const state = sim.state;
    for (const id of state.killedIds) if (!fates.has(id)) fates.set(id, { at: state.elapsed, how: "killed" });
    for (const id of state.capturedIds) if (!fates.has(id)) fates.set(id, { at: state.elapsed, how: "captured" });
  }
  return { sim, fates };
}

describe("the fastest honest raid", () => {
  for (const jailFree of [0, 6]) {
    it(`never lands a fate before the server allows it (jail ${jailFree})`, () => {
      const waves = twoWaves();
      const { sim, fates } = playFast(waves, jailFree);
      const { downAt, repelledAt } = earliestFates(waves);

      // Not vacuous: the door does put people down.
      expect(fates.size).toBeGreaterThan(0);
      if (jailFree > 0) expect([...fates.values()].some((f) => f.how === "captured")).toBe(true);

      for (const [id, fate] of fates) {
        const floor = downAt[id] + (fate.how === "killed" ? RAID_BLEED_SECONDS : 0);
        expect(fate.at, id).toBeGreaterThanOrEqual(floor);
      }

      const state = sim.state;
      const timely = timelyFates(waves, state.elapsed, state.killedIds, state.capturedIds);
      expect(timely.killed).toEqual(state.killedIds);
      expect(timely.captured).toEqual(state.capturedIds);
      if (state.status === "repelled") {
        expect(state.elapsed).toBeGreaterThanOrEqual(repelledAt);
        expect(timely.canRepel).toBe(true);
      }
    });
  }
});

describe("a report the clock does not allow", () => {
  const waves = twoWaves();
  const everyone = waves.flat().map((m) => m.id);

  it("drops kills reported the moment the raid opened", () => {
    const seconds = raidSeconds(1_000, 1_000);
    const timely = timelyFates(waves, seconds, everyone, []);
    expect(timely.killed).toEqual([]);
    expect(timely.canRepel).toBe(false);
  });

  it("keeps only the adventurers who could have walked in yet", () => {
    // Half a second at top speed, with the slack, is three simulated seconds:
    // the first wave is in and the second has not finished arriving.
    const seconds = raidSeconds(0, 500);
    expect(seconds).toBeCloseTo(3, 9);
    const timely = timelyFates(waves, seconds, [], everyone);
    expect(timely.captured).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"].filter((id) => earliestFates(waves).downAt[id] <= seconds));
    expect(timely.captured).toContain("a1");
    expect(timely.captured.length).toBeLessThan(everyone.length);
  });

  it("allows everything once enough time has passed", () => {
    const timely = timelyFates(waves, raidSeconds(0, 60_000), everyone, []);
    expect(timely.killed).toEqual(everyone);
    expect(timely.canRepel).toBe(true);
  });

  it("does not judge a raid opened before the clock was recorded", () => {
    expect(raidSeconds(undefined, 0)).toBe(Infinity);
  });

  it("puts each wave after the one before it", () => {
    const { downAt, repelledAt } = earliestFates(waves);
    expect(downAt.a1).toBe(0);
    expect(downAt.a3).toBeCloseTo(2 * RAID_SPAWN_INTERVAL, 9);
    expect(downAt.b1).toBeCloseTo(2 * RAID_SPAWN_INTERVAL, 9);
    expect(repelledAt).toBeCloseTo(4 * RAID_SPAWN_INTERVAL, 9);
  });
});

describe("the server's side of it", () => {
  it("reads the same clock as the game", () => {
    expect(RAID_SPAWN_INTERVAL).toBe(SPAWN_INTERVAL_SECONDS);
    expect(RAID_BLEED_SECONDS).toBeLessThan(DOWNED_SECONDS);
    expect(RAID_BLEED_SECONDS).toBeGreaterThanOrEqual(DOWNED_SECONDS - 3 * SIM_DT);
    const speeds = useRaid.match(/export const RAID_SPEEDS = \[([^\]]+)\]/)?.[1].split(",").map(Number) ?? [];
    expect(RAID_MAX_SPEED).toBe(Math.max(...speeds));
  });

  it("uses the same numbers and the same rule", () => {
    expect(server).toContain(`const RAID_MAX_SPEED = ${RAID_MAX_SPEED};`);
    expect(server).toContain(`const RAID_SPAWN_INTERVAL = ${RAID_SPAWN_INTERVAL};`);
    expect(server).toContain(`const RAID_BLEED_SECONDS = ${RAID_BLEED_SECONDS};`);
    expect(server).toContain(`const RAID_CLOCK_SLACK_MS = ${RAID_CLOCK_SLACK_MS};`);
    expect(body("raidSeconds")).toContain("((Math.max(0, now - startedAt) + RAID_CLOCK_SLACK_MS) / 1000) * RAID_MAX_SPEED");
    expect(body("earliestFates")).toContain("waveStart += Math.max(0, wave.length - 1) * RAID_SPAWN_INTERVAL;");
    const timely = body("timelyFates");
    expect(timely).toContain("killed: killed.filter((id) => reached(id, RAID_BLEED_SECONDS)),");
    expect(timely).toContain("captured: captured.filter((id) => reached(id, 0)),");
  });

  it("applies it to every raid that pays or scores", () => {
    expect(server).toContain("const timely = timelyFates(pending, now, reportedKilled, reportedCaptured);");
    expect(body("finishDailyRaid")).toContain("timelyFates(pending, Date.now(), reportedKilled, reportedCaptured)");
    expect(server.split('if (outcome === "repelled" && !timely.canRepel) throw new Error("RAID_TOO_FAST");').length - 1).toBe(2);
  });
});
