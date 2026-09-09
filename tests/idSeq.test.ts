import { describe, expect, it } from "vitest";
import { maxIdSuffix } from "../src/game/idSeq";

describe("maxIdSuffix", () => {
  it("returns 0 for an empty collection", () => {
    expect(maxIdSuffix([], "o")).toBe(0);
  });

  it("finds the highest numeric suffix for the given prefix", () => {
    expect(maxIdSuffix(["o1", "o3", "o2"], "o")).toBe(3);
  });

  it("ignores ids with a different prefix", () => {
    expect(maxIdSuffix(["m1", "m2"], "o")).toBe(0);
  });

  it("ignores ids with no numeric suffix, like a server-minted convert id", () => {
    // Converts are minted by the server as `c-<advId>` and live in the
    // minions collection alongside `m<n>` ids; they must not break parsing.
    expect(maxIdSuffix(["m1", "c-abc123", "m4"], "m")).toBe(4);
  });

  it("ignores an id that is only the bare prefix with no digits", () => {
    expect(maxIdSuffix(["o", "o5"], "o")).toBe(5);
  });

  it("reproduces the place-three, delete-two, reload, place-two scenario", () => {
    // Place o1, o2, o3, then delete o1 and o2, leaving only o3 saved.
    const loadedObstacles = [{ id: "o3" }];

    // The old (buggy) rule seeded the counter from a *count* of loaded
    // items, which forgets that "o3" is already in use.
    const buggySeed = loadedObstacles.length;
    expect(buggySeed).toBe(1);
    // Placing two more under the buggy rule mints "o2" (harmless here, since
    // o2 was deleted) and then "o3" again -- colliding with the o3 that is
    // still on the server, which is exactly the save-lockout bug.
    expect(`o${buggySeed + 1}`).toBe("o2");
    expect(`o${buggySeed + 2}`).toBe("o3");

    // The fixed rule seeds from the highest suffix actually present.
    const fixedSeed = maxIdSuffix(
      loadedObstacles.map((o) => o.id),
      "o",
    );
    expect(fixedSeed).toBe(3);
    // Placing two more now mints ids that were never in use.
    expect(`o${fixedSeed + 1}`).toBe("o4");
    expect(`o${fixedSeed + 2}`).toBe("o5");
  });
});
