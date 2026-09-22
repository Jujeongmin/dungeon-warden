import type { Point } from "../src/game/sim/pathfinding";
import { StageRun } from "../src/game/td/StageRun";
import { researchEffects, RESEARCH } from "../src/game/td/research";
import { towerStats, TOWERS, upgradeCost, type TowerType } from "../src/game/td/towers";
import type { Stage } from "../src/game/td/stages";

/**
 * A plain, sensible player, for measuring the stages.
 *
 * Builds a maze the greedy way: each tower goes where it lengthens the route
 * most, ties broken by how much of the route it can shoot at. Spends what is
 * left on upgrades. No traps, no clever shapes - a floor a real player should
 * beat, so a stage it cannot win is a stage that asks for something more.
 */
export function playStage(
  stage: Stage,
  options: { research?: string[]; towers?: TowerType[]; maxSeconds?: number; plan?: "serpentine" | "greedy" | "flat" } = {},
) {
  const research = options.research ?? [];
  const run = new StageRun(stage, researchEffects(research));
  const mix: TowerType[] = options.towers ?? ["warrior"];
  const plan = options.plan ?? "serpentine";
  const order = plan === "serpentine" ? serpentine(run) : [];

  let built = 0;
  const spend = () => {
    for (let guard = 0; guard < 300; guard++) {
      const type = mix[built % mix.length];
      const cost = TOWERS[type].cost[0];
      const upgradable = run.towers
        .map((t) => ({ t, cost: upgradeCost(t.type, t.level) }))
        .filter((u): u is { t: typeof u.t; cost: number } => u.cost !== null)
        .sort((a, b) => a.cost - b.cost);
      // Serpentine falls back to the greedy spot once the rows are done or the
      // room's rock and rubble have broken them up: what a player would do.
      const spot = run.gold < cost
        ? null
        : plan === "serpentine"
          ? (nextInOrder(run, order) ?? bestSpot(run, towerStats(type, 1).range, true))
          : bestSpot(run, towerStats(type, 1).range, plan === "greedy");
      // The maze first; upgrades once there is nowhere left to wall.
      const upgradeFirst = spot === null && upgradable.length > 0;
      if (upgradeFirst && run.gold >= upgradable[0].cost) {
        run.upgradeTower(upgradable[0].t.id);
        continue;
      }
      if (spot && run.placeTower(type, spot.x, spot.y).ok) {
        built += 1;
        continue;
      }
      if (upgradable.length > 0 && run.gold >= upgradable[0].cost) {
        run.upgradeTower(upgradable[0].t.id);
        continue;
      }
      return;
    }
  };

  const maxSteps = ((options.maxSeconds ?? 4000) / 0.05) | 0;
  let steps = 0;
  spend();
  while (run.status !== "won" && run.status !== "lost" && steps < maxSteps) {
    if (run.status === "build") {
      spend();
      run.startWave();
    }
    run.step();
    steps += 1;
    if (steps % 40 === 0) spend();
  }
  return {
    status: run.status,
    lives: run.lives,
    lives0: run.lives0,
    towers: run.towers.length,
    route: run.route()?.length ?? 0,
    wavesCleared: run.wavesCleared,
    stage: Math.floor(run.wavesCleared / 5) + 1,
  };
}

/** The empty tile where a tower lengthens the route most, then covers most of it. */
function bestSpot(run: StageRun, range: number, maze: boolean): Point | null {
  const route = run.route();
  if (!route) return null;
  const { w, h } = run.stage.arena;
  let best: Point | null = null;
  let bestScore = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!run.isDug(x, y) || run.isRubble(x, y) || run.towerAt(x, y) || run.trapAt(x, y)) continue;
      if ((x === run.entrance.x && y === run.entrance.y) || (x === run.core.x && y === run.core.y)) continue;
      let cover = 0;
      for (const p of route) if (Math.hypot(p.x - x, p.y - y) <= range) cover += 1;
      const after = routeWith(run, x, y);
      if (after === null) continue;
      const gain = after - route.length;
      // Flat: only where it leaves the route as it is - towers beside the road.
      if (!maze && gain !== 0) continue;
      const score = gain * 3 + cover;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Route length with a tower at (x, y), or null if that seals it. */
function routeWith(run: StageRun, x: number, y: number): number | null {
  const probe = run as unknown as { towers: Array<{ x: number; y: number }> };
  probe.towers.push({ x, y } as never);
  const route = run.route();
  probe.towers.pop();
  return route ? route.length : null;
}

export const ALL_RESEARCH = RESEARCH.map((n) => n.id);

/**
 * Rows of towers across the room, every other row, each with its gap at the
 * opposite end to the last: the switchback every maze player builds first.
 * Built from the side, so each row turns the party a little more as it grows.
 */
function serpentine(run: StageRun): Point[] {
  // Rows on even or odd lines, whichever the room's rock and rubble break up
  // less: tried out on an empty copy of the room with gold to spare.
  let best: Point[] = [];
  let longest = -1;
  for (const first of [2, 3]) {
    const order = serpentineFrom(run, first);
    const trial = new StageRun({ ...run.stage, startGold: 1e6 }, researchEffects([]));
    // Judged on the maze the opening gold buys as well as the finished one:
    // rows whose first stretch leaves the road straight lose the first waves.
    let opening = 0;
    for (const tile of order) {
      if (trial.isRubble(tile.x, tile.y) || !trial.isDug(tile.x, tile.y)) continue;
      trial.placeTower("warrior", tile.x, tile.y);
      if (trial.towers.length === 15) opening = trial.route()?.length ?? 0;
    }
    const length = (trial.route()?.length ?? 0) + opening * 2;
    if (length > longest) {
      longest = length;
      best = order;
    }
  }
  return best;
}

function serpentineFrom(run: StageRun, first: number): Point[] {
  const { w, h } = run.stage.arena;
  const tiles: Point[] = [];
  let row = 0;
  for (let y = first; y <= h - 3; y += 2) {
    const gap = row % 2 === 0 ? 0 : w - 1;
    // From the wall's anchored end towards its gap: a wall half built from the
    // side already turns the party, where one started in the middle does not.
    const xs = Array.from({ length: w }, (_, x) => x).filter((x) => x !== gap);
    if (gap === w - 1) xs.reverse();
    xs.reverse();
    for (const x of xs) tiles.push({ x, y });
    row += 1;
  }
  return tiles;
}

function nextInOrder(run: StageRun, order: Point[]): Point | null {
  for (const tile of order) {
    if (!run.isDug(tile.x, tile.y) || run.isRubble(tile.x, tile.y) || run.towerAt(tile.x, tile.y)) continue;
    if (routeWith(run, tile.x, tile.y) === null) continue;
    return tile;
  }
  return null;
}

/** The better of the two maze plans: a stand-in for a player who adapts to the stage. */
export function bestPlay(stage: Stage, options: Parameters<typeof playStage>[1] = {}) {
  const a = playStage(stage, { ...options, plan: "serpentine" });
  const b = playStage(stage, { ...options, plan: "greedy" });
  const score = (r: typeof a) => (r.status === "won" ? 1000 + r.lives : r.wavesCleared);
  return score(a) >= score(b) ? a : b;
}
