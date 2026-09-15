import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DAILY_LEVEL,
  DAILY_PARTY_SIZE,
  DAILY_POINTS_PER_KILL,
  DAILY_REPEL_BONUS,
  DAILY_WAVES,
  DAY_MS,
  dailyDay,
  dailyScore,
  dailyWaves,
} from "../src/game/daily";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const server = lf(readFileSync(new URL("../server.js", import.meta.url), "utf8"));

/** The body of a top-level function in server.js, up to its closing brace. */
function body(name: string): string {
  const start = server.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return server.slice(start, server.indexOf("\n}\n", start));
}

/**
 * Today's raid: the same party for everyone, from the day's number alone, one
 * attempt, a score, and nothing about the dungeon changed by it.
 */
describe("today's party", () => {
  const day = dailyDay(Date.UTC(2026, 8, 15, 12));

  it("is the same every time it is asked for on the same day", () => {
    expect(dailyWaves(day)).toEqual(dailyWaves(day));
    expect(dailyDay(Date.UTC(2026, 8, 15, 0))).toBe(dailyDay(Date.UTC(2026, 8, 15, 23, 59)));
  });

  it("changes from one day to the next", () => {
    const shape = (d: number) => dailyWaves(d).flat().map((m) => m.cls).join();
    const days = Array.from({ length: 7 }, (_, i) => shape(day + i));
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it("arrives in waves that level up, led in the last by a champion", () => {
    const waves = dailyWaves(day);
    expect(waves).toHaveLength(DAILY_WAVES);
    waves.forEach((wave, w) => {
      expect(wave).toHaveLength(DAILY_PARTY_SIZE);
      expect(wave.every((m) => m.level === DAILY_LEVEL + w)).toBe(true);
    });
    expect(waves.flat().filter((m) => m.champion)).toEqual([waves[DAILY_WAVES - 1][0]]);
    const ids = waves.flat().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("today's score", () => {
  it("counts every adventurer put down, and holding", () => {
    expect(dailyScore(0, false)).toBe(0);
    expect(dailyScore(3, false)).toBe(3 * DAILY_POINTS_PER_KILL);
    expect(dailyScore(6, true)).toBe(6 * DAILY_POINTS_PER_KILL + DAILY_REPEL_BONUS);
  });
});

describe("the server's side of it", () => {
  it("uses the same party and the same score", () => {
    expect(server).toContain(`const DAILY_WAVES = ${DAILY_WAVES};`);
    expect(server).toContain(`const DAILY_PARTY_SIZE = ${DAILY_PARTY_SIZE};`);
    expect(server).toContain(`const DAILY_LEVEL = ${DAILY_LEVEL};`);
    expect(server).toContain(`const DAILY_POINTS_PER_KILL = ${DAILY_POINTS_PER_KILL};`);
    expect(server).toContain(`const DAILY_REPEL_BONUS = ${DAILY_REPEL_BONUS};`);
    expect(body("dailyRng")).toContain("a = (a + 0x6d2b79f5) >>> 0;");
    expect(body("dailyWaves")).toContain("const rng = dailyRng((day * 2654435761) >>> 0);");
    expect(body("dailyWaves")).toContain("const cls = ADVENTURER_CLASSES[Math.floor(rng() * ADVENTURER_CLASSES.length)];");
    expect(body("dailyDay")).toContain(`Math.floor(now / (24 * 60 * 60 * 1000))`);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("allows one attempt a day, spent when it opens", () => {
    expect(server).toContain(`if (state.dailyAttempt === day) throw new Error("DAILY_DONE");`);
    expect(server).toContain("dailyAttempt: day,");
  });

  it("scores the raid and pays nothing for it", () => {
    const finish = body("finishDailyRaid");
    expect(finish).toContain("dailyScore(kills, outcome === \"repelled\")");
    expect(finish).not.toContain("mint");
    expect(finish).not.toContain("burn");
    expect(server).toContain("return await finishDailyRaid(state, pending, outcome, killedIds, capturedIds);");
  });

  it("costs nothing but the attempt when it is walked away from", () => {
    const settle = body("settleAbandonedRaid");
    const skip = settle.indexOf("pending.daily !== undefined");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(settle.indexOf("abandonPendingRaid("));
  });
});
