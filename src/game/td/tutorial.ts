import type { StringKey } from "../../i18n/strings";

/** Where the guide is pointing. `null` means nowhere in particular. */
export type TutorialTarget =
  | { kind: "tool" | "action"; id: string }
  | { kind: "tile"; x: number; y: number }
  | null;

export interface TutorialContext {
  toolId: string;
  towers: number;
  wavesStarted: number;
  /** Whether the last wave started has been cleared. */
  waveCleared: boolean;
  upgraded: boolean;
}

export interface TutorialGuide {
  index: number;
  count: number;
  hint: StringKey;
  target: TutorialTarget;
  progress?: { done: number; of: number };
}

/** Towers the opening asks for before the first wave: enough to bend the road. */
export const TUTORIAL_TOWERS = 5;

interface Step {
  hint: StringKey;
  target?: TutorialTarget;
  progress?: (c: TutorialContext) => { done: number; of: number };
  done: (c: TutorialContext) => boolean;
}

/**
 * The first stage, taught in four beats.
 *
 * Each step reads the run rather than counting clicks, so a player who works
 * it out alone is never told to do what they already did. Nothing is locked
 * while it runs: it points and says, and the × puts it away.
 */
const STEPS: Step[] = [
  {
    hint: "tut_td_pick",
    target: { kind: "tool", id: "warrior" },
    done: (c) => c.toolId === "warrior" || c.towers >= TUTORIAL_TOWERS,
  },
  {
    hint: "tut_td_wall",
    progress: (c) => ({ done: Math.min(TUTORIAL_TOWERS, c.towers), of: TUTORIAL_TOWERS }),
    done: (c) => c.towers >= TUTORIAL_TOWERS,
  },
  {
    hint: "tut_td_wave",
    target: { kind: "action", id: "wave" },
    done: (c) => c.wavesStarted >= 1,
  },
  {
    hint: "tut_td_upgrade",
    done: (c) => c.upgraded || c.wavesStarted >= 3,
  },
];

export function tutorialFor(context: TutorialContext): TutorialGuide | null {
  const index = STEPS.findIndex((step) => !step.done(context));
  if (index < 0) return null;
  // The upgrade lesson waits until the first wave has paid for one.
  if (index === 3 && !context.waveCleared) return null;
  const step = STEPS[index];
  return {
    index,
    count: STEPS.length,
    hint: step.hint,
    target: step.target ?? null,
    progress: step.progress?.(context),
  };
}
