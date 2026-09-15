import type { PartyMember } from "./types";

/**
 * How fast a raid can possibly have gone.
 *
 * The server does not run the fight; it takes the client's word for who fell.
 * What it can check without running anything is the clock. Nobody goes down
 * before they have walked in, walking in is staggered, a wave only follows the
 * one before it once that one is over, a beaten adventurer bleeds out for
 * seconds before they count as killed, and the fastest the fight can be played
 * is RAID_SPEEDS' top speed. A report that says more happened than the time
 * since the raid opened allows is trimmed to what it allows.
 *
 * A floor, not a proof: an honest raid is always slower than this, and a
 * dishonest one that waits long enough still gets through. It stops the
 * instant, free, repeatable report - the cheap one.
 *
 * Mirrored in server.js, which is where it is enforced; tests/raid-check.test.ts
 * pins the two together and plays real raids against it.
 */

/** RAID_SPEEDS' top speed. */
export const RAID_MAX_SPEED = 4;
/** RaidSim's SPAWN_INTERVAL_SECONDS. */
export const RAID_SPAWN_INTERVAL = 0.9;
/** RaidSim's DOWNED_SECONDS, less a step or two of rounding. */
export const RAID_BLEED_SECONDS = 2.9;
/** Allowance for the two clocks the server compares. */
export const RAID_CLOCK_SLACK_MS = 250;

/** Simulated seconds a raid can have run, given the wall clock since it opened. */
export function raidSeconds(startedAt: number | undefined, now: number): number {
  if (typeof startedAt !== "number") return Infinity;
  return ((Math.max(0, now - startedAt) + RAID_CLOCK_SLACK_MS) / 1000) * RAID_MAX_SPEED;
}

/**
 * The earliest simulated moment each adventurer can go down, and the earliest
 * the whole raid can be over.
 */
export function earliestFates(waves: PartyMember[][]): {
  downAt: Record<string, number>;
  repelledAt: number;
} {
  const downAt: Record<string, number> = {};
  let waveStart = 0;
  for (const wave of waves) {
    for (let i = 0; i < wave.length; i++) downAt[wave[i].id] = waveStart + i * RAID_SPAWN_INTERVAL;
    waveStart += Math.max(0, wave.length - 1) * RAID_SPAWN_INTERVAL;
  }
  return { downAt, repelledAt: waveStart };
}

/** Only the kills and captures the clock allows, and whether a win was possible yet. */
export function timelyFates(
  waves: PartyMember[][],
  seconds: number,
  killed: string[],
  captured: string[],
): { killed: string[]; captured: string[]; canRepel: boolean } {
  const { downAt, repelledAt } = earliestFates(waves);
  const reached = (id: string, after: number) =>
    downAt[id] !== undefined && downAt[id] + after <= seconds;
  return {
    killed: killed.filter((id) => reached(id, RAID_BLEED_SECONDS)),
    captured: captured.filter((id) => reached(id, 0)),
    canRepel: seconds >= repelledAt,
  };
}
