import { useCallback, useEffect, useRef, useState } from "react";
import type { TrapType } from "../types";
import type { Boon } from "./boons";
import type { ResearchEffects } from "./research";
import { SIM_DT, StageRun, type BuildResult, type RunEvent } from "./StageRun";
import type { Stage } from "./stages";
import type { TowerType } from "./towers";

/** Speeds offered; the last is bought. */
export const RUN_SPEEDS = [1, 2, 3] as const;
export const FREE_RUN_SPEED = 2;
export const PAID_RUN_SPEED = 3;

/** Frames longer than this (a background tab) are not caught up on. */
const MAX_FRAME_SECONDS = 0.25;

/**
 * Drives a StageRun from the animation frame.
 *
 * The run itself is a plain object that changes in place; this hook owns it,
 * steps it at a fixed rate scaled by the chosen speed, hands its events to
 * whoever draws them, and bumps a counter whenever anything changed so React
 * re-renders from the run's own fields. Every build action goes through here
 * for the same reason.
 */
export function useStageRun(options: {
  onEvents: (events: RunEvent[], run: StageRun) => void;
  initialSpeed: number;
}) {
  const runRef = useRef<StageRun | null>(null);
  const [, setVersion] = useState(0);
  const [speed, setSpeed] = useState(options.initialSpeed);
  const [paused, setPaused] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onEventsRef = useRef(options.onEvents);
  onEventsRef.current = options.onEvents;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const run = runRef.current;
      const elapsed = Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
      last = now;
      if (!run || pausedRef.current || (run.status !== "wave")) {
        carry = 0;
        return;
      }
      carry += elapsed * speedRef.current;
      const events: RunEvent[] = [];
      while (carry >= SIM_DT) {
        carry -= SIM_DT;
        events.push(...run.step(SIM_DT));
        if (run.status !== "wave") break;
      }
      if (events.length > 0) onEventsRef.current(events, run);
      bump();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [bump]);

  const begin = useCallback(
    (stage: Stage, effects: ResearchEffects) => {
      runRef.current = new StageRun(stage, effects);
      setPaused(false);
      bump();
    },
    [bump],
  );

  const end = useCallback(() => {
    runRef.current = null;
    bump();
  }, [bump]);

  /** Wraps a build action so the screen follows it. */
  const act = useCallback(
    (fn: (run: StageRun) => BuildResult): BuildResult => {
      const run = runRef.current;
      if (!run) return { ok: false, reason: "over" };
      const result = fn(run);
      bump();
      return result;
    },
    [bump],
  );

  return {
    run: runRef.current,
    speed,
    setSpeed,
    paused,
    setPaused,
    begin,
    end,
    placeTower: (type: TowerType, x: number, y: number) => act((r) => r.placeTower(type, x, y)),
    placeTrap: (type: TrapType, x: number, y: number) => act((r) => r.placeTrap(type, x, y)),
    upgradeTower: (id: string) => act((r) => r.upgradeTower(id)),
    sellTower: (id: string) => act((r) => r.sellTower(id)),
    takeBoon: (boon: Boon) => {
      const run = runRef.current;
      if (!run) return;
      run.takeBoon(boon);
      bump();
    },
    claimAdGold: (): boolean => act((r) => (r.claimAdGold() ? { ok: true } : { ok: false, reason: "over" })).ok,
    sellTrap: (id: string) => act((r) => r.sellTrap(id)),
    startWave: (): boolean => {
      const run = runRef.current;
      if (!run) return false;
      const ok = run.startWave();
      bump();
      return ok;
    },
    /** Steps the run by hand, for the dev console: rAF is frozen in a hidden tab. */
    stepBy: (steps: number) => {
      const run = runRef.current;
      if (!run) return;
      const events: RunEvent[] = [];
      for (let i = 0; i < steps && run.status === "wave"; i++) events.push(...run.step(SIM_DT));
      if (events.length > 0) onEventsRef.current(events, run);
      bump();
    },
  };
}
