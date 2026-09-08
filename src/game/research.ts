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
  { id: "mage", label: "res_mage", cost: 120, unlockMinion: "mage", note: "res_mage_n" },
  { id: "trap_arrow", label: "res_trap_arrow", cost: 90, unlockTrap: "arrow", note: "res_trap_arrow_n" },
  { id: "trap_rock", label: "res_trap_rock", cost: 160, requires: ["trap_arrow"], unlockTrap: "rockfall", note: "res_trap_rock_n" },
  { id: "trap_flame", label: "res_trap_flame", cost: 220, requires: ["trap_rock"], unlockTrap: "flame", note: "res_trap_flame_n" },

  { id: "room_barracks", label: "res_room_barracks", cost: 150, unlockRoom: "barracks", note: "res_room_barracks_n" },
  { id: "room_vault", label: "res_room_vault", cost: 160, unlockRoom: "vault", note: "res_room_vault_n" },
  { id: "room_workshop", label: "res_room_workshop", cost: 180, requires: ["trap_arrow"], unlockRoom: "workshop", note: "res_room_workshop_n" },
  { id: "room_altar", label: "res_room_altar", cost: 210, requires: ["room_barracks"], unlockRoom: "altar", note: "res_room_altar_n" },
  { id: "room_jail", label: "res_room_jail", cost: 240, requires: ["room_barracks"], unlockRoom: "jail", note: "res_room_jail_n" },

  { id: "might1", label: "res_might1", cost: 160, minionDamage: 0.1, note: "res_might1_n" },
  { id: "might2", label: "res_might2", cost: 320, requires: ["might1"], minionDamage: 0.2, note: "res_might2_n" },
  { id: "vigor1", label: "res_vigor1", cost: 160, minionHp: 0.15, note: "res_vigor1_n" },
  { id: "vigor2", label: "res_vigor2", cost: 320, requires: ["vigor1"], minionHp: 0.3, note: "res_vigor2_n" },
  { id: "trap_power1", label: "res_tp1", cost: 200, requires: ["trap_arrow"], trapDamage: 0.2, note: "res_tp1_n" },
  { id: "trap_power2", label: "res_tp2", cost: 400, requires: ["trap_power1"], trapDamage: 0.4, note: "res_tp2_n" },

  { id: "expand1", label: "res_expand1", cost: 420, expandTo: 16, note: "res_expand1_n" },
  { id: "expand2", label: "res_expand2", cost: 700, requires: ["expand1"], expandTo: 20, note: "res_expand2_n" },
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
