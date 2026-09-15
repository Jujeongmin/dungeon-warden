import { useCallback, useEffect, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { useT } from "../i18n";
import { useEscape } from "./useEscape";
import { ADVENTURER_LABEL, type PartyMember } from "../game/types";
import { DAY_MS, dailyDay, dailyWaves } from "../game/daily";

interface Row {
  account: string;
  nickname: string;
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
  converts: number;
}

interface DailyRow {
  account: string;
  nickname: string;
  score: number;
  kills: number;
  outcome: string;
}

interface DailyBoard {
  top: DailyRow[];
  mine: DailyRow | null;
  attempted: boolean;
  waves: PartyMember[][];
}

interface Props {
  account?: string;
  /** Whether a raid can be opened from here right now. */
  canStartDaily: boolean;
  onStartDaily: (nickname: string) => void;
  onClose: () => void;
}

const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);
const NICKNAME_KEY = "dw.nickname";

/** Today's party from the day's number alone, for when the server has not answered. */
function localDaily(): DailyBoard {
  const day = dailyDay(Date.now());
  return { top: [], mine: null, attempted: false, waves: dailyWaves(day) };
}

/**
 * Two boards.
 *
 * The first is cumulative standings - waves repelled, not a single run's
 * score - because a save-based game should not be turned into a run chaser by
 * its own leaderboard, and entering it is optional.
 *
 * The second is today's raid: the same party for everyone, one attempt, a
 * board that lasts the day. It is the one reason to come back tomorrow that
 * does not ask the player to have played for a month first.
 */
