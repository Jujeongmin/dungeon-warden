import { Verse8Ads } from "@verse8/ads";

/**
 * Placement ids.
 *
 * The rewarded placement pays out an effect inside the running raid, not
 * currency. The Agent8 sandbox has no outbound HTTP — `fetch` is absent — so
 * the documented server-side verification of a rewarded ad cannot run. Paying
 * gold on an unverifiable signal would be an unbounded income source, whereas
 * a one-off comeback inside a fight the client already simulates costs nothing
 * that was not already the client's to give itself.
 */
export const AD_PLACEMENT = {
  reviveMinions: "revive-minions",
} as const;

/*
 * There are no interstitials.
 *
 * One used to run after every raid on a five-minute cooldown. The end of a
 * raid is the moment the player is deciding what to change about their
 * dungeon, and putting a full-screen ad in front of that is taking the game
 * away at the exact point it is working. The only ad left is the revive, which
 * the player asks for and is paid for.
 */

/** True when the player watched the ad through to the reward. */
export async function watchReviveAd(): Promise<boolean> {
  try {
    const result = await Verse8Ads.showRewarded({
      placementId: AD_PLACEMENT.reviveMinions,
    });
    return result.status === "rewarded";
  } catch {
    return false;
  }
}

/** Lets the UI hide ad entry points outside the Verse8 shell. */
export function adsLikelyAvailable(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}
