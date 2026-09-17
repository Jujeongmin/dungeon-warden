import { useState } from "react";
import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import { GUIDE, type GuideSection } from "../game/guide";

interface Props {
  onClose: () => void;
}

/** `**lead** rest`: the lead is set in bold, so a line can be skimmed by it. */
function Line({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/);
  return (
    <li>
      {parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))}
    </li>
  );
}

/**
 * How the game works, section by section.
 *
 * Tabs rather than one long page: on a phone held sideways the dialog is a
 * few lines tall, and a tab keeps each topic on one screen. Everything is a
 * tap - nothing here waits for a hover a phone cannot do.
 */
export function GuideDialog({ onClose }: Props) {
  useEscape(onClose);
  const t = useT();
  const [tab, setTab] = useState<GuideSection>("basics");
  const section = GUIDE.find((s) => s.id === tab) ?? GUIDE[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("menu_guide")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="hud-tabs guide-tabs" role="tablist">
          {GUIDE.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={tab === s.id}
              className={tab === s.id ? "active" : ""}
              onClick={() => setTab(s.id)}
            >
              {t(s.title)}
            </button>
          ))}
        </div>

        <ul className="guide-list">
          {section.lines.map((line) => (
            <Line key={line.key} text={t(line.key, line.vars)} />
          ))}
        </ul>
      </div>
    </div>
  );
}
