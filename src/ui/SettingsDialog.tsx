import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import { LOCALE_LABEL, type Locale } from "../i18n/strings";
import type { Settings } from "../game/settings";
import type { Entitlements } from "../game/types";
import { WARDEN_SKINS, skinUnlocked } from "../game/skins";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReplayTutorial: () => void;
  onResetDungeon: () => void;
  resetDisabled: boolean;
  /** Which warden skins are unlocked follows from these. */
  wardenLevel: number;
  entitlements: Entitlements;
  onClose: () => void;
}

/** Derived from the table, so adding a language cannot forget the picker. */
const LOCALES = Object.keys(LOCALE_LABEL) as Locale[];

/** A slider with the level beside it, so the position has a number. */
function Fader({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="fader">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <b>{Math.round(value * 100)}</b>
    </span>
  );
}

export function SettingsDialog({
  settings,
  onChange,
  onReplayTutorial,
  onResetDungeon,
  resetDisabled,
  wardenLevel,
  entitlements,
  onClose,
}: Props) {
  useEscape(onClose);
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

        {/*
          * Faders, not switches.
          *
          * Off was the only way down, so a player who wanted the game quieter
          * had to choose between full volume and silence. They are separate
          * because the loop is the first thing turned down and turning it down
          * should not cost the hits.
          */}
        <div className="setting-row">
          <span>{t("settings_sound")}</span>
          <Fader value={settings.volume} onChange={(volume) => onChange({ volume })} />
        </div>

        <div className="setting-row">
          <span>{t("settings_music")}</span>
          <Fader
            value={settings.musicVolume}
            onChange={(musicVolume) => onChange({ musicVolume })}
          />
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

        {/* Felt rather than heard, so it gets its own switch: a player who
            turns the sound down on a bus may still want the buzz, and one
            holding the phone on a table may want neither. */}
        <div className="setting-row">
          <span>{t("settings_haptics")}</span>
          <button onClick={() => onChange({ haptics: !settings.haptics })}>
            {settings.haptics ? t("settings_haptics_on") : t("settings_haptics_off")}
          </button>
        </div>

        {/* How the warden looks. A locked skin stays in the row and says what
            opens it, so the reward is known before it is earned. */}
        <div className="setting-row skin-row">
          <span>{t("settings_skin")}</span>
          <span className="skin-picks">
            {WARDEN_SKINS.map((skin) => {
              const open = skinUnlocked(skin, wardenLevel, entitlements);
              const lock =
                skin.unlock.kind === "level"
                  ? t("skin_locked_level", { n: skin.unlock.level })
                  : t("skin_locked_shop");
              return (
                <button
                  key={skin.id}
                  className={settings.wardenSkin === skin.id ? "active" : ""}
                  disabled={!open}
                  onClick={() => onChange({ wardenSkin: skin.id })}
                >
                  {t(skin.label)}
                  {!open && <small>{lock}</small>}
                </button>
              );
            })}
          </span>
        </div>

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
