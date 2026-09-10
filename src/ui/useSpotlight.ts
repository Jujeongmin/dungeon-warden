import { useEffect, useRef, useState } from "react";
import type { TutorialTarget } from "../game/tutorial";

export interface SpotlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the tutorial is pointing, in screen pixels.
 *
 * The alternative was to put the highlight inside each control, which means
 * every button in the build panel has to know whether the tutorial is talking
 * about it. Measuring the target from outside keeps that knowledge in one
 * place: a control only has to carry a `data-tut` name, and the ring is drawn
 * over it.
 *
 * The rect is re-read every frame while a target is set. That sounds
 * wasteful and is one `getBoundingClientRect` per frame, on a screen the
 * player is looking at for a few taps — and it is the only thing that
 * survives the toolbar scrolling, the HUD folding, the panel animating in and
 * the phone being turned, none of which fire an event this could listen to.
 */
export function useSpotlight(
  target: TutorialTarget,
  /** Turns a board tile into a screen box. Supplied by whoever owns the camera. */
  locateTile?: (x: number, y: number) => SpotlightBox | null,
): SpotlightBox | null {
  const [box, setBox] = useState<SpotlightBox | null>(null);

  // A string, so the effect restarts when the target changes but not when the
  // caller happens to hand over a new object describing the same target.
  const name = target
    ? target.kind === "tile"
      ? `tile:${target.x},${target.y}`
      : `${target.kind}:${target.id}`
    : null;

  // Read through a ref: the locator closes over the camera and is rebuilt
  // often, and restarting the loop for that would restart it every frame.
  const locate = useRef(locateTile);
  useEffect(() => {
    locate.current = locateTile;
  });

  useEffect(() => {
    if (!name) return;

    let frame = 0;
    const tile = name.startsWith("tile:")
      ? name.slice(5).split(",").map(Number)
      : null;
    const selector = `[data-tut="${CSS.escape(name)}"]`;

    /*
     * Bring the control into the panel before pointing at it.
     *
     * The build panel scrolls, and the save button is below the fold with the
     * toolbar open — the ring was being drawn at y = 1065 on an 812px screen,
     * which is a tutorial pointing off the bottom of the phone. Scrolled once
     * when the step changes, never per frame, so it cannot fight a player who
     * scrolls somewhere else.
     */
    if (!tile) {
      document.querySelector(selector)?.scrollIntoView({ block: "nearest" });
    }

    const tick = () => {
      // A control that is scrolled out of the panel has no useful rect, and a
      // tile behind the camera has no position at all; either way the ring
      // would sit somewhere pointing at nothing.
      const rect = tile
        ? locate.current?.(tile[0], tile[1]) ?? null
        : document.querySelector(selector)?.getBoundingClientRect() ?? null;

      // Off the screen counts as not visible. A scrolled-out control still
      // reports a perfectly good rect — it is just somewhere the player cannot
      // see, and a ring drawn there is worse than no ring at all.
      const visible =
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight &&
        rect.left + rect.width > 0 &&
        rect.top + rect.height > 0;
      setBox((current) => {
        if (!visible) return current === null ? current : null;
        const next = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
        // Same rect, same object: this runs 60 times a second and must not
        // re-render the tree unless something actually moved.
        if (
          current &&
          Math.abs(current.left - next.left) < 0.5 &&
          Math.abs(current.top - next.top) < 0.5 &&
          Math.abs(current.width - next.width) < 0.5 &&
          Math.abs(current.height - next.height) < 0.5
        ) {
          return current;
        }
        return next;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [name]);

  // Gated on the target rather than cleared when it goes away: a stale box
  // would otherwise be returned for the one render between the target
  // vanishing and the effect tearing the loop down.
  return name ? box : null;
}
