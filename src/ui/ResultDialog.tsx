import { useEscape } from "./useEscape";
import { useT } from "../i18n";
import { useCountUp } from "./useCountUp";
import type { RaidFinishResult } from "../game/types";

interface Props {
  result: RaidFinishResult;
  onClose: () => void;
}

/**
 * What the wave was worth.
 *
 * This is the only screen in the game that exists purely to be read, and it
 * used to be a heading and five identical rows — the reward, the number the
 * whole raid was for, was set in the same 13px bold as the lifetime breach
 * count next to it. A settlement screen that flattens its own payout tells the
 * player nothing about whether the last two minutes went well.
 *
 * So there is a verdict, then one number: the gold, large, counting up from
 * nothing so it arrives rather than appears. Everything else is a footnote to
 * it, and the running totals come in underneath a beat later.
 */
export function ResultDialog({ result, onClose }: Props) {
  useEscape(onClose);
  const t = useT();
  const repelled = result.outcome === "repelled";
  // Only the payout counts up. A running total that ticks would be four
  // numbers competing for the same attention.
  const reward = useCountUp(result.local ? 0 : result.reward, 620);

  const captured = result.capturedNames ?? [];
  const loot = result.lootGained ?? [];

  const totals: Array<{ label: string; value: number }> = result.local
    ? []
    : [
        { label: t("stat_threat"), value: result.threat },
        { label: t("result_waves"), value: result.wavesRepelled },
        { label: t("result_breaches"), value: result.coreBreaches },
      ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal narrow result ${repelled ? "won" : "lost"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="verdict">
          <b>{repelled ? t("result_repelled") : t("result_breached")}</b>
          <p>{repelled ? t("result_repelled_note") : t("result_breached_note")}</p>
        </div>

        {result.local ? (
          <p className="modal-note warn">{t("result_local")}</p>
        ) : (
          <div className="payout">
            <b>
              <i>+</i>
              {reward.shown}
            </b>
            {result.plundered > 0 && (
              <span className="taken">
                {t("result_plundered")} −{result.plundered}
              </span>
            )}
            {/* Said as relief rather than folded silently into the number, so
                a player who lost does not read it as having won something. */}
            {(result.relief ?? 0) > 0 && (
              <span className="relief">
                {t("result_relief")} +{result.relief}
              </span>
            )}
          </div>
        )}

        {(captured.length > 0 || loot.length > 0 || result.championStopped || (result.wardenDowns ?? 0) > 0) && (
          <div className="spoils">
            {/* First in the row: it is the biggest single thing that can
                happen in a raid, and it carries its own bounty. */}
            {result.championStopped && (
              <span className="chip champion">{t("result_champion")}</span>
            )}
            {/* Second: the other thing in this row that was the player's own
                doing rather than the dungeon's. */}
            {(result.wardenDowns ?? 0) > 0 && (
              <span className="chip warden">
                {t("result_warden")} ×{result.wardenDowns} · +{result.wardenBonus ?? 0}
              </span>
            )}
            {captured.map((name) => (
              <span key={`c-${name}`} className="chip captured">
                {t("result_captured")} · {name}
              </span>
            ))}
            {loot.map((item, i) => (
              <span key={`l-${i}`} className="chip">
                {t("result_loot")} · T{item.tier} {t("weapon")}
              </span>
            ))}
          </div>
        )}

        {totals.length > 0 && (
          <ul className="result-list">
            {totals.map((row, i) => (
              // The stagger is an index, not a clock: each row is one beat
              // later than the one above it, so the block reads downwards.
              <li key={row.label} style={{ animationDelay: `${120 + i * 70}ms` }}>
                <span>{row.label}</span>
                <b>{row.value}</b>
              </li>
            ))}
          </ul>
        )}

        <div className="actions">
          <button className="primary" onClick={onClose}>
            {t("result_continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
