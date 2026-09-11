// DUNGEON WARDEN - Verse8 / Agent8 game server
// Runs in an isolated-vm: no fs / http / axios / Node builtins.
// Only $sender, $global, $room, $asset are available.
// Do NOT export this class.

const SAVE_VERSION = 2;

const GRID_W = 12;
const GRID_H = 12;

const OBSTACLE_COST = { barricade: 12, wall: 35 };
const BASE_MAX_OBSTACLES = 20;

/**
 * Reads a key that a client chose out of a plain-object table.
 *
 * `TABLE[key]` alone is not a membership test: every object inherits
 * `toString`, `constructor`, `valueOf` and friends from Object.prototype, so
 * `OBSTACLE_COST["toString"]` returns a *function* — truthy enough to walk
 * straight past a `if (!TABLE[key])` guard. Every lookup on a client-supplied
 * key goes through here so only an own key can ever answer.
 */
function ownEntry(table, key) {
  if (typeof key !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(table, key)) return null;
  const value = table[key];
  return value === undefined ? null : value;
}

/**
 * The price of a thing, or null if it has none.
 *
 * The number check is the second half of the defence: even if a table one day
 * held something that is not a price, a non-number can never reach the `cost +=`
 * arithmetic. That matters more than it looks — `cost += someFunction` turns the
 * running total into a *string*, and `"0function ..." > 0` is false, so
 * saveDungeon would skip the burn entirely and hand the whole layout out free.
 */
function priceOf(table, type) {
  const price = ownEntry(table, type);
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  return price;
}

/** Room height and obstacle budget both come from the expansion research. */
function arenaFor(research) {
  const owned = Array.isArray(research) ? research : [];
  let h = GRID_H;
  if (owned.includes("expand1")) h = 16;
  if (owned.includes("expand2")) h = 20;
  return { w: GRID_W, h };
}

/**
 * The two fixed tiles are derived, never stored-and-trusted.
 *
 * These mirror `entranceOf`/`coreOf` in src/game/arena.ts exactly. They used to
 * be written into the save and moved by hand when an expansion widened the
 * room; a save that missed that rewrite disagreed with the client about where
 * its own core was. Computing both from the research list means the two sides
 * agree by construction, and a save that was already wrong is repaired the next
 * time it is read.
 */
function entranceOf(arena) {
  return { x: Math.floor(arena.w / 2), y: 0 };
}

function coreOf(arena) {
  return { x: Math.floor(arena.w / 2), y: arena.h - 1 };
}

/**
 * Stamps the derived entrance and core onto a dungeon and returns its arena.
 * Called on every path that reads or hands back a save, so no reader anywhere
 * sees a stale pair.
 */
function applyArena(dungeon) {
  const arena = arenaFor(dungeon.research);
  dungeon.entrance = entranceOf(arena);
  dungeon.core = coreOf(arena);
  return arena;
}

function maxObstaclesFor(research, entitlements) {
  const owned = Array.isArray(research) ? research : [];
  let cap = BASE_MAX_OBSTACLES;
  if (owned.includes("expand1")) cap = 28;
  if (owned.includes("expand2")) cap = 36;
  if (entitlements && entitlements.extraObstacles) cap += ENTITLEMENT_OBSTACLES;
  return cap;
}

const START_GOLD = 200;

// Mirrored in src/game/types.ts and src/game/sim/units.ts.
const BASE_MAX_MINIONS = 8;
const MINION_COST = { warrior: 50, mage: 70, convert: 0 };
// ^ Converts are earned by capturing, never bought.

const MAX_TRAPS = 10;
const TRAP_COST = { spike: 30, arrow: 35, rockfall: 45, flame: 55 };

const MAX_ROOMS = 6;
const ROOM_SIZE = 2;
const ROOM_COST = {
  treasury: 100,
  vault: 110,
  barracks: 120,
  altar: 130,
  workshop: 140,
  jail: 150,
};

const JAIL_CELLS_PER_ROOM = 2;

/** How long a beaten adventurer sulks in town before trying again. */
const ADVENTURER_RETURN_MS = 90 * 1000;
/** A survivor regroups faster than one that had to be carried home. */
const ADVENTURER_REGROUP_MS = 30 * 1000;
/** Conversion takes longer the more accomplished the prisoner is. */
const CONVERT_MS_PER_LEVEL = 60 * 1000;
const MAX_ROSTER = 12;

// Room bonuses. Each copy multiplies or adds, then the result is clamped so a
// wall of one room type cannot trivialise the game.
const BARRACKS_MINION_BONUS = 2;
const MAX_MINION_CAP = 16;
const WORKSHOP_COOLDOWN_STEP = 0.8;
const MIN_TRAP_COOLDOWN_SCALE = 0.5;
const VAULT_PLUNDER_STEP = 0.6;
const MIN_PLUNDER_SCALE = 0.3;
const ALTAR_REVIVE_STEP = 0.6;
const MIN_REVIVE_SCALE = 0.25;

const TREASURY_REWARD = 25;
const TREASURY_THREAT = 1;

/** How long a minion killed in a raid stays down before it can fight again. */
const BASE_REVIVE_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
// Mirrored in src/game/research.ts. This copy is authoritative: the client's
// only decides what to grey out.
const RESEARCH = {
  mage: { cost: 120, unlockMinion: "mage" },
  trap_arrow: { cost: 90, unlockTrap: "arrow" },
  trap_rock: { cost: 160, requires: ["trap_arrow"], unlockTrap: "rockfall" },
  trap_flame: { cost: 220, requires: ["trap_rock"], unlockTrap: "flame" },

  room_barracks: { cost: 150, unlockRoom: "barracks" },
  room_vault: { cost: 160, unlockRoom: "vault" },
  room_workshop: { cost: 180, requires: ["trap_arrow"], unlockRoom: "workshop" },
  room_altar: { cost: 210, requires: ["room_barracks"], unlockRoom: "altar" },
  room_jail: { cost: 240, requires: ["room_barracks"], unlockRoom: "jail" },

  might1: { cost: 160, minionDamage: 0.1 },
  might2: { cost: 320, requires: ["might1"], minionDamage: 0.2 },
  vigor1: { cost: 160, minionHp: 0.15 },
  vigor2: { cost: 320, requires: ["vigor1"], minionHp: 0.3 },
  trap_power1: { cost: 200, requires: ["trap_arrow"], trapDamage: 0.2 },
  trap_power2: { cost: 400, requires: ["trap_power1"], trapDamage: 0.4 },

  expand1: { cost: 420 },
  expand2: { cost: 700, requires: ["expand1"] },
};

const BASE_MINIONS = ["warrior", "convert"];
const BASE_TRAPS = ["spike"];
const BASE_ROOMS = ["treasury"];

/** Threat decays while the dungeon stays quiet, so a bad streak is survivable. */
const THREAT_DECAY_MS = 20 * 60 * 1000;
/** Each point of threat raises payouts, making a loud dungeon worth running. */
const THREAT_REWARD_STEP = 0.08;

/** Global collection backing the leaderboard. */
const LEADERBOARD = "dungeon_leaderboard";

function researchEffects(owned) {
  let minionDamage = 0;
  let minionHp = 0;
  let trapDamage = 0;

  const minions = BASE_MINIONS.slice();
  const traps = BASE_TRAPS.slice();
  const rooms = BASE_ROOMS.slice();

  for (const id of owned || []) {
    const node = ownEntry(RESEARCH, id);
    if (!node) continue;

    // Tiers replace rather than stack, so owning I and II gives II.
    if (node.minionDamage) minionDamage = Math.max(minionDamage, node.minionDamage);
    if (node.minionHp) minionHp = Math.max(minionHp, node.minionHp);
    if (node.trapDamage) trapDamage = Math.max(trapDamage, node.trapDamage);

    if (node.unlockMinion && minions.indexOf(node.unlockMinion) === -1) {
      minions.push(node.unlockMinion);
    }
    if (node.unlockTrap && traps.indexOf(node.unlockTrap) === -1) traps.push(node.unlockTrap);
    if (node.unlockRoom && rooms.indexOf(node.unlockRoom) === -1) rooms.push(node.unlockRoom);
  }

  return {
    minionDamageScale: 1 + minionDamage,
    minionHpScale: 1 + minionHp,
    trapDamageScale: 1 + trapDamage,
    unlockedMinions: minions,
    unlockedTraps: traps,
    unlockedRooms: rooms,
  };
}

/**
 * Threat falls off while nothing raids the dungeon.
 *
 * Without this, one good streak locks the player into parties they cannot
 * handle forever. Decay is computed from elapsed time on load rather than a
 * timer, because server code has none.
 */
