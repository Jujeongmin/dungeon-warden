import type { PlacedMinion, PlacedTrap } from "./types";

export interface TutorialContext {
  entrance: { x: number; y: number } | null;
  core: { x: number; y: number } | null;
  minions: PlacedMinion[];
  traps: PlacedTrap[];
  wavesRepelled: number;
  coreBreaches: number;
  /** Which tool is in hand, so a step can tell "pick it up" from "put it down". */
  toolId: string;
  /** Which drawer of the toolbar is open, so a step can ask for it to be opened. */
  group: string;
  /** How many tiles have been dug out, so a step can tell one from none. */
  dug: number;
  /** Whether one tile is already cut, so a step can point at the next one. */
  isDug: (x: number, y: number) => boolean;
  /** Whether the door can reach the core yet. */
  connected: boolean;
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
  /**
   * Which drawer of the toolbar that tool lives in.
   *
   * The toolbar only renders the tools of the open drawer, so a step naming a
   * tool in a closed one is pointing at a button that is not on screen. The
   * drawer used to be opened for the player; it is asked for instead, because
   * a tutorial that presses the buttons itself teaches where nothing is.
   */
  group?: string;
  /** Shown while that drawer is still shut. */
  groupHint?: string;
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
 * Each step is also two beats rather than one. "Dig a corridor" is a
 * sentence about the game; pointing at the dig button and then at the rock
 * is the game telling you where to put your thumb. The steps that place
 * something say which tool to pick up, wait until it is in hand, and only then
 * ask for the tap — which is the order the player has to do it in anyway.
 */
/**
 * Tiles in the straight corridor from the door to the core, once cut.
 *
 * The nook step is done when there are two more than that, which is the two
 * it asks for. Mirrors the arena height in src/game/arena.ts.
 */
const CORRIDOR_TILES = 12;

export const TUTORIAL: TutorialStep[] = [
  {
    id: "dig",
    tool: "dig",
    group: "dig",
    groupHint: "tut_dig_group",
    hint: "tut_dig_pick",
    placeHint: "tut_dig_place",
    /*
     * The way in, first.
     *
     * A dungeon starts as two tiles with rock between them, so before
     * anything else there has to be a corridor - and cutting it is the verb
     * the whole game is built on. Dragging digs a run of tiles, so this is
     * one gesture rather than ten taps.
     *
     * Points at the first tile still standing between the door and the core,
     * found by looking. It used to be counted - door plus however many tiles
     * had been dug - which is only right while the player digs in the one
     * order the sum assumes. Dig from the core end, or swipe past a tile the
     * browser did not report, and the ring sat on a tile with nothing to do
     * with the hole it left, which is exactly when a beginner needs it to be
     * right.
     */
    placeAt: ({ entrance, core, isDug }) => {
      if (!entrance || !core) return null;
      const step = Math.sign(core.y - entrance.y) || 1;
      for (let y = entrance.y + step; y !== core.y; y += step) {
        if (!isDug(entrance.x, y)) return { x: entrance.x, y };
      }
      return null;
    },
    done: ({ connected }) => connected,
  },
  {
    id: "nook",
    tool: "dig",
    group: "dig",
    groupHint: "tut_dig_group",
    hint: "tut_dig_pick",
    placeHint: "tut_nook_place",
    /*
     * Two nooks beside the corridor, near the core.
     *
     * This is the pattern the whole game is built on and it only exists
     * because the room is carved: a corridor one tile wide has no "beside
     * the road" to stand in, so a nook has to be cut for anything that is
     * meant to shoot down it without blocking it. Teaching the nook first
     * means the archer that follows has somewhere to go.
     *
     * Near the core because that is where two archers can hold - measured, in
     * tests/tutorial.test.ts. Near the door they would get two shots each as
     * the party walked past and the raid would be lost.
     */
    // Whichever side is still rock, asked rather than counted: no minion
    // exists yet at this step, so keying on minions.length aimed both nooks
    // at the same tile and left the second archer standing in rock - and a
    // count of dug tiles gets the side wrong the moment the player cuts
    // anything of their own.
    placeAt: ({ core, isDug }) => {
      if (!core) return null;
      const y = core.y - 3;
      if (!isDug(core.x + 1, y)) return { x: core.x + 1, y };
      if (!isDug(core.x - 1, y)) return { x: core.x - 1, y };
      return null;
    },
    done: ({ dug, connected }) => connected && dug >= CORRIDOR_TILES + 2,
  },
  {
    id: "minion",
    tool: "warrior",
    group: "minion",
    groupHint: "tut_minion_group",
    hint: "tut_minion_pick",
    placeHint: "tut_minion_place",
    /*
     * Two of them, and that is not padding - it is the first raid's arithmetic.
     *
     * Measured against a threat-0 party (one level-1 knight, 130hp): one
     * archer and a spike loses, and loses badly - the knight turns on the
     * archer, kills it in the seven seconds it takes, and walks into the core
     * with 31hp left. Two archers repel it in 16 seconds with both still
     * standing, for 142 of the 200 gold a new dungeon starts with.
     *
     * A tutorial whose own build loses teaches that the things it just sold
     * you do not work. See tests/tutorial.test.ts, which runs exactly this.
     *
     * Beside the route rather than on it. A minion in the road is a wall that
     * shoots, which is a real thing to build but not the first thing to teach:
     * the lesson here is that it fires at what walks past.
     */
    // Into the nooks that were just cut, in the order they were cut.
    placeAt: ({ core, minions }) =>
      core ? { x: core.x + (minions.length === 0 ? 1 : -1), y: core.y - 3 } : null,
    done: ({ minions }) => minions.length >= 2,
  },
  {
    id: "trap",
    tool: "spike",
    group: "trap",
    groupHint: "tut_trap_group",
    hint: "tut_trap_pick",
    placeHint: "tut_trap_place",
    // On the corridor itself, between the two nooks, so the trap and the
    // archers read as working together rather than as two separate purchases.
    placeAt: ({ core }) => (core ? { x: core.x, y: core.y - 3 } : null),
    done: ({ traps }) => traps.length > 0,
  },
  // There used to be a save step here. There is no save any more: placing
  // charges, clearing pays back, and the dungeon keeps itself - so the step
  // was teaching a button that no longer exists.
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
    /*
     * Three beats, in the order the hands do them: open the drawer, take the
     * tool, put it down. Each one points at exactly the thing that has to be
     * pressed next, and none of them presses it.
     */
    if (step.group && context.group !== step.group) {
      return {
        index,
        step,
        hint: step.groupHint ?? step.hint,
        target: { kind: "tool", id: `group-${step.group}` },
      };
    }

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
