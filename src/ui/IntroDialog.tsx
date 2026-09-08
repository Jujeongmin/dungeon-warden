import { useT } from "../i18n";

interface Props {
  onClose: () => void;
}

/**
 * Shown once, before the first dungeon.
 *
 * The premise is a reversal, and a player dropped onto a grid of rock has no
 * way to guess it. Three lines is enough to make the first ten minutes make
 * sense; the step hints handle the rest.
 */
export function IntroDialog({ onClose }: Props) {
  const t = useT();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("intro_title")}</h2>
        </header>

        <ol className="intro-list">
          <li><b>{t("intro_1_b")}</b> {t("intro_1")}</li>
          <li><b>{t("intro_2_b")}</b> {t("intro_2")}</li>
          <li><b>{t("intro_3_b")}</b> {t("intro_3")}</li>
        </ol>

        <p className="modal-note">{t("intro_note")}</p>

        <div className="actions">
          <button className="primary" onClick={onClose}>{t("intro_go")}</button>
        </div>
      </div>
    </div>
  );
}