function decayThreat(dungeon, now) {
  const last = dungeon.threatCheckedAt || dungeon.updatedAt || now;
  const steps = Math.floor((now - last) / THREAT_DECAY_MS);
  if (steps > 0) {
    dungeon.threat = Math.max(0, (dungeon.threat || 0) - steps);
    dungeon.threatCheckedAt = last + steps * THREAT_DECAY_MS;
  } else if (!dungeon.threatCheckedAt) {
    dungeon.threatCheckedAt = now;
  }
  return dungeon.threat || 0;
}

// Raid payouts. Kept on the server so a client cannot invent its own reward.
// Tuned against the research tree: a repelled raid should buy a meaningful
// fraction of the next unlock, not a rounding error. At the old 20/15 a first
// node cost roughly forty raids, which read as a wall rather than a goal.
const RAID_BASE_REWARD = 35;
const RAID_REWARD_PER_KILL = 25;
const RAID_BREACH_REWARD_PER_KILL = 8;

/**
 * Threat at which the party starts arriving with a leader, and what stopping
 * that leader is worth on top of the usual per-head bounty.
 *
 * Mirrored in src/game/types.ts (CHAMPION_THREAT) and src/game/party.ts,
 * which shows the player who is coming before the raid opens. The scales the
 * champion actually fights at live client-side with the rest of the combat
 * numbers; only the payout is decided here, where it cannot be invented.
 */
const CHAMPION_THREAT = 9;

/**
 * Waves in one raid.
 *
 * A single party was about sixteen seconds of fighting for a minute of
 * building. Three groups with a build window between them makes one press an
 * engagement instead of a blip, and it is what lets a raid escalate inside
 * itself - the last wave is the one that brings the champion.
 *
 * Each wave is pulled from the roster in turn, so they are different people
 * and the later ones are the veterans. If the town runs out of anyone to
 * send, the raid is however many waves it managed to fill.
 */
const WAVES_PER_RAID = 3;
const RAID_CHAMPION_REWARD = 60;
const RAID_PLUNDER_RATE = 0.15;
const RAID_PLUNDER_CAP = 120;

// Order matters: this is the sequence classes join the roster in as threat
// rises, so a new dungeon only ever faces knights.
const ADVENTURER_CLASSES = ["knight", "barbarian", "rogue", "ranger", "mage"];

const ADVENTURER_NAMES = [
  "Aldric", "Brenna", "Cedric", "Dahlia", "Edmund",
  "Fiora", "Gareth", "Halina", "Ivor", "Junia",
];

// ---------------------------------------------------------------------------
// VXShop
// ---------------------------------------------------------------------------
// productId here must match the Product ID registered in the Verse8 dashboard
// (game management page -> VX Shop tab). Registering a product does not put it
// on sale by itself; the game has to grant it, which is what $onItemPurchased
// below does.
// What is on sale.
//
// Both sell room to build in rather than a win. That works here because the
// difficulty is a dial the game turns itself: threat rises with every raid you
// repel and falls when you lose, so a player who buys more wall does not make
// the game easier — they settle at a higher threat, against bigger parties,
// for a bigger payout. What money buys is a larger fight, not a won one.
//
//  is the entitlement key. Adding a row here is the whole server-side
// change;  below reads this table and nothing else.
const PRODUCTS = {
  deeper_dungeon: { grants: "extraObstacles", repeatable: false },
  larger_garrison: { grants: "extraMinions", repeatable: false },
};

/** How much each entitlement is worth, applied on top of the research caps. */
const ENTITLEMENT_OBSTACLES = 8;
const ENTITLEMENT_MINIONS = 4;

// Accounts allowed to call devGrantPurchase, which exercises the grant path
// without a real payment. Empty means the dev tool is off for everyone.
//
// Put ONLY your own wallet address here (the HUD prints it at the bottom left),
// and remove it before a public release. Even if left populated, no other
// account can use it.
const DEV_ACCOUNTS = [];

// Remembering every purchase forever would grow the save without bound, and
// only recent ids matter for replay protection.
// ---------------------------------------------------------------------------
// Rewarded gold.
//
// The sandbox has no fetch, so the documented server-side verification of a
// rewarded ad cannot run here — there is no way for this file to learn whether
// an ad was really watched. A player can call claimAdGold from the console.
//
// So the ad is not what limits the payout; these numbers are. A cheat skips
// the ad, not the cap, and therefore earns exactly what an honest player earns
// in a day. What that costs is ad revenue, not game balance, and balance is
// the only one of the two this file can defend.
const AD_GOLD_DAILY_LIMIT = 5;
/** Stops a day's worth being claimed in one burst. */
const AD_GOLD_COOLDOWN_MS = 3 * 60 * 1000;
const AD_GOLD_BASE = 40;
/** Scales with threat the same way raid rewards do, so it stays worth taking. */
const AD_GOLD_THREAT_STEP = 0.08;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What one ad is worth right now. Rounded so the HUD never shows a fraction. */
function adGoldReward(threat) {
  const bonus = 1 + (threat || 0) * AD_GOLD_THREAT_STEP;
  return Math.round(AD_GOLD_BASE * bonus);
}

/** Claims used today, reset when the UTC day index moves. */
function adClaimsToday(state, now) {
  const today = Math.floor(now / DAY_MS);
  const claims = (state && state.adClaims) || null;
  if (!claims || claims.day !== today) return { day: today, count: 0, lastAt: 0 };
  return {
    day: today,
    count: typeof claims.count === "number" ? claims.count : 0,
    lastAt: typeof claims.lastAt === "number" ? claims.lastAt : 0,
  };
}

const MAX_TRACKED_PURCHASES = 50;

// ---------------------------------------------------------------------------
// Rewarded ads
// ---------------------------------------------------------------------------
// There is deliberately no server-side ad payout.
//
// The documented verification flow needs an outbound HTTP call to
// ads-verifier.verse8.io, and the isolated-vm sandbox has no `fetch` — this was
// measured, not assumed. Paying currency on a signal that cannot be verified is
// an unbounded income source, so the rewarded ad instead grants an effect
// inside the running raid, which the client already simulates. Nothing about a
// reward reaches this file.

function emptyEntitlements() {
  return {};
}

