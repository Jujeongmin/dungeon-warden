import { describe, expect, it } from "vitest";
import { EARLY_GOLD, StageRun } from "../src/game/td/StageRun";
import { researchEffects, RESEARCH } from "../src/game/td/research";
import { ENDLESS, endlessStage, type Stage } from "../src/game/td/stages";
import { findPath } from "../src/game/sim/pathfinding";
import { BOONS_BY_ID, dealBoons } from "../src/game/td/boons";
import type { TowerType } from "../src/game/td/towers";

const everything = researchEffects(RESEARCH.map((n) => n.id));

/** A straight corridor, door at the top and core at the bottom: 1 wide and 12 long, walls either side. */
const corridor = (count = 1): Stage => ({
  arena: { w: 3, h: 12 },
  bedrock: Array.from({ length: 12 }, (_, y) => [{ x: 0, y }, { x: 2, y }]).flat(),
  startGold: 1000,
  lives: 20,
  waves: [[{ cls: "knight", count, level: 1 }]],
});

function tower(type: TowerType, x: number, y: number) {
  return { id: `${type}${x}${y}`, type, x, y, level: 1, cooldown: 0, facing: 0, attackUntil: 0 };
}

function steps(run: StageRun, n: number) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...run.step());
  return events;
}

describe("new towers", () => {
  it("the berserker hits everyone in reach with one swing", () => {
    const stage: Stage = { ...ENDLESS, bedrock: [], waves: [[{ cls: "knight", count: 3, level: 1 }]], waveAt: undefined };
    const run = new StageRun(stage, everything);
    run.enemies.push(
      ...[0, 1, 2].map((i) => ({
        id: `x${i}`, cls: "knight" as const, level: 1, champion: false, wave: 0,
        x: 5 + i * 0.5, y: 5, hp: 999, maxHp: 999, route: [{ x: 5, y: 5 }], next: 1,
        slowUntil: 0, slowFactor: 1, burn: null, poison: null, facing: 0,
      })),
    );
    run.placeTower("berserker", 6, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (run as any).remaining = [99];
    run.status = "wave";
    const hurt = new Set(steps(run, 1).filter((e) => e.kind === "damage").map((e) => (e as { targetId: string }).targetId));
    expect(hurt.size).toBe(3);
  });

  it("the shaman makes the towers round it fire faster, and fires at nothing itself", () => {
    const shots = (withShaman: boolean) => {
      const run = new StageRun(corridor(1), everything);
      // Stood in the lane's walls, beside the adventurer.
      run.towers.push(tower("warrior", 0, 3));
      if (withShaman) run.towers.push(tower("shaman", 2, 3));
      run.enemies.push({
        id: "dummy", cls: "knight", level: 1, champion: false, wave: 0, x: 1, y: 3,
        hp: 1e9, maxHp: 1e9, route: [{ x: 1, y: 3 }], next: 1, slowUntil: 0, slowFactor: 1, burn: null, poison: null, facing: 0,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (run as any).remaining = [99];
      run.status = "wave";
      return steps(run, 400).filter((e) => e.kind === "damage").length;
    };
    const plain = shots(false);
    const hasted = shots(true);
    expect(hasted).toBeGreaterThan(plain * 1.15);
  });

  it("the crossbow reaches further than anything else", () => {
    const run = new StageRun(corridor(1), everything);
    run.towers.push(tower("crossbow", 0, 11));
    run.startWave();
    const first = steps(run, 200).find((e) => e.kind === "damage") as { y: number } | undefined;
    // Fired before the knight was within three tiles of it.
    expect(first).toBeDefined();
    expect(11 - first!.y).toBeGreaterThan(3);
  });
});

describe("new floor traps", () => {
  it("the web slows whoever crosses it", () => {
    const walk = (web: boolean) => {
      const run = new StageRun(corridor(1), everything);
      if (web) run.placeTrap("web", 1, 2);
      run.startWave();
      let n = 0;
      while (run.status === "wave" && n < 2000) { run.step(); n++; }
      return n;
    };
    expect(walk(true)).toBeGreaterThan(walk(false) + 20);
  });

  it("poison keeps hurting after the pool is left behind", () => {
    const run = new StageRun(corridor(1), everything);
    run.placeTrap("poison", 1, 2);
    run.startWave();
    const events = steps(run, 200);
    expect(events.filter((e) => e.kind === "damage" && e.source === "poison").length).toBeGreaterThan(20);
  });

  it("the rune sends an adventurer back the way it came, once", () => {
    const run = new StageRun(corridor(1), everything);
    run.placeTrap("rune", 1, 5);
    run.startWave();
    let furthest = 0;
    let pushed = false;
    let triggers = 0;
    for (let i = 0; i < 600 && run.status === "wave"; i++) {
      for (const e of run.step()) if (e.kind === "trap") triggers++;
      const enemy = run.enemies[0];
      if (!enemy) continue;
      if (enemy.y < furthest - 1) pushed = true;
      furthest = Math.max(furthest, enemy.y);
    }
    expect(pushed).toBe(true);
    expect(triggers).toBe(1);
  });
});

describe("the room thrown down anew", () => {
  it("treats rubble as in the way: nothing is built on it and nobody walks through it", () => {
    const stage: Stage = { ...corridor(1), arena: { w: 3, h: 12 }, bedrock: [], rubble: [{ x: 1, y: 4 }] };
    const run = new StageRun(stage, everything);
    expect(run.placeTower("warrior", 1, 4)).toEqual({ ok: false, reason: "rubble" });
    expect(run.placeTrap("spike", 1, 4)).toEqual({ ok: false, reason: "rubble" });
    expect(run.route()!.some((p) => run.isRubble(p.x, p.y))).toBe(false);
  });

  it("makes the same room from the same number, and different ones from different numbers", () => {
    expect(endlessStage(42)).toEqual(endlessStage(42));
    const layouts = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(endlessStage(i).bedrock)));
    expect(layouts.size).toBeGreaterThan(15);
  });

  it("always leaves a way in, every floor tile reachable, and the door and core rows clear", () => {
    for (let seed = 0; seed < 300; seed++) {
      const stage = endlessStage(seed);
      const { w, h } = stage.arena;
      const rock = new Set(stage.bedrock.map((t) => t.y * w + t.x));
      const inTheWay = new Set([...rock, ...(stage.rubble ?? []).map((t) => t.y * w + t.x)]);
      expect(stage.bedrock.length, `seed ${seed}`).toBeGreaterThan(2);
      for (const t of [...stage.bedrock, ...(stage.rubble ?? [])]) {
        expect(t.y >= 2 && t.y < h - 2, `seed ${seed}`).toBe(true);
      }
      for (const t of stage.rubble ?? []) expect(rock.has(t.y * w + t.x)).toBe(false);
      const run = new StageRun(stage, everything);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (inTheWay.has(y * w + x)) continue;
          expect(findPath(stage.arena, run.entrance, { x, y }, inTheWay), `seed ${seed} ${x},${y}`).not.toBeNull();
        }
      }
    }
  });
});

