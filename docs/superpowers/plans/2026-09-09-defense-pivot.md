# Defense Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace corridor digging with placeable obstacles, so the player fills an open room with monsters and walls and adventurers who walk in are fought automatically.

**Architecture:** Terrain stops being mutable. The room is a fixed rectangle whose size comes from research; obstacles become a fourth kind of placement alongside minions, traps and rooms, carrying HP inside the simulation only. Pathfinding switches from a tile grid to a rectangle plus a set of blocked coordinates. Adventurers walk any path however long, and break through only when no path exists.

**Tech Stack:** TypeScript, React 18, three.js, Vite 8, `@agent8/gameserver` (isolated-vm server sandbox), Vitest (added by Task 1).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-09-defense-pivot-design.md`. Read it before starting.
- `server.js` runs in an isolated-vm sandbox: **no `fetch`, no `require`, no `process`, no `setTimeout`, no `crypto`.** It defines `class Server {}` with **no export**.
- `server.js` and `src/game/types.ts` hold mirrored constants. Any constant added to one is added to the other, with the same value.
- The simulation stays pure: no DOM, no three.js, no `Date.now()` inside a step. Same inputs plus same step count must produce an identical event stream.
- No user-facing string goes in a component. Every one lives in `src/i18n/strings.ts` with both a `ko` and an `en` entry; `StringKey` is derived from the `ko` table, so a missing English string is a type error.
- Runtime asset URLs go through `publicUrl()` from `src/game/assets/publicUrl.ts`. Never a leading slash.
- `.env` and `.agent8.lock` carry the verse identity. Never modify them.
- Every task ends green: `npm run typecheck`, `npm run build`, and `npm test` all pass before the commit.
- Room size by research: 12×12 base, `expand1` → 16×12, `expand2` → 20×12.
- Obstacle budget by research: 20 base, `expand1` → 28, `expand2` → 36.
- Obstacle costs and HP (provisional, tuned in Task 9): `barricade` 12 G / 120 HP, `wall` 35 G / 380 HP.
- `SAVE_VERSION` goes 1 → 2.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/game/arena.ts` | **New.** Room rectangle, entrance/core positions, blocked-set construction. Replaces `grid.ts`. |
| `src/game/grid.ts` | **Deleted.** RLE and the mutable `Grid` class have no remaining caller. |
| `src/game/sim/pathfinding.ts` | A* over a rectangle plus a blocked set. No knowledge of tiles or obstacles. |
| `src/game/sim/obstacles.ts` | **New.** Obstacle stats table and the `SimObstacle` shape. |
| `src/game/sim/RaidSim.ts` | Owns per-adventurer routing, the walk-or-break decision, and obstacle damage. |
| `src/game/types.ts` | Adds `ObstacleType`, `PlacedObstacle`, `OBSTACLE_COST`, `MAX_OBSTACLES`; drops `TILE.ROCK`, `GridData`, `DIG_COST`. |
| `src/game/placements.ts` | Unchanged. Obstacles reuse `addCost` and `sameList`. |
| `src/game/useDungeonSave.ts` | Obstacle placement and removal; digging gone. |
| `src/game/DungeonRenderer.ts` | Draws floor over the whole room, walls on the room border, obstacles as damageable models. |
| `src/App.tsx` | Obstacle tools; the path warning gone. |
| `server.js` | Save v2, obstacle pricing and cap, migration; digging gone. |
| `src/i18n/strings.ts` | Obstacle names and hints; renamed expansion research labels. |
| `tests/` | **New.** Vitest suites for pathfinding, the simulation, and placement pricing. |

---

### Task 1: Test harness

Nothing in this repository is unit tested today and the rest of this plan is written test-first. This task exists to make the next eight possible.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/harness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest once and exits; `npm run test:watch` stays open.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest@^3.2.4
```

- [ ] **Step 2: Add the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// The simulation and its helpers are pure TypeScript with no DOM, so the
// default node environment is all they need. Tests live outside src/ so the
// production build never sees them.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add the scripts**

In `package.json`, add to `"scripts"` (keep the existing entries):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a test that proves the harness runs**

Create `tests/harness.test.ts`:

```ts
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
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Confirm the build is unaffected**

Run: `npm run typecheck && npm run build`
Expected: both succeed. `tests/` is outside `src/`, so `tsconfig.app.json` does not compile it and the bundle does not grow.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/harness.test.ts
git commit -m "test: add vitest so the pivot can be built test-first"
```

---

### Task 2: Arena and blocked-set pathfinding

Pathfinding currently asks a `Grid` object whether a tile is rock. There is no rock any more; there are coordinates with an obstacle standing on them. This task changes the question without changing the algorithm.

**Files:**
- Create: `src/game/arena.ts`
- Modify: `src/game/sim/pathfinding.ts`
- Create: `tests/pathfinding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Arena { w: number; h: number }`
  - `function arenaFor(research: string[]): Arena`
  - `function entranceOf(arena: Arena): Point` → `{ x: 0, y: Math.floor(arena.h / 2) }`
  - `function coreOf(arena: Arena): Point` → `{ x: arena.w - 1, y: Math.floor(arena.h / 2) }`
  - `function blockedKey(x: number, y: number, w: number): number`
  - `function blockedSet(arena: Arena, obstacles: Array<{ x: number; y: number }>): Set<number>`
  - `function inArena(arena: Arena, x: number, y: number): boolean`
  - `function findPath(arena: Arena, start: Point, goal: Point, blocked: Set<number>): Point[] | null`
  - `function buildRaidPath(arena: Arena, start: Point, core: Point, lures: Point[], blocked: Set<number>): Point[] | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/pathfinding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arenaFor, blockedSet, coreOf, entranceOf } from "../src/game/arena";
import { buildRaidPath, findPath } from "../src/game/sim/pathfinding";

const arena = arenaFor([]);

describe("arena", () => {
  it("is 12x12 with no research and grows with it", () => {
    expect(arenaFor([])).toEqual({ w: 12, h: 12 });
    expect(arenaFor(["expand1"])).toEqual({ w: 16, h: 12 });
    expect(arenaFor(["expand1", "expand2"])).toEqual({ w: 20, h: 12 });
  });

  it("puts the entrance and core on opposite edges", () => {
    expect(entranceOf(arena)).toEqual({ x: 0, y: 6 });
    expect(coreOf(arena)).toEqual({ x: 11, y: 6 });
  });
});

