import type { StringKey } from "../i18n/strings";

export const TILE = {
  FLOOR: 1,
  ENTRANCE: 2,
  CORE: 3,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export type AdventurerClass = "knight" | "barbarian" | "rogue" | "mage" | "ranger";

export const ADVENTURER_LABEL: Record<AdventurerClass, StringKey> = {
  knight: "adv_knight",
  barbarian: "adv_barbarian",
  rogue: "adv_rogue",
  mage: "adv_mage",
  ranger: "adv_ranger",
};

/** How much larger a champion is drawn. The only thing that marks it on the board. */
export const CHAMPION_MODEL_SCALE = 1.35;

export type TrapType = "spike" | "rockfall" | "flame" | "arrow";

export const TRAP_COST: Record<TrapType, number> = {
  spike: 30,
  arrow: 35,
  rockfall: 45,
  flame: 55,
};

export const TRAP_LABEL: Record<TrapType, StringKey> = {
  spike: "trap_spike",
  arrow: "trap_arrow",
  rockfall: "trap_rockfall",
  flame: "trap_flame",
};

/**
 * Permanent things a purchase grants, keyed by name. The server grants them
 * in $onItemPurchased; the client only reads them.
 */
export type Entitlements = Record<string, boolean>;

export const EMPTY_ENTITLEMENTS: Entitlements = {};
