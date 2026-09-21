import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESEARCH } from "../src/game/td/research";
import { SPAWN_INTERVAL, STAGES, waveSize } from "../src/game/td/stages";

/**
 * server.js runs in a sandbox and exports nothing, so it is loaded here as
 * text and run with small stand-ins for the platform's globals. What it
 * mirrors from the client is checked against the client's own tables.
 */

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

interface Store {
  state: Record<string, unknown>;
}

function boot(store: Store, account = "acct") {
  const $global = {
    getMyState: async () => store.state,
    updateMyState: async (patch: Record<string, unknown>) => {
      store.state = { ...store.state, ...patch };
    },
    getUserState: async () => store.state,
    updateUserState: async (_: string, patch: Record<string, unknown>) => {
      store.state = { ...store.state, ...patch };
    },
  };
  const $lock = async (_key: string, fn: () => Promise<unknown>) => fn();
  const Server = Function("$global", "$sender", "$lock", `${source}\nreturn Server;`)(
    $global,
    { account },
    $lock,
  );
  return new Server();
}

/** A table literal out of server.js, evaluated. */
function serverTable(name: string): Record<string, Record<string, unknown>> {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf("\n};\n", start);
  return Function(`return (${source.slice(start + `const ${name} = `.length, end + 2)});`)();
}

describe("server mirrors", () => {
  it("has the client's stages", () => {
    const table = serverTable("STAGES");
    expect(Object.keys(table).map(Number)).toEqual(STAGES.map((s) => s.id));
    for (const stage of STAGES) {
      const spread = stage.waves.reduce((sum, w) => sum + (waveSize(w) - 1) * SPAWN_INTERVAL, 0);
      expect(table[stage.id], `stage ${stage.id}`).toEqual({
        waves: stage.waves.length,
        lives: stage.lives,
        minSeconds: Math.floor(spread),
      });
    }
  });

  it("has the client's research", () => {
    const table = serverTable("RESEARCH");
    expect(Object.keys(table)).toEqual(RESEARCH.map((n) => n.id));
    for (const node of RESEARCH) {
      expect(table[node.id].cost, node.id).toBe(node.cost);
      expect(table[node.id].requires ?? [], node.id).toEqual(node.requires ?? []);
      expect(table[node.id].lives, node.id).toBe(node.lives);
    }
  });
});

describe("the server", () => {
  let store: Store;
  beforeEach(() => {
    store = { state: {} };
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it("starts a new player with nothing, and only stage 1 open", async () => {
    const server = boot(store);
    const { progress } = await server.loadGame();
    expect(progress.best).toEqual({});
    await expect(server.startStage({ stageId: 2 })).rejects.toThrow("STAGE_LOCKED");
    await expect(server.startStage({ stageId: 1 })).resolves.toMatchObject({ stageId: 1 });
  });

  it("records stars for a win played at a believable pace, and opens the next stage", async () => {
    const server = boot(store);
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_000_000 + 60_000);
    const result = await server.finishStage({ stageId: 1, won: true, livesLeft: 20 });
    expect(result.stars).toBe(3);
    await expect(server.startStage({ stageId: 2 })).resolves.toMatchObject({ stageId: 2 });
  });

  it("refuses a win faster than the waves could come in", async () => {
    const server = boot(store);
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_000_000 + 2_000);
    await expect(server.finishStage({ stageId: 1, won: true, livesLeft: 20 })).rejects.toThrow("STAGE_TOO_FAST");
  });

  it("refuses lives the run could not have had", async () => {
    const server = boot(store);
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_000_000 + 60_000);
    await expect(server.finishStage({ stageId: 1, won: true, livesLeft: 99 })).rejects.toThrow("BAD_LIVES");
  });

  it("keeps the best stars, not the latest", async () => {
    const server = boot(store);
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_060_000);
    await server.finishStage({ stageId: 1, won: true, livesLeft: 20 });
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_200_000);
    const again = await server.finishStage({ stageId: 1, won: true, livesLeft: 5 });
    expect(again.stars).toBe(1);
    expect(again.best).toBe(3);
  });

  it("sells research for stars it has, and not for stars it has not", async () => {
    const server = boot(store);
    await server.startStage({ stageId: 1 });
    vi.setSystemTime(1_060_000);
    await server.finishStage({ stageId: 1, won: true, livesLeft: 20 });
    await expect(server.researchNode({ id: "mage" })).resolves.toBeTruthy(); // 3 of 3
    await expect(server.researchNode({ id: "grunt" })).rejects.toThrow("NOT_ENOUGH_STARS");
    await expect(server.researchNode({ id: "toString" })).rejects.toThrow("UNKNOWN_RESEARCH");
  });

  it("grants 3x once per purchase, and nothing else is for sale", async () => {
    const server = boot(store);
    await server.$onItemPurchased({ account: "acct", purchaseId: "p1", productId: "raid_speed_3x", quantity: 1 });
    await server.$onItemPurchased({ account: "acct", purchaseId: "p1", productId: "raid_speed_3x", quantity: 1 });
    expect(store.state.entitlements).toEqual({ fastForward: true });
    const other = await server.$onItemPurchased({ account: "acct", purchaseId: "p2", productId: "warden_skin_ember", quantity: 1 });
    expect(other.success).toBe(false);
  });
});
