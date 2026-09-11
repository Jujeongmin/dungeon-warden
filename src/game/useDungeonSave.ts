import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { arenaFor, coreOf, entranceOf, inArena, type Arena, blockedKey } from "./arena";
import {
  DIG_COST,
  connects,
  digFromWalls,
  dugId,
  dugSet,
  dugTile,
  isFixed,
  startingDig,
  type DugTile,
} from "./dig";
import { REFUND_RATE, addCost, removedValue, sameList } from "./placements";
import { EMPTY_ROOM_EFFECTS, roomCovers, roomEffects, roomTiles } from "./rooms";
import { RESEARCH_BY_ID, researchEffects } from "./research";
import { installServerProbe } from "./devtools";
import { maxIdSuffix } from "./idSeq";
import { minionStatsFor } from "./sim/units";
import {
  EMPTY_ENTITLEMENTS,
  MAX_ROOMS,
  MAX_TRAPS,
  MINION_COST,
  OBSTACLE_COST,
  ROOM_COST,
  TRAP_COST,
  maxObstaclesFor,
  type AdventurerRecord,
  type Dungeon,
  type Entitlements,
  type LoadResult,
  type LootItem,
  type MinionType,
  type ObstacleType,
  type PlacedMinion,
  type PlacedObstacle,
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
 * Offline fallback so `npm run dev` is playable before the first deploy, when
 * VITE_AGENT8_VERSE does not exist yet. Never persisted.
 */
function createLocalDungeon(): Dungeon {
  const arena = arenaFor([]);
  const now = Date.now();
  return {
    version: 2,
    obstacles: [],
    minions: [],
    traps: [],
    rooms: [],
    loot: [],
    prisoners: [],
    adventurers: [],
    research: [],
    entrance: entranceOf(arena),
    core: coreOf(arena),
    threat: 0,
    wavesRepelled: 0,
    coreBreaches: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
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
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [obstacles, setObstacles] = useState<PlacedObstacle[]>([]);
  const [minions, setMinions] = useState<PlacedMinion[]>([]);
  const [traps, setTraps] = useState<PlacedTrap[]>([]);
  const [rooms, setRooms] = useState<PlacedRoom[]>([]);
  const [dug, setDug] = useState<DugTile[]>([]);
  const [loot, setLoot] = useState<LootItem[]>([]);
  const [prisoners, setPrisoners] = useState<Prisoner[]>([]);
  const [adventurers, setAdventurers] = useState<AdventurerRecord[]>([]);
  const [research, setResearch] = useState<string[]>([]);
  const [meta, setMeta] = useState<DungeonMeta | null>(null);

  const savingRef = useRef(false);
  const loadedRef = useRef(false);
  const seqRef = useRef(0);

  const arenaRef = useRef<Arena>(arenaFor([]));
  const researchRef = useRef<string[]>([]);

  const savedMinionsRef = useRef<PlacedMinion[]>([]);
  const savedTrapsRef = useRef<PlacedTrap[]>([]);
  const savedRoomsRef = useRef<PlacedRoom[]>([]);
  const savedObstaclesRef = useRef<PlacedObstacle[]>([]);

  const minionsRef = useRef<PlacedMinion[]>([]);
  const lootRef = useRef<LootItem[]>([]);
  const dugRef = useRef<DugTile[]>([]);
  const savedDugRef = useRef<DugTile[]>([]);
  const trapsRef = useRef<PlacedTrap[]>([]);
  const roomsRef = useRef<PlacedRoom[]>([]);
  const obstaclesRef = useRef<PlacedObstacle[]>([]);
  minionsRef.current = minions;
  lootRef.current = loot;
  dugRef.current = dug;
  trapsRef.current = traps;
  roomsRef.current = rooms;
  obstaclesRef.current = obstacles;

  const entitlementsRef = useRef(entitlements);
  entitlementsRef.current = entitlements;

  // metaRef lets isEntrance/isCore stay referentially stable across renders
  // while always reading the latest loaded meta.
  const metaRef = useRef<DungeonMeta | null>(null);
  metaRef.current = meta;

  const effects = roomEffects(rooms, entitlements);
  const unlocked = researchEffects(research);
  const arena = useMemo(() => arenaFor(research), [research]);
  arenaRef.current = arena;
  researchRef.current = research;

  const isEntrance = useCallback(
    (x: number, y: number) => x === metaRef.current?.entrance.x && y === metaRef.current?.entrance.y,
    [],
  );
  const isCore = useCallback(
    (x: number, y: number) => x === metaRef.current?.core.x && y === metaRef.current?.core.y,
    [],
  );

  // Dev-only console access to the server, for exercising functions that have
  // no UI path yet.
  useEffect(() => {
    installServerProbe((fn, args) => server.remoteFunction(fn, args as unknown[]));
  }, [server]);

  const applyLoad = useCallback((result: LoadResult) => {
    const loadedObstacles = result.dungeon.obstacles ?? [];

    /*
     * A dungeon that predates the carving reads as one anyway.
     *
     * It was a field of floor with walls standing on some of it, so the
     * corridor its owner built is every tile that was not a wall - the shape
     * they made survives exactly, and nobody logs in to a dungeon they do not
     * recognise. A brand new one gets the straight corridor instead, which is
     * the worst possible maze and therefore the best thing to hand someone
     * who has not built one yet.
     */
    const loadedArena = arenaFor(result.dungeon.research ?? []);
    const loadedDug =
      result.dungeon.dug ??
      (loadedObstacles.length > 0
        ? digFromWalls(loadedArena, loadedObstacles)
        : startingDig(loadedArena));
    savedDugRef.current = loadedDug;
    setDug(loadedDug);
    const loadedMinions = result.dungeon.minions ?? [];
    const loadedTraps = result.dungeon.traps ?? [];
    const loadedRooms = result.dungeon.rooms ?? [];

    savedObstaclesRef.current = loadedObstacles;
    savedMinionsRef.current = loadedMinions;
    savedTrapsRef.current = loadedTraps;
    savedRoomsRef.current = loadedRooms;
    setObstacles(loadedObstacles);
    setMinions(loadedMinions);
    setTraps(loadedTraps);
    setRooms(loadedRooms);
    setLoot(result.dungeon.loot ?? []);
    setPrisoners(result.dungeon.prisoners ?? []);
    setAdventurers(result.dungeon.adventurers ?? []);
    setResearch(result.dungeon.research ?? []);
    setMeta(metaOf(result.dungeon));

    // Keep generated ids from colliding with ids already in the save: seed
    // from the highest numeric suffix actually in use per collection, not
    // from a count (which falls behind as soon as low-numbered items are
    // deleted and can then regenerate an id still present in the save).
    seqRef.current = Math.max(
      seqRef.current,
      maxIdSuffix(loadedObstacles.map((o) => o.id), "o"),
      maxIdSuffix(loadedMinions.map((m) => m.id), "m"),
      maxIdSuffix(loadedTraps.map((t) => t.id), "t"),
      maxIdSuffix(loadedRooms.map((r) => r.id), "r"),
    );

    setGold(result.gold);
    setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
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

  /**
   * What the server will charge for the state as it stands, against what it
   * last saw.
   *
   * Not shown to anyone any more - the player is charged the moment they
   * place and paid the moment they clear, and this is only here so the
   * autosave below knows whether it has anything to say.
   */
  const pendingCostOf = useCallback((): number => {
    const added =
      addCost(minionsRef.current, savedMinionsRef.current, MINION_COST) +
      addCost(trapsRef.current, savedTrapsRef.current, TRAP_COST) +
      addCost(roomsRef.current, savedRoomsRef.current, ROOM_COST) +
      addCost(obstaclesRef.current, savedObstaclesRef.current, OBSTACLE_COST) +
      addCost(dugRef.current, savedDugRef.current, { dig: DIG_COST });
    const back =
      removedValue(minionsRef.current, savedMinionsRef.current, MINION_COST) +
      removedValue(trapsRef.current, savedTrapsRef.current, TRAP_COST) +
      removedValue(roomsRef.current, savedRoomsRef.current, ROOM_COST) +
      removedValue(obstaclesRef.current, savedObstaclesRef.current, OBSTACLE_COST) +
      removedValue(dugRef.current, savedDugRef.current, { dig: DIG_COST });
    return added - back;
  }, []);

  const isDirty = useCallback((): boolean => {
    return (
      !sameList(minionsRef.current, savedMinionsRef.current) ||
      !sameList(trapsRef.current, savedTrapsRef.current) ||
      !sameList(roomsRef.current, savedRoomsRef.current) ||
      !sameList(obstaclesRef.current, savedObstaclesRef.current) ||
      !sameList(dugRef.current, savedDugRef.current)
    );
  }, []);

  /**
   * Pushes the dungeon to the server.
   *
   * No longer something the player does. Gold has already moved on the client
   * by the time this runs - charged on placing, paid back on clearing - so
   * this is the server catching up, and the number it hands back is the one
   * the purse ends on. The two agree because they price the same way; the
   * server is simply the one that is allowed to be right.
   */
  const saveNow = useCallback(async (): Promise<void> => {
    if (savingRef.current || !isDirty()) return;

    const nextMinions = minionsRef.current;
    const nextTraps = trapsRef.current;
    const nextRooms = roomsRef.current;
    const nextObstacles = obstaclesRef.current;
    const nextDug = dugRef.current;

    if (!HAS_VERSE) {
      // Offline preview. No charge here: the purse was already emptied when
      // the thing was placed, and taking it again would bill twice.
      savedMinionsRef.current = nextMinions;
      savedTrapsRef.current = nextTraps;
      savedRoomsRef.current = nextRooms;
      savedObstaclesRef.current = nextObstacles;
      savedDugRef.current = nextDug;
      setLastSavedAt(Date.now());
      return;
    }

    savingRef.current = true;
    setStatus("saving");
    try {
      const result: SaveResult = await server.remoteFunction("saveDungeon", [
        {
          dug: nextDug,
          obstacles: nextObstacles,
          minions: nextMinions,
          traps: nextTraps,
          rooms: nextRooms,
        },
      ]);
      savedMinionsRef.current = nextMinions;
      savedTrapsRef.current = nextTraps;
      savedRoomsRef.current = nextRooms;
      savedObstaclesRef.current = nextObstacles;
      savedDugRef.current = nextDug;
      setGold(result.gold);
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
  const occupantAt = useCallback(
    (x: number, y: number): "minion" | "trap" | "room" | "obstacle" | "terrain" | null => {
      // Rock. Checked first and checked here, because this one function is
      // the gate every placement goes through - putting it anywhere else
      // means remembering it four times.
      const arena = arenaRef.current;
      if (!dugSet(arena, dugRef.current).has(blockedKey(x, y, arena.w))) return "terrain";
      if (minionsRef.current.some((m) => m.x === x && m.y === y)) return "minion";
      if (trapsRef.current.some((t) => t.x === x && t.y === y)) return "trap";
      if (roomsRef.current.some((r) => roomCovers(r, x, y))) return "room";
      if (obstaclesRef.current.some((o) => o.x === x && o.y === y)) return "obstacle";
      return null;
    },
    [],
  );

  // Gold is charged at the moment of placing, so what is in the purse is
   // already net of everything built so far.
  const canAfford = useCallback((extra: number): boolean => extra <= gold, [gold]);

  const placeMinion = useCallback(
    (type: MinionType, x: number, y: number): boolean => {
      if (!inArena(arenaRef.current, x, y)) return false;
      if (isEntrance(x, y) || isCore(x, y)) return false;
      if (!unlocked.unlockedMinions.includes(type)) return false;
      if (minionsRef.current.length >= effects.minionCap) return false;
      if (occupantAt(x, y)) return false;
      if (!canAfford(MINION_COST[type])) return false;

      seqRef.current += 1;
      setMinions([...minionsRef.current, { id: `m${seqRef.current}`, type, x, y }]);
      setGold((current) => current - MINION_COST[type]);
      return true;
    },
    [canAfford, occupantAt, isEntrance, isCore, effects.minionCap, unlocked.unlockedMinions],
  );

  const placeTrap = useCallback(
    (type: TrapType, x: number, y: number): boolean => {
      if (!inArena(arenaRef.current, x, y)) return false;
      if (isEntrance(x, y) || isCore(x, y)) return false;
      if (!unlocked.unlockedTraps.includes(type)) return false;
      if (trapsRef.current.length >= MAX_TRAPS) return false;
      if (occupantAt(x, y)) return false;
      if (!canAfford(TRAP_COST[type])) return false;

      seqRef.current += 1;
      setTraps([...trapsRef.current, { id: `t${seqRef.current}`, type, x, y }]);
      setGold((current) => current - TRAP_COST[type]);
      return true;
    },
    [canAfford, occupantAt, isEntrance, isCore, unlocked.unlockedTraps],
  );

  const placeObstacle = useCallback(
    (type: ObstacleType, x: number, y: number): boolean => {
      const arena = arenaRef.current;
      if (!inArena(arena, x, y)) return false;
      // The two tiles the whole game is measured between stay clear.
      if (isEntrance(x, y) || isCore(x, y)) return false;
      if (occupantAt(x, y)) return false;
      if (obstaclesRef.current.length >= maxObstaclesFor(researchRef.current, entitlementsRef.current)) return false;
      if (!canAfford(OBSTACLE_COST[type])) return false;

      seqRef.current += 1;
      setObstacles([...obstaclesRef.current, { id: `o${seqRef.current}`, type, x, y }]);
      setGold((current) => current - OBSTACLE_COST[type]);
      return true;
    },
    [canAfford, occupantAt, isEntrance, isCore],
  );

  /** Rooms anchor at (x, y) and claim a 2x2 block of corridor. */
  const placeRoom = useCallback(
    (type: RoomType, x: number, y: number): boolean => {
      if (!unlocked.unlockedRooms.includes(type)) return false;
      if (roomsRef.current.length >= MAX_ROOMS) return false;

      for (const tile of roomTiles({ x, y })) {
        if (!inArena(arenaRef.current, tile.x, tile.y)) return false;
        if (isEntrance(tile.x, tile.y) || isCore(tile.x, tile.y)) return false;
        if (occupantAt(tile.x, tile.y)) return false;
      }
      if (!canAfford(ROOM_COST[type])) return false;

      seqRef.current += 1;
      setRooms([...roomsRef.current, { id: `r${seqRef.current}`, type, x, y }]);
      setGold((current) => current - ROOM_COST[type]);
      return true;
    },
    [canAfford, occupantAt, isEntrance, isCore, unlocked.unlockedRooms],
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
        const result: { research: string[]; gold: number } = await server.remoteFunction(
          "researchNode",
          [{ id }],
        );
        setResearch(result.research);
        setGold(result.gold);
        return null;
      } catch (e: unknown) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [research, gold, server, saveNow],
  );

  /** Removes whatever occupies the tile. No refund, matching the server. */
  /**
   * Takes one tile of rock out.
   *
   * Only next to somewhere you can already stand. A dungeon is a connected
   * thing, and letting someone open a sealed pocket in the middle of the rock
   * would let them build a room the raid can never reach and a route that
   * cannot exist.
   */
  const dig = useCallback((x: number, y: number): boolean => {
    const arena = arenaRef.current;
    if (!inArena(arena, x, y)) return false;

    const open = dugSet(arena, dugRef.current);
    if (open.has(blockedKey(x, y, arena.w))) return false;

    const touching = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      open.has(blockedKey(x + dx, y + dy, arena.w)),
    );
    if (!touching) return false;
    if (!canAfford(DIG_COST)) return false;

    setDug([...dugRef.current, dugTile(x, y)]);
    setGold((current) => current - DIG_COST);
    return true;
  }, [canAfford]);

  /**
   * Puts one tile of rock back, and pays for it.
   *
   * Refused on anything standing on that tile, on the two fixed points, and
   * on a tile whose removal would cut the corridor in two - filling in behind
   * the party is not a move, it is a way to make the dungeon unplayable.
   */
  const fill = useCallback((x: number, y: number): boolean => {
    const arena = arenaRef.current;
    if (!inArena(arena, x, y) || isFixed(arena, x, y)) return false;

    const key = blockedKey(x, y, arena.w);
    if (!dugSet(arena, dugRef.current).has(key)) return false;
    if (occupantAt(x, y)) return false;

    /*
     * Refused only if it would break a way through that currently exists.
     *
     * A dungeon starts as two tiles with rock between them, so "not connected"
     * is the normal state of one being built - testing the result alone would
     * refuse every fill until the corridor was finished, including undoing a
     * tile the player had just dug by mistake.
     */
    const next = dugRef.current.filter((tile) => tile.id !== dugId(x, y));
    if (connects(arena, dugRef.current) && !connects(arena, next)) return false;

    setDug(next);
    setGold((current) => current + Math.floor(DIG_COST * REFUND_RATE));
    return true;
  }, [occupantAt]);

  const removeAt = useCallback((x: number, y: number): boolean => {
    // Scenery is not the player's to clear. It read as null-or-something and
    // so reported success on a barrel: nothing was filtered out, true came
    // back, and the caller played the place sound for a tile that had not
    // changed.
    const occupant = occupantAt(x, y);
    if (occupant === null || occupant === "terrain") return false;

    /*
     * Paid back on the tap, not on a save.
     *
     * Priced from what is actually standing there rather than from the tool
     * in hand, because the remove tool clears whatever it lands on and the
     * four things it can land on do not cost the same.
     */
    const minion = minionsRef.current.find((m) => m.x === x && m.y === y);
    const trap = trapsRef.current.find((t) => t.x === x && t.y === y);
    const room = roomsRef.current.find((r) => roomCovers(r, x, y));
    const obstacle = obstaclesRef.current.find((o) => o.x === x && o.y === y);
    const back =
      (minion ? Math.floor(MINION_COST[minion.type] * REFUND_RATE) : 0) +
      (trap ? Math.floor(TRAP_COST[trap.type] * REFUND_RATE) : 0) +
      (room ? Math.floor(ROOM_COST[room.type] * REFUND_RATE) : 0) +
      (obstacle ? Math.floor(OBSTACLE_COST[obstacle.type] * REFUND_RATE) : 0);

    setMinions((current) => current.filter((m) => !(m.x === x && m.y === y)));
    setTraps((current) => current.filter((t) => !(t.x === x && t.y === y)));
    setRooms((current) => current.filter((r) => !roomCovers(r, x, y)));
    setObstacles((current) => current.filter((o) => !(o.x === x && o.y === y)));
    if (back > 0) setGold((current) => current + back);
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

  /**
   * Hands every looted weapon to the minion it is worth the most on.
   *
   * Eight minions and eight dropdowns is a spreadsheet, and on a phone it is
   * a spreadsheet you scroll. It is also a puzzle with one answer: the bonus
   * is a percentage of the holder's own damage, so the best tier belongs on
   * the hardest hitter, the next on the next, and so on. Nothing is being
   * decided by hand that the player would decide differently.
   *
   * Ranked by unarmed damage on purpose - ranking by current damage would
   * let whatever each minion happens to be holding decide where it lands.
   *
   * Written in one pass rather than by repeated equipWeapon calls: every
   * minion is reassigned, including the ones that end up with nothing, so a
   * weapon that used to be held by a minion outside the new pairing is not
   * left behind as a second copy.
   */
  const equipBest = useCallback((): void => {
    setMinions((current) => {
      const ranked = [...current].sort(
        (a, b) => minionStatsFor(b, 0).damage - minionStatsFor(a, 0).damage,
      );
      const best = [...lootRef.current].sort((a, b) => b.tier - a.tier);
      const assigned = new Map<string, string | null>();
      ranked.forEach((minion, i) => assigned.set(minion.id, best[i]?.id ?? null));
      return current.map((minion) => ({ ...minion, weaponId: assigned.get(minion.id) ?? null }));
    });
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

  /**
   * Drops obstacles a raid destroyed from local state, matching the server
   * (which already removed them in finishRaid) so the board never disagrees
   * with the save until the next reload.
   */
  const clearDestroyedObstacles = useCallback((ids: string[]): void => {
    if (ids.length === 0) return;
    const destroyed = new Set(ids);
    savedObstaclesRef.current = savedObstaclesRef.current.filter((o) => !destroyed.has(o.id));
    setObstacles((current) => current.filter((o) => !destroyed.has(o.id)));
  }, []);

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

  /*
   * Push shortly after the player stops changing things.
   *
   * There is no save button any more, so the only thing standing between a
   * placement and the server is this. Debounced rather than immediate because
   * laying a row of crates is five taps in two seconds and that is one save,
   * not five - and the interval below is the backstop for anything this
   * misses.
   */
  useEffect(() => {
    if (!HAS_VERSE) return;
    const timer = window.setTimeout(() => void saveNow(), 700);
    return () => window.clearTimeout(timer);
  }, [minions, traps, rooms, obstacles, saveNow]);

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
    arena,
    gold,
    entitlements,
    obstacles,
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
    pendingCost: pendingCostOf(),
    hasUnsaved: isDirty(),
    status,
    error,
    lastSavedAt,
    account,
    isOffline: !HAS_VERSE,
    placeMinion,
    placeTrap,
    placeRoom,
    placeObstacle,
    dig,
    /** Whether the door can reach the core: what a raid needs. */
    connected: connects(arena, dug),
    fill,
    dug,
    removeAt,
    equipWeapon,
    equipBest,
    buyResearch,
    applyRaidResult,
    /** For anything that mints gold server-side and hands back the new total. */
    setGoldFromServer: setGold,
    clearDestroyedObstacles,
    saveNow,
    resetGame,
    refreshEntitlements,
  };
}

export { EMPTY_ROOM_EFFECTS };
