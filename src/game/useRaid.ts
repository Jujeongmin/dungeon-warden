import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { RaidSim, SIM_DT, isRaidOver, type RaidState, type SimEvent } from "./sim/RaidSim";
import { lureTiles } from "./rooms";
import { previewParty, wavesFor } from "./party";
import { garrisonScale, type DugTile } from "./dig";
import { SKILL_STATS } from "./sim/traps";
import type { Arena } from "./arena";
import type { ResearchEffects } from "./research";
import { watchReviveAd } from "./ads";
import type { DungeonMeta } from "./useDungeonSave";
import type {
  PlacedMinion,
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
  /** Every tile taken out of the rock: how far the garrison is spread. */
  dug: DugTile[];
  /** The rock: every tile nobody dug out. */
  terrain: Set<number>;
  effects: RoomEffects;
  jailFree: number;
  weaponTiers: Record<string, number>;
  research: ResearchEffects;
  onFinished: (result: RaidFinishResult) => void;
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
  dug,
  terrain,
  effects,
  jailFree,
  weaponTiers,
  research,
  onFinished,
  onEvents,
  initialSpeed,
}: Options) {
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  const { server } = useGameServer();

  const [raidState, setRaidState] = useState<RaidState | null>(null);
  const intermissionOpen = raidState?.status === "intermission";
  const [starting, setStarting] = useState(false);
  const [speed, setSpeed] = useState<RaidSpeed>(initialSpeed ?? 1);
  const [result, setResult] = useState<RaidFinishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [adUsed, setAdUsed] = useState(false);
  /** Named tier this raid is the first to arrive at, announced once. */
  const [milestone, setMilestone] = useState<string | null>(null);
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
      simRef.current = null;
      raidIdRef.current = null;

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
    [server, onFinished],
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
        // A build window keeps stepping - it has a clock of its own - so only
        // the end of the raid stops the loop here.
        if (isRaidOver(sim.state.status)) break;
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

      if (isRaidOver(next.status)) {
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

  /*
   * Hand the simulation whatever was built during the window.
   *
   * The player is editing React state the same way they do outside a raid,
   * and the simulation is a separate object that was handed a snapshot when
   * it started - so without this a minion posted during the window stands on
   * screen and the next wave walks straight past where it is drawn.
   *
   * Guarded inside syncPlacements rather than here as well: the only thing
   * this effect knows is that something changed, and whether that is allowed
   * to reach the fight is the simulation's rule to keep.
   */
  useEffect(() => {
    if (!intermissionOpen) return;
    simRef.current?.syncPlacements(minions, traps, weaponTiers);
  }, [intermissionOpen, minions, traps, weaponTiers]);

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
        // Built from the same mirror the party row draws, so what walks in is
        // what was shown - a single hardcoded knight made every offline raid
        // identical no matter how loud the dungeon had become.
        start = {
          raidId: "local",
          seed: 1,
          threat: meta.threat,
          party: previewParty([], meta.threat, Date.now()),
          /*
           * Built the same way the server builds them, so the offline game is
           * the same shape as the real one.
           *
           * Ids are re-stamped per wave. previewParty hands back the same
           * names in the same order every time it is called against an empty
           * roster, and two adventurers sharing an id in one simulation is a
           * hunt that follows the wrong one and a kill counted twice.
           */
          waves: [0, 2, 4].slice(0, wavesFor(meta.threat)).map((step, wave) =>
            previewParty([], meta.threat + step, Date.now()).map((member) => ({
              ...member,
              id: `w${wave}-${member.id}`,
            })),
          ),
          availableMinionIds: minions.map((m) => m.id),
          jailFree,
        };
      }

      raidIdRef.current = start.raidId;
      setMilestone(start.milestoneReached ?? null);
      setAdUsed(false);

      // Minions still reviving sit this one out.
      const available = new Set(start.availableMinionIds ?? minions.map((m) => m.id));
      const sim = new RaidSim({
        minions: minions.filter((m) => available.has(m.id)),
        traps,
        party: start.party,
        // Absent from a server that predates waves; the simulation then runs
        // the single party as a one-wave raid, exactly as it used to.
        waves: start.waves,
        arena,
        entrance: meta.entrance,
        core: meta.core,
        lures: lureTiles(rooms),
        terrain,
        seed: start.seed,
        trapCooldownScale: effects.trapCooldownScale,
        jailFree: start.jailFree ?? jailFree,
        weaponTiers,
        /*
         * Research first, then how thin the dungeon is spread.
         *
         * Multiplied together rather than chosen between: what you have
         * researched and how far you have dug are two different questions
         * about the same garrison.
         */
        minionDamageScale: research.minionDamageScale * garrisonScale(dug.length),
        minionHpScale: research.minionHpScale * garrisonScale(dug.length),
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
    /*
     * Raiding means the fighting is happening, not that a raid is open.
     *
     * A build window is deliberately not raiding: the board unlocks, the route
     * preview comes back and the panel works, which is the whole point of
     * having one. `raidOpen` is the other question - whether a raid is still
     * in progress - and it is what the raid button has to look at so it
     * cannot be pressed again mid-raid.
     */
    raiding: raidState !== null && raidState.status === "running",
    raidOpen: raidState !== null && !isRaidOver(raidState.status),
    intermission: raidState !== null && raidState.status === "intermission",
    /** Ends the build window early. */
    beginNextWave: () => {
      simRef.current?.startNextWave();
      const sim = simRef.current;
      if (sim) setRaidState({ ...sim.state, minions: [...sim.state.minions], adventurers: [...sim.state.adventurers] });
    },
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
    milestone,
    dismissMilestone: () => setMilestone(null),
    reviveWithAd,
    adUsed,
    adBusy,
    fallenMinions: simRef.current?.fallenMinionCount ?? 0,
  };
}
