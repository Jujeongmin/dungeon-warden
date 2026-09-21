import type { Arena } from "../arena";
import { findPath } from "../sim/pathfinding";
import type { AdventurerClass } from "../types";

/** One kind of adventurer in a wave: how many, and how strong. */
export interface WaveGroup {
  cls: AdventurerClass;
  count: number;
  level: number;
  champion?: boolean;
  /** Health multiplier for this stage; see Recipe.toughness. */
  toughness?: number;
}

export type Wave = WaveGroup[];

export interface Stage {
  /** 1-based, in the order they unlock. */
  id: number;
  arena: Arena;
  /** Rock nothing can stand on or walk through: the stage's shape. */
  bedrock: Array<{ x: number; y: number }>;
  startGold: number;
  lives: number;
  waves: Wave[];
}

/** Everyone in a wave enters this many seconds apart. */
export const SPAWN_INTERVAL = 0.9;

/** Gold for clearing wave `index` (0-based). */
export function waveBonus(index: number): number {
  return 10 + 4 * index;
}

export const STARTING_LIVES = 20;

/** Stars for a win with this many lives left. */
export function starsFor(livesLeft: number, lives: number): number {
  if (livesLeft <= 0) return 0;
  if (livesLeft >= lives * 0.9) return 3;
  if (livesLeft >= lives * 0.5) return 2;
  return 1;
}

/** A filled rectangle of bedrock, inclusive. */
function rect(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles;
}

interface Recipe {
  h: number;
  bedrock?: Array<{ x: number; y: number }>;
  startGold: number;
  waves: number;
  /** Classes drawn on in turn, wave by wave. */
  classes: AdventurerClass[];
  /** Adventurers in the first wave, and how many more each wave brings. */
  count: number;
  countStep: number;
  /** Level of the first wave, and how many waves it takes to gain one. */
  level: number;
  levelEvery: number;
  /** A champion leads the last wave. */
  champion?: boolean;
  /** Multiplier on every adventurer's health in this stage. */
  toughness: number;
}

/**
 * The stages, written as recipes and expanded into waves.
 *
 * A recipe says how a stage grows rather than listing every adventurer, so
 * the difficulty curve is a handful of numbers per stage that can be tuned
 * together - see tests/td-balance.test.ts, which plays each one.
 */
