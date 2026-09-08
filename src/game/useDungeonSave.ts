import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { Grid, createLocalDungeon } from "./grid";
import { maybeShowInterstitial, showGoldRefillAd, AD_PLACEMENT } from "./ads";
import { addCost, sameList } from "./placements";
import { EMPTY_ROOM_EFFECTS, roomCovers, roomEffects, roomTiles } from "./rooms";
import { RESEARCH_BY_ID, researchEffects } from "./research";
import {
  DIG_COST,
  EMPTY_ENTITLEMENTS,
  MAX_DIGS_PER_SAVE,
  MAX_ROOMS,
  MAX_TRAPS,
  MINION_COST,
  ROOM_COST,
  TILE,
  TRAP_COST,
  type AdClaimResult,
  type AdventurerRecord,
  type Dungeon,
  type Entitlements,
  type LoadResult,
  type LootItem,
  type MinionType,
  type PlacedMinion,
  type PlacedRoom,
  type PlacedTrap,
  type Prisoner,
  type RoomType,
  type SaveResult,
  type TrapType,
} from "./types";

const AUTOSAVE_INTERVAL_MS = 60_000;

export type SaveStatus =
  | "connecting"
  | "loading"
  | "ready"
  | "saving"
  | "offline"
  | "error";

/** True once the project has been deployed at least once. */
const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);

export interface DungeonMeta {
  entrance: { x: number; y: number };
  core: { x: number; y: number };
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
}

function metaOf(dungeon: Dungeon): DungeonMeta {
  return {
    entrance: dungeon.entrance,
    core: dungeon.core,
    threat: dungeon.threat ?? 0,
    wavesRepelled: dungeon.wavesRepelled ?? 0,
    coreBreaches: dungeon.coreBreaches ?? 0,
  };
}

/**
 * Owns the save lifecycle: load on connect, batch edits in memory, flush at
 * checkpoints. Edits are never sent one-per-click because remoteFunction is
 * rate limited to roughly 10 calls per second.
 */
