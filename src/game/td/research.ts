import type { StringKey } from "../../i18n/strings";
import type { TrapType } from "../types";
import type { TowerType } from "./towers";

/**
 * What souls buy, for good.
 *
 * A run is played with gold that starts again every time; research is the
 * one thing that carries between runs. Every node is paid in souls, earned
 * one for each stage a run gets past, so a better run buys more - and there
 * are more nodes than a few runs pay for, so it is a choice.
 *
 * Mirrored in server.js (RESEARCH), which is what decides a purchase;
 * tests/td-server.test.ts checks the two agree.
 */
export interface ResearchNode {
  id: string;
  label: StringKey;
  note: StringKey;
  cost: number;
  requires?: string[];
  unlockTower?: TowerType;
  unlockTrap?: TrapType;
  /** Tiered: the best owned value applies, they do not stack. */
  towerDamage?: number;
  trapDamage?: number;
  startGold?: number;
  lives?: number;
}

export const RESEARCH: ResearchNode[] = [
  { id: "grunt", label: "res_grunt", note: "res_grunt_n", cost: 1, unlockTower: "grunt" },
  { id: "guard", label: "res_guard", note: "res_guard_n", cost: 2, unlockTower: "guard" },
  { id: "mage", label: "res_mage", note: "res_mage_n", cost: 3, unlockTower: "mage" },
  { id: "crossbow", label: "res_crossbow", note: "res_crossbow_n", cost: 3, unlockTower: "crossbow" },
  { id: "berserker", label: "res_berserker", note: "res_berserker_n", cost: 3, requires: ["grunt"], unlockTower: "berserker" },
  { id: "shaman", label: "res_shaman", note: "res_shaman_n", cost: 5, requires: ["mage"], unlockTower: "shaman" },
  { id: "trap_arrow", label: "res_trap_arrow", note: "res_trap_arrow_n", cost: 2, unlockTrap: "arrow" },
  { id: "trap_rock", label: "res_trap_rock", note: "res_trap_rock_n", cost: 3, requires: ["trap_arrow"], unlockTrap: "rockfall" },
  { id: "trap_flame", label: "res_trap_flame", note: "res_trap_flame_n", cost: 4, requires: ["trap_rock"], unlockTrap: "flame" },
  { id: "trap_web", label: "res_trap_web", note: "res_trap_web_n", cost: 2, unlockTrap: "web" },
  { id: "trap_poison", label: "res_trap_poison", note: "res_trap_poison_n", cost: 3, requires: ["trap_web"], unlockTrap: "poison" },
  { id: "trap_rune", label: "res_trap_rune", note: "res_trap_rune_n", cost: 5, requires: ["trap_poison"], unlockTrap: "rune" },
  { id: "might1", label: "res_might1", note: "res_might1_n", cost: 3, towerDamage: 0.1 },
  { id: "might2", label: "res_might2", note: "res_might2_n", cost: 5, requires: ["might1"], towerDamage: 0.2 },
  { id: "trap_power1", label: "res_tp1", note: "res_tp1_n", cost: 3, requires: ["trap_arrow"], trapDamage: 0.25 },
  { id: "trap_power2", label: "res_tp2", note: "res_tp2_n", cost: 5, requires: ["trap_power1"], trapDamage: 0.5 },
  { id: "chest1", label: "res_chest1", note: "res_chest1_n", cost: 2, startGold: 30 },
  { id: "chest2", label: "res_chest2", note: "res_chest2_n", cost: 4, requires: ["chest1"], startGold: 60 },
  { id: "walls", label: "res_walls", note: "res_walls_n", cost: 3, lives: 5 },
];

export const RESEARCH_BY_ID = new Map(RESEARCH.map((node) => [node.id, node]));

export interface ResearchEffects {
  towerDamageScale: number;
  trapDamageScale: number;
  startGold: number;
  lives: number;
  towers: TowerType[];
  traps: TrapType[];
}

const BASE_TOWERS: TowerType[] = ["warrior"];
const BASE_TRAPS: TrapType[] = ["spike"];

export function researchEffects(owned: string[]): ResearchEffects {
  let towerDamage = 0;
  let trapDamage = 0;
  let startGold = 0;
  let lives = 0;
  const towers = [...BASE_TOWERS];
  const traps = [...BASE_TRAPS];
  for (const id of owned) {
    const node = RESEARCH_BY_ID.get(id);
    if (!node) continue;
    if (node.towerDamage) towerDamage = Math.max(towerDamage, node.towerDamage);
    if (node.trapDamage) trapDamage = Math.max(trapDamage, node.trapDamage);
    if (node.startGold) startGold = Math.max(startGold, node.startGold);
    if (node.lives) lives = Math.max(lives, node.lives);
    if (node.unlockTower && !towers.includes(node.unlockTower)) towers.push(node.unlockTower);
    if (node.unlockTrap && !traps.includes(node.unlockTrap)) traps.push(node.unlockTrap);
  }
  return {
    towerDamageScale: 1 + towerDamage,
    trapDamageScale: 1 + trapDamage,
    startGold,
    lives,
    towers,
    traps,
  };
}

export function canResearch(node: ResearchNode, owned: string[]): boolean {
  if (owned.includes(node.id)) return false;
  return (node.requires ?? []).every((id) => owned.includes(id));
}

/** Souls left to spend: everything earned, less what research has taken. */
export function soulsToSpend(earned: number, owned: string[]): number {
  const spent = owned.reduce((sum, id) => sum + (RESEARCH_BY_ID.get(id)?.cost ?? 0), 0);
  return earned - spent;
}
