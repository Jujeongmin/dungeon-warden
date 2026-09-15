import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADVENTURER_NAMES,
  MAX_ROSTER,
  classPool,
  hasChampion,
  partySize,
  previewParty,
} from "../src/game/party";
import { RaidSim } from "../src/game/sim/RaidSim";
import { partyMemberStats, scaledAdventurer } from "../src/game/sim/units";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import {
  ADVENTURER_CLASSES,
  CHAMPION_HP_SCALE,
  CHAMPION_THREAT,
  type AdventurerRecord,
} from "../src/game/types";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

function record(over: Partial<AdventurerRecord> = {}): AdventurerRecord {
  return {
    id: "a1",
    cls: "knight",
    name: "Aldric",
    level: 1,
    state: "town",
    returnsAt: 0,
    raids: 0,
    ...over,
  };
}

/*
 * The party preview is a mirror of pickParty in server.js, and a mirror that
 * nobody checks is a lie waiting to happen: the client would keep promising a
 * party the server stopped sending, and the bug would look like the preview
 * being "a bit off" rather than like a rule having changed.
 *
 * These read server.js as text. That is blunt, and it is deliberate — the
 * server runs in an isolated-vm sandbox with no exports, so it cannot be
 * imported, and pinning the literal source is the only thing that actually
 * fails when someone edits one side.
 */
describe("the client mirror of the server's party rules", () => {
  it("uses the same class order", () => {
    const line = server.match(/const ADVENTURER_CLASSES = \[(.*?)\];/s);
    expect(line).not.toBeNull();
    const classes = [...line![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(classes).toEqual(ADVENTURER_CLASSES);
  });

  it("uses the same recruit names, in the same order", () => {
    const block = server.match(/const ADVENTURER_NAMES = \[(.*?)\];/s);
    expect(block).not.toBeNull();
    const names = [...block![1].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(ADVENTURER_NAMES);
  });

  it("caps the roster at the same size", () => {
    expect(server).toContain(`const MAX_ROSTER = ${MAX_ROSTER};`);
  });

  it("grows the party on the same threat steps", () => {
    expect(server).toContain("const size = 1 + Math.min(4, Math.floor(threat / 3));");
    expect([0, 2, 3, 8, 9, 12, 30].map(partySize)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });

  it("unlocks classes on the same threat steps", () => {
    expect(server).toContain(
      "ADVENTURER_CLASSES.slice(0, 1 + Math.min(4, Math.floor(threat / 2)))",
    );
    expect(classPool(0)).toEqual(["knight"]);
    expect(classPool(8)).toEqual(ADVENTURER_CLASSES);
  });

  it("crowns a champion at the same threat", () => {
    expect(server).toContain(`const CHAMPION_THREAT = ${CHAMPION_THREAT};`);
    expect(hasChampion(CHAMPION_THREAT - 1)).toBe(false);
    expect(hasChampion(CHAMPION_THREAT)).toBe(true);
  });

  it("caps a veteran at the same level", () => {
    expect(server).toContain("const levelCap = recruitLevel(threat) + 1;");
    expect(server).toContain("level: Math.min(member.level, levelCap),");
    // Aldric died five times at threat 0: he still arrives at level 2.
    expect(previewParty([record({ level: 6 })], 0, 0)[0].level).toBe(2);
    expect(previewParty([record({ level: 6 })], 9, 0)[0].level).toBe(4);
  });

  it("recruits at the level the server would hire at", () => {
    expect(server).toContain("level: recruitLevel(threat),");
    expect(server).toContain("return 1 + Math.floor(Math.max(0, threat - 2) / 3);");
    // Level 1 until threat 5, then a step every three.
    expect([0, 4, 5, 7, 8, 9].map((t) => previewParty([], t, 0)[0].level)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe("previewParty", () => {
  // A fresh recruit at threat 9 hires in at level 3, which outranks a veteran
  // who has only lost once - so "strongest available" really does mean
  // strongest, not "whoever has been here longest".
  it("sends the strongest available first, so the leader is the best of them", () => {
    const roster = [
      record({ id: "a1", level: 2 }),
      record({ id: "a2", level: 7 }),
      record({ id: "a3", level: 4 }),
    ];
    const party = previewParty(roster, 9, 0);
    expect(party.map((m) => m.id)).toEqual(["a2", "a3", "preview-3", "a1"]);
    expect(party[0].champion).toBe(true);
  });

  it("leaves anyone still regrouping, or already raiding, out", () => {
    const roster = [
      record({ id: "a1", returnsAt: 500 }),
      record({ id: "a2", state: "raiding" }),
      record({ id: "a3", state: "converted" }),
      record({ id: "a4" }),
    ];
    expect(previewParty(roster, 0, 100).map((m) => m.id)).toEqual(["a4"]);
  });

  it("hires strangers to fill the gap, and marks them as strangers", () => {
    const party = previewParty([], 6, 0);
    expect(party).toHaveLength(3);
    expect(party.every((m) => !m.known)).toBe(true);
    expect(party.map((m) => m.name)).toEqual(["Aldric", "Brenna", "Cedric"]);
  });

  it("stops hiring at the roster cap rather than filling the party", () => {
    const roster = Array.from({ length: MAX_ROSTER }, (_, i) =>
      record({ id: `a${i}`, state: "raiding" }),
    );
    expect(previewParty(roster, 20, 0)).toHaveLength(0);
  });

  it("crowns nobody below the threshold, and exactly one above it", () => {
    expect(previewParty([], CHAMPION_THREAT - 1, 0).filter((m) => m.champion)).toHaveLength(0);
    expect(previewParty([], CHAMPION_THREAT, 0).filter((m) => m.champion)).toHaveLength(1);
  });

  it("does not touch the roster it was asked about", () => {
    const roster = [record({ id: "a1" })];
    const before = JSON.stringify(roster);
    previewParty(roster, 20, 0);
    expect(JSON.stringify(roster)).toBe(before);
  });
});

describe("the champion in the simulation", () => {
  it("carries the leader bonus, and only the leader carries it", () => {
    const plain = scaledAdventurer("knight", 4);
    expect(partyMemberStats("knight", 4, false)).toEqual(plain);
    expect(partyMemberStats("knight", 4, true).hp).toBe(
      Math.round(plain.hp * CHAMPION_HP_SCALE),
    );
  });

  it("arrives with the health the bonus says, not the level alone", () => {
    const arena = arenaFor([]);
    const sim = new RaidSim({
      minions: [], traps: [], arena,
      entrance: entranceOf(arena), core: coreOf(arena), lures: [], seed: 1,
      party: [
        { id: "boss", cls: "knight", name: "Aldric", level: 4, champion: true },
        { id: "grunt", cls: "knight", name: "Brenna", level: 4 },
      ],
    });
    const [boss, grunt] = sim.state.adventurers;
    expect(boss.champion).toBe(true);
    expect(grunt.champion).toBe(false);
    expect(boss.maxHp).toBe(Math.round(grunt.maxHp * CHAMPION_HP_SCALE));
  });
});
