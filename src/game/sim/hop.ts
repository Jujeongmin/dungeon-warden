/**
 * The next body to jump into, from the one being ridden.
 *
 * Changing bodies used to take four steps - out to the map, find the next
 * minion, tap it, back down - and a warden that has to leave the corridor to
 * move along it is riding one body at a time rather than holding a line. So
 * the garrison is put in an order the player can predict, and a key walks it.
 *
 * Front to back from the door, because that is the order a raid meets them in:
 * the next press is the next body along the road the adventurers are walking,
 * and the one after that is further in. Ties are broken by id so the order
 * never shuffles between two presses. The dead are skipped - there is nobody
 * in them to be.
 */

export interface Rideable {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

/**
 * Which body a hop lands in, or null when there is nowhere else to go.
 *
 * Not riding anything yet lands in the body nearest the door. Riding the only
 * body still standing goes nowhere, rather than hopping back into itself and
 * pretending something happened. `step` of -1 walks the order backwards.
 */
export function nextBody(
  bodies: Rideable[],
  currentId: string | null,
  door: { x: number; y: number },
  step: 1 | -1 = 1,
): string | null {
  const living = bodies
    .filter((body) => body.alive)
    .sort((a, b) => {
      const byDistance = distance(a, door) - distance(b, door);
      if (byDistance !== 0) return byDistance;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (living.length === 0) return null;

  const at = currentId === null ? -1 : living.findIndex((body) => body.id === currentId);
  if (at === -1) return living[0].id;
  if (living.length === 1) return null;

  return living[(at + step + living.length) % living.length].id;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
