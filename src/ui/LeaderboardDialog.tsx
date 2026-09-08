import { useCallback, useEffect, useState } from "react";
import { useGameServer } from "@agent8/gameserver";

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
          <h2>순위표</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </header>

        {!HAS_VERSE ? (
          <p className="modal-note">
            배포 후에 순위표가 활성화됩니다. <code>npx -y @agent8/deploy</code>
          </p>
        ) : (
          <>
            <p className="modal-note">
              한 판 기록이 아니라 <b>누적 격퇴 횟수</b> 순위입니다. 등록은 선택이며,
              등록하지 않아도 게임 진행에는 영향이 없습니다.
            </p>

            <div className="rank-submit">
              <input
                value={nickname}
                maxLength={20}
                placeholder="표시할 이름"
                onChange={(e) => setNickname(e.target.value)}
              />
              <button onClick={() => void submit()} disabled={status === "saving"}>
                {mine ? "갱신" : "등록"}
              </button>
            </div>

            {error && <p className="modal-note error">{error}</p>}
            {status === "loading" && <p className="modal-note">불러오는 중…</p>}

            <table className="rank-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>이름</th>
                  <th>격퇴</th>
                  <th>돌파</th>
                  <th>위협도</th>
                  <th>전향</th>
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
                  <tr><td colSpan={6}>아직 등록된 던전이 없습니다.</td></tr>
                )}
              </tbody>
            </table>

            {mine && !rows.some((row) => row.account === mine.account) && (
              <p className="modal-note owned">
                내 기록 — 격퇴 {mine.wavesRepelled} · 돌파 {mine.coreBreaches} · 위협도 {mine.threat}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
