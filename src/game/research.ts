import type { MinionType, RoomType, TrapType } from "./types";

export interface ResearchNode {
  id: string;
  label: string;
  cost: number;
  requires?: string[];
  unlockMinion?: MinionType;
  unlockTrap?: TrapType;
  unlockRoom?: RoomType;
  /** Tiered bonuses take the best owned value rather than stacking. */
  minionDamage?: number;
  minionHp?: number;
  trapDamage?: number;
  /** Widens the dungeon and pushes the core further back. */
  expandTo?: number;
  note?: string;
}

/**
 * Mirrored in server.js. The server is authoritative for what is unlocked and
 * what a node costs; this copy exists so the UI can grey things out without a
 * round trip.
 */
export const RESEARCH: ResearchNode[] = [
  { id: "mage", label: "강령술", cost: 120, unlockMinion: "mage", note: "스켈레톤 메이지 해금" },
  { id: "trap_arrow", label: "기계 장치", cost: 90, unlockTrap: "arrow", note: "화살 함정 해금" },
  { id: "trap_rock", label: "굴착 공학", cost: 160, requires: ["trap_arrow"], unlockTrap: "rockfall", note: "낙석 함정 해금" },
  { id: "trap_flame", label: "지옥불", cost: 220, requires: ["trap_rock"], unlockTrap: "flame", note: "화염 함정 해금" },

  { id: "room_barracks", label: "병영 설계", cost: 150, unlockRoom: "barracks", note: "병영 해금" },
  { id: "room_vault", label: "금고 설계", cost: 160, unlockRoom: "vault", note: "창고 해금" },
  { id: "room_workshop", label: "작업장 설계", cost: 180, requires: ["trap_arrow"], unlockRoom: "workshop", note: "작업장 해금" },
  { id: "room_altar", label: "제단 의식", cost: 210, requires: ["room_barracks"], unlockRoom: "altar", note: "제단 해금" },
  { id: "room_jail", label: "구속 의식", cost: 240, requires: ["room_barracks"], unlockRoom: "jail", note: "감옥 해금 — 생포가 가능해집니다" },

  { id: "might1", label: "뼈 단련 I", cost: 160, minionDamage: 0.1, note: "부하 공격력 +10%" },
  { id: "might2", label: "뼈 단련 II", cost: 320, requires: ["might1"], minionDamage: 0.2, note: "부하 공격력 +20%" },
  { id: "vigor1", label: "불사의 살점 I", cost: 160, minionHp: 0.15, note: "부하 체력 +15%" },
  { id: "vigor2", label: "불사의 살점 II", cost: 320, requires: ["vigor1"], minionHp: 0.3, note: "부하 체력 +30%" },
  { id: "trap_power1", label: "정밀 격발 I", cost: 200, requires: ["trap_arrow"], trapDamage: 0.2, note: "함정 피해 +20%" },
  { id: "trap_power2", label: "정밀 격발 II", cost: 400, requires: ["trap_power1"], trapDamage: 0.4, note: "함정 피해 +40%" },

  { id: "expand1", label: "심층 굴착 I", cost: 420, expandTo: 16, note: "던전 폭 12 → 16, 코어가 더 깊어집니다" },
  { id: "expand2", label: "심층 굴착 II", cost: 700, requires: ["expand1"], expandTo: 20, note: "던전 폭 16 → 20" },
];

export const RESEARCH_BY_ID = new Map(RESEARCH.map((node) => [node.id, node]));

export interface ResearchEffects {
  minionDamageScale: number;
  minionHpScale: number;
  trapDamageScale: number;
  unlockedMinions: MinionType[];
  unlockedTraps: TrapType[];
  unlockedRooms: RoomType[];
}

/** Available before any research. Everything else has to be earned. */
const BASE_MINIONS: MinionType[] = ["warrior", "convert"];
const BASE_TRAPS: TrapType[] = ["spike"];
const BASE_ROOMS: RoomType[] = ["treasury"];

/** Mirrors researchEffects() in server.js. */
export function researchEffects(owned: string[]): ResearchEffects {
  let minionDamage = 0;
  let minionHp = 0;
  let trapDamage = 0;

  const minions = [...BASE_MINIONS];
  const traps = [...BASE_TRAPS];
  const rooms = [...BASE_ROOMS];

  for (const id of owned) {
    const node = RESEARCH_BY_ID.get(id);
    if (!node) continue;

    // Tiers replace rather than stack, so owning I and II gives II.
    if (node.minionDamage) minionDamage = Math.max(minionDamage, node.minionDamage);
    if (node.minionHp) minionHp = Math.max(minionHp, node.minionHp);
    if (node.trapDamage) trapDamage = Math.max(trapDamage, node.trapDamage);

    if (node.unlockMinion && !minions.includes(node.unlockMinion)) minions.push(node.unlockMinion);
    if (node.unlockTrap && !traps.includes(node.unlockTrap)) traps.push(node.unlockTrap);
    if (node.unlockRoom && !rooms.includes(node.unlockRoom)) rooms.push(node.unlockRoom);
  }

  return {
    minionDamageScale: 1 + minionDamage,
    minionHpScale: 1 + minionHp,
    trapDamageScale: 1 + trapDamage,
    unlockedMinions: minions,
    unlockedTraps: traps,
    unlockedRooms: rooms,
  };
}

export function isAvailable(node: ResearchNode, owned: string[]): boolean {
  if (owned.includes(node.id)) return false;
  return (node.requires ?? []).every((id) => owned.includes(id));
}
