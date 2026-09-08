// DUNGEON WARDEN - Verse8 / Agent8 game server
// Runs in an isolated-vm: no fs / http / axios / Node builtins.
// Only $sender, $global, $room, $asset are available.
// Do NOT export this class.

const SAVE_VERSION = 1;

const GRID_W = 12;
const GRID_H = 12;

const TILE_ROCK = 0;
const TILE_FLOOR = 1;
const TILE_ENTRANCE = 2;
const TILE_CORE = 3;

const DIG_COST = 10;
const START_GOLD = 200;

// Mirrored in src/game/types.ts and src/game/sim/units.ts.
const BASE_MAX_MINIONS = 8;
const MINION_COST = { warrior: 50, mage: 70 };

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
  mage: { cost: 150, unlockMinion: "mage" },
  trap_arrow: { cost: 120, unlockTrap: "arrow" },
  trap_rock: { cost: 200, requires: ["trap_arrow"], unlockTrap: "rockfall" },
  trap_flame: { cost: 280, requires: ["trap_rock"], unlockTrap: "flame" },

  room_barracks: { cost: 180, unlockRoom: "barracks" },
  room_vault: { cost: 200, unlockRoom: "vault" },
  room_workshop: { cost: 220, requires: ["trap_arrow"], unlockRoom: "workshop" },
  room_altar: { cost: 260, requires: ["room_barracks"], unlockRoom: "altar" },
  room_jail: { cost: 300, requires: ["room_barracks"], unlockRoom: "jail" },

  might1: { cost: 200, minionDamage: 0.1 },
  might2: { cost: 400, requires: ["might1"], minionDamage: 0.2 },
  vigor1: { cost: 200, minionHp: 0.15 },
  vigor2: { cost: 400, requires: ["vigor1"], minionHp: 0.3 },
  trap_power1: { cost: 250, requires: ["trap_arrow"], trapDamage: 0.2 },
  trap_power2: { cost: 500, requires: ["trap_power1"], trapDamage: 0.4 },

  expand1: { cost: 500, expandTo: 16 },
  expand2: { cost: 900, requires: ["expand1"], expandTo: 20 },
};

const BASE_MINIONS = ["warrior", "convert"];
const BASE_TRAPS = ["spike"];
const BASE_ROOMS = ["treasury"];

/** Threat decays while the dungeon stays quiet, so a bad streak is survivable. */
const THREAT_DECAY_MS = 20 * 60 * 1000;
/** Each point of threat raises payouts, making a loud dungeon worth running. */
const THREAT_REWARD_STEP = 0.05;
const MAX_GRID_WIDTH = 20;

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
    const node = RESEARCH[id];
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

/**
 * Widens the dungeon and moves the core to the new far wall.
 *
 * The old core tile becomes ordinary corridor and the fresh columns are solid
 * rock, so the player has to dig their way deeper — the expansion is a new
 * problem, not free space.
 */
function expandGrid(dungeon, newWidth) {
  const w = dungeon.grid.w;
  const h = dungeon.grid.h;
  if (newWidth <= w) return false;
  if (newWidth > MAX_GRID_WIDTH) return false;

  const cells = decodeRLE(dungeon.grid.cells, w * h);
  if (!cells) throw new Error("BAD_GRID");

  const next = new Array(newWidth * h).fill(TILE_ROCK);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) next[y * newWidth + x] = cells[y * w + x];
  }

  const coreY = dungeon.core.y;
  next[coreY * newWidth + dungeon.core.x] = TILE_FLOOR;
  const newCoreX = newWidth - 1;
  next[coreY * newWidth + newCoreX] = TILE_CORE;

  dungeon.grid = { w: newWidth, h, cells: encodeRLE(next) };
  dungeon.core = { x: newCoreX, y: coreY };
  return true;
}


// Raid payouts. Kept on the server so a client cannot invent its own reward.
const RAID_BASE_REWARD = 20;
const RAID_REWARD_PER_KILL = 15;
const RAID_BREACH_REWARD_PER_KILL = 8;
const RAID_PLUNDER_RATE = 0.15;
const RAID_PLUNDER_CAP = 120;

// Order matters: this is the sequence classes join the roster in as threat
// rises, so a new dungeon only ever faces knights.
const ADVENTURER_CLASSES = ["knight", "barbarian", "rogue", "ranger", "mage"];

const ADVENTURER_NAMES = [
  "Aldric", "Brenna", "Cedric", "Dahlia", "Edmund",
  "Fiora", "Gareth", "Halina", "Ivor", "Junia",
];

