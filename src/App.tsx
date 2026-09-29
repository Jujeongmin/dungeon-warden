import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DungeonRenderer } from "./game/DungeonRenderer";
import { adButtonShown, initAds, watchGoldAd } from "./game/ads";
import { audio, type Cue } from "./game/audio";
import { installDevTools } from "./game/devtools";
import { BUZZ, buzz } from "./game/haptics";
import { loadSettings, pixelRatioFor, saveSettings, type Settings } from "./game/settings";
import { TRAP_STATS } from "./game/sim/traps";
import { researchEffects } from "./game/td/research";
import { AD_GOLD, type Refusal, type RunEvent, type StageRun } from "./game/td/StageRun";
import { BOONS_BY_ID, dealBoons, type Boon } from "./game/td/boons";
import { endlessStage, WAVES_PER_STAGE, stageOfWave } from "./game/td/stages";
import { MAX_TOWER_LEVEL, TOWER_TYPES, TOWERS, towerStats, upgradeCost, type TowerType } from "./game/td/towers";
import { tutorialFor } from "./game/td/tutorial";
import { useProgress } from "./game/td/useProgress";
import { FREE_RUN_SPEED, PAID_RUN_SPEED, RUN_SPEEDS, useStageRun } from "./game/td/useStageRun";
import { runFloor, runMarkers, runUnits } from "./game/td/views";
import { ADVENTURER_LABEL, TRAP_LABEL, TRAP_NOTE, type TrapType } from "./game/types";
import { useTitleDemo } from "./game/useTitleDemo";
import { LocaleProvider, type Translate } from "./i18n";
import { translate, type StringKey } from "./i18n/strings";
import { GuideDialog } from "./ui/GuideDialog";
import { Icon } from "./ui/Icon";
import { IntroDialog } from "./ui/IntroDialog";
import { ResearchDialog } from "./ui/ResearchDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { BoonDialog } from "./ui/BoonDialog";
import { StageResultDialog } from "./ui/StageResultDialog";
import { RankingDialog } from "./ui/RankingDialog";
import { TitleScreen } from "./ui/TitleScreen";
import { useCountUp } from "./ui/useCountUp";
import { useSpotlight } from "./ui/useSpotlight";
import coinIcon from "./assets/icons/coin.svg";
import "./App.css";

// The shop pulls in the Verse8 platform SDK and is opened a handful of times
// at most, so it is not in the first download.
const ShopDialog = lazy(() => import("./ui/ShopDialog").then((m) => ({ default: m.ShopDialog })));

/** A shot from further than this draws a line; one from beside the target does not. */
const BOLT_MIN_SPAN = 1.3;

/** The sound each tower makes when it fires. The shaman fires at nothing. */
const TOWER_SOUND: Partial<Record<TowerType, Cue>> = {
  warrior: "shoot",
  crossbow: "shoot",
  mage: "cast",
  guard: "swing",
  grunt: "swing",
  berserker: "swing",
};

/** How long a refusal stays on the hint line. */
const REFUSAL_MS = 2200;

/**
 * How far above a finger the tile being placed on sits, in pixels.
 *
 * A thumb covers the tile under it, so on a touch screen the drag aims at a
 * tile a little higher up - the one lit on the board - and that is where the
 * tower lands. A mouse points at what it covers nothing of, so it aims at
 * itself.
 */
const TOUCH_LIFT = 56;

/** Where a drag is aiming: above the finger, or exactly at the cursor. */
function aimPoint(e: { clientX: number; clientY: number; pointerType: string }): { x: number; y: number } {
  return { x: e.clientX, y: e.clientY - (e.pointerType === "mouse" ? 0 : TOUCH_LIFT) };
}

const TRAP_TYPES: TrapType[] = ["spike", "arrow", "rockfall", "flame", "web", "poison", "rune"];

type Tool = { kind: "tower"; type: TowerType } | { kind: "trap"; type: TrapType };

const TOOLS: Array<{ id: string; tool: Tool; model: string }> = [
  ...TOWER_TYPES.map((type) => ({ id: type, tool: { kind: "tower" as const, type }, model: `m_${type}` })),
  ...TRAP_TYPES.map((type) => ({ id: type, tool: { kind: "trap" as const, type }, model: type })),
];

const TOOL_MODEL_KEYS = TOOLS.map((entry) => entry.model);

