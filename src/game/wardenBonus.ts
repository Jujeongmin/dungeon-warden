/**
 * What the warden earns for doing the fighting itself.
 *
 * Climbing into a minion costs attention in the middle of a raid and risks
 * the body outright, and until now it earned nothing a garrison left alone
 * would not have earned anyway. So an adventurer put down by a blow from the
 * body the warden is riding - and then killed or taken, not left to get up -
 * pays a little extra on top of the raid.
 *
 * A little. The raid's own payout is for the dungeon; this is for the
 * warden's hands, and it must never be worth more than building well.
 * Mirrored in server.js, which is what pays it.
 */
export const WARDEN_BONUS_PER_DOWN = 10;

/**
 * Which of the warden's downs the server should believe.
 *
 * Only adventurers that are also in the raid's reported kills or captures:
 * a down that did not end in either earned the dungeon nothing, so it earns
 * the warden nothing either. Duplicates are counted once.
 */
export function creditedDowns(wardenIds: string[], killedIds: string[], capturedIds: string[]): string[] {
  const settled = new Set([...killedIds, ...capturedIds]);
  return [...new Set(wardenIds)].filter((id) => settled.has(id));
}
