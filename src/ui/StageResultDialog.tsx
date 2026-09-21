import { useT } from "../i18n";
import { Stars } from "./StageSelectDialog";

interface Props {
  won: boolean;
  stars: number;
  improved: boolean;
  livesLeft: number;
  lives: number;
  /** Null while the server is still deciding. */
  saved: boolean | null;
  hasNext: boolean;
  onRetry: () => void;
  onNext: () => void;
  onStages: () => void;
}

/** The end of a stage: how it went, and where to go from here. */
export function StageResultDialog({
  won, stars, improved, livesLeft, lives, saved, hasNext, onRetry, onNext, onStages,
}: Props) {
  const t = useT();

  return (
    <div className="modal-backdrop">
      <div className={won ? "modal narrow stage-result won" : "modal narrow stage-result"}>
        <header className="modal-head">
          <h2>{won ? t("stage_won") : t("stage_lost")}</h2>
        </header>

        {won && <div className="result-stars"><Stars n={stars} /></div>}
        <p className="modal-note">
          {won ? t("stage_lives_left", { n: livesLeft, m: lives }) : t("stage_lost_note")}
        </p>
        {won && improved && <p className="modal-note owned">{t("stage_new_best")}</p>}
        {saved === false && <p className="modal-note error">{t("stage_not_saved")}</p>}

        <div className="actions">
          <button onClick={onStages}>{t("stage_select")}</button>
          <button onClick={onRetry}>{t("stage_retry")}</button>
          {won && hasNext && (
            <button className="primary" onClick={onNext}>{t("stage_next")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
