import { useT } from "../i18n";

interface Props {
  stage: number;
  wave: number;
  wavesCleared: number;
  /** Souls earned; null while the server is still deciding. */
  souls: number | null;
  improved: boolean;
  saved: boolean | null;
  onRetry: () => void;
  onResearch: () => void;
  onTitle: () => void;
}

/** The end of a run: how far it got, what it earned, and the way back in. */
export function StageResultDialog({
  stage, wave, wavesCleared, souls, improved, saved, onRetry, onResearch, onTitle,
}: Props) {
  const t = useT();

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
        {saved === false && <p className="modal-note error">{t("stage_not_saved")}</p>}

        <div className="actions">
          <button onClick={onTitle}>{t("menu_home")}</button>
          <button onClick={onResearch}>{t("tab_research")}</button>
          <button className="primary" onClick={onRetry}>{t("stage_retry")}</button>
        </div>
      </div>
    </div>
  );
}