function pushCapped(list, value, max) {
  const next = Array.isArray(list) ? list.slice() : [];
  next.push(value);
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Applies a purchased product to an account, exactly once per purchaseId.
 *
 * Shared by the real platform callback and the dev tool so both exercise the
 * same code — testing a different path than production would prove nothing.
 */
async function grantProduct(account, productId, purchaseId, quantity) {
  // ownEntry, not PRODUCTS[productId]: the same unguarded-index bug the cost
  // tables had. `productId: "toString"` resolved to Object.prototype.toString,
  // walked past `if (!product)`, granted nothing (no `grants` field matches),
  // and yet still burned the purchaseId into grantedPurchases and overwrote
  // lastPurchase — so a later, genuine callback carrying that id would be
  // answered ALREADY_GRANTED and the player would be charged for nothing.
  const product = ownEntry(PRODUCTS, productId);
  if (!product) return { success: false, reason: "UNKNOWN_PRODUCT" };

  return await $lock(`purchase:${account}`, async () => {
    const state = (await $global.getUserState(account)) || {};
    const granted = state.grantedPurchases || [];

    // Verse8 may retry the callback; granting twice would hand out two copies.
    if (granted.indexOf(purchaseId) !== -1) {
      return { success: true, reason: "ALREADY_GRANTED" };
    }

    const entitlements = state.entitlements || emptyEntitlements();
    const count = quantity && quantity > 0 ? quantity : 1;

    // Entitlements are keyed by what the product grants, so adding a product
    // to PRODUCTS above is the whole change.
    if (product.grants) {
      entitlements[product.grants] = true;
    }
    // Consumable products (gold packs and the like) would be credited here.
    // $asset acts on the calling user, so a consumable needs a different
    // mechanism than $asset.mint inside the system handler.

    await $global.updateUserState(account, {
      entitlements,
      grantedPurchases: pushCapped(granted, purchaseId, MAX_TRACKED_PURCHASES),
      lastPurchase: { productId, purchaseId, quantity: count, at: Date.now() },
    });

    return { success: true, reason: "GRANTED" };
  });
}

/** Tiles a 2x2 room anchored at (x, y) covers. */
function roomTiles(room) {
  const tiles = [];
  for (let dy = 0; dy < ROOM_SIZE; dy++) {
    for (let dx = 0; dx < ROOM_SIZE; dx++) {
      tiles.push({ x: room.x + dx, y: room.y + dy });
    }
  }
  return tiles;
}

/** Aggregated room bonuses, clamped. */
function roomEffects(rooms, entitlements) {
  let minionCap = BASE_MAX_MINIONS;
  if (entitlements && entitlements.extraMinions) minionCap += ENTITLEMENT_MINIONS;
  let trapCooldownScale = 1;
  let plunderScale = 1;
  let reviveScale = 1;
  let treasuryCount = 0;
  let jailCapacity = 0;

  for (const room of rooms || []) {
    if (room.type === "barracks") minionCap += BARRACKS_MINION_BONUS;
    else if (room.type === "workshop") trapCooldownScale *= WORKSHOP_COOLDOWN_STEP;
    else if (room.type === "vault") plunderScale *= VAULT_PLUNDER_STEP;
    else if (room.type === "altar") reviveScale *= ALTAR_REVIVE_STEP;
    else if (room.type === "treasury") treasuryCount++;
    else if (room.type === "jail") jailCapacity += JAIL_CELLS_PER_ROOM;
  }

  return {
    minionCap: Math.min(minionCap, MAX_MINION_CAP),
    trapCooldownScale: Math.max(trapCooldownScale, MIN_TRAP_COOLDOWN_SCALE),
    plunderScale: Math.max(plunderScale, MIN_PLUNDER_SCALE),
    reviveScale: Math.max(reviveScale, MIN_REVIVE_SCALE),
    treasuryCount,
    jailCapacity,
  };
}

/**
 * Named tiers, mirrored in src/game/milestones.ts.
 *
 * The thresholds are where pickParty below changes what it sends: a second
 * adventurer at 3, a fourth at 9, and past 12 the party stops growing and only
 * levels rise. Crossing one is announced once and then remembered, so it reads
 * as progress rather than as a label that is always there.
 */
const MILESTONES = [
  { threat: 3, label: "tier_scouts" },
  { threat: 9, label: "tier_company" },
  { threat: 20, label: "tier_crusade" },
];

/**
 * Marks any tier this threat has newly reached and returns the highest of
 * them, or null. Mutates the save, so the caller has to be writing it back.
 */
function crossMilestones(dungeon, threat) {
  const seen = Array.isArray(dungeon.milestonesSeen) ? dungeon.milestonesSeen : [];
  let reached = null;
  for (const milestone of MILESTONES) {
    if (threat < milestone.threat) continue;
    if (seen.indexOf(milestone.label) !== -1) continue;
    seen.push(milestone.label);
    reached = milestone.label;
  }
  dungeon.milestonesSeen = seen;
  return reached;
}

/** Loot tier scales with how tough the adventurer was. */
function lootTierFor(level) {
  return Math.max(1, Math.min(3, Math.ceil(level / 3)));
}

/**
 * Keeps the adventurer roster topped up and picks who raids next.
 * Adventurers persist between raids, level up after losing, and come back —
 * so the same names keep showing up, stronger each time.
 */
/**
 * Settles a raid the player walked away from.
 *
 * Without this, closing the tab mid-fight is strictly better than losing: the
 * party stays flagged "raiding" forever, the roster fills with ghosts, and
 * pickParty starts handing back empty parties that resolve as an instant
 * "repelled" for free gold. Abandoning now costs what losing costs.
 */
function abandonPendingRaid(dungeon, pending, now) {
  const ids = (pending.party || []).map((m) => m.id);
  for (const record of dungeon.adventurers || []) {
    if (ids.indexOf(record.id) === -1) continue;
    if (record.state !== "raiding") continue;
    record.state = "town";
    record.returnsAt = now + ADVENTURER_REGROUP_MS;
  }

  dungeon.coreBreaches = (dungeon.coreBreaches || 0) + 1;
  dungeon.threat = Math.max(0, (dungeon.threat || 0) - 1);
}

function pickParty(dungeon, threat, now) {
  const roster = Array.isArray(dungeon.adventurers) ? dungeon.adventurers.slice() : [];
  // Party size is the dial threat turns; individual levels come from the
  // roster growing after each defeat, so difficulty rises on two axes.
  const size = 1 + Math.min(4, Math.floor(threat / 3));

  const ready = roster.filter((a) => a.state === "town" && a.returnsAt <= now);

  // Not enough veterans available, so fresh blood shows up. Classes unlock as
  // the dungeon gets louder, so early parties stay readable.
  let spawned = 0;
  while (ready.length < size && roster.length < MAX_ROSTER) {
    const index = roster.length + spawned;
    const pool = ADVENTURER_CLASSES.slice(0, 1 + Math.min(4, Math.floor(threat / 2)));
    const recruit = {
      id: "adv-" + now + "-" + index,
      cls: pool[index % pool.length],
      name: ADVENTURER_NAMES[index % ADVENTURER_NAMES.length],
      level: 1 + Math.floor(threat / 3),
      state: "town",
      returnsAt: 0,
      raids: 0,
    };
    roster.push(recruit);
    ready.push(recruit);
    spawned++;
  }

  // Veterans first: the strongest available lead the assault.
  ready.sort((a, b) => b.level - a.level);
  const party = ready.slice(0, size);

  // The party is sorted by level, so its leader is the strongest thing the
  // town can field - which is exactly who should be wearing the crown.
  const champion = threat >= CHAMPION_THREAT && party.length > 0 ? party[0].id : null;

  for (const member of party) member.state = "raiding";
  dungeon.adventurers = roster;

  return party.map((member) => ({
    id: member.id,
    cls: member.cls,
    name: member.name,
    level: member.level,
    champion: member.id === champion,
  }));
}

/**
 * Validates rooms and charges for new ones.
 *
 * Rooms claim four tiles each, and nothing else may sit on them. `claimed` is
 * a shared Set the caller seeds with the entrance and core keys before this
 * runs, and it is shared onward with the trap, minion and obstacle checks so
 * one occupant ever holds a tile — there is no more floor/rock distinction to
 * lean on for that.
 *
 * Ids the client chose index a Map and a Set, never a plain object, and the
 * type indexes ROOM_COST through priceOf — an id or type of "toString" is then
 * just a string that is not there, rather than a hit on Object.prototype.
 */
function priceRooms(nextRooms, prevRooms, arena, claimed) {
  if (!Array.isArray(nextRooms)) throw new Error("BAD_ROOMS");
  if (nextRooms.length > MAX_ROOMS) throw new Error("TOO_MANY_ROOMS");

  const prevById = new Map();
  for (const room of prevRooms || []) prevById.set(room.id, room);

  const seenIds = new Set();
  let cost = 0;

  for (const room of nextRooms) {
    if (!room || typeof room.id !== "string") throw new Error("BAD_ROOM_ID");
    if (seenIds.has(room.id)) throw new Error("DUPLICATE_ROOM_ID");
    seenIds.add(room.id);

    const price = priceOf(ROOM_COST, room.type);
    if (price === null) throw new Error("UNKNOWN_ROOM_TYPE");

    for (const tile of roomTiles(room)) {
      if (tile.x < 0 || tile.y < 0 || tile.x >= arena.w || tile.y >= arena.h) {
        throw new Error("ROOM_OUT_OF_BOUNDS");
      }

      const key = `${tile.x},${tile.y}`;
      if (claimed.has(key)) throw new Error("ROOM_OVERLAP");
      claimed.add(key);
    }

    const previous = prevById.get(room.id);
    if (!previous || previous.type !== room.type) cost += price;
  }

  return cost;
}

/** Validates traps and charges for new ones. */
function priceTraps(nextTraps, prevTraps, arena, claimed) {
  if (!Array.isArray(nextTraps)) throw new Error("BAD_TRAPS");
  if (nextTraps.length > MAX_TRAPS) throw new Error("TOO_MANY_TRAPS");

  const prevById = new Map();
  for (const trap of prevTraps || []) prevById.set(trap.id, trap);

  const seenIds = new Set();
  let cost = 0;

  for (const trap of nextTraps) {
    if (!trap || typeof trap.id !== "string") throw new Error("BAD_TRAP_ID");
    if (seenIds.has(trap.id)) throw new Error("DUPLICATE_TRAP_ID");
    seenIds.add(trap.id);

    const price = priceOf(TRAP_COST, trap.type);
    if (price === null) throw new Error("UNKNOWN_TRAP_TYPE");

    if (!Number.isInteger(trap.x) || !Number.isInteger(trap.y)) {
      throw new Error("BAD_TRAP_POSITION");
    }
    if (trap.x < 0 || trap.y < 0 || trap.x >= arena.w || trap.y >= arena.h) {
      throw new Error("BAD_TRAP_POSITION");
    }

    const key = `${trap.x},${trap.y}`;
    if (claimed.has(key)) throw new Error("TILE_OCCUPIED");
    claimed.add(key);

    const previous = prevById.get(trap.id);
    if (!previous || previous.type !== trap.type) cost += price;
  }

  return cost;
}

/**
 * Is this minion's "convert or not" identity the one the server already stored?
 *
 * A convert is a captured adventurer that changed sides: the server alone
 * creates one (resolveConversions), it costs nothing because it is earned, and
 * it carries a `cls` and `level` that make it strictly stronger than a bought
 * warrior — 130hp/13dmg against 90/9 for a knight convert at level 1.
 *
 * The guard used to ask only whether *something* was stored under that id. That
 * was an existence test standing in for a type test, and it held only as long
 * as MINION_COST had no `convert` key to price: the missing price threw
 * UNKNOWN_MINION_TYPE first and hid the hole. Once `convert: 0` was added the
 * hole opened — a client could take one of its own warriors' ids, resend it as
 * `type: "convert"`, and the id existed, so nothing objected. The type is in
 * BASE_MINIONS so MINION_LOCKED passes, the price is 0, and every minion in the
 * dungeon became a better unit for free.
 *
 * So the test is on the *type* of the stored entry, and it runs in both
 * directions. A stored convert may not be re-typed into anything else either:
 * that would leave a knight's cls and level attached to a "warrior", and would
 * launder the convert identity away so the id could be re-converted later.
 */
function convertIdentityHolds(minion, previous) {
  const wasConvert = !!previous && previous.type === "convert";
  return (minion.type === "convert") === wasConvert;
}

/**
 * Validates a minion roster against the arena and charges for what is new.
 * Removals are free but refund nothing, and changing an existing id's type is
 * charged in full so a client cannot swap a cheap unit for an expensive one.
 */
function priceMinions(nextMinions, prevMinions, arena, claimed, minionCap) {
  if (!Array.isArray(nextMinions)) throw new Error("BAD_MINIONS");
  if (nextMinions.length > minionCap) throw new Error("TOO_MANY_MINIONS");

  const prevById = new Map();
  for (const minion of prevMinions || []) prevById.set(minion.id, minion);

  const seenIds = new Set();
  let cost = 0;

  for (const minion of nextMinions) {
    if (!minion || typeof minion.id !== "string") throw new Error("BAD_MINION_ID");
    if (seenIds.has(minion.id)) throw new Error("DUPLICATE_MINION_ID");
    seenIds.add(minion.id);

    const price = priceOf(MINION_COST, minion.type);
    if (price === null) throw new Error("UNKNOWN_MINION_TYPE");

    // Converts are earned by capturing and are created by the server alone.
    // The Map lookup matters here: with a plain object, `id: "toString"` would
    // have satisfied "this one already existed" with an inherited method.
    const previous = prevById.get(minion.id);
    if (!convertIdentityHolds(minion, previous)) throw new Error("ILLEGAL_CONVERT");

    if (!Number.isInteger(minion.x) || !Number.isInteger(minion.y)) {
      throw new Error("BAD_MINION_POSITION");
    }
    if (minion.x < 0 || minion.y < 0 || minion.x >= arena.w || minion.y >= arena.h) {
      throw new Error("BAD_MINION_POSITION");
    }

    const cellKey = `${minion.x},${minion.y}`;
    if (claimed.has(cellKey)) throw new Error("TILE_OCCUPIED");
    claimed.add(cellKey);

    if (!previous || previous.type !== minion.type) cost += price;
  }

  return cost;
}

/**
 * Charges for obstacles that are new or changed type, and refuses a dungeon
 * that breaks the rules. Removing an obstacle refunds nothing, which is what
 * makes a wall a purchase rather than a fixture.
 *
 * Two things here are load-bearing and were missing:
 *
 * 1. The price comes from priceOf, not `OBSTACLE_COST[o.type]`. A type of
 *    "toString" used to resolve to Object.prototype.toString, sail past the
 *    `!OBSTACLE_COST[o.type]` guard, and then `cost += <function>` made the
 *    running total a string. saveDungeon's `if (cost > 0)` is false for a
 *    string, so the entire save — rooms, traps, minions and all — was free.
 * 2. `seenIds`, which the room, trap and minion pricers already had. Without
 *    it one saved wall could be listed many times at different coordinates:
 *    savedById matched every copy, the type never changed, and each clone cost
 *    nothing while still eating a tile and an obstacle slot. It also confused
 *    finishRaid, where destroying that one id deleted every clone at once.
 */
/**
 * What taking something down pays back, as a share of what it cost.
 * Mirrored in src/game/placements.ts (REFUND_RATE), which shows the player
 * the number before they commit to it.
 *
 * Never above one. At exactly one a build-and-sell round trip nets zero;
 * above it the same loop is an infinite supply of gold, and this is the side
 * that mints.
 */
const REFUND_RATE = 1;

/**
 * Pays back for entries that were saved and are now gone, or whose id has
 * been reused for a different type - the mirror of what the price* functions
 * charge.
 *
 * Priced from the SAVED record, never from anything the client sent: the
 * refund is for what the server already believes is standing there, so a
 * client cannot claim to have removed a vault it never built.
 */
function refundFor(next, saved, prices) {
  const byId = {};
  for (const item of next || []) {
    if (item && typeof item.id === "string") byId[item.id] = item;
  }
  let value = 0;
  for (const item of saved || []) {
    if (!item || typeof item.id !== "string") continue;
    const current = byId[item.id];
    if (!current || current.type !== item.type) value += prices[item.type] || 0;
  }
  return Math.floor(value * REFUND_RATE);
}

function priceObstacles(next, saved, arena, research, occupied, entitlements) {
  if (!Array.isArray(next)) throw new Error("BAD_OBSTACLES");
  const cap = maxObstaclesFor(research, entitlements);
  if (next.length > cap) throw new Error("TOO_MANY_OBSTACLES");

  const savedById = new Map((saved || []).map((o) => [o.id, o]));
  const seenIds = new Set();
  let cost = 0;

  for (const o of next) {
    if (!o || typeof o.id !== "string") throw new Error("BAD_OBSTACLE_ID");
    if (seenIds.has(o.id)) throw new Error("DUPLICATE_OBSTACLE_ID");
    seenIds.add(o.id);

    const price = priceOf(OBSTACLE_COST, o.type);
    if (price === null) throw new Error("UNKNOWN_OBSTACLE");

    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) {
      throw new Error("OUT_OF_BOUNDS");
    }
    if (o.x < 0 || o.y < 0 || o.x >= arena.w || o.y >= arena.h) {
      throw new Error("OUT_OF_BOUNDS");
    }
    const key = `${o.x},${o.y}`;
    if (occupied.has(key)) throw new Error("TILE_OCCUPIED");
    occupied.add(key);

    const previous = savedById.get(o.id);
    if (!previous || previous.type !== o.type) cost += price;
  }

  return cost;
}

