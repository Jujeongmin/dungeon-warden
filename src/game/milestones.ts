/**
 * Names for how far the dungeon has come.
 *
 * There are no stages in this game and no last wave — the only measure of
 * progress is a threat number, and a number is a poor thing to be proud of.
 * These put a name on it at the points where the raids actually change shape,
 * so "위협도 9" becomes "a full company is coming".
 *
 * The thresholds are not decoration. They are where `pickParty` on the server
 * changes what it sends: a second adventurer at 3, a fourth at 9, and past 12
 * the party stops growing and only levels rise, which is a different kind of
 * game and deserves saying out loud.
 *
 * Mirrored in server.js. The server decides when one is first crossed; this
 * copy is what lets the HUD label a threat without asking.
 */

export interface Milestone {
  /** Threat at which it starts applying. */
  threat: number;
  /** Translation key for the name. */
  label: string;
}

export const MILESTONES: Milestone[] = [
  { threat: 3, label: "tier_scouts" },
  { threat: 9, label: "tier_company" },
  { threat: 20, label: "tier_crusade" },
];

/** The tier a dungeon is currently in, or null before the first one. */
export function tierFor(threat: number): Milestone | null {
  let found: Milestone | null = null;
  for (const milestone of MILESTONES) {
    if (threat >= milestone.threat) found = milestone;
  }
  return found;
}
