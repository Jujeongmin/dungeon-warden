import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { RaidSim, SIM_DT, type RaidState, type SimEvent } from "./sim/RaidSim";
import { lureTiles } from "./rooms";
import { SKILL_STATS } from "./sim/traps";
import type { Arena } from "./arena";
import type { ResearchEffects } from "./research";
import { watchReviveAd } from "./ads";
import type { DungeonMeta } from "./useDungeonSave";
import type {
  PlacedMinion,
  PlacedObstacle,
  PlacedRoom,
  PlacedTrap,
  RaidFinishResult,
  RaidStartResult,
  RoomEffects,
  WardenSkill,
} from "./types";

const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);

/** Guards against a tab that was backgrounded dumping a huge catch-up burst. */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Hit stop: a brief freeze of wall-clock time whenever the sim reports a
 * decisive event, so the moment reads instead of sliding past. This only
 * ever withholds delta from the accumulator below — it never touches
 * `sim.step()` — so it cannot change how many steps a raid takes or what
 * events it produces; the determinism test covers exactly that guarantee.
 * 100ms reads as a solid beat without feeling like input lag.
 */
const HIT_STOP_SECONDS = 0.1;
/** A player who chose fast-forward asked for less drama, not more. */
const HIT_STOP_SPEED_SCALE: Record<RaidSpeed, number> = { 1: 1, 2: 0.4, 4: 0 };
const DECISIVE_EVENTS = new Set<SimEvent["kind"]>([
  "killed",
  "captured",
  "minionDown",
  "obstacleDown",
]);

export const RAID_SPEEDS = [1, 2, 4] as const;
export type RaidSpeed = (typeof RAID_SPEEDS)[number];

interface Options {
  /** Called with everything the simulation reported this frame. */
  onEvents?: (events: SimEvent[]) => void;
  arena: Arena;
  meta: DungeonMeta | null;
  minions: PlacedMinion[];
  traps: PlacedTrap[];
  rooms: PlacedRoom[];
  obstacles: PlacedObstacle[];
  effects: RoomEffects;
  jailFree: number;
  weaponTiers: Record<string, number>;
  research: ResearchEffects;
  onFinished: (result: RaidFinishResult) => void;
  /**
   * Walls the party broke through to reach the core are gone for good. The
   * server already drops them in `finishRaid`; this keeps local state from
   * disagreeing with the save until the next reload.
   */
  onObstaclesDestroyed: (ids: string[]) => void;
  /** Where the speed control starts, remembered from last session. */
  initialSpeed?: RaidSpeed;
}

/**
 * Drives the deterministic RaidSim from a fixed-step accumulator.
 *
 * The simulation never reads wall-clock time itself; this hook decides how many
 * SIM_DT steps a rendered frame is worth, which keeps a raid reproducible
 * regardless of frame rate or speed setting.
 */