const REFUSAL_TEXT: Record<Refusal, StringKey> = {
  gold: "refuse_gold",
  rock: "refuse_rock",
  bedrock: "refuse_rock",
  rubble: "refuse_rubble",
  not_dug: "refuse_rock",
  taken: "refuse_taken",
  occupied: "refuse_occupied",
  blocks: "refuse_blocks",
  fixed: "refuse_fixed",
  unreachable: "refuse_rock",
  locked: "locked_hint",
  max_level: "tower_max",
  over: "refuse_over",
};


type Selection = { kind: "tower" | "trap"; id: string } | null;

interface Result {
  wavesCleared: number;
  /** Null until the server has said what the run earned. */
  souls: number | null;
  improved: boolean;
  saved: boolean | null;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DungeonRenderer | null>(null);
  const hudRef = useRef<HTMLElement>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [toolIcons, setToolIcons] = useState<Record<string, string>>({});

  const [settings, setSettings] = useState(loadSettings);
  const [screen, setScreen] = useState<"title" | "play">("title");
  const [toolId, setToolId] = useState<string>("warrior");
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [hudOpen, setHudOpen] = useState(true);
  const [homeArmed, setHomeArmed] = useState(false);
  /** An ad is showing: the run waits, and the button cannot be pressed twice. */
  /** The tool being dragged out of the build panel, if one is. */
  /** The tool being dragged out of the build panel; drives the cursor. */
  const [dragging, setDragging] = useState<Tool | null>(null);
  // Read inside the pointer handlers: the first move can arrive before React
  // has re-rendered with the state above.
  const draggingRef = useRef<Tool | null>(null);
  const beginDrag = (tool: Tool | null) => {
    draggingRef.current = tool;
    setDragging(tool);
  };
  /** The three cards a cleared stage is offering, and which stage it was. */
  const [boonOffer, setBoonOffer] = useState<{ stage: number; hand: Boon[] } | null>(null);
  const [adShowing, setAdShowing] = useState(false);
  /** Bumped after an ad attempt: the SDK may now say this host shows none. */
  const [adTry, setAdTry] = useState(0);
  /** Why the last ad paid nothing, on the hint line. */
  const [adNote, setAdNote] = useState<StringKey | null>(null);

  const [rankingOpen, setRankingOpen] = useState(false);
  /** Souls paid on starting for a run that was left open, shown once. */
  const [settledNote, setSettledNote] = useState<number | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  const [floaters, setFloaters] = useState<Array<{ id: number; text: string; x: number; y: number; kind: string }>>([]);
  const floaterSeq = useRef(0);

