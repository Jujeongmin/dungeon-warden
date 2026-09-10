import { useCallback, useEffect, useRef, useState } from "react";
import { useGameServer } from "@agent8/gameserver";
import { watchGoldAd } from "./ads";

/**
 * Gold for watching an ad.
 *
 * The server owns every number here — how much, how many a day, how long
 * between them — because it is the only side of this that a player cannot
 * rewrite. See the note in server.js: the ad itself is unverifiable, so the
 * cap is what makes skipping it pointless.
 *
 * Status is read before the button is shown rather than after the ad, so a
 * player is never made to sit through thirty seconds and only then told they
 * had already used today's last claim.
 */

const HAS_VERSE = Boolean(import.meta.env.VITE_AGENT8_VERSE);

export interface AdGoldStatus {
  remaining: number;
  limit: number;
  /** What the next claim pays, at the dungeon's current threat. */
  reward: number;
  /** Wall-clock ms after which the next claim is allowed. 0 when ready now. */
  readyAt: number;
}

export type AdGoldOutcome = "paid" | "not-watched" | "unavailable" | "failed";

export function useAdGold(onGold: (gold: number) => void) {
  const { server, connected } = useGameServer();
  const [status, setStatus] = useState<AdGoldStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // The countdown is compared against the server's clock, not the device's:
  // a phone an hour fast would otherwise show a claim as ready when it is not.
  const skewRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!HAS_VERSE || !connected) return;
    try {
      const next: AdGoldStatus & { now: number } = await server.remoteFunction(
        "adGoldStatus",
        [],
      );
      skewRef.current = next.now - Date.now();
      setStatus({
        remaining: next.remaining,
        limit: next.limit,
        reward: next.reward,
        readyAt: next.readyAt,
      });
    } catch {
      // No status means no button; the game does not depend on this.
      setStatus(null);
    }
  }, [server, connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** True when a claim would be accepted right now. */
  const ready =
    status !== null &&
    status.remaining > 0 &&
    Date.now() + skewRef.current >= status.readyAt;

  const claim = useCallback(async (): Promise<AdGoldOutcome> => {
    if (busy || !ready) return "unavailable";
    setBusy(true);
    try {
      const watched = await watchGoldAd();
      if (!watched) return "not-watched";

      const result: { gold: number; remaining: number; readyAt: number } =
        await server.remoteFunction("claimAdGold", []);
      onGold(result.gold);
      setStatus((current) =>
        current
          ? { ...current, remaining: result.remaining, readyAt: result.readyAt }
          : current,
      );
      return "paid";
    } catch {
      // The server refused — the cap or the cooldown, most likely, which the
      // status above should have caught. Re-read it rather than guess.
      void refresh();
      return "failed";
    } finally {
      setBusy(false);
    }
  }, [busy, ready, server, onGold, refresh]);

  return { status, ready, busy, claim, refresh };
}