export function useRaid({
  arena,
  meta,
  minions,
  traps,
  rooms,
  obstacles,
  effects,
  jailFree,
  weaponTiers,
  research,
  onFinished,
  onObstaclesDestroyed,
  onEvents,
  initialSpeed,
}: Options) {
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  const { server } = useGameServer();

  const [raidState, setRaidState] = useState<RaidState | null>(null);
  const [starting, setStarting] = useState(false);
  const [speed, setSpeed] = useState<RaidSpeed>(initialSpeed ?? 1);
  const [result, setResult] = useState<RaidFinishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [adUsed, setAdUsed] = useState(false);
  const [adBusy, setAdBusy] = useState(false);

  const simRef = useRef<RaidSim | null>(null);
  const raidIdRef = useRef<string | null>(null);
  const frameRef = useRef(0);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef(0);
  /** Seconds of hit-stop still owed to the current freeze, if any. */
  const hitStopRef = useRef(0);
  const speedRef = useRef<RaidSpeed>(1);
  speedRef.current = speed;
  const settlingRef = useRef(false);

  /** Skill targeting: rally waits for the next tile tap. */
  const [pendingSkill, setPendingSkill] = useState<WardenSkill | null>(null);

  const settle = useCallback(
    async (finalState: RaidState) => {
      if (settlingRef.current) return;
      settlingRef.current = true;

      const raidId = raidIdRef.current;
      const destroyedObstacleIds = simRef.current?.destroyedObstacleIds ?? [];
      simRef.current = null;
      raidIdRef.current = null;

      onObstaclesDestroyed(destroyedObstacleIds);

      const outcome = finalState.status === "breached" ? "breached" : "repelled";
      const lostMinionIds = finalState.minions.filter((m) => !m.alive).map((m) => m.id);

      try {
        if (!HAS_VERSE || !raidId) {
          // Offline preview: mirror the server's payout so the loop still
          // closes. Nothing is persisted.
          const beaten = finalState.killed + finalState.captured;
          setResult({
            outcome,
            reward: outcome === "repelled" ? 20 + 15 * beaten : 8 * beaten,
            plundered: 0,
            gold: 0,
            threat: 0,
            wavesRepelled: 0,
            coreBreaches: 0,
            capturedNames: finalState.capturedIds,
            // Nothing is persisted offline, so the counters would all read zero
            // and look broken. The dialog says so instead of showing them.
            local: true,
          });
          return;
        }

        const finish: RaidFinishResult = await server.remoteFunction("finishRaid", [
          {
            raidId,
            outcome,
            killedIds: finalState.killedIds,
            capturedIds: finalState.capturedIds,
            lostMinionIds,
            destroyedObstacleIds,
          },
        ]);
        setResult(finish);
        onFinished(finish);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        settlingRef.current = false;
      }
    },
    [server, onFinished, onObstaclesDestroyed],
  );

  // Fixed-step loop, keyed on the run id so it starts once per raid instead of
  // restarting on every frame's state update.
  useEffect(() => {
    if (runId === 0) return;

    const tick = (now: number) => {
      frameRef.current = requestAnimationFrame(tick);

      const sim = simRef.current;
      if (!sim) return;

      const delta = Math.min((now - lastFrameRef.current) / 1000, 0.25);
      lastFrameRef.current = now;

      // Hit stop withholds this frame's delta from the accumulator instead
      // of feeding it in — the freeze is entirely a wall-clock pacing effect
      // on top of the fixed-step loop, so it cannot change how many times
      // sim.step() below ends up running for a given raid.
      if (hitStopRef.current > 0) {
        hitStopRef.current = Math.max(0, hitStopRef.current - delta);
      } else {
        accumulatorRef.current += delta * speedRef.current;
      }

      let steps = 0;
      while (accumulatorRef.current >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        sim.step();
        accumulatorRef.current -= SIM_DT;
        steps++;
        if (sim.state.status !== "running") break;
      }

      const drained = sim.drainEvents();
      if (drained.length > 0) {
        eventsRef.current?.(drained);
        if (drained.some((e) => DECISIVE_EVENTS.has(e.kind))) {
          const duration = HIT_STOP_SECONDS * HIT_STOP_SPEED_SCALE[speedRef.current];
          hitStopRef.current = Math.max(hitStopRef.current, duration);
        }
      }

      const next = sim.state;
      setRaidState({ ...next, minions: [...next.minions], adventurers: [...next.adventurers] });

      if (next.status !== "running") {
        cancelAnimationFrame(frameRef.current);
        void settle(next);
      }
    };

    lastFrameRef.current = performance.now();
    accumulatorRef.current = 0;
    hitStopRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameRef.current);
  }, [runId, settle]);

  const startRaid = useCallback(async (): Promise<void> => {
    if (!meta || starting || simRef.current) return;

    setStarting(true);
    setError(null);
    setResult(null);
    try {
      let start: RaidStartResult;
      if (HAS_VERSE) {
        start = await server.remoteFunction("startRaid", []);
      } else {
        // Offline preview so the raid loop is playable before the first deploy.
        start = {
          raidId: "local",
          seed: 1,
          threat: meta.threat,
          party: [{ id: "adv-0", cls: "knight", name: "Aldric", level: 1 }],
          availableMinionIds: minions.map((m) => m.id),
          jailFree,
        };
      }

      raidIdRef.current = start.raidId;
      setAdUsed(false);

      // Minions still reviving sit this one out.
      const available = new Set(start.availableMinionIds ?? minions.map((m) => m.id));
      const sim = new RaidSim({
        minions: minions.filter((m) => available.has(m.id)),
        traps,
        obstacles,
        party: start.party,
        arena,
        entrance: meta.entrance,
        core: meta.core,
        lures: lureTiles(rooms),
        seed: start.seed,
        trapCooldownScale: effects.trapCooldownScale,
        jailFree: start.jailFree ?? jailFree,
        weaponTiers,
        minionDamageScale: research.minionDamageScale,
        minionHpScale: research.minionHpScale,
        trapDamageScale: research.trapDamageScale,
      });
      simRef.current = sim;
      setRaidState(sim.state);
      setRunId((id) => id + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [
    arena,
    meta,
    minions,
    traps,
    rooms,
    obstacles,
    effects.trapCooldownScale,
    jailFree,
    weaponTiers,
    research,
    server,
    starting,
  ]);

  /**
   * Fires a warden skill. Rally needs a tile, so selecting it arms a pending
   * state and the next tap on the dungeon supplies the target.
   */
  const useSkill = useCallback((skill: WardenSkill, target?: { x: number; y: number }) => {
    const sim = simRef.current;
    if (!sim || !sim.canUseSkill(skill)) return;

    if (SKILL_STATS[skill].targeted && !target) {
      setPendingSkill(skill);
      return;
    }

    sim.useSkill(skill, target);
    setPendingSkill(null);
    setRaidState({ ...sim.state });
  }, []);

  /** Called when the player taps a tile while a targeted skill is armed. */
  const resolveSkillTarget = useCallback(
    (x: number, y: number) => {
      if (!pendingSkill) return false;
      useSkill(pendingSkill, { x, y });
      return true;
    },
    [pendingSkill, useSkill],
  );

  /**
   * Advances the simulation by hand, for tests and for driving the raid when
   * requestAnimationFrame is unavailable (a hidden tab freezes it).
   */
  const stepRaid = useCallback((count = 1) => {
    const sim = simRef.current;
    if (!sim) return null;

    for (let i = 0; i < count && sim.state.status === "running"; i++) sim.step();

    const drained = sim.drainEvents();
    if (drained.length > 0) eventsRef.current?.(drained);

    const next = sim.state;
    setRaidState({ ...next, minions: [...next.minions], adventurers: [...next.adventurers] });
    if (next.status !== "running") void settle(next);
    return next;
  }, [settle]);

  /**
   * The rewarded ad: one comeback per raid, putting fallen minions back on
   * their feet. No server call — see the note in ads.ts for why the payout is
   * an in-fight effect rather than currency.
   */
  const reviveWithAd = useCallback(async (): Promise<number> => {
    const sim = simRef.current;
    if (!sim || adUsed || adBusy || sim.fallenMinionCount === 0) return 0;

    setAdBusy(true);
    try {
      const watched = await watchReviveAd();
      if (!watched) return 0;

      const revived = sim.reviveFallenMinions();
      setAdUsed(true);
      setRaidState({ ...sim.state });
      return revived;
    } finally {
      setAdBusy(false);
    }
  }, [adUsed, adBusy]);

  const dismissResult = useCallback(() => {
    setResult(null);
    setRaidState(null);
    setRunId(0);
    setPendingSkill(null);
  }, []);

  return {
    raidState,
    raiding: raidState !== null && raidState.status === "running",
    starting,
    speed,
    setSpeed,
    result,
    error,
    pendingSkill,
    startRaid,
    useSkill,
    resolveSkillTarget,
    stepRaid,
    /** Dev only: drives the result screen without a server. See devtools. */
    showResult: setResult,
    dismissResult,
    reviveWithAd,
    adUsed,
    adBusy,
    fallenMinions: simRef.current?.fallenMinionCount ?? 0,
  };
}
