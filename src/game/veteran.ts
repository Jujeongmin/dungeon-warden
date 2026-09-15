/**
 * Minions that have lived through raids.
 *
 * An adventurer who dies comes back a level stronger; a minion that held its
 * post through a raid came back exactly as it went in. Now the server counts
 * the raids each one survived, and a few of them earn it a star: harder to
 * put down, and nothing else.
 *
 * Only hit points, on purpose. Damage in the simulation is a whole number, and
 * a few percent of a warrior's ten is a bonus that rounds away to nothing. And
 * only a little: three stars on one minion is less than the second tier of
 * the research that toughens the whole garrison.
 */

/** Raids a minion has to live through for each star. */
export const VETERAN_RAIDS = [2, 5, 10];
export const VETERAN_MAX_RANK = VETERAN_RAIDS.length;
/** Hit points each star adds. */
export const VETERAN_HP_PER_RANK = 0.08;

export function veteranRank(raidsSurvived: number): number {
  let rank = 0;
  for (const need of VETERAN_RAIDS) if (raidsSurvived >= need) rank += 1;
  return rank;
}

export function veteranHpScale(rank: number): number {
  return 1 + VETERAN_HP_PER_RANK * Math.max(0, Math.min(VETERAN_MAX_RANK, Math.floor(rank)));
}
