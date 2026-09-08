/**
 * Player preferences.
 *
 * These live in localStorage rather than the save: they describe this device
 * (how loud, how heavy to render), not the dungeon. Losing them costs nothing,
 * and writing them does not need a server round trip.
 */

export type Quality = "low" | "high";

export interface Settings {
  muted: boolean;
  quality: Quality;
  /** Set once the player has seen the opening explanation. */
  introSeen: boolean;
  /** Set when the player dismisses the step-by-step hints. */
  tutorialDone: boolean;
}

const KEY = "dw.settings";

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  quality: "high",
  introSeen: false,
  tutorialDone: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Private browsing, blocked storage, or corrupt JSON.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* preferences stay per-session then */
  }
}

/** Device pixel ratio cap per quality level. */
export function pixelRatioFor(quality: Quality): number {
  return quality === "low" ? 1 : Math.min(window.devicePixelRatio, 2);
}
