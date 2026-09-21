import type { AdventurerClass } from "../types";

/**
 * The adventurers, as a tower defence meets them.
 *
 * Nothing here fights back: towers do not die, so an adventurer is a body
 * that walks to the core and costs a life if it arrives. What tells them
 * apart is how much it takes to stop one and how fast it gets there - and the
 * rogue, who knows where the traps are.
 */
export interface EnemySpec {
  hp: number;
  /** Tiles per second. */
  speed: number;
  /** Gold for stopping one. */
  bounty: number;
  /** Multiplier on damage taken from traps. */
  trapResistance: number;
}

export const ENEMIES: Record<AdventurerClass, EnemySpec> = {
  knight: { hp: 45, speed: 1.3, bounty: 6, trapResistance: 1 },
  rogue: { hp: 30, speed: 2.0, bounty: 5, trapResistance: 0.5 },
  barbarian: { hp: 70, speed: 1.4, bounty: 8, trapResistance: 1.15 },
  ranger: { hp: 40, speed: 1.7, bounty: 7, trapResistance: 1 },
  mage: { hp: 55, speed: 1.15, bounty: 8, trapResistance: 1.2 },
};

/** Each level adds this share of the base health. */
export const LEVEL_HP_STEP = 0.2;

/** A champion: this much tougher, worth this much more, and this many lives. */
export const CHAMPION_HP = 6;
export const CHAMPION_BOUNTY = 6;
export const CHAMPION_LIVES = 2;

export function enemyHp(cls: AdventurerClass, level: number, champion = false): number {
  const base = ENEMIES[cls].hp * (1 + LEVEL_HP_STEP * Math.max(0, level - 1));
  return Math.round(champion ? base * CHAMPION_HP : base);
}

export function enemyBounty(cls: AdventurerClass, level: number, champion = false): number {
  // A little more for a tougher one, so later waves pay for their towers.
  const base = ENEMIES[cls].bounty + Math.floor((level - 1) / 2);
  return champion ? base * CHAMPION_BOUNTY : base;
}
