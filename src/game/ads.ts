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
  afterRaid: "after-raid",
} as const;

/**
 * Interstitials are the ads the `remove_ads` product takes away. Rewarded ads
 * are opt-in and are never suppressed.
 */
const INTERSTITIAL_MIN_INTERVAL_MS = 5 * 60_000;

let lastInterstitialAt = 0;

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

/**
 * Shows an interstitial when the cooldown has elapsed and the player has not
 * bought ad removal. Returns whether an ad was actually shown.
 */
export async function maybeShowInterstitial(adsRemoved: boolean): Promise<boolean> {
  if (adsRemoved) return false;

  const now = Date.now();
  if (now - lastInterstitialAt < INTERSTITIAL_MIN_INTERVAL_MS) return false;
  lastInterstitialAt = now;

  try {
    await Verse8Ads.showInterstitial({ placementId: AD_PLACEMENT.afterRaid });
    return true;
  } catch {
    // A failed interstitial must never block the game.
    return false;
  }
}

/** Lets the UI hide ad entry points outside the Verse8 shell. */
export function adsLikelyAvailable(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}
