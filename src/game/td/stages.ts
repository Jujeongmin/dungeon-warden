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
  /** Fallen rock: in the way like bedrock, and drawn as a heap of rubble rather than a pillar. */
  rubble?: Array<{ x: number; y: number }>;
  startGold: number;
  lives: number;
  waves?: Wave[];
  waveAt?: (index: number) => Wave;
}

/** Everyone in a wave enters this many seconds apart. */
export const SPAWN_INTERVAL = 0.9;

/** Waves to a stage: the number a run is ranked by goes up every this many. */
export const WAVES_PER_STAGE = 5;

export const STARTING_LIVES = 5;
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

/**
 * Flyers in wave `index`: the third wave of every stage from the second
 * brings a few, more as the stages go. Mirrored in server.js (flyerCount).
 */
export function flyerCount(index: number): number {
  const stage = stageOfWave(index);
  if (stage < 2 || index % WAVES_PER_STAGE !== 2) return 0;
  return 2 + Math.floor(stage / 2);
}

/** Whether wave `index` is led by a champion: the last of every stage from the second. */
export function hasChampion(index: number): boolean {
  return stageOfWave(index) >= 2 && index % WAVES_PER_STAGE === WAVES_PER_STAGE - 1;
}

/** Health multiplier for wave `index`: steady growth, so a run always ends. */
export function waveToughness(index: number): number {
  return Math.round(2.2 * Math.pow(1.09, index) * 100) / 100;
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
  const flyers = flyerCount(index);
  if (flyers > 0) wave.push({ cls: "flyer", count: flyers, level, toughness });
  if (hasChampion(index)) {
    wave.push({ cls: pool[stage % pool.length], count: 1, level: level + 1, champion: true, toughness });
  }
  return wave;
}

/** A fixed room with two pillars, for the title demo and for tests that want one layout. */
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

type Tile = { x: number; y: number };

/** The rock shapes a room is strewn with, as offsets from a corner. */
const PILLAR_SHAPES: Tile[][] = [
  [{ x: 0, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
];

/** A small seeded generator (mulberry32), so a layout can be made again from its number. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether every open tile can be reached from the door: no sealed pockets of floor. */
function allConnected(w: number, h: number, rock: Set<number>, from: Tile): boolean {
  const seen = new Set<number>([from.y * w + from.x]);
  const queue = [from];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (rock.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen.size === w * h - rock.size;
}

/**
 * The endless room, with its rock thrown down anew for this run.
 *
 * A handful of pillars in assorted shapes and a few patches of rubble, kept
 * off the rows by the door and the core, apart from each other, and never
 * closing off any of the floor - so every run asks for a different maze, and
 * every one of them can be built.
 */
export function endlessStage(seed: number): Stage {
  const random = seeded(seed);
  const { w, h } = ENDLESS.arena;
  const entrance = { x: Math.floor(w / 2), y: 0 };
  const pick = (n: number) => Math.floor(random() * n);
  const inner = (x: number, y: number) => x >= 0 && x < w && y >= 2 && y < h - 2;

  for (let attempt = 0; attempt < 50; attempt++) {
    const rock = new Set<number>();
    /** Rock, and a tile's ring round it: the next pillar keeps out of it. */
    const kept = new Set<number>();
    const pillars = 3 + pick(3);
    for (let placed = 0, tries = 0; placed < pillars && tries < 200; tries++) {
      const shape = PILLAR_SHAPES[pick(PILLAR_SHAPES.length)];
      const ox = pick(w);
      const oy = 2 + pick(h - 4);
      const tiles = shape.map((t) => ({ x: ox + t.x, y: oy + t.y }));
      if (!tiles.every((t) => inner(t.x, t.y) && !kept.has(t.y * w + t.x))) continue;
      for (const t of tiles) {
        rock.add(t.y * w + t.x);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) kept.add((t.y + dy) * w + (t.x + dx));
      }
      placed += 1;
    }
    // The core is floor, so a room with no sealed pocket always has a way to it.
    if (!allConnected(w, h, rock, entrance)) continue;

    // Rubble blocks the way as rock does, so a patch that would seal off
    // any floor is left out.
    const rubble = new Set<number>();
    const patches = 2 + pick(2);
    for (let i = 0; i < patches; i++) {
      let x = pick(w);
      let y = 2 + pick(h - 4);
      const size = 1 + pick(2);
      const patch: number[] = [];
      for (let j = 0; j < size; j++) {
        const k = y * w + x;
        if (inner(x, y) && !rock.has(k) && !rubble.has(k)) patch.push(k);
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][pick(4)];
        x += dx;
        y += dy;
      }
      const all = new Set([...rock, ...rubble, ...patch]);
      if (allConnected(w, h, all, entrance)) for (const k of patch) rubble.add(k);
    }

    const tiles = (set: Set<number>) => [...set].sort((a, b) => a - b).map((k) => ({ x: k % w, y: Math.floor(k / w) }));
    return { ...ENDLESS, bedrock: tiles(rock), rubble: tiles(rubble) };
  }
  return ENDLESS;
}

