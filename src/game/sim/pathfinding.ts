import { TILE } from "../types";
import type { Grid } from "../grid";

export interface Point {
  x: number;
  y: number;
}

/** Tiles an adventurer can stand on. Rock is solid. */
function walkable(grid: Grid, x: number, y: number): boolean {
  if (!grid.inBounds(x, y)) return false;
  return grid.get(x, y) !== TILE.ROCK;
}

function key(x: number, y: number, w: number): number {
  return y * w + x;
}

/**
 * 4-directional A* over walkable tiles.
 *
 * Returns the tile sequence from `start` to `goal` inclusive, or null when the
 * player has walled the core off. The caller treats null as "raid cannot
 * start", which is what stops a sealed dungeon from being a free win.
 */
export function findPath(grid: Grid, start: Point, goal: Point): Point[] | null {
  if (!walkable(grid, start.x, start.y) || !walkable(grid, goal.x, goal.y)) {
    return null;
  }

  const w = grid.w;
  const total = grid.w * grid.h;

  const cameFrom = new Int32Array(total).fill(-1);
  const gScore = new Float64Array(total).fill(Infinity);
  const closed = new Uint8Array(total);

  const startKey = key(start.x, start.y, w);
  const goalKey = key(goal.x, goal.y, w);
  gScore[startKey] = 0;

  const heuristic = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  // A binary heap is overkill for grids this size; a linear scan over the open
  // set stays well under a millisecond at 24x24.
  const open: number[] = [startKey];
  const fScore = new Float64Array(total).fill(Infinity);
  fScore[startKey] = heuristic(start.x, start.y);

  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestIndex]]) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];

    if (current === goalKey) {
      const path: Point[] = [];
      let node = current;
      while (node !== -1) {
        path.push({ x: node % w, y: Math.floor(node / w) });
        node = cameFrom[node];
      }
      return path.reverse();
    }

    closed[current] = 1;
    const cx = current % w;
    const cy = Math.floor(current / w);

    for (const [dx, dy] of neighbours) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(grid, nx, ny)) continue;

      const neighbourKey = key(nx, ny, w);
      if (closed[neighbourKey]) continue;

      const tentative = gScore[current] + 1;
      if (tentative >= gScore[neighbourKey]) continue;

      cameFrom[neighbourKey] = current;
      gScore[neighbourKey] = tentative;
      fScore[neighbourKey] = tentative + heuristic(nx, ny);
      if (open.indexOf(neighbourKey) === -1) open.push(neighbourKey);
    }
  }

  return null;
}

/** True when the entrance still reaches the core. */
export function hasPathToCore(grid: Grid, entrance: Point, core: Point): boolean {
  return findPath(grid, entrance, core) !== null;
}

/**
 * The route a raiding party actually walks.
 *
 * Greed sends them through a treasury on the way in, which is the whole point
 * of building one: the detour drags them past more traps and minions, but a
 * breach costs more. When no treasury is reachable the party takes the direct
 * route instead.
 */
export function buildRaidPath(
  grid: Grid,
  entrance: Point,
  core: Point,
  lures: Point[],
): Point[] | null {
  const direct = findPath(grid, entrance, core);
  if (!direct || lures.length === 0) return direct;

  let best: Point[] | null = null;
  let bestLength = Infinity;

  for (const lure of lures) {
    const toLure = findPath(grid, entrance, lure);
    if (!toLure) continue;
    const toCore = findPath(grid, lure, core);
    if (!toCore) continue;

    // Nearest treasury wins; a party does not tour every vault in the dungeon.
    const combined = toLure.concat(toCore.slice(1));
    if (toLure.length < bestLength) {
      bestLength = toLure.length;
      best = combined;
    }
  }

  return best ?? direct;
}
