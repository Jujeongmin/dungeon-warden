import { useT } from "../i18n";
import { ADVENTURER_LABEL } from "../game/types";
import type { PartyPreviewMember } from "../game/party";
import type { StringKey } from "../i18n/strings";

interface Props {
  party: PartyPreviewMember[];
  /** Baked model photographs, keyed `a_<class>`. Empty until the pack loads. */
  icons: Record<string, string>;
}

/**
 * Who is about to walk in.
 *
 * The roster was the most interesting system in the game and the least
 * visible one. Adventurers are named, they persist, and every time they beat
 * you they come back a level stronger — and all of that was discoverable only
 * from a list in a management panel, after the fact. "Start raid" was a button
 * labelled "surprise".
 *
 * What this shows is deliberately less than what it knows. Five names and five
 * class labels is a paragraph above the one button that matters, and a
 * paragraph is exactly what this game must not have. So: photographs of the
 * actual models, a level on each, and words only for the champion — one name,
 * for the one figure worth naming. Everything else is in the picture: the
 * bigger portrait leads, the marked ones have been here before.
 */
export function PartyPreview({ party, icons }: Props) {
  const t = useT();
  if (party.length === 0) return null;

  return (
    <div className="party-preview">
      {party.map((member) => {
        const cls = t(ADVENTURER_LABEL[member.cls] as StringKey);
        const icon = icons[`a_${member.cls}`];
        return (
          <div
            key={member.id}
            className={`face${member.champion ? " champion" : ""}${member.raids > 0 ? " veteran" : ""}`}
            // The full sentence lives here rather than on screen: a player who
            // wants to know who this is can ask, and everyone else gets a row
            // of faces instead of a briefing.
            title={`${member.name} · ${cls} · ${t("party_level")} ${member.level}`}
          >
            {icon ? (
              <img src={icon} alt="" />
            ) : (
              // The pack has not loaded, or the device refused the second GL
              // context that bakes these. A letter still tells five figures
              // apart, which is all this row has to do.
              <span className="letter">{cls.slice(0, 1)}</span>
            )}
            <b className="lv">{member.level}</b>
          </div>
        );
      })}

      {/* The only text in the row, and only when there is a leader to name. */}
      {party.find((m) => m.champion) && (
        <span className="lead">{party.find((m) => m.champion)!.name}</span>
      )}
    </div>
  );
}
