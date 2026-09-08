import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DungeonRenderer, type UnitView, type MarkerView } from "./game/DungeonRenderer";
import { useDungeonSave } from "./game/useDungeonSave";
import { useRaid, RAID_SPEEDS } from "./game/useRaid";
import { minionStatsFor } from "./game/sim/units";
import { SKILL_STATS } from "./game/sim/traps";
import { roomTiles } from "./game/rooms";
import { RESEARCH, RESEARCH_BY_ID, isAvailable } from "./game/research";
import { TUTORIAL, currentStep } from "./game/tutorial";
import { audio } from "./game/audio";
import type { SimEvent } from "./game/sim/RaidSim";
import { installDevTools } from "./game/devtools";
import { ShopDialog } from "./ui/ShopDialog";
import { LeaderboardDialog } from "./ui/LeaderboardDialog";
import {
  DIG_COST,
  MAX_ROOMS,
  MAX_TRAPS,
  MINION_COST,
  MINION_LABEL,
  ROOM_COST,
  ROOM_DESCRIPTION,
  ROOM_LABEL,
  SKILL_LABEL,
  TRAP_COST,
  TRAP_LABEL,
  type MinionType,
  type RoomType,
  type TrapType,
  type WardenSkill,
} from "./game/types";
import "./App.css";

const STATUS_LABEL: Record<string, string> = {
  connecting: "서버 연결 중",
  loading: "세이브 불러오는 중",
  ready: "저장됨",
  saving: "저장 중",
  offline: "로컬 전용 (미배포)",
  error: "오류",
};

const RAID_ERROR_LABEL: Record<string, string> = {
  NO_PATH: "입구에서 코어까지 길이 이어져야 침입이 시작됩니다.",
  NO_SAVE: "세이브를 찾을 수 없습니다.",
};

const RESEARCH_ERROR: Record<string, string> = {
  INSUFFICIENT_GOLD: "골드가 부족합니다.",
  MISSING_PREREQUISITE: "선행 연구가 필요합니다.",
  ALREADY_RESEARCHED: "이미 연구했습니다.",
};

const MS_PER_MINUTE = 60_000;

function remaining(at: number): string {
  const minutes = Math.max(0, Math.ceil((at - Date.now()) / MS_PER_MINUTE));
  return minutes <= 0 ? "곧" : `${minutes}분`;
}

type Tool =
  | { kind: "dig" }
  | { kind: "remove" }
  | { kind: "minion"; type: MinionType }
  | { kind: "trap"; type: TrapType }
  | { kind: "room"; type: RoomType };

