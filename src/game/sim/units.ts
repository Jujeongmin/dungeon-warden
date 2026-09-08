import { LOOT_DAMAGE_BONUS, type AdventurerClass, type MinionType } from "../types";

export interface MinionStats {
  hp: number;
  damage: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Attack reach in tiles. */
  range: number;
  /** Melee minions body-block a corridor; ranged ones do not. */
  blocks: boolean;
}

export interface AdventurerStats {
  hp: number;
  damage: number;
  attackInterval: number;
  range: number;
  /** Tiles per second. */
  speed: number;
  /** Multiplier on damage taken from traps. Rogues know what to look for. */
  trapResistance: number;
  /** Ranged classes shoot the minion furthest from the front line instead of
   *  the nearest one, so they pick off mages hiding behind a wall of bone. */
  targetsBackline: boolean;
}

/** Mirrored in server.js for reward calculation. Keep the two in sync. */
export const MINION_STATS: Record<Exclude<MinionType, "convert">, MinionStats> = {
  warrior: { hp: 90, damage: 9, attackInterval: 1.0, range: 1.0, blocks: true },
  mage: { hp: 45, damage: 7, attackInterval: 1.4, range: 3.2, blocks: false },
};

/**
 * The five classes the KayKit Adventurers pack ships.
 *
 * Each one asks the dungeon a different question: the knight tests raw
 * blocking, the barbarian tests whether a single blocker is enough, the rogue
 * punishes trap-only builds, and the two ranged classes punish leaving squishy
 * minions where they can be shot.
 */
export const ADVENTURER_STATS: Record<AdventurerClass, AdventurerStats> = {
  knight: {
    hp: 130, damage: 13, attackInterval: 1.1, range: 1.0, speed: 1.5,
    trapResistance: 1, targetsBackline: false,
  },
  barbarian: {
    // Hits hardest, dies fastest to sustained damage.
    hp: 110, damage: 22, attackInterval: 1.3, range: 1.0, speed: 1.7,
    trapResistance: 1.15, targetsBackline: false,
  },
  rogue: {
    // Fast and trap-aware: a corridor of spikes barely slows one down.
    hp: 85, damage: 11, attackInterval: 0.75, range: 1.0, speed: 2.1,
    trapResistance: 0.45, targetsBackline: false,
  },
  mage: {
    // Outranges a warrior, so a lone blocker never gets to swing.
    hp: 70, damage: 15, attackInterval: 1.6, range: 3.0, speed: 1.3,
    trapResistance: 1.2, targetsBackline: true,
  },
  ranger: {
    hp: 80, damage: 10, attackInterval: 0.9, range: 3.8, speed: 1.6,
    trapResistance: 1, targetsBackline: true,
  },
};

/** Each level adds a flat percentage to an adventurer's hp and damage. */
export const ADVENTURER_LEVEL_SCALE = 0.12;

/**
 * Stats for one placed minion.
 *
 * A convert is a turned adventurer, so it keeps the class and level it had —
 * that is the whole appeal of taking one alive rather than killing it.
 * A looted weapon adds a flat damage bonus per tier.
 */
export function minionStatsFor(minion: {
  type: MinionType;
  cls?: AdventurerClass;
  level?: number;
}, weaponTier = 0): MinionStats {
  const base: MinionStats =
    minion.type === "convert"
      ? convertStats(minion.cls ?? "knight", minion.level ?? 1)
      : MINION_STATS[minion.type as Exclude<MinionType, "convert">];

  if (weaponTier <= 0) return base;
  return { ...base, damage: Math.round(base.damage * (1 + LOOT_DAMAGE_BONUS * weaponTier)) };
}

/** An adventurer fighting for the dungeon: same numbers, now on your side. */
function convertStats(cls: AdventurerClass, level: number): MinionStats {
  const stats = scaledAdventurer(cls, level);
  return {
    hp: stats.hp,
    damage: stats.damage,
    attackInterval: stats.attackInterval,
    range: stats.range,
    blocks: true,
  };
}

export function scaledAdventurer(cls: AdventurerClass, level: number): AdventurerStats {
  const base = ADVENTURER_STATS[cls];
  const factor = 1 + ADVENTURER_LEVEL_SCALE * (level - 1);
  return {
    ...base,
    hp: Math.round(base.hp * factor),
    damage: Math.round(base.damage * factor),
  };
}