  const t = useMemo<Translate>(() => (key, vars) => translate(settings.locale, key, vars), [settings.locale]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      if (patch.volume !== undefined) audio.setVolume(patch.volume);
      if (patch.quality !== undefined) rendererRef.current?.setPixelRatio(pixelRatioFor(patch.quality));
      return next;
    });
  }, []);

  const checkpointRef = useRef<(waves: number) => Promise<void>>(async () => {});
  const progress = useProgress();
  checkpointRef.current = progress.checkpointRun;
  const effects = useMemo(() => researchEffects(progress.progress.research), [progress.progress.research]);
  const owns3x = progress.entitlements.fastForward === true;

  // --------------------------------------------------------------- events

  const float = useCallback((text: string, x: number, y: number, kind: string) => {
    const at = rendererRef.current?.project(x, y);
    if (!at) return;
    floaterSeq.current += 1;
    const id = floaterSeq.current;
    setFloaters((current) => [...current, { id, text, x: at.x, y: at.y, kind }].slice(-24));
    window.setTimeout(() => setFloaters((c) => c.filter((f) => f.id !== id)), 1000);
  }, []);

  const finishRef = useRef<(run: StageRun) => void>(() => {});

  const onEvents = useCallback(
    (events: RunEvent[], run: StageRun) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      for (const event of events) {
        if (event.kind === "damage") {
          renderer.flashUnit(`a:${event.targetId}`);
          if (event.from) {
            const span = Math.hypot(event.from.x - event.x, event.from.y - event.y);
            if (span > BOLT_MIN_SPAN) {
              renderer.spawnBolt(event.from.x, event.from.y, event.x, event.y, event.source === "trap" ? 0xffc27a : 0xc9b6ff);
            }
          }
        } else if (event.kind === "fired") {
          const cue = TOWER_SOUND[event.type];
          if (cue) audio.play(cue, 90);
        } else if (event.kind === "spawned") {
          if (event.champion) audio.play("roar", 1500);
          else if (event.cls === "flyer") audio.play("dragon", 1500);
        } else if (event.kind === "trap") {
          const trap = run.traps.find((tp) => tp.id === event.trapId);
          renderer.spawnTrapRing(event.x, event.y, trap?.type ?? "spike");
          audio.play("trap", 90);
        } else if (event.kind === "killed") {
          renderer.spawnRing(event.x, event.y, 0xd86a4c);
          renderer.knockbackUnit(`a:${event.targetId}`);
          audio.play("hit", 40);
          float(`+${event.bounty}`, event.x, event.y, "gold");
        } else if (event.kind === "leaked") {
          renderer.shake(0.45);
          audio.play("leak", 120);
          buzz(settings.haptics, BUZZ.leak);
          float(`-${event.lives}♥`, event.x, event.y, "leak");
        } else if (event.kind === "early") {
          audio.play("coins");
          float(`+${event.gold}`, run.entrance.x, run.entrance.y + 1, "gold");
        } else if (event.kind === "waveCleared") {
          float(t("wave_bonus", { n: event.bonus }), run.core.x, run.core.y - 1, "bonus");
          audio.play("coins");
        } else if (event.kind === "stageCleared") {
          audio.play("victory");
          void checkpointRef.current(run.wavesCleared);
          float(t("stage_cleared", { n: event.stage }), run.core.x, run.core.y - 3, "stage");
          // The run waits on the cards: see BoonDialog.
          setBoonOffer({ stage: event.stage, hand: dealBoons() });
        } else if (event.kind === "won" || event.kind === "lost") {
          finishRef.current(run);
        }
      }
    },
    [float, settings.haptics, t],
  );

  const runner = useStageRun({
    onEvents,
    initialSpeed: settings.raidSpeed === PAID_RUN_SPEED && !owns3x ? FREE_RUN_SPEED : settings.raidSpeed,
  });
  const run = screen === "play" ? runner.run : null;

  // ------------------------------------------------------------ renderer

  const tapRef = useRef<(x: number, y: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let renderer: DungeonRenderer | null = null;
    void import("./game/DungeonRenderer").then(({ DungeonRenderer }) => {
      if (!alive) return;
      renderer = new DungeonRenderer(canvas, {
        onTileTap: (x, y) => tapRef.current(x, y),
        onHoverChange: setHover,
      });
      rendererRef.current = renderer;
      setRendererReady(true);
      void renderer
        .bakeToolIcons(TOOL_MODEL_KEYS)
        .then((icons) => { if (alive) setToolIcons(icons); })
        .catch(() => {});
    });
    return () => {
      alive = false;
      renderer?.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, []);

  useEffect(() => {
    audio.setVolume(settings.volume);
    rendererRef.current?.setPixelRatio(pixelRatioFor(settings.quality));
    // Only on arrival: later changes go through patchSettings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererReady]);

  // A built room and a party walking the long way round it, behind the title.
  useTitleDemo(screen === "title", rendererRef, rendererReady);

  useEffect(() => {
    rendererRef.current?.setShowcase(screen === "title");
  }, [screen, rendererReady]);

  /*
   * A new run is a new object, and the same object changes in place while it
   * is played - so the room is redrawn when the object is a different one.
   *
   * This used to count runs with a setState during render, which StrictMode's
   * second render swallowed: the room kept whatever was drawn before, and a
   * run's own rock never appeared.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !run) return;
    renderer.setArena(run.stage.arena, run.entrance, run.core);
    renderer.setDug(runFloor(run));
    renderer.setRubble(run.stage.rubble ?? []);
  }, [run, rendererReady]);

  // Everything that moves, every render: the run changes in place.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !run) return;
    renderer.setUnits(runUnits(run));
    renderer.setMarkers(runMarkers(run));
    renderer.setPathPreview(run.route());
  });

  const tool = TOOLS.find((entry) => entry.id === toolId)?.tool ?? null;

  // The ghost under the cursor, its reach, and the maze it would make - only
  // while a tool is being dragged. Shown under a plain mouse, it promised a
  // click would build there, and building is a drag.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const overBuilt = !!run && !!hover && (!!run.towerAt(hover.x, hover.y) || !!run.trapAt(hover.x, hover.y));
    renderer.setHoverHighlight(!!dragging || (overBuilt && screen === "play"));
    if (!run || !tool || !dragging || !hover || overBuilt) {
      renderer.setGhost(null, true);
      renderer.setRangeRing(null);
      renderer.setPathGhost(null);
      return;
    }
    const refused = run.refusalFor(tool.kind, tool.type, hover.x, hover.y);
    const model = TOOLS.find((entry) => entry.id === toolId)?.model ?? null;
    renderer.setGhost(model, refused === null);
    renderer.setRangeRing(tool.kind === "tower" ? towerStats(tool.type, 1).range : TRAP_STATS[tool.type].range || null);
    renderer.setPathGhost(tool.kind === "tower" && refused === null ? run.routeWithTower(hover.x, hover.y) : null);
  });

  // ------------------------------------------------------------- audio

  useEffect(() => {
    const unlock = () => void audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (screen !== "play" || settings.musicVolume <= 0) {
      audio.stopMusic();
      return;
    }
    audio.setMusicLevel(settings.musicVolume);
    void audio.startMusic();
  }, [screen, settings.musicVolume]);

  const fighting = run?.status === "wave";
  useEffect(() => {
    audio.setMusicMood(fighting ? "raid" : "build");
  }, [fighting]);

  // ----------------------------------------------------------- run flow

  const beginRun = useCallback(async () => {
    const settled = await progress.startRun();
    if (settled === null) {
      audio.play("error");
      return;
    }
    setSettledNote(settled > 0 ? settled : null);
    audio.play("click");
    setResult(null);
    setSelection(null);
    setResearchOpen(false);
    setToolId("warrior");
    // A new scatter of rock and rubble every run, so no two mazes are the same.
    runner.begin(endlessStage(Math.floor(Math.random() * 2 ** 31)), effects);
    setScreen("play");
    if (!settings.introSeen) {
      setIntroOpen(true);
      patchSettings({ introSeen: true });
    }
  }, [progress, runner, effects, settings.introSeen, patchSettings]);

  /** The run is over: lives gone, or left from the home button. */
  finishRef.current = (finished: StageRun) => {
    audio.play("defeat");
    const pending: Result = { wavesCleared: finished.wavesCleared, souls: null, improved: false, saved: null };
    setResult(pending);
    void progress.finishRun(finished.wavesCleared).then((saved) => {
      setResult((current) =>
        current === pending
          ? { ...current, souls: saved?.souls ?? 0, improved: saved?.improved ?? false, saved: saved !== null }
          : current,
      );
    });
  };

  const toTitle = useCallback(() => {
    runner.end();
    setResult(null);
    setSelection(null);
    setScreen("title");
    const renderer = rendererRef.current;
    renderer?.setGhost(null, true);
    renderer?.setRangeRing(null);
    renderer?.setPathGhost(null);
    renderer?.setPathPreview(null);
  }, [runner]);

  useEffect(() => {
    if (!homeArmed) return;
    const id = window.setTimeout(() => setHomeArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [homeArmed]);

  // --------------------------------------------------------------- building

  const refuse = useCallback((reason: Refusal) => {
    audio.play("error");
    setRefusal(reason);
  }, []);

  useEffect(() => {
    if (!refusal) return;
    const id = window.setTimeout(() => setRefusal(null), REFUSAL_MS);
    return () => window.clearTimeout(id);
  }, [refusal]);

  tapRef.current = (x, y) => {
    const current = runner.run;
    if (screen !== "play" || !current || result) return;
    const tower = current.towerAt(x, y);
    if (tower) {
      audio.play("click");
      setSelection({ kind: "tower", id: tower.id });
      return;
    }
    const trap = current.trapAt(x, y);
    if (trap) {
      audio.play("click");
      setSelection({ kind: "trap", id: trap.id });
      return;
    }
    // Nothing else: building is a drag out of the panel, so a stray tap on
    // the board can no longer drop a tower somewhere nobody meant.
    if (selection) setSelection(null);
  };

  /** Puts down what was dragged, wherever the pointer let go. */
  const dropTool = (dropped: Tool, at: { x: number; y: number }) => {
    const tile = rendererRef.current?.tileAt(at.x, at.y) ?? null;
    if (!tile) return;
    const outcome =
      dropped.kind === "tower"
        ? runner.placeTower(dropped.type, tile.x, tile.y)
        : runner.placeTrap(dropped.type, tile.x, tile.y);
    if (outcome.ok) {
      audio.play("place");
      buzz(settings.haptics, BUZZ.place);
    } else {
      refuse(outcome.reason);
    }
  };

  const selectedTower = selection?.kind === "tower" ? run?.towers.find((tw) => tw.id === selection.id) : undefined;
  const selectedTrap = selection?.kind === "trap" ? run?.traps.find((tp) => tp.id === selection.id) : undefined;
  const selectedAt = selectedTower ?? selectedTrap;
  const menuAt = selectedAt ? rendererRef.current?.project(selectedAt.x, selectedAt.y) ?? null : null;

  // ------------------------------------------------------------- layout

  useEffect(() => {
    const measure = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (screen === "title") {
        const slab = document.querySelector(".title-slab");
        const titleBox = document.querySelector(".title")?.getBoundingClientRect() ?? null;
        const left = slab && titleBox ? slab.getBoundingClientRect().right - titleBox.left : 0;
        const head = document.querySelector(".title-head");
        const top = head && titleBox ? head.getBoundingClientRect().bottom - titleBox.top : 0;
        renderer.setBottomInset(0);
        renderer.setRightInset(0);
        renderer.setTopInset(Math.max(0, top));
        renderer.setLeftInset(Math.max(0, left));
        return;
      }
      const stage = document.querySelector(".app");
      const frame = stage?.getBoundingClientRect() ?? null;
      const dock = document.querySelector(".topdock");
      renderer.setLeftInset(0);
      renderer.setBottomInset(0);
      renderer.setTopInset(dock && frame ? Math.max(0, dock.getBoundingClientRect().bottom - frame.top) : 0);
      const box = hudRef.current?.getBoundingClientRect() ?? null;
      renderer.setRightInset(box && frame && box.width > 0 ? Math.max(0, frame.right - box.left) : 0);
    };
    measure();
    let pending = 0;
    const onResize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    observer?.observe(document.documentElement);
    return () => {
      cancelAnimationFrame(pending);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [screen, hudOpen, rendererReady, run]);

  // ------------------------------------------------------------- tutorial

  const teaching =
    run && !settings.tutorialDone && !result
      ? tutorialFor({
          toolId,
          towers: run.towers.length,
          wavesStarted: run.wavesStarted,
          waveCleared: run.status === "build" && run.wavesStarted > 0,
          upgraded: run.towers.some((tw) => tw.level > 1),
        })
      : null;
  const spotlight = useSpotlight(teaching?.target ?? null);

  // ------------------------------------------------------------- dev tools

  useEffect(() => {
    initAds();
  }, []);

  useEffect(() => {
    installDevTools({
      run: () => runner.run,
      stepBy: (n: number) => runner.stepBy(n),
      beginRun: () => void beginRun(),
      progress: () => progress.progress,
      renderer: () => rendererRef.current,
    });
  });

  // --------------------------------------------------------------- render

  const purse = useCountUp(run?.gold ?? 0);
  const nextWave = run ? run.waveAt(run.wavesStarted) : null;
  const stageNow = run ? stageOfWave(Math.max(0, run.wavesStarted - 1)) : 1;
  const waveInStage = run && run.wavesStarted > 0 ? ((run.wavesStarted - 1) % WAVES_PER_STAGE) + 1 : 0;
  const nextSummary = nextWave
    ? nextWave.map((g) => `${g.champion ? "♛ " : ""}${t(ADVENTURER_LABEL[g.cls])} ${g.count}`).join(" · ")
    : null;
  const enemiesIn = run ? run.enemies.length : 0;
  // Gold for calling the next wave into a room that is still busy.
  const earlyBonus = run ? run.earlyBonus() : 0;
  // The price of the selected tower's next level, as this run pays it.
  const upgradePrice =
    run && selectedTower && selectedTower.level < MAX_TOWER_LEVEL && upgradeCost(selectedTower.type, selectedTower.level) !== null
      ? run.towerPrice(selectedTower.type, selectedTower.level)
      : null;
  // The champion in the room, if one is: its health gets the top of the screen.
  const boss = run?.enemies.find((e) => e.champion) ?? null;

  const hint = refusal
    ? t(REFUSAL_TEXT[refusal])
    : adNote
    ? t(adNote)
    : tool
      ? tool.kind === "tower"
        ? t(TOWERS[tool.type].note)
        : `${t(TRAP_NOTE[tool.type])} · ${t("hint_trap_td")}`
      : "";

  const best = progress.progress.bestWaves;

  return (
    <LocaleProvider locale={settings.locale}>
      <div className={dragging ? "app dragging" : "app"}>
        <canvas ref={canvasRef} className="viewport" />

        {screen === "title" && (
          <TitleScreen
            hasProgress={best > 0}
            summary={best > 0 ? { stage: stageOfWave(best), wave: (best % WAVES_PER_STAGE) + 1, souls: progress.soulsLeft } : null}
            loading={progress.status === "connecting" || progress.status === "loading"}
            offline={progress.isOffline}
            onStart={() => void beginRun()}
            onLeaderboard={() => { audio.play("click"); setRankingOpen(true); }}
            onResearch={() => { audio.play("click"); setResearchOpen(true); }}
            onSettings={() => setSettingsOpen(true)}
            onShop={() => setShopOpen(true)}
            onGuide={() => setGuideOpen(true)}
          />
        )}

        {screen === "play" && run && (
          <>
            <div className="floaters">
              {floaters.map((f) => (
                <span key={f.id} className={`floater ${f.kind}`} style={{ left: f.x, top: f.y }}>
                  {f.text}
                </span>
              ))}
            </div>

            <div className="topdock">
              <header className="topbar">
                <div className="stats">
                  <span key={purse.beat} className={`gold ${purse.dir ?? ""}`}>
                    <img className="coin" src={coinIcon} alt="" />
                    {purse.shown}
                  </span>
                  <span className="lives">♥ {run.lives}</span>
                </div>
                <nav className="menu">
                  <button className="icon-toggle" onClick={() => { audio.play("click"); setGuideOpen(true); }} title={t("menu_guide")} aria-label={t("menu_guide")}>
                    <Icon name="help" />
                  </button>
                  <button className="icon-toggle" onClick={() => { audio.play("click"); setSettingsOpen(true); }} title={t("menu_settings")} aria-label={t("menu_settings")}>
                    <Icon name="settings" />
                  </button>
                  <button
                    className={homeArmed ? "icon-toggle armed" : "icon-toggle"}
                    onClick={() => {
                      audio.play("click");
                      if (run.wavesStarted === 0) {
                        toTitle();
                        return;
                      }
                      if (homeArmed) {
                        // Leaving ends the run where it stands, and it counts.
                        setHomeArmed(false);
                        if (run.status !== "lost") {
                          run.status = "lost";
                          finishRef.current(run);
                        }
                        return;
                      }
                      setHomeArmed(true);
                    }}
                    title={homeArmed ? t("leave_confirm") : t("menu_home")}
                    aria-label={t("menu_home")}
                  >
                    <Icon name="home" />
                  </button>
                </nav>
              </header>

              <div className="topstack">
                {boss && (
                  <div className="boss-bar" role="status">
                    <span className="boss-name">♛ {t("boss_name", { name: t(ADVENTURER_LABEL[boss.cls]) })}</span>
                    <span className="boss-track">
                      <span className="boss-fill" style={{ width: `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%` }} />
                    </span>
                    <span className="boss-hp">{Math.ceil(Math.max(0, boss.hp))} / {boss.maxHp}</span>
                  </div>
                )}
                <div className="raid-bar">
                  <span className="speeds">
                    {RUN_SPEEDS.map((s) => {
                      const locked = s === PAID_RUN_SPEED && !owns3x;
                      return (
                        <button
                          key={s}
                          className={runner.speed === s ? "active" : locked ? "locked" : ""}
                          onClick={() => {
                            if (locked) {
                              audio.play("click");
                              setShopOpen(true);
                              return;
                            }
                            runner.setSpeed(s);
                            patchSettings({ raidSpeed: s as Settings["raidSpeed"] });
                          }}
                          title={locked ? t("speed_locked") : undefined}
                        >
                          {locked && <Icon name="lock" size={10} className="lock" />}
                          {s}×
                        </button>
                      );
                    })}
                  </span>
                  <b>{t("stage_n", { n: stageNow })}</b>
                  <span>{t("wave_of", { n: waveInStage, m: WAVES_PER_STAGE })}</span>
                  {enemiesIn > 0 && <span>{t("enemies_in", { n: enemiesIn })}</span>}
                </div>
                {homeArmed && <div className="banner">{t("leave_confirm")}</div>}
                {settledNote !== null && (
                  <div className="banner">
                    <button className="banner-close" onClick={() => setSettledNote(null)} aria-label="close">×</button>
                    {t("settled_note", { n: settledNote })}
                  </div>
                )}
                {teaching && (
                  <div key={teaching.hint} className="tutorial">
                    <span className="tutorial-count">{teaching.index + 1}/{teaching.count}</span>
                    <p>
                      {t(teaching.hint)}
                      {teaching.progress ? ` (${teaching.progress.done}/${teaching.progress.of})` : ""}
                    </p>
                    <button className="icon-btn" onClick={() => patchSettings({ tutorialDone: true })} aria-label="close">×</button>
                  </div>
                )}
              </div>
            </div>

            <aside ref={hudRef} className={hudOpen ? "hud" : "hud collapsed"}>
              <div className="hud-tabs">
                <button className="active">{t("tab_build")}</button>
                <button className="hud-toggle" onClick={() => setHudOpen(!hudOpen)} aria-label="toggle">
                  <Icon name={hudOpen ? "chevronDown" : "chevronUp"} size={14} />
                </button>
              </div>
              <div className="hud-body">
                <div className="toolbar">
                  {TOOLS.map((entry) => {
                    const locked =
                      entry.tool.kind === "tower"
                        ? !effects.towers.includes(entry.tool.type)
                        : !effects.traps.includes(entry.tool.type);
                    // What it actually costs this run: a card can make it cheaper.
                    const cost = entry.tool.kind === "tower" ? (run.towerPrice(entry.tool.type) ?? 0) : run.trapPrice(entry.tool.type);
                    const label = entry.tool.kind === "tower" ? t(TOWERS[entry.tool.type].label) : t(TRAP_LABEL[entry.tool.type]);
                    const icon = toolIcons[entry.model];
                    return (
                      <button
                        key={entry.id}
                        data-tut={`tool:${entry.id}`}
                        className={toolId === entry.id ? "tool active" : "tool"}
                        disabled={locked}
                        onPointerDown={(e) => {
                          if (locked) return;
                          audio.play("click");
                          setToolId(entry.id);
                          setSelection(null);
                          beginDrag(entry.tool);
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!draggingRef.current) return;
                          // The button holds the pointer, so the board is told
                          // by hand which tile is under it.
                          const at = aimPoint(e);
                          const tile = rendererRef.current?.tileAt(at.x, at.y) ?? null;
                          rendererRef.current?.hoverTile(tile);
                          setHover(tile);
                        }}
                        onPointerUp={(e) => {
                          if (!draggingRef.current) return;
                          const dropped = draggingRef.current;
                          beginDrag(null);
                          rendererRef.current?.hoverTile(null);
                          setHover(null);
                          dropTool(dropped, aimPoint(e));
                        }}
                        onLostPointerCapture={() => {
                          // The button stopped hearing the finger: drop the drag
                          // rather than leaving a ghost on the board.
                          beginDrag(null);
                          rendererRef.current?.hoverTile(null);
                          setHover(null);
                        }}
                        onPointerCancel={() => {
                          beginDrag(null);
                          rendererRef.current?.hoverTile(null);
                          setHover(null);
                        }}
                        title={locked ? t("locked_hint") : undefined}
                      >
                        {icon && <img className="tool-icon" src={icon} alt="" />}
                        <span className="tool-text">
                          <b>{locked && <Icon name="lock" size={11} />}{label}</b>
                          <i>{cost}G</i>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className={refusal ? "hint warn" : "hint"}>{hint}</p>
                <p className="hint small">{t("hint_drag")} · {t("hint_tap_tower")}</p>
              </div>
              <div className="hud-foot">
                {adButtonShown() && adTry >= 0 && !run.adGoldClaimed && run.status !== "lost" && (
                  <button
                    className="ad-gold"
                    disabled={adShowing}
                    onClick={async () => {
                      audio.play("click");
                      setAdShowing(true);
                      const wasPaused = runner.paused;
                      runner.setPaused(true);
                      const outcome = await watchGoldAd();
                      runner.setPaused(wasPaused);
                      setAdShowing(false);
                      // Redraws the button, which the SDK may just have said
                      // this host cannot show at all.
                      setAdTry((n) => n + 1);
                      if (outcome === "rewarded" && runner.claimAdGold()) {
                        audio.play("coins");
                        float(`+${AD_GOLD}`, run.core.x, run.core.y - 1, "gold");
                        setAdNote(null);
                      } else {
                        audio.play("error");
                        setAdNote(outcome === "unavailable" ? "ad_unavailable" : "ad_skipped");
                      }
                    }}
                  >
                    <Icon name="play" size={12} />
                    {t("ad_gold", { n: AD_GOLD })}
                    <i>{t("ad_once")}</i>
                  </button>
                )}
                <button
                  className="primary go"
                  data-tut="action:wave"
                  disabled={!run.canStartWave()}
                  onClick={() => {
                    if (runner.startWave()) audio.play("raidStart");
                  }}
                >
                  <span>{run.wavesStarted === 0 ? t("first_wave") : t("next_wave")}</span>
                  {earlyBonus > 0 && <span className="go-sub early">{t("wave_early", { n: earlyBonus })}</span>}
                  {nextSummary && <span className="go-sub">{nextSummary}</span>}
                  {!nextWave && <span className="go-sub">{t("last_wave_out")}</span>}
                </button>
              </div>
            </aside>

            {selectedAt && menuAt && (
              <div className="tower-menu" style={{ left: menuAt.x, top: menuAt.y }}>
                {selectedTower ? (
                  <>
                    <b>
                      {t(TOWERS[selectedTower.type].label)} Lv{selectedTower.level}
                    </b>
                    <button
                      className="primary"
                      disabled={
                        selectedTower.level >= MAX_TOWER_LEVEL ||
                        run.gold < (upgradePrice ?? Infinity)
                      }
                      onClick={() => {
                        const outcome = runner.upgradeTower(selectedTower.id);
                        if (outcome.ok) audio.play("upgrade");
                        else refuse(outcome.reason);
                      }}
                    >
                      {selectedTower.level >= MAX_TOWER_LEVEL
                        ? t("tower_max")
                        : t("tower_upgrade", { n: upgradePrice ?? 0 })}
                    </button>
                    <button
                      onClick={() => {
                        runner.sellTower(selectedTower.id);
                        audio.play("sell");
                        setSelection(null);
                      }}
                    >
                      {t("tower_sell", { n: run.towerRefund(selectedTower.type, selectedTower.level) })}
                    </button>
                  </>
                ) : selectedTrap ? (
                  <>
                    <b>{t(TRAP_LABEL[selectedTrap.type])}</b>
                    <button
                      onClick={() => {
                        runner.sellTrap(selectedTrap.id);
                        audio.play("sell");
                        setSelection(null);
                      }}
                    >
                      {t("tower_sell", { n: Math.floor(run.trapPrice(selectedTrap.type) * 0.7) })}
                    </button>
                  </>
                ) : null}
                <button className="icon-btn" onClick={() => setSelection(null)} aria-label="close">×</button>
              </div>
            )}

            {spotlight && (
              <div
                className="spotlight"
                style={{ left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height }}
              />
            )}
          </>
        )}

        {boonOffer && run && !result && (
          <BoonDialog
            stage={boonOffer.stage}
            hand={boonOffer.hand}
            taken={run.boons.taken.map((id) => BOONS_BY_ID.get(id)!).filter(Boolean)}
            onPick={(boon) => {
              audio.play("upgrade");
              runner.takeBoon(boon);
              setBoonOffer(null);
            }}
          />
        )}

        {result && (
          <StageResultDialog
            stage={stageOfWave(result.wavesCleared)}
            wave={(result.wavesCleared % WAVES_PER_STAGE) + 1}
            wavesCleared={result.wavesCleared}
            souls={result.souls}
            improved={result.improved}
            saved={result.saved}
            onRetry={() => void beginRun()}
            onResearch={() => setResearchOpen(true)}
            onTitle={toTitle}
            nickname={progress.isOffline ? null : progress.nickname}
            onRename={progress.setNickname}
          />
        )}

        {rankingOpen && (
          <RankingDialog
            offline={progress.isOffline}
            nickname={progress.nickname}
            bestWaves={best}
            load={progress.rankings}
            onRename={progress.setNickname}
            onClose={() => setRankingOpen(false)}
          />
        )}

        {researchOpen && (
          <ResearchDialog
            owned={progress.progress.research}
            soulsLeft={progress.soulsLeft}
            onBuy={(id) => {
              void progress.research(id).then((ok) => audio.play(ok ? "place" : "error"));
            }}
            onClose={() => setResearchOpen(false)}
          />
        )}

        {shopOpen && (
          <Suspense fallback={null}>
            <ShopDialog
              entitlements={progress.entitlements}
              onPurchased={() => void progress.refreshEntitlements()}
              onClose={() => setShopOpen(false)}
            />
          </Suspense>
        )}

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
              void progress.reset();
              setSettingsOpen(false);
            }}
            resetDisabled={screen === "play"}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {introOpen && (
          <IntroDialog
            onClose={() => setIntroOpen(false)}
            onGuide={() => {
              setIntroOpen(false);
              setGuideOpen(true);
            }}
          />
        )}

        {guideOpen && <GuideDialog onClose={() => setGuideOpen(false)} />}
      </div>

      {/* Outside .app on purpose: the guard hides the stage rather than
          unmounting it, so a device tilt does not tear down the WebGL
          context. */}
      <div className="rotate-guard">
        <div className="phone" />
        <span>{translate(settings.locale, "rotate_hint")}</span>
      </div>
    </LocaleProvider>
  );
}
