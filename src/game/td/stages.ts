import type { Arena } from "../arena";
import type { AdventurerClass } from "../types";

/** One kind of adventurer in a wave: how many, and how strong. */
export interface WaveGroup {
  cls: AdventurerClass;
  count: number;
  level: number;
  champion?: boolean;
  /** Health multiplier on top of level. */
  toughness?: number;
}

export type Wave = WaveGroup[];

/**
 * A room to defend and what comes at it.
 *
 * The game has one of these, endless: its waves come from `waveAt` and never
 * run out. A fixed list of `waves` is still accepted, for the title demo and
 * for tests that want a short fight.
 */
export interface Stage {
  arena: Arena;
  /** Rock nothing can stand on or walk through. */
  bedrock: Array<{ x: number; y: number }>;
  startGold: number;
  lives: number;
  waves?: Wave[];
  waveAt?: (index: number) => Wave;
}

/** Everyone in a wave enters this many seconds apart. */
export const SPAWN_INTERVAL = 0.9;

/** Waves to a stage: the number a run is ranked by goes up every this many. */
export const WAVES_PER_STAGE = 5;

export const STARTING_LIVES = 20;
export const START_GOLD = 150;

/** Gold for clearing wave `index` (0-based). */
export function waveBonus(index: number): number {
  return 10 + 3 * Math.min(index, 30);
}

/** Which stage a wave belongs to, 1-based. */
export function stageOfWave(index: number): number {
  return Math.floor(index / WAVES_PER_STAGE) + 1;
}

/** The order classes join the waves in, one more each stage. */
const CLASSES: AdventurerClass[] = ["knight", "rogue", "barbarian", "ranger", "mage"];

/** Adventurers in wave `index`, champion aside. Mirrored in server.js (waveCount). */
export function waveCount(index: number): number {
  return 4 + Math.floor(index * 0.8);
}

/** Whether wave `index` is led by a champion: the last of every stage from the second. */
export function hasChampion(index: number): boolean {
  return stageOfWave(index) >= 2 && index % WAVES_PER_STAGE === WAVES_PER_STAGE - 1;
}

/** Health multiplier for wave `index`: steady growth, so a run always ends. */
export function waveToughness(index: number): number {
  return Math.round(2.2 * Math.pow(1.07, index) * 100) / 100;
}

/**
 * Wave `index` of the endless run.
 *
 * More of them each wave, a new class each stage, a level every three waves,
 * and health that compounds - so however good the maze, it is eventually not
 * good enough, and how far it got is the score.
 */
export function endlessWave(index: number): Wave {
  const stage = stageOfWave(index);
  const pool = CLASSES.slice(0, Math.min(CLASSES.length, stage));
  const count = waveCount(index);
  const level = 1 + Math.floor(index / 3);
  const toughness = waveToughness(index);
  const first = pool[index % pool.length];
  const second = pool[(index + 1) % pool.length];
  const wave: Wave =
    first === second
      ? [{ cls: first, count, level, toughness }]
      : [
          { cls: first, count: Math.ceil(count / 2), level, toughness },
          { cls: second, count: Math.floor(count / 2), level, toughness },
        ];
  if (hasChampion(index)) {
    wave.push({ cls: pool[stage % pool.length], count: 1, level: level + 1, champion: true, toughness });
  }
  return wave;
}

/** The room every run is played in. Open, with two pillars to build around. */
export const ENDLESS: Stage = {
  arena: { w: 12, h: 16 },
  bedrock: [
    { x: 3, y: 7 },
    { x: 8, y: 7 },
  ],
  startGold: START_GOLD,
  lives: STARTING_LIVES,
  waveAt: endlessWave,
};

/** How many adventurers a wave sends, all groups together. */
export function waveSize(wave: Wave): number {
  return wave.reduce((sum, group) => sum + group.count, 0);
}

/** Entrance and core: the middle of the top and bottom rows. */
export function stageEntrance(stage: Stage): { x: number; y: number } {
  return { x: Math.floor(stage.arena.w / 2), y: 0 };
}

export function stageCore(stage: Stage): { x: number; y: number } {
  return { x: Math.floor(stage.arena.w / 2), y: stage.arena.h - 1 };
}
