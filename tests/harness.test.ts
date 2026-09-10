import { describe, expect, it } from "vitest";
import { addCost } from "../src/game/placements";

describe("test harness", () => {
  it("can import from src and run an assertion", () => {
    const cost = addCost(
      [{ id: "a", type: "spike", x: 1, y: 1 }],
      [],
      { spike: 30 },
    );
    expect(cost).toBe(30);
  });
});
