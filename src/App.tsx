import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DungeonRenderer, type UnitView, type MarkerView, type ObstacleView } from "./game/DungeonRenderer";
import { useDungeonSave } from "./game/useDungeonSave";
import { useRaid, RAID_SPEEDS } from "./game/useRaid";
import { minionStatsFor } from "./game/sim/units";
import { SKILL_STATS } from "./game/sim/traps";
import { OBSTACLE_STATS } from "./game/sim/obstacles";
import { roomTiles, lureTiles, roomCovers } from "./game/rooms";
import { buildRaidPath } from "./game/sim/pathfinding";
import { blockedSet, coreOf, entranceOf, inArena } from "./game/arena";
import { RESEARCH, RESEARCH_BY_ID, isAvailable } from "./game/research";
import { TUTORIAL, guideFor } from "./game/tutorial";
import { audio } from "./game/audio";
import type { SimEvent } from "./game/sim/RaidSim";
import { installDevTools } from "./game/devtools";
import { ShopDialog } from "./ui/ShopDialog";
import { LeaderboardDialog } from "./ui/LeaderboardDialog";
import { TitleScreen } from "./ui/TitleScreen";
import { SettingsDialog } from "./ui/SettingsDialog";
import { IntroDialog } from "./ui/IntroDialog";
import { ResultDialog } from "./ui/ResultDialog";
import { useCountUp } from "./ui/useCountUp";
import { useSpotlight } from "./ui/useSpotlight";
import { loadSettings, saveSettings, pixelRatioFor, type Settings } from "./game/settings";
import { LocaleProvider, type Translate } from "./i18n";
import { translate, type StringKey } from "./i18n/strings";
import {
  MAX_ROOMS,
  MAX_TRAPS,
  MINION_COST,
  MINION_LABEL,
  OBSTACLE_COST,
  OBSTACLE_LABEL,
  ROOM_COST,
  ROOM_DESCRIPTION,
  ROOM_LABEL,
  SKILL_LABEL,
  TRAP_COST,
  TRAP_LABEL,
  maxObstaclesFor,
  type MinionType,
  type ObstacleType,
  type RoomType,
  type TrapType,
  type WardenSkill,
} from "./game/types";
import "./App.css";

const STATUS_LABEL: Record<string, StringKey> = {
  connecting: "status_connecting",
  loading: "status_loading",
  ready: "status_ready",
  saving: "status_saving",
  offline: "status_offline",
  error: "status_error",
};

const RAID_ERROR_LABEL: Record<string, StringKey> = {
  NO_SAVE: "err_no_save",
  NO_ADVENTURERS: "err_no_adventurers",
};

const RESEARCH_ERROR: Record<string, StringKey> = {
  INSUFFICIENT_GOLD: "err_gold",
  MISSING_PREREQUISITE: "err_prereq",
  ALREADY_RESEARCHED: "err_done",
};

const MS_PER_MINUTE = 60_000;

function remaining(at: number, t: Translate): string {
  const minutes = Math.max(0, Math.ceil((at - Date.now()) / MS_PER_MINUTE));
  return minutes <= 0 ? t("soon") : t("minutes", { n: minutes });
}

type Tool =
  | { kind: "obstacle"; type: ObstacleType }
  | { kind: "remove" }
  | { kind: "minion"; type: MinionType }
  | { kind: "trap"; type: TrapType }
  | { kind: "room"; type: RoomType };

/**
 * Which model stands in for each tool in the toolbar.
 *
 * These are the same keys the renderer draws with, so a tool's icon is a
 * photograph of the thing it puts on the board rather than an approximation of
 * it. `remove` has no model because it places nothing.
 */
const TOOL_MODEL: Record<string, string | null> = {
  barricade: "obstacle_barricade",
  wall: "obstacle_wall",
  remove: null,
  warrior: "m_warrior",
  mage: "m_mage",
  spike: "spike",
  arrow: "arrow",
  rockfall: "rockfall",
  flame: "flame",
  treasury: "treasury",
  vault: "vault",
  barracks: "barracks",
  altar: "altar",
  workshop: "workshop",
  jail: "jail",
};

const TOOL_MODEL_KEYS = Object.values(TOOL_MODEL).filter((k): k is string => k !== null);

