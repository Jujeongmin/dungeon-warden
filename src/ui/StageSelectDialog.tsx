import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import { STAGES, waveSize } from "../game/td/stages";

interface Props {
  best: Record<string, number>;
  isUnlocked: (id: number) => boolean;
  starsLeft: number;
  onPick: (id: number) => void;
  onResearch: () => void;
  onClose: () => void;
}

/** Three marks, filled for each star won. */
export function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="stars" aria-label={`${n}/${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < n ? "star on" : "star"}>★</span>
      ))}
    </span>
  );
}

/**
 * The stages, in order, with the stars each has given.
 *
 * A stage opens when the one before it is won. Research sits here rather
 * than in a stage, because it is spent between runs.
 */
export function StageSelectDialog({ best, isUnlocked, starsLeft, onPick, onResearch, onClose }: Props) {
  useEscape(onClose);
  const t = useT();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stage-select" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("stage_select")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="stage-grid">
          {STAGES.map((stage) => {
            const open = isUnlocked(stage.id);
            const got = best[String(stage.id)] ?? 0;
            const enemies = stage.waves.reduce((sum, w) => sum + waveSize(w), 0);
            return (
              <button
                key={stage.id}
                className={open ? "stage-card" : "stage-card locked"}
                disabled={!open}
                onClick={() => onPick(stage.id)}
              >
                <b>{stage.id}</b>
                <Stars n={got} />
                <i>{open ? t("stage_waves", { n: stage.waves.length, m: enemies }) : t("stage_locked")}</i>
              </button>
            );
          })}
        </div>

        <div className="actions">
          <button className="primary" onClick={onResearch}>
            {t("tab_research")} · ★{starsLeft}
          </button>
        </div>
      </div>
    </div>
  );
}
