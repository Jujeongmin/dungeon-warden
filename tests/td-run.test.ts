import { describe, expect, it } from "vitest";
import { StageRun } from "../src/game/td/StageRun";
import { researchEffects } from "../src/game/td/research";
import { ENDLESS, WAVES_PER_STAGE, endlessWave, waveSize, type Stage } from "../src/game/td/stages";
import { sellValue, TOWERS } from "../src/game/td/towers";
import { playStage, ALL_RESEARCH } from "./td-bot";

const open = (): Stage => ({
  arena: { w: 5, h: 6 },
  bedrock: [],
  startGold: 500,
  lives: 20,
  waves: [[{ cls: "knight", count: 2, level: 1 }], [{ cls: "knight", count: 1, level: 1 }]],
});

const base = researchEffects([]);

function runUntilSettled(run: StageRun, seconds = 120) {
  for (let i = 0; i < seconds / 0.05 && run.status === "wave"; i++) run.step();
}

describe("building in the open room", () => {
  it("starts open: every tile but the bedrock can be walked", () => {
    const stage = ENDLESS;
    const run = new StageRun(stage, base);
    const rock = stage.bedrock[0];
    expect(run.isDug(rock.x, rock.y)).toBe(false);
    expect(run.isDug(0, 0)).toBe(true);
    expect(run.route()).not.toBeNull();
  });

  it("refuses a tower that would seal the way in", () => {
    const run = new StageRun(open(), base);
    // Wall off row 2 but for its last tile, then try to close that too.
    for (let x = 0; x < 4; x++) expect(run.placeTower("warrior", x, 2).ok).toBe(true);
    expect(run.placeTower("warrior", 4, 2)).toEqual({ ok: false, reason: "blocks" });
  });

  it("lengthens the route when towers wall across it", () => {
    const run = new StageRun(open(), base);
    const before = run.route()!.length;
    for (let x = 0; x < 4; x++) run.placeTower("warrior", x, 2);
    expect(run.route()!.length).toBeGreaterThan(before);
  });

  it("will not build on the door or the core", () => {
    const run = new StageRun(open(), base);
    expect(run.placeTower("warrior", run.entrance.x, run.entrance.y)).toEqual({ ok: false, reason: "fixed" });
    expect(run.placeTower("warrior", run.core.x, run.core.y)).toEqual({ ok: false, reason: "fixed" });
  });

  it("charges for towers and upgrades, and pays part back on sale", () => {
    const run = new StageRun(open(), base);
    const start = run.gold;
    run.placeTower("warrior", 0, 1);
    const tower = run.towers[0];
    run.upgradeTower(tower.id);
    expect(run.gold).toBe(start - TOWERS.warrior.cost[0] - TOWERS.warrior.cost[1]);
    run.sellTower(tower.id);
    expect(run.gold).toBe(start - TOWERS.warrior.cost[0] - TOWERS.warrior.cost[1] + sellValue("warrior", 2));
  });

  it("keeps locked towers locked until researched", () => {
    const run = new StageRun(open(), base);
    expect(run.placeTower("mage", 0, 1)).toEqual({ ok: false, reason: "locked" });
    const researched = new StageRun(open(), researchEffects(["mage"]));
    expect(researched.placeTower("mage", 0, 1).ok).toBe(true);
  });
});

describe("waves", () => {
  it("wait for the button, then come in", () => {
    const run = new StageRun(open(), base);
    for (let i = 0; i < 100; i++) run.step();
    expect(run.enemies).toHaveLength(0);
    expect(run.startWave()).toBe(true);
    run.step();
    expect(run.enemies.length).toBeGreaterThan(0);
  });

  it("cost lives when they reach the core, and the stage is lost at none", () => {
    const stage = { ...open(), lives: 2, waves: [[{ cls: "rogue" as const, count: 3, level: 1 }]] };
    const run = new StageRun(stage, base);
    run.startWave();
    runUntilSettled(run);
    expect(run.status).toBe("lost");
    expect(run.lives).toBe(0);
  });

  it("pay for kills and for a cleared wave, and the stage is won after the last", () => {
    const run = new StageRun(open(), base);
    for (let x = 0; x < 4; x++) run.placeTower("warrior", x, 2);
    for (const t of run.towers) { run.upgradeTower(t.id); run.upgradeTower(t.id); }
    const gold = run.gold;
    run.startWave();
    runUntilSettled(run);
    expect(run.status).toBe("build");
    expect(run.gold).toBeGreaterThan(gold);
    run.startWave();
    runUntilSettled(run);
    expect(run.status).toBe("won");
    expect(run.lives).toBe(run.lives0);
  });

  it("find their way round a tower dropped in front of them", () => {
    const run = new StageRun(open(), base);
    run.startWave();
    for (let i = 0; i < 20; i++) run.step();
    const ok = run.placeTower("warrior", 2, 3);
    if (ok.ok) {
      runUntilSettled(run);
      expect(["build", "won", "lost"]).toContain(run.status);
    }
  });

  it("catch every adventurer that walks over a floor trap, with no recharge", () => {
    const stage = { ...open(), waves: [[{ cls: "knight" as const, count: 5, level: 1 }]] };
    const run = new StageRun(stage, base);
    run.placeTrap("spike", run.entrance.x, 2);
    run.startWave();
    const hurt = new Set<string>();
    for (let i = 0; i < 2400 && run.status === "wave"; i++) {
      for (const e of run.step()) if (e.kind === "damage" && e.source === "trap") hurt.add(e.targetId);
    }
    expect(hurt.size).toBe(5);
  });

  it("count the waves cleared, which is what a run is scored by", () => {
    const run = new StageRun(open(), base);
    for (let x = 0; x < 4; x++) run.placeTower("warrior", x, 2);
    for (const t of run.towers) { run.upgradeTower(t.id); run.upgradeTower(t.id); }
    run.startWave();
    runUntilSettled(run);
    expect(run.wavesCleared).toBe(1);
  });
});

/*
 * The endless run, measured by the bots in tests/td-bot.ts.
 *
 * A maze is the point of the game, so it has to pay: a switchback gets
 * further than a row of towers along a straight road, research gets further
 * again, and nothing lasts for ever.
 */
describe("the endless run", () => {
  it("never runs out of waves, and they grow", () => {
    expect(waveSize(endlessWave(40))).toBeGreaterThan(waveSize(endlessWave(0)));
    expect(new StageRun(ENDLESS, base).wavesTotal).toBe(Infinity);
  });

  it("has a champion at the end of every stage from the second", () => {
    expect(endlessWave(WAVES_PER_STAGE - 1).some((g) => g.champion)).toBe(false);
    expect(endlessWave(2 * WAVES_PER_STAGE - 1).some((g) => g.champion)).toBe(true);
  });

  it("goes further with a maze than without, further still with research, and ends", () => {
    const flat = playStage(ENDLESS, { plan: "flat" });
    const maze = playStage(ENDLESS);
    const full = playStage(ENDLESS, { research: ALL_RESEARCH, towers: ["warrior", "warrior", "warrior", "mage", "guard"] });
    expect(maze.wavesCleared).toBeGreaterThan(flat.wavesCleared);
    expect(full.wavesCleared).toBeGreaterThanOrEqual(maze.wavesCleared);
    expect(full.status).toBe("lost");
  }, 300000);
});