const RECIPES: Recipe[] = [
  // 1: knights only, in an open room. Learn to wall and shoot.
  { h: 12, startGold: 160, waves: 6, classes: ["knight"], count: 3, countStep: 1, level: 1, levelEvery: 4, toughness: 2.2 },
  // 2: rogues arrive - fast, and they shrug off traps.
  { h: 12, startGold: 170, waves: 7, classes: ["knight", "rogue"], count: 4, countStep: 1, level: 1, levelEvery: 3, toughness: 2.42 },
  // 3: a wall across the middle forces a turn; the first champion.
  {
    h: 14, bedrock: rect(0, 6, 8, 6), startGold: 190, waves: 8,
    classes: ["knight", "rogue", "barbarian"], count: 4, countStep: 1, level: 1, levelEvery: 3, champion: true, toughness: 2.75,
  },
  // 4: two walls from alternate sides - a zigzag before anything is built.
  {
    h: 14, bedrock: [...rect(3, 4, 11, 4), ...rect(0, 9, 8, 9)], startGold: 200, waves: 8,
    classes: ["barbarian", "knight", "ranger"], count: 5, countStep: 1, level: 2, levelEvery: 3, champion: true, toughness: 3.08,
  },
  // 5: longer, and mages - slow and tough.
  {
    h: 16, bedrock: rect(4, 7, 7, 8), startGold: 210, waves: 9,
    classes: ["knight", "mage", "rogue", "barbarian"], count: 5, countStep: 1, level: 2, levelEvery: 3, champion: true, toughness: 3.41,
  },
  {
    h: 16, bedrock: [...rect(0, 5, 7, 5), ...rect(4, 10, 11, 10)], startGold: 220, waves: 10,
    classes: ["ranger", "rogue", "knight", "mage"], count: 6, countStep: 1, level: 3, levelEvery: 3, champion: true, toughness: 3.74,
  },
  {
    h: 18, bedrock: [...rect(2, 4, 3, 13), ...rect(8, 4, 9, 13)], startGold: 230, waves: 10,
    classes: ["barbarian", "mage", "ranger", "rogue", "knight"], count: 6, countStep: 1, level: 3, levelEvery: 2, champion: true, toughness: 3.3,
  },
  {
    h: 18, bedrock: [...rect(0, 4, 8, 4), ...rect(3, 8, 11, 8), ...rect(0, 12, 8, 12)], startGold: 240, waves: 11,
    classes: ["rogue", "barbarian", "mage", "ranger", "knight"], count: 7, countStep: 1, level: 4, levelEvery: 2, champion: true, toughness: 4.62,
  },
  {
    h: 20, bedrock: [...rect(5, 3, 6, 6), ...rect(0, 10, 4, 10), ...rect(7, 10, 11, 10), ...rect(5, 14, 6, 16)],
    startGold: 250, waves: 12,
    classes: ["mage", "barbarian", "ranger", "rogue", "knight"], count: 7, countStep: 1, level: 4, levelEvery: 2, champion: true, toughness: 3.9,
  },
  {
    h: 20, bedrock: [...rect(0, 4, 9, 4), ...rect(2, 8, 11, 8), ...rect(0, 12, 9, 12), ...rect(2, 16, 11, 16)],
    startGold: 260, waves: 12,
    classes: ["barbarian", "mage", "rogue", "ranger", "knight"], count: 8, countStep: 2, level: 5, levelEvery: 2, champion: true, toughness: 4.2,
  },
];

/** Throws if a stage's bedrock leaves no way from the door to the core. */
function checkOpen(arena: Arena, bedrock: Array<{ x: number; y: number }>): void {
  const blocked = new Set(bedrock.map((t) => t.y * arena.w + t.x));
  const door = { x: Math.floor(arena.w / 2), y: 0 };
  const core = { x: Math.floor(arena.w / 2), y: arena.h - 1 };
  if (!findPath(arena, door, core, blocked)) throw new Error(`stage bedrock seals the core: h=${arena.h}`);
}

function expand(recipe: Recipe, id: number): Stage {
  const waves: Wave[] = [];
  for (let i = 0; i < recipe.waves; i++) {
    const level = recipe.level + Math.floor(i / recipe.levelEvery);
    const count = recipe.count + recipe.countStep * i;
    // Two kinds a wave from the second on, so no wave is a column of clones.
    const first = recipe.classes[i % recipe.classes.length];
    const second = recipe.classes[(i + 1) % recipe.classes.length];
    const wave: Wave =
      i === 0 || first === second
        ? [{ cls: first, count, level, toughness: recipe.toughness }]
        : [
            { cls: first, count: Math.ceil(count / 2), level, toughness: recipe.toughness },
            { cls: second, count: Math.floor(count / 2), level, toughness: recipe.toughness },
          ];
    if (recipe.champion && i === recipe.waves - 1) {
      wave.push({ cls: recipe.classes[0], count: 1, level: level + 1, champion: true, toughness: recipe.toughness });
    }
    waves.push(wave);
  }
  const arena = { w: 12, h: recipe.h };
  const bedrock = recipe.bedrock ?? [];
  checkOpen(arena, bedrock);
  return {
    id,
    arena,
    bedrock,
    startGold: recipe.startGold,
    lives: STARTING_LIVES,
    waves,
  };
}

export const STAGES: Stage[] = RECIPES.map((recipe, i) => expand(recipe, i + 1));

export function stageById(id: number): Stage | null {
  return STAGES.find((stage) => stage.id === id) ?? null;
}

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