export function LeaderboardDialog({ account, canStartDaily, onStartDaily, onClose }: Props) {
  useEscape(onClose);
  const t = useT();
  const { server } = useGameServer();

  const [tab, setTab] = useState<"total" | "daily">("total");
  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<Row | null>(null);
  const [daily, setDaily] = useState<DailyBoard | null>(null);
  /** The server could not be asked about today, so today cannot be started from here. */
  const [dailyUnavailable, setDailyUnavailable] = useState(false);
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setNickname(localStorage.getItem(NICKNAME_KEY) ?? "");
    } catch {
      /* no stored nickname */
    }
  }, []);

  const rememberNickname = useCallback(() => {
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch {
      /* remembering the nickname is a convenience, not a requirement */
    }
  }, [nickname]);

  const refresh = useCallback(async () => {
    if (!HAS_VERSE) return;
    setStatus("loading");
    try {
      const result: { top: Row[]; mine: Row | null } = await server.remoteFunction(
        "getRankings",
        [{ limit: 20 }],
      );
      setRows(result.top ?? []);
      setMine(result.mine ?? null);
      setStatus("idle");
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [server]);

  const refreshDaily = useCallback(async () => {
    if (!HAS_VERSE) {
      setDaily(localDaily());
      return;
    }
    setStatus("loading");
    try {
      const result: DailyBoard = await server.remoteFunction("getDailyRankings", [{ limit: 20 }]);
      setDailyUnavailable(false);
      setDaily({
        top: result.top ?? [],
        mine: result.mine ?? null,
        attempted: Boolean(result.attempted),
        waves: result.waves ?? localDaily().waves,
      });
      setStatus("idle");
      setError(null);
    } catch (e: unknown) {
      // The party is still worth showing: it follows from the day alone. The
      // reason is not - a server message is not a sentence a player can use.
      console.warn("getDailyRankings failed", e);
      setDaily(localDaily());
      setDailyUnavailable(true);
      setStatus("idle");
    }
  }, [server]);

  useEffect(() => {
    if (tab === "total") void refresh();
    else void refreshDaily();
  }, [tab, refresh, refreshDaily]);

  const submit = useCallback(async () => {
    if (!HAS_VERSE) return;
    setStatus("saving");
    try {
      rememberNickname();
      await server.remoteFunction("submitScore", [{ nickname }]);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [server, nickname, refresh, rememberNickname]);

  const name = nickname.trim();
  const hoursLeft = Math.max(1, Math.ceil(((dailyDay(Date.now()) + 1) * DAY_MS - Date.now()) / 3_600_000));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("board_title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="hud-tabs board-tabs">
          <button className={tab === "total" ? "active" : ""} onClick={() => setTab("total")}>
            {t("board_tab_total")}
          </button>
          <button className={tab === "daily" ? "active" : ""} onClick={() => setTab("daily")}>
            {t("daily_title")}
          </button>
        </div>

        {error && <p className="modal-note error">{error}</p>}
        {status === "loading" && <p className="modal-note">{t("board_loading")}</p>}

        {tab === "total" &&
          (!HAS_VERSE ? (
            <p className="modal-note">{t("board_offline")}</p>
          ) : (
            <>
              <p className="modal-note">{t("board_note")}</p>

              <div className="rank-submit">
                <input
                  value={nickname}
                  maxLength={20}
                  placeholder={t("board_name")}
                  onChange={(e) => setNickname(e.target.value)}
                />
                <button onClick={() => void submit()} disabled={status === "saving"}>
                  {mine ? t("board_update") : t("board_submit")}
                </button>
              </div>

              <table className="rank-table">
                <thead>
                  <tr>
                    <th>{t("board_rank")}</th>
                    <th>{t("board_player")}</th>
                    <th>{t("board_repelled")}</th>
                    <th>{t("board_breaches")}</th>
                    <th>{t("stat_threat")}</th>
                    <th>{t("board_converts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.account} className={row.account === account ? "me" : ""}>
                      <td>{index + 1}</td>
                      <td>{row.nickname}</td>
                      <td>{row.wavesRepelled}</td>
                      <td>{row.coreBreaches}</td>
                      <td>{row.threat}</td>
                      <td>{row.converts}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && status === "idle" && (
                    <tr><td colSpan={6}>{t("board_empty")}</td></tr>
                  )}
                </tbody>
              </table>

              {mine && !rows.some((row) => row.account === mine.account) && (
                <p className="modal-note owned">
                  {t("board_mine")} — {t("board_repelled")} {mine.wavesRepelled} · {t("board_breaches")} {mine.coreBreaches}
                </p>
              )}
            </>
          ))}

        {tab === "daily" && daily && (
          <>
            <p className="modal-note">{t("daily_note")}</p>

            <h3 className="section">
              {t("daily_party")} · {t("daily_resets", { n: hoursLeft })}
            </h3>
            <div className="daily-waves">
              {daily.waves.map((wave, w) => (
                <div key={w} className="daily-wave">
                  <b>{t("raid_wave", { n: w + 1, of: daily.waves.length })}</b>
                  {wave.map((member) => (
                    <span key={member.id} className={member.champion ? "chip champion" : "chip"}>
                      {t(ADVENTURER_LABEL[member.cls])} Lv{member.level}
                    </span>
                  ))}
                </div>
              ))}
            </div>

            <div className="rank-submit">
              <input
                value={nickname}
                maxLength={20}
                placeholder={t("board_name")}
                onChange={(e) => setNickname(e.target.value)}
              />
              <button
                className="primary"
                disabled={!canStartDaily || daily.attempted || !name || dailyUnavailable}
                onClick={() => {
                  rememberNickname();
                  onStartDaily(name);
                }}
              >
                {daily.attempted ? t("daily_done") : t("daily_try")}
              </button>
            </div>
            {dailyUnavailable && <p className="modal-note warn">{t("daily_unavailable")}</p>}
            {!name && !daily.attempted && !dailyUnavailable && (
              <p className="hint small">{t("daily_need_name")}</p>
            )}

            <table className="rank-table">
              <thead>
                <tr>
                  <th>{t("board_rank")}</th>
                  <th>{t("board_player")}</th>
                  <th>{t("daily_score")}</th>
                  <th>{t("daily_kills")}</th>
                </tr>
              </thead>
              <tbody>
                {daily.top.map((row, index) => (
                  <tr key={row.account} className={row.account === account ? "me" : ""}>
                    <td>{index + 1}</td>
                    <td>{row.nickname}</td>
                    <td>{row.score}</td>
                    <td>{row.kills}</td>
                  </tr>
                ))}
                {daily.top.length === 0 && status !== "loading" && (
                  <tr><td colSpan={4}>{t("board_empty")}</td></tr>
                )}
              </tbody>
            </table>

            {daily.mine && !daily.top.some((row) => row.account === daily.mine?.account) && (
              <p className="modal-note owned">
                {t("daily_mine")} — {daily.mine.score}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
