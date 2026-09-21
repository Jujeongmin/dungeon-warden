import { researchEffects, RESEARCH } from "./td/research";
import { StageRun } from "./td/StageRun";
import type { Stage, Wave } from "./td/stages";
import type { TowerType } from "./td/towers";
import type { AdventurerClass } from "./types";

/**
 * The fight behind the title screen.
 *
 * A room somebody has already walled into a switchback, and a party walking
 * the long way round it under fire: the game in one picture, before the
 * player has done anything. Played by the real stage simulation, so every
 * shot is one the game would fire. Nothing here is saved or sent anywhere.
 * See useTitleDemo for the loop.
 */

/** How long one party may take before the next is sent in. */
export const DEMO_MAX_SECONDS = 70;
/** The pause on an empty board between parties. */
export const DEMO_REST_MS = 2200;

const W = 12;
const H = 12;

/** Rows of towers across the room, gaps at alternating ends: the switchback. */
const ROWS: Array<{ y: number; gap: number }> = [
  { y: 2, gap: 0 },
  { y: 5, gap: W - 1 },
  { y: 8, gap: 0 },
];

/** Which tower stands where along a row, so the maze is not one colour. */
const MIX: TowerType[] = ["warrior", "warrior", "mage", "warrior", "guard", "warrior", "grunt"];

const CLASSES: AdventurerClass[] = ["knight", "rogue", "barbarian", "ranger", "mage"];

function demoStage(round: number): Stage {
  const pick = (i: number) => CLASSES[(round + i) % CLASSES.length];
  const wave: Wave = [
    { cls: pick(0), count: 4, level: 3 },
    { cls: pick(1), count: 3, level: 3 },
    { cls: pick(2), count: 1, level: 4, champion: round % 2 === 1 },
  ];
  return { id: 0, arena: { w: W, h: H }, bedrock: [], startGold: 100000, lives: 20, waves: [wave] };
}

export function createTitleDemo(round: number): StageRun {
  const run = new StageRun(demoStage(round), researchEffects(RESEARCH.map((n) => n.id)));
  let i = 0;
  for (const row of ROWS) {
    for (let x = 0; x < W; x++) {
      if (x === row.gap) continue;
      const type = MIX[i % MIX.length];
      if (run.placeTower(type, x, row.y).ok && (i + round) % 3 === 0) {
        run.upgradeTower(run.towers[run.towers.length - 1].id);
      }
      i += 1;
    }
  }
  run.startWave();
  return run;
}