const TOOLS: Array<{ id: string; tool: Tool; label: StringKey; cost: number | null }> = [
  { id: "barricade", tool: { kind: "obstacle", type: "barricade" }, label: OBSTACLE_LABEL.barricade, cost: OBSTACLE_COST.barricade },
  { id: "wall", tool: { kind: "obstacle", type: "wall" }, label: OBSTACLE_LABEL.wall, cost: OBSTACLE_COST.wall },
  { id: "remove", tool: { kind: "remove" }, label: "tool_remove", cost: null },
  { id: "warrior", tool: { kind: "minion", type: "warrior" }, label: MINION_LABEL.warrior, cost: MINION_COST.warrior },
  { id: "mage", tool: { kind: "minion", type: "mage" }, label: MINION_LABEL.mage, cost: MINION_COST.mage },
  { id: "spike", tool: { kind: "trap", type: "spike" }, label: TRAP_LABEL.spike, cost: TRAP_COST.spike },
  { id: "arrow", tool: { kind: "trap", type: "arrow" }, label: TRAP_LABEL.arrow, cost: TRAP_COST.arrow },
  { id: "rockfall", tool: { kind: "trap", type: "rockfall" }, label: TRAP_LABEL.rockfall, cost: TRAP_COST.rockfall },
  { id: "flame", tool: { kind: "trap", type: "flame" }, label: TRAP_LABEL.flame, cost: TRAP_COST.flame },
  { id: "treasury", tool: { kind: "room", type: "treasury" }, label: ROOM_LABEL.treasury, cost: ROOM_COST.treasury },
  { id: "vault", tool: { kind: "room", type: "vault" }, label: ROOM_LABEL.vault, cost: ROOM_COST.vault },
  { id: "barracks", tool: { kind: "room", type: "barracks" }, label: ROOM_LABEL.barracks, cost: ROOM_COST.barracks },
  { id: "altar", tool: { kind: "room", type: "altar" }, label: ROOM_LABEL.altar, cost: ROOM_COST.altar },
  { id: "workshop", tool: { kind: "room", type: "workshop" }, label: ROOM_LABEL.workshop, cost: ROOM_COST.workshop },
  { id: "jail", tool: { kind: "room", type: "jail" }, label: ROOM_LABEL.jail, cost: ROOM_COST.jail },
];

