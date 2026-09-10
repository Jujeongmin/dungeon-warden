import { blockedKey, inArena, type Arena } from "./arena";
import { findPath, type Point } from "./sim/pathfinding";

/**
 * The rubble the room comes with.
 *
 * These were scenery: barrels and crates scattered by the renderer for looks,
 * invisible to everything else. They are terrain now. A prop occupies its
 * tile — nothing can be built on it and nobody can walk through it — so the
 * room the player is handed already has a shape to work with instead of being
 * a bare rectangle.
 *
 * That makes their placement a rule of the game rather than a detail of the
 * renderer, which is why it lives here: the scene, the placement checks, the
 * route preview and the simulation all read the same list, and it is derived
 * from the arena alone so every one of them derives the same one.
 */

export interface DecorProp {
  x: number;
  y: number;
  /** Model key, resolved by ModelLibrary. */
  key: string;
  /** Radians of yaw, so a row of barrels is not a row of identical barrels. */
  spin: number;
  /** Sub-tile offset, for the same reason. */
  offsetX: number;
  offsetZ: number;
}

const CLUTTER = ["prop_barrel", "prop_box", "prop_rubble", "prop_bottle", "prop_pillar"];
const CLUTTER_CHANCE = 0.14;

/**
 * Deterministic per-tile noise.
 *
 * FNV-1a over the coordinates and a salt. It has to be a pure function of the
 * tile: the renderer, the placement rules and the simulation each build this
 * list independently and they must agree exactly, and a save that is reloaded
 * tomorrow has to come back to the same room.
 */
export function tileNoise(x: number, y: number, salt: number): number {
  let hash = 0x811c9dc5;
  for (const value of [x + 1, y + 1, salt + 1]) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * The props in a room, in a fixed order.
 *
 * Guarantees a walk from the entrance to the core exists through them. The
 * noise is not going to seal a 12-wide room at 14% density often, but "not
 * often" is not a guarantee, and a room that cannot be entered is not a
 * playable room. Props are dropped in reverse order until a route opens, which
 * is deterministic and therefore agrees everywhere this runs.
 */
export function decorFor(arena: Arena, entrance: Point, core: Point): DecorProp[] {
  const props: DecorProp[] = [];

  for (let y = 0; y < arena.h; y++) {
    for (let x = 0; x < arena.w; x++) {
      // The two tiles the whole game is measured between stay clear.
      if (x === entrance.x && y === entrance.y) continue;
      if (x === core.x && y === core.y) continue;
      // Nor the tile in front of either, or a party can be sealed in at the
      // door by a single barrel and never take a step.
      if (x === entrance.x && y === entrance.y + 1) continue;
      if (x === core.x && y === core.y - 1) continue;

      if (tileNoise(x, y, 11) > CLUTTER_CHANCE) continue;

      props.push({
        x,
        y,
        key: CLUTTER[Math.floor(tileNoise(x, y, 13) * CLUTTER.length)],
        spin: tileNoise(x, y, 23) * Math.PI * 2,
        offsetX: (tileNoise(x, y, 17) - 0.5) * 0.4,
        offsetZ: (tileNoise(x, y, 19) - 0.5) * 0.4,
      });
    }
  }

  while (props.length > 0 && !connects(arena, entrance, core, props)) props.pop();
  return props;
}

/** The tiles those props stand on, ready to merge into a blocked set. */
export function decorBlocked(arena: Arena, entrance: Point, core: Point): Set<number> {
  const set = new Set<number>();
  for (const prop of decorFor(arena, entrance, core)) {
    set.add(blockedKey(prop.x, prop.y, arena.w));
  }
  return set;
}

function connects(arena: Arena, entrance: Point, core: Point, props: DecorProp[]): boolean {
  const blocked = new Set<number>();
  for (const prop of props) {
    if (inArena(arena, prop.x, prop.y)) blocked.add(blockedKey(prop.x, prop.y, arena.w));
  }
  return findPath(arena, entrance, core, blocked) !== null;
}
