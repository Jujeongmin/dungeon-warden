import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A prisoner whose sentence is up joins the garrison only if there is room.
 *
 * Converting past the minion cap left a roster the server's own save check
 * refuses, so every save after it failed with TOO_MANY_MINIONS. server.js has
 * no exports, so resolveConversions is lifted out of its source and run with
 * small stand-ins for the helpers it calls.
 */

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function body(name: string): string {
  const start = server.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return server.slice(start, server.indexOf("\n}\n", start) + 2);
}

type Minion = { id: string; type: string; x: number; y: number };
type Prisoner = { advId: string; name: string; cls: string; level: number; convertsAt: number };
type Dungeon = { minions: Minion[]; traps: never[]; rooms: never[]; prisoners: Prisoner[]; adventurers: never[] };

const resolveConversions = Function(
  "entranceOf",
  "coreOf",
  "roomTiles",
  "dugOf",
  `${body("resolveConversions")}\nreturn resolveConversions;`,
)(
  () => ({ x: 0, y: 0 }),
  () => ({ x: 0, y: 9 }),
  () => [],
  () => Array.from({ length: 10 }, (_, y) => ({ x: 0, y })),
) as (dungeon: Dungeon, arena: unknown, now: number, cap: number) => { converted: unknown[] };

const prisoner = (id: string): Prisoner => ({ advId: id, name: id, cls: "knight", level: 1, convertsAt: 0 });
const garrison = (n: number): Minion[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: "warrior", x: 5, y: i }));
const dungeon = (minions: number, prisoners: Prisoner[]): Dungeon => ({
  minions: garrison(minions),
  traps: [],
  rooms: [],
  prisoners,
  adventurers: [],
});

describe("prisoner conversion", () => {
  it("keeps a due prisoner locked up while the garrison is full", () => {
    const d = dungeon(8, [prisoner("a")]);
    expect(resolveConversions(d, {}, 1000, 8).converted).toHaveLength(0);
    expect(d.minions).toHaveLength(8);
    expect(d.prisoners.map((p) => p.advId)).toEqual(["a"]);
  });

  it("fills only the free slots, and the rest wait", () => {
    const d = dungeon(7, [prisoner("a"), prisoner("b")]);
    expect(resolveConversions(d, {}, 1000, 8).converted).toHaveLength(1);
    expect(d.minions).toHaveLength(8);
    expect(d.prisoners.map((p) => p.advId)).toEqual(["b"]);
  });

  it("converts as before when there is room", () => {
    const d = dungeon(2, [prisoner("a"), prisoner("b")]);
    expect(resolveConversions(d, {}, 1000, 8).converted).toHaveLength(2);
    expect(d.prisoners).toHaveLength(0);
  });

  it("is given the cap at load", () => {
    expect(server).toContain("roomEffects(dungeon.rooms || [], entitlements).minionCap");
  });
});
