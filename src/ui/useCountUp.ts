import { useEffect, useRef, useState } from "react";

/**
 * A number that travels to its new value instead of teleporting.
 *
 * Gold is the score of this game, and a score that snaps from 152 to 320 is a
 * number the player reads twice: once to see it changed, once to work out by
 * how much. Counting it up spends about a third of a second saying "you gained
 * a lot" before the eye has to parse a single digit — and it makes the reward
 * feel like it arrived rather than like it was always there.
 *
 * The direction of the change comes back too, because gaining and spending
 * should not look the same, and `beat` changes on every change so a `key` can
 * restart a CSS animation that would otherwise only ever play once.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export interface Counted {
  /** What to draw right now — somewhere between the old value and the new. */
  shown: number;
  /** Increments once per change. Use as a React `key` to replay the pop. */
  beat: number;
  /** Which way the last change went, so the pop can grow or shrink. */
  dir: "up" | "down" | null;
}

export function useCountUp(value: number, ms = 420): Counted {
  const [shown, setShown] = useState(value);
  const [beat, setBeat] = useState(0);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  // Mirrors `shown` outside React's state so a tween that starts while an
  // earlier one is still running picks up from where the digits actually are,
  // not from where the last tween was aiming.
  const shownRef = useRef(value);
  const target = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    if (value === target.current) return;

    const previous = target.current;
    target.current = value;
    setBeat((n) => n + 1);
    setDir(value > previous ? "up" : "down");

    const reduced =
      typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;
    if (reduced || ms <= 0) {
      shownRef.current = value;
      setShown(value);
      return;
    }

    const from = shownRef.current;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      // Ease out cubic: most of the distance up front, then a settle. The
      // settle is what reads as the number "landing".
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, ms]);

  return { shown, beat, dir };
}
