import { useCallback, useEffect, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { useT } from "../i18n";

interface Row {
  account: string;
  nickname: string;
  threat: number;
  wavesRepelled: number;
  coreBreaches: number;
  converts: number;
}

interface Props {
  account?: string;
  onClose: () => void;
}

const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);
const NICKNAME_KEY = "dw.nickname";

/**
 * Cumulative standings — waves repelled, not a single run's score.
 *
 * A save-based game should not be turned into a run chaser by its own
 * leaderboard, so the board ranks how far a dungeon has got overall and
 * entering is optional.
 */
export function LeaderboardDialog({ account, onClose }: Props) {
  const t = useT();
  const { server } = useGameServer();

  const [rows, setRows] = useState<Row[]>([]);
  const [mine, setMine] = useState<Row | null>(null);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    if (!HAS_VERSE) return;
    setStatus("saving");
    try {
      try {
        localStorage.setItem(NICKNAME_KEY, nickname);
      } catch {
        /* remembering the nickname is a convenience, not a requirement */
      }
      await server.remoteFunction("submitScore", [{ nickname }]);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [server, nickname, refresh]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("board_title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        {!HAS_VERSE ? (
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

            {error && <p className="modal-note error">{error}</p>}
            {status === "loading" && <p className="modal-note">{t("board_loading")}</p>}

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
        )}
      </div>
    </div>
  );
}
