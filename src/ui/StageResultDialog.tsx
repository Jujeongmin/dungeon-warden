import { useState } from "react";
import { useT } from "../i18n";

interface Props {
  stage: number;
  wave: number;
  wavesCleared: number;
  /** Souls earned; null while the server is still deciding. */
  souls: number | null;
  improved: boolean;
  saved: boolean | null;
  /** The server's reason when saving failed, shown so it can be reported. */
  failure?: string;
  /** The account's best, to say how far short a run fell. */
  bestWaves: number;
  onRetry: () => void;
  onResearch: () => void;
  onTitle: () => void;
  /**
   * The name this run goes on the board under, and how to change it - right
   * here, because a player who only finds the field in the ranking dialog
   * finds it after their run is already up there under a stranger's id.
   * Null when there is no board to be on (offline).
   */
  nickname: string | null;
  onRename: (name: string) => Promise<boolean>;
}

/** The end of a run: how far it got, what it earned, and the way back in. */
export function StageResultDialog({
  stage, wave, wavesCleared, souls, improved, saved, failure, bestWaves, onRetry, onResearch, onTitle, nickname, onRename,
}: Props) {
  const t = useT();
  const [name, setName] = useState(nickname ?? "");
  const [saving, setSaving] = useState(false);
  const [named, setNamed] = useState(false);
  const asking = nickname !== null && saved !== false && wavesCleared > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal narrow stage-result">
        <header className="modal-head">
          <h2>{t("run_over")}</h2>
        </header>

        <div className="result-reach">
          <b>{t("stage_n", { n: stage })}</b>
          <span>{t("run_wave", { n: wave })}</span>
        </div>
        <p className="modal-note">{t("run_cleared", { n: wavesCleared })}</p>
        {souls !== null && <p className="modal-note owned">{t("run_souls", { n: souls })}</p>}
        {improved && <p className="modal-note owned">{t("stage_new_best")}</p>}
        {saved === true && !improved && bestWaves > 0 && (
          <p className="modal-note">
            {t("stage_short_of_best", { stage: Math.floor(bestWaves / 5) + 1, wave: (bestWaves % 5) + 1 })}
          </p>
        )}
        {saved === false && (
          <p className="modal-note error">
            {t("stage_not_saved")}
            {failure ? ` (${failure})` : ""}
          </p>
        )}

        {asking && (
          <div className="rank-name">
            <input
              value={name}
              maxLength={20}
              placeholder={t("board_name")}
              onChange={(e) => {
                setName(e.target.value);
                setNamed(false);
              }}
            />
            <button
              disabled={saving || named || name.trim() === "" || name.trim() === nickname}
              onClick={() => {
                setSaving(true);
                void onRename(name)
                  .then((ok) => setNamed(ok))
                  .finally(() => setSaving(false));
              }}
            >
              {named ? t("rank_saved") : t("rank_rename")}
            </button>
          </div>
        )}
        {asking && <p className="modal-note small">{t("board_name_note")}</p>}

        <div className="actions">
          <button onClick={onTitle}>{t("menu_home")}</button>
          <button onClick={onResearch}>{t("tab_research")}</button>
          <button className="primary" onClick={onRetry}>{t("stage_retry")}</button>
        </div>
      </div>
    </div>
  );
}
