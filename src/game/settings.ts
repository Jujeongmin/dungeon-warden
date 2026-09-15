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
 * Mirrors RAID_SPEEDS in useRaid.ts. Declared here rather than imported so a
 * preferences file does not depend on the raid loop.
 */
export type RaidSpeed = 1 | 2 | 4;

export interface Settings {
  /**
   * Master volume, 0 to 1. Replaces an on/off switch: turning a game down is
   * a different wish from turning it off, and only one of them was available.
   */
  volume: number;
  /** The background loop, separately from the cues: it is the first thing a
   *  player turns off, and turning it off should not cost them the hits. */
  /** The loop, on its own fader: it is the first thing a player turns down,
   *  and turning it down should not cost them the hits. */
  musicVolume: number;
  quality: Quality;
  /**
   * How fast raids run.
   *
   * Remembered because it is a preference, not a per-raid decision: a player
   * twenty raids in watches at 4x, and resetting to 1x every time makes them
   * say so again every time.
   */
  raidSpeed: RaidSpeed;
  locale: Locale;
  /** Set once the player has seen the opening explanation. */
  introSeen: boolean;
  /** Set when the player dismisses the step-by-step hints. */
  tutorialDone: boolean;
  /**
   * Set the first time the warden climbs into a minion, and the first time it
   * swings while in one.
   *
   * Two lines of coaching that only make sense mid-raid, so they cannot be
   * steps in the opening tutorial - it is finished long before the player has
   * a garrison to climb into. They show until the thing has been done once.
   */
  possessSeen: boolean;
  strikeSeen: boolean;
  /** Vibration on a swing, a blow taken, and a body lost. A no-op where unsupported. */
  haptics: boolean;
  /** Which warden skin to wear, if it is unlocked. See src/game/skins.ts. */
  wardenSkin: string;
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
  possessSeen: false,
  strikeSeen: false,
  haptics: true,
  wardenSkin: "imp",
};

export function loadSettings(): Settings {
  // First run follows the browser's language; after that the player's choice
  // wins, including a deliberate switch back to the browser default.
  const base: Settings = { ...DEFAULT_SETTINGS, locale: detectLocale() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
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
