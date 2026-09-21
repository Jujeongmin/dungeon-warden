import type { StringKey } from "../../i18n/strings";

/**
 * The four towers, and what each is for.
 *
 * They were minions once - bodies that fought and died - and in a tower
 * defence nothing the player builds dies, so health means nothing and each
 * one needs a job instead:
 *
 *  - archer: the everyday tower, one arrow at a time at a fair range.
 *  - mage: slow, but the bolt bursts and hurts everything around the target.
 *  - guard: little damage, but what it hits is slowed, so everything else
 *    gets longer to shoot.
 *  - grunt: cheap and fast, with a short reach - for a corner the path turns.
 *
 * The type ids are the old minion ids so the models and their names carry
 * over unchanged.
 */
export type TowerType = "warrior" | "mage" | "guard" | "grunt";

export const TOWER_TYPES: TowerType[] = ["warrior", "mage", "guard", "grunt"];

export const MAX_TOWER_LEVEL = 3;

export interface TowerLevelStats {
  damage: number;
  /** Seconds between shots. */
  interval: number;
  /** Reach in tiles, centre to centre. */
  range: number;
  /** Mage: everything within this many tiles of the target is hit too. */
  splash?: number;
  /** Guard: what it hits moves at this share of its speed for a while. */
  slow?: number;
}

export interface TowerSpec {
  /** Price to place, then to reach level 2 and level 3. */
  cost: [number, number, number];
  levels: [TowerLevelStats, TowerLevelStats, TowerLevelStats];
  label: StringKey;
  note: StringKey;
}

/** How long a guard's slow lasts after each hit, in seconds. */
export const SLOW_SECONDS = 1.5;

/** Share of what a tower cost, placing and upgrades together, paid back on sale. */
export const SELL_REFUND = 0.7;

export const TOWERS: Record<TowerType, TowerSpec> = {
  warrior: {
    cost: [10, 30, 60],
    levels: [
      { damage: 6, interval: 0.9, range: 2.6 },
      { damage: 16, interval: 0.85, range: 2.9 },
      { damage: 32, interval: 0.8, range: 3.2 },
    ],
    label: "minion_warrior",
    note: "tower_warrior_note",
  },
  mage: {
    cost: [45, 40, 70],
    levels: [
      { damage: 14, interval: 1.6, range: 3.0, splash: 1.0 },
      { damage: 23, interval: 1.5, range: 3.2, splash: 1.1 },
      { damage: 38, interval: 1.4, range: 3.5, splash: 1.25 },
    ],
    label: "minion_mage",
    note: "tower_mage_note",
  },
  guard: {
    cost: [30, 30, 50],
    levels: [
      { damage: 4, interval: 1.0, range: 2.2, slow: 0.65 },
      { damage: 6, interval: 0.95, range: 2.4, slow: 0.55 },
      { damage: 9, interval: 0.9, range: 2.6, slow: 0.45 },
    ],
    label: "minion_guard",
    note: "tower_guard_note",
  },
  grunt: {
    cost: [12, 20, 35],
    levels: [
      { damage: 5, interval: 0.45, range: 1.6 },
      { damage: 8, interval: 0.42, range: 1.7 },
      { damage: 13, interval: 0.4, range: 1.8 },
    ],
    label: "minion_grunt",
    note: "tower_grunt_note",
  },
};

export function towerStats(type: TowerType, level: number): TowerLevelStats {
  const spec = TOWERS[type];
  return spec.levels[Math.min(MAX_TOWER_LEVEL, Math.max(1, level)) - 1];
}

/** Gold to take a tower from `level` to the next, or null at the top. */
export function upgradeCost(type: TowerType, level: number): number | null {
  if (level >= MAX_TOWER_LEVEL) return null;
  return TOWERS[type].cost[level];
}

/** Everything spent on a tower of this level. */
export function spentOn(type: TowerType, level: number): number {
  const cost = TOWERS[type].cost;
  let total = 0;
  for (let i = 0; i < Math.min(MAX_TOWER_LEVEL, level); i++) total += cost[i];
  return total;
}

export function sellValue(type: TowerType, level: number): number {
  return Math.floor(spentOn(type, level) * SELL_REFUND);
}
