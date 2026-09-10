import type { SimEvent } from "./sim/RaidSim";
import type { AftermathCell, AftermathMark } from "./DungeonRenderer";

/**
 * The record a raid leaves behind.
 *
 * Kept apart from the renderer and from App so it can be run against a real
 * simulation in a test: the map is only worth drawing if it points at the
 * tiles where the fighting actually happened, and that is a claim about the
 * event stream, not about three.js.
 */
export interface RaidTally {
  /** Damage dealt to the party, summed per tile, keyed "x,y". */
  heat: Map<string, number>;
  marks: AftermathMark[];
}

export function emptyTally(): RaidTally {
  return { heat: new Map(), marks: [] };
}

/**
 * Folds one drained batch of events into the running record.
 *
 * Burn ticks are counted like everything else. A flame tile that does its work
 * a point at a time over four seconds is doing exactly the work this map
 * exists to show, and dropping it because it is not a satisfying number would
 * make flame corridors look dead.
 */
export function recordEvents(tally: RaidTally, events: SimEvent[]): void {
  for (const event of events) {
    if (event.kind === "damage") {
      const key = `${Math.round(event.x)},${Math.round(event.y)}`;
      tally.heat.set(key, (tally.heat.get(key) ?? 0) + event.amount);
    } else if (event.kind === "minionDown") {
      tally.marks.push({ x: event.x, y: event.y, kind: "lost" });
    } else if (event.kind === "killed" || event.kind === "captured") {
      tally.marks.push({ x: event.x, y: event.y, kind: "fell" });
    }
  }
}

/**
 * The record as tiles to paint, or null when the raid left no record at all —
 * a party that walked from the door to the core untouched, which happens and
 * should draw nothing rather than a blank wash over the floor.
 *
 * Heat is normalised against the worst tile of this raid rather than an
 * absolute scale: the question the map answers is "where did the work happen",
 * and that has to read the same in a 40-damage raid and a 400-damage one.
 */
export function tallyCells(tally: RaidTally): AftermathCell[] | null {
  if (tally.heat.size === 0) return null;
  const worst = Math.max(1, ...tally.heat.values());
  return [...tally.heat].map(([key, amount]) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y, heat: amount / worst };
  });
}
