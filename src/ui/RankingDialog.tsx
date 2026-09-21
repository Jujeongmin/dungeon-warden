import { useEffect, useState } from "react";
import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import type { RankRow } from "../game/td/useProgress";

interface Props {
  offline: boolean;
  nickname: string;
  /** Waves cleared by this account's best run, shown when offline too. */
  bestWaves: number;
  load: () => Promise<{ top: RankRow[]; mine: RankRow | null } | null>;
  onRename: (name: string) => Promise<boolean>;
  onClose: () => void;
}

const stageOf = (waves: number) => Math.floor(waves / 5) + 1;

/**
 * How far everyone's best run got.
 *
 * One row per player, ordered by waves cleared, which orders the stages they
 * reached. A run goes on the board by itself when it beats the player's own
 * best; the name is theirs to set here.
 */
export function RankingDialog({ offline, nickname, bestWaves, load, onRename, onClose }: Props) {
  useEscape(onClose);
  const t = useT();
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [mine, setMine] = useState<RankRow | null>(null);
  const [name, setName] = useState(nickname);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void load().then((result) => {
      if (!alive || !result) return;
      setRows(result.top);
      setMine(result.mine);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const reach = (waves: number) => t("rank_reach", { stage: stageOf(waves), wave: (waves % 5) + 1 });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ranking" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("menu_leaderboard")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <p className="modal-note">{t("rank_note")}</p>
        <p className="modal-note">
          {t("rank_mine")}: <b>{bestWaves > 0 ? reach(bestWaves) : t("rank_none")}</b>
        </p>

        {!offline && (
          <div className="rank-name">
            <input value={name} maxLength={20} placeholder={t("board_name")} onChange={(e) => setName(e.target.value)} />
            <button
              disabled={saving || name.trim() === "" || name.trim() === nickname}
              onClick={() => {
                setSaving(true);
                void onRename(name).finally(() => setSaving(false));
              }}
            >
              {t("rank_rename")}
            </button>
          </div>
        )}

        {offline ? (
          <p className="modal-note">{t("board_offline")}</p>
        ) : rows === null ? (
          <p className="modal-note">{t("board_loading")}</p>
        ) : (
          <ol className="rank-list">
            {rows.map((row, i) => (
              <li key={row.account} className={mine && row.account === mine.account ? "me" : ""}>
                <span className="rank-pos">{i + 1}</span>
                <span className="rank-name-cell">{row.nickname}</span>
                <b>{reach(row.waves)}</b>
              </li>
            ))}
            {rows.length === 0 && <li className="rank-empty">{t("rank_empty")}</li>}
          </ol>
        )}
      </div>
    </div>
  );
}
