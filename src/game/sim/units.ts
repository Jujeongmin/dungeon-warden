import { LOOT_DAMAGE_BONUS, type AdventurerClass, type MinionType } from "../types";

export interface MinionStats {
  hp: number;
  damage: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Attack reach in tiles. */
  range: number;
}

/**
 * The shortest reach a minion may have.
 *
 * Everything the player places shoots. A minion standing beside the corridor
 * has to be able to hit what walks down it, because that is the only thing it
 * will ever get to do — adventurers do not stop for anything that is not
 * standing in their way. A melee convert with a one-tile reach would be a
 * purchase that does nothing unless it happens to be blocking, so its reach is
 * lifted to here.
 */
const MIN_REACH = 2.2;

export interface AdventurerStats {
  hp: number;
  damage: number;
  attackInterval: number;
  range: number;
  /** Tiles per second. */
  speed: number;
  /** Multiplier on damage taken from traps. Rogues know what to look for. */
  trapResistance: number;
}

/**
 * Mirrored in server.js for reward calculation. Keep the two in sync.
 *
 * Both shoot. The pair is a trade between reach and survival rather than
 * between melee and ranged: the warrior is twice the health at half the reach,
 * so it is what you put where the route runs close and the mage is what you
 * put where it does not.
 */
export const MINION_STATS: Record<Exclude<MinionType, "convert">, MinionStats> = {
  warrior: { hp: 90, damage: 9, attackInterval: 1.0, range: 2.4 },
  mage: { hp: 45, damage: 7, attackInterval: 1.4, range: 4.2 },
};

/**
 * The five classes the KayKit Adventurers pack ships.
 *
 * Each one asks the dungeon a different question: the knight tests whether a
 * blocker holds at all, the barbarian tests whether one is enough, the rogue
 * punishes trap-only builds, and the ranged classes chew through a blocker
 * from outside its own reach.
 */
export const ADVENTURER_STATS: Record<AdventurerClass, AdventurerStats> = {
  knight: {
    hp: 130, damage: 13, attackInterval: 1.1, range: 1.0, speed: 1.5,
    trapResistance: 1,
  },
  barbarian: {
    // Hits hardest, dies fastest to sustained damage.
    hp: 110, damage: 22, attackInterval: 1.3, range: 1.0, speed: 1.7,
    trapResistance: 1.15,
  },
  rogue: {
    // Fast and trap-aware: a corridor of spikes barely slows one down.
    hp: 85, damage: 11, attackInterval: 0.75, range: 1.0, speed: 2.1,
    trapResistance: 0.45,
  },
  mage: {
    // Outranges a blocking warrior, so it never gets a shot back.
    hp: 70, damage: 15, attackInterval: 1.6, range: 3.0, speed: 1.3,
    trapResistance: 1.2,
  },
  ranger: {
    hp: 80, damage: 10, attackInterval: 0.9, range: 3.8, speed: 1.6,
    trapResistance: 1,
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
    // A turned knight keeps everything else it had, but not a reach that would
    // leave it useless the moment it is not the thing in the way.
    range: Math.max(stats.range, MIN_REACH),
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
