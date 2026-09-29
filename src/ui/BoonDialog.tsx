import { useT } from "../i18n";
import { publicUrl } from "../game/assets/publicUrl";
import type { Boon } from "../game/td/boons";

interface Props {
  /** The stage just cleared, for the heading. */
  stage: number;
  hand: Boon[];
  /** What this run has taken already, oldest first. */
  taken: Boon[];
  onPick: (boon: Boon) => void;
}

/**
 * The three cards a cleared stage deals.
 *
 * The run waits here: it is the one moment a run turns into a particular run
 * rather than the same one again, and it should not be spent watching the
 * next wave walk in. No card is rarer than another and none is ever bought -
 * see boons.ts.
 */
export function BoonDialog({ stage, hand, taken, onPick }: Props) {
  const t = useT();

  return (
    <div className="modal-backdrop">
      <div className="modal boons">
        <header className="modal-head">
          <h2>{t("boon_title", { n: stage })}</h2>
        </header>
        <p className="modal-note">{t("boon_note")}</p>

        <div className="boon-hand">
          {hand.map((boon) => (
            <button key={boon.id} className="boon-card" onClick={() => onPick(boon)}>
              <img src={publicUrl(`assets/boons/${boon.icon}`)} alt="" />
              <b>{t(boon.label)}</b>
              <span>{t(boon.note)}</span>
            </button>
          ))}
        </div>

        {taken.length > 0 && (
          <p className="modal-note small">
            {t("boon_taken")}: {taken.map((boon) => t(boon.label)).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