// A single save call may not contain more digs than this. Guards against a
// client replaying a huge grid diff in one request.
const MAX_DIGS_PER_SAVE = 64;

// ---------------------------------------------------------------------------
// VXShop
// ---------------------------------------------------------------------------
// productId here must match the Product ID registered in the Verse8 dashboard
// (game management page -> VX Shop tab). Registering a product does not put it
// on sale by itself; the game has to grant it, which is what $onItemPurchased
// below does.
const PRODUCTS = {
  remove_ads: { grants: "adsRemoved", repeatable: false },
};

// Accounts allowed to call devGrantPurchase, which exercises the grant path
// without a real payment. Empty means the dev tool is off for everyone.
//
// Put ONLY your own wallet address here (the HUD prints it at the bottom left),
// and remove it before a public release. Even if left populated, no other
// account can use it.
const DEV_ACCOUNTS = [];

// Remembering every purchase forever would grow the save without bound, and
// only recent ids matter for replay protection.
const MAX_TRACKED_PURCHASES = 50;
const MAX_TRACKED_AD_CLAIMS = 50;

// ---------------------------------------------------------------------------
// Rewarded ads
// ---------------------------------------------------------------------------
// Reward amounts live on the server. The client's `result.reward` is a UX hint
// and must never be trusted.
const AD_REWARD_TABLE = {
  "gold-refill": 100,
};

/**
 * Rewarded ads are capped per day.
 *
 * Without a cap, 100 gold a view is an unbounded income source and the entire
 * build economy stops meaning anything. The ad network's own fill limits are
 * not a substitute — they are not a game rule.
 */
const AD_CLAIMS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const ADS_VERIFIER_URL = "https://ads-verifier.verse8.io/ads/status";

function emptyEntitlements() {
  return { adsRemoved: false };
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
  const product = PRODUCTS[productId];
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

    if (product.grants === "adsRemoved") {
      entitlements.adsRemoved = true;
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

/** cells:number[] -> "count*tile,count*tile" */
function encodeRLE(cells) {
  const parts = [];
  let run = 1;
  for (let i = 1; i <= cells.length; i++) {
    if (i < cells.length && cells[i] === cells[i - 1]) {
      run++;
    } else {
      parts.push(run + "*" + cells[i - 1]);
      run = 1;
    }
  }
  return parts.join(",");
}

/** "count*tile,..." -> number[] of exactly `length`, or null when malformed */
function decodeRLE(str, length) {
  if (typeof str !== "string" || str.length === 0) return null;
  const cells = [];
  const parts = str.split(",");
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i].split("*");
    if (seg.length !== 2) return null;
    const run = Number(seg[0]);
    const tile = Number(seg[1]);
    if (!Number.isInteger(run) || run <= 0) return null;
    if (!Number.isInteger(tile) || tile < 0 || tile > 3) return null;
    if (cells.length + run > length) return null;
    for (let k = 0; k < run; k++) cells.push(tile);
  }
  return cells.length === length ? cells : null;
}

/**
 * Breadth-first reachability over non-rock tiles.
 * Only existence matters here, so BFS is enough — the client runs the full A*
 * to get the actual route.
 */
