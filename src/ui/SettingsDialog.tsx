import { useT } from "../i18n";
import { LOCALE_LABEL, type Locale } from "../i18n/strings";
import type { Settings } from "../game/settings";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReplayTutorial: () => void;
  onResetDungeon: () => void;
  resetDisabled: boolean;
  onClose: () => void;
}

/** Derived from the table, so adding a language cannot forget the picker. */
const LOCALES = Object.keys(LOCALE_LABEL) as Locale[];

export function SettingsDialog({
  settings,
  onChange,
  onReplayTutorial,
  onResetDungeon,
  resetDisabled,
  onClose,
}: Props) {
  const t = useT();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{t("menu_settings")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="setting-row">
          <span>{t("settings_language")}</span>
          <select
            value={settings.locale}
            onChange={(e) => onChange({ locale: e.target.value as Locale })}
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>{LOCALE_LABEL[locale]}</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <span>{t("settings_sound")}</span>
          <button onClick={() => onChange({ muted: !settings.muted })}>
            {settings.muted ? t("settings_off") : t("settings_on")}
          </button>
        </div>

        {/* Separate from the sound switch above: the loop is the first thing a
            player turns off, and turning it off should not cost them the hits. */}
        <div className="setting-row">
          <span>{t("settings_music")}</span>
          <button onClick={() => onChange({ music: !settings.music })}>
            {settings.music ? t("settings_on") : t("settings_off")}
          </button>
        </div>

        <div className="setting-row">
          <span>{t("settings_quality")}</span>
          <button
            onClick={() => onChange({ quality: settings.quality === "high" ? "low" : "high" })}
          >
            {settings.quality === "high" ? t("settings_quality_high") : t("settings_quality_low")}
          </button>
        </div>
        <p className="hint small">{t("settings_quality_note")}</p>

        <div className="setting-row">
          <span>{t("settings_tutorial")}</span>
          <button onClick={onReplayTutorial}>{t("settings_replay")}</button>
        </div>

        <div className="setting-row danger-row">
          <span>{t("settings_reset")}</span>
          <button className="danger" disabled={resetDisabled} onClick={onResetDungeon}>
            {t("settings_reset_action")}
          </button>
        </div>
        <p className="hint small warn">{t("settings_reset_note")}</p>
      </div>
    </div>
  );
}
