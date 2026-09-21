// DUNGEON WARDEN - Verse8 / Agent8 game server
// Runs in an isolated-vm: no fs / http / axios / Node builtins.
// Only $sender, $global, $room, $asset are available.
// Do NOT export this class.

/*
 * An endless tower defence keeps almost nothing on the server.
 *
 * A run is played start to finish in the browser - gold, towers and waves
 * all live and die inside it - so what is worth keeping is what carries
 * between runs: the furthest a run has got, the souls runs have earned, and
 * the research those souls have bought. This file decides the things a
 * client must not decide for itself: whether a result could have been
 * played in the time it took, what it earns, and what can be afforded.
 */

const SAVE_VERSION = 4;

/**
 * Reads a key a client chose out of a plain-object table.
 *
 * `TABLE[key]` alone is not a membership test: every object inherits
 * `toString`, `constructor` and friends from Object.prototype, so a lookup
 * of "toString" would find a function. Every client-supplied key goes
 * through here so only an own key can answer.
 */
function ownEntry(table, key) {
  if (typeof key !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
// Mirrored from src/game/td/stages.ts; tests/td-server.test.ts checks them.

const WAVES_PER_STAGE = 5;
const SPAWN_INTERVAL = 0.9;
/** A result claiming more than this many waves is not believed. */
const MAX_WAVES = 400;

/** Adventurers in wave `index`, champion aside. */
function waveCount(index) {
  return 4 + Math.floor(index * 0.8);
}

/** The last wave of every stage from the second is led by a champion. */
function hasChampion(index) {
  return Math.floor(index / WAVES_PER_STAGE) + 1 >= 2 && index % WAVES_PER_STAGE === WAVES_PER_STAGE - 1;
}

/**
 * The least play `waves` cleared waves can take: every adventurer of every
 * one has to have come in, SPAWN_INTERVAL apart.
 */
function leastSeconds(waves) {
  let total = 0;
  for (let i = 0; i < waves; i++) {
    const size = waveCount(i) + (hasChampion(i) ? 1 : 0);
    total += (size - 1) * SPAWN_INTERVAL;
  }
  return total;
}

function stageOfWaves(waves) {
  return Math.floor(waves / WAVES_PER_STAGE) + 1;
}

/** Play speed the account may use: 3x is bought, 2x is free. */
const FREE_SPEED = 2;
const PAID_SPEED = 3;
/** Clock slack for the round trip and the first frame. */
const CLOCK_SLACK_MS = 1500;

function speedFor(state) {
  return state && state.entitlements && state.entitlements.fastForward === true ? PAID_SPEED : FREE_SPEED;
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
/* Mirrored from src/game/td/research.ts. Costs are in souls. */
const RESEARCH = {
  grunt: { cost: 1 },
  guard: { cost: 2 },
  mage: { cost: 3 },
  trap_arrow: { cost: 2 },
  trap_rock: { cost: 3, requires: ["trap_arrow"] },
  trap_flame: { cost: 4, requires: ["trap_rock"] },
  might1: { cost: 3 },
  might2: { cost: 5, requires: ["might1"] },
  trap_power1: { cost: 3, requires: ["trap_arrow"] },
  trap_power2: { cost: 5, requires: ["trap_power1"] },
  chest1: { cost: 2 },
  chest2: { cost: 4, requires: ["chest1"] },
  walls: { cost: 3, lives: 5 },
};

function soulsSpent(research) {
  let total = 0;
  for (const id of research) {
    const node = ownEntry(RESEARCH, id);
    if (node) total += node.cost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function emptyProgress() {
  return { version: SAVE_VERSION, bestWaves: 0, souls: 0, research: [] };
}

/** The saved progress, or a fresh one when there is none or it is from an older game. */
function progressOf(state) {
  const saved = state && state.progress;
  if (!saved || saved.version !== SAVE_VERSION) return emptyProgress();
  return {
    version: SAVE_VERSION,
    bestWaves: Math.max(0, Math.floor(saved.bestWaves || 0)),
    souls: Math.max(0, Math.floor(saved.souls || 0)),
    research: Array.isArray(saved.research) ? saved.research : [],
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------
// One row per account: how far its best run got. Ordered by waves cleared,
// which orders stages too.
const LEADERBOARD = "dungeon_endless";

function cleanName(nickname, account) {
  const name = typeof nickname === "string" ? nickname.trim().slice(0, 20) : "";
  return name || String(account).slice(0, 8);
}

async function writeRanking(account, nickname, bestWaves) {
  const entry = {
    __id: account,
    account,
    nickname: cleanName(nickname, account),
    waves: bestWaves,
    stage: stageOfWaves(bestWaves),
    updatedAt: Date.now(),
  };
  const existing = await $global.getCollectionItem(LEADERBOARD, account);
  if (existing && existing.account) await $global.updateCollectionItem(LEADERBOARD, entry);
  else await $global.addCollectionItem(LEADERBOARD, entry);
  return entry;
}

/** A client's wave count, or a refusal. */
function checkedWaves(value) {
  const waves = Math.floor(Number(value));
  if (!Number.isFinite(waves) || waves < 0 || waves > MAX_WAVES) throw new Error("BAD_WAVES");
  return waves;
}

/** Refuses a count of waves that could not have been played since the run opened. */
function checkPace(state, pending, waves) {
  const elapsed = Date.now() - pending.startedAt;
  const least = (leastSeconds(waves) * 1000) / speedFor(state) - CLOCK_SLACK_MS;
  if (elapsed < least) throw new Error("RUN_TOO_FAST");
}

/** Pays a run's souls into `progress`, keeps the best and ranks it. Does not save progress. */
async function settleRun(state, progress, waves) {
  const souls = Math.floor(waves / WAVES_PER_STAGE);
  const improved = waves > progress.bestWaves;
  progress.souls += souls;
  if (improved) {
    progress.bestWaves = waves;
    await writeRanking($sender.account, state && state.nickname, progress.bestWaves);
  }
  return { souls, improved, progress };
}

/** Settles a run left open, on its last checkpoint. */
async function settleOpenRun(state) {
  const progress = progressOf(state);
  const pending = state && state.pendingRun;
  if (!pending || !(pending.wavesCleared > 0)) return { souls: 0, progress };
  return await settleRun(state, progress, pending.wavesCleared);
}

// ---------------------------------------------------------------------------
// VXShop
// ---------------------------------------------------------------------------
// productId must match the Product ID registered in the Verse8 dashboard
// (game management page -> VX Shop tab). Registering a product does not put
// it on sale by itself; the game has to grant it, which $onItemPurchased does.
const PRODUCTS = {
  // Convenience: runs at 3x. Changes how long a wave takes to watch, not
  // how it goes - the simulation steps the same either way.
  raid_speed_3x: { grants: "fastForward", repeatable: false },
};

// Accounts allowed to call devGrantPurchase, which exercises the grant path
// without a real payment. Empty means the dev tool is off for everyone.
const DEV_ACCOUNTS = [];

const MAX_TRACKED_PURCHASES = 50;

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
 * same code.
 */
async function grantProduct(account, productId, purchaseId, quantity) {
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
    if (product.grants) entitlements[product.grants] = true;

    await $global.updateUserState(account, {
      entitlements,
      grantedPurchases: pushCapped(granted, purchaseId, MAX_TRACKED_PURCHASES),
      lastPurchase: { productId, purchaseId, quantity: count, at: Date.now() },
    });

    return { success: true, reason: "GRANTED" };
  });
}

class Server {
  /** The caller's progress and what they have bought. */
  async loadGame() {
    const state = await $global.getMyState();
    const progress = progressOf(state);
    const entitlements = (state && state.entitlements) || emptyEntitlements();
    if (!state || !state.progress || state.progress.version !== SAVE_VERSION) {
      await $global.updateMyState({ progress, pendingRun: null });
    }
    return {
      progress,
      entitlements,
      nickname: (state && state.nickname) || "",
      account: $sender.account,
    };
  }

  async getEntitlements() {
    const state = await $global.getMyState();
    return { entitlements: (state && state.entitlements) || emptyEntitlements() };
  }

  /**
   * Opens a run: remembers when, for finishRun to check.
   *
   * A run still open is settled first, on the waves it last checkpointed: a
   * run left by closing the tab still pays for the stages it got past.
   */
  async startRun() {
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const settled = await settleOpenRun(state);
      const startedAt = Date.now();
      await $global.updateMyState({ progress: settled.progress, pendingRun: { startedAt, wavesCleared: 0 } });
      return { startedAt, settled: settled.souls, progress: settled.progress };
    });
  }

  /**
   * Records how far a run has got without ending it.
   *
   * Sent at every stage cleared, so a run that is never finished - a closed
   * tab, a lost connection - is paid for up to its last stage next time.
   */
  async checkpointRun({ wavesCleared } = {}) {
    const waves = checkedWaves(wavesCleared);
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const pending = state && state.pendingRun;
      if (!pending) throw new Error("NO_RUN_OPEN");
      checkPace(state, pending, waves);
      if (waves > (pending.wavesCleared || 0)) {
        await $global.updateMyState({ pendingRun: { ...pending, wavesCleared: waves } });
      }
      return { ok: true };
    });
  }

  /**
   * Closes a run: how many waves it cleared.
   *
   * Refused if the waves could not have been played in the time since the
   * run opened. Pays a soul for each stage it got past, keeps the best, and
   * puts the best on the ranking.
   */
  async finishRun({ wavesCleared } = {}) {
    const waves = checkedWaves(wavesCleared);
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const pending = state && state.pendingRun;
      if (!pending) throw new Error("NO_RUN_OPEN");
      checkPace(state, pending, waves);
      const result = await settleRun(state, progressOf(state), Math.max(waves, pending.wavesCleared || 0));
      await $global.updateMyState({ progress: result.progress, pendingRun: null });
      return result;
    });
  }

  /** Buys a research node with souls. */
  async researchNode({ id } = {}) {
    const node = ownEntry(RESEARCH, id);
    if (!node) throw new Error("UNKNOWN_RESEARCH");
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const progress = progressOf(state);
      if (progress.research.indexOf(id) !== -1) throw new Error("ALREADY_RESEARCHED");
      for (const need of node.requires || []) {
        if (progress.research.indexOf(need) === -1) throw new Error("RESEARCH_LOCKED");
      }
      if (progress.souls - soulsSpent(progress.research) < node.cost) throw new Error("NOT_ENOUGH_SOULS");
      progress.research = progress.research.concat([id]);
      await $global.updateMyState({ progress });
      return { progress };
    });
  }

  /** The name shown on the ranking. Renames the row there too, if there is one. */
  async setNickname({ nickname } = {}) {
    const account = $sender.account;
    const name = cleanName(nickname, account);
    await $global.updateMyState({ nickname: name });
    const state = await $global.getMyState();
    const progress = progressOf(state);
    if (progress.bestWaves > 0) await writeRanking(account, name, progress.bestWaves);
    return { nickname: name };
  }

  /** The top runs, and the caller's own so a player always sees themselves. */
  async getRankings({ limit } = {}) {
    const account = $sender.account;
    const size = Math.max(1, Math.min(50, Math.floor(limit || 30)));
    // Filters and orderBy cannot be combined, so the caller's row is fetched
    // by id instead of queried.
    const top = await $global.getCollectionItems(LEADERBOARD, {
      orderBy: [{ field: "waves", direction: "desc" }],
      limit: size,
    });
    const mine = await $global.getCollectionItem(LEADERBOARD, account);
    return { top: top || [], mine: mine && mine.account ? mine : null };
  }

  /** Starts over: progress goes, purchases and the ranking row stay. */
  async resetGame() {
    const progress = emptyProgress();
    await $global.updateMyState({ progress, pendingRun: null });
    const state = await $global.getMyState();
    return { progress, entitlements: (state && state.entitlements) || emptyEntitlements() };
  }

  // -------------------------------------------------------------------------
  // VXShop
  // -------------------------------------------------------------------------

  /**
   * System handler fired by Verse8 when a VX Shop purchase completes. The
   * only place an entitlement is granted. $sender is not the buyer here: the
   * buyer arrives in `account`.
   */
  async $onItemPurchased({ account, purchaseId, productId, quantity }) {
    const result = await grantProduct(account, productId, purchaseId, quantity);
    return { success: result.success };
  }

  /** Development helper: runs the real grant path without a payment. */
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
    await $global.updateMyState({ entitlements: emptyEntitlements(), grantedPurchases: [] });
    return { entitlements: emptyEntitlements() };
  }

  async ping() {
    return { pong: Date.now(), account: $sender.account };
  }
}
