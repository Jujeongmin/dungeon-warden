import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import { RESEARCH, RESEARCH_BY_ID, canResearch } from "../game/td/research";

interface Props {
  owned: string[];
  starsLeft: number;
  onBuy: (id: string) => void;
  onClose: () => void;
}

/** Everything stars can buy, and what each needs first. */
export function ResearchDialog({ owned, starsLeft, onBuy, onClose }: Props) {
  useEscape(onClose);
  const t = useT();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal research-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("tab_research")}</h2>
          <span className="research-stars">★ {starsLeft}</span>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>
        <p className="modal-note">{t("research_note")}</p>

        <ul className="research-list">
          {RESEARCH.map((node) => {
            const has = owned.includes(node.id);
            const open = canResearch(node, owned);
            const needs = (node.requires ?? [])
              .filter((id) => !owned.includes(id))
              .map((id) => t(RESEARCH_BY_ID.get(id)!.label));
            return (
              <li key={node.id} className={has ? "owned" : open ? "" : "locked"}>
                <div>
                  <b>{t(node.label)}</b>
                  <i>{needs.length > 0 ? t("research_needs", { list: needs.join(", ") }) : t(node.note)}</i>
                </div>
                <button
                  disabled={has || !open || starsLeft < node.cost}
                  onClick={() => onBuy(node.id)}
                >
                  {has ? t("research_owned") : `★ ${node.cost}`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