export function useDungeonSave() {
  const { server, connected, connecting, account } = useGameServer();

  const [status, setStatus] = useState<SaveStatus>(HAS_VERSE ? "connecting" : "offline");
  const [error, setError] = useState<string | null>(null);
  const [gold, setGold] = useState(0);
  const [entitlements, setEntitlements] = useState<Entitlements>(EMPTY_ENTITLEMENTS);
  const [adBusy, setAdBusy] = useState(false);
  const [pendingDigs, setPendingDigs] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [gridVersion, setGridVersion] = useState(0);
  const [minions, setMinions] = useState<PlacedMinion[]>([]);
  const [traps, setTraps] = useState<PlacedTrap[]>([]);
  const [rooms, setRooms] = useState<PlacedRoom[]>([]);
  const [loot, setLoot] = useState<LootItem[]>([]);
  const [prisoners, setPrisoners] = useState<Prisoner[]>([]);
  const [adventurers, setAdventurers] = useState<AdventurerRecord[]>([]);
  const [research, setResearch] = useState<string[]>([]);
  const [meta, setMeta] = useState<DungeonMeta | null>(null);

  const gridRef = useRef<Grid | null>(null);
  const baselineRef = useRef<number[] | null>(null);
  const savingRef = useRef(false);
  const loadedRef = useRef(false);
  const seqRef = useRef(0);

  const savedMinionsRef = useRef<PlacedMinion[]>([]);
  const savedTrapsRef = useRef<PlacedTrap[]>([]);
  const savedRoomsRef = useRef<PlacedRoom[]>([]);

  const minionsRef = useRef<PlacedMinion[]>([]);
  const trapsRef = useRef<PlacedTrap[]>([]);
  const roomsRef = useRef<PlacedRoom[]>([]);
  minionsRef.current = minions;
  trapsRef.current = traps;
  roomsRef.current = rooms;

  const entitlementsRef = useRef(entitlements);
  entitlementsRef.current = entitlements;

  const effects = roomEffects(rooms);
  const unlocked = researchEffects(research);

  const applyLoad = useCallback((result: LoadResult) => {
    const grid = new Grid(result.dungeon.grid);
    gridRef.current = grid;
    baselineRef.current = grid.snapshot();

    const loadedMinions = result.dungeon.minions ?? [];
    const loadedTraps = result.dungeon.traps ?? [];
    const loadedRooms = result.dungeon.rooms ?? [];

    savedMinionsRef.current = loadedMinions;
    savedTrapsRef.current = loadedTraps;
    savedRoomsRef.current = loadedRooms;
    setMinions(loadedMinions);
    setTraps(loadedTraps);
    setRooms(loadedRooms);
    setLoot(result.dungeon.loot ?? []);
    setPrisoners(result.dungeon.prisoners ?? []);
    setAdventurers(result.dungeon.adventurers ?? []);
    setResearch(result.dungeon.research ?? []);
    setMeta(metaOf(result.dungeon));

    // Keep generated ids from colliding with ids already in the save.
    seqRef.current = Math.max(
      seqRef.current,
      loadedMinions.length + loadedTraps.length + loadedRooms.length,
    );

    setGold(result.gold);
    setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
    setPendingDigs(0);
    setGridVersion((v) => v + 1);
  }, []);

  // Offline fallback so `npm run dev` works before the first deploy.
  useEffect(() => {
    if (HAS_VERSE || loadedRef.current) return;
    loadedRef.current = true;
    applyLoad({
      dungeon: createLocalDungeon(),
      entitlements: EMPTY_ENTITLEMENTS,
      gold: 200,
      created: true,
    });
    setStatus("offline");
  }, [applyLoad]);

  useEffect(() => {
    if (!HAS_VERSE || !connected || loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;
    setStatus("loading");
    server
      .remoteFunction("loadGame", [])
      .then((result: LoadResult) => {
        if (cancelled) return;
        applyLoad(result);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        loadedRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [connected, server, applyLoad]);

  useEffect(() => {
    if (HAS_VERSE && connecting) setStatus("connecting");
  }, [connecting]);

  const pendingCostOf = useCallback((): number => {
    const grid = gridRef.current;
    const baseline = baselineRef.current;
    const digs = grid && baseline ? grid.diffCount(baseline) : 0;
    return (
      digs * DIG_COST +
      addCost(minionsRef.current, savedMinionsRef.current, MINION_COST) +
      addCost(trapsRef.current, savedTrapsRef.current, TRAP_COST) +
      addCost(roomsRef.current, savedRoomsRef.current, ROOM_COST)
    );
  }, []);

  const isDirty = useCallback((): boolean => {
    const grid = gridRef.current;
    const baseline = baselineRef.current;
    if (!grid || !baseline) return false;
    return (
      grid.diffCount(baseline) > 0 ||
      !sameList(minionsRef.current, savedMinionsRef.current) ||
      !sameList(trapsRef.current, savedTrapsRef.current) ||
      !sameList(roomsRef.current, savedRoomsRef.current)
    );
  }, []);

  const saveNow = useCallback(async (): Promise<void> => {
    const grid = gridRef.current;
    const baseline = baselineRef.current;
    if (!grid || !baseline || savingRef.current || !isDirty()) return;

    const nextMinions = minionsRef.current;
    const nextTraps = trapsRef.current;
    const nextRooms = roomsRef.current;

    if (!HAS_VERSE) {
      // Offline preview: commit locally and charge what the server would have.
      const cost = pendingCostOf();
      baselineRef.current = grid.snapshot();
      savedMinionsRef.current = nextMinions;
      savedTrapsRef.current = nextTraps;
      savedRoomsRef.current = nextRooms;
      setGold((current) => Math.max(0, current - cost));
      setPendingDigs(0);
      setLastSavedAt(Date.now());
      return;
    }

    savingRef.current = true;
    setStatus("saving");
    try {
      const result: SaveResult = await server.remoteFunction("saveDungeon", [
        {
          grid: grid.toData(),
          minions: nextMinions,
          traps: nextTraps,
          rooms: nextRooms,
        },
      ]);
      baselineRef.current = grid.snapshot();
      savedMinionsRef.current = nextMinions;
      savedTrapsRef.current = nextTraps;
      savedRoomsRef.current = nextRooms;
      setGold(result.gold);
      setPendingDigs(0);
      setLastSavedAt(result.savedAt);
      setError(null);
      setStatus("ready");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      // The client is now ahead of the server. Reload so the two agree again.
      try {
        const result: LoadResult = await server.remoteFunction("loadGame", []);
        applyLoad(result);
        setStatus("ready");
      } catch {
        /* keep the error state; the banner tells the player to reload */
      }
    } finally {
      savingRef.current = false;
    }
  }, [server, applyLoad, isDirty, pendingCostOf]);

  /** Anything already standing on this tile — one occupant per tile. */
  const occupantAt = useCallback((x: number, y: number): "minion" | "trap" | "room" | null => {
    if (minionsRef.current.some((m) => m.x === x && m.y === y)) return "minion";
    if (trapsRef.current.some((t) => t.x === x && t.y === y)) return "trap";
    if (roomsRef.current.some((r) => roomCovers(r, x, y))) return "room";
    return null;
  }, []);

  const canAfford = useCallback(
    (extra: number): boolean => pendingCostOf() + extra <= gold,
    [gold, pendingCostOf],
  );

  const digTile = useCallback(
    (x: number, y: number): boolean => {
      const grid = gridRef.current;
      const baseline = baselineRef.current;
      if (!grid || !baseline || !grid.canDig(x, y)) return false;
      if (!canAfford(DIG_COST)) return false;

      grid.dig(x, y);
      const digs = grid.diffCount(baseline);
      setPendingDigs(digs);
      setGridVersion((v) => v + 1);

      // Flush before the batch grows past what one save call accepts.
      if (digs >= MAX_DIGS_PER_SAVE) void saveNow();
      return true;
    },
    [canAfford, saveNow],
  );

  const placeMinion = useCallback(
    (type: MinionType, x: number, y: number): boolean => {
      const grid = gridRef.current;
      if (!grid || grid.get(x, y) !== TILE.FLOOR) return false;
      if (!unlocked.unlockedMinions.includes(type)) return false;
      if (minionsRef.current.length >= effects.minionCap) return false;
      if (occupantAt(x, y)) return false;
      if (!canAfford(MINION_COST[type])) return false;

      seqRef.current += 1;
      setMinions([...minionsRef.current, { id: `m${seqRef.current}`, type, x, y }]);
      return true;
    },
    [canAfford, occupantAt, effects.minionCap, unlocked.unlockedMinions],
  );

  const placeTrap = useCallback(
    (type: TrapType, x: number, y: number): boolean => {
      const grid = gridRef.current;
      if (!grid || grid.get(x, y) !== TILE.FLOOR) return false;
      if (!unlocked.unlockedTraps.includes(type)) return false;
      if (trapsRef.current.length >= MAX_TRAPS) return false;
      if (occupantAt(x, y)) return false;
      if (!canAfford(TRAP_COST[type])) return false;

      seqRef.current += 1;
      setTraps([...trapsRef.current, { id: `t${seqRef.current}`, type, x, y }]);
      return true;
    },
    [canAfford, occupantAt, unlocked.unlockedTraps],
  );

  /** Rooms anchor at (x, y) and claim a 2x2 block of corridor. */
  const placeRoom = useCallback(
    (type: RoomType, x: number, y: number): boolean => {
      const grid = gridRef.current;
      if (!grid) return false;
      if (!unlocked.unlockedRooms.includes(type)) return false;
      if (roomsRef.current.length >= MAX_ROOMS) return false;

      for (const tile of roomTiles({ x, y })) {
        if (!grid.inBounds(tile.x, tile.y)) return false;
        if (grid.get(tile.x, tile.y) !== TILE.FLOOR) return false;
        if (occupantAt(tile.x, tile.y)) return false;
      }
      if (!canAfford(ROOM_COST[type])) return false;

      seqRef.current += 1;
      setRooms([...roomsRef.current, { id: `r${seqRef.current}`, type, x, y }]);
      return true;
    },
    [canAfford, occupantAt, unlocked.unlockedRooms],
  );

  /**
   * Buys a research node. Unsaved building is flushed first so the server
   * prices the dungeon and the research against the same gold.
   */
  const buyResearch = useCallback(
    async (id: string): Promise<string | null> => {
      const node = RESEARCH_BY_ID.get(id);
      if (!node) return "UNKNOWN_RESEARCH";

      if (!HAS_VERSE) {
        // Offline preview: mirror the server so the tree can be explored.
        if (research.includes(id)) return "ALREADY_RESEARCHED";
        if ((node.requires ?? []).some((req) => !research.includes(req))) {
          return "MISSING_PREREQUISITE";
        }
        if (gold < node.cost) return "INSUFFICIENT_GOLD";
        setGold((current) => current - node.cost);
        setResearch((current) => [...current, id]);
        return null;
      }

      await saveNow();
      try {
        const result: { research: string[]; gold: number; dungeon: Dungeon } =
          await server.remoteFunction("researchNode", [{ id }]);
        setResearch(result.research);
        setGold(result.gold);
        // Expansion rewrites the grid, so reload rather than patching pieces.
        if (node.expandTo) applyLoad({
          dungeon: result.dungeon,
          entitlements: entitlementsRef.current,
          gold: result.gold,
          created: false,
        });
        return null;
      } catch (e: unknown) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [research, gold, server, saveNow, applyLoad],
  );

  /** Removes whatever occupies the tile. No refund, matching the server. */
  const removeAt = useCallback((x: number, y: number): boolean => {
    const hit = occupantAt(x, y) !== null;
    if (!hit) return false;

    setMinions((current) => current.filter((m) => !(m.x === x && m.y === y)));
    setTraps((current) => current.filter((t) => !(t.x === x && t.y === y)));
    setRooms((current) => current.filter((r) => !roomCovers(r, x, y)));
    return true;
  }, [occupantAt]);

  /** Equips or clears a minion's looted weapon. Free — it is already yours. */
  const equipWeapon = useCallback((minionId: string, weaponId: string | null): void => {
    setMinions((current) =>
      current.map((minion) => {
        if (minion.id === minionId) return { ...minion, weaponId };
        // A weapon is a single object: giving it away takes it off the old owner.
        if (weaponId && minion.weaponId === weaponId) return { ...minion, weaponId: null };
        return minion;
      }),
    );
  }, []);

  const applyRaidResult = useCallback(
    (next: {
      gold: number;
      threat: number;
      wavesRepelled: number;
      coreBreaches: number;
      minions?: PlacedMinion[];
      loot?: LootItem[];
      prisoners?: Prisoner[];
      adventurers?: AdventurerRecord[];
    }) => {
      setGold(next.gold);
      if (next.minions) {
        savedMinionsRef.current = next.minions;
        setMinions(next.minions);
      }
      if (next.loot) setLoot(next.loot);
      if (next.prisoners) setPrisoners(next.prisoners);
      if (next.adventurers) setAdventurers(next.adventurers);
      setMeta((current) =>
        current
          ? {
              ...current,
              threat: next.threat,
              wavesRepelled: next.wavesRepelled,
              coreBreaches: next.coreBreaches,
            }
          : current,
      );
    },
    [],
  );

  const refreshEntitlements = useCallback(async (): Promise<void> => {
    if (!HAS_VERSE) return;
    try {
      const result: { entitlements: Entitlements; gold: number } =
        await server.remoteFunction("getEntitlements", []);
      setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
      setGold(result.gold);
    } catch {
      /* the shop UI stays usable; the next load will pick it up */
    }
  }, [server]);

  const watchAdForGold = useCallback(async (): Promise<AdClaimResult> => {
    if (!HAS_VERSE) return { status: "failed" };
    if (adBusy) return { status: "failed" };

    setAdBusy(true);
    try {
      const ad = await showGoldRefillAd();
      if (ad.status !== "rewarded") {
        return { status: ad.status === "dismissed" ? "dismissed" : "failed" };
      }

      // The verifier can still be settling. Server code cannot sleep, so the
      // retry delay lives here.
      for (let attempt = 0; attempt < 4; attempt++) {
        const claim: AdClaimResult = await server.remoteFunction("claimAdReward", [
          { requestId: ad.requestId, placementId: AD_PLACEMENT.goldRefill },
        ]);
        if (claim.status !== "pending") {
          if (claim.status !== "dismissed" && claim.status !== "failed") {
            setGold(claim.gold);
          }
          return claim;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      return { status: "pending" };
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return { status: "failed" };
    } finally {
      setAdBusy(false);
    }
  }, [server, adBusy]);

  const resetGame = useCallback(async (): Promise<void> => {
    if (!HAS_VERSE) {
      applyLoad({
        dungeon: createLocalDungeon(),
        entitlements: entitlementsRef.current,
        gold: 200,
        created: true,
      });
      return;
    }
    setStatus("saving");
    try {
      const result: LoadResult = await server.remoteFunction("resetGame", []);
      applyLoad(result);
      setError(null);
      setStatus("ready");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [server, applyLoad]);

  // Autosave, and save when the tab goes away.
  useEffect(() => {
    if (!HAS_VERSE) return;

    const timer = window.setInterval(() => void saveNow(), AUTOSAVE_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void saveNow();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => void saveNow());

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [saveNow]);

  return {
    grid: gridRef.current,
    gridVersion,
    gold,
    entitlements,
    adBusy,
    minions,
    traps,
    rooms,
    loot,
    prisoners,
    adventurers,
    research,
    unlocked,
    effects,
    jailFree: Math.max(0, effects.jailCapacity - prisoners.length),
    weaponTiers: Object.fromEntries(
      minions
        .filter((m) => m.weaponId)
        .map((m) => [m.id, loot.find((l) => l.id === m.weaponId)?.tier ?? 0]),
    ),
    meta,
    pendingDigs,
    pendingCost: pendingCostOf(),
    hasUnsaved: isDirty(),
    status,
    error,
    lastSavedAt,
    account,
    isOffline: !HAS_VERSE,
    digTile,
    placeMinion,
    placeTrap,
    placeRoom,
    removeAt,
    equipWeapon,
    buyResearch,
    applyRaidResult,
    saveNow,
    resetGame,
    refreshEntitlements,
    watchAdForGold,
    maybeShowInterstitial: () => maybeShowInterstitial(entitlementsRef.current.adsRemoved),
  };
}

export { EMPTY_ROOM_EFFECTS };