/**
 * Rebuilds the minion list from trusted fields.
 *
 * The client may move minions and swap which looted weapon each carries. Every
 * other field is the server's: `revivesAt`, `cls` and `level` are copied from
 * the entry already stored under that id and the payload's own values are never
 * read, and a weapon must actually be in the loot pile and held by only one
 * minion.
 *
 * `type` is the one field the client legitimately chooses — buying a mage means
 * sending a mage — so it is copied, but only after two checks that make this
 * function safe standing alone rather than because priceMinions happened to run
 * first on the same list:
 *
 * - it must be an own key of MINION_COST, so no inherited Object.prototype name
 *   and nothing the server would refuse to price can be written into the save;
 * - it must satisfy the same convert identity rule priceMinions enforces, so
 *   `cls`/`level` written here always belong to a minion whose type matches the
 *   one the server itself created. Without it, re-typing a warrior to "convert"
 *   would be copied straight through with `cls`/`level` left undefined and the
 *   client would stat it as a knight; `cls: "barbarian"` or an inflated `level`
 *   in the payload is ignored either way, since neither is read from `minion`.
 */
function sanitizeMinions(nextMinions, prevMinions, loot) {
  // Map/Set rather than plain objects: `weaponId: "toString"` would otherwise
  // read as "yes, that item is in the loot pile" off Object.prototype and let a
  // minion carry a weapon nobody owns.
  const prevById = new Map();
  for (const minion of prevMinions || []) prevById.set(minion.id, minion);

  const lootIds = new Set();
  for (const item of loot || []) lootIds.add(item.id);

  const usedWeapons = new Set();
  return nextMinions.map((minion) => {
    const previous = prevById.get(minion.id);

    if (priceOf(MINION_COST, minion.type) === null) throw new Error("UNKNOWN_MINION_TYPE");
    if (!convertIdentityHolds(minion, previous)) throw new Error("ILLEGAL_CONVERT");

    const stored = previous || {};

    let weaponId = minion.weaponId || null;
    if (weaponId && (!lootIds.has(weaponId) || usedWeapons.has(weaponId))) weaponId = null;
    if (weaponId) usedWeapons.add(weaponId);

    return {
      id: minion.id,
      type: minion.type,
      x: minion.x,
      y: minion.y,
      revivesAt: stored.revivesAt || null,
      cls: stored.cls,
      level: stored.level,
      weaponId,
    };
  });
}

