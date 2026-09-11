import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DungeonRenderer,
  type AimTile,
  type MarkerView,
  type UnitView,
} from "./game/DungeonRenderer";
import { useDungeonSave } from "./game/useDungeonSave";
import { useRaid, RAID_SPEEDS } from "./game/useRaid";
import { minionStatsFor } from "./game/sim/units";
import { roomTiles, lureTiles, roomCovers } from "./game/rooms";
import { buildRaidPath } from "./game/sim/pathfinding";
import { blockedKey, coreOf, entranceOf, inArena } from "./game/arena";
import { RESEARCH, RESEARCH_BY_ID, isAvailable } from "./game/research";
import { TUTORIAL, guideFor } from "./game/tutorial";
import { tierFor } from "./game/milestones";
import { audio } from "./game/audio";
import { useAdGold } from "./game/useAdGold";
import type { SimEvent } from "./game/sim/RaidSim";
import { installDevTools } from "./game/devtools";
import { ShopDialog } from "./ui/ShopDialog";
import { LeaderboardDialog } from "./ui/LeaderboardDialog";
import { TitleScreen } from "./ui/TitleScreen";
import { SettingsDialog } from "./ui/SettingsDialog";
import { IntroDialog } from "./ui/IntroDialog";
import { ResultDialog } from "./ui/ResultDialog";
import { useCountUp } from "./ui/useCountUp";
import { Icon } from "./ui/Icon";
import coinIcon from "./assets/icons/coin.svg";
import { useSpotlight } from "./ui/useSpotlight";
import { loadSettings, saveSettings, pixelRatioFor, type Settings } from "./game/settings";
import { LocaleProvider, type Translate } from "./i18n";
import { previewParty } from "./game/party";
import { DIG_COST, dugSet, garrisonScale, rockSet } from "./game/dig";
import { emptyTally, recordEvents, tallyCells, type RaidTally } from "./game/aftermath";
import { translate, type StringKey } from "./i18n/strings";
import {
  ADVENTURER_CLASSES,
  ADVENTURER_LABEL,
  CHAMPION_MODEL_SCALE,
  MAX_ROOMS,
  MAX_TRAPS,
  MINION_COST,
  MINION_LABEL,
  ROOM_COST,
  ROOM_DESCRIPTION,
  ROOM_LABEL,
  SKILL_LABEL,
  SKILL_NOTE,
  TRAP_COST,
  TRAP_LABEL,
  type MinionType,
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
  // Two halves of one verb: take rock out, put rock back.
  | { kind: "dig" }
  | { kind: "fill" }
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
  dig: null,
  fill: null,
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

/**
 * Whether this machine has a pointer that can right-click.
 *
 * Read once: it is a property of the device, and a player does not grow a
 * mouse mid-session. Guarded for the server-side and test cases where there
 * is no matchMedia at all.
 */
const HAS_MOUSE =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * The five adventurer models, photographed for the party row.
 *
 * Baked from the same pack the raid draws, so the face above the raid button
 * is the figure that walks in when it is pressed.
 */
const PARTY_MODEL_KEYS = ADVENTURER_CLASSES.map((cls) => `a_${cls}`);

/**
 * Which drawer each tool lives in.
 *
 * Named rather than derived from the tool's kind, which is what it used to
 * be: digging and filling are two halves of one verb and belong in the same
 * drawer, but they cannot be the same kind because they do opposite things.
 */
const TOOLS: Array<{
  id: string;
  tool: Tool;
  group: ToolGroup;
  label: StringKey;
  cost: number | null;
}> = [
  { id: "dig", tool: { kind: "dig" }, group: "dig", label: "tool_dig", cost: DIG_COST },
  { id: "fill", tool: { kind: "fill" }, group: "dig", label: "tool_fill", cost: null },
  { id: "remove", tool: { kind: "remove" }, group: "dig", label: "tool_remove", cost: null },
  { id: "warrior", tool: { kind: "minion", type: "warrior" }, group: "minion", label: MINION_LABEL.warrior, cost: MINION_COST.warrior },
  { id: "mage", tool: { kind: "minion", type: "mage" }, group: "minion", label: MINION_LABEL.mage, cost: MINION_COST.mage },
  { id: "spike", tool: { kind: "trap", type: "spike" }, group: "trap", label: TRAP_LABEL.spike, cost: TRAP_COST.spike },
  { id: "arrow", tool: { kind: "trap", type: "arrow" }, group: "trap", label: TRAP_LABEL.arrow, cost: TRAP_COST.arrow },
  { id: "rockfall", tool: { kind: "trap", type: "rockfall" }, group: "trap", label: TRAP_LABEL.rockfall, cost: TRAP_COST.rockfall },
  { id: "flame", tool: { kind: "trap", type: "flame" }, group: "trap", label: TRAP_LABEL.flame, cost: TRAP_COST.flame },
  { id: "treasury", tool: { kind: "room", type: "treasury" }, group: "room", label: ROOM_LABEL.treasury, cost: ROOM_COST.treasury },
  { id: "vault", tool: { kind: "room", type: "vault" }, group: "room", label: ROOM_LABEL.vault, cost: ROOM_COST.vault },
  { id: "barracks", tool: { kind: "room", type: "barracks" }, group: "room", label: ROOM_LABEL.barracks, cost: ROOM_COST.barracks },
  { id: "altar", tool: { kind: "room", type: "altar" }, group: "room", label: ROOM_LABEL.altar, cost: ROOM_COST.altar },
  { id: "workshop", tool: { kind: "room", type: "workshop" }, group: "room", label: ROOM_LABEL.workshop, cost: ROOM_COST.workshop },
  { id: "jail", tool: { kind: "room", type: "jail" }, group: "room", label: ROOM_LABEL.jail, cost: ROOM_COST.jail },
];

/**
 * The toolbar in two steps instead of one list.
 *
 * Fifteen buttons of equal weight is a form, not a control surface: nothing
 * says what matters, the panel eats half the screen, and the button that
 * actually starts the game ends up below the fold. Picking a kind first cuts
 * the visible set to at most six and gives the panel a shape.
 */
type ToolGroup = "dig" | "minion" | "trap" | "room";

const GROUPS: Array<{ id: ToolGroup; label: StringKey }> = [
  { id: "dig", label: "group_dig" },
  { id: "minion", label: "group_minion" },
  { id: "trap", label: "group_trap" },
  { id: "room", label: "group_room" },
];

const SKILLS: WardenSkill[] = ["blessing", "rally", "detonate"];

type Tab = "build" | "manage" | "research";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DungeonRenderer | null>(null);
  const hudRef = useRef<HTMLElement>(null);

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  /** The block under the crosshair while walking the corridor. */
  const [aim, setAim] = useState<AimTile | null>(null);
  /**
   * Which slot of the hotbar is in hand down in the corridor.
   *
   * An index rather than a tool id, because the bar is what the player
   * sees: the number keys pick by position, and a slot that changes what
   * it holds (a trap unlocked by research) keeps its place in the row.
   */
  const [held, setHeld] = useState(0);
  /** Baked from the tool models once the pack loads; empty until then. */
  const [toolIcons, setToolIcons] = useState<Record<string, string>>({});
  const [showOfflineBanner, setShowOfflineBanner] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);
  const [toolId, setToolId] = useState("dig");
  const [group, setGroup] = useState<ToolGroup>("dig");
  /** The level to come back to when the quick mute is switched off again. */
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
      if (patch.volume !== undefined) audio.setVolume(patch.volume);
      if (patch.quality !== undefined) {
        rendererRef.current?.setPixelRatio(pixelRatioFor(patch.quality));
      }
      return next;
    });
  }, []);

  const save = useDungeonSave();
  const {
    arena,
    dug,
    connected,
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

  /** The rubble the room came with — see src/game/noise.ts. */
  /*
   * What a walker cannot enter: the rock nobody has dug through.
   *
   * This used to be scattered scenery - a barrel here, a pillar there, picked
   * by noise. The rock replaces all of it, and it is better at the job for
   * one reason: the player can see exactly where it is, because they are the
   * one who left it there.
   */
  const terrain = useMemo(() => rockSet(arena, dug), [arena, dug]);

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

  /**
   * The raid, recorded while it happens.
   *
   * A ref rather than state on purpose: this is written from the event drain
   * many times a second and read exactly twice - once when the raid ends, to
   * paint the map, and once when the next one starts, to wipe it. Putting it
   * in state would re-render the tree on every arrow hit for a picture that
   * is not drawn until the fighting stops.
   */
  const aftermathRef = useRef<RaidTally>(emptyTally());

  /**
   * Whether the board is showing the last raid or the next one.
   *
   * Both are painted on the same floor and they answer different questions -
   * "where were they hurt" and "where will they walk" - so drawn together the
   * cool end of the record is indistinguishable from the route and neither
   * reads. The record wins from the moment the fighting stops until the
   * player touches the dungeon, which is exactly when their attention moves
   * from what happened to what happens next.
   */
  const [showAftermath, setShowAftermath] = useState(false);

  const onSimEvents = useCallback((events: SimEvent[]) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Accumulated as it happens rather than replayed afterwards: the events
    // are drained per frame and nobody keeps them, so this is the only place
    // the raid can be recorded at all.
    recordEvents(aftermathRef.current, events);

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
        audio.play("minionDown", 120);
      } else if (event.kind === "captured" || event.kind === "killed") {
        renderer.spawnRing(event.x, event.y, event.kind === "captured" ? 0x7fc98a : 0xd86a4c);
        // The two ways an adventurer leaves the board sound different, because
        // one of them is the one the player was building a jail for.
        audio.play(event.kind === "captured" ? "captured" : "hit", 0);
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
    initialSpeed: settings.raidSpeed,
    arena,
    meta,
    minions,
    traps,
    rooms,
    dug,
    terrain,
    effects,
    jailFree,
    weaponTiers,
    research: unlocked,
    onFinished: save.applyRaidResult,
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

  /*
   * The background loop runs while the dungeon is on screen.
   *
   * Not on the title, which is a menu over a dimmed room and wants the quiet.
   * It waits for the AudioContext, which only exists after the player has
   * touched something — and entering the game is exactly that touch.
   */
  useEffect(() => {
    if (screen !== "game" || settings.musicVolume <= 0) {
      audio.stopMusic();
      return;
    }
    audio.setMusicLevel(settings.musicVolume);
    void audio.startMusic();
  }, [screen, settings.musicVolume]);

  // A raid has its own noise — hits, traps, the result. The loop steps back
  // rather than everything else being pushed forward.
  useEffect(() => {
    audio.duckMusic(raid.raiding);
  }, [raid.raiding, raid.raidOpen]);

  /**
   * The right-click prompt: what is on this tile, and a button to clear it.
   *
   * Desktop only, and it exists because taking something down was a two-step
   * detour on a mouse - go to the toolbar, pick the remove tool, come back,
   * click, and now the remove tool is still armed for the next click. Right
   * click is what every builder in the genre uses.
   *
   * It asks rather than acting. A right click that silently deleted a 70g
   * mage because the cursor drifted one tile is worse than the detour, and
   * the prompt is also the only thing that teaches the gesture exists.
   *
   * Nothing here fires on a phone: no touch generates button 2, so the
   * toolbar remove tool stays the way it is done there.
   */
  /**
   * Whether the camera is down in the corridor.
   *
   * Mirrored in React as well as in the renderer because the panel has to
   * step out of the way and the walk control has to appear - the renderer
   * owns the camera, this owns the screen around it.
   */
  const [walking, setWalking] = useState(false);

  /*
   * Walking is for between raids. During one the camera has somewhere else to
   * be, and the board is not the player's to stand in while it is being
   * fought over.
   */
  useEffect(() => {
    rendererRef.current?.setWalking(walking);
  }, [walking]);


  /*
   * Hold to walk forward.
   *
   * One thumb drags to look and one holds this, which is the pattern that
   * works in portrait without putting two virtual sticks on a phone. The step
   * is per frame rather than per press, so the speed is the same on every
   * device.
   */
  /*
   * A stick for the left thumb.
   *
   * One finger drags a knob out of a ring; how far and which way it went
   * is the walk. It reports straight into the renderer rather than into
   * React state, because it changes every frame the thumb moves and the
   * screen has nothing to redraw about it - the knob itself is moved by
   * hand here for the same reason.
   */
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const stickPointer = useRef<number | null>(null);
  const stickAt = (e: React.PointerEvent) => {
    const ring = stickRef.current;
    const knob = knobRef.current;
    if (!ring || !knob) return;
    const rect = ring.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = e.clientX - (rect.left + radius);
    let dy = e.clientY - (rect.top + radius);
    const length = Math.hypot(dx, dy);
    // The knob stays inside the ring; past its edge the stick is simply
    // all the way over.
    const reach = radius * 0.7;
    if (length > reach) {
      dx = (dx / length) * reach;
      dy = (dy / length) * reach;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Up on the screen is forward; right is right.
    rendererRef.current?.setMoveInput(-dy / reach, dx / reach);
  };
  const stickRelease = () => {
    stickPointer.current = null;
    if (knobRef.current) knobRef.current.style.transform = "";
    rendererRef.current?.setMoveInput(0, 0);
  };

  /*
   * The hotbar: what can be put down from inside the corridor.
   *
   * Filling first, then the garrison, then the traps - the order they come
   * up in the tutorial. Rooms are not here: a room is a two-by-two block
   * anchored at a corner, which is a thing you place looking at the whole
   * board, not at one tile of it. Locked entries stay in the row, greyed,
   * so the row keeps its shape as research fills it in.
   */
  const hotbar = TOOLS.filter((entry) => entry.tool.kind !== "room" && entry.id !== "dig" && entry.id !== "remove");
  const heldEntry = hotbar[Math.min(held, hotbar.length - 1)] ?? null;
  const heldLocked = (entry: (typeof TOOLS)[number]): boolean =>
    (entry.tool.kind === "minion" && !unlocked.unlockedMinions.includes(entry.tool.type)) ||
    (entry.tool.kind === "trap" && !unlocked.unlockedTraps.includes(entry.tool.type));

  /*
   * Left hand takes out, right hand puts down.
   *
   * Primary on rock digs it. Secondary on floor puts down whatever is in
   * hand - or fills the tile back in when that is what is held. Anything
   * else (primary on floor, secondary on rock) is a swing at nothing, and
   * says so with the same sound a refused placement makes above.
   */
  const actRef = useRef<(button: "primary" | "secondary", tile: AimTile) => void>(() => {});
  actRef.current = (button, tile) => {
    if (raid.raiding || !meta) return;

    let ok = false;
    if (button === "primary") {
      if (tile.kind !== "rock") return;
      ok = save.dig(tile.x, tile.y);
    } else {
      if (tile.kind !== "floor" || !heldEntry || heldLocked(heldEntry)) return;
      const tool = heldEntry.tool;
      if (tool.kind === "fill") ok = save.fill(tile.x, tile.y);
      else if (tool.kind === "minion") ok = save.placeMinion(tool.type, tile.x, tile.y);
      else if (tool.kind === "trap") ok = save.placeTrap(tool.type, tile.x, tile.y);
    }

    if (!ok) {
      audio.play("error");
      return;
    }
    audio.play(button === "primary" || heldEntry?.tool.kind === "fill" ? "dig" : "place");
    // Rock coming out in front of your face is felt, not just seen.
    if (button === "primary") rendererRef.current?.shake(0.16);
    if (showAftermath) {
      setShowAftermath(false);
      rendererRef.current?.setAftermath(null);
    }
  };

  // Number keys pick a slot, the way every game with a bar does it.
  useEffect(() => {
    if (!walking) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= hotbar.length) setHeld(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walking, hotbar.length]);

  const [removePrompt, setRemovePrompt] = useState<
    { x: number; y: number; sx: number; sy: number; label: string } | null
  >(null);

  // The renderer is built once; handlers that change every render are reached
  // through a ref so the scene is never torn down mid-session.
  const tapRef = useRef<(x: number, y: number) => void>(() => {});
  tapRef.current = (x, y) => {
    if (raid.resolveSkillTarget(x, y)) {
      audio.play("skill");
      return;
    }
    if (raid.raiding) return; // no editing while a raid is running

    /*
     * Taking things down stays free of the guide: a player who put the first
     * wall somewhere they regret has to be able to undo it, and undoing the
     * tutorial's own wall simply un-finishes that step and brings the ring
     * back - so the guide heals rather than dead-ends.
     */
    const guided = guidedTapRef.current;
    if (guided && tool.kind !== "remove") {
      const wrongTile = guided === "none" || x !== guided.x || y !== guided.y;
      if (wrongTile) {
        audio.play("error");
        return;
      }
    }

    let ok = false;
    if (tool.kind === "dig") ok = save.dig(x, y);
    else if (tool.kind === "fill") ok = save.fill(x, y);
    else if (tool.kind === "remove") ok = save.removeAt(x, y);
    else if (tool.kind === "minion") ok = save.placeMinion(tool.type, x, y);
    else if (tool.kind === "trap") ok = save.placeTrap(tool.type, x, y);
    else ok = save.placeRoom(tool.type, x, y);

    if (!ok) audio.play("error");
    else {
      // Moving rock sounds like rock; everything else is set down on it.
      audio.play(tool.kind === "dig" || tool.kind === "fill" ? "dig" : "place");
      // Building is the answer to the map, so the map steps aside for the
      // route the change just altered.
      if (showAftermath) {
        setShowAftermath(false);
        rendererRef.current?.setAftermath(null);
      }
    }
  };

  /**
   * One tile crossed while dragging with a digging tool held.
   *
   * Cutting the first corridor is ten tiles in a line, and ten taps for one
   * intention makes the verb of the game feel like paperwork. Only the two
   * tools that work a tile at a time - dragging a minion across the room
   * would empty the purse in a gesture nobody meant to make.
   */
  const paintableRef = useRef(false);
  paintableRef.current = tool.kind === "dig" || tool.kind === "fill";

  const dragRef = useRef<(x: number, y: number) => void>(() => {});
  dragRef.current = (x, y) => {
    if (raid.raiding) return;
    const ok =
      tool.kind === "dig" ? save.dig(x, y) : tool.kind === "fill" ? save.fill(x, y) : false;
    if (ok) audio.play("dig");
  };

  const altRef = useRef<(x: number, y: number, sx: number, sy: number) => void>(() => {});
  altRef.current = (x, y, sx, sy) => {
    if (raid.raiding) return;

    // Only what the player put there. Scenery is not theirs to clear, and
    // offering to clear it would be a button that does nothing.
    const minion = minions.find((m) => m.x === x && m.y === y);
    const trap = traps.find((entry) => entry.x === x && entry.y === y);
    const room = rooms.find((r) => roomCovers(r, x, y));

    const label = minion
      ? t(MINION_LABEL[minion.type] as StringKey)
      : trap
        ? t(TRAP_LABEL[trap.type] as StringKey)
        : room
          ? t(ROOM_LABEL[room.type] as StringKey)
          : null;

    if (!label) {
      setRemovePrompt(null);
      return;
    }

    // Clamped to the canvas, so a click near an edge does not put the prompt
    // out in the letterbox. Half-widths rather than a measurement: the
    // element does not exist yet at this point, and it has a fixed size.
    const rect = canvasRef.current?.getBoundingClientRect();
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    setRemovePrompt({
      x,
      y,
      sx: rect ? clamp(sx, rect.left + 76, rect.right - 76) : sx,
      sy: rect ? clamp(sy, rect.top + 8, rect.bottom - 64) : sy,
      label,
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new DungeonRenderer(canvasRef.current, {
      onTileTap: (x, y) => tapRef.current(x, y),
      onTileAlt: (x, y, sx, sy) => altRef.current(x, y, sx, sy),
      onTileDrag: (x, y) => dragRef.current(x, y),
      // Digging and filling are the only tools a drag runs along.
      isPaintable: () => paintableRef.current,
      onHoverChange: setHover,
      onAimChange: setAim,
      onAct: (button, tile) => actRef.current(button, tile),
    });
    rendererRef.current = renderer;

    // Photograph the tool models once the pack has loaded. Icons are a nicety:
    // if this fails or the device refuses a second GL context, the toolbar
    // keeps its labels and nothing else changes.
    let alive = true;
    void renderer
      .bakeToolIcons([...TOOL_MODEL_KEYS, ...PARTY_MODEL_KEYS])
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

  /** The shape of the room, which is the shape of what has been dug. */
  const open = useMemo(() => dugSet(arena, dug), [arena, dug]);

  useEffect(() => {
    rendererRef.current?.setDug(open);
  }, [open]);

  /*
   * Who is coming, ticked rather than read during render.
   *
   * previewParty asks the clock: an adventurer regrouping after a raid
   * becomes available at a moment nothing fires an event for, and calling
   * Date.now() in the render body would make the component impure and the
   * figures at the door silently stale. Five seconds is far finer than the
   * regroup window and costs one array rebuild.
   */
  const [partyClock, setPartyClock] = useState(() => Date.now());
  useEffect(() => {
    if (raid.raiding) return;
    const id = window.setInterval(() => setPartyClock(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [raid.raiding]);

  // Anything that moves the board out from under the prompt closes it: a
   // raid starting, or the player changing their mind with Escape.
  useEffect(() => {
    if (!removePrompt) return;
    if (raid.raiding) {
      setRemovePrompt(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setRemovePrompt(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removePrompt, raid.raiding]);

  const nextParty = useMemo(
    () => (meta ? previewParty(adventurers, meta.threat, partyClock) : []),
    [adventurers, meta, partyClock],
  );

  /*
   * Which of the names in the roster are the ones coming next.
   *
   * Only the ones the server already knows about: a preview that had to hire
   * strangers to fill the party invented those, and they are not in the list
   * being marked because they do not exist yet.
   */
  const nextIds = useMemo(
    () => new Set(nextParty.filter((m) => m.known).map((m) => m.id)),
    [nextParty],
  );
  const championId = nextParty.find((m) => m.champion && m.known)?.id ?? null;

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
          // The party carries health bars; the garrison does not. See UnitView.
          showHealth: true,
          // The champion is announced by being bigger than everyone else on
          // the board. No label, no crown model to source - a head taller is
          // a thing every player reads without being taught it.
          scale: a.champion ? CHAMPION_MODEL_SCALE : undefined,
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
        // Rock counts as taken for everything except the tool that removes
        // rock, which is handled on its own below.
        terrain.has(blockedKey(tx, ty, arena.w)) ||
        minions.some((m) => m.x === tx && m.y === ty) ||
        traps.some((tr) => tr.x === tx && tr.y === ty) ||
        rooms.some((r) => roomCovers(r, tx, ty));

      /*
       * Digging is the one tool whose legal tile is rock, not floor - and it
       * has to touch something already open, because a sealed pocket in the
       * middle of the rock is a room no raid can ever reach.
       */
      if (tool.kind === "dig") {
        if (!terrain.has(blockedKey(x, y, arena.w))) return false;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
          ([dx, dy]) =>
            inArena(arena, x + dx, y + dy) &&
            !terrain.has(blockedKey(x + dx, y + dy, arena.w)),
        );
      }

      // Filling wants open floor with nothing standing on it.
      if (tool.kind === "fill") {
        return !taken(x, y);
      }

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
    [arena, entrance, core, terrain, meta, minions, traps, rooms, tool],
  );

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const modelKey = TOOL_MODEL[toolId] ?? null;
    if (!modelKey || raid.raiding || !hover) {
      renderer.setGhost(null, true);
      renderer.setRangeRing(null);
      return;
    }
    renderer.setGhost(modelKey, ghostLegal(hover.x, hover.y));

    /*
     * Show the reach of anything that shoots.
     *
     * Where a minion goes is decided entirely by whether the route passes
     * through this circle — inside it and the minion fires; inside it and
     * reachable, and the party comes for the minion instead. That was a number
     * the player was never shown.
     */
    renderer.setRangeRing(
      tool.kind === "minion" ? minionStatsFor({ type: tool.type }).range : null,
    );
  }, [toolId, tool, hover, raid.raiding, ghostLegal]);

  /**
   * Tell the camera how much of itself the interface is covering.
   *
   * The canvas is full-screen and everything else floats on top of it, so
   * without this the board frames to the middle of the canvas — which in the
   * game is behind the panel with the core out of sight, and on the title is
   * behind the slab the menu is cut into. Measured rather than assumed: the
   * panel changes height when it collapses, and the slab is a share of a
   * stage whose width the window decides.
   */
  useEffect(() => {
    const measure = () => {
      const renderer = rendererRef.current;
      const panel = hudRef.current;
      if (!renderer || !panel) return;
      // Measured against the stage, not the window: on a wide screen the game
      // is a letterboxed column and the window is mostly backdrop.
      const stage = panel.offsetParent as HTMLElement | null;
      const frame = stage?.getBoundingClientRect() ?? null;

      if (screen === "title") {
        // The panel is hidden behind the title, so it covers nothing - and
        // measuring it would read a box of zeroes as a full-height sheet.
        const slab = document.querySelector(".title-slab");
        const left = slab && frame ? slab.getBoundingClientRect().right - frame.left : 0;
        renderer.setBottomInset(0);
        renderer.setRightInset(0);
        renderer.setTopInset(0);
        renderer.setLeftInset(Math.max(0, left));
        return;
      }

      renderer.setLeftInset(0);
      // The bar and its banners cover the top of the board. Not while
      // walking: down there the camera is an eye, not a frame, and every
      // offset would only skew what it sees.
      const dock = document.querySelector(".topdock");
      const dockBottom = dock && frame && !walking ? dock.getBoundingClientRect().bottom - frame.top : 0;
      renderer.setTopInset(Math.max(0, dockBottom));
      const box = panel.getBoundingClientRect();
      // A column down the side starts near the top of the stage; a sheet
      // across the foot starts well below it. Either way, only the covered
      // strip is handed over, never both.
      const column = frame ? box.top - frame.top < frame.height * 0.5 && box.width < frame.width * 0.6 : false;
      if (column && frame && !walking) {
        renderer.setBottomInset(0);
        renderer.setRightInset(Math.max(0, frame.right - box.left));
      } else {
        renderer.setRightInset(0);
        const bottom = frame && !walking ? frame.bottom - box.top : 0;
        renderer.setBottomInset(Math.max(0, bottom));
      }
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [screen, walking, hudOpen, tab, minions.length, traps.length, rooms.length, research.length]);

  useEffect(() => {
    rendererRef.current?.setUnits(units);
  }, [units]);

  useEffect(() => {
    rendererRef.current?.setMarkers(markers);
  }, [markers]);

  // The route is shown while building and hidden during a raid, where the
  // adventurers themselves show it.
  useEffect(() => {
    if (!meta || raid.raiding || showAftermath) {
      rendererRef.current?.setPathPreview(null);
      return;
    }
    rendererRef.current?.setPathPreview(
      // The rock only - the same set the simulation routes against. Dropping
      // a minion on the route does not bend it, which is the whole point: the
      // line stays where it is and the minion is now standing on it, waiting
      // to be walked into.
      buildRaidPath(
        arena,
        entrance,
        core,
        lureTiles(rooms),
        new Set(terrain),
      ),
    );
  }, [arena, entrance, core, terrain, meta, rooms, raid.raiding, showAftermath]);

  /*
   * What the route becomes if the tile under the cursor changes.
   *
   * Only for the two tools that move rock: rock is the only thing that
   * shapes a route, so a minion or a trap under the cursor has nothing to
   * preview. Only when the tile would actually take the change, or it would
   * be answering a question the player cannot ask.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const moves = tool.kind === "dig" || tool.kind === "fill";
    if (!meta || raid.raiding || !hover || !moves || !ghostLegal(hover.x, hover.y)) {
      renderer.setPathGhost(null);
      return;
    }

    const lures = lureTiles(rooms);
    const now = buildRaidPath(
      arena, entrance, core, lures,
      new Set(terrain),
    );
    // Digging takes the tile out of the rock; filling puts it back in.
    const rock = new Set(terrain);
    if (tool.kind === "dig") rock.delete(blockedKey(hover.x, hover.y, arena.w));
    else rock.add(blockedKey(hover.x, hover.y, arena.w));
    const after = buildRaidPath(arena, entrance, core, lures, rock);

    /*
     * Only when it would actually change something.
     *
     * Most tiles are nowhere near the route and building on them moves
     * nothing - drawing the same line twice there just made the route look
     * brighter under the cursor and taught the player that hovering does
     * something when it does not. A second line means a second answer.
     */
    const same =
      now !== null && after !== null &&
      now.length === after.length &&
      now.every((step, i) => step.x === after[i].x && step.y === after[i].y);

    renderer.setPathGhost(same ? null : after);
  }, [hover, tool, meta, raid.raiding, arena, entrance, core, terrain, rooms, ghostLegal]);

  /**
   * Paint the aftermath when the fighting stops; wipe it when it starts again.
   *
   * Driven off `raid.raiding` rather than off the result, because the result
   * arrives from the server and the map is the client's own record - it has
   * to appear even on the offline preview, and it has to survive the player
   * dismissing the settlement screen, which is the moment they actually start
   * looking at the board.
   *
   * It then stays until the next raid opens. Editing does not clear it: the
   * map is the reason to edit, and rebuilding a corridor with the record of
   * why still under it is the entire point.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (raid.raiding) {
      aftermathRef.current = emptyTally();
      renderer.setAftermath(null);
      setShowAftermath(false);
      return;
    }

    /*
     * Not during a build window.
     *
     * The window is for deciding where the next wave walks, and the question
     * it asks is answered by the route - so the route gets the floor. The
     * record of the wave just fought would be painted over the same tiles and
     * the two together read as neither.
     */
    if (raid.raidOpen) {
      renderer.setAftermath(null);
      setShowAftermath(false);
      return;
    }

    const cells = tallyCells(aftermathRef.current);
    if (!cells) return;
    renderer.setAftermath(cells, aftermathRef.current.marks);
    setShowAftermath(true);
  }, [raid.raiding]);

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
      arena, dug, minions, traps, rooms, loot, prisoners, adventurers,
      research, unlocked, effects, jailFree, meta, gold,
      dig: save.dig,
      fill: save.fill,
      rebuild: save.rebuild,
      placeMinion: save.placeMinion,
      placeTrap: save.placeTrap,
      placeRoom: save.placeRoom,
      removeAt: save.removeAt,
      equipWeapon: save.equipWeapon,
      buyResearch: save.buyResearch,

      startRaid: raid.startRaid,
      useSkill: raid.useSkill,
      stepRaid: raid.stepRaid,
      raidState: raid.raidState,
      raidResult: raid.result,
      showResult: raid.showResult,
      audio,
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

  const adGold = useAdGold(save.setGoldFromServer);

  const onGoldAd = useCallback(async () => {
    const outcome = await adGold.claim();
    if (outcome === "paid") {
      audio.play("skill");
      return;
    }
    // Anything else is worth saying out loud: the player just sat through
    // something and needs to know why nothing arrived.
    setAdNotice(outcome === "not-watched" ? t("ad_not_watched") : t("ad_failed"));
    window.setTimeout(() => setAdNotice(null), 4000);
  }, [adGold, t]);

  // Apply saved preferences once the renderer exists.
  useEffect(() => {
    audio.setVolume(settings.volume);
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
    setWalking(true);
    if (!settings.introSeen) {
      setIntroOpen(true);
      patchSettings({ introSeen: true });
    }
  }, [settings.introSeen, patchSettings]);

  // The purse counts to its new total rather than jumping to it, and the shape
  // of the pop says whether the change was earned or spent.
  const purse = useCountUp(gold);
  const tier = tierFor(meta?.threat ?? 0);

  /** How full each kind is, shown on the kind button rather than in a row of counters. */
  const groupUsage: Record<ToolGroup, { count: number; cap: number }> = {
    // The corridor has no cap of its own: what limits it is what it costs.
    dig: { count: dug.length, cap: arena.w * arena.h },
    minion: { count: minions.length, cap: effects.minionCap },
    trap: { count: traps.length, cap: MAX_TRAPS },
    room: { count: rooms.length, cap: MAX_ROOMS },
  };

  /** What the garrison is worth at this size of dungeon. See garrisonScale. */
  const spread = garrisonScale(dug.length);

  const guide = guideFor({
    entrance,
    core,
    minions,
    traps,
    wavesRepelled: meta?.wavesRepelled ?? 0,
    coreBreaches: meta?.coreBreaches ?? 0,
    loot: loot.length,
    // In the corridor the thing in hand is the hotbar slot, not the board tool.
    toolId: walking ? (heldEntry?.id ?? "") : toolId,
    group,
    dug: dug.length,
    isDug: (x, y) => terrain.has(blockedKey(x, y, arena.w)) === false && inArena(arena, x, y),
    connected,
    flat: walking,
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
    teaching?.target?.kind === "tile" && !walking && !ghostLegal(teaching.target.x, teaching.target.y)
      ? null
      : teaching?.target ?? null;
  const spotlight = useSpotlight(pointer, locateTile);

  /*
   * While the opening is running, the board takes the tap it is asking for
   * and no other.
   *
   * Restricting the tile was not enough. A step ends the moment its thing is
   * built, and the next one points at a button rather than a tile - so
   * between placing the first wall and picking up the archer the board came
   * unlocked with the wall tool still in hand, and a player could line the
   * room with barricades while the ring sat on a toolbar button. Taps are
   * refused outright in that gap now: a tool step is answered by pressing the
   * tool, not by building more of the last thing.
   *
   * Three states, and the escape hatch matters as much as the lock:
   *   - null: no tutorial, no restriction.
   *   - a tile: the step is asking for a tap, and that is where.
   *   - "none": the step is asking for a button press, so the board is shut.
   *
   * A suggested tile the player has already built on is dropped upstream,
   * and that case falls back to null rather than to "none" - being unable to
   * place anywhere is how a tutorial traps someone.
   *
   * Through a ref because the tap handler is written above this point.
   */
  const guidedTapRef = useRef<{ x: number; y: number } | "none" | null>(null);
  guidedTapRef.current = !teaching
    ? null
    : pointer && pointer.kind === "tile"
      ? { x: pointer.x, y: pointer.y }
      : teaching.target?.kind === "tile"
        ? null
        : "none";

  const toolHint = (() => {
    if (raid.pendingSkill)
      return `${t(SKILL_LABEL[raid.pendingSkill] as StringKey)} — ${t("hint_skill_target")}`;
    if (tool.kind === "dig") {
      // Said on the tool that causes it as well as on the button that shows
      // it, because this is the one rule a player has to feel while digging.
      return spread < 1 ? `${t("hint_dig")} · ${t("hint_spread", { scale: spread.toFixed(2) })}` : t("hint_dig");
    }
    if (tool.kind === "fill") {
      return HAS_MOUSE ? `${t("hint_fill")} · ${t("hint_remove_alt")}` : t("hint_fill");
    }
    // The right-click shortcut is mentioned exactly where it applies, and
    // only on a machine that has a right button to click. A phone is told
    // about a gesture it cannot make otherwise.
    if (tool.kind === "remove") {
      return HAS_MOUSE ? `${t("hint_remove")} · ${t("hint_remove_alt")}` : t("hint_remove");
    }
    if (tool.kind === "minion") {
      const spent = `${minions.length}/${effects.minionCap}`;
      return spread < 1
        ? `${t("hint_minion")} ${spent} · ×${spread.toFixed(2)}`
        : `${t("hint_minion")} ${spent}`;
    }
    if (tool.kind === "trap") return `${t("hint_trap")} ${traps.length}/${MAX_TRAPS}`;
    return `${t(ROOM_DESCRIPTION[tool.type] as StringKey)} ${t("hint_room")} ${rooms.length}/${MAX_ROOMS}`;
  })();

  return (
    <LocaleProvider locale={settings.locale}>
    <div
      className="app"
      /*
       * The browser menu is suppressed for the whole stage, not just the
       * canvas.
       *
       * It was on the canvas alone, and that is one element too few: the
       * order of a right click is pointerdown, pointerup, contextmenu, and
       * the prompt opens on pointerup - behind a backdrop that covers the
       * viewport. By the time contextmenu fires the element under the cursor
       * is that backdrop, so the canvas listener never saw it and Chrome
       * drew its own menu over the prompt we had just opened.
       *
       * Right click is a game gesture here, so it belongs to the game
       * everywhere inside the stage.
       */
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="viewport" />

      <div className="floaters">
        {floaters.map((f) => (
          <span key={f.id} className={`floater ${f.kind}`} style={{ left: f.x, top: f.y }}>
            {f.text}
          </span>
        ))}
      </div>

      {/*
        * The top chrome as one column, rather than three things pinned at
        * three guessed offsets.
        *
        * The stack used to start at a hardcoded 46px and the skill buttons at
        * 96px, which held only while the bar above them was exactly the
        * height those numbers were measured against. The moment the bar's
        * padding started scaling with the stage it outgrew them: at a 534px
        * stage the bar is 73px tall and the stack was still starting at 46,
        * so a banner or the raid readout was drawn under the gold and the
        * icons. Laid out in flow, the offsets cannot be wrong.
        */}
      {/* The title is a door, not a layer over the game: the chrome behind it
          is hidden rather than dimmed, so what shows past the menu is the room
          and nothing else. */}
      <div className="topdock" hidden={screen === "title"}>
      <header className="topbar">
        <div className="brand">DUNGEON WARDEN</div>
        <div className="stats">
          {/* Keyed on the beat so the pop replays on every change; a CSS
              animation on a stable element only ever plays once. */}
          <span key={purse.beat} className={`gold ${purse.dir ?? ""}`}>
            <img className="coin" src={coinIcon} alt="" />
            {purse.shown}
          </span>
          {/* The threat number with the name the dungeon has earned, which is
              the only measure of progress this game has. */}
          {meta && (
            <span className="pending">
              {t("stat_threat")} {meta.threat}
              {tier && <b className="tier"> {t(tier.label as StringKey)}</b>}
            </span>
          )}
          <span className={`status status-${status}`}>
            {STATUS_LABEL[status] ? t(STATUS_LABEL[status]) : status}
          </span>
        </div>
        {/* Icons, not labels, in the middle of the bar. These are somewhere
            to go once in a while; the gold on the left is the thing being
            played for. */}
        <nav className="menu">
          {/* The one button that changes where you are rather than what is
              on top of the screen. Hidden while a raid is on: the camera has
              somewhere else to be. */}
          {!raid.raidOpen && (
            <button
              className={walking ? "icon-toggle walking" : "icon-toggle"}
              onClick={() => { audio.play("click"); setWalking(!walking); }}
              title={walking ? t("walk_exit") : t("menu_walk")}
              aria-label={walking ? t("walk_exit") : t("menu_walk")}
            >
              <Icon name="eye" />
            </button>
          )}
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setBoardOpen(true); }}
            title={t("menu_leaderboard")}
            aria-label={t("menu_leaderboard")}
          >
            <Icon name="trophy" />
          </button>
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setShopOpen(true); }}
            title={t("menu_shop")}
            aria-label={t("menu_shop")}
          >
            <Icon name="shop" />
          </button>
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setSettingsOpen(true); }}
            title={t("menu_settings")}
            aria-label={t("menu_settings")}
          >
            <Icon name="settings" />
          </button>
          <button
            className="icon-toggle"
            onClick={() => { audio.play("click"); setScreen("title"); }}
            title={t("menu_home")}
            aria-label={t("menu_home")}
            disabled={raid.raiding}
          >
            <Icon name="home" />
          </button>
        </nav>
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

        {/* The map has no legend and no words on it, which is the point -
            but a ring that appears on its own and stays needs to say once
            what it is, and offer the way out it already had. */}
        {showAftermath && (
          <div className="banner">
            <button
              className="banner-close"
              onClick={() => {
                setShowAftermath(false);
                rendererRef.current?.setAftermath(null);
              }}
              aria-label="close"
            >
              ×
            </button>
            {t("aftermath_note")}
          </div>
        )}

        {error && <div className="banner banner-error">{t("save_error")}: {error}</div>}
        {/* Said once, on the raid that first arrives at a tier. */}
        {raid.milestone && (
          <div className="banner banner-tier">
            <button className="banner-close" onClick={raid.dismissMilestone} aria-label="close">×</button>
            {t("tier_reached", { name: t(raid.milestone as StringKey) })}
          </div>
        )}

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

        {/* The build window between waves. Its own bar rather than a state
            inside the raid bar: the raid bar is a readout of a fight, and
            during the window there is no fight - there is a clock and one
            button. */}
        {raid.intermission && raid.raidState && (
          <div className="raid-bar building">
            <b>{t("intermission")}</b>
            <span>
              {t("raid_wave", { n: raid.raidState.wave + 1, of: raid.raidState.waves })}
            </span>
            <span className="countdown">
              {Math.ceil(raid.raidState.intermissionLeft)}{t("seconds")}
            </span>
            <button className="go-wave" onClick={() => { audio.play("raidStart"); raid.beginNextWave(); }}>
              {t("next_wave")}
            </button>
          </div>
        )}

        {raid.raiding && raid.raidState && (
          <div className="raid-bar">
            <b>{t("raiding")}</b>
            <span>{t("raid_wave", { n: raid.raidState.wave, of: raid.raidState.waves })}</span>
            <span>{t("raid_adventurers")} {raid.raidState.adventurers.filter((a) => a.alive).length}/{raid.raidState.adventurers.length}</span>
            <span>{t("raid_minions")} {raid.raidState.minions.filter((m) => m.alive).length}/{raid.raidState.minions.length}</span>
            <span>{t("raid_traps")} {raid.raidState.trapDamage}</span>
            <span>{raid.raidState.elapsed.toFixed(0)}{t("seconds")}</span>
            <div className="speeds">
              {RAID_SPEEDS.map((s) => (
                <button
                  key={s}
                  className={raid.speed === s ? "active" : ""}
                  onClick={() => { raid.setSpeed(s); patchSettings({ raidSpeed: s }); }}
                >
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
                {/* What it does, not whether it is available - "사용 가능" was
                    the button restating that it was not greyed out. The state
                    that is worth words is the countdown, and that replaces
                    this line while it runs. */}
                <i>
                  {cd > 0
                    ? `${cd.toFixed(0)}${t("seconds")}`
                    : t(SKILL_NOTE[skill] as StringKey)}
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
      </div>

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

      <aside
        ref={hudRef}
        className={hudOpen ? "hud" : "hud collapsed"}
        // Hidden rather than unmounted: it keeps its scroll position and its
        // open tab for when the player climbs back out.
        hidden={walking || screen === "title"}
      >
        <div className="hud-tabs">
          <button className={tab === "build" ? "active" : ""} onClick={() => { audio.play("click"); setTab("build"); }}>{t("tab_build")}</button>
          <button className={tab === "manage" ? "active" : ""} onClick={() => { audio.play("click"); setTab("manage"); }}>{t("tab_manage")}</button>
          <button className={tab === "research" ? "active" : ""} onClick={() => { audio.play("click"); setTab("research"); }}>
            {t("tab_research")} {research.length}/{RESEARCH.length}
          </button>
          <button className="hud-toggle" onClick={() => setHudOpen(!hudOpen)} aria-label="toggle">
            <Icon name={hudOpen ? "chevronDown" : "chevronUp"} size={16} />
          </button>
        </div>

        {/* Keyed on the tab so each one fades in as its own page of controls. */}
        <div key={tab} className="hud-body">
          {tab === "build" && (
            <>
              {/* Which kind of thing, then which one — and the counts live on
                  the kind, so the four lines of counters underneath are gone. */}
              <div className="groups">
                {GROUPS.map((entry) => {
                  const used = groupUsage[entry.id];
                  return (
                    <button
                      key={entry.id}
                      className={group === entry.id ? "group active" : "group"}
                      data-tut={`tool:group-${entry.id}`}
                      onClick={() => { audio.play("click"); setGroup(entry.id); }}
                      disabled={raid.raiding}
                    >
                      <b>{t(entry.label)}</b>
                      {/* The dig button carries what digging costs you rather
                          than a cap it will never reach: a corridor is limited
                          by gold and by this, not by a number of tiles. */}
                      <i>
                        {entry.id === "dig"
                          ? `${used.count} · ×${spread.toFixed(2).replace(/0$/, "")}`
                          : `${used.count}/${used.cap}`}
                      </i>
                    </button>
                  );
                })}
                <button
                  className={toolId === "remove" ? "group remove active" : "group remove"}
                  onClick={() => { audio.play("click"); setToolId("remove"); }}
                  disabled={raid.raiding}
                  title={t("tool_remove")}
                >
                  <b>{t("tool_remove")}</b>
                </button>
              </div>

              <div className="toolbar">
                {TOOLS.filter((e) => e.group === group && e.id !== "remove").map((entry) => {
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
                        <b>{locked && <Icon name="lock" size={11} />}{label}</b>
                        <i>{entry.cost === null ? t("free") : `${entry.cost}G`}</i>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* One line. The counters moved onto the kind buttons and the two
                  standing explanations are the tutorial's job, not a paragraph
                  the player reads past every session. */}
              <p className="hint">{toolHint}</p>

              {/* Clearing gives everything back a tile at a time, so this is
                  the same offer made once: try a different shape without
                  forty taps of the remove tool first. */}
              <div className="actions">
                <button
                  className="rebuild"
                  disabled={raid.raiding}
                  onClick={() => {
                    const ok = save.rebuild();
                    audio.play(ok ? "dig" : "error");
                    if (ok) {
                      setShowAftermath(false);
                      rendererRef.current?.setAftermath(null);
                    }
                  }}
                >
                  {t("tool_rebuild")}
                </button>
              </div>



              {/* Saving is the foot button when there is anything to save, and
                  resetting the dungeon is a destructive action that already
                  lives in settings — both were duplicated here, one tap from
                  the tools, and both were being sliced by the panel edge. */}
              {/* Only shown when the server says there is something to claim,
                  so a player is never sent to watch an ad that pays nothing. */}
              {adGold.status && adGold.status.remaining > 0 && (
                <div className="actions">
                  <button
                    className="ad-gold"
                    disabled={!adGold.ready || adGold.busy || raid.raiding}
                    onClick={() => void onGoldAd()}
                  >
                    {adGold.busy
                      ? t("ad_playing")
                      : `+${adGold.status.reward} · ${t("ad_watch")} ${adGold.status.remaining}/${adGold.status.limit}`}
                  </button>
                </div>
              )}

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
                  {/* The dropdowns stay for anyone who wants to argue with
                      it, but the answer is not in dispute, so it is one tap
                      above them rather than eight below. */}
                  {minions.length > 0 && (
                    <div className="actions">
                      <button
                        data-tut="action:equip"
                        disabled={raid.raiding}
                        onClick={() => { audio.play("click"); save.equipBest(); }}
                      >
                        {t("manage_equip_best")}
                      </button>
                    </div>
                  )}
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
                    // Marked when this is one of the names the next raid is
                    // built from, so the list stops being a history and
                    // starts being a warning.
                    <p
                      key={a.id}
                      className={nextIds.has(a.id) ? "hint small next" : "hint small"}
                    >
                      {a.id === championId && <Icon name="crown" size={12} />}
                      {a.name} · {t(ADVENTURER_LABEL[a.cls])} Lv{a.level} ·{" "}
                      {t(a.raids === 1 ? "times_one" : "times", { n: a.raids })} ·{" "}
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

        {/* The one thing the whole panel is for. Outside .hud-body, because
            inside it the button that starts the game scrolled off the bottom
            of the phone behind fifteen other controls. */}
        <div className="hud-foot">
          {/*
            * One button, doing whatever comes next.
            *
            * It used to be a raid button that greyed itself out whenever there
            * were unsaved changes, with the reason in a line of small text
            * underneath — so the player's move was to read an explanation and
            * then find a different button. Unsaved work is a save; everything
            * else is a raid.
            */}
          <button
            className="primary go"
            data-tut="action:raid"
            onClick={() => {
              audio.play("raidStart");
              void raid.startRaid();
            }}
            // Nothing can walk in until the way in exists.
            disabled={raid.raidOpen || raid.starting || !connected}
          >
            {raid.starting
              ? t("preparing")
              : connected
                ? t("start_raid")
                : t("connect_first")}

            {/*
              * Who is about to walk in, on the button that lets them in.
              *
              * This was a row of model photographs above the button, and it
              * was wrong twice: an adventurer rendered at 37px is a smudge
              * that identifies nothing, and the row cost 49px of a panel
              * whose contents already had to scroll - so it hid the dungeon
              * in order to show nothing. Standing them on the board instead
              * was no better: a unit is about 20px tall on a phone.
              *
              * What the player actually needs before pressing is two numbers
              * and one fact - how strong, how many, and whether it is led.
              * Numbers survive being small. The crown is a flat glyph rather
              * than a render, for the same reason.
              */}
            {connected && !raid.starting && nextParty.length > 0 && (
              <span className="go-sub">
                {nextParty.some((m) => m.champion) && <Icon name="crown" size={13} />}
                {t("party_summary", {
                  level: Math.max(...nextParty.map((m) => m.level)),
                  count: nextParty.length,
                })}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/*
        * Down in the corridor the screen is the corridor.
        *
        * The build panel is hidden rather than disabled: there is nothing to
        * build from in here, and a panel covering a third of the view would
        * undo the only thing this mode is for.
        */}
      {walking && (
        <div className="walkbar">
          <div
            ref={stickRef}
            className="stick"
            aria-label={t("menu_walk")}
            onPointerDown={(e) => {
              stickPointer.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              stickAt(e);
            }}
            onPointerMove={(e) => {
              if (stickPointer.current === e.pointerId) stickAt(e);
            }}
            onPointerUp={stickRelease}
            onPointerCancel={stickRelease}
          >
            <div ref={knobRef} className="knob" />
          </div>
          <button className="walk-exit" onClick={() => { audio.play("click"); setWalking(false); }}>
            {t("walk_map")}
          </button>
        </div>
      )}

      {/* Opening the raid from the floor. The same name the panel button
          carries, so the guide can find whichever of the two is on screen. */}
      {walking && !raid.raidOpen && (
        <button
          className="primary walk-raid"
          data-tut="action:raid"
          onClick={() => {
            audio.play("raidStart");
            void raid.startRaid();
          }}
          disabled={raid.starting || !connected}
        >
          {raid.starting ? t("preparing") : connected ? t("start_raid") : t("connect_first")}
        </button>
      )}

      {/* The crosshair, and under it what the block it rests on will take:
          the dig price on rock, nothing on floor - the bar says what goes
          there. Both take no clicks; the canvas underneath is the hand. */}
      {walking && (
        <div className="crosshair" aria-hidden="true">
          <i />
          {aim?.kind === "rock" && <b>{DIG_COST}G</b>}
        </div>
      )}

      {walking && (
        <div className="hotbar">
          {heldEntry && (
            <p className="hotbar-held">
              {t(heldEntry.label)}
              <i> · {heldEntry.cost === null ? t("free") : `${heldEntry.cost}G`}</i>
            </p>
          )}
          <div className="hotbar-row">
            {hotbar.map((entry, i) => {
              const locked = heldLocked(entry);
              const modelKey = TOOL_MODEL[entry.id];
              const icon = modelKey ? toolIcons[modelKey] : undefined;
              return (
                <button
                  key={entry.id}
                  data-tut={`tool:${entry.id}`}
                  className={i === held ? "slot active" : locked ? "slot locked" : "slot"}
                  onClick={() => { audio.play("click"); setHeld(i); }}
                  title={locked ? t("locked_hint") : t(entry.label)}
                  aria-label={t(entry.label)}
                >
                  <em>{i + 1}</em>
                  {icon ? <img src={icon} alt="" /> : <b>{t(entry.label).slice(0, 2)}</b>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Anchored where the click landed, and clamped so it cannot hang off
          the stage. A backdrop takes the next click anywhere else, which is
          how a context menu is dismissed everywhere. */}
      {removePrompt && (
        <div className="prompt-catch" onPointerDown={() => setRemovePrompt(null)}>
          <div
            className="tile-prompt"
            style={{ left: removePrompt.sx, top: removePrompt.sy }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <b>{removePrompt.label}</b>
            <button
              onClick={() => {
                const ok = save.removeAt(removePrompt.x, removePrompt.y);
                audio.play(ok ? "place" : "error");
                setRemovePrompt(null);
              }}
            >
              {t("tool_remove")}
            </button>
          </div>
        </div>
      )}

      {/*
        * Sits above the running scene, so the dungeon is already rendered and
        * warm by the time the player presses start — and *before* the dialogs
        * in the DOM, because its own buttons open them.
        *
        * The order matters here in a way z-index does not fix. Both this and a
        * modal backdrop carry a backdrop-filter, and two overlapping filtered
        * layers composite in document order whatever their z-index says.
        * Written after the dialogs, the title painted over an open shop —
        * hit-testing put the modal on top, the screen did not — which is a
        * player pressing a button on the title and getting a ghost.
        */}
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
    </div>

    {/* Outside .app on purpose: the guard hides the stage rather than
        unmounting it, so a device tilt does not tear down the WebGL
        context. Shown only by a media query — a phone held sideways gives a
        211px column, too narrow for the top bar at any legible size. */}
    <div className="rotate-guard">
      <div className="phone" />
      <span>{translate(settings.locale, "rotate_hint")}</span>
    </div>
    </LocaleProvider>
  );
}
