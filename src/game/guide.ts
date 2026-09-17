import type { StringKey } from "../i18n/strings";
import { DIG_COST } from "./dig";
import { RELIEF_FLOOR } from "./relief";
import { RESEARCH_BY_ID } from "./research";
import { JAIL_CELLS_PER_ROOM } from "./rooms";
import { CAPTURE_RADIUS, DOWNED_SECONDS } from "./sim/RaidSim";
import { CHAMPION_THREAT, LOOT_DAMAGE_BONUS, MAX_MINIONS, MAX_ROOMS, MAX_TRAPS } from "./types";
import { VETERAN_HP_PER_RANK, VETERAN_RAIDS } from "./veteran";

/**
 * The rules the game plays by, told in a few lines each.
 *
 * Several of them - the revive timer, threat that drains while the dungeon is
 * quiet, the relief purse - ran for a long time without a word on screen, and
 * a player on a phone has no hover to discover them by. The guide says them
 * in one place, reachable from the title and from the top bar.
 */

/**
 * Numbers only the server holds, mirrored for the guide to quote.
 * tests/guide.test.ts reads server.js and fails when they drift apart.
 */
export const SERVER_RULES = {
  reviveSeconds: 90,
  threatDecayMinutes: 20,
  plunderPercent: 15,
  plunderCap: 120,
  convertSecondsPerLevel: 60,
  adventurerReturnSeconds: 90,
  barracksMinions: 2,
  treasuryGold: 25,
  championGold: 60,
} as const;

/** Mirrored from RaidSim's wave timeout, checked by the same test. */
export const WAVE_TIMEOUT_SECONDS = 180;

export type GuideSection = "basics" | "gold" | "minions" | "build" | "prison" | "party" | "warden" | "more";

export interface GuideLine {
  key: StringKey;
  vars?: Record<string, string | number>;
}

const percent = (share: number) => Math.round(share * 100);

export const GUIDE: Array<{ id: GuideSection; title: StringKey; lines: GuideLine[] }> = [
  {
    id: "basics",
    title: "guide_basics",
    lines: [
      { key: "guide_basics_1" },
      { key: "guide_basics_2" },
      { key: "guide_basics_3" },
      { key: "guide_basics_4" },
    ],
  },
  {
    id: "gold",
    title: "guide_gold",
    lines: [
      { key: "guide_gold_1", vars: { dig: DIG_COST } },
      {
        key: "guide_gold_2",
        vars: { per: SERVER_RULES.treasuryGold, champ: SERVER_RULES.championGold },
      },
      { key: "guide_gold_3", vars: { pct: SERVER_RULES.plunderPercent, cap: SERVER_RULES.plunderCap } },
      { key: "guide_gold_4", vars: { n: RELIEF_FLOOR } },
      { key: "guide_gold_5" },
    ],
  },
  {
    id: "minions",
    title: "guide_minions",
    lines: [
      { key: "guide_minions_1", vars: { n: MAX_MINIONS } },
      { key: "guide_minions_2" },
      { key: "guide_minions_3", vars: { s: SERVER_RULES.reviveSeconds } },
      {
        key: "guide_minions_4",
        vars: { raids: VETERAN_RAIDS.join("·"), hp: percent(VETERAN_HP_PER_RANK) },
      },
      { key: "guide_minions_5", vars: { pct: percent(LOOT_DAMAGE_BONUS) } },
    ],
  },
  {
    id: "build",
    title: "guide_build",
    lines: [
      { key: "guide_build_1", vars: { n: MAX_TRAPS } },
      { key: "guide_build_2", vars: { n: MAX_ROOMS } },
      { key: "guide_build_3", vars: { g: SERVER_RULES.treasuryGold } },
      { key: "guide_build_4", vars: { n: SERVER_RULES.barracksMinions } },
      { key: "guide_build_5" },
      { key: "guide_build_6" },
    ],
  },
  {
    id: "prison",
    title: "guide_prison",
    lines: [
      {
        key: "guide_prison_1",
        vars: { cost: RESEARCH_BY_ID.get("room_jail")?.cost ?? 0, cells: JAIL_CELLS_PER_ROOM },
      },
      { key: "guide_prison_2", vars: { down: DOWNED_SECONDS, r: CAPTURE_RADIUS } },
      { key: "guide_prison_3" },
      { key: "guide_prison_4", vars: { s: SERVER_RULES.convertSecondsPerLevel } },
      { key: "guide_prison_5" },
      { key: "guide_prison_6" },
      { key: "guide_prison_7" },
    ],
  },
  {
    id: "party",
    title: "guide_party",
    lines: [
      { key: "guide_party_1", vars: { m: SERVER_RULES.threatDecayMinutes } },
      { key: "guide_party_2", vars: { champ: CHAMPION_THREAT } },
      { key: "guide_party_3", vars: { s: SERVER_RULES.adventurerReturnSeconds } },
      { key: "guide_party_4", vars: { s: WAVE_TIMEOUT_SECONDS } },
      { key: "guide_party_5" },
    ],
  },
  {
    id: "warden",
    title: "guide_warden",
    lines: [
      { key: "guide_warden_1" },
      { key: "guide_warden_2" },
      { key: "guide_warden_3" },
      { key: "guide_warden_4" },
    ],
  },
  {
    id: "more",
    title: "guide_more",
    lines: [
      { key: "guide_more_1" },
      { key: "guide_more_2" },
      { key: "guide_more_3" },
      { key: "guide_more_4" },
    ],
  },
];
