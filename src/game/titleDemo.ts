import type { MarkerView, UnitView } from "./DungeonRenderer";
import { arenaFor, coreOf, entranceOf, type Arena } from "./arena";
import { dugSet, dugTile, rockSet, type DugTile } from "./dig";
import { RaidSim, type RaidState } from "./sim/RaidSim";
import {
  CHAMPION_MODEL_SCALE,
  type AdventurerClass,
  type PartyMember,
  type PlacedMinion,
  type PlacedTrap,
} from "./types";

/**
 * The fight behind the title screen.
 *
 * The title used to show the player's own dungeon, which for anyone new is a
 * door, a chest and a field of rock - a dark rectangle behind the menu. It now
 * shows a dungeon somebody has already built, with a party fighting its way
 * through it: the game in one picture, before the player has done anything.
 *
 * Run by the real simulation, so every blow is one the game would land.
 * Nothing here is saved or sent anywhere. See useTitleDemo for the loop.
 */

/** How long one fight may run before the next party is sent in. */
export const DEMO_MAX_SECONDS = 70;
/** The pause on an empty board between fights. */
export const DEMO_REST_MS = 2200;

/** A corridor that folds four times, so the party is always turning a corner. */
const ROUTE: Array<[number, number]> = [
  [6, 0], [6, 1], [6, 2], [5, 2], [4, 2], [3, 2], [2, 2],
  [2, 3], [2, 4], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5],
  [9, 6], [9, 7], [9, 8], [8, 8], [7, 8], [6, 8], [6, 9], [6, 10], [6, 11],
];

/** Nooks off the corridor, one tile deep, where the garrison shoots from. */
const NOOKS: Array<[number, number]> = [
  [4, 3], [1, 4], [7, 6], [10, 7], [5, 9],
];

const MINIONS: PlacedMinion[] = [
  { id: "demo-m1", type: "mage", x: 4, y: 3 },
  { id: "demo-m2", type: "warrior", x: 1, y: 4 },
  { id: "demo-m3", type: "mage", x: 7, y: 6 },
  { id: "demo-m4", type: "grunt", x: 10, y: 7 },
  { id: "demo-m5", type: "warrior", x: 5, y: 9 },
  // Two in the road, so there is a brawl and not only a shooting gallery.
  { id: "demo-m6", type: "guard", x: 5, y: 5 },
  { id: "demo-m7", type: "grunt", x: 7, y: 8 },
];

const TRAPS: PlacedTrap[] = [
  { id: "demo-t1", type: "spike", x: 3, y: 2 },
  { id: "demo-t2", type: "arrow", x: 2, y: 4 },
  { id: "demo-t3", type: "flame", x: 8, y: 5 },
  { id: "demo-t4", type: "rockfall", x: 9, y: 7 },
];

/** The classes a party is drawn from, rotated each round so the board changes. */
const CLASSES: AdventurerClass[] = ["knight", "rogue", "ranger", "barbarian", "mage"];
const NAMES = ["Aldric", "Brena", "Corvin", "Dagny", "Edric", "Fenna"];

export interface TitleDemo {
  sim: RaidSim;
  arena: Arena;
  entrance: { x: number; y: number };
  core: { x: number; y: number };
  dug: DugTile[];
  open: Set<number>;
  markers: MarkerView[];
}

export function demoDug(): DugTile[] {
  return [...ROUTE, ...NOOKS].map(([x, y]) => dugTile(x, y));
}

/** The party for one round: two waves, the second led by a champion. */
export function demoWaves(round: number): PartyMember[][] {
  const pick = (i: number) => CLASSES[(round + i) % CLASSES.length];
  const member = (wave: number, i: number, level: number, champion = false): PartyMember => ({
    id: `demo${round}-w${wave}-${i}`,
    cls: pick(wave * 3 + i),
    name: NAMES[(round + wave * 3 + i) % NAMES.length],
    level,
    champion,
  });
  return [
    [member(0, 0, 3), member(0, 1, 2), member(0, 2, 2)],
    // The champion's level cycles, so some rounds the dungeon holds and some
    // it falls - the title should not always end the same way.
    [member(1, 0, 3 + (round % 3), true), member(1, 1, 2), member(1, 2, 3)],
  ];
}

export function createTitleDemo(round: number): TitleDemo {
  const arena = arenaFor([]);
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  const dug = demoDug();
  const waves = demoWaves(round);
  const sim = new RaidSim({
    minions: MINIONS,
    traps: TRAPS,
    party: waves[0],
    waves,
    arena,
    entrance,
    core,
    lures: [],
    terrain: rockSet(arena, dug),
    seed: 1000 + round,
    jailFree: 0,
    // A garrison that has done its research on alternate rounds. On a
    // different cycle from the champion's level, so the pairings vary and
    // the dungeon sometimes holds.
    minionHpScale: round % 2 === 1 ? 1.8 : 1.2,
    minionDamageScale: round % 2 === 1 ? 1.8 : 1.2,
    trapDamageScale: round % 2 === 1 ? 1.5 : 1.1,
  });
  return {
    sim,
    arena,
    entrance,
    core,
    dug,
    open: dugSet(arena, dug),
    markers: TRAPS.map((t) => ({ id: `t:${t.id}`, x: t.x, y: t.y, kind: t.type, shape: "trap" as const })),
  };
}

/** What the board draws for a state of the demo fight. Mirrors App's own. */
export function demoUnits(state: RaidState, over: boolean): UnitView[] {
  const units: UnitView[] = [];
  for (const m of state.minions) {
    if (!m.alive) continue;
    units.push({
      id: `m:${m.id}`, x: m.x, y: m.y, kind: `m_${m.type}`, hp: m.hp, maxHp: m.maxHp,
      action: over ? "idle" : m.action, facing: m.facing,
    });
  }
  for (const a of state.adventurers) {
    if (!a.alive || !a.spawned) continue;
    units.push({
      id: `a:${a.id}`, x: a.x, y: a.y, kind: `a_${a.cls}`, hp: a.hp, maxHp: a.maxHp,
      action: over ? "idle" : a.action, facing: a.facing,
      showHealth: true,
      scale: a.champion ? CHAMPION_MODEL_SCALE : undefined,
    });
  }
  return units;
}
