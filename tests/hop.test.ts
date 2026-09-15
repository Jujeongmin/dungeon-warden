import { describe, expect, it } from "vitest";
import { nextBody, type Rideable } from "../src/game/sim/hop";

/**
 * Walking the garrison from inside it.
 *
 * The order is the whole feature: a hop the player cannot predict is a
 * teleport, and one they can is how a single warden holds a line.
 */

const door = { x: 6, y: 0 };

const body = (id: string, y: number, alive = true, x = 6): Rideable => ({ id, x, y, alive });

describe("hopping between bodies", () => {
  it("goes front to back from the door, and wraps", () => {
    const garrison = [body("far", 9), body("near", 2), body("mid", 5)];
    expect(nextBody(garrison, "near", door)).toBe("mid");
    expect(nextBody(garrison, "mid", door)).toBe("far");
    expect(nextBody(garrison, "far", door)).toBe("near");
  });

  it("walks the same order backwards", () => {
    const garrison = [body("far", 9), body("near", 2), body("mid", 5)];
    expect(nextBody(garrison, "mid", door, -1)).toBe("near");
    expect(nextBody(garrison, "near", door, -1)).toBe("far");
  });

  it("skips a body with nobody left in it", () => {
    const garrison = [body("near", 2), body("mid", 5, false), body("far", 9)];
    expect(nextBody(garrison, "near", door)).toBe("far");
  });

  it("lands nearest the door when not riding anything yet", () => {
    const garrison = [body("far", 9), body("near", 2)];
    expect(nextBody(garrison, null, door)).toBe("near");
  });

  it("goes nowhere from the last body standing", () => {
    // Hopping back into itself would look like something happened.
    expect(nextBody([body("only", 4), body("gone", 6, false)], "only", door)).toBe(null);
  });

  it("goes nowhere when the whole garrison is down", () => {
    expect(nextBody([body("a", 2, false)], null, door)).toBe(null);
  });

  it("breaks a tie the same way every time", () => {
    // Two bodies the same distance from the door, either side of the road.
    const garrison = [body("b", 3, true, 7), body("a", 3, true, 5)];
    expect(nextBody(garrison, null, door)).toBe("a");
    expect(nextBody(garrison, "a", door)).toBe("b");
  });
});