/**
 * Turns prisoners whose sentence is up into placed minions.
 *
 * The server does the placing because a convert is the only minion a client is
 * never allowed to create — see the ILLEGAL_CONVERT check in priceMinions.
 */
function resolveConversions(dungeon, arena, now) {
  const prisoners = Array.isArray(dungeon.prisoners) ? dungeon.prisoners : [];
  if (prisoners.length === 0) return { converted: [], prisoners };

  const occupied = {};
  for (const minion of dungeon.minions || []) occupied[minion.x + ":" + minion.y] = true;
  for (const trap of dungeon.traps || []) occupied[trap.x + ":" + trap.y] = true;
  for (const obstacle of dungeon.obstacles || []) occupied[obstacle.x + ":" + obstacle.y] = true;

  // Derived from the arena, not read off the save: a dungeon whose stored core
  // was left behind by an expansion would otherwise reserve the wrong tile and
  // let a convert spawn on the real one. It also means a save that is missing
  // the fields entirely no longer throws a TypeError here.
  const entrance = entranceOf(arena);
  const core = coreOf(arena);
  occupied[entrance.x + ":" + entrance.y] = true;
  occupied[core.x + ":" + core.y] = true;

  // Converts appear in a jail if there is room, otherwise on any free tile —
  // the whole arena is floor now, so every tile is a candidate.
  const preferred = [];
  for (const room of dungeon.rooms || []) {
    if (room.type !== "jail") continue;
    for (const tile of roomTiles(room)) preferred.push(tile);
  }
  const fallback = [];
  for (let y = 0; y < arena.h; y++) {
    for (let x = 0; x < arena.w; x++) fallback.push({ x, y });
  }

  function freeTile() {
    for (const tile of preferred.concat(fallback)) {
      if (!occupied[tile.x + ":" + tile.y]) return tile;
    }
    return null;
  }

  const converted = [];
  const remaining = [];

  for (const prisoner of prisoners) {
    if (prisoner.convertsAt > now) {
      remaining.push(prisoner);
      continue;
    }

    const tile = freeTile();
    if (!tile) {
      // Nowhere to stand: keep them locked up and try again next load.
      remaining.push(prisoner);
      continue;
    }

    occupied[tile.x + ":" + tile.y] = true;
    const minion = {
      id: "c-" + prisoner.advId,
      type: "convert",
      x: tile.x,
      y: tile.y,
      cls: prisoner.cls,
      level: prisoner.level,
      revivesAt: null,
      weaponId: null,
    };
    dungeon.minions = (dungeon.minions || []).concat([minion]);
    converted.push({ minion, name: prisoner.name });

    const record = (dungeon.adventurers || []).find((a) => a.id === prisoner.advId);
    if (record) record.state = "converted";
  }

  dungeon.prisoners = remaining;
  return { converted, prisoners: remaining };
}

/**
 * Drops entries whose id was already seen, keeping the first of each.
 *
 * priceObstacles rejects a list containing a repeated id, and it is right to:
 * one saved wall listed twice used to cost nothing for the second copy while
 * still eating a tile and a cap slot. But saveDungeon re-prices the *whole*
 * obstacle list on every save, so a duplicate that is already sitting in
 * storage makes that dungeon permanently unsaveable — every save after it is
 * refused, including edits that touch no obstacle at all. Such saves exist:
 * the client seeds its id counter from the number of items rather than the
 * highest suffix in use, so deleting obstacles and placing more regenerates an
 * id, and before the guard those saves were written out silently. The client
 * deletes obstacles by tile, not by id, so the player cannot see or clear it.
 *
 * De-duplicating on load makes those saves repair themselves: loadGame writes
 * the cleaned dungeon straight back, so the very next save prices a list the
 * guard accepts. First occurrence wins, for three reasons — it is the older,
 * already-paid-for wall rather than the one the recycled counter produced; it
 * leaves the layout the player has been looking at where it was instead of
 * teleporting a wall to the newer tile; and it is stable, so loading twice
 * converges on the same dungeon.
 */
function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Version 1 carved corridors out of rock. Version 2 has no terrain, so the
 * grid is simply dropped — every placement sat on carved floor, and the
 * whole room is floor now, so all coordinates stay valid. Nobody loses a
 * dungeon, gold, or a research node.
 *
 * Anything that isn't version 1 or the current version is unreadable and
 * comes back as null, so loadGame replaces it with a fresh dungeon instead
 * of half-reading it.
 */
function migrate(dungeon) {
  if (dungeon.version === SAVE_VERSION) return dungeon;
  if (dungeon.version !== 1) return null;

  const { grid, ...rest } = dungeon;
  return {
    ...rest,
    version: SAVE_VERSION,
    obstacles: [],
    milestonesSeen: [],
    minions: transposeAll(rest.minions),
    traps: transposeAll(rest.traps),
    rooms: transposeAll(rest.rooms),
  };
}

/**
 * Turns a version 1 dungeon a quarter turn.
 *
 * Version 1 was landscape: 12 tall, widening to 16 and then 20 with the
 * expansion research, with the entrance on the left wall at `(0, midY)` and
 * the core on the right at `(w - 1, midY)`. Version 2 is portrait with the
 * same numbers on the other axis — 12 wide, growing to 16 and 20 tall, the
 * entrance at `(midX, 0)` and the core at `(midX, h - 1)`.
 *
 * The two describe the same room seen sideways, so swapping x and y carries a
 * save across exactly: an expanded board's far column becomes its far row and
 * lands inside the new arena instead of off the side of it, and a player's
 * maze keeps its shape relative to the two tiles that matter. Leaving the
 * coordinates alone would have put every placement from an expanded save out
 * of bounds, and rotated everyone else's dungeon relative to the entrance.
 */
function transposeAll(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ ...item, x: item.y, y: item.x }));
}

