import type { StringKey } from "../i18n/strings";
import type { DugTile } from "./dig";

export const TILE = {
  FLOOR: 1,
  ENTRANCE: 2,
  CORE: 3,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

/** `convert` is a turned adventurer: only the server may create one. */
export type MinionType = "warrior" | "mage" | "guard" | "grunt" | "convert";

export interface PlacedMinion {
  id: string;
  type: MinionType;
  x: number;
  y: number;
  /** Epoch ms until which a minion killed in a raid stays down. */
  revivesAt?: number | null;
  /** Converts keep the class and level they had as an adventurer. */
  cls?: AdventurerClass;
  level?: number;
  /** Id of the looted weapon this minion carries. */
  weaponId?: string | null;
}

export interface LootItem {
  id: string;
  /** The class it was taken from, which decides how it looks. */
  srcCls: AdventurerClass;
  tier: number;
}

/** Damage multiplier a looted weapon grants, by tier. */
export const LOOT_DAMAGE_BONUS = 0.15;

export interface Prisoner {
  advId: string;
  cls: AdventurerClass;
  name: string;
  level: number;
  /** Epoch ms at which this prisoner joins the roster as a convert. */
  convertsAt: number;
}

export type AdventurerState = "town" | "raiding" | "captured" | "converted";

/** A named adventurer that persists across raids and levels up after losing. */
export interface AdventurerRecord {
  id: string;
  cls: AdventurerClass;
  name: string;
  level: number;
  state: AdventurerState;
  /** Epoch ms before which this adventurer will not raid again. */
  returnsAt: number;
  raids: number;
}

export type TrapType = "spike" | "rockfall" | "flame" | "arrow";

export interface PlacedTrap {
  id: string;
  type: TrapType;
  x: number;
  y: number;
}

/** Rooms occupy a fixed 2x2 block of corridor tiles anchored at (x, y). */
export type RoomType = "barracks" | "workshop" | "treasury" | "vault" | "altar" | "jail";

export interface PlacedRoom {
  id: string;
  type: RoomType;
  x: number;
  y: number;
}

export const ROOM_SIZE = 2;

export type WardenSkill = "blessing" | "rally" | "detonate";

export type AdventurerClass = "knight" | "barbarian" | "rogue" | "mage" | "ranger";

export const ADVENTURER_LABEL: Record<AdventurerClass, StringKey> = {
  knight: "adv_knight",
  barbarian: "adv_barbarian",
  rogue: "adv_rogue",
  mage: "adv_mage",
  ranger: "adv_ranger",
};

/**
 * The order classes join the roster in as threat rises, so a new dungeon only
 * ever faces knights. Mirrored from `ADVENTURER_CLASSES` in server.js.
 */
export const ADVENTURER_CLASSES: AdventurerClass[] = [
  "knight", "barbarian", "rogue", "ranger", "mage",
];

/**
 * Threat at which the party starts arriving with a leader.
 *
 * This is the `tier_company` milestone, deliberately: the tiers already
 * existed and already changed the party, but they changed it by adding a
 * fourth identical figure to a line of three. Nothing on screen said the
 * dungeon had graduated. A champion says it in one look.
 *
 * Mirrored in server.js.
 */
export const CHAMPION_THREAT = 9;

/**
 * What leading the party is worth.
 *
 * Enough health that it outlives the grunts behind it and has to be dealt
 * with on purpose, and only a modest damage bump - a champion that also hit
 * like two adventurers would delete a blocker before the traps ever fired.
 * Mirrored in server.js, which pays the bounty.
 */
export const CHAMPION_HP_SCALE = 2.4;

/** How much larger the champion is drawn. The only thing that marks it. */
export const CHAMPION_MODEL_SCALE = 1.35;
export const CHAMPION_DAMAGE_SCALE = 1.35;

export interface PartyMember {
  id: string;
  cls: AdventurerClass;
  name: string;
  level: number;
  /** Leads the party: tougher, worth more, and drawn larger. */
  champion?: boolean;
}

export interface Dungeon {
  version: number;
  /**
   * Every tile taken out of the rock. Absent on a dungeon saved before the
   * room was carved rather than built, and derived from `obstacles` then.
   */
  dug?: DugTile[];
  /**
   * The walls a dungeon was built with before it was carved.
   *
   * Read once, to work out what such a save had dug, and never written
   * again — see digFromWalls. Nothing in the game places one any more.
   */
  obstacles?: Array<{ id: string; type: string; x: number; y: number }>;
  minions: PlacedMinion[];
  traps: PlacedTrap[];
  rooms: PlacedRoom[];
  loot: LootItem[];
  prisoners: Prisoner[];
  adventurers: AdventurerRecord[];
  research: string[];
  entrance: { x: number; y: number };
  core: { x: number; y: number };
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}

export interface RaidStartResult {
  /** Set on the raid that first arrives at a named tier. */
  milestoneReached?: string | null;
  raidId: string;
  seed: number;
  /** The first wave. Older servers send only this. */
  party: PartyMember[];
  /**
   * Every wave, in order. Absent from a server that predates waves, and the
   * client falls back to treating `party` as the whole raid - so the game
   * keeps working against a deployment that has not caught up yet.
   */
  waves?: PartyMember[][];
  threat: number;
  /** Minions still reviving sit the raid out; the server decides who fights. */
  availableMinionIds: string[];
  /** Free cells left in the jail, which caps how many can be taken alive. */
  jailFree: number;
}

/** Aggregated room bonuses. Computed on the server, echoed to the client. */
export interface RoomEffects {
  minionCap: number;
  trapCooldownScale: number;
  plunderScale: number;
  reviveScale: number;
  treasuryCount: number;
  jailCapacity: number;
}

export interface RaidFinishResult {
  outcome: RaidOutcome;
  reward: number;
  plundered: number;
  /**
   * The part of the reward that is not earnings but a floor. Already inside
   * `reward`; carried apart so the result can say which is which. See
   * src/game/relief.ts. Absent from a server that predates it.
   */
  relief?: number;
  /** Paid for adventurers the warden put down itself. Already inside `reward`. */
  wardenBonus?: number;
  /** How many of those there were. */
  wardenDowns?: number;
  gold: number;
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
  minions?: PlacedMinion[];
  loot?: LootItem[];
  lootGained?: LootItem[];
  prisoners?: Prisoner[];
  capturedNames?: string[];
  /** The party leader was killed or taken. Paid a bounty, and worth saying. */
  championStopped?: boolean;
  adventurers?: AdventurerRecord[];
  /** Offline preview result: counters are not real and are hidden. */
  local?: boolean;
}

export type RaidOutcome = "repelled" | "breached";

/**
 * Permanent things a purchase grants, keyed by name.
 *
 * Empty right now: the one product that existed removed interstitial ads, and
 * there are no interstitials to remove any more. The plumbing stays because
 * the hard part of it is the server's $onItemPurchased handler, which grants
 * exactly once however many times Verse8 retries the callback.
 */
export type Entitlements = Record<string, boolean>;

export const EMPTY_ENTITLEMENTS: Entitlements = {};

export interface LoadResult {
  dungeon: Dungeon;
  entitlements: Entitlements;
  gold: number;
  created: boolean;
  account?: string;
}


export interface SaveResult {
  ok: true;
  cost: number;
  gold: number;
  savedAt: number;
}

/** Kept in sync with server.js. */
export const MAX_MINIONS = 8;

export const MINION_COST: Record<MinionType, number> = {
  warrior: 50,
  mage: 70,
  guard: 80,
  grunt: 25,
  // Converts are earned by capturing, never bought.
  convert: 0,
};

/** Translation keys rather than text, so content names follow the locale. */
export const MINION_LABEL: Record<MinionType, StringKey> = {
  warrior: "minion_warrior",
  mage: "minion_mage",
  guard: "minion_guard",
  grunt: "minion_grunt",
  convert: "minion_convert",
};

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

export const MAX_TRAPS = 10;

export const ROOM_COST: Record<RoomType, number> = {
  treasury: 100,
  vault: 110,
  barracks: 120,
  altar: 130,
  workshop: 140,
  jail: 150,
};

export const ROOM_LABEL: Record<RoomType, StringKey> = {
  treasury: "room_treasury",
  vault: "room_vault",
  barracks: "room_barracks",
  altar: "room_altar",
  workshop: "room_workshop",
  jail: "room_jail",
};

export const ROOM_DESCRIPTION: Record<RoomType, StringKey> = {
  treasury: "room_treasury_desc",
  vault: "room_vault_desc",
  barracks: "room_barracks_desc",
  altar: "room_altar_desc",
  workshop: "room_workshop_desc",
  jail: "room_jail_desc",
};

export const MAX_ROOMS = 6;

/**
 * What each one does, in the fewest words it can be said in.
 *
 * The buttons carried a name and a readiness state and nothing else, so three
 * pieces of flavour sat in the corner of a raid the player had no way to read.
 * A name tells you which button; this tells you why you would press it.
 */
export const SKILL_NOTE: Record<WardenSkill, StringKey> = {
  blessing: "skill_blessing_note",
  rally: "skill_rally_note",
  detonate: "skill_detonate_note",
};

export const SKILL_LABEL: Record<WardenSkill, StringKey> = {
  blessing: "skill_blessing",
  rally: "skill_rally",
  detonate: "skill_detonate",
};
