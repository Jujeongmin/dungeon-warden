import type { PlacedMinion, PlacedTrap } from "./types";
import type { Grid } from "./grid";
import { hasPathToCore } from "./sim/pathfinding";

export interface TutorialContext {
  grid: Grid | null;
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
    id: "dig",
    title: "길을 파세요",
    body: "암반 타일을 클릭하면 통로가 됩니다. 입구(초록)에서 코어(주황)까지 길이 이어져야 모험가가 들어옵니다.",
    done: ({ grid, entrance, core }) =>
      Boolean(grid && entrance && core && hasPathToCore(grid, entrance, core)),
  },
  {
    id: "minion",
    title: "부하를 세우세요",
    body: "스켈레톤 워리어를 통로에 배치하면 모험가를 붙잡아 둡니다. 함정은 붙잡아 둘 상대가 있어야 값어치를 합니다.",
    done: ({ minions }) => minions.length > 0,
  },
  {
    id: "trap",
    title: "함정을 놓으세요",
    body: "가시 함정을 부하 근처 통로에 설치하세요. 부하가 시간을 벌고 함정이 피해를 쌓는 조합이 기본입니다.",
    done: ({ traps }) => traps.length > 0,
  },
  {
    id: "save",
    title: "저장하세요",
    body: "변경 사항은 저장해야 서버에 반영됩니다. 침입은 저장된 던전으로만 시작할 수 있습니다.",
    done: ({ hasUnsaved }) => !hasUnsaved,
  },
  {
    id: "raid",
    title: "침입을 시작하세요",
    body: "모험가가 입구에서 코어로 향합니다. 전투는 자동이며, 워든 스킬 3개와 배속으로 개입합니다.",
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
