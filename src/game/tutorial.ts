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
  /** Which tool is in hand, so a step can tell "pick it up" from "put it down". */
  toolId: string;
}

/** Where the player is being sent. `null` means nowhere in particular. */
export type TutorialTarget =
  | { kind: "tool" | "action"; id: string }
  | { kind: "tile"; x: number; y: number }
  | null;

export interface TutorialStep {
  id: string;
  /** The tool this step is about, when the step is about placing something. */
  tool?: string;
  /** A button in the build panel, when the step is about pressing one. */
  action?: "save" | "raid";
  /** Translation key: shown while the control still has to be reached. */
  hint: string;
  /** Translation key: shown once the tool is in hand and the tap goes on the board. */
  placeHint?: string;
  /**
   * A tile worth putting it on.
   *
   * A suggestion, not a rule: the caller checks the tile is actually free and
   * drops the pointer if it is not, so a player who has already built there is
   * never sent somewhere they cannot go.
   */
  placeAt?: (context: TutorialContext) => { x: number; y: number } | null;
  /** True once the player has done the thing. */
  done: (context: TutorialContext) => boolean;
}

/**
 * A short guided opening.
 *
 * Each step checks game state rather than tracking clicks, so a player who
 * works it out on their own is never told to do something they already did,
 * and reloading mid-way does not lose the thread.
 *
 * Each step is also two beats rather than one. "Place an obstacle" is a
 * sentence about the game; pointing at the barricade button and then at the
 * floor is the game telling you where to put your thumb. The steps that place
 * something say which tool to pick up, wait until it is in hand, and only then
 * ask for the tap — which is the order the player has to do it in anyway.
 */
export const TUTORIAL: TutorialStep[] = [
  {
    id: "obstacle",
    tool: "barricade",
    hint: "tut_obstacle_pick",
    placeHint: "tut_obstacle_place",
    // Straight down the line they walk in on, two tiles from the door. A wall
    // anywhere folds the route, but a wall here folds it visibly.
    placeAt: ({ entrance }) => (entrance ? { x: entrance.x, y: entrance.y + 2 } : null),
    done: ({ obstacles }) => obstacles.length > 0,
  },
  {
    id: "minion",
    tool: "warrior",
    hint: "tut_minion_pick",
    placeHint: "tut_minion_place",
    // Beside the route rather than on it. A minion in the road is a wall that
    // shoots, which is a real thing to build but not the first thing to teach:
    // the lesson here is that it fires at what walks past.
    placeAt: ({ core }) => (core ? { x: core.x + 1, y: core.y - 3 } : null),
    done: ({ minions }) => minions.length > 0,
  },
  {
    id: "trap",
    tool: "spike",
    hint: "tut_trap_pick",
    placeHint: "tut_trap_place",
    // One tile in front of where the minion was suggested, so the two read as
    // working together rather than as two separate purchases.
    placeAt: ({ core }) => (core ? { x: core.x, y: core.y - 2 } : null),
    done: ({ traps }) => traps.length > 0,
  },
  {
    id: "save",
    action: "save",
    hint: "tut_save_hint",
    done: ({ hasUnsaved }) => !hasUnsaved,
  },
  {
    id: "raid",
    action: "raid",
    hint: "tut_raid_hint",
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

export interface TutorialGuide {
  index: number;
  step: TutorialStep;
  /** Translation key for the one line to show. */
  hint: string;
  target: TutorialTarget;
}

/**
 * What to say and where to point, right now.
 *
 * Returns null when the tutorial is finished, so the caller has one thing to
 * check rather than an index it has to compare against the list length.
 */
export function guideFor(context: TutorialContext): TutorialGuide | null {
  const index = currentStep(context);
  if (index >= TUTORIAL.length) return null;

  const step = TUTORIAL[index];

  if (step.tool) {
    // Already holding it: the next thing to do is on the board, and pointing
    // at a button the player has just pressed would be pointing backwards.
    const held = context.toolId === step.tool;
    const tile = held ? step.placeAt?.(context) : null;
    return {
      index,
      step,
      hint: held && step.placeHint ? step.placeHint : step.hint,
      target: held
        ? tile
          ? { kind: "tile", x: tile.x, y: tile.y }
          : null
        : { kind: "tool", id: step.tool },
    };
  }

  return {
    index,
    step,
    hint: step.hint,
    target: step.action ? { kind: "action", id: step.action } : null,
  };
}
