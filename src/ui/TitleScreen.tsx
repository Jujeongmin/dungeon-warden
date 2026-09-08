import { useT } from "../i18n";

interface Props {
  /** True when the dungeon has already been played. */
  hasProgress: boolean;
  /** Dungeon summary shown on the continue card. */
  summary: { threat: number; wavesRepelled: number; coreBreaches: number } | null;
  loading: boolean;
  offline: boolean;
  onStart: () => void;
  onSettings: () => void;
  onLeaderboard: () => void;
  onShop: () => void;
}

/**
 * The front door.
 *
 * The game used to drop the player straight onto a grid of rock with no idea
 * what they were looking at. This says what the game is in one line before
 * anything else happens, and gives returning players their dungeon's standing
 * before they commit to a session.
 */
export function TitleScreen({
  hasProgress,
  summary,
  loading,
  offline,
  onStart,
  onSettings,
  onLeaderboard,
  onShop,
}: Props) {
  const t = useT();

  return (
    <div className="title">
      <div className="title-inner">
        <p className="title-kicker">{t("title_kicker")}</p>
        <h1 className="title-name">DUNGEON WARDEN</h1>
        <p className="title-line">{t("title_line")}</p>

        {hasProgress && summary && (
          <div className="title-save">
            <span>{t("stat_threat")} {summary.threat}</span>
            <span>{t("board_repelled")} {summary.wavesRepelled}</span>
            <span>{t("board_breaches")} {summary.coreBreaches}</span>
          </div>
        )}

        <button className="title-start" onClick={onStart} disabled={loading}>
          {loading ? t("title_loading") : hasProgress ? t("title_continue") : t("title_start")}
        </button>

        <div className="title-menu">
          <button onClick={onSettings}>{t("menu_settings")}</button>
          <button onClick={onLeaderboard}>{t("menu_leaderboard")}</button>
          <button onClick={onShop}>{t("menu_shop")}</button>
        </div>

        {offline && <p className="title-note">{t("title_offline")}</p>}
      </div>
    </div>
  );
}
