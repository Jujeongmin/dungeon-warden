import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESEARCH } from "../src/game/td/research";
import { SPAWN_INTERVAL, WAVES_PER_STAGE, endlessWave, waveSize } from "../src/game/td/stages";

/**
 * server.js runs in a sandbox and exports nothing, so it is loaded here as
 * text and run with small stand-ins for the platform's globals. What it
 * mirrors from the client is checked against the client's own rules.
 */

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

interface Store {
  state: Record<string, unknown>;
  board: Map<string, Record<string, unknown>>;
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
    getCollectionItem: async (_: string, id: string) => store.board.get(id) ?? {},
    addCollectionItem: async (_: string, item: Record<string, unknown>) => void store.board.set(item.__id as string, item),
    updateCollectionItem: async (_: string, item: Record<string, unknown>) => void store.board.set(item.__id as string, item),
    getCollectionItems: async () => [...store.board.values()].sort((a, b) => (b.waves as number) - (a.waves as number)),
  };
  const $lock = async (_key: string, fn: () => Promise<unknown>) => fn();
  const Server = Function("$global", "$sender", "$lock", `${source}\nreturn Server;`)($global, { account }, $lock);
  const helpers = Function("$global", "$sender", "$lock", `${source}\nreturn { waveCount, hasChampion, leastSeconds };`)(
    $global,
    { account },
    $lock,
  );
  return { server: new Server(), helpers };
}

/** A table literal out of server.js, evaluated. */
function serverTable(name: string): Record<string, Record<string, unknown>> {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf("\n};\n", start);
  return Function(`return (${source.slice(start + `const ${name} = `.length, end + 2)});`)();
}

let store: Store;
beforeEach(() => {
  store = { state: {}, board: new Map() };
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

describe("server mirrors", () => {
  it("counts each wave as the client builds it", () => {
    const { helpers } = boot(store);
    for (let i = 0; i < 60; i++) {
      expect(helpers.waveCount(i) + (helpers.hasChampion(i) ? 1 : 0), `wave ${i}`).toBe(waveSize(endlessWave(i)));
    }
    let spread = 0;
    for (let i = 0; i < 20; i++) spread += (waveSize(endlessWave(i)) - 1) * SPAWN_INTERVAL;
    expect(helpers.leastSeconds(20)).toBeCloseTo(spread);
  });

  it("has the client's research", () => {
    const table = serverTable("RESEARCH");
    expect(Object.keys(table)).toEqual(RESEARCH.map((n) => n.id));
    for (const node of RESEARCH) {
      expect(table[node.id].cost, node.id).toBe(node.cost);
      expect(table[node.id].requires ?? [], node.id).toEqual(node.requires ?? []);
    }
  });
});

describe("a run", () => {
  it("pays a soul per stage cleared, keeps the best, and ranks it", async () => {
    const { server } = boot(store);
    await server.startRun();
    vi.setSystemTime(1_000_000 + 600_000);
    const result = await server.finishRun({ wavesCleared: WAVES_PER_STAGE * 3 + 2 });
    expect(result.souls).toBe(3);
    expect(result.progress.bestWaves).toBe(17);
    const { top, mine } = await server.getRankings();
    expect(top[0].stage).toBe(4);
    expect(mine.waves).toBe(17);
  });

  it("is refused when the waves could not have come in that fast", async () => {
    const { server } = boot(store);
    await server.startRun();
    vi.setSystemTime(1_000_000 + 5_000);
    await expect(server.finishRun({ wavesCleared: 20 })).rejects.toThrow("RUN_TOO_FAST");
  });

  it("does not lower the best, but still pays", async () => {
    const { server } = boot(store);
    await server.startRun();
    vi.setSystemTime(1_000_000 + 600_000);
    await server.finishRun({ wavesCleared: 20 });
    await server.startRun();
    vi.setSystemTime(1_000_000 + 1_200_000);
    const again = await server.finishRun({ wavesCleared: 6 });
    expect(again.improved).toBe(false);
    expect(again.progress.bestWaves).toBe(20);
    expect(again.progress.souls).toBe(5);
  });

  it("needs a run opened first", async () => {
    const { server } = boot(store);
    await expect(server.finishRun({ wavesCleared: 1 })).rejects.toThrow("NO_RUN_OPEN");
  });
});

describe("research and names", () => {
  it("sells research for souls it has, and not for souls it has not", async () => {
    const { server } = boot(store);
    await server.startRun();
    vi.setSystemTime(1_000_000 + 600_000);
    await server.finishRun({ wavesCleared: 15 }); // 3 souls
    await expect(server.researchNode({ id: "mage" })).resolves.toBeTruthy();
    await expect(server.researchNode({ id: "grunt" })).rejects.toThrow("NOT_ENOUGH_SOULS");
    await expect(server.researchNode({ id: "toString" })).rejects.toThrow("UNKNOWN_RESEARCH");
  });

  it("renames the ranking row", async () => {
    const { server } = boot(store);
    await server.startRun();
    vi.setSystemTime(1_000_000 + 600_000);
    await server.finishRun({ wavesCleared: 7 });
    await server.setNickname({ nickname: "  Bonelord  " });
    const { mine } = await server.getRankings();
    expect(mine.nickname).toBe("Bonelord");
  });

  it("grants 3x once per purchase, and nothing else is for sale", async () => {
    const { server } = boot(store);
    await server.$onItemPurchased({ account: "acct", purchaseId: "p1", productId: "raid_speed_3x", quantity: 1 });
    await server.$onItemPurchased({ account: "acct", purchaseId: "p1", productId: "raid_speed_3x", quantity: 1 });
    expect(store.state.entitlements).toEqual({ fastForward: true });
    const other = await server.$onItemPurchased({ account: "acct", purchaseId: "p2", productId: "warden_skin_ember", quantity: 1 });
    expect(other.success).toBe(false);
  });
});
