import type { ObstacleType } from "../types";

/**
 * How much punishment each obstacle absorbs.
 *
 * HP is the whole point of an obstacle: a sealed room buys the defender
 * exactly this many hit points of the attackers' time. It lives in the
 * simulation and is never saved — a raid starts with every standing obstacle
 * whole, and the ones that fall are removed from the dungeon afterwards.
 */
export const OBSTACLE_STATS: Record<ObstacleType, { hp: number }> = {
  barricade: { hp: 120 },
  wall: { hp: 380 },
};

export interface SimObstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}
