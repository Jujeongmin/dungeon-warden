import type { StringKey } from "../../i18n/strings";
import type { TowerType } from "./towers";

/**
 * What a cleared stage offers.
 *
 * A run used to be the same run every time: the same gold, the same towers,
 * the same opening. Every stage cleared now deals three of these and the
 * player keeps one, so the run grows in a direction they chose and two runs
 * are rarely the same.
 *
 * Deliberately plain: every card is drawn from one pool with the same chance
 * as any other, none is rarer than another, and none is ever bought. They
 * last one run.
 */
export interface Boon {
  id: string;
  label: StringKey;
  note: StringKey;
  /** File under public/assets/boons. */
  icon: string;
  /** Multiplies the damage of these towers. */
  towerDamage?: { types: TowerType[]; scale: number };
  /** Multiplies every tower's damage. */
  allDamage?: number;
  /** Adds to every tower's reach, in tiles. */
  range?: number;
  /** Every tower fires this much faster, like a shaman's aura. */
  haste?: number;
  /** A guard's slow takes this much more off, and lasts this much longer. */
  chill?: { slow: number; seconds: number };
  /** Multiplies the gold a kill pays. */
  killGold?: number;
  /** Adds to the gold a cleared wave pays. */
  waveBonus?: number;
  /** Paid once, the moment the card is taken. */
  instantGold?: number;
  /** Multiplies what towers cost to place and upgrade (and so what they sell for). */
  towerCost?: number;
  /** Multiplies trap damage. */
  trapDamage?: number;
  /** Multiplies what traps cost. */
  trapCost?: number;
  /** Multiplies how long a burn or a poison lasts. */
  dotSeconds?: number;
  /** Lives added the moment the card is taken. */
  lives?: number;
}

export const BOONS: Boon[] = [
  { id: "bone_arrows", label: "boon_bone_arrows", note: "boon_bone_arrows_n", icon: "bone_arrows.png", towerDamage: { types: ["warrior", "crossbow"], scale: 1.25 } },
  { id: "arcane", label: "boon_arcane", note: "boon_arcane_n", icon: "arcane.png", towerDamage: { types: ["mage"], scale: 1.3 } },
  { id: "rage", label: "boon_rage", note: "boon_rage_n", icon: "rage.png", towerDamage: { types: ["berserker", "grunt"], scale: 1.35 } },
  { id: "chill", label: "boon_chill", note: "boon_chill_n", icon: "chill.png", chill: { slow: 0.15, seconds: 0.5 } },
  { id: "reach", label: "boon_reach", note: "boon_reach_n", icon: "reach.png", range: 0.5 },
  { id: "haste", label: "boon_haste", note: "boon_haste_n", icon: "haste.png", haste: 0.12 },
  { id: "grave_robbing", label: "boon_grave", note: "boon_grave_n", icon: "grave_robbing.png", killGold: 1.2 },
  { id: "tribute", label: "boon_tribute", note: "boon_tribute_n", icon: "tribute.png", waveBonus: 15 },
  { id: "hoard", label: "boon_hoard", note: "boon_hoard_n", icon: "hoard.png", instantGold: 120 },
  { id: "cheap_bones", label: "boon_cheap_bones", note: "boon_cheap_bones_n", icon: "cheap_bones.png", towerCost: 0.8 },
  { id: "fine_traps", label: "boon_fine_traps", note: "boon_fine_traps_n", icon: "fine_traps.png", trapDamage: 1.4 },
  { id: "mass_traps", label: "boon_mass_traps", note: "boon_mass_traps_n", icon: "mass_traps.png", trapCost: 0.65 },
  { id: "venom", label: "boon_venom", note: "boon_venom_n", icon: "venom.png", dotSeconds: 1.5 },
  { id: "thick_walls", label: "boon_thick_walls", note: "boon_thick_walls_n", icon: "thick_walls.png", lives: 1 },
];

export const BOONS_BY_ID = new Map(BOONS.map((b) => [b.id, b]));

/** How many are offered at a time. */
export const BOON_CHOICES = 3;

/** What a run's cards add up to. Every card can come again and stack. */
export interface BoonState {
  /** Damage multiplier per tower type. */
  damage: Record<TowerType, number>;
  range: number;
  haste: number;
  chillSlow: number;
  chillSeconds: number;
  killGold: number;
  waveBonus: number;
  towerCost: number;
  trapDamage: number;
  trapCost: number;
  dotSeconds: number;
  /** Ids taken, in order, for the run's summary. */
  taken: string[];
}

export function emptyBoons(): BoonState {
  return {
    damage: { warrior: 1, mage: 1, guard: 1, grunt: 1, crossbow: 1, berserker: 1, shaman: 1 },
    range: 0,
    haste: 0,
    chillSlow: 0,
    chillSeconds: 0,
    killGold: 1,
    waveBonus: 0,
    towerCost: 1,
    trapDamage: 1,
    trapCost: 1,
    dotSeconds: 1,
    taken: [],
  };
}

/** Folds one card into the run's totals. Gold and lives are paid by the caller. */
export function addBoon(state: BoonState, boon: Boon): void {
  state.taken.push(boon.id);
  if (boon.towerDamage) for (const type of boon.towerDamage.types) state.damage[type] *= boon.towerDamage.scale;
  if (boon.allDamage) for (const type of Object.keys(state.damage) as TowerType[]) state.damage[type] *= boon.allDamage;
  if (boon.range) state.range += boon.range;
  if (boon.haste) state.haste += boon.haste;
  if (boon.chill) {
    state.chillSlow += boon.chill.slow;
    state.chillSeconds += boon.chill.seconds;
  }
  if (boon.killGold) state.killGold *= boon.killGold;
  if (boon.waveBonus) state.waveBonus += boon.waveBonus;
  if (boon.towerCost) state.towerCost *= boon.towerCost;
  if (boon.trapDamage) state.trapDamage *= boon.trapDamage;
  if (boon.trapCost) state.trapCost *= boon.trapCost;
  if (boon.dotSeconds) state.dotSeconds *= boon.dotSeconds;
}

/**
 * Three cards to choose between, drawn without repeats inside one deal.
 *
 * `random` is passed in so a test can deal a known hand; every card has the
 * same chance as every other.
 */
export function dealBoons(random: () => number = Math.random, count = BOON_CHOICES): Boon[] {
  const pool = [...BOONS];
  const hand: Boon[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    hand.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return hand;
}
