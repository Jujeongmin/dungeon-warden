/**
 * Player preferences.
 *
 * These live in localStorage rather than the save: they describe this device
 * (how loud, how heavy to render), not the dungeon. Losing them costs nothing,
 * and writing them does not need a server round trip.
 */

import { detectLocale, type Locale } from "../i18n/strings";

export type Quality = "low" | "high";

/**
 * Mirrors RUN_SPEEDS in td/useStageRun.ts. Declared here rather than imported
 * so a preferences file does not depend on the run loop.
 */
export type RaidSpeed = 1 | 2 | 3;

export interface Settings {
  /**
   * Master volume, 0 to 1. Replaces an on/off switch: turning a game down is
   * a different wish from turning it off, and only one of them was available.
   */
  volume: number;
  /** The loop, on its own fader: it is the first thing a player turns down,
   *  and turning it down should not cost them the hits. */
  musicVolume: number;
  quality: Quality;
  /**
   * How fast waves run.
   *
   * Remembered because it is a preference, not a per-stage decision: a player
   * twenty stages in watches at 2x, and resetting to 1x every time makes them
   * say so again every time.
   */
  raidSpeed: RaidSpeed;
  locale: Locale;
  /** Set once the player has seen the opening explanation. */
  introSeen: boolean;
  /** Set when the player dismisses the step-by-step hints. */
  tutorialDone: boolean;
  /** Vibration on placing and on a life lost. A no-op where unsupported. */
  haptics: boolean;
}

const KEY = "dw.settings";

export const DEFAULT_SETTINGS: Settings = {
  volume: 1,
  musicVolume: 1,
  quality: "high",
  raidSpeed: 1,
  locale: "en",
  introSeen: false,
  tutorialDone: false,
  haptics: true,
};

export function loadSettings(): Settings {
  // First run follows the browser's language; after that the player's choice
  // wins, including a deliberate switch back to the browser default.
  const base: Settings = { ...DEFAULT_SETTINGS, locale: detectLocale() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const merged = { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
    // A speed that no longer exists falls back to the fastest free one.
    if (![1, 2, 3].includes(merged.raidSpeed)) merged.raidSpeed = 2;
    return merged;
  } catch {
    // Private browsing, blocked storage, or corrupt JSON.
    return base;
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
