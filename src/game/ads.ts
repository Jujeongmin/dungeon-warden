import { Verse8Ads } from "@verse8/ads";

/**
 * Rewarded ads.
 *
 * Two placements, both opt-in: the player presses a button that says an ad is
 * coming. There are no interstitials — one used to run after every raid, and
 * the end of a raid is the moment the player is deciding what to change about
 * their dungeon, which is the worst possible moment to take the game away.
 *
 * What this file cannot do is prove an ad was watched. The Agent8 sandbox has
 * no outbound HTTP — `fetch` is absent — so the documented server-side
 * verification of a rewarded ad cannot run, and `showRewarded` resolving is a
 * claim made by the client about itself.
 *
 * The two payouts deal with that differently, and both are deliberate:
 *
 *   - The revive pays an effect inside a fight the client already simulates,
 *     so it hands over nothing that was not already the client's to give.
 *   - The gold pays real currency, so the *server* decides how much and how
 *     often, capped per day. A player who skips the ad earns exactly what an
 *     honest player earns; what that costs is ad revenue, not game balance,
 *     and balance is the only one of the two anything here can defend.
 */

export const AD_PLACEMENT = {
  reviveMinions: "revive-minions",
  goldReward: "gold-reward",
} as const;

export type AdPlacement = (typeof AD_PLACEMENT)[keyof typeof AD_PLACEMENT];

/** True when the player watched the ad through to the reward. */
export async function watchRewarded(placementId: AdPlacement): Promise<boolean> {
  try {
    const result = await Verse8Ads.showRewarded({ placementId });
    return result.status === "rewarded";
  } catch {
    // No ad filled, no network, or not inside the Verse8 shell. Never a reward,
    // and never an exception the caller has to handle.
    return false;
  }
}

export function watchReviveAd(): Promise<boolean> {
  return watchRewarded(AD_PLACEMENT.reviveMinions);
}

export function watchGoldAd(): Promise<boolean> {
  return watchRewarded(AD_PLACEMENT.goldReward);
}

/** Lets the UI hide ad entry points outside the Verse8 shell. */
export function adsLikelyAvailable(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}