function hasPath(cells, w, h, start, goal) {
  const startIndex = start.y * w + start.x;
  const goalIndex = goal.y * w + goal.x;
  if (cells[startIndex] === TILE_ROCK || cells[goalIndex] === TILE_ROCK) return false;

  const seen = new Uint8Array(w * h);
  const queue = [startIndex];
  seen[startIndex] = 1;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goalIndex) return true;

    const cx = current % w;
    const cy = Math.floor(current / w);
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let i = 0; i < steps.length; i++) {
      const nx = cx + steps[i][0];
      const ny = cy + steps[i][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

      const next = ny * w + nx;
      if (seen[next] || cells[next] === TILE_ROCK) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

/**
 * Validates a minion roster against the grid and charges for what is new.
 * Removals are free but refund nothing, and changing an existing id's type is
 * charged in full so a client cannot swap a cheap unit for an expensive one.
 */
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
function roomEffects(rooms) {
  let minionCap = BASE_MAX_MINIONS;
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

  for (const member of party) member.state = "raiding";
  dungeon.adventurers = roster;

  return party.map((member) => ({
    id: member.id,
    cls: member.cls,
    name: member.name,
    level: member.level,
  }));
}

/**
 * Validates rooms and charges for new ones.
 *
 * Rooms claim four corridor tiles each, and nothing else may sit on them, so
 * this returns the claimed tiles for the minion and trap checks to respect.
 */
function priceRooms(nextRooms, prevRooms, cells, w, h) {
  if (!Array.isArray(nextRooms)) throw new Error("BAD_ROOMS");
  if (nextRooms.length > MAX_ROOMS) throw new Error("TOO_MANY_ROOMS");

  const prevById = {};
  for (const room of prevRooms || []) prevById[room.id] = room;

  const seenIds = {};
  const claimed = {};
  let cost = 0;

  for (const room of nextRooms) {
    if (!room || typeof room.id !== "string") throw new Error("BAD_ROOM_ID");
    if (seenIds[room.id]) throw new Error("DUPLICATE_ROOM_ID");
    seenIds[room.id] = true;

    const price = ROOM_COST[room.type];
    if (!price) throw new Error("UNKNOWN_ROOM_TYPE");

    for (const tile of roomTiles(room)) {
      if (tile.x < 0 || tile.y < 0 || tile.x >= w || tile.y >= h) {
        throw new Error("ROOM_OUT_OF_BOUNDS");
      }
      if (cells[tile.y * w + tile.x] !== TILE_FLOOR) throw new Error("ROOM_NOT_ON_FLOOR");

      const key = tile.x + ":" + tile.y;
      if (claimed[key]) throw new Error("ROOM_OVERLAP");
      claimed[key] = true;
    }

    const previous = prevById[room.id];
    if (!previous || previous.type !== room.type) cost += price;
  }

  return { cost, claimed };
}

/** Validates traps and charges for new ones. */
function priceTraps(nextTraps, prevTraps, cells, w, h, claimed) {
  if (!Array.isArray(nextTraps)) throw new Error("BAD_TRAPS");
  if (nextTraps.length > MAX_TRAPS) throw new Error("TOO_MANY_TRAPS");

  const prevById = {};
  for (const trap of prevTraps || []) prevById[trap.id] = trap;

  const seenIds = {};
  let cost = 0;

  for (const trap of nextTraps) {
    if (!trap || typeof trap.id !== "string") throw new Error("BAD_TRAP_ID");
    if (seenIds[trap.id]) throw new Error("DUPLICATE_TRAP_ID");
    seenIds[trap.id] = true;

    const price = TRAP_COST[trap.type];
    if (!price) throw new Error("UNKNOWN_TRAP_TYPE");

    if (!Number.isInteger(trap.x) || !Number.isInteger(trap.y)) {
      throw new Error("BAD_TRAP_POSITION");
    }
    if (trap.x < 0 || trap.y < 0 || trap.x >= w || trap.y >= h) {
      throw new Error("BAD_TRAP_POSITION");
    }
    if (cells[trap.y * w + trap.x] !== TILE_FLOOR) throw new Error("TRAP_NOT_ON_FLOOR");

    const key = trap.x + ":" + trap.y;
    if (claimed[key]) throw new Error("TILE_OCCUPIED");
    claimed[key] = true;

    const previous = prevById[trap.id];
    if (!previous || previous.type !== trap.type) cost += price;
  }

  return cost;
}

function priceMinions(nextMinions, prevMinions, cells, w, h, claimed, minionCap) {
  if (!Array.isArray(nextMinions)) throw new Error("BAD_MINIONS");
  if (nextMinions.length > minionCap) throw new Error("TOO_MANY_MINIONS");

  const prevById = {};
  for (const minion of prevMinions || []) prevById[minion.id] = minion;

  const seenIds = {};
  let cost = 0;

  for (const minion of nextMinions) {
    if (!minion || typeof minion.id !== "string") throw new Error("BAD_MINION_ID");
    if (seenIds[minion.id]) throw new Error("DUPLICATE_MINION_ID");
    seenIds[minion.id] = true;

    const price = MINION_COST[minion.type];
    if (price === undefined) throw new Error("UNKNOWN_MINION_TYPE");

    // Converts are earned by capturing and are created by the server alone.
    // A client that invents one is rejected outright.
    if (minion.type === "convert" && !prevById[minion.id]) {
      throw new Error("ILLEGAL_CONVERT");
    }

    if (!Number.isInteger(minion.x) || !Number.isInteger(minion.y)) {
      throw new Error("BAD_MINION_POSITION");
    }
    if (minion.x < 0 || minion.y < 0 || minion.x >= w || minion.y >= h) {
      throw new Error("BAD_MINION_POSITION");
    }

    // Minions stand in corridors only — never in rock, the entrance or the core.
    if (cells[minion.y * w + minion.x] !== TILE_FLOOR) {
      throw new Error("MINION_NOT_ON_FLOOR");
    }

    const cellKey = minion.x + ":" + minion.y;
    if (claimed[cellKey]) throw new Error("TILE_OCCUPIED");
    claimed[cellKey] = true;

    const previous = prevById[minion.id];
    if (!previous || previous.type !== minion.type) cost += price;
  }

  return cost;
}

/**
 * Rebuilds the minion list from trusted fields.
 *
 * The client may move minions and swap which looted weapon each carries, but
 * class, level and revive timers come from the previous save, and a weapon must
 * actually be in the loot pile and held by only one minion.
 */
function sanitizeMinions(nextMinions, prevMinions, loot) {
  const prevById = {};
  for (const minion of prevMinions || []) prevById[minion.id] = minion;

  const lootIds = {};
  for (const item of loot || []) lootIds[item.id] = true;

  const usedWeapons = {};
  return nextMinions.map((minion) => {
    const previous = prevById[minion.id] || {};

    let weaponId = minion.weaponId || null;
    if (weaponId && (!lootIds[weaponId] || usedWeapons[weaponId])) weaponId = null;
    if (weaponId) usedWeapons[weaponId] = true;

    return {
      id: minion.id,
      type: minion.type,
      x: minion.x,
      y: minion.y,
      revivesAt: previous.revivesAt || null,
      cls: previous.cls,
      level: previous.level,
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
function resolveConversions(dungeon, cells, w, h, now) {
  const prisoners = Array.isArray(dungeon.prisoners) ? dungeon.prisoners : [];
  if (prisoners.length === 0) return { converted: [], prisoners };

  const occupied = {};
  for (const minion of dungeon.minions || []) occupied[minion.x + ":" + minion.y] = true;
  for (const trap of dungeon.traps || []) occupied[trap.x + ":" + trap.y] = true;

  // Converts appear in a jail if there is room, otherwise on any free corridor.
  const preferred = [];
  for (const room of dungeon.rooms || []) {
    if (room.type !== "jail") continue;
    for (const tile of roomTiles(room)) preferred.push(tile);
  }
  const fallback = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] === TILE_FLOOR) fallback.push({ x, y });
    }
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

function createDefaultDungeon() {
  const cells = new Array(GRID_W * GRID_H).fill(TILE_ROCK);
  const midY = Math.floor(GRID_H / 2);

  const entranceIndex = midY * GRID_W + 0;
  const coreIndex = midY * GRID_W + (GRID_W - 1);
  cells[entranceIndex] = TILE_ENTRANCE;
  cells[coreIndex] = TILE_CORE;

  // Carve one tile in front of each fixed tile so the player has a seed to work from.
  cells[midY * GRID_W + 1] = TILE_FLOOR;
  cells[midY * GRID_W + (GRID_W - 2)] = TILE_FLOOR;

  const now = Date.now();
  return {
    version: SAVE_VERSION,
    grid: { w: GRID_W, h: GRID_H, cells: encodeRLE(cells) },
    minions: [],
    traps: [],
    rooms: [],
    loot: [],
    prisoners: [],
    adventurers: [],
    research: [],
    entrance: { x: 0, y: midY },
    core: { x: GRID_W - 1, y: midY },
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

    if (state && state.dungeon && state.dungeon.version === SAVE_VERSION) {
      const dungeon = state.dungeon;
      if (!Array.isArray(dungeon.minions)) dungeon.minions = [];
      if (!Array.isArray(dungeon.traps)) dungeon.traps = [];
      if (!Array.isArray(dungeon.rooms)) dungeon.rooms = [];
      if (!Array.isArray(dungeon.loot)) dungeon.loot = [];
      if (!Array.isArray(dungeon.prisoners)) dungeon.prisoners = [];
      if (!Array.isArray(dungeon.adventurers)) dungeon.adventurers = [];
      if (!Array.isArray(dungeon.research)) dungeon.research = [];

      // Sentences are served between sessions, so conversions are settled on
      // load rather than by a timer the sandbox does not allow.
      const now = Date.now();
      const cells = decodeRLE(dungeon.grid.cells, dungeon.grid.w * dungeon.grid.h);
      let converted = [];
      if (cells) {
        converted = resolveConversions(
          dungeon,
          cells,
          dungeon.grid.w,
          dungeon.grid.h,
          now,
        ).converted;
      }

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

    const dungeon = createDefaultDungeon();
    await $global.updateMyState({ dungeon });
    await $asset.mint("gold", START_GOLD);

    return {
      dungeon,
      entitlements,
      gold: await $asset.get("gold"),
      created: true,
      research: researchEffects(dungeon.research),
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
    const node = RESEARCH[id];
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
      if (node.expandTo) expandGrid(dungeon, node.expandTo);
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
   * Persists the dungeon grid. The client batches digs in memory and calls this
   * at checkpoints only (remoteFunction is rate limited to ~10 calls/sec).
   *
   * The server recomputes the cost from the diff instead of trusting a client
   * total, and only ROCK -> FLOOR transitions are accepted.
   */
  async saveDungeon(payload) {
    if (!payload || !payload.grid || typeof payload.grid.cells !== "string") {
      throw new Error("BAD_PAYLOAD");
    }

    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const prev = state.dungeon;
    const w = prev.grid.w;
    const h = prev.grid.h;

    if (payload.grid.w !== w || payload.grid.h !== h) {
      throw new Error("GRID_SIZE_MISMATCH");
    }

    const prevCells = decodeRLE(prev.grid.cells, w * h);
    const nextCells = decodeRLE(payload.grid.cells, w * h);
    if (!prevCells || !nextCells) throw new Error("BAD_GRID");

    let digs = 0;
    for (let i = 0; i < prevCells.length; i++) {
      if (prevCells[i] === nextCells[i]) continue;
      if (prevCells[i] === TILE_ROCK && nextCells[i] === TILE_FLOOR) {
        digs++;
      } else {
        // Filling floor back in, moving the entrance, relocating the core:
        // none of these are legal client moves.
        throw new Error("ILLEGAL_TILE_CHANGE");
      }
    }

    if (digs > MAX_DIGS_PER_SAVE) throw new Error("TOO_MANY_DIGS");

    // Everything is priced against the new grid, so a minion, trap or room may
    // sit on a tile dug in this very save. Rooms claim their tiles first, then
    // traps, then minions — one occupant per tile.
    const nextRooms = payload.rooms || prev.rooms || [];
    const nextTraps = payload.traps || prev.traps || [];
    const nextMinions = payload.minions || prev.minions || [];

    // Locked content cannot be placed, whatever the client sends.
    const unlocked = researchEffects(prev.research || []);
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

    const roomPricing = priceRooms(nextRooms, prev.rooms || [], nextCells, w, h);
    const trapCost = priceTraps(
      nextTraps,
      prev.traps || [],
      nextCells,
      w,
      h,
      roomPricing.claimed,
    );
    const effects = roomEffects(nextRooms);
    const minionCost = priceMinions(
      nextMinions,
      prev.minions || [],
      nextCells,
      w,
      h,
      roomPricing.claimed,
      effects.minionCap,
    );

    const cost = digs * DIG_COST + roomPricing.cost + trapCost + minionCost;
    if (cost > 0) {
      const affordable = await $asset.has("gold", cost);
      if (!affordable) throw new Error("INSUFFICIENT_GOLD");
      await $asset.burn("gold", cost);
    }

    const now = Date.now();
    const dungeon = {
      version: SAVE_VERSION,
      grid: { w, h, cells: payload.grid.cells },
      minions: sanitizeMinions(nextMinions, prev.minions || [], prev.loot || []),
      traps: nextTraps,
      rooms: nextRooms,
      loot: prev.loot || [],
      prisoners: prev.prisoners || [],
      adventurers: prev.adventurers || [],
      research: prev.research || [],
      threatCheckedAt: prev.threatCheckedAt,
      entrance: prev.entrance,
      core: prev.core,
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
      digs,
      minionCost,
      trapCost,
      roomCost: roomPricing.cost,
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
   * cannot pick an easy wave. A dungeon with no route from entrance to core is
   * refused outright — sealing the core would otherwise be a free win.
   */
  async startRaid() {
    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const dungeon = state.dungeon;
    const w = dungeon.grid.w;
    const h = dungeon.grid.h;
    const cells = decodeRLE(dungeon.grid.cells, w * h);
    if (!cells) throw new Error("BAD_GRID");

    if (!hasPath(cells, w, h, dungeon.entrance, dungeon.core)) {
      throw new Error("NO_PATH");
    }

    const now = Date.now();

    // A raid left unresolved is settled as a loss before a new one opens.
    if (state.pendingRaid) abandonPendingRaid(dungeon, state.pendingRaid, now);

    const threat = decayThreat(dungeon, now);
    const party = pickParty(dungeon, threat, now);

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

    const effects = roomEffects(dungeon.rooms || []);
    const jailFree = Math.max(
      0,
      effects.jailCapacity - (dungeon.prisoners || []).length,
    );

    await $global.updateMyState({
      dungeon,
      pendingRaid: { raidId, seed, party, threat, jailFree, startedAt: now },
    });

    return {
      raidId,
      seed,
      party,
      threat,
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
  async finishRaid({ raidId, outcome, killedIds, capturedIds, lostMinionIds }) {
    const state = await $global.getMyState();
    if (!state || !state.dungeon) throw new Error("NO_SAVE");

    const pending = state.pendingRaid;
    if (!pending || pending.raidId !== raidId) throw new Error("NO_PENDING_RAID");
    if (outcome !== "repelled" && outcome !== "breached") throw new Error("BAD_OUTCOME");

    const dungeon = state.dungeon;
    const effects = roomEffects(dungeon.rooms || []);
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

    let reward = 0;
    let plundered = 0;

    // A louder dungeon pays better, which is what makes raising threat a
    // choice rather than a penalty.
    const threatBonus = 1 + (pending.threat || 0) * THREAT_REWARD_STEP;

    if (outcome === "repelled") {
      reward = RAID_BASE_REWARD + RAID_REWARD_PER_KILL * kills;
      // Treasuries pay out only when the loot is successfully defended.
      reward += TREASURY_REWARD * effects.treasuryCount;
      reward = Math.round(reward * threatBonus);
    } else {
      reward = Math.round(RAID_BREACH_REWARD_PER_KILL * kills * threatBonus);
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
      plundered,
      gold: await $asset.get("gold"),
      threat,
      wavesRepelled: dungeon.wavesRepelled,
      coreBreaches: dungeon.coreBreaches,
      minions: dungeon.minions,
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
  // Rewarded ads
  // -------------------------------------------------------------------------

  /**
   * Credits a rewarded-ad payout after checking it with the Verse8 verifier.
   *
   * The client sends only the requestId. The amount comes from the server-side
   * table, and the same requestId can never pay out twice.
   *
   * Returns { status: "pending" } when the verifier has not settled yet; the
   * client retries, because server code cannot sleep (no setTimeout).
   */
  async claimAdReward({ requestId, placementId }) {
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new Error("BAD_REQUEST_ID");
    }

    const reward = AD_REWARD_TABLE[placementId];
    if (!reward) throw new Error("UNKNOWN_PLACEMENT");

    if (typeof fetch !== "function") {
      // Never pay out an unverified reward. If this fires, the sandbox has no
      // outbound fetch and the reward flow needs a different design.
      throw new Error("VERIFY_UNAVAILABLE");
    }

    const response = await fetch(
      `${ADS_VERIFIER_URL}?requestId=${encodeURIComponent(requestId)}`,
    );
    if (response.status === 202) return { status: "pending" };
    if (!response.ok) throw new Error("VERIFY_FAILED");

    const body = await response.json();
    if (body.status === "pending") return { status: "pending" };
    if (body.status !== "verified") {
      return { status: body.status === "dismissed" ? "dismissed" : "failed" };
    }

    return await $lock(`adclaim:${$sender.account}`, async () => {
      const state = (await $global.getMyState()) || {};
      const claimed = state.grantedAdClaims || [];

      if (claimed.indexOf(requestId) !== -1) {
        return { status: "duplicate", gold: await $asset.get("gold") };
      }

      // Daily cap. The day bucket resets lazily, since there is no scheduler.
      const day = Math.floor(Date.now() / DAY_MS);
      const quota = state.adQuota && state.adQuota.day === day
        ? state.adQuota
        : { day, used: 0 };

      if (quota.used >= AD_CLAIMS_PER_DAY) {
        return {
          status: "capped",
          remaining: 0,
          gold: await $asset.get("gold"),
        };
      }

      await $asset.mint("gold", reward);
      await $global.updateMyState({
        grantedAdClaims: pushCapped(claimed, requestId, MAX_TRACKED_AD_CLAIMS),
        adQuota: { day, used: quota.used + 1 },
      });

      return {
        status: "granted",
        reward,
        remaining: AD_CLAIMS_PER_DAY - (quota.used + 1),
        gold: await $asset.get("gold"),
      };
    });
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
}