describe("flyers", () => {
  const openRoom = (): Stage => ({
    arena: { w: 5, h: 8 },
    bedrock: [],
    startGold: 1000,
    lives: 20,
    waves: [[{ cls: "flyer", count: 1, level: 1 }]],
  });

  it("float straight over the maze to the core", () => {
    // Rock across the room but for one end: walkers would have to go round.
    const walled = { ...openRoom(), bedrock: [0, 1, 2, 3].map((x) => ({ x, y: 3 })) };
    const run = new StageRun(walled, everything);
    run.startWave();
    let steps = 0;
    let lastX = run.entrance.x;
    while (run.status === "wave" && steps < 400) {
      run.step();
      steps++;
      if (run.enemies[0]) lastX = run.enemies[0].x;
    }
    expect(lastX).toBe(run.entrance.x);
    expect(run.lives).toBe(run.lives0 - 1);
    // Seven tiles at a tile a second, give or take a step.
    expect(steps * 0.05).toBeLessThan(8);
  });

  it("are not caught by floor traps, but the arrow trap shoots them", () => {
    const floor = new StageRun(openRoom(), everything);
    for (let y = 1; y < 7; y++) floor.placeTrap("spike", floor.entrance.x, y);
    floor.startWave();
    const floorHits = steps(floor, 400).filter((e) => e.kind === "damage").length;
    expect(floorHits).toBe(0);

    const arrow = new StageRun(openRoom(), everything);
    arrow.placeTrap("arrow", 0, 4);
    arrow.startWave();
    expect(steps(arrow, 400).some((e) => e.kind === "damage" && e.source === "trap")).toBe(true);
  });

  it("do not stop a tower being built under them", () => {
    const run = new StageRun(openRoom(), everything);
    run.startWave();
    steps(run, 50);
    const flyer = run.enemies[0];
    expect(run.placeTower("warrior", Math.round(flyer.x), Math.round(flyer.y) + 1).ok).toBe(true);
  });
});

