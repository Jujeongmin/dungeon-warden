import type { StringKey } from "../i18n/strings";

export const TILE = {
  FLOOR: 1,
  ENTRANCE: 2,
  CORE: 3,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export type AdventurerClass = "knight" | "barbarian" | "rogue" | "mage" | "ranger" | "flyer";

export const ADVENTURER_LABEL: Record<AdventurerClass, StringKey> = {
  knight: "adv_knight",
  barbarian: "adv_barbarian",
  rogue: "adv_rogue",
  mage: "adv_mage",
  ranger: "adv_ranger",
  flyer: "adv_flyer",
};

/** How much larger a champion is drawn. The only thing that marks it on the board. */
export const CHAMPION_MODEL_SCALE = 1.35;

export type TrapType = "spike" | "rockfall" | "flame" | "arrow" | "web" | "poison" | "rune";

export const TRAP_COST: Record<TrapType, number> = {
  spike: 30,
  arrow: 35,
  rockfall: 45,
  flame: 55,
  web: 30,
  poison: 40,
  rune: 60,
};

export const TRAP_LABEL: Record<TrapType, StringKey> = {
  spike: "trap_spike",
  arrow: "trap_arrow",
  rockfall: "trap_rockfall",
  flame: "trap_flame",
  web: "trap_web",
  poison: "trap_poison",
  rune: "trap_rune",
};

/** What each trap does, for the build panel. */
export const TRAP_NOTE: Record<TrapType, StringKey> = {
  spike: "trap_spike_note",
  arrow: "trap_arrow_note",
  rockfall: "trap_rockfall_note",
  flame: "trap_flame_note",
  web: "trap_web_note",
  poison: "trap_poison_note",
  rune: "trap_rune_note",
};

/**
 * Permanent things a purchase grants, keyed by name. The server grants them
 * in $onItemPurchased; the client only reads them.
 */
export type Entitlements = Record<string, boolean>;

export const EMPTY_ENTITLEMENTS: Entitlements = {};
