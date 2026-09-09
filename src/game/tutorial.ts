import type { PlacedMinion, PlacedObstacle, PlacedTrap } from "./types";

export interface TutorialContext {
  obstacles: PlacedObstacle[];
  entrance: { x: number; y: number } | null;
  core: { x: number; y: number } | null;
  minions: PlacedMinion[];
  traps: PlacedTrap[];
  hasUnsaved: boolean;
  wavesRepelled: number;
  coreBreaches: number;
}

export interface TutorialStep {
  id: string;
  /** Translation keys; the UI resolves them against the active locale. */
  title: string;
  body: string;
  /** True once the player has done the thing. */
  done: (context: TutorialContext) => boolean;
}

/**
 * A short guided opening.
 *
 * Each step checks game state rather than tracking clicks, so a player who
 * works it out on their own is never told to do something they already did,
 * and reloading mid-way does not lose the thread.
 */
export const TUTORIAL: TutorialStep[] = [
  {
    id: "obstacle",
    title: "tut_obstacle_title",
    body: "tut_obstacle_body",
    done: ({ obstacles }) => obstacles.length > 0,
  },
  {
    id: "minion",
    title: "tut_minion_title",
    body: "tut_minion_body",
    done: ({ minions }) => minions.length > 0,
  },
  {
    id: "trap",
    title: "tut_trap_title",
    body: "tut_trap_body",
    done: ({ traps }) => traps.length > 0,
  },
  {
    id: "save",
    title: "tut_save_title",
    body: "tut_save_body",
    done: ({ hasUnsaved }) => !hasUnsaved,
  },
  {
    id: "raid",
    title: "tut_raid_title",
    body: "tut_raid_body",
    done: ({ wavesRepelled, coreBreaches }) => wavesRepelled + coreBreaches > 0,
  },
];

/** Index of the first unfinished step, or TUTORIAL.length when all are done. */
export function currentStep(context: TutorialContext): number {
  for (let i = 0; i < TUTORIAL.length; i++) {
    if (!TUTORIAL[i].done(context)) return i;
  }
  return TUTORIAL.length;
}