const TOOLS: Array<{ id: string; tool: Tool; label: string; cost: number | null }> = [
  { id: "dig", tool: { kind: "dig" }, label: "굴착", cost: DIG_COST },
  { id: "remove", tool: { kind: "remove" }, label: "회수", cost: null },
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

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [showOfflineBanner, setShowOfflineBanner] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);
  const [toolId, setToolId] = useState("dig");
  const [researchError, setResearchError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("build");
  const [hudOpen, setHudOpen] = useState(true);
  const [muted, setMuted] = useState(audio.isMuted);
  const [tutorialOff, setTutorialOff] = useState(false);

  const save = useDungeonSave();
  const {
    grid,
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
    jailFree,
    weaponTiers,
    meta,
    pendingDigs,
    pendingCost,
    hasUnsaved,
    status,
    error,
    lastSavedAt,
    account,
    isOffline,
  } = save;

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
        audio.play("trap", 90);
      } else if (event.kind === "minionDown") {
        renderer.spawnRing(event.x, event.y, 0x9d8bd8);
      } else if (event.kind === "captured" || event.kind === "killed") {
        renderer.spawnRing(event.x, event.y, event.kind === "captured" ? 0x7fc98a : 0xd86a4c);
        const at = renderer.project(event.x, event.y);
        if (at) {
          floaterSeq.current += 1;
          added.push({
            id: floaterSeq.current,
            text: event.kind === "captured" ? "생포!" : "처치",
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
  }, []);

  const raid = useRaid({
    onEvents: onSimEvents,
    grid,
    meta,
    minions,
    traps,
    rooms,
    effects,
    jailFree,
    weaponTiers,
    research: unlocked,
    adsRemoved: entitlements.adsRemoved,
    onFinished: save.applyRaidResult,
  });

  const tool = TOOLS.find((t) => t.id === toolId)?.tool ?? { kind: "dig" as const };

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
    if (tool.kind === "dig") ok = save.digTile(x, y);
    else if (tool.kind === "remove") ok = save.removeAt(x, y);
    else if (tool.kind === "minion") ok = save.placeMinion(tool.type, x, y);
    else if (tool.kind === "trap") ok = save.placeTrap(tool.type, x, y);
    else ok = save.placeRoom(tool.type, x, y);

    if (!ok) audio.play("error");
    else audio.play(tool.kind === "dig" ? "dig" : "place");
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new DungeonRenderer(canvasRef.current, {
      onTileTap: (x, y) => tapRef.current(x, y),
      onHoverChange: setHover,
    });
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (grid) rendererRef.current?.setGrid(grid);
  }, [grid]);

  useEffect(() => {
    if (gridVersion > 0) rendererRef.current?.refresh();
  }, [gridVersion]);

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

  useEffect(() => {
    rendererRef.current?.setUnits(units);
  }, [units]);

  useEffect(() => {
    rendererRef.current?.setMarkers(markers);
  }, [markers]);

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
      grid, minions, traps, rooms, loot, prisoners, adventurers,
      research, unlocked, effects, jailFree, meta, gold,
      digTile: save.digTile,
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
      pathExists: raid.pathExists,
    });
  });

  const onWatchAd = useCallback(async () => {
    const result = await save.watchAdForGold();
    const message: Record<string, string> = {
      granted:
        "reward" in result
          ? `골드 ${result.reward} 지급됨${result.remaining !== undefined ? ` · 오늘 ${result.remaining}회 남음` : ""}`
          : "골드 지급됨",
      duplicate: "이미 지급된 보상입니다",
      capped: "오늘 광고 보상을 모두 받았습니다. 내일 다시 오세요.",
      dismissed: "광고를 끝까지 보지 않아 보상이 없습니다",
      pending: "검증이 지연되고 있습니다. 잠시 후 다시 시도해 주세요",
      failed: "광고를 재생할 수 없습니다",
    };
    setAdNotice(message[result.status] ?? null);
    window.setTimeout(() => setAdNotice(null), 4000);
  }, [save]);

  const stepIndex = currentStep({
    grid,
    entrance: meta?.entrance ?? null,
    core: meta?.core ?? null,
    minions,
    traps,
    hasUnsaved,
    wavesRepelled: meta?.wavesRepelled ?? 0,
    coreBreaches: meta?.coreBreaches ?? 0,
  });
  const step = tutorialOff || stepIndex >= TUTORIAL.length ? null : TUTORIAL[stepIndex];

  const toolHint = (() => {
    if (raid.pendingSkill) return `${SKILL_LABEL[raid.pendingSkill]} — 대상 타일을 선택하세요.`;
    if (tool.kind === "dig") return "암반 타일을 클릭하면 통로가 됩니다.";
    if (tool.kind === "remove") return "타일 위의 부하 · 함정 · 방을 회수합니다. 환불은 없습니다.";
    if (tool.kind === "minion") return `통로 타일에 배치합니다. ${minions.length}/${effects.minionCap}`;
    if (tool.kind === "trap") return `통로 타일에 설치합니다. ${traps.length}/${MAX_TRAPS}`;
    return `${ROOM_DESCRIPTION[tool.type]} 2×2 통로가 필요합니다. ${rooms.length}/${MAX_ROOMS}`;
  })();

  return (
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
        <div className="brand">DUNGEON WARDEN <span>M6</span></div>
        <div className="stats">
          <span className="gold">🪙 {gold}</span>
          {meta && <span className="pending">위협도 {meta.threat}</span>}
          {pendingCost > 0 && <span className="pending">미저장 -{pendingCost}</span>}
          <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>
          <button
            className="icon-toggle"
            onClick={() => { audio.setMuted(!muted); setMuted(!muted); }}
            title={muted ? "소리 켜기" : "소리 끄기"}
            aria-label={muted ? "소리 켜기" : "소리 끄기"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="shop-btn" onClick={() => { audio.play("click"); setBoardOpen(true); }}>
            순위표
          </button>
          <button className="shop-btn" onClick={() => { audio.play("click"); setShopOpen(true); }}>
            상점{entitlements.adsRemoved ? " ·광고 제거됨" : ""}
          </button>
        </div>
      </header>

      {/* One stack so banners and the tutorial never sit on top of each other,
          on any screen size. */}
      <div className="topstack">
        {isOffline && showOfflineBanner && (
          <div className="banner">
            <button className="banner-close" onClick={() => setShowOfflineBanner(false)} aria-label="닫기">×</button>
            아직 배포되지 않아 <code>VITE_AGENT8_VERSE</code>가 없습니다. 로컬 전용 모드로 실행 중이며
            <b> 진행이 저장되지 않습니다</b>. <code>npx -y @agent8/deploy</code> 실행 후 다시 열면 세이브가 붙습니다.
          </div>
        )}

        {error && <div className="banner banner-error">저장 오류: {error}</div>}
        {raid.error && (
          <div className="banner banner-error">
            {RAID_ERROR_LABEL[raid.error] ?? `침입 오류: ${raid.error}`}
          </div>
        )}

        {step && !raid.raiding && (
          <div className="tutorial">
            <div className="tutorial-head">
              <b>{stepIndex + 1}/{TUTORIAL.length} · {step.title}</b>
              <button className="icon-btn" onClick={() => setTutorialOff(true)} aria-label="튜토리얼 닫기">×</button>
            </div>
            <p>{step.body}</p>
          </div>
        )}

        {raid.raiding && raid.raidState && (
          <div className="raid-bar">
            <b>침입 중</b>
            <span>모험가 {raid.raidState.adventurers.filter((a) => a.alive).length}/{raid.raidState.adventurers.length}</span>
            <span>부하 {raid.raidState.minions.filter((m) => m.alive).length}/{raid.raidState.minions.length}</span>
            <span>함정 {raid.raidState.trapDamage}</span>
            <span>{raid.raidState.elapsed.toFixed(0)}초</span>
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
                <b>{SKILL_LABEL[skill]}</b>
                <i>{cd > 0 ? `${cd.toFixed(0)}초` : SKILL_STATS[skill].targeted ? "대상 지정" : "사용 가능"}</i>
              </button>
            );
          })}
        </div>
      )}

      {raid.result && (
        <div className="modal-backdrop" onClick={raid.dismissResult}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{raid.result.outcome === "repelled" ? "격퇴 성공" : "코어 돌파당함"}</h2>
              <button className="icon-btn" onClick={raid.dismissResult} aria-label="닫기">×</button>
            </header>
            <p className="modal-note">
              {raid.result.outcome === "repelled"
                ? "모험가들이 물러났습니다. 다음에는 더 강해져서 돌아옵니다."
                : "코어가 털렸습니다. 던전 구조와 부하는 그대로 남아 있습니다."}
            </p>
            {raid.result.capturedNames && raid.result.capturedNames.length > 0 && (
              <p className="modal-note owned">
                생포: {raid.result.capturedNames.join(", ")} — 감옥에서 전향을 기다립니다.
              </p>
            )}
            {raid.result.lootGained && raid.result.lootGained.length > 0 && (
              <p className="modal-note">
                노획: {raid.result.lootGained.map((l) => `T${l.tier} 무기`).join(", ")}
              </p>
            )}
            {raid.result.local ? (
              <p className="modal-note warn">
                로컬 전용 모드라 보상과 기록이 반영되지 않습니다. 배포 후에는
                골드·위협도·누적 전적이 서버에 저장됩니다.
              </p>
            ) : (
              <ul className="result-list">
                <li><span>보상</span><b>+{raid.result.reward}</b></li>
                {raid.result.plundered > 0 && (
                  <li><span>약탈당한 골드</span><b className="bad">-{raid.result.plundered}</b></li>
                )}
                <li><span>위협도</span><b>{raid.result.threat}</b></li>
                <li><span>누적 격퇴</span><b>{raid.result.wavesRepelled}</b></li>
                <li><span>누적 돌파</span><b>{raid.result.coreBreaches}</b></li>
              </ul>
            )}
          </div>
        </div>
      )}

      <aside className={hudOpen ? "hud" : "hud collapsed"}>
        <div className="hud-tabs">
          <button className={tab === "build" ? "active" : ""} onClick={() => { audio.play("click"); setTab("build"); }}>건설</button>
          <button className={tab === "manage" ? "active" : ""} onClick={() => { audio.play("click"); setTab("manage"); }}>관리</button>
          <button className={tab === "research" ? "active" : ""} onClick={() => { audio.play("click"); setTab("research"); }}>
            연구 {research.length}/{RESEARCH.length}
          </button>
          <button className="hud-toggle" onClick={() => setHudOpen(!hudOpen)} aria-label={hudOpen ? "접기" : "펼치기"}>
            {hudOpen ? "▾" : "▴"}
          </button>
        </div>

        <div className="hud-body">
          {tab === "build" && (
            <>
              <div className="toolbar">
                {TOOLS.map((t) => {
                  const locked =
                    (t.tool.kind === "minion" && !unlocked.unlockedMinions.includes(t.tool.type)) ||
                    (t.tool.kind === "trap" && !unlocked.unlockedTraps.includes(t.tool.type)) ||
                    (t.tool.kind === "room" && !unlocked.unlockedRooms.includes(t.tool.type));

                  return (
                    <button
                      key={t.id}
                      className={toolId === t.id ? "tool active" : "tool"}
                      onClick={() => { audio.play("click"); setToolId(t.id); }}
                      disabled={raid.raiding || locked}
                      title={locked ? "연구로 해금해야 합니다" : undefined}
                    >
                      <b>{locked ? `🔒 ${t.label}` : t.label}</b>
                      <i>{t.cost === null ? "무료" : `${t.cost}G`}</i>
                    </button>
                  );
                })}
              </div>

              <p className="hint">{toolHint}</p>
              <p className="hint small">
                부하 {minions.length}/{effects.minionCap} · 함정 {traps.length}/{MAX_TRAPS} · 방 {rooms.length}/{MAX_ROOMS}
                {effects.jailCapacity > 0 && ` · 감옥 ${prisoners.length}/${effects.jailCapacity}`}
              </p>
              <p className="hint small">드래그 팬 · 휠/핀치 줌 · Q/E 90° 회전</p>

              <div className="actions">
                <button
                  className="primary"
                  onClick={() => { audio.play("raidStart"); void raid.startRaid(); }}
                  disabled={raid.raiding || raid.starting || !raid.pathExists || hasUnsaved}
                >
                  {raid.starting ? "준비 중…" : "침입 시작"}
                </button>
              </div>
              {!raid.pathExists && <p className="hint small warn">입구에서 코어까지 길이 이어져야 합니다.</p>}
              {hasUnsaved && <p className="hint small warn">저장하지 않은 변경이 있습니다.</p>}

              <div className="actions">
                <button onClick={() => void save.saveNow()} disabled={!hasUnsaved}>지금 저장</button>
                <button className="danger" onClick={() => void save.resetGame()} disabled={raid.raiding}>
                  던전 초기화
                </button>
              </div>
              <div className="actions">
                <button onClick={() => void onWatchAd()} disabled={adBusy || isOffline || raid.raiding}>
                  {adBusy ? "광고 재생 중…" : "광고 보고 골드 +100"}
                </button>
              </div>
              {adNotice && <p className="hint small">{adNotice}</p>}

              <p className="hint small">
                {hover ? `타일 (${hover.x}, ${hover.y})` : "타일 위에 커서를 올려보세요"}
                {pendingDigs > 0 && ` · 굴착 대기 ${pendingDigs}칸`}
                {lastSavedAt && ` · 저장 ${new Date(lastSavedAt).toLocaleTimeString()}`}
              </p>
            </>
          )}

          {tab === "manage" && (
            <>
              {loot.length === 0 && prisoners.length === 0 && adventurers.length === 0 && (
                <p className="hint">아직 관리할 것이 없습니다. 침입을 한 번 막아보세요.</p>
              )}

              {loot.length > 0 && (
                <>
                  <h3 className="section">노획 장비 {loot.length}</h3>
                  {minions.map((minion) => (
                    <label key={minion.id} className="equip-row">
                      <span>
                        {MINION_LABEL[minion.type]}
                        {minion.type === "convert" && minion.level ? ` Lv${minion.level}` : ""}
                        {` (${minion.x},${minion.y})`}
                      </span>
                      <select
                        value={minion.weaponId ?? ""}
                        disabled={raid.raiding}
                        onChange={(e) => save.equipWeapon(minion.id, e.target.value || null)}
                      >
                        <option value="">없음</option>
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
                  <h3 className="section">감옥 {prisoners.length}/{effects.jailCapacity}</h3>
                  {prisoners.map((p) => (
                    <p key={p.advId} className="hint small">
                      {p.name} Lv{p.level} — 전향까지 {remaining(p.convertsAt)}
                    </p>
                  ))}
                </>
              )}

              {adventurers.length > 0 && (
                <>
                  <h3 className="section">숙적 {adventurers.filter((a) => a.state !== "converted").length}</h3>
                  {adventurers.map((a) => (
                    <p key={a.id} className="hint small">
                      {a.name} Lv{a.level} · {a.raids}회 ·{" "}
                      {a.state === "captured"
                        ? "감옥"
                        : a.state === "converted"
                          ? "전향함"
                          : a.returnsAt > Date.now()
                            ? `${remaining(a.returnsAt)} 후 재도전`
                            : "대기 중"}
                    </p>
                  ))}
                </>
              )}
            </>
          )}

          {tab === "research" && (
            <>
              {researchError && (
                <p className="hint small warn">{RESEARCH_ERROR[researchError] ?? researchError}</p>
              )}
              {RESEARCH.map((node) => {
                const owned = research.includes(node.id);
                const available = isAvailable(node, research);
                const missing = (node.requires ?? [])
                  .filter((id) => !research.includes(id))
                  .map((id) => RESEARCH_BY_ID.get(id)?.label ?? id);

                return (
                  <div key={node.id} className={owned ? "research owned" : "research"}>
                    <div className="research-head">
                      <b>{node.label}</b>
                      {owned ? (
                        <span className="ok">보유</span>
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
                    <p className="hint small">{node.note}</p>
                    {!owned && missing.length > 0 && (
                      <p className="hint small warn">선행: {missing.join(", ")}</p>
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
    </div>
  );
}
