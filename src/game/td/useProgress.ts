import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { installServerProbe } from "../devtools";
import { EMPTY_ENTITLEMENTS, type Entitlements } from "../types";
import { RESEARCH_BY_ID, canResearch, starsToSpend } from "./research";
import { starsFor, stageById } from "./stages";

/** True once the project has been deployed at least once. */
const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);

export type ProgressStatus = "connecting" | "loading" | "ready" | "offline" | "error";

export interface Progress {
  /** Best stars per stage id. */
  best: Record<string, number>;
  research: string[];
}

export interface FinishResult {
  stars: number;
  best: number;
  improved: boolean;
}

const EMPTY: Progress = { best: {}, research: [] };

/** Where the offline preview keeps its progress, so a dev can play past stage 1. */
const LOCAL_KEY = "dungeon-warden:td-progress";

function readLocal(): Progress {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      best: parsed.best && typeof parsed.best === "object" ? parsed.best : {},
      research: Array.isArray(parsed.research) ? parsed.research : [],
    };
  } catch {
    return EMPTY;
  }
}

function writeLocal(progress: Progress): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
  } catch {
    // A preview that cannot store simply forgets; nothing else depends on it.
  }
}

/**
 * Stars and research: the part of the game that outlives a stage.
 *
 * On Verse8 the server holds it and decides what a finished run is worth;
 * the offline preview keeps it in localStorage and decides for itself, so
 * `npm run dev` plays the whole game before the first deploy.
 */
export function useProgress() {
  const { server, connected, connecting, account } = useGameServer();
  const [status, setStatus] = useState<ProgressStatus>(HAS_VERSE ? "connecting" : "offline");
  const [progress, setProgress] = useState<Progress>(() => (HAS_VERSE ? EMPTY : readLocal()));
  const [entitlements, setEntitlements] = useState<Entitlements>(EMPTY_ENTITLEMENTS);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    installServerProbe((fn, args) => server.remoteFunction(fn, args as unknown[]));
  }, [server]);

  useEffect(() => {
    if (HAS_VERSE && connecting) setStatus("connecting");
  }, [connecting]);

  useEffect(() => {
    if (!HAS_VERSE || !connected || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    setStatus("loading");
    server
      .remoteFunction("loadGame", [])
      .then((result: { progress: Progress; entitlements: Entitlements }) => {
        if (cancelled) return;
        setProgress({ best: result.progress.best ?? {}, research: result.progress.research ?? [] });
        setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        loadedRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, server]);

  const update = useCallback((next: Progress) => {
    setProgress(next);
    if (!HAS_VERSE) writeLocal(next);
  }, []);

  /** Opens a run on the server. Resolves false if it was refused. */
  const startStage = useCallback(
    async (stageId: number): Promise<boolean> => {
      if (!HAS_VERSE) return true;
      try {
        await server.remoteFunction("startStage", [{ stageId }]);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [server],
  );

  const finishStage = useCallback(
    async (stageId: number, won: boolean, livesLeft: number, lives: number): Promise<FinishResult | null> => {
      if (!HAS_VERSE) {
        const stars = won ? starsFor(livesLeft, lives) : 0;
        const key = String(stageId);
        const before = progressRef.current.best[key] ?? 0;
        if (stars > before) update({ ...progressRef.current, best: { ...progressRef.current.best, [key]: stars } });
        return { stars, best: Math.max(stars, before), improved: stars > before };
      }
      try {
        const result: FinishResult & { progress: Progress } = await server.remoteFunction("finishStage", [
          { stageId, won, livesLeft },
        ]);
        update({ best: result.progress.best ?? {}, research: result.progress.research ?? [] });
        return { stars: result.stars, best: result.best, improved: result.improved };
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [server, update],
  );

  const research = useCallback(
    async (id: string): Promise<boolean> => {
      const node = RESEARCH_BY_ID.get(id);
      const current = progressRef.current;
      if (!node || !canResearch(node, current.research)) return false;
      if (starsToSpend(current.best, current.research) < node.cost) return false;
      if (!HAS_VERSE) {
        update({ ...current, research: [...current.research, id] });
        return true;
      }
      try {
        const result: { progress: Progress } = await server.remoteFunction("researchNode", [{ id }]);
        update({ best: result.progress.best ?? {}, research: result.progress.research ?? [] });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [server, update],
  );

  const reset = useCallback(async () => {
    if (!HAS_VERSE) {
      update(EMPTY);
      return;
    }
    try {
      const result: { progress: Progress } = await server.remoteFunction("resetGame", []);
      update({ best: result.progress.best ?? {}, research: result.progress.research ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [server, update]);

  const refreshEntitlements = useCallback(async () => {
    if (!HAS_VERSE) return;
    try {
      const result: { entitlements: Entitlements } = await server.remoteFunction("getEntitlements", []);
      setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
    } catch {
      // Tried again next time the shop opens.
    }
  }, [server]);

  const isUnlocked = useCallback(
    (stageId: number) => stageId === 1 || (progress.best[String(stageId - 1)] ?? 0) > 0,
    [progress],
  );

  return {
    status,
    error,
    account,
    isOffline: !HAS_VERSE,
    progress,
    entitlements,
    starsLeft: starsToSpend(progress.best, progress.research),
    starsTotal: Object.values(progress.best).reduce((sum, n) => sum + n, 0),
    isUnlocked,
    startStage,
    finishStage,
    research,
    reset,
    refreshEntitlements,
    stageExists: (id: number) => stageById(id) !== null,
  };
}
