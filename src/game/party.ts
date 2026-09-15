import {
  ADVENTURER_CLASSES,
  CHAMPION_THREAT,
  type AdventurerClass,
  type AdventurerRecord,
  type PartyMember,
} from "./types";

/**
 * Who is coming next.
 *
 * The roster is the best thing in this game and it was invisible. Adventurers
 * are named, they persist, they level up every time they lose, and they come
 * back — and the player found all of that out from a list in a management
 * panel, after the fact. Pressing "raid" was pressing a button labelled
 * "unknown".
 *
 * So the party is shown before it arrives, which means the client has to be
 * able to work out what the server will send. That is a mirror, and mirrors
 * rot: `tests/party.test.ts` pins every rule here against the numbers in
 * server.js so the two cannot drift silently.
 *
 * The mirror is a preview, not a promise. It reads the roster as it stands
 * right now; an adventurer whose `returnsAt` passes in the seconds between
 * this and the raid starting will join, and the party that arrives is one
 * name longer than the one shown. That is the only disagreement possible,
 * it resolves in the player's favour being visible rather than hidden, and
 * the server remains the only thing that decides who actually raids.
 */

/**
 * The names the server hands to fresh recruits, in order.
 * Mirrored from `ADVENTURER_NAMES` in server.js.
 */
export const ADVENTURER_NAMES = [
  "Aldric", "Brenna", "Cedric", "Dahlia", "Edmund",
  "Fiora", "Gareth", "Halina", "Ivor", "Junia",
];

/** Mirrored from `MAX_ROSTER` in server.js. */
export const MAX_ROSTER = 12;

/**
 * How many waves one raid is made of. Mirrored from `wavesFor` in server.js.
 *
 * It grows the way the party does, and for the same reason: three escalating
 * waves is the shape a dungeon earns, not the one it opens with. A brand new
 * keeper meeting all three loses their first raid to a rule they have not
 * been taught yet - measured, in tests/tutorial.test.ts, which builds exactly
 * what the opening teaches and then fights the real raid with it.
 */
export function wavesFor(threat: number): number {
  // From 4, not 3: at 3 the party doubles, and the two used to land together.
  if (threat < 4) return 1;
  if (threat < CHAMPION_THREAT) return 2;
  return 3;
}

/** Mirrored from `pickParty` in server.js. */
export function partySize(threat: number): number {
  return 1 + Math.min(4, Math.floor(threat / 3));
}

/** Which classes the dungeon is loud enough to attract. Mirrored from pickParty. */
export function classPool(threat: number): AdventurerClass[] {
  return ADVENTURER_CLASSES.slice(0, 1 + Math.min(4, Math.floor(threat / 2)));
}

/**
 * True once the dungeon is loud enough that the party comes with a leader.
 * Mirrored from `championThreat` in server.js.
 */
export function hasChampion(threat: number): boolean {
  return threat >= CHAMPION_THREAT;
}

/**
 * The highest level anyone is fielded at: one above what the town would hire.
 * Mirrored from `levelCap` in pickParty.
 *
 * Adventurers level every time they die and never level down, so without a
 * cap a dungeon that won once met a veteran it could not beat at threat 0 -
 * and losing, which is the only thing that lowers threat, could not help.
 */
export function veteranCap(threat: number): number {
  return recruitLevel(threat) + 1;
}

/**
 * The level a fresh recruit arrives at. Mirrored from `recruitLevel` in server.js.
 *
 * Steps up first at threat 5 rather than 3, so the party growing, a second
 * wave arriving and the levels rising each come on a raid of their own.
 */
export function recruitLevel(threat: number): number {
  return 1 + Math.floor(Math.max(0, threat - 2) / 3);
}

export interface PartyPreviewMember extends PartyMember {
  /** False for a recruit the server has not created yet. */
  known: boolean;
  /** Raids survived. 0 for anyone who has not been here before. */
  raids: number;
}

/**
 * The party the server would send if the raid started at `now`.
 *
 * Mirrors `pickParty` exactly, minus the writes: no state is flipped to
 * "raiding" and no recruit is added to the roster, so this can be called
 * every render without the preview itself changing what arrives.
 */
export function previewParty(
  roster: AdventurerRecord[],
  threat: number,
  now: number,
): PartyPreviewMember[] {
  const size = partySize(threat);
  const ready = roster
    .filter((a) => a.state === "town" && a.returnsAt <= now)
    .map((a): PartyPreviewMember => ({
      id: a.id,
      cls: a.cls,
      name: a.name,
      level: a.level,
      known: true,
      raids: a.raids,
    }));

  // Not enough veterans free, so the server would hire. Same index, same pool,
  // same name order — which is what makes the preview show the right stranger.
  const pool = classPool(threat);
  let spawned = 0;
  while (ready.length < size && roster.length + spawned < MAX_ROSTER) {
    const index = roster.length + spawned;
    ready.push({
      id: `preview-${index}`,
      cls: pool[index % pool.length],
      name: ADVENTURER_NAMES[index % ADVENTURER_NAMES.length],
      level: recruitLevel(threat),
      known: false,
      raids: 0,
    });
    spawned++;
  }

  // Veterans first: the strongest available lead the assault, and the leader
  // is the one who becomes the champion.
  ready.sort((a, b) => b.level - a.level);
  const party = ready.slice(0, size);
  for (const member of party) member.level = Math.min(member.level, veteranCap(threat));
  if (party.length > 0 && hasChampion(threat)) party[0].champion = true;
  return party;
}