const SKILLS: WardenSkill[] = ["blessing", "rally", "detonate"];
type Tab = "build" | "manage" | "research";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DungeonRenderer | null>(null);
  const hudRef = useRef<HTMLElement>(null);

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  /** Baked from the tool models once the pack loads; empty until then. */
  const [toolIcons, setToolIcons] = useState<Record<string, string>>({});
  const [showOfflineBanner, setShowOfflineBanner] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);
  const [toolId, setToolId] = useState("barricade");
  const [researchError, setResearchError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("build");
  const [hudOpen, setHudOpen] = useState(true);
  const [settings, setSettings] = useState(loadSettings);
  const [screen, setScreen] = useState<"title" | "game">("title");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  const t = useMemo<Translate>(
    () => (key, vars) => translate(settings.locale, key, vars),
    [settings.locale],
  );

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      if (patch.muted !== undefined) audio.setMuted(patch.muted);
      if (patch.quality !== undefined) {
        rendererRef.current?.setPixelRatio(pixelRatioFor(patch.quality));
      }
      return next;
    });
  }, []);

  const save = useDungeonSave();
  const {
    arena,
    obstacles,
    gold,
    entitlements,
    minions,
    traps,
    rooms,
    loot,
    prisoners,
    adventurers,
    research,
    unlocked,
    effects,
    jailFree,
    weaponTiers,
    meta,
    pendingCost,
    hasUnsaved,
    status,
    error,
    lastSavedAt,
    account,
    isOffline,
  } = save;

  /*
   * The two fixed tiles, derived — never read out of the save.
   *
   * The server derives them too, from the same research list, so the copy it
   * sends back is only ever a chance for the two sides to disagree. They did:
   * the renderer computed them while the tutorial and the placement rules read
   * the save's pair, and against a save written by an older layout the ring
   * pointed at one tile while the board drew the entrance at another.
   */
  const entrance = useMemo(() => entranceOf(arena), [arena]);
  const core = useMemo(() => coreOf(arena), [arena]);

  /**
   * Floating damage numbers.
   *
   * Kept in React state rather than the three.js scene because text in WebGL
   * would need a font atlas for something HTML already does well, and the
   * count is small — a handful at a time, each gone in a second.
   */
  const [floaters, setFloaters] = useState<
    Array<{ id: number; text: string; x: number; y: number; kind: string }>
  >([]);
  const floaterSeq = useRef(0);

  const onSimEvents = useCallback((events: SimEvent[]) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const added: Array<{ id: number; text: string; x: number; y: number; kind: string }> = [];

    for (const event of events) {
      if (event.kind === "damage") {
        renderer.flashUnit(`a:${event.targetId}`);
        // Burn ticks every frame; showing each one would be a wall of 1s.
        if (event.source === "burn" || event.amount < 1) continue;

        const at = renderer.project(event.x, event.y);
        if (!at) continue;
        floaterSeq.current += 1;
        added.push({
          id: floaterSeq.current,
          text: `-${Math.round(event.amount)}`,
          x: at.x,
          y: at.y,
          kind: event.source,
        });
      } else if (event.kind === "trap") {
        renderer.spawnRing(event.x, event.y);
        renderer.shake(0.14); // a spike plate going off is a tap, not a jolt
        audio.play("trap", 90);
      } else if (event.kind === "down") {
        // The blow that actually finishes the adventurer — they stay on the
        // board a few seconds yet (down, not gone), so this is the moment a
        // knockback is guaranteed to be seen rather than removed same-frame.
        renderer.knockbackUnit(`a:${event.targetId}`);
        renderer.shake(0.22);
      } else if (event.kind === "minionDown") {
        renderer.spawnRing(event.x, event.y, 0x9d8bd8);
        renderer.knockbackUnit(`m:${event.targetId}`);
      } else if (event.kind === "obstacleDown") {
        renderer.shake(0.45); // a wall coming down is the biggest thump here
      } else if (event.kind === "captured" || event.kind === "killed") {
        renderer.spawnRing(event.x, event.y, event.kind === "captured" ? 0x7fc98a : 0xd86a4c);
        // A fresh jolt right as they actually leave the board, so the
        // renderer's brief corpse-linger has a live knockback to play out.
        renderer.knockbackUnit(`a:${event.targetId}`);
        const at = renderer.project(event.x, event.y);
        if (at) {
          floaterSeq.current += 1;
          added.push({
            id: floaterSeq.current,
            text: event.kind === "captured" ? t("result_captured") : t("board_repelled"),
            x: at.x,
            y: at.y,
            kind: event.kind,
          });
        }
      }
    }

    if (added.length === 0) return;
    setFloaters((current) => [...current, ...added].slice(-24));
    const ids = new Set(added.map((f) => f.id));
    window.setTimeout(() => setFloaters((c) => c.filter((f) => !ids.has(f.id))), 1000);
  }, [t]);

  const raid = useRaid({
    onEvents: onSimEvents,
    arena,
    meta,
    minions,
    traps,
    rooms,
    obstacles,
    effects,
    jailFree,
    weaponTiers,
    research: unlocked,
    adsRemoved: entitlements.adsRemoved,
    onFinished: save.applyRaidResult,
    onObstaclesDestroyed: save.clearDestroyedObstacles,
  });

  const tool = TOOLS.find((entry) => entry.id === toolId)?.tool ?? { kind: "remove" as const };

  // Browsers only allow an AudioContext to start from a gesture.
  useEffect(() => {
    const unlock = () => void audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // The renderer is built once; handlers that change every render are reached
  // through a ref so the scene is never torn down mid-session.
  const tapRef = useRef<(x: number, y: number) => void>(() => {});
  tapRef.current = (x, y) => {
    if (raid.resolveSkillTarget(x, y)) {
      audio.play("skill");
      return;
    }
    if (raid.raiding) return; // no editing while a raid is running

    let ok = false;
    if (tool.kind === "obstacle") ok = save.placeObstacle(tool.type, x, y);
    else if (tool.kind === "remove") ok = save.removeAt(x, y);
    else if (tool.kind === "minion") ok = save.placeMinion(tool.type, x, y);
    else if (tool.kind === "trap") ok = save.placeTrap(tool.type, x, y);
    else ok = save.placeRoom(tool.type, x, y);

    if (!ok) audio.play("error");
    else audio.play("place");
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new DungeonRenderer(canvasRef.current, {
      onTileTap: (x, y) => tapRef.current(x, y),
      onHoverChange: setHover,
    });
    rendererRef.current = renderer;

    // Photograph the tool models once the pack has loaded. Icons are a nicety:
    // if this fails or the device refuses a second GL context, the toolbar
    // keeps its labels and nothing else changes.
    let alive = true;
    void renderer
      .bakeToolIcons(TOOL_MODEL_KEYS)
      .then((icons) => { if (alive) setToolIcons(icons); })
      .catch(() => {});

    return () => {
      alive = false;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setArena(arena, entrance, core);
  }, [arena, entrance, core]);

  // During a raid the simulation owns the units; otherwise the placed roster is
  // shown so the player can see what they built.
  const units: UnitView[] = useMemo(() => {
    if (raid.raidState) {
      const live: UnitView[] = [];
      for (const m of raid.raidState.minions) {
        if (!m.alive) continue;
        const placed = minions.find((p) => p.id === m.id);
        // A convert keeps the adventurer model it had before turning.
        const kind =
          m.type === "convert" ? `a_${placed?.cls ?? "knight"}` : `m_${m.type}`;
        live.push({
          id: `m:${m.id}`, x: m.x, y: m.y, kind, hp: m.hp, maxHp: m.maxHp,
          action: m.action, facing: m.facing,
        });
      }
      for (const a of raid.raidState.adventurers) {
        if (!a.alive || !a.spawned) continue;
        live.push({
          id: `a:${a.id}`, x: a.x, y: a.y, kind: `a_${a.cls}`, hp: a.hp, maxHp: a.maxHp,
          action: a.action, facing: a.facing,
        });
      }
      return live;
    }

    const now = Date.now();
    return minions.map((m) => {
      const stats = minionStatsFor(m, weaponTiers[m.id] ?? 0);
      return {
        id: `m:${m.id}`,
        x: m.x,
        y: m.y,
        kind: m.type === "convert" ? `a_${m.cls ?? "knight"}` : `m_${m.type}`,
        hp: m.revivesAt && m.revivesAt > now ? 0 : stats.hp,
        maxHp: stats.hp,
      };
    });
  }, [raid.raidState, minions, weaponTiers]);

  const markers: MarkerView[] = useMemo(() => {
    const list: MarkerView[] = traps.map((t) => ({
      id: `t:${t.id}`,
      x: t.x,
      y: t.y,
      kind: t.type,
      shape: "trap" as const,
    }));
    for (const room of rooms) {
      for (const tile of roomTiles(room)) {
        list.push({
          id: `r:${room.id}:${tile.x}:${tile.y}`,
          x: tile.x,
          y: tile.y,
          kind: room.type,
          shape: "room" as const,
        });
      }
    }
    return list;
  }, [traps, rooms]);

  // During a raid the simulation owns obstacle HP as they get chopped down;
  // otherwise the placed roster is shown whole, mirroring the `units` memo.
  const obstacleViews: ObstacleView[] = useMemo(() => {
    if (raid.raidState) {
      return raid.raidState.obstacles
        .filter((o) => o.alive)
        .map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, hp: o.hp, maxHp: o.maxHp }));
    }
    return obstacles.map((o) => {
      const stats = OBSTACLE_STATS[o.type];
      return { id: o.id, type: o.type, x: o.x, y: o.y, hp: stats.hp, maxHp: stats.hp };
    });
  }, [raid.raidState, obstacles]);

  /**
   * The preview of what the next tap will place.
   *
   * This repeats rules the server also enforces, which is normally worth
   * avoiding — but the point of a preview is to answer before the tap, and
   * asking the server would answer after it. The server stays the authority:
   * if these two ever disagree the save is refused and the client is the one
   * that was wrong.
   */
  const ghostLegal = useCallback(
    (x: number, y: number): boolean => {
      if (!meta || !inArena(arena, x, y)) return false;
      if (x === entrance.x && y === entrance.y) return false;
      if (x === core.x && y === core.y) return false;

      const taken = (tx: number, ty: number) =>
        obstacles.some((o) => o.x === tx && o.y === ty) ||
        minions.some((m) => m.x === tx && m.y === ty) ||
        traps.some((tr) => tr.x === tx && tr.y === ty) ||
        rooms.some((r) => roomCovers(r, tx, ty));

      // A room claims a 2x2 block anchored here, so every tile of it must be
      // clear and inside the room — not just the one under the cursor.
      if (tool.kind === "room") {
        return roomTiles({ x, y }).every(
          (tile) =>
            inArena(arena, tile.x, tile.y) &&
            !taken(tile.x, tile.y) &&
            !(tile.x === entrance.x && tile.y === entrance.y) &&
            !(tile.x === core.x && tile.y === core.y),
        );
      }

      return !taken(x, y);
    },
    [arena, entrance, core, meta, obstacles, minions, traps, rooms, tool],
  );

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const modelKey = TOOL_MODEL[toolId] ?? null;
    if (!modelKey || raid.raiding || !hover) {
      renderer.setGhost(null, true);
      return;
    }
    renderer.setGhost(modelKey, ghostLegal(hover.x, hover.y));
  }, [toolId, hover, raid.raiding, ghostLegal]);

  /**
   * Tell the camera how much of itself the HUD is covering.
   *
   * The canvas is full-screen and the panel floats on its lower part, so
   * without this the board frames to the middle of the canvas — which on a
   * phone is behind the panel, with the core out of sight. Measured rather
   * than assumed, because the panel's height changes when it collapses and
   * when the viewport does.
   */
  useEffect(() => {
    const measure = () => {
      const renderer = rendererRef.current;
      const panel = hudRef.current;
      if (!renderer || !panel) return;
      const gap = window.innerHeight - panel.getBoundingClientRect().top;
      renderer.setBottomInset(Math.max(0, gap));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hudOpen, tab, obstacles.length, minions.length, traps.length, rooms.length, research.length]);

  useEffect(() => {
    rendererRef.current?.setUnits(units);
  }, [units]);

  useEffect(() => {
    rendererRef.current?.setMarkers(markers);
  }, [markers]);

  useEffect(() => {
    rendererRef.current?.setObstacles(obstacleViews);
  }, [obstacleViews]);

  // The route is shown while building and hidden during a raid, where the
  // adventurers themselves show it.
  useEffect(() => {
    if (!meta || raid.raiding) {
      rendererRef.current?.setPathPreview(null);
      return;
    }
    rendererRef.current?.setPathPreview(
      buildRaidPath(arena, entrance, core, lureTiles(rooms), blockedSet(arena, obstacles)),
    );
  }, [arena, entrance, core, obstacles, meta, rooms, raid.raiding]);

  // Combat feedback, throttled inside the audio engine so a busy raid does not
  // turn into noise.
  const lastKilled = useRef(0);
  useEffect(() => {
    if (!raid.raidState) return;
    const beaten = raid.raidState.killed + raid.raidState.captured;
    if (beaten > lastKilled.current) audio.play("hit", 120);
    lastKilled.current = beaten;
  }, [raid.raidState]);

  useEffect(() => {
    if (!raid.result) return;
    audio.play(raid.result.outcome === "repelled" ? "victory" : "defeat", 0);
  }, [raid.result]);

  useEffect(() => {
    installDevTools({
      arena, obstacles, minions, traps, rooms, loot, prisoners, adventurers,
      research, unlocked, effects, jailFree, meta, gold,
      placeObstacle: save.placeObstacle,
      placeMinion: save.placeMinion,
      placeTrap: save.placeTrap,
      placeRoom: save.placeRoom,
      removeAt: save.removeAt,
      equipWeapon: save.equipWeapon,
      buyResearch: save.buyResearch,
      saveNow: save.saveNow,
      startRaid: raid.startRaid,
      useSkill: raid.useSkill,
      stepRaid: raid.stepRaid,
      raidState: raid.raidState,
      raidResult: raid.result,
      showResult: raid.showResult,
      rendererStats: () => rendererRef.current?.debugStats() ?? null,
      rendererShakeState: () => rendererRef.current?.debugShakeState() ?? null,
      renderer: () => rendererRef.current,
    });
  });

  const onReviveAd = useCallback(async () => {
    const revived = await raid.reviveWithAd();
    setAdNotice(
      revived > 0 ? t("ad_revived", { n: revived }) : t("ad_not_watched"),
    );
    window.setTimeout(() => setAdNotice(null), 4000);
  }, [raid, t]);

  // Apply saved preferences once the renderer exists.
  useEffect(() => {
    audio.setMuted(settings.muted);
    rendererRef.current?.setPixelRatio(pixelRatioFor(settings.quality));
    // Only on mount: later changes go through patchSettings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasProgress =
    (meta?.wavesRepelled ?? 0) + (meta?.coreBreaches ?? 0) > 0 ||
    minions.length > 0 ||
    research.length > 0;

  const enterGame = useCallback(() => {
    audio.play("click");
    setScreen("game");
    if (!settings.introSeen) {
      setIntroOpen(true);
      patchSettings({ introSeen: true });
    }
  }, [settings.introSeen, patchSettings]);

  // The purse counts to its new total rather than jumping to it, and the shape
  // of the pop says whether the change was earned or spent.
  const purse = useCountUp(gold);

  const guide = guideFor({
    obstacles,
    entrance,
    core,
    minions,
    traps,
    hasUnsaved,
    wavesRepelled: meta?.wavesRepelled ?? 0,
    coreBreaches: meta?.coreBreaches ?? 0,
    toolId,
  });
  // The tutorial is dismissed for good, finished, or out of the way while a
  // raid plays — there is nothing to do during one but watch.
  const teaching = settings.tutorialDone || raid.raiding ? null : guide;

  /** Where a board tile is on screen, so the ring can sit on one. */
  const locateTile = useCallback((x: number, y: number) => {
    const point = rendererRef.current?.project(x, y, 0.12);
    const canvas = canvasRef.current;
    if (!point || !canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const size = 44;
    return {
      left: rect.left + point.x - size / 2,
      top: rect.top + point.y - size / 2,
      width: size,
      height: size,
    };
  }, []);

  // A suggested tile the player has already built on is not a suggestion any
  // more, so the pointer is dropped rather than sending them somewhere the tap
  // will be refused.
  const pointer =
    teaching?.target?.kind === "tile" && !ghostLegal(teaching.target.x, teaching.target.y)
      ? null
      : teaching?.target ?? null;
  const spotlight = useSpotlight(pointer, locateTile);

  const toolHint = (() => {
    if (raid.pendingSkill)
      return `${t(SKILL_LABEL[raid.pendingSkill] as StringKey)} — ${t("hint_skill_target")}`;
    if (tool.kind === "obstacle") return `${t("hint_obstacle")} ${obstacles.length}/${maxObstaclesFor(research)}`;
    if (tool.kind === "remove") return t("hint_remove");
    if (tool.kind === "minion") return `${t("hint_minion")} ${minions.length}/${effects.minionCap}`;
    if (tool.kind === "trap") return `${t("hint_trap")} ${traps.length}/${MAX_TRAPS}`;
    return `${t(ROOM_DESCRIPTION[tool.type] as StringKey)} ${t("hint_room")} ${rooms.length}/${MAX_ROOMS}`;
  })();

  return (
    <LocaleProvider locale={settings.locale}>
    <div className="app">
      <canvas ref={canvasRef} className="viewport" />

      <div className="floaters">
        {floaters.map((f) => (
          <span key={f.id} className={`floater ${f.kind}`} style={{ left: f.x, top: f.y }}>
            {f.text}
          </span>
        ))}
      </div>

      <header className="topbar">
        <div className="brand">DUNGEON WARDEN</div>
        <div className="stats">
          {/* Keyed on the beat so the pop replays on every change; a CSS
              animation on a stable element only ever plays once. */}
          <span key={purse.beat} className={`gold ${purse.dir ?? ""}`}>🪙 {purse.shown}</span>
          {meta && <span className="pending">{t("stat_threat")} {meta.threat}</span>}
          {pendingCost > 0 && <span className="pending">{t("stat_unsaved")} -{pendingCost}</span>}
          <span className={`status status-${status}`}>
            {STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status}
          </span>
          <button
            className="icon-toggle"
            onClick={() => patchSettings({ muted: !settings.muted })}
            title={settings.muted ? t("menu_sound_on") : t("menu_sound_off")}
            aria-label={settings.muted ? t("menu_sound_on") : t("menu_sound_off")}
          >
            {settings.muted ? "🔇" : "🔊"}
          </button>
          <button className="shop-btn" onClick={() => { audio.play("click"); setBoardOpen(true); }}>
            {t("menu_leaderboard")}
          </button>
          <button className="shop-btn" onClick={() => { audio.play("click"); setShopOpen(true); }}>
            {t("menu_shop")}
          </button>
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setSettingsOpen(true); }}
            title={t("menu_settings")}
            aria-label={t("menu_settings")}
          >
            ⚙
          </button>
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setScreen("title"); }}
            title={t("menu_home")}
            aria-label={t("menu_home")}
            disabled={raid.raiding}
          >
            ⌂
          </button>
        </div>
      </header>

      {/* One stack so banners and the tutorial never sit on top of each other,
          on any screen size. */}
      <div className={raid.raiding ? "topstack raiding" : "topstack"}>
        {isOffline && showOfflineBanner && (
          <div className="banner">
            <button className="banner-close" onClick={() => setShowOfflineBanner(false)} aria-label="close">×</button>
            {t("banner_offline")}
          </div>
        )}

        {error && <div className="banner banner-error">{t("save_error")}: {error}</div>}
        {raid.error && (
          <div className="banner banner-error">
            {RAID_ERROR_LABEL[raid.error]
              ? t(RAID_ERROR_LABEL[raid.error])
              : `${t("raid_error")}: ${raid.error}`}
          </div>
        )}

        {/* One line and a count. The ring below says where; this only has to
            say what, and the two together are shorter than the sentence they
            replaced. */}
        {teaching && (
          <div key={teaching.hint} className="tutorial">
            <b className="tutorial-count">
              {teaching.index + 1}/{TUTORIAL.length}
            </b>
            <p>{t(teaching.hint as StringKey)}</p>
            <button
              className="icon-btn"
              onClick={() => patchSettings({ tutorialDone: true })}
              aria-label="close"
            >
              ×
            </button>
          </div>
        )}

        {raid.raiding && raid.raidState && (
          <div className="raid-bar">
            <b>{t("raiding")}</b>
            <span>{t("raid_adventurers")} {raid.raidState.adventurers.filter((a) => a.alive).length}/{raid.raidState.adventurers.length}</span>
            <span>{t("raid_minions")} {raid.raidState.minions.filter((m) => m.alive).length}/{raid.raidState.minions.length}</span>
            <span>{t("raid_traps")} {raid.raidState.trapDamage}</span>
            <span>{raid.raidState.elapsed.toFixed(0)}{t("seconds")}</span>
            <div className="speeds">
              {RAID_SPEEDS.map((s) => (
                <button key={s} className={raid.speed === s ? "active" : ""} onClick={() => raid.setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {raid.raiding && raid.raidState && (
        <div className="skillbar">
          {SKILLS.map((skill) => {
            const cd = raid.raidState!.skillCooldowns[skill];
            return (
              <button
                key={skill}
                className={raid.pendingSkill === skill ? "skill armed" : "skill"}
                disabled={cd > 0}
                onClick={() => { audio.play("skill"); raid.useSkill(skill); }}
              >
                <b>{t(SKILL_LABEL[skill] as StringKey)}</b>
                <i>
                  {cd > 0
                    ? `${cd.toFixed(0)}${t("seconds")}`
                    : SKILL_STATS[skill].targeted
                      ? t("skill_target")
                      : t("skill_ready")}
                </i>
              </button>
            );
          })}

          {/* One comeback per raid, and only when there is something to bring
              back — an ad button that does nothing is worse than none. */}
          {!raid.adUsed && raid.fallenMinions > 0 && (
            <button className="skill ad" disabled={raid.adBusy} onClick={() => void onReviveAd()}>
              <b>{raid.adBusy ? t("ad_playing") : t("ad_revive")}</b>
              <i>{t("ad_watch")} · {raid.fallenMinions}</i>
            </button>
          )}
        </div>
      )}

      {/* Drawn over the control the tutorial is talking about, measured from
          outside it — see useSpotlight. Takes no clicks, so the thing it is
          pointing at is still the thing you press. */}
      {spotlight && (
        <div
          // A ring on the floor is round; a ring on a button follows the
          // button.
          className={pointer?.kind === "tile" ? "spotlight tile" : "spotlight"}
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {raid.result && <ResultDialog result={raid.result} onClose={raid.dismissResult} />}

      <aside ref={hudRef} className={hudOpen ? "hud" : "hud collapsed"}>
        <div className="hud-tabs">
          <button className={tab === "build" ? "active" : ""} onClick={() => { audio.play("click"); setTab("build"); }}>{t("tab_build")}</button>
          <button className={tab === "manage" ? "active" : ""} onClick={() => { audio.play("click"); setTab("manage"); }}>{t("tab_manage")}</button>
          <button className={tab === "research" ? "active" : ""} onClick={() => { audio.play("click"); setTab("research"); }}>
            {t("tab_research")} {research.length}/{RESEARCH.length}
          </button>
          <button className="hud-toggle" onClick={() => setHudOpen(!hudOpen)} aria-label="toggle">
            {hudOpen ? "▾" : "▴"}
          </button>
        </div>

        {/* Keyed on the tab so each one fades in as its own page of controls. */}
        <div key={tab} className="hud-body">
          {tab === "build" && (
            <>
              <div className="toolbar">
                {TOOLS.map((entry) => {
                  const locked =
                    (entry.tool.kind === "minion" && !unlocked.unlockedMinions.includes(entry.tool.type)) ||
                    (entry.tool.kind === "trap" && !unlocked.unlockedTraps.includes(entry.tool.type)) ||
                    (entry.tool.kind === "room" && !unlocked.unlockedRooms.includes(entry.tool.type));
                  const label = t(entry.label);

                  return (
                    <button
                      key={entry.id}
                      data-tut={`tool:${entry.id}`}
                      className={toolId === entry.id ? "tool active" : "tool"}
                      onClick={() => { audio.play("click"); setToolId(entry.id); }}
                      disabled={raid.raiding || locked}
                      title={locked ? t("locked_hint") : undefined}
                    >
                      {(() => {
                        const modelKey = TOOL_MODEL[entry.id];
                        const icon = modelKey ? toolIcons[modelKey] : undefined;
                        return icon ? <img className="tool-icon" src={icon} alt="" /> : null;
                      })()}
                      <span className="tool-text">
                        <b>{locked ? `🔒 ${label}` : label}</b>
                        <i>{entry.cost === null ? t("free") : `${entry.cost}G`}</i>
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="hint">{toolHint}</p>
              <p className="hint small">
                {t("count_obstacles")} {obstacles.length}/{maxObstaclesFor(research)} · {t("count_minions")} {minions.length}/{effects.minionCap} · {t("count_traps")} {traps.length}/{MAX_TRAPS} · {t("count_rooms")} {rooms.length}/{MAX_ROOMS}
                {effects.jailCapacity > 0 && ` · ${t("count_jail")} ${prisoners.length}/${effects.jailCapacity}`}
              </p>
              <p className="hint small">{t("obstacle_note")}</p>
              <p className="hint small">{t("controls")}</p>

              <div className="actions">
                <button
                  className="primary"
                  data-tut="action:raid"
                  onClick={() => { audio.play("raidStart"); void raid.startRaid(); }}
                  disabled={raid.raiding || raid.starting || hasUnsaved}
                >
                  {raid.starting ? t("preparing") : t("start_raid")}
                </button>
              </div>
              {hasUnsaved && <p className="hint small warn">{t("unsaved_changes")}</p>}

              <div className="actions">
                <button data-tut="action:save" onClick={() => void save.saveNow()} disabled={!hasUnsaved}>{t("save_now")}</button>
                <button className="danger" onClick={() => void save.resetGame()} disabled={raid.raiding}>
                  {t("settings_reset")}
                </button>
              </div>
              {adNotice && <p className="hint small">{adNotice}</p>}

              <p className="hint small">
                {hover ? `${t("tile")} (${hover.x}, ${hover.y})` : t("hover_hint")}
                {lastSavedAt && ` · ${t("saved_at")} ${new Date(lastSavedAt).toLocaleTimeString()}`}
              </p>
            </>
          )}

          {tab === "manage" && (
            <>
              {loot.length === 0 && prisoners.length === 0 && adventurers.length === 0 && (
                <p className="hint">{t("manage_empty")}</p>
              )}

              {loot.length > 0 && (
                <>
                  <h3 className="section">{t("manage_loot")} {loot.length}</h3>
                  {minions.map((minion) => (
                    <label key={minion.id} className="equip-row">
                      <span>
                        {t(MINION_LABEL[minion.type] as StringKey)}
                        {minion.type === "convert" && minion.level ? ` Lv${minion.level}` : ""}
                        {` (${minion.x},${minion.y})`}
                      </span>
                      <select
                        value={minion.weaponId ?? ""}
                        disabled={raid.raiding}
                        onChange={(e) => save.equipWeapon(minion.id, e.target.value || null)}
                      >
                        <option value="">{t("manage_none")}</option>
                        {loot.map((item) => (
                          <option key={item.id} value={item.id}>
                            T{item.tier} (+{Math.round(15 * item.tier)}%)
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </>
              )}

              {prisoners.length > 0 && (
                <>
                  <h3 className="section">{t("manage_jail")} {prisoners.length}/{effects.jailCapacity}</h3>
                  {prisoners.map((p) => (
                    <p key={p.advId} className="hint small">
                      {p.name} Lv{p.level} — {t("converts_in", { t: remaining(p.convertsAt, t) })}
                    </p>
                  ))}
                </>
              )}

              {adventurers.length > 0 && (
                <>
                  <h3 className="section">{t("manage_nemesis")} {adventurers.filter((a) => a.state !== "converted").length}</h3>
                  {adventurers.map((a) => (
                    <p key={a.id} className="hint small">
                      {a.name} Lv{a.level} · {t(a.raids === 1 ? "times_one" : "times", { n: a.raids })} ·{" "}
                      {a.state === "captured"
                        ? t("state_jailed")
                        : a.state === "converted"
                          ? t("state_converted")
                          : a.returnsAt > Date.now()
                            ? t("returns_in", { t: remaining(a.returnsAt, t) })
                            : t("state_waiting")}
                    </p>
                  ))}
                </>
              )}
            </>
          )}

          {tab === "research" && (
            <>
              {researchError && (
                <p className="hint small warn">
                  {RESEARCH_ERROR[researchError] ? t(RESEARCH_ERROR[researchError]) : researchError}
                </p>
              )}
              {RESEARCH.map((node) => {
                const owned = research.includes(node.id);
                const available = isAvailable(node, research);
                const missing = (node.requires ?? [])
                  .filter((id) => !research.includes(id))
                  .map((id) => {
                    const label = RESEARCH_BY_ID.get(id)?.label;
                    return label ? t(label as StringKey) : id;
                  });

                return (
                  <div key={node.id} className={owned ? "research owned" : "research"}>
                    <div className="research-head">
                      <b>{t(node.label as StringKey)}</b>
                      {owned ? (
                        <span className="ok">{t("research_owned")}</span>
                      ) : (
                        <button
                          disabled={!available || gold < node.cost || raid.raiding}
                          onClick={async () => {
                            const failure = await save.buyResearch(node.id);
                            audio.play(failure ? "error" : "skill");
                            setResearchError(failure);
                          }}
                        >
                          {node.cost}G
                        </button>
                      )}
                    </div>
                    <p className="hint small">{t(node.note as StringKey)}</p>
                    {!owned && missing.length > 0 && (
                      <p className="hint small warn">{t("research_requires")}: {missing.join(", ")}</p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {account && <p className="hint small account">{account}</p>}
      </aside>

      {shopOpen && (
        <ShopDialog
          entitlements={entitlements}
          onPurchased={() => void save.refreshEntitlements()}
          onClose={() => setShopOpen(false)}
        />
      )}

      {boardOpen && <LeaderboardDialog account={account} onClose={() => setBoardOpen(false)} />}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={patchSettings}
          onReplayTutorial={() => {
            patchSettings({ tutorialDone: false });
            setSettingsOpen(false);
            setIntroOpen(true);
          }}
          onResetDungeon={() => {
            void save.resetGame();
            setSettingsOpen(false);
          }}
          resetDisabled={raid.raiding}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {introOpen && <IntroDialog onClose={() => setIntroOpen(false)} />}

      {/* Sits above the running scene, so the dungeon is already rendered and
          warm by the time the player presses start. */}
      {screen === "title" && (
        <TitleScreen
          hasProgress={hasProgress}
          summary={meta}
          loading={status === "connecting" || status === "loading"}
          offline={isOffline}
          onStart={enterGame}
          onSettings={() => setSettingsOpen(true)}
          onLeaderboard={() => setBoardOpen(true)}
          onShop={() => setShopOpen(true)}
        />
      )}
    </div>
    </LocaleProvider>
  );
}
