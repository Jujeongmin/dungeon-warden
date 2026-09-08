export const TILE = {
  ROCK: 0,
  FLOOR: 1,
  ENTRANCE: 2,
  CORE: 3,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export interface GridData {
  w: number;
  h: number;
  /** Run-length encoded cells: "count*tile,count*tile". */
  cells: string;
}

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

export type WardenSkill = "blessing" | "rally" | "detonate";

export type AdventurerClass = "knight" | "barbarian" | "rogue" | "mage" | "ranger";

export const ADVENTURER_LABEL: Record<AdventurerClass, string> = {
  knight: "기사",
  barbarian: "바바리안",
  rogue: "로그",
  mage: "메이지",
  ranger: "레인저",
};

export interface PartyMember {
  id: string;
  cls: AdventurerClass;
  name: string;
  level: number;
}

export interface Dungeon {
  version: number;
  grid: GridData;
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

export interface Entitlements {
  /** Granted only by the server's $onItemPurchased handler. */
  adsRemoved: boolean;
}

export const EMPTY_ENTITLEMENTS: Entitlements = { adsRemoved: false };

export interface LoadResult {
  dungeon: Dungeon;
  entitlements: Entitlements;
  gold: number;
  created: boolean;
  account?: string;
}

export type AdClaimResult =
  | { status: "granted"; reward: number; gold: number; remaining?: number }
  | { status: "duplicate"; gold: number }
  | { status: "capped"; gold: number; remaining: number }
  | { status: "pending" }
  | { status: "dismissed" }
  | { status: "failed" };

/** Product ids, mirrored from PRODUCTS in server.js and the Verse8 dashboard. */
export const PRODUCT_ID = {
  removeAds: "remove_ads",
} as const;

export interface SaveResult {
  ok: true;
  digs: number;
  cost: number;
  gold: number;
  savedAt: number;
}

/** Kept in sync with server.js. */
export const DIG_COST = 10;
export const MAX_DIGS_PER_SAVE = 64;
export const MAX_MINIONS = 8;

export const MINION_COST: Record<MinionType, number> = {
  warrior: 50,
  mage: 70,
  // Converts are earned by capturing, never bought.
  convert: 0,
};

export const MINION_LABEL: Record<MinionType, string> = {
  warrior: "스켈레톤 워리어",
  mage: "스켈레톤 메이지",
  convert: "전향한 모험가",
};

export const TRAP_COST: Record<TrapType, number> = {
  spike: 30,
  arrow: 35,
  rockfall: 45,
  flame: 55,
};

export const TRAP_LABEL: Record<TrapType, string> = {
  spike: "가시 함정",
  arrow: "화살 함정",
  rockfall: "낙석 함정",
  flame: "화염 함정",
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

export const ROOM_LABEL: Record<RoomType, string> = {
  treasury: "보물방",
  vault: "창고",
  barracks: "병영",
  altar: "제단",
  workshop: "작업장",
  jail: "감옥",
};

export const ROOM_DESCRIPTION: Record<RoomType, string> = {
  treasury: "침입자를 끌어들이고 격퇴 시 추가 골드. 위협도가 오릅니다.",
  vault: "돌파당했을 때 약탈량 감소.",
  barracks: "부하 배치 한도 +2.",
  altar: "쓰러진 부하의 부활 대기 단축.",
  workshop: "함정 재장전 속도 증가.",
  jail: "제압한 모험가를 생포해 가둡니다. 시간이 지나면 내 편이 됩니다.",
};

export const MAX_ROOMS = 6;

export const SKILL_LABEL: Record<WardenSkill, string> = {
  blessing: "어둠의 가호",
  rally: "집결",
  detonate: "강제 발동",
};
