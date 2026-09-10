import type { StringKey } from "../i18n/strings";

export const TILE = {
  FLOOR: 1,
  ENTRANCE: 2,
  CORE: 3,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

/** `convert` is a turned adventurer: only the server may create one. */
export type MinionType = "warrior" | "mage" | "convert";

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

/** A wall the player puts down. Adventurers only attack one when sealed in. */
export type ObstacleType = "barricade" | "wall";

export interface PlacedObstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
}

/** Kept in sync with server.js. */
export const OBSTACLE_COST: Record<ObstacleType, number> = {
  barricade: 12,
  wall: 35,
};

export const BASE_MAX_OBSTACLES = 20;

/**
 * How many obstacles may stand at once.
 *
 * The budget rides on the expansion research rather than nodes of its own: a
 * bigger room with the same wall budget makes the maze thinner, not deeper, so
 * the two numbers have to move together.
 */
export function maxObstaclesFor(research: string[], entitlements?: Entitlements): number {
  let cap = BASE_MAX_OBSTACLES;
  if (research.includes("expand1")) cap = 28;
  if (research.includes("expand2")) cap = 36;
  // Mirrors ENTITLEMENT_OBSTACLES in server.js. The server's answer wins.
  if (entitlements && entitlements.extraObstacles) cap += 8;
  return cap;
}

export const OBSTACLE_LABEL: Record<ObstacleType, StringKey> = {
  barricade: "obstacle_barricade",
  wall: "obstacle_wall",
};

export const OBSTACLE_DESCRIPTION: Record<ObstacleType, StringKey> = {
  barricade: "obstacle_barricade_desc",
  wall: "obstacle_wall_desc",
};

export type WardenSkill = "blessing" | "rally" | "detonate";

export type AdventurerClass = "knight" | "barbarian" | "rogue" | "mage" | "ranger";

export const ADVENTURER_LABEL: Record<AdventurerClass, StringKey> = {
  knight: "adv_knight",
  barbarian: "adv_barbarian",
  rogue: "adv_rogue",
  mage: "adv_mage",
  ranger: "adv_ranger",
};

export interface PartyMember {
  id: string;
  cls: AdventurerClass;
  name: string;
  level: number;
}

export interface Dungeon {
  version: number;
  obstacles: PlacedObstacle[];
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
  party: PartyMember[];
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
  gold: number;
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
  minions?: PlacedMinion[];
  loot?: LootItem[];
  lootGained?: LootItem[];
  prisoners?: Prisoner[];
  capturedNames?: string[];
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
  // Converts are earned by capturing, never bought.
  convert: 0,
};

/** Translation keys rather than text, so content names follow the locale. */
export const MINION_LABEL: Record<MinionType, StringKey> = {
  warrior: "minion_warrior",
  mage: "minion_mage",
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

export const SKILL_LABEL: Record<WardenSkill, StringKey> = {
  blessing: "skill_blessing",
  rally: "skill_rally",
  detonate: "skill_detonate",
};
