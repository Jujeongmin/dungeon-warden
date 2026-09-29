import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { installServerProbe } from "../devtools";
import { EMPTY_ENTITLEMENTS, type Entitlements } from "../types";
import { RESEARCH_BY_ID, canResearch, soulsToSpend } from "./research";
import { WAVES_PER_STAGE } from "./stages";

/** True once the project has been deployed at least once. */
const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);

export type ProgressStatus = "connecting" | "loading" | "ready" | "offline" | "error";

export interface Progress {
  /** Waves the best run cleared. */
  bestWaves: number;
  /** Every soul earned, spent or not. */
  souls: number;
  research: string[];
}

export interface RunResult {
  souls: number;
  improved: boolean;
}

export interface RankRow {
  account: string;
  nickname: string;
  waves: number;
  stage: number;
}

const EMPTY: Progress = { bestWaves: 0, souls: 0, research: [] };

/** Where the offline preview keeps its progress, so a dev can play past one run. */
const LOCAL_KEY = "dungeon-warden:endless-progress";
/** The offline preview's run in progress: waves checkpointed, for a closed tab. */
const LOCAL_RUN_KEY = "dungeon-warden:endless-run";

/** How many times a run's end is sent before it is given up as lost. */
const FINISH_ATTEMPTS = 4;

/** Errors that are the server refusing a run, not the line dropping: never retried. */
const SERVER_REFUSALS = ["RUN_TOO_FAST", "NO_RUN_OPEN", "BAD_WAVES"];

function readLocalRun(): number {
  try {
    return Number(window.localStorage.getItem(LOCAL_RUN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLocalRun(waves: number | null): void {
  try {
    if (waves === null) window.localStorage.removeItem(LOCAL_RUN_KEY);
    else window.localStorage.setItem(LOCAL_RUN_KEY, String(waves));
  } catch {
    // As above.
  }
}

function readLocal(): Progress {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      bestWaves: Number(parsed.bestWaves) || 0,
      souls: Number(parsed.souls) || 0,
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

function fromServer(p: Partial<Progress> | undefined): Progress {
  return { bestWaves: p?.bestWaves ?? 0, souls: p?.souls ?? 0, research: p?.research ?? [] };
}

/**
 * What outlives a run: the best one, the souls earned, the research bought.
 *
 * On Verse8 the server holds it, decides what a finished run earns and keeps
 * the ranking; the offline preview keeps it in localStorage and decides for
 * itself, so `npm run dev` plays the whole game before the first deploy.
 */
export function useProgress() {
  const { server, connected, connecting, account } = useGameServer();
  const [status, setStatus] = useState<ProgressStatus>(HAS_VERSE ? "connecting" : "offline");
  const [progress, setProgress] = useState<Progress>(() => (HAS_VERSE ? EMPTY : readLocal()));
  const [entitlements, setEntitlements] = useState<Entitlements>(EMPTY_ENTITLEMENTS);
  const [nickname, setNicknameState] = useState("");
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
      .then((result: { progress: Progress; entitlements: Entitlements; nickname?: string }) => {
        if (cancelled) return;
        setProgress(fromServer(result.progress));
        setEntitlements(result.entitlements ?? EMPTY_ENTITLEMENTS);
        setNicknameState(result.nickname ?? "");
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

  /** Pays a run's souls in the offline preview, the way the server does. */
  const settleLocal = useCallback(
    (wavesCleared: number): RunResult => {
      const current = progressRef.current;
      const souls = Math.floor(wavesCleared / WAVES_PER_STAGE);
      const improved = wavesCleared > current.bestWaves;
      update({ ...current, souls: current.souls + souls, bestWaves: Math.max(current.bestWaves, wavesCleared) });
      return { souls, improved };
    },
    [update],
  );

  /**
   * Opens a run on the server. Resolves null if it was refused, or the souls
   * paid for a run left open last time - closed mid-run, it still counts up
   * to its last stage.
   */
  const startRun = useCallback(async (): Promise<number | null> => {
    if (!HAS_VERSE) {
      const left = readLocalRun();
      const souls = left > 0 ? settleLocal(left).souls : 0;
      writeLocalRun(0);
      return souls;
    }
    try {
      const result: { settled: number; progress: Progress } = await server.remoteFunction("startRun", []);
      update(fromServer(result.progress));
      return result.settled ?? 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [server, update, settleLocal]);

  /** Records how far the run has got, so it counts even if never finished. */
  const checkpointRun = useCallback(
    async (wavesCleared: number): Promise<void> => {
      if (!HAS_VERSE) {
        writeLocalRun(wavesCleared);
        return;
      }
      try {
        await server.remoteFunction("checkpointRun", [{ wavesCleared }]);
      } catch {
        // The finish still pays; a checkpoint only guards a run that never ends.
      }
    },
    [server],
  );

  /** Closes a run. Null when the server would not record it. */
  const finishRun = useCallback(
    async (wavesCleared: number): Promise<RunResult | { failed: string }> => {
      if (!HAS_VERSE) {
        writeLocalRun(null);
        return settleLocal(wavesCleared);
      }
      /*
       * A phone drops its socket when the app goes to the background or the
       * screen sleeps, and reconnects a moment later - and a run that ends
       * in that moment used to be reported lost. So a failure that is not
       * the server refusing the run is tried again a few times, a little
       * further apart each time. A refusal is final and is not retried.
       */
      let message = "";
      for (let attempt = 0; attempt < FINISH_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        try {
          const result: RunResult & { progress: Progress } = await server.remoteFunction("finishRun", [{ wavesCleared }]);
          update(fromServer(result.progress));
          return { souls: result.souls, improved: result.improved };
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
          if (SERVER_REFUSALS.some((code) => message.includes(code))) break;
        }
      }
      // The reason goes on the result screen, so a refusal can be told from
      // a connection that never came back.
      setError(message);
      return { failed: message };
    },
    [server, update, settleLocal],
  );

  const research = useCallback(
    async (id: string): Promise<boolean> => {
      const node = RESEARCH_BY_ID.get(id);
      const current = progressRef.current;
      if (!node || !canResearch(node, current.research)) return false;
      if (soulsToSpend(current.souls, current.research) < node.cost) return false;
      if (!HAS_VERSE) {
        update({ ...current, research: [...current.research, id] });
        return true;
      }
      try {
        const result: { progress: Progress } = await server.remoteFunction("researchNode", [{ id }]);
        update(fromServer(result.progress));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [server, update],
  );

  const setNickname = useCallback(
    async (name: string): Promise<boolean> => {
      if (!HAS_VERSE) {
        setNicknameState(name.trim().slice(0, 20));
        return true;
      }
      try {
        const result: { nickname: string } = await server.remoteFunction("setNickname", [{ nickname: name }]);
        setNicknameState(result.nickname);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [server],
  );

  const rankings = useCallback(async (): Promise<{ top: RankRow[]; mine: RankRow | null } | null> => {
    if (!HAS_VERSE) return null;
    try {
      return await server.remoteFunction("getRankings", [{ limit: 30 }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [server]);

  const reset = useCallback(async () => {
    if (!HAS_VERSE) {
      update(EMPTY);
      return;
    }
    try {
      const result: { progress: Progress } = await server.remoteFunction("resetGame", []);
      update(fromServer(result.progress));
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

  return {
    status,
    error,
    account,
    isOffline: !HAS_VERSE,
    progress,
    entitlements,
    nickname,
    soulsLeft: soulsToSpend(progress.souls, progress.research),
    startRun,
    checkpointRun,
    finishRun,
    research,
    setNickname,
    rankings,
    reset,
    refreshEntitlements,
  };
}