function createDefaultDungeon() {
  const arena = arenaFor([]);
  const now = Date.now();

  return {
    version: SAVE_VERSION,
    obstacles: [],
    milestonesSeen: [],
    minions: [],
    traps: [],
    rooms: [],
    loot: [],
    prisoners: [],
    adventurers: [],
    research: [],
    entrance: entranceOf(arena),
    core: coreOf(arena),
    threat: 0,
    wavesRepelled: 0,
    coreBreaches: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
}

class Server {
  /**
   * Loads the caller's dungeon, creating a fresh one on first play.
   * Gold lives in $asset, never in the save, so editing the save cannot mint money.
   */
  async loadGame() {
    const state = await $global.getMyState();

    // A purchase can land before the player has ever built anything, so
    // entitlements are read independently of the dungeon.
    const entitlements = (state && state.entitlements) || emptyEntitlements();

    // migrate() returns the save as-is when it is already current, upgrades a
    // version 1 save, or returns null when it is neither — an unreadable save
    // falls through to the fresh-dungeon path below rather than being
    // half-read.
    const dungeon = state && state.dungeon ? migrate(state.dungeon) : null;

    if (dungeon) {
      if (!Array.isArray(dungeon.obstacles)) dungeon.obstacles = [];
      // Alongside the coercions rather than after them: a stored duplicate
      // obstacle id is exactly as unsaveable as a missing array, and the
      // player has no way to clear one from inside the game. See dedupeById.
      dungeon.obstacles = dedupeById(dungeon.obstacles);
      if (!Array.isArray(dungeon.minions)) dungeon.minions = [];
      if (!Array.isArray(dungeon.traps)) dungeon.traps = [];
      if (!Array.isArray(dungeon.rooms)) dungeon.rooms = [];
      if (!Array.isArray(dungeon.loot)) dungeon.loot = [];
      if (!Array.isArray(dungeon.prisoners)) dungeon.prisoners = [];
      if (!Array.isArray(dungeon.adventurers)) dungeon.adventurers = [];
      if (!Array.isArray(dungeon.research)) dungeon.research = [];

      // The entrance and core are recomputed from the research list before
      // anything reads them, so the dungeon handed back to the client always
      // carries the same pair its own arena.ts would compute. A save whose core
      // was stranded by an expansion is corrected here and written back below.
      const arena = applyArena(dungeon);

      // Sentences are served between sessions, so conversions are settled on
      // load rather than by a timer the sandbox does not allow.
      const now = Date.now();
      const converted = resolveConversions(dungeon, arena, now).converted;

      decayThreat(dungeon, now);
      dungeon.lastSeenAt = now;
      await $global.updateMyState({ dungeon });
      return {
        dungeon,
        entitlements,
        gold: await $asset.get("gold"),
        created: false,
        converted: converted.map((c) => c.name),
        research: researchEffects(dungeon.research),
        account: $sender.account,
      };
    }

    const fresh = createDefaultDungeon();
    await $global.updateMyState({ dungeon: fresh });
    await $asset.mint("gold", START_GOLD);

    return {
      dungeon: fresh,
      entitlements,
      gold: await $asset.get("gold"),
      created: true,
      research: researchEffects(fresh.research),
      account: $sender.account,
    };
  }

  /**
   * Buys a research node.
   *
   * Cost, prerequisites and the resulting unlocks are all decided here — the
   * client cannot grant itself a mage or a wider dungeon.
   */
  async researchNode({ id }) {
    // ownEntry, not RESEARCH[id]: `id: "toString"` would otherwise resolve to a
    // function, pass the guard, and get pushed onto the research list.
    const node = ownEntry(RESEARCH, id);
    if (!node) throw new Error("UNKNOWN_RESEARCH");

    return await $lock(`research:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      if (!state || !state.dungeon) throw new Error("NO_SAVE");

      const dungeon = state.dungeon;
      const owned = Array.isArray(dungeon.research) ? dungeon.research : [];
      if (owned.indexOf(id) !== -1) throw new Error("ALREADY_RESEARCHED");

      for (const requirement of node.requires || []) {
        if (owned.indexOf(requirement) === -1) throw new Error("MISSING_PREREQUISITE");
      }

      if (!(await $asset.has("gold", node.cost))) throw new Error("INSUFFICIENT_GOLD");
      await $asset.burn("gold", node.cost);

      dungeon.research = owned.concat([id]);
      // An expansion widens the arena, which moves the core. Nothing is
      // relocated — the pair is simply recomputed from the new research list,
      // so the dungeon returned below already agrees with the client.
      applyArena(dungeon);
      dungeon.updatedAt = Date.now();

      await $global.updateMyState({ dungeon });

      return {
        research: dungeon.research,
        effects: researchEffects(dungeon.research),
        dungeon,
        gold: await $asset.get("gold"),
      };
    });
  }

  /** Entitlements only — used to refresh the client after the shop dialog closes. */
  async getEntitlements() {
    const state = await $global.getMyState();
    return {
      entitlements: (state && state.entitlements) || emptyEntitlements(),
      gold: await $asset.get("gold"),
    };
  }

  /**
   * Persists the dungeon layout. The client batches placements in memory and
   * calls this at checkpoints only (remoteFunction is rate limited to ~10
   * calls/sec).
   *
   * The server recomputes the cost from the diff instead of trusting a client
   * total. There is no terrain any more, so nothing here validates a route —
   * a sealed room is a legal, if expensive, thing to build.
   */
  async saveDungeon(payload) {
    if (!payload || typeof payload !== "object") throw new Error("BAD_PAYLOAD");

    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const prev = state.dungeon;
    const research = prev.research || [];
    const arena = arenaFor(research);

    const nextRooms = payload.rooms || prev.rooms || [];
    const nextTraps = payload.traps || prev.traps || [];
    const nextMinions = payload.minions || prev.minions || [];
    const nextObstacles = payload.obstacles || prev.obstacles || [];

    // Locked content cannot be placed, whatever the client sends.
    const unlocked = researchEffects(research);
    for (const room of nextRooms) {
      if (unlocked.unlockedRooms.indexOf(room.type) === -1) throw new Error("ROOM_LOCKED");
    }
    for (const trap of nextTraps) {
      if (unlocked.unlockedTraps.indexOf(trap.type) === -1) throw new Error("TRAP_LOCKED");
    }
    for (const minion of nextMinions) {
      if (unlocked.unlockedMinions.indexOf(minion.type) === -1) {
        throw new Error("MINION_LOCKED");
      }
    }

    // Everything is priced against the same arena, and one occupant ever
    // holds a tile. The entrance and core are claimed before anything else,
    // so a room, trap, minion or obstacle can never land on either. Rooms
    // claim their tiles first, then traps, then minions, then obstacles.
    // Both come from the arena, never from the stored fields — a save carrying
    // a stale core would otherwise reserve a tile the client does not draw a
    // core on, refusing a legal placement while leaving the real core buildable.
    // It also means a save missing either field cannot throw a TypeError here.
    const entrance = entranceOf(arena);
    const core = coreOf(arena);

    const claimed = new Set();
    claimed.add(`${entrance.x},${entrance.y}`);
    claimed.add(`${core.x},${core.y}`);

    const roomCost = priceRooms(nextRooms, prev.rooms || [], arena, claimed);
    const trapCost = priceTraps(nextTraps, prev.traps || [], arena, claimed);
    const owned = (state && state.entitlements) || emptyEntitlements();
    const effects = roomEffects(nextRooms, owned);
    const minionCost = priceMinions(
      nextMinions,
      prev.minions || [],
      arena,
      claimed,
      effects.minionCap,
    );
    const obstacleCost = priceObstacles(
      nextObstacles,
      prev.obstacles || [],
      arena,
      research,
      claimed,
      owned,
    );

    // What the player cleared since the last save comes back in full. The
    // two are settled against each other rather than paid separately, so a
    // save that swaps one wall for another moves the difference and nothing
    // more.
    const refund =
      refundFor(nextRooms, prev.rooms || [], ROOM_COST) +
      refundFor(nextTraps, prev.traps || [], TRAP_COST) +
      refundFor(nextMinions, prev.minions || [], MINION_COST) +
      refundFor(nextObstacles, prev.obstacles || [], OBSTACLE_COST);

    const cost = roomCost + trapCost + minionCost + obstacleCost - refund;
    if (cost > 0) {
      const affordable = await $asset.has("gold", cost);
      if (!affordable) throw new Error("INSUFFICIENT_GOLD");
      await $asset.burn("gold", cost);
    } else if (cost < 0) {
      await $asset.mint("gold", -cost);
    }

    const now = Date.now();
    const dungeon = {
      version: SAVE_VERSION,
      obstacles: nextObstacles,
      minions: sanitizeMinions(nextMinions, prev.minions || [], prev.loot || []),
      traps: nextTraps,
      rooms: nextRooms,
      loot: prev.loot || [],
      prisoners: prev.prisoners || [],
      adventurers: prev.adventurers || [],
      research: prev.research || [],
      // Rebuilt from a field list, so anything not named here is dropped.
      milestonesSeen: prev.milestonesSeen || [],
      threatCheckedAt: prev.threatCheckedAt,
      // Still written, but written derived. Keeping the fields means the save
      // shape does not change under the client, and every save quietly repairs
      // a stale pair; deriving them means no reader ever depends on that.
      entrance,
      core,
      threat: prev.threat,
      wavesRepelled: prev.wavesRepelled,
      coreBreaches: prev.coreBreaches,
      createdAt: prev.createdAt,
      updatedAt: now,
      lastSeenAt: now,
    };
    await $global.updateMyState({ dungeon });

    return {
      ok: true,
      obstacleCost,
      minionCost,
      trapCost,
      roomCost,
      cost,
      effects,
      gold: await $asset.get("gold"),
      savedAt: now,
    };
  }

  // -------------------------------------------------------------------------
  // Raids
  // -------------------------------------------------------------------------

  /**
   * Opens a raid. The party is built here, not on the client, so a player
   * cannot pick an easy wave. A sealed room — no route from entrance to core —
   * is a legal, and expensive, way to buy time: the party simply breaks
   * through the nearest obstacle once the raid runs.
   */
  async startRaid() {
    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const dungeon = state.dungeon;
    const now = Date.now();

    // A raid left unresolved is settled as a loss before a new one opens.
    if (state.pendingRaid) abandonPendingRaid(dungeon, state.pendingRaid, now);

    const threat = decayThreat(dungeon, now);
    // Announced once, on the raid that first arrives at the tier. The save is
    // written back below, so the mark sticks.
    const milestoneReached = crossMilestones(dungeon, threat);
    /*
     * One party per wave, each drawn after the last.
     *
     * pickParty marks who it takes as raiding, so calling it again hands back
     * the next people rather than the same ones - which is what makes wave
     * three a different and harder group than wave one. Threat rises by two
     * per wave for the same reason.
     */
    const waves = [];
    for (let i = 0; i < WAVES_PER_RAID; i++) {
      const wave = pickParty(dungeon, threat + i * 2, now);
      if (wave.length === 0) break;
      waves.push(wave);
    }

    const party = waves.length > 0 ? waves[0] : [];

    // Should be impossible now that abandoned raids release their party, but
    // an empty party resolves as an instant free win, so it is refused.
    if (party.length === 0) throw new Error("NO_ADVENTURERS");
    const raidId = "raid-" + now + "-" + party.length;
    const seed = (now ^ (threat * 2654435761)) >>> 0;

    // Minions killed in an earlier raid are still down; the server decides who
    // is on the roster so a client cannot field its dead.
    const availableMinionIds = (dungeon.minions || [])
      .filter((m) => !m.revivesAt || m.revivesAt <= now)
      .map((m) => m.id);

    const effects = roomEffects(dungeon.rooms || [], (state && state.entitlements) || emptyEntitlements());
    const jailFree = Math.max(
      0,
      effects.jailCapacity - (dungeon.prisoners || []).length,
    );

    await $global.updateMyState({
      dungeon,
      // Every wave's members, flattened: this is the list finishRaid checks
      // reported kills against, and a kill in wave one is as real as one in
      // wave three.
      pendingRaid: {
        raidId,
        seed,
        party: waves.flat(),
        waves,
        threat,
        jailFree,
        startedAt: now,
      },
    });

    return {
      raidId,
      seed,
      party,
      waves,
      threat,
      milestoneReached,
      availableMinionIds,
      jailFree,
      effects,
      research: researchEffects(dungeon.research || []),
    };
  }

  /**
   * Closes a raid and pays out. The client reports the outcome, but the amount
   * comes from the table above and is clamped to the party the server issued,
   * so an inflated report cannot pay more than a perfect raid would have.
   */
  async finishRaid({
    raidId,
    outcome,
    killedIds,
    capturedIds,
    lostMinionIds,
    destroyedObstacleIds,
  }) {
    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const pending = state.pendingRaid;
    if (!pending || pending.raidId !== raidId) throw new Error("NO_PENDING_RAID");
    if (outcome !== "repelled" && outcome !== "breached") throw new Error("BAD_OUTCOME");

    const dungeon = state.dungeon;
    const effects = roomEffects(dungeon.rooms || [], (state && state.entitlements) || emptyEntitlements());
    const now = Date.now();

    // Only members of the party the server issued count, and nobody can be
    // both looted and captured — the client reporting both gets the capture
    // dropped, matching the exclusive rule in the simulation.
    const partyIds = pending.party.map((m) => m.id);
    const inParty = (id) => partyIds.indexOf(id) !== -1;

    const captured = (Array.isArray(capturedIds) ? capturedIds : [])
      .filter(inParty)
      .filter((id, i, list) => list.indexOf(id) === i)
      .slice(0, Math.max(0, pending.jailFree || 0));

    const killedList = (Array.isArray(killedIds) ? killedIds : [])
      .filter(inParty)
      .filter((id, i, list) => list.indexOf(id) === i)
      .filter((id) => captured.indexOf(id) === -1);

    const kills = killedList.length + captured.length;

    // Stopping the leader is the whole point of the raid it leads, so it pays
    // whether it was killed or taken - and it pays on a breach too, because a
    // party that got through having lost its champion is still a party that
    // lost its champion.
    const championId = ((pending.party || []).find((m) => m.champion) || {}).id || null;
    const championStopped =
      championId !== null &&
      (killedList.indexOf(championId) !== -1 || captured.indexOf(championId) !== -1);

    let reward = 0;
    let plundered = 0;

    // A louder dungeon pays better, which is what makes raising threat a
    // choice rather than a penalty.
    const threatBonus = 1 + (pending.threat || 0) * THREAT_REWARD_STEP;

    if (outcome === "repelled") {
      reward = RAID_BASE_REWARD + RAID_REWARD_PER_KILL * kills;
      if (championStopped) reward += RAID_CHAMPION_REWARD;
      // Treasuries pay out only when the loot is successfully defended.
      reward += TREASURY_REWARD * effects.treasuryCount;
      reward = Math.round(reward * threatBonus);
    } else {
      reward = Math.round(
        (RAID_BREACH_REWARD_PER_KILL * kills + (championStopped ? RAID_CHAMPION_REWARD : 0)) *
          threatBonus,
      );
      const gold = await $asset.get("gold");
      const rate = RAID_PLUNDER_RATE * effects.plunderScale;
      plundered = Math.min(Math.floor(gold * rate), RAID_PLUNDER_CAP);
    }

    if (plundered > 0) await $asset.burn("gold", plundered);
    if (reward > 0) await $asset.mint("gold", reward);

    // Killing yields gear; capturing yields a person. Never both.
    const roster = Array.isArray(dungeon.adventurers) ? dungeon.adventurers : [];
    const lootGained = [];
    const capturedNames = [];

    for (const record of roster) {
      if (killedList.indexOf(record.id) !== -1) {
        lootGained.push({
          id: "loot-" + now + "-" + record.id,
          srcCls: record.cls,
          tier: lootTierFor(record.level),
        });
        // Losing teaches them something: they come back stronger.
        record.level += 1;
        record.raids += 1;
        record.state = "town";
        record.returnsAt = now + ADVENTURER_RETURN_MS;
      } else if (captured.indexOf(record.id) !== -1) {
        record.raids += 1;
        record.state = "captured";
        record.returnsAt = 0;
        capturedNames.push(record.name);
        dungeon.prisoners = (dungeon.prisoners || []).concat([
          {
            advId: record.id,
            cls: record.cls,
            name: record.name,
            level: record.level,
            convertsAt: now + CONVERT_MS_PER_LEVEL * record.level,
          },
        ]);
      } else if (record.state === "raiding") {
        // Walked out alive; regroups quickly.
        record.raids += 1;
        record.state = "town";
        record.returnsAt = now + ADVENTURER_REGROUP_MS;
      }
    }

    dungeon.adventurers = roster;
    dungeon.loot = (dungeon.loot || []).concat(lootGained);

    // Minions that fell go on a revive timer; altars shorten it.
    const downTime = Math.round(BASE_REVIVE_MS * effects.reviveScale);
    const lost = Array.isArray(lostMinionIds) ? lostMinionIds : [];
    dungeon.minions = (dungeon.minions || []).map((minion) =>
      lost.indexOf(minion.id) === -1
        ? minion
        : { ...minion, revivesAt: now + downTime },
    );

    // Walls the party broke through to reach the core are gone for good —
    // removing an obstacle refunds nothing, so a client that lies here only
    // destroys its own walls and pays to rebuild them.
    const destroyed = new Set(
      Array.isArray(destroyedObstacleIds) ? destroyedObstacleIds : [],
    );
    dungeon.obstacles = (dungeon.obstacles || []).filter((o) => !destroyed.has(o.id));

    const threatDelta =
      (outcome === "repelled" ? 1 : -1) +
      (outcome === "repelled" ? effects.treasuryCount * TREASURY_THREAT : 0);
    const threat = Math.max(0, (dungeon.threat || 0) + threatDelta);

    dungeon.threat = threat;
    dungeon.wavesRepelled = (dungeon.wavesRepelled || 0) + (outcome === "repelled" ? 1 : 0);
    dungeon.coreBreaches = (dungeon.coreBreaches || 0) + (outcome === "breached" ? 1 : 0);
    dungeon.updatedAt = Date.now();
    dungeon.lastSeenAt = Date.now();

    await $global.updateMyState({ dungeon, pendingRaid: null });

    return {
      outcome,
      reward,
      championStopped,
      plundered,
      gold: await $asset.get("gold"),
      threat,
      wavesRepelled: dungeon.wavesRepelled,
      coreBreaches: dungeon.coreBreaches,
      minions: dungeon.minions,
      obstacles: dungeon.obstacles,
      loot: dungeon.loot,
      lootGained,
      prisoners: dungeon.prisoners || [],
      capturedNames,
      adventurers: dungeon.adventurers,
      effects,
    };
  }

  /**
   * Development helper: wipes the dungeon back to its starting layout.
   * Entitlements survive — resetting progress must never revoke a purchase.
   */
  async resetGame() {
    const state = await $global.getMyState();
    const entitlements = (state && state.entitlements) || emptyEntitlements();

    const dungeon = createDefaultDungeon();
    await $global.updateMyState({ dungeon });

    const gold = await $asset.get("gold");
    if (gold < START_GOLD) await $asset.mint("gold", START_GOLD - gold);
    else if (gold > START_GOLD) await $asset.burn("gold", gold - START_GOLD);

    return { dungeon, entitlements, gold: await $asset.get("gold"), created: true };
  }

  // -------------------------------------------------------------------------
  // VXShop
  // -------------------------------------------------------------------------

  /**
   * System handler fired by Verse8 when a VX Shop purchase completes.
   * This is the only place an entitlement is granted — the client is never
   * allowed to tell the server that something was bought.
   *
   * Note this runs as a platform event, so $sender is not the buyer: the
   * buyer's address arrives in `account` and state is written with
   * updateUserState rather than updateMyState.
   */
  async $onItemPurchased({ account, purchaseId, productId, quantity }) {
    // Unknown productId: refuse rather than silently swallowing a real payment.
    const result = await grantProduct(account, productId, purchaseId, quantity);
    return { success: result.success };
  }

  /**
   * Development helper: runs the real grant path without a payment.
   * Refuses unless the caller's own address is listed in DEV_ACCOUNTS, so
   * leaving it enabled cannot give anyone else a free entitlement.
   */
  async devGrantPurchase({ productId }) {
    const account = $sender.account;
    if (DEV_ACCOUNTS.indexOf(account) === -1) throw new Error("DEV_TOOL_DISABLED");

    const purchaseId = `dev-${productId}-${Date.now()}`;
    const result = await grantProduct(account, productId, purchaseId, 1);
    return { ...result, purchaseId, account };
  }

  /** Development helper: clears entitlements so the purchase can be retested. */
  async devClearEntitlements() {
    if (DEV_ACCOUNTS.indexOf($sender.account) === -1) throw new Error("DEV_TOOL_DISABLED");

    await $global.updateMyState({
      entitlements: emptyEntitlements(),
      grantedPurchases: [],
    });
    return { entitlements: emptyEntitlements() };
  }

  // -------------------------------------------------------------------------
  // Leaderboard
  // -------------------------------------------------------------------------

  /**
   * Publishes the dungeon's standing.
   *
   * The score is read from the save, never from the client, and one row is
   * kept per account so the board shows people rather than attempts. This is
   * a cumulative statistic, so it does not turn the game into a run chaser —
   * it just says how deep a dungeon has got.
   */
  async submitScore({ nickname }) {
    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const dungeon = state.dungeon;
    const account = $sender.account;
    const name = typeof nickname === "string" ? nickname.trim().slice(0, 20) : "";

    const entry = {
      __id: account,
      account,
      nickname: name || account.slice(0, 8),
      threat: dungeon.threat || 0,
      wavesRepelled: dungeon.wavesRepelled || 0,
      coreBreaches: dungeon.coreBreaches || 0,
      converts: (dungeon.minions || []).filter((m) => m.type === "convert").length,
      updatedAt: Date.now(),
    };

    // One row per account, keyed by __id, so the board lists people rather
    // than attempts. getCollectionItem returns {} when nothing is stored.
    const existing = await $global.getCollectionItem(LEADERBOARD, account);
    if (existing && existing.account) {
      await $global.updateCollectionItem(LEADERBOARD, entry);
    } else {
      await $global.addCollectionItem(LEADERBOARD, entry);
    }

    return { ok: true, entry };
  }

  /** Top rows plus the caller's own, so a player always sees themselves. */
  async getRankings({ limit } = {}) {
    const account = $sender.account;
    const size = Math.max(1, Math.min(50, Math.floor(limit || 20)));

    // Filters and orderBy cannot be combined, so the caller's row is fetched
    // by id instead of queried.
    const top = await $global.getCollectionItems(LEADERBOARD, {
      orderBy: [{ field: "wavesRepelled", direction: "desc" }],
      limit: size,
    });

    const mine = await $global.getCollectionItem(LEADERBOARD, account);
    return { top: top || [], mine: mine && mine.account ? mine : null };
  }

  /**
   * How much rewarded gold is left today, and when the next claim is allowed.
   *
   * Read-only, so the button can say "3 left" and disable itself instead of
   * letting a player watch an ad and only then be told it paid nothing.
   */
  async adGoldStatus() {
    const now = Date.now();
    const state = await $global.getMyState();
    const claims = adClaimsToday(state, now);
    const threat = (state && state.dungeon && state.dungeon.threat) || 0;

    return {
      remaining: Math.max(0, AD_GOLD_DAILY_LIMIT - claims.count),
      limit: AD_GOLD_DAILY_LIMIT,
      reward: adGoldReward(threat),
      readyAt: claims.lastAt ? claims.lastAt + AD_GOLD_COOLDOWN_MS : 0,
      now,
    };
  }

  /**
   * Pays out for a watched ad.
   *
   * Nothing here can tell whether the ad was watched — see the note on
   * AD_GOLD_DAILY_LIMIT. The daily count and the cooldown are what make that
   * not matter: this is the same money an honest player gets, and no more.
   */
  async claimAdGold() {
    const now = Date.now();
    const state = (await $global.getMyState()) || {};
    const claims = adClaimsToday(state, now);

    if (claims.count >= AD_GOLD_DAILY_LIMIT) throw new Error("AD_LIMIT_REACHED");
    if (claims.lastAt && now - claims.lastAt < AD_GOLD_COOLDOWN_MS) {
      throw new Error("AD_COOLDOWN");
    }

    const threat = (state.dungeon && state.dungeon.threat) || 0;
    const reward = adGoldReward(threat);
    await $asset.mint("gold", reward);

    await $global.updateMyState({
      adClaims: { day: claims.day, count: claims.count + 1, lastAt: now },
    });

    return {
      reward,
      gold: await $asset.get("gold"),
      remaining: AD_GOLD_DAILY_LIMIT - (claims.count + 1),
      readyAt: now + AD_GOLD_COOLDOWN_MS,
    };
  }

  /** Connectivity probe used by the client before it trusts the save path. */
  async ping() {
    return { pong: Date.now(), account: $sender.account };
  }

  /**
   * Reports which host capabilities the sandbox actually exposes.
   *
   * Rewarded-ad payouts need an outbound HTTP call to the Verse8 verifier, and
   * `fetch` turned out to be absent. This says what, if anything, can replace
   * it. Returns only capability names — no state, no secrets.
   */
  async capabilities() {
    const names = [
      "fetch",
      "XMLHttpRequest",
      "Request",
      "Response",
      "Headers",
      "WebSocket",
      "require",
      "process",
      "Buffer",
      "crypto",
      "TextEncoder",
      "setTimeout",
      "$http",
      "$fetch",
      "$net",
      "$request",
      "$verse8",
      "$ads",
      "$lock",
      "$asset",
      "$global",
      "$sender",
    ];

    const found = {};
    for (const name of names) {
      try {
        found[name] = typeof globalThis[name];
      } catch (error) {
        found[name] = "error";
      }
    }

    // Anything else the platform injected that is not a standard JS global.
    let injected = [];
    try {
      injected = Object.getOwnPropertyNames(globalThis).filter(
        (key) => key.startsWith("$") || key.startsWith("agent8") || key.startsWith("verse"),
      );
    } catch (error) {
      injected = ["enumeration_failed"];
    }

    return { found, injected };
  }

  /**
   * Checks that $lock actually runs.
   *
   * It does not appear on globalThis, but neither does $sender, which plainly
   * works — some contexts are injected into function scope instead. Purchase
   * grants, conversions and research all rely on $lock for their
   * read-modify-write, so a silent absence would mean those guards are not
   * there at all.
   */
  async probeLock() {
    const out = { onGlobalThis: typeof globalThis.$lock, inScope: typeof $lock };

    try {
      out.returned = await $lock(`probe:${$sender.account}`, async () => "ran");
    } catch (error) {
      out.error = String((error && error.message) || error);
    }

    // Nested different keys, the shape the purchase path uses.
    try {
      out.nested = await $lock(`probe-a:${$sender.account}`, async () =>
        $lock(`probe-b:${$sender.account}`, async () => "nested-ran"),
      );
    } catch (error) {
      out.nestedError = String((error && error.message) || error);
    }

    // What the shop context exposes, since it is undocumented.
    try {
      out.shop = typeof $shop === "undefined" ? "undefined" : Object.keys($shop);
    } catch (error) {
      out.shop = "error";
    }

    return out;
  }
}
