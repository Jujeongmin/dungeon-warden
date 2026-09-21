// DUNGEON WARDEN - Verse8 / Agent8 game server
// Runs in an isolated-vm: no fs / http / axios / Node builtins.
// Only $sender, $global, $room, $asset are available.
// Do NOT export this class.

/*
 * A stage tower defence keeps almost nothing on the server.
 *
 * A stage is played start to finish in the browser - gold, towers and waves
 * all live and die inside one run - so what is worth keeping is what carries
 * between runs: the best stars earned on each stage, and the research those
 * stars have bought. That is all this file stores, and it decides the two
 * things a client must not decide for itself: how many stars a finished run
 * is worth, and whether a research purchase can be afforded.
 */

const SAVE_VERSION = 3;

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
// Stages
// ---------------------------------------------------------------------------
/*
 * Mirrored from src/game/td/stages.ts; tests/td-server.test.ts checks that
 * the two agree.
 *
 * minSeconds is the least play a win can take: every adventurer of every
 * wave has to have come in, and they enter SPAWN_INTERVAL apart. A result
 * that arrives sooner than that, at the fastest speed the player owns, was
 * not played.
 */
const STAGES = {
  1: { waves: 6, lives: 20, minSeconds: 24 },
  2: { waves: 7, lives: 20, minSeconds: 37 },
  3: { waves: 8, lives: 20, minSeconds: 47 },
  4: { waves: 8, lives: 20, minSeconds: 54 },
  5: { waves: 9, lives: 20, minSeconds: 65 },
  6: { waves: 10, lives: 20, minSeconds: 86 },
  7: { waves: 10, lives: 20, minSeconds: 86 },
  8: { waves: 11, lives: 20, minSeconds: 109 },
  9: { waves: 12, lives: 20, minSeconds: 125 },
  10: { waves: 12, lives: 20, minSeconds: 195 },
};

/** Mirrors starsFor in src/game/td/stages.ts. */
function starsFor(livesLeft, lives) {
  if (livesLeft <= 0) return 0;
  if (livesLeft >= lives * 0.9) return 3;
  if (livesLeft >= lives * 0.5) return 2;
  return 1;
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
/*
 * Mirrored from src/game/td/research.ts. Costs are in stars; `lives` is the
 * one bonus this file needs, because it changes how many lives a run starts
 * with and so what a result's lives are worth.
 */
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

function extraLives(research) {
  let lives = 0;
  for (const id of research) {
    const node = ownEntry(RESEARCH, id);
    if (node && node.lives) lives = Math.max(lives, node.lives);
  }
  return lives;
}

function starsEarned(best) {
  let total = 0;
  for (const key of Object.keys(best || {})) total += best[key] || 0;
  return total;
}

function starsSpent(research) {
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
  return { version: SAVE_VERSION, best: {}, research: [] };
}

/** The saved progress, or a fresh one when there is none or it is from the old game. */
function progressOf(state) {
  const saved = state && state.progress;
  if (!saved || saved.version !== SAVE_VERSION) return emptyProgress();
  return {
    version: SAVE_VERSION,
    best: saved.best && typeof saved.best === "object" ? saved.best : {},
    research: Array.isArray(saved.research) ? saved.research : [],
  };
}

/** A stage is open once the one before it has been won. */
function isUnlocked(progress, stageId) {
  if (stageId === 1) return true;
  return (progress.best[String(stageId - 1)] || 0) > 0;
}

// ---------------------------------------------------------------------------
// VXShop
// ---------------------------------------------------------------------------
// productId must match the Product ID registered in the Verse8 dashboard
// (game management page -> VX Shop tab). Registering a product does not put
// it on sale by itself; the game has to grant it, which $onItemPurchased does.
const PRODUCTS = {
  // Convenience: stages at 3x. Changes how long a wave takes to watch, not
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
      await $global.updateMyState({ progress, pendingStage: null });
    }
    return { progress, entitlements, account: $sender.account };
  }

  async getEntitlements() {
    const state = await $global.getMyState();
    return { entitlements: (state && state.entitlements) || emptyEntitlements() };
  }

  /** Opens a run: remembers which stage and when, for finishStage to check. */
  async startStage({ stageId } = {}) {
    const stage = ownEntry(STAGES, String(stageId));
    if (!stage) throw new Error("UNKNOWN_STAGE");
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const progress = progressOf(state);
      if (!isUnlocked(progress, stageId)) throw new Error("STAGE_LOCKED");
      const startedAt = Date.now();
      await $global.updateMyState({ pendingStage: { stageId, startedAt } });
      return { stageId, startedAt };
    });
  }

  /**
   * Closes a run and records its stars.
   *
   * The client says whether it won and with how many lives; the server
   * decides what that is worth, and refuses a win that came in faster than
   * the stage's waves could have been played.
   */
  async finishStage({ stageId, won, livesLeft } = {}) {
    const stage = ownEntry(STAGES, String(stageId));
    if (!stage) throw new Error("UNKNOWN_STAGE");
    return await $lock(`progress:${$sender.account}`, async () => {
      const state = await $global.getMyState();
      const progress = progressOf(state);
      const pending = state && state.pendingStage;
      if (!pending || pending.stageId !== stageId) throw new Error("NO_STAGE_OPEN");

      let stars = 0;
      if (won === true) {
        const lives = stage.lives + extraLives(progress.research);
        const left = Math.floor(Number(livesLeft));
        if (!Number.isFinite(left) || left < 1 || left > lives) throw new Error("BAD_LIVES");
        const elapsed = Date.now() - pending.startedAt;
        const least = (stage.minSeconds * 1000) / speedFor(state) - CLOCK_SLACK_MS;
        if (elapsed < least) throw new Error("STAGE_TOO_FAST");
        stars = starsFor(left, lives);
      }

      const key = String(stageId);
      const before = progress.best[key] || 0;
      if (stars > before) progress.best[key] = stars;
      await $global.updateMyState({ progress, pendingStage: null });
      return { stars, best: progress.best[key] || 0, improved: stars > before, progress };
    });
  }

  /** Buys a research node with stars. */
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
      const left = starsEarned(progress.best) - starsSpent(progress.research);
      if (left < node.cost) throw new Error("NOT_ENOUGH_STARS");
      progress.research = progress.research.concat([id]);
      await $global.updateMyState({ progress });
      return { progress };
    });
  }

  /** Starts over: stars and research go, purchases stay. */
  async resetGame() {
    const progress = emptyProgress();
    await $global.updateMyState({ progress, pendingStage: null });
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