describe("findPath", () => {
  it("walks straight across an empty room", () => {
    const path = findPath(arena, entranceOf(arena), coreOf(arena), new Set());
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 6 });
    expect(path![path!.length - 1]).toEqual({ x: 11, y: 6 });
    expect(path!.length).toBe(12);
  });

  it("detours around a blocking wall however long the detour is", () => {
    // A full-height wall at x=5 with one gap at the top edge.
    const wall = [];
    for (let y = 1; y < 12; y++) wall.push({ x: 5, y });
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 5 && p.y === 0)).toBe(true);
    expect(path!.length).toBeGreaterThan(12);
  });

  it("returns null when the room is sealed", () => {
    const wall = [];
    for (let y = 0; y < 12; y++) wall.push({ x: 5, y });
    expect(findPath(arena, entranceOf(arena), coreOf(arena), blockedSet(arena, wall))).toBeNull();
  });

  it("never routes through a blocked tile", () => {
    const blocked = blockedSet(arena, [{ x: 3, y: 6 }]);
    const path = findPath(arena, entranceOf(arena), coreOf(arena), blocked);
    expect(path!.some((p) => p.x === 3 && p.y === 6)).toBe(false);
  });
});

describe("buildRaidPath", () => {
  it("detours through the nearest lure", () => {
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 4, y: 2 }], new Set());
    expect(path!.some((p) => p.x === 4 && p.y === 2)).toBe(true);
  });

  it("falls back to the direct route when no lure is reachable", () => {
    const box = [
      { x: 3, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 1 }, { x: 4, y: 3 },
    ];
    const path = buildRaidPath(arena, entranceOf(arena), coreOf(arena), [{ x: 4, y: 2 }], blockedSet(arena, box));
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 4 && p.y === 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/pathfinding.test.ts`
Expected: FAIL — `Cannot find module '../src/game/arena'`.

- [ ] **Step 3: Write `src/game/arena.ts`**

```ts
import type { Point } from "./sim/pathfinding";

/**
 * The room the whole game happens in.
 *
 * There is no terrain any more: every tile inside the rectangle is floor, and
 * the only thing that stops a walker is an obstacle the player put there. Size
 * comes from research rather than the save, so a dungeon cannot claim to be
 * bigger than what its owner has unlocked.
 */
export interface Arena {
  w: number;
  h: number;
}

export const BASE_ARENA: Arena = { w: 12, h: 12 };

/** Mirrors RESEARCH[...].expandTo in server.js. */
const EXPANSIONS: Array<{ id: string; w: number }> = [
  { id: "expand1", w: 16 },
  { id: "expand2", w: 20 },
];

export function arenaFor(research: string[]): Arena {
  let w = BASE_ARENA.w;
  for (const step of EXPANSIONS) {
    if (research.includes(step.id)) w = Math.max(w, step.w);
  }
  return { w, h: BASE_ARENA.h };
}

export function entranceOf(arena: Arena): Point {
  return { x: 0, y: Math.floor(arena.h / 2) };
}

export function coreOf(arena: Arena): Point {
  return { x: arena.w - 1, y: Math.floor(arena.h / 2) };
}

export function blockedKey(x: number, y: number, w: number): number {
  return y * w + x;
}

/** The coordinates a walker cannot enter, as flat keys for cheap lookup. */
export function blockedSet(
  arena: Arena,
  obstacles: Array<{ x: number; y: number }>,
): Set<number> {
  const set = new Set<number>();
  for (const o of obstacles) set.add(blockedKey(o.x, o.y, arena.w));
  return set;
}

export function inArena(arena: Arena, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < arena.w && y < arena.h;
}
```

- [ ] **Step 4: Rewrite the signatures in `src/game/sim/pathfinding.ts`**

Replace the `Grid` import and the `walkable` helper. The A* body is unchanged apart from the two lines that ask whether a tile can be entered.

```ts
import { blockedKey, inArena, type Arena } from "../arena";

export interface Point {
  x: number;
  y: number;
}

/** A tile is walkable unless an obstacle stands on it. There is no terrain. */
function walkable(arena: Arena, x: number, y: number, blocked: Set<number>): boolean {
  if (!inArena(arena, x, y)) return false;
  return !blocked.has(blockedKey(x, y, arena.w));
}
```

Then in `findPath`, change the signature to
`export function findPath(arena: Arena, start: Point, goal: Point, blocked: Set<number>): Point[] | null`,
replace `const w = grid.w;` with `const w = arena.w;`, `const total = grid.w * grid.h;` with `const total = arena.w * arena.h;`, and both `walkable(grid, ...)` calls with `walkable(arena, ..., blocked)`. Replace the local `key(x, y, w)` helper with `blockedKey`.

Change `buildRaidPath` to
`export function buildRaidPath(arena: Arena, start: Point, core: Point, lures: Point[], blocked: Set<number>): Point[] | null`
and thread `arena` and `blocked` through its three `findPath` calls. Note the second parameter is now `start`, not `entrance` — Task 4 calls it from wherever an adventurer is standing, not only from the entrance.

Delete `hasPathToCore`; Task 5 removes its only caller.

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/pathfinding.test.ts`
Expected: PASS, 7 tests.

Note: `npm run typecheck` still fails at this point — `grid.ts`, `RaidSim.ts`, `useRaid.ts` and `DungeonRenderer.ts` all call the old signatures. Tasks 4 through 8 fix them. Do not try to fix them here.

- [ ] **Step 6: Commit**

```bash
git add src/game/arena.ts src/game/sim/pathfinding.ts tests/pathfinding.test.ts
git commit -m "feat: path over a room and a blocked set, not a tile grid"
```

---

### Task 3: Obstacle data

Costs, caps, HP and names. Data only, so it can land before anything consumes it.

**Files:**
- Modify: `src/game/types.ts`
- Create: `src/game/sim/obstacles.ts`
- Modify: `src/i18n/strings.ts`
- Create: `tests/obstacles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ObstacleType = "barricade" | "wall"`
  - `interface PlacedObstacle { id: string; type: ObstacleType; x: number; y: number }`
  - `const OBSTACLE_COST: Record<ObstacleType, number>`
  - `const BASE_MAX_OBSTACLES: number`
  - `function maxObstaclesFor(research: string[]): number`
  - `const OBSTACLE_LABEL: Record<ObstacleType, StringKey>`
  - `const OBSTACLE_STATS: Record<ObstacleType, { hp: number }>`

- [ ] **Step 1: Write the failing test**

Create `tests/obstacles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OBSTACLE_COST, maxObstaclesFor, BASE_MAX_OBSTACLES } from "../src/game/types";
import { OBSTACLE_STATS } from "../src/game/sim/obstacles";
import { addCost } from "../src/game/placements";

describe("obstacle data", () => {
  it("prices a barricade below a wall", () => {
    expect(OBSTACLE_COST.barricade).toBe(12);
    expect(OBSTACLE_COST.wall).toBe(35);
  });

  it("gives a wall more hit points than a barricade", () => {
    expect(OBSTACLE_STATS.barricade.hp).toBe(120);
    expect(OBSTACLE_STATS.wall.hp).toBe(380);
  });

  it("raises the budget with the expansion research", () => {
    expect(BASE_MAX_OBSTACLES).toBe(20);
    expect(maxObstaclesFor([])).toBe(20);
    expect(maxObstaclesFor(["expand1"])).toBe(28);
    expect(maxObstaclesFor(["expand1", "expand2"])).toBe(36);
  });

  it("charges only for obstacles that are new or changed type", () => {
    const saved = [{ id: "o1", type: "barricade", x: 1, y: 1 }];
    const next = [
      { id: "o1", type: "wall", x: 1, y: 1 },
      { id: "o2", type: "barricade", x: 2, y: 1 },
    ];
    expect(addCost(next, saved, OBSTACLE_COST)).toBe(35 + 12);
    expect(addCost(saved, saved, OBSTACLE_COST)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/obstacles.test.ts`
Expected: FAIL — `OBSTACLE_COST` is not exported.

- [ ] **Step 3: Add the types**

In `src/game/types.ts`, add near the other placement types:

```ts
/** A wall the player puts down. Adventurers only attack one when sealed in. */
export type ObstacleType = "barricade" | "wall";

export interface PlacedObstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
}

/** Kept in sync with server.js. */
export const OBSTACLE_COST: Record<ObstacleType, number> = {
  barricade: 12,
  wall: 35,
};

export const BASE_MAX_OBSTACLES = 20;

/**
 * How many obstacles may stand at once.
 *
 * The budget rides on the expansion research rather than nodes of its own: a
 * bigger room with the same wall budget makes the maze thinner, not deeper, so
 * the two numbers have to move together.
 */
export function maxObstaclesFor(research: string[]): number {
  let cap = BASE_MAX_OBSTACLES;
  if (research.includes("expand1")) cap = 28;
  if (research.includes("expand2")) cap = 36;
  return cap;
}

export const OBSTACLE_LABEL: Record<ObstacleType, StringKey> = {
  barricade: "obstacle_barricade",
  wall: "obstacle_wall",
};

export const OBSTACLE_DESCRIPTION: Record<ObstacleType, StringKey> = {
  barricade: "obstacle_barricade_desc",
  wall: "obstacle_wall_desc",
};
```

In the same file, add `obstacles: PlacedObstacle[];` to the `Dungeon` interface, remove `grid: GridData;` from it, delete the `GridData` interface, delete `ROCK: 0,` from `TILE`, and delete `export const DIG_COST = 10;` and `export const MAX_DIGS_PER_SAVE = 64;`.

- [ ] **Step 4: Add the stats module**

Create `src/game/sim/obstacles.ts`:

```ts
import type { ObstacleType } from "../types";

/**
 * How much punishment each obstacle absorbs.
 *
 * HP is the whole point of an obstacle: a sealed room buys the defender
 * exactly this many hit points of the attackers' time. It lives in the
 * simulation and is never saved — a raid starts with every standing obstacle
 * whole, and the ones that fall are removed from the dungeon afterwards.
 */
export const OBSTACLE_STATS: Record<ObstacleType, { hp: number }> = {
  barricade: { hp: 120 },
  wall: { hp: 380 },
};

export interface SimObstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}
```

- [ ] **Step 5: Add the strings**

In `src/i18n/strings.ts`, add to the `ko` table (next to the trap names):

```ts
  obstacle_barricade: "나무 바리케이드",
  obstacle_wall: "석벽",
  obstacle_barricade_desc: "싸고 약합니다. 길을 접는 데 씁니다.",
  obstacle_wall_desc: "비싸고 튼튼합니다. 봉쇄한 줄을 오래 버팁니다.",
  hint_obstacle: "빈 바닥에 놓아 길을 접습니다.",
  count_obstacles: "장애물",
  obstacle_note: "완전히 막아도 됩니다. 길이 없으면 용사가 벽을 부수고 들어옵니다.",
```

and the matching entries to the `en` table:

```ts
  obstacle_barricade: "Wooden barricade",
  obstacle_wall: "Stone wall",
  obstacle_barricade_desc: "Cheap and weak. For folding the route.",
  obstacle_wall_desc: "Costly and tough. Holds a sealed line.",
  hint_obstacle: "Place on empty floor to fold the route.",
  count_obstacles: "Obstacles",
  obstacle_note: "Sealing the room is allowed. With no way through, they break the wall down.",
```

Rename the expansion research labels in both tables — keys stay, text changes:

```ts
  res_expand1: "던전 확장 I",       // en: "Dungeon Expansion I"
  res_expand1_n: "방 12 → 16, 장애물 20 → 28",   // en: "Room 12 → 16, obstacles 20 → 28"
  res_expand2: "던전 확장 II",      // en: "Dungeon Expansion II"
  res_expand2_n: "방 16 → 20, 장애물 28 → 36",   // en: "Room 16 → 20, obstacles 28 → 36"
```

- [ ] **Step 6: Drop the dead `expandTo` field**

`src/game/research.ts` carries `expandTo?: number` on the node interface and
`expandTo: 16` / `expandTo: 20` on the two expansion nodes. Room size is now
derived from the research id list by `arenaFor`, so the field has no reader
left. Delete the field from the `ResearchNode` interface and from both nodes.
Their `id`, `cost` and `requires` do not change.

- [ ] **Step 7: Run the test**

Run: `npm test -- tests/obstacles.test.ts`
Expected: PASS, 4 tests.

`npm run typecheck` still fails — removing `GridData` and `TILE.ROCK` breaks `grid.ts` and the renderer. Tasks 4 to 8 clear that.

- [ ] **Step 8: Commit**

```bash
git add src/game/types.ts src/game/sim/obstacles.ts src/game/research.ts src/i18n/strings.ts tests/obstacles.test.ts
git commit -m "feat: obstacle types, costs, budget and names"
```

---

### Task 4: The simulation walks or breaks

The heart of the pivot. Today one shared path is handed to the simulation and every adventurer walks its index. Now each adventurer carries its own route, because a wall falling changes the map for everybody at once.

**Files:**
- Modify: `src/game/sim/RaidSim.ts`
- Create: `tests/raidsim-obstacles.test.ts`

**Interfaces:**
- Consumes: `Arena`, `blockedSet`, `buildRaidPath` (Task 2); `OBSTACLE_STATS`, `SimObstacle` (Task 3).
- Produces:
  - `RaidSimOptions` loses `path: Point[]` and gains `arena: Arena`, `entrance: Point`, `core: Point`, `lures: Point[]`, `obstacles: PlacedObstacle[]`.
  - `SimAdventurer` gains `path: Point[]` and `breaking: boolean`; `pathIndex` stays.
  - `RaidState` gains `obstacles: SimObstacle[]`.
  - `SimEvent` gains `{ kind: "obstacleHit"; targetId: string; amount: number; x: number; y: number }` and `{ kind: "obstacleDown"; targetId: string; x: number; y: number }`.
  - `RaidSim` gains `destroyedObstacleIds: string[]` as a public readonly getter, which Task 5's `finishRaid` consumes.

- [ ] **Step 1: Write the failing tests**

Create `tests/raidsim-obstacles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedObstacle } from "../src/game/types";

const arena = arenaFor([]);
const party: PartyMember[] = [
  { id: "a1", cls: "knight", name: "Aldric", level: 1 },
];

function makeSim(obstacles: PlacedObstacle[]) {
  return new RaidSim({
    minions: [],
    traps: [],
    obstacles,
    party,
    arena,
    entrance: entranceOf(arena),
    core: coreOf(arena),
    lures: [],
    seed: 1,
  });
}

/** Runs the simulation for at most `seconds`, stopping early once it resolves. */
function run(sim: RaidSim, seconds: number) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (sim.state.status !== "running") break;
    sim.step();
  }
}

function wallAt(x: number, ys: number[], type: "barricade" | "wall" = "barricade"): PlacedObstacle[] {
  return ys.map((y) => ({ id: `o-${x}-${y}`, type, x, y }));
}

describe("adventurers and obstacles", () => {
  it("walks a long detour without touching a single obstacle", () => {
    // Wall across x=5 with a gap at y=0, forcing a long way round.
    const obstacles = wallAt(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 60);

    expect(sim.state.obstacles.every((o) => o.hp === o.maxHp)).toBe(true);
    expect(sim.state.obstacles.every((o) => o.alive)).toBe(true);
    expect(sim.state.status).toBe("breached");
  });

  it("breaks through when the room is sealed", () => {
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 60);

    const dead = sim.state.obstacles.filter((o) => !o.alive);
    expect(dead.length).toBeGreaterThan(0);
    expect(sim.destroyedObstacleIds).toEqual(dead.map((o) => o.id));
    expect(sim.state.status).toBe("breached");
  });

  it("attacks the obstacle on its own line, not the nearest one", () => {
    // Sealed. The entrance is at y=6, so the obstacle in the way is (5,6).
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sim = makeSim(obstacles);
    run(sim, 12);

    const hurt = sim.state.obstacles.filter((o) => o.hp < o.maxHp);
    expect(hurt).toHaveLength(1);
    expect(hurt[0]).toMatchObject({ x: 5, y: 6 });
  });

  it("emits obstacleHit and obstacleDown", () => {
    const sim = makeSim(wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    const kinds = new Set<string>();
    for (let i = 0; i < 1200 && sim.state.status === "running"; i++) {
      sim.step();
      for (const event of sim.drainEvents()) kinds.add(event.kind);
    }
    expect(kinds.has("obstacleHit")).toBe(true);
    expect(kinds.has("obstacleDown")).toBe(true);
  });

  it("is deterministic", () => {
    const obstacles = wallAt(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const a = makeSim(obstacles);
    const b = makeSim(obstacles);
    run(a, 45);
    run(b, 45);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/raidsim-obstacles.test.ts`
Expected: FAIL — `RaidSimOptions` has no `obstacles`/`arena` and `RaidSim` has no `destroyedObstacleIds`.

- [ ] **Step 3: Change the options and state**

In `RaidSim.ts`, replace `path: Point[]` in `RaidSimOptions` with:

```ts
  arena: Arena;
  entrance: Point;
  core: Point;
  /** Treasury tiles that pull the party off the direct line. */
  lures: Point[];
  obstacles: PlacedObstacle[];
```

Add to `SimAdventurer`:

```ts
  /** This adventurer's own route. A falling wall changes it for everyone. */
  path: Point[];
  /** True while walking a route that runs through obstacles it must break. */
  breaking: boolean;
```

Add to `RaidState`: `obstacles: SimObstacle[];`

Add to `SimEvent`:

```ts
  | { kind: "obstacleHit"; targetId: string; amount: number; x: number; y: number }
  | { kind: "obstacleDown"; targetId: string; x: number; y: number }
```

Add imports: `import { blockedSet, type Arena } from "../arena";`, `import { buildRaidPath } from "./pathfinding";`, `import { OBSTACLE_STATS, type SimObstacle } from "./obstacles";`, and `PlacedObstacle` to the type import from `../types`.

- [ ] **Step 4: Build obstacles in the constructor and route each adventurer**

Replace `private path: Point[];` with:

```ts
  private arena: Arena;
  private entrance: Point;
  private core: Point;
  private lures: Point[];
  private obstacles: SimObstacle[];
  private destroyed: string[] = [];
```

In the constructor, after the traps are built:

```ts
    this.arena = options.arena;
    this.entrance = options.entrance;
    this.core = options.core;
    this.lures = options.lures;
    this.obstacles = options.obstacles.map((o) => ({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      hp: OBSTACLE_STATS[o.type].hp,
      maxHp: OBSTACLE_STATS[o.type].hp,
      alive: true,
    }));
```

Each adventurer starts at the entrance with its own route. Where the constructor currently reads `const start = options.path[0];` and sets `pathIndex: 0`, use `const start = options.entrance;` and add `path: []` and `breaking: false` to the adventurer literal. Then, as the last statement of the constructor, `this.routeAll();`.

Add the routing methods:

```ts
  /** Coordinates an adventurer cannot walk into right now. */
  private blocked(): Set<number> {
    return blockedSet(this.arena, this.obstacles.filter((o) => o.alive));
  }

  /**
   * Gives one adventurer a route from where it stands.
   *
   * A walkable route always wins, however long it is — that is the whole rule
   * of this game, and it is what makes folding the corridor worth doing. Only
   * when there is no way through at all does it fall back to the route it
   * would walk if the walls were not there, and start hitting them.
   */
  private route(adventurer: SimAdventurer): void {
    const from = { x: Math.round(adventurer.x), y: Math.round(adventurer.y) };
    const open = buildRaidPath(this.arena, from, this.core, this.lures, this.blocked());
    if (open) {
      adventurer.path = open;
      adventurer.breaking = false;
    } else {
      adventurer.path =
        buildRaidPath(this.arena, from, this.core, this.lures, new Set()) ?? [from];
      adventurer.breaking = true;
    }
    adventurer.pathIndex = 0;
  }

  private routeAll(): void {
    for (const adventurer of this.adventurers) {
      if (adventurer.alive) this.route(adventurer);
    }
  }

  private obstacleAt(x: number, y: number): SimObstacle | null {
    for (const o of this.obstacles) {
      if (o.alive && o.x === x && o.y === y) return o;
    }
    return null;
  }

  /** The obstacle standing on this adventurer's next step, if any. */
  private blockingObstacle(adventurer: SimAdventurer): SimObstacle | null {
    if (!adventurer.breaking) return null;
    const next = adventurer.path[adventurer.pathIndex + 1];
    if (!next) return null;
    return this.obstacleAt(next.x, next.y);
  }

  get destroyedObstacleIds(): string[] {
    return this.destroyed;
  }
```

- [ ] **Step 5: Make adventurers hit the wall in the way**

In `stepAdventurers`, after the minion-targeting block and before `adventurer.action = "walk";`, insert:

```ts
      // A wall only gets hit when there is no way round it at all. Whatever is
      // on the next step of the route is what gets hit — not the weakest wall
      // in the room, which would read as attacking nothing in particular.
      const barrier = this.blockingObstacle(adventurer);
      if (barrier) {
        adventurer.action = "attack";
        adventurer.facing = Math.atan2(barrier.x - adventurer.x, barrier.y - adventurer.y);

        if (adventurer.cooldown === 0) {
          adventurer.cooldown = stats.attackInterval;
          barrier.hp -= stats.damage;
          this.events.push({
            kind: "obstacleHit",
            targetId: barrier.id,
            amount: stats.damage,
            x: barrier.x,
            y: barrier.y,
          });
          if (barrier.hp <= 0) {
            barrier.hp = 0;
            barrier.alive = false;
            this.destroyed.push(barrier.id);
            this.events.push({
              kind: "obstacleDown",
              targetId: barrier.id,
              x: barrier.x,
              y: barrier.y,
            });
            // One hole changes the map for everyone, so everyone re-routes.
            this.routeAll();
          }
        }
        continue;
      }
```

- [ ] **Step 6: Move `advanceAlongPath` onto the adventurer's own path**

Replace every `this.path` in `advanceAlongPath` with `adventurer.path`. Do the same in `resolveStatus`, where the breach check currently reads `a.pathIndex >= this.path.length - 1`; it becomes `a.pathIndex >= a.path.length - 1`.

In the `state` getter, add `obstacles: this.obstacles.map((o) => ({ ...o }))` alongside the other copied arrays.

- [ ] **Step 7: Run the tests**

Run: `npm test -- tests/raidsim-obstacles.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Commit**

```bash
git add src/game/sim/RaidSim.ts tests/raidsim-obstacles.test.ts
git commit -m "feat: adventurers walk any route and break through only when sealed"
```

---

### Task 5: Server — save v2, obstacles, migration

The server is the authority on what a dungeon is and what it costs. It cannot be unit tested from here (it runs in the isolated-vm sandbox with no exports), so this task ends with a live verification against the deployed preview verse, the same way the raid economy was checked.

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: the constants from Task 3, mirrored by hand.
- Produces:
  - `loadGame()` returns a dungeon with `obstacles` and no `grid`.
  - `saveDungeon({ obstacles, minions, traps, rooms })` — no `grid` in the payload.
  - `finishRaid({ ..., destroyedObstacleIds })` removes those obstacles from the save.

- [ ] **Step 1: Replace the constants**

At the top of `server.js`: `SAVE_VERSION` 1 → 2. Delete `const DIG_COST = 10;`. Add:

```js
const OBSTACLE_COST = { barricade: 12, wall: 35 };
const BASE_MAX_OBSTACLES = 20;

/** Room width and obstacle budget both come from the expansion research. */
function arenaFor(research) {
  let w = GRID_W;
  if (research.includes("expand1")) w = 16;
  if (research.includes("expand2")) w = 20;
  return { w, h: GRID_H };
}

function maxObstaclesFor(research) {
  let cap = BASE_MAX_OBSTACLES;
  if (research.includes("expand1")) cap = 28;
  if (research.includes("expand2")) cap = 36;
  return cap;
}
```

- [ ] **Step 2: Drop the grid from the save**

Delete `encodeRLE`, `decodeRLE`, `expandGrid`, `hasPath`, and the `TILE_*` constants. In `createDungeon`, remove the `cells` array and the `grid` field, and add `obstacles: []`. Keep `entrance` and `core` as they are.

In `researchNode`, delete the `if (node.expandTo) expandGrid(dungeon, node.expandTo);` line — the room now derives its size from the research list on read, so nothing has to be rewritten when a node is bought.

- [ ] **Step 3: Price obstacles and enforce the cap**

Add next to the other pricing helpers:

```js
/**
 * Charges for obstacles that are new or changed type, and refuses a dungeon
 * that breaks the rules. Removing an obstacle refunds nothing, which is what
 * makes a wall a purchase rather than a fixture.
 */
function priceObstacles(next, saved, arena, research, occupied) {
  const cap = maxObstaclesFor(research);
  if (next.length > cap) throw new Error("TOO_MANY_OBSTACLES");

  const savedById = new Map(saved.map((o) => [o.id, o]));
  let cost = 0;

  for (const o of next) {
    if (!OBSTACLE_COST[o.type]) throw new Error("UNKNOWN_OBSTACLE");
    if (o.x < 0 || o.y < 0 || o.x >= arena.w || o.y >= arena.h) {
      throw new Error("OUT_OF_BOUNDS");
    }
    const key = `${o.x},${o.y}`;
    if (occupied.has(key)) throw new Error("TILE_OCCUPIED");
    occupied.add(key);

    const previous = savedById.get(o.id);
    if (!previous || previous.type !== o.type) cost += OBSTACLE_COST[o.type];
  }

  return cost;
}
```

The entrance and core go into `occupied` before this is called, so nothing can be built on either.

In `saveDungeon`, delete the `digs` count and `digs * DIG_COST` from the cost sum, add `priceObstacles(...)` to it, drop `grid` from both the payload validation and the stored `dungeon` object, and store `obstacles`. Change the return value's `digs` field to `obstacleCost`.

- [ ] **Step 4: Stop rejecting a sealed dungeon**

In `startRaid`, delete the `hasPath` check and the `NO_PATH` error. A sealed room is now a legal, and expensive, way to buy time.

- [ ] **Step 5: Remove destroyed obstacles in `finishRaid`**

`finishRaid` takes a `destroyedObstacleIds` array from the client alongside the existing outcome fields. Validate it the same way the other client-reported fields are, then:

```js
    const destroyed = new Set(Array.isArray(payload.destroyedObstacleIds) ? payload.destroyedObstacleIds : []);
    const obstacles = (prev.obstacles || []).filter((o) => !destroyed.has(o.id));
```

and store `obstacles` on the updated dungeon. A client that lies here only destroys its own walls, so it costs the liar money.

- [ ] **Step 6: Migrate version 1 saves**

Where `loadGame` currently checks `state.dungeon.version === SAVE_VERSION`, accept version 1 and upgrade it:

```js
    /**
     * Version 1 carved corridors out of rock. Version 2 has no terrain, so the
     * grid is simply dropped — every placement sat on carved floor, and the
     * whole room is floor now, so all coordinates stay valid. Nobody loses a
     * dungeon, gold, or a research node.
     */
    function migrate(dungeon) {
      if (dungeon.version === SAVE_VERSION) return dungeon;
      if (dungeon.version !== 1) return null;
      const { grid, ...rest } = dungeon;
      return { ...rest, version: SAVE_VERSION, obstacles: [] };
    }
```

Return `null` for anything else so an unknown save is replaced rather than half-read.

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build && npm test`
Expected: all pass. `server.js` is plain JavaScript and is not typechecked, so this only proves the client still compiles — it is Task 8 that finishes the client.

If the client does not compile yet because Tasks 6 to 8 have not landed, that is expected; commit this task and continue.

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat: save v2 with obstacles, no terrain, and a v1 migration"
```

- [ ] **Step 9: Verify live after the next deploy**

Once the branch is pushed and the preview verse has rebuilt, from the running client's console:

```js
await window.__call("loadGame", []);          // dungeon.version === 2, obstacles: []
await window.__call("saveDungeon", [{ obstacles: [{ id: "o1", type: "barricade", x: 3, y: 6 }], minions: [], traps: [], rooms: [] }]);
```

Expected: the save succeeds and gold drops by exactly 12. Re-running the identical save costs 0. A save with 40 obstacles fails with `TOO_MANY_OBSTACLES`. A save placing one on the core fails with `TILE_OCCUPIED`.

Then check the migration against a real version 1 save. The preview verse
already holds one, so load it before deploying this task and compare after:

```js
const before = await window.__call("loadGame", []);   // run BEFORE deploying
// ...deploy, reload...
const after = await window.__call("loadGame", []);    // run AFTER
```

Expected: `after.dungeon.version === 2`, `after.dungeon.grid === undefined`,
`after.dungeon.obstacles` is `[]`, and gold, `research`, `threat`,
`wavesRepelled`, `coreBreaches`, `minions`, `traps`, `rooms`, `loot`,
`prisoners` and `adventurers` all match `before` exactly. If any of those
differ, the migration is dropping something it should keep — fix it before
moving on, because there is no second chance at a player's save.

---

### Task 6: Client state

**Files:**
- Modify: `src/game/useDungeonSave.ts`
- Modify: `src/game/useRaid.ts`
- Delete: `src/game/grid.ts`

**Interfaces:**
- Consumes: `arenaFor`, `entranceOf`, `coreOf` (Task 2); `OBSTACLE_COST`, `maxObstaclesFor`, `PlacedObstacle` (Task 3); the new `RaidSimOptions` (Task 4).
- Produces: `useDungeonSave()` returns `obstacles: PlacedObstacle[]`, `arena: Arena`, `placeObstacle(type: ObstacleType, x: number, y: number): boolean`, and no longer returns `digTile`, `pendingDigs` or `grid`.

- [ ] **Step 1: Add obstacle state alongside the other placements**

This file keeps every placement list as a `useState` plus a `…Ref` mirror for
callbacks, and a `saved…Ref` holding what the server last acknowledged. Follow
that exactly: add `obstacles` / `setObstacles`, `obstaclesRef` and
`savedObstaclesRef`, populate `savedObstaclesRef.current` where the other
`saved…Ref`s are set on load and after a save, and add
`addCost(obstaclesRef.current, savedObstaclesRef.current, OBSTACLE_COST)` to the
sum inside `pendingCostOf`, and `!sameList(obstaclesRef.current, savedObstaclesRef.current)`
to the `hasUnsaved` check.

- [ ] **Step 2: Replace digging with obstacle placement**

Delete `digTile`, the `pendingDigs` state, and the `MAX_DIGS_PER_SAVE` flush.
Add, following the shape of `placeTrap` immediately above it:

```ts
  const placeObstacle = useCallback(
    (type: ObstacleType, x: number, y: number): boolean => {
      const arena = arenaRef.current;
      if (!inArena(arena, x, y)) return false;
      // The two tiles the whole game is measured between stay clear.
      if (isEntrance(x, y) || isCore(x, y)) return false;
      if (occupantAt(x, y)) return false;
      if (obstaclesRef.current.length >= maxObstaclesFor(researchRef.current)) return false;
      if (!canAfford(OBSTACLE_COST[type])) return false;

      seqRef.current += 1;
      setObstacles([...obstaclesRef.current, { id: `o${seqRef.current}`, type, x, y }]);
      return true;
    },
    [canAfford, occupantAt, isEntrance, isCore],
  );
```

The code above needs four things this file does not have yet. Add them beside
the existing refs:

```ts
  const arenaRef = useRef<Arena>(arenaFor([]));
  const researchRef = useRef<string[]>([]);
  const isEntrance = useCallback(
    (x: number, y: number) => x === metaRef.current?.entrance.x && y === metaRef.current?.entrance.y,
    [],
  );
  const isCore = useCallback(
    (x: number, y: number) => x === metaRef.current?.core.x && y === metaRef.current?.core.y,
    [],
  );
```

Keep `arenaRef.current` and `researchRef.current` in step with their state
wherever the other refs are synced on load and after a save.

Extend `occupantAt` to return `"obstacle"` when one stands on the tile, so
minions, traps and rooms cannot be dropped on a wall either:

```ts
    if (obstaclesRef.current.some((o) => o.x === x && o.y === y)) return "obstacle";
```

Extend `removeAt` to drop an obstacle on the tile, matching how it drops a trap.

- [ ] **Step 3: Swap the grid for the arena**

Replace `gridRef` / `baselineRef` / `gridVersion` and every `grid.get(x, y) !== TILE.FLOOR`
guard in `placeMinion`, `placeTrap` and `placeRoom` with `inArena(arena, x, y)`
plus the entrance/core check — with no terrain, "is this floor" and "is this
inside the room" are the same question.

Expose `arena` from the hook, derived from the research list:
`const arena = useMemo(() => arenaFor(research), [research]);`

Delete `src/game/grid.ts`. Its `createLocalDungeon` becomes a small local
function here, built from `arenaFor([])`, `entranceOf` and `coreOf` with empty
placement lists and `version: 2`.

- [ ] **Step 4: Update the simulation call site**

In `useRaid.ts`, replace the `buildRaidPath(grid, ...)` call and the `path` option with:

```ts
      const sim = new RaidSim({
        minions: minions.filter((m) => available.has(m.id)),
        traps,
        obstacles,
        party: start.party,
        arena,
        entrance: meta.entrance,
        core: meta.core,
        lures: lureTiles(rooms),
        seed: start.seed,
        trapCooldownScale: effects.trapCooldownScale,
        jailFree: start.jailFree ?? jailFree,
        weaponTiers,
        minionDamageScale: research.minionDamageScale,
        minionHpScale: research.minionHpScale,
        trapDamageScale: research.trapDamageScale,
      });
```

Delete the `pathExists` value and the `findPath` import; nothing gates a raid on a route any more.

When the raid finishes, pass `sim.destroyedObstacleIds` to `finishRaid` and drop the destroyed ids from local `obstacles` state so the board matches the server.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: errors only in `DungeonRenderer.ts` and `App.tsx`, which Tasks 7 and 8 fix. No errors in `useDungeonSave.ts` or `useRaid.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/game/useDungeonSave.ts src/game/useRaid.ts
git rm src/game/grid.ts
git commit -m "feat: place obstacles instead of digging"
```

---

### Task 7: Renderer

**Files:**
- Modify: `src/game/DungeonRenderer.ts`
- Modify: `src/game/assets/ModelLibrary.ts`

**Interfaces:**
- Consumes: `Arena` (Task 2); `SimObstacle` (Task 3).
- Produces: `setArena(arena: Arena, entrance: Point, core: Point)` replaces `setGrid(grid)`; `setObstacles(obstacles: Array<{ id: string; type: ObstacleType; x: number; y: number; hp: number; maxHp: number }>)`.

- [ ] **Step 1: Add obstacle models**

In `MODEL_PATTERNS`, add:

```ts
  obstacle_barricade: [/^barrier_half$/, /^barrier$/, /^fence/],
  obstacle_wall: [/^wall$/, /^wall_arched$/, /^pillar$/],
```

- [ ] **Step 2: Replace the grid with the arena**

`rebuildInstances` currently splits tiles into rock and floor. There is no rock: every tile in the rectangle is floor. Delete `rockMesh` and its build, and build `floorMesh` over the whole rectangle.

`buildWalls` keeps its edge-detection logic, but "solid" now means "outside the arena" — so panels appear only on the room's outer border, which is exactly the wall of a room.

`buildDecor` keeps working; its `occupied` set gains the obstacle tiles so a barrel never sits inside a wall.

- [ ] **Step 3: Draw obstacles**

Obstacles get their own group and id-keyed map, following `setMarkers`
exactly — reuse by id, dispose what left the list:

```ts
  /**
   * Walls the player put down.
   *
   * Height tracks remaining HP: a barricade being chopped through visibly
   * sinks, which is the only feedback the player gets that hitting it is
   * working. Everything else about the model stays put so it does not read as
   * a different object.
   */
  setObstacles(obstacles: ObstacleView[]): void {
    this.lastObstacles = obstacles;
    const seen = new Set<string>();

    for (const obstacle of obstacles) {
      seen.add(obstacle.id);
      let object = this.obstacleMeshes.get(obstacle.id);

      if (!object) {
        object =
          this.spawnModel(`obstacle_${obstacle.type}`, 0.9) ??
          new THREE.Mesh(
            this.obstacleGeometry,
            new THREE.MeshLambertMaterial({ color: 0x6b5f4e }),
          );
        this.obstacleMeshes.set(obstacle.id, object);
        this.obstacleGroup.add(object);
      }

      const health = obstacle.maxHp > 0 ? obstacle.hp / obstacle.maxHp : 1;
      object.scale.y = 0.25 + 0.75 * health;
      object.position.set(obstacle.x, FLOOR_HEIGHT, obstacle.y);
    }

    for (const [id, object] of this.obstacleMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.obstacleGroup, object);
      this.obstacleMeshes.delete(id);
    }
  }
```

with the supporting fields next to the marker ones:

```ts
  private obstacleGroup = new THREE.Group();
  private obstacleMeshes = new Map<string, THREE.Object3D>();
  private obstacleGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  private lastObstacles: ObstacleView[] = [];
```

`obstacleGroup` is added to the scene in the constructor beside `markerGroup`,
`obstacleGeometry` is disposed in `dispose()`, and `debugStats()` reports
`obstacles: this.obstacleMeshes.size`. Export the view type:

```ts
export interface ObstacleView {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}
```

`App.tsx` feeds it from the placed list while building (`hp === maxHp`) and
from `raid.raidState.obstacles` during a raid, the same way `units` already
switches between the placed roster and the live simulation.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev -- --port 5240`, then in the browser console:

```js
window.__dw.placeObstacle("barricade", 4, 6);
window.__dw.rendererStats();
```

Expected: `obstacles: 1` in the stats, no console errors, and `modelsLoaded` contains `obstacle_barricade`.

- [ ] **Step 5: Commit**

```bash
git add src/game/DungeonRenderer.ts src/game/assets/ModelLibrary.ts
git commit -m "feat: draw the room and its obstacles"
```

---

### Task 8: UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/game/devtools.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 7.
- Produces: the build toolbar's first two entries are the two obstacles; `window.__dw.placeObstacle` exists.

- [ ] **Step 1: Replace the dig and remove tools**

In `TOOLS`, replace the `dig` entry with two obstacle entries and keep `remove`:

```ts
  { id: "barricade", tool: { kind: "obstacle", type: "barricade" }, label: OBSTACLE_LABEL.barricade, cost: OBSTACLE_COST.barricade },
  { id: "wall", tool: { kind: "obstacle", type: "wall" }, label: OBSTACLE_LABEL.wall, cost: OBSTACLE_COST.wall },
  { id: "remove", tool: { kind: "remove" }, label: "tool_remove", cost: null },
```

Add `{ kind: "obstacle"; type: ObstacleType }` to the `Tool` union, a branch in the tap handler calling `save.placeObstacle`, and a `toolHint` branch returning
`` `${t("hint_obstacle")} ${obstacles.length}/${maxObstaclesFor(research)}` ``.

- [ ] **Step 2: Remove the path gate**

Delete the `!raid.pathExists` condition from the start-raid button's `disabled`, and delete the `<p className="hint small warn">{t("need_path")}</p>` line. Add `<p className="hint small">{t("obstacle_note")}</p>` under the counts so the player learns that sealing is allowed and what it does.

Add obstacles to the count line: `{t("count_obstacles")} {obstacles.length}/{maxObstaclesFor(research)}`.

- [ ] **Step 3: Update devtools**

`src/game/devtools.ts` re-exports `findPath` on `__dw.sim`, and its signature
changed in Task 2 — no code change is needed there beyond confirming it still
compiles, since it only forwards the reference. In `App.tsx`, the object passed
to `installDevTools` swaps `digTile` for `placeObstacle` and gains `obstacles`
and `arena`, so console-driven testing can place walls the way it places traps.

- [ ] **Step 4: Full check**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green, no remaining references to `digTile`, `DIG_COST`, `pathExists`, `Grid`, or `need_path`.

Confirm with: `grep -rn "digTile\|DIG_COST\|pathExists\|need_path\|from \"./grid\"" src/ | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Click through the game**

Run the dev server and drive the UI: place both obstacle types, remove one, check the counter and the cap, save, start a raid with a long maze, then with a sealed room, and read the result modal. Watch the console for errors throughout.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/game/devtools.ts
git commit -m "feat: obstacle tools replace digging in the build panel"
```

---

### Task 9: Balance pass

The numbers in Task 3 are guesses. This task replaces them with measured ones.

**Files:**
- Modify: `src/game/sim/obstacles.ts`, `src/game/types.ts`, `server.js` (values only)
- Create: `tests/balance.test.ts`

- [ ] **Step 1: Measure, in a test**

Create `tests/balance.test.ts` that runs headless simulations and asserts the shape of the curve rather than exact values — how long a level-1 party takes to break a barricade and a wall, and that a sealed room at low threat buys more time than an open one but is not a win by itself:

```ts
import { describe, expect, it } from "vitest";
import { RaidSim, SIM_DT } from "../src/game/sim/RaidSim";
import { arenaFor, coreOf, entranceOf } from "../src/game/arena";
import type { PartyMember, PlacedObstacle } from "../src/game/types";

const arena = arenaFor([]);

function secondsToBreak(type: "barricade" | "wall", party: PartyMember[]): number {
  const obstacles: PlacedObstacle[] = [];
  for (let y = 0; y < 12; y++) obstacles.push({ id: `o${y}`, type, x: 5, y });
  const sim = new RaidSim({
    minions: [], traps: [], obstacles, party, arena,
    entrance: entranceOf(arena), core: coreOf(arena), lures: [], seed: 1,
  });
  for (let i = 0; i < 6000; i++) {
    sim.step();
    if (sim.destroyedObstacleIds.length > 0) return sim.state.elapsed;
  }
  return Infinity;
}

describe("obstacle balance", () => {
  const solo: PartyMember[] = [{ id: "a1", cls: "knight", name: "Aldric", level: 1 }];

  it("a barricade costs a lone level-1 knight between 5 and 15 seconds", () => {
    const seconds = secondsToBreak("barricade", solo);
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(15);
  });

  it("a stone wall costs at least twice as much time as a barricade", () => {
    expect(secondsToBreak("wall", solo)).toBeGreaterThan(secondsToBreak("barricade", solo) * 2);
  });
});
```

- [ ] **Step 2: Run it and adjust**

Run: `npm test -- tests/balance.test.ts`

If the assertions fail, change the HP values in `OBSTACLE_STATS` — not the assertions — until the curve is right. Then sanity-check the cost side by hand: with `START_GOLD` 200 and digging gone, a first-time player should be able to afford a short maze *and* a minion *and* a trap. If they cannot, lower `OBSTACLE_COST.barricade`.

Whatever the final numbers are, mirror them into `server.js` and `src/game/types.ts` in the same commit.

- [ ] **Step 3: Commit**

```bash
git add src/game/sim/obstacles.ts src/game/types.ts server.js tests/balance.test.ts
git commit -m "balance: measure what an obstacle actually buys"
```

- [ ] **Step 4: Update the spec**

Replace the provisional numbers in `docs/superpowers/specs/2026-09-09-defense-pivot-design.md` with the measured ones and drop the word "provisional".

```bash
git add docs/superpowers/specs/2026-09-09-defense-pivot-design.md
git commit -m "docs: record the measured obstacle numbers"
```

---

## Done when

- `npm run typecheck`, `npm run build` and `npm test` all pass.
- No reference to `digTile`, `DIG_COST`, `pathExists`, `need_path`, `GridData` or `TILE.ROCK` remains in `src/`.
- A version 1 save loads as version 2 with gold, research and placements intact.
- A long maze is walked in full with no obstacle taking damage; a sealed room is broken through and everyone repaths.
- The live preview verse charges for obstacles, enforces the cap, and refuses one on the entrance or the core.
