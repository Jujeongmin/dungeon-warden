import { useEscape } from "./useEscape";
import { useT } from "../i18n";

interface Props {
  onClose: () => void;
  onGuide: () => void;
}

/**
 * Shown once, before the first dungeon.
 *
 * The premise is a reversal, and a player dropped onto a grid of rock has no
 * way to guess it. Everything else — folding the route, traps, minions — is
 * shown by the build panel and the path preview, so this only has to land
 * the reversal: two short lines, not an explanation of how to play.
 */
export function IntroDialog({ onClose, onGuide }: Props) {
  useEscape(onClose);
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
        </ol>

        <div className="actions">
          <button onClick={onGuide}>{t("menu_guide")}</button>
          <button className="primary" onClick={onClose}>{t("intro_go")}</button>
        </div>
      </div>
    </div>
  );
}
