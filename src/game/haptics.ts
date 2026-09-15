/**
 * A buzz in the hand, where the device has one.
 *
 * The game is played on a phone held sideways, and until now it never once
 * used the one output a phone has that a screen does not. A swing, a blow
 * taken, a body lost: three moments a thumb should feel rather than read.
 *
 * Quietly nothing where it cannot be done - iOS Safari has no vibration at
 * all, desktops have nothing to vibrate, and a permissions policy can refuse
 * it - because a missing buzz is not a fault worth surfacing. Off entirely
 * when the player has turned it off in settings.
 */
export function buzz(enabled: boolean, pattern: number | number[]): void {
  if (!enabled) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* refused by the page's permissions policy */
  }
}

/** How each moment feels, in milliseconds on and off. */
export const BUZZ = {
  /** A swing: barely there, because it repeats. */
  swing: 14,
  /** A blow taken by the ridden body. */
  hurt: 40,
  /** The body lost: long enough to be unmistakable, broken so it is not a ring. */
  lost: [70, 50, 140],
};