describe("the ad reward", () => {
  it("pays its gold once a run, and not once the run is over", () => {
    const run = new StageRun(corridor(1), everything);
    const gold = run.gold;
    expect(run.claimAdGold()).toBe(true);
    expect(run.gold).toBe(gold + 50);
    expect(run.claimAdGold()).toBe(false);
    expect(run.gold).toBe(gold + 50);
    const over = new StageRun(corridor(1), everything);
    over.status = "lost";
    expect(over.claimAdGold()).toBe(false);
  });
});

describe("stage rewards", () => {
  it("deals three different cards", () => {
    const hand = dealBoons();
    expect(hand).toHaveLength(3);
    expect(new Set(hand.map((b) => b.id)).size).toBe(3);
  });

  it("pays gold and lives at once, and changes what things cost", () => {
    const run = new StageRun(corridor(1), everything);
    const gold = run.gold;
    const lives = run.lives;
    run.takeBoon(BOONS_BY_ID.get("hoard")!);
    run.takeBoon(BOONS_BY_ID.get("thick_walls")!);
    expect(run.gold).toBe(gold + 120);
    expect(run.lives).toBe(lives + 1);

    const full = run.towerPrice("warrior")!;
    run.takeBoon(BOONS_BY_ID.get("cheap_bones")!);
    expect(run.towerPrice("warrior")).toBe(Math.round(full * 0.8));
    // A cheaper tower must also refund less, or buying and selling would pay.
    run.placeTower("warrior", 1, 3);
    expect(run.towerRefund("warrior", 1)).toBeLessThan(full);
  });

  it("makes the towers a card names hit harder", () => {
    const shots = (boon: boolean) => {
      const run = new StageRun(corridor(1), everything);
      if (boon) run.takeBoon(BOONS_BY_ID.get("bone_arrows")!);
      run.towers.push(tower("warrior", 0, 3));
      run.enemies.push({
        id: "dummy", cls: "knight", level: 1, champion: false, wave: 0, x: 1, y: 3,
        hp: 1e9, maxHp: 1e9, route: [{ x: 1, y: 3 }], next: 1, slowUntil: 0, slowFactor: 1, burn: null, poison: null, facing: 0,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (run as any).remaining = [99];
      run.status = "wave";
      return steps(run, 200)
        .filter((e) => e.kind === "damage")
        .reduce((sum, e) => sum + (e as { amount: number }).amount, 0);
    };
    expect(shots(true)).toBeGreaterThan(shots(false) * 1.2);
  });
});

describe("calling a wave early", () => {
  it("pays for every adventurer still in the room, and nothing in an empty one", () => {
    const run = new StageRun({ ...corridor(3), waves: [[{ cls: "knight", count: 3, level: 1 }], [{ cls: "knight", count: 1, level: 1 }]] }, everything);
    run.startWave();
    steps(run, 40);
    expect(run.enemies.length).toBeGreaterThan(0);
    expect(run.earlyBonus()).toBe(run.enemies.length * EARLY_GOLD);

    const gold = run.gold;
    const standing = run.enemies.length;
    const events = [];
    run.startWave();
    events.push(...run.step());
    expect(run.gold).toBe(gold + standing * EARLY_GOLD);

    const empty = new StageRun(corridor(1), everything);
    expect(empty.earlyBonus()).toBe(0);
  });
});
