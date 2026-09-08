/**
 * A localStorage that never throws.
 *
 * The Verse8 editor frames the game from a different site — create.verse8.io
 * around agent8.verse8.net — so inside the preview we are a third-party
 * context, and a browser is free to refuse storage there outright rather than
 * partition it. @agent8/gameserver reads and writes localStorage in a static
 * field initialiser:
 *
 *     static randomAccount = (() => {
 *       if (localStorage.getItem("agent8:temporary_account")) { ... }
 *       localStorage.setItem("agent8:temporary_account", newAccount);
 *     })();
 *
 * That runs while the module is being evaluated and is not guarded, so a
 * refusal takes the module down, the import chain with it, and the game never
 * mounts — a blank frame with nothing in the console but a module error.
 *
 * Nothing we keep in localStorage is worth that: preferences and a nickname.
 * When the real store is unusable it is replaced with an in-memory one that
 * lasts the session, and the game runs.
 *
 * Imported first in main.tsx, ahead of anything that touches storage.
 */

function storageWorks(): boolean {
  try {
    const probe = "__dw_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    // Blocked, partitioned into nothing, or missing entirely.
    return false;
  }
}

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };
}

if (typeof window !== "undefined" && !storageWorks()) {
  try {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    console.warn("[dungeon-warden] localStorage is blocked here — using an in-memory store for this session.");
  } catch {
    // The property is locked down; the guards in our own callers still hold,
    // and the SDK will fail as it did before. Nothing more to do from here.
  }
}
