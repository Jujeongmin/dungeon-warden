import type React from "react";
import { useT } from "../i18n";
import { publicUrl } from "../game/assets/publicUrl";

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
 * Everything the player presses is down the left edge, cut into a slab of the
 * same stone the dungeon is made of; the rest of the screen is the room
 * itself, still turning, only lightly veiled.
 *
 * It used to be a centred stack of text on a flat wash - the layout every
 * menu has, which says nothing about what is behind it. The art here is not
 * drawn: it is the live scene, which is the one picture of this game that
 * cannot be faked and never repeats. The slab is a real photograph of stone
 * (the same ambientCG scan the walls use) rather than a CSS gradient
 * pretending to be one.
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
      <Embers />
      <div
        className="title-slab"
        style={{ backgroundImage: `url(${publicUrl("assets/textures/rock051_color.webp")})` }}
      >
        <div className="title-head">
          <Sigil />
          <p className="title-kicker">{t("title_kicker")}</p>
          <h1 className="title-name">
            DUNGEON
            <br />
            WARDEN
          </h1>
          <p className="title-line">{t("title_line")}</p>
        </div>

        <div className="title-foot">
          {hasProgress && summary && (
            <dl className="title-save">
              <div>
                <dt>{t("stat_threat")}</dt>
                <dd>{summary.threat}</dd>
              </div>
              <div>
                <dt>{t("board_repelled")}</dt>
                <dd>{summary.wavesRepelled}</dd>
              </div>
              <div>
                <dt>{t("board_breaches")}</dt>
                <dd>{summary.coreBreaches}</dd>
              </div>
            </dl>
          )}

          <div className="title-actions">
            <button className="title-start" onClick={onStart} disabled={loading}>
              {loading ? t("title_loading") : hasProgress ? t("title_continue") : t("title_start")}
            </button>

            <div className="title-menu">
              <button onClick={onLeaderboard}>{t("menu_leaderboard")}</button>
              <button onClick={onShop}>{t("menu_shop")}</button>
              <button onClick={onSettings}>{t("menu_settings")}</button>
            </div>

            {offline && <p className="title-note">{t("title_offline")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sparks drifting up out of the dungeon.
 *
 * Placed from a fixed sequence rather than Math.random, so the screen is the
 * same on every visit and nothing jumps on a re-render. Pure CSS: see
 * .title-embers. Hidden for players who ask for reduced motion.
 */
const EMBERS = Array.from({ length: 22 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    x: `${38 + r(1) * 60}%`,
    size: `${2 + r(2) * 3.5}px`,
    duration: `${7 + r(3) * 8}s`,
    delay: `${-r(4) * 15}s`,
    drift: `${(r(5) - 0.5) * 80}px`,
  };
});

function Embers() {
  return (
    <div className="title-embers" aria-hidden="true">
      {EMBERS.map((ember, i) => (
        <span
          key={i}
          style={
            {
              "--x": ember.x,
              "--s": ember.size,
              "--d": ember.duration,
              "--delay": ember.delay,
              "--drift": ember.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * A corridor folded back on itself, which is the whole game in one stroke.
 *
 * Drawn rather than picked off a sheet: it is the shape the player is about to
 * dig, ending at the square the party is walking towards.
 */
function Sigil() {
  return (
    <svg className="title-sigil" viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M20 2 V12 H8 V22 H24 V30 H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
      <rect x="10" y="26" width="8" height="8" fill="currentColor" />
    </svg>
  );
}
