import { RaidSim, SIM_DT } from "./sim/RaidSim";
import { findPath } from "./sim/pathfinding";
import { MINION_STATS, ADVENTURER_STATS, scaledAdventurer } from "./sim/units";

/**
 * Console handle for scripted testing and debugging.
 *
 * Only installed in development builds. It also exposes the simulation
 * primitives so a raid can be stepped deterministically without the animation
 * loop, which is how the combat rules are checked without relying on a visible
 * tab (requestAnimationFrame is frozen while a page is hidden).
 */
export function installDevTools(handle: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;

  (window as unknown as Record<string, unknown>).__dw = {
    ...handle,
    sim: { RaidSim, SIM_DT, findPath, MINION_STATS, ADVENTURER_STATS, scaledAdventurer },
  };
}

/**
 * Lets the console call any server function directly, which is how the
 * server-side paths get exercised without building UI for each one.
 */
export function installServerProbe(call: (fn: string, args: unknown[]) => Promise<unknown>): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__call = call;
}
