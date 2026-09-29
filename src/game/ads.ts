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

/**
 * Whether the host has told us it cannot show ads.
 *
 * The button used to be drawn only inside an iframe, which is how the web
 * shell runs a game - and is not how the mobile app runs one: there the game
 * is the top frame with a bridge injected into it, so the button simply never
 * appeared on a phone. So it is drawn everywhere and taken away only once the
 * SDK has actually answered `unsupported_env`.
 */
let unsupported = false;

/** Opens the handshake with the host early: see the SDK's note on caching it. */
export function initAds(): void {
  try {
    Verse8Ads.init();
  } catch {
    // Nothing to talk to. showRewarded will say so when it is pressed.
  }
}

export type AdOutcome = "rewarded" | "skipped" | "unavailable";

export async function watchGoldAd(): Promise<AdOutcome> {
  // The preview runs outside any Verse8 host, where no ad can fill: it
  // pretends one did, so the button can be tried.
  if (import.meta.env.DEV) return "rewarded";
  try {
    const result = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENT.goldReward });
    if (result.status === "rewarded") return "rewarded";
    if (result.status === "failed" && result.error.code === "unsupported_env") {
      unsupported = true;
      return "unavailable";
    }
    // Dismissed early, or the ad network had nothing: no reward, and the
    // button stays for another try.
    return "skipped";
  } catch {
    return "unavailable";
  }
}

/** Whether the ad button is worth drawing at all. */
export function adButtonShown(): boolean {
  return !unsupported;
}
