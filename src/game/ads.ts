import { Verse8Ads, type RewardedAdResult } from "@verse8/ads";

/** Placement ids. `gold-refill` must match AD_REWARD_TABLE in server.js. */
export const AD_PLACEMENT = {
  goldRefill: "gold-refill",
  afterSave: "after-save",
} as const;

/**
 * Interstitials are the ads the `remove_ads` product takes away, so they need a
 * ceiling even for players who have not bought it. Rewarded ads are opt-in and
 * are never suppressed.
 */
const INTERSTITIAL_MIN_INTERVAL_MS = 5 * 60_000;

let lastInterstitialAt = 0;

export function showGoldRefillAd(): Promise<RewardedAdResult> {
  return Verse8Ads.showRewarded({ placementId: AD_PLACEMENT.goldRefill });
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
    await Verse8Ads.showInterstitial({ placementId: AD_PLACEMENT.afterSave });
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
