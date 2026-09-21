import { describe, expect, it } from "vitest";
import { StageRun } from "../src/game/td/StageRun";
import { researchEffects } from "../src/game/td/research";
import { STAGES, starsFor, type Stage } from "../src/game/td/stages";
import { sellValue, TOWERS } from "../src/game/td/towers";
import { bestPlay, playStage, ALL_RESEARCH } from "./td-bot";

const open = (): Stage => ({
  id: 99,
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
    const stage = STAGES[2];
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

  it("rate a win in stars by the lives left", () => {
    expect(starsFor(20, 20)).toBe(3);
    expect(starsFor(12, 20)).toBe(2);
    expect(starsFor(3, 20)).toBe(1);
    expect(starsFor(0, 20)).toBe(0);
  });
});

/*
 * The difficulty curve, measured by bots in tests/td-bot.ts.
 *
 * A maze is the point of the game, so it has to pay: a switchback beats a
 * row of towers along a straight road, the opening stages are easy for
 * anyone who walls at all, and the late ones want research.
 */
describe("the stages", () => {
  it("open with a stage a maze wins without losing a life", () => {
    const result = playStage(STAGES[0]);
    expect(result.status).toBe("won");
    expect(result.lives).toBe(result.lives0);
  }, 60000);

  it("reward a maze over towers lined along a straight road", () => {
    const stage = STAGES[7];
    expect(playStage(stage).status).toBe("won");
    expect(playStage(stage, { plan: "flat" }).status).toBe("lost");
  }, 120000);

  it("end with a stage researched towers can win", () => {
    const full = bestPlay(STAGES[9], {
      research: ALL_RESEARCH,
      towers: ["warrior", "warrior", "warrior", "mage", "guard"],
    });
    expect(full.status).toBe("won");
  }, 120000);
});
