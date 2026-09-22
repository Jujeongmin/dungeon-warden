import type { StringKey } from "../i18n/strings";
import { CHAMPION_LIVES } from "./td/enemies";
import { STARTING_LIVES } from "./td/stages";
import { SELL_REFUND, TOWERS } from "./td/towers";

/**
 * How the game works, told in a few lines each.
 *
 * Reachable from the title and from the top bar, and every line is a tap
 * away: a phone has no hover to discover rules by. Numbers come from the
 * tables that decide them, so a change there changes what is said here.
 */

export type GuideSection = "basics" | "towers" | "waves" | "research" | "more";

export interface GuideLine {
  key: StringKey;
  vars?: Record<string, string | number>;
  /** Said instead on a touch screen, where there are no keys to name. */
  touchKey?: StringKey;
}

export const GUIDE: Array<{ id: GuideSection; title: StringKey; lines: GuideLine[] }> = [
  {
    id: "basics",
    title: "guide_basics",
    lines: [
      { key: "guide_basics_1" },
      { key: "guide_basics_2" },
      { key: "guide_basics_3" },
      { key: "guide_basics_4" },
      { key: "guide_basics_5" },
    ],
  },
  {
    id: "towers",
    title: "guide_towers",
    lines: [
      { key: "guide_towers_1", vars: { c: TOWERS.warrior.cost[0] } },
      { key: "guide_towers_2" },
      { key: "guide_towers_3" },
      { key: "guide_towers_4" },
      { key: "guide_towers_7" },
      { key: "guide_towers_8" },
      { key: "guide_towers_9" },
      { key: "guide_towers_5", vars: { pct: Math.round(SELL_REFUND * 100) } },
      { key: "guide_towers_6" },
      { key: "guide_towers_10" },
    ],
  },
  {
    id: "waves",
    title: "guide_waves",
    lines: [
      { key: "guide_waves_1" },
      { key: "guide_waves_2", vars: { lives: STARTING_LIVES, champ: CHAMPION_LIVES } },
      { key: "guide_waves_3" },
      { key: "guide_waves_4" },
      { key: "guide_waves_5" },
    ],
  },
  {
    id: "research",
    title: "guide_research",
    lines: [{ key: "guide_research_1" }, { key: "guide_research_2" }, { key: "guide_research_3" }],
  },
  {
    id: "more",
    title: "guide_more",
    lines: [{ key: "guide_more_1" }, { key: "guide_more_2" }, { key: "guide_more_3" }],
  },
];
