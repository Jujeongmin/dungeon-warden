import { ADVENTURER_CLASSES, type PartyMember } from "./types";
import { ADVENTURER_NAMES } from "./party";

/**
 * Today's raid.
 *
 * Once a day every dungeon faces the same party, and how many of it the
 * dungeon put down goes on a board that only lasts the day. The regular board
 * ranks how far a dungeon has come; this one is a reason to come back tomorrow.
 *
 * Mirrored in server.js, which is what picks the party, takes the one attempt
 * and keeps the scores - tests/daily.test.ts pins the two together. The party
 * comes from the day's number alone, so the client can show it before anyone
 * has asked the server for anything.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_WAVES = 2;
export const DAILY_PARTY_SIZE = 3;
/** The first wave's level; each wave after it arrives one higher. */
export const DAILY_LEVEL = 2;
export const DAILY_POINTS_PER_KILL = 100;
export const DAILY_REPEL_BONUS = 500;

/** The UTC day a moment belongs to, which is also the seed of its party. */
export function dailyDay(now: number): number {
  return Math.floor(now / DAY_MS);
}

/** A small seeded generator, so every client and the server agree on the party. */
export function dailyRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's waves: the same for everyone, and led in the last wave by a champion. */
export function dailyWaves(day: number): PartyMember[][] {
  const rng = dailyRng((day * 2654435761) >>> 0);
  const waves: PartyMember[][] = [];
  for (let w = 0; w < DAILY_WAVES; w++) {
    const wave: PartyMember[] = [];
    for (let i = 0; i < DAILY_PARTY_SIZE; i++) {
      const cls = ADVENTURER_CLASSES[Math.floor(rng() * ADVENTURER_CLASSES.length)];
      const name = ADVENTURER_NAMES[Math.floor(rng() * ADVENTURER_NAMES.length)];
      wave.push({
        id: `daily-${day}-${w}-${i}`,
        cls,
        name,
        level: DAILY_LEVEL + w,
        champion: w === DAILY_WAVES - 1 && i === 0,
      });
    }
    waves.push(wave);
  }
  return waves;
}

/** Points for a day's attempt: every adventurer put down, and a bonus for holding. */
export function dailyScore(kills: number, repelled: boolean): number {
  return kills * DAILY_POINTS_PER_KILL + (repelled ? DAILY_REPEL_BONUS : 0);
}
