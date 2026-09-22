import { Verse8Ads } from "@verse8/ads";

/**
 * The one rewarded ad: gold in the middle of a run.
 *
 * Opt-in only - the player presses a button that says an ad is coming - and
 * once a run. There are no interstitials: nothing takes the game away from a
 * player who did not ask.
 *
 * The Agent8 sandbox cannot verify an ad server-side, so `showRewarded`
 * resolving is the client's word. That is fine here: run gold lives only in
 * the client's own simulation and is never saved, so the ad hands over
 * nothing that was not already the client's to give.
 */

export const AD_PLACEMENT = { goldReward: "gold-reward" } as const;

/** True when the player watched the ad through to the reward. */
export async function watchGoldAd(): Promise<boolean> {
  // The preview runs outside the Verse8 shell, where no ad can fill: it
  // pretends one did, so the button can be tried.
  if (import.meta.env.DEV && !adsLikelyAvailable()) return true;
  try {
    const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT.goldReward });
    return result.status === "rewarded";
  } catch {
    // No ad filled, no network, or not inside the Verse8 shell. Never a
    // reward, and never an exception the caller has to handle.
    return false;
  }
}

/** Whether an ad could be shown here: inside the Verse8 frame, or the dev preview. */
export function adsLikelyAvailable(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}

export function adButtonShown(): boolean {
  return adsLikelyAvailable() || import.meta.env.DEV;
}
