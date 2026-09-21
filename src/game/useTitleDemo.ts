import { useEffect, type RefObject } from "react";
import type { DungeonRenderer } from "./DungeonRenderer";
import { SIM_DT, type RunEvent, type StageRun } from "./td/StageRun";
import { runFloor, runMarkers, runUnits } from "./td/views";
import { DEMO_MAX_SECONDS, DEMO_REST_MS, createTitleDemo } from "./titleDemo";

/** A shot from further than this draws a line. */
const BOLT_MIN_SPAN = 1.2;
/** Guards against a backgrounded tab catching up in one burst. */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Plays the title screen's fight on the board while `active`.
 *
 * Drawn straight into the renderer rather than through React state: the fight
 * moves every frame, and routing that through the App would re-render the
 * whole interface sixty times a second behind a menu. See titleDemo.ts.
 */
export function useTitleDemo(
  active: boolean,
  rendererRef: RefObject<DungeonRenderer | null>,
  rendererReady: boolean,
): void {
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!active || !rendererReady || !renderer) return;

    let round = 0;
    let run: StageRun = createTitleDemo(round);
    const show = (r: StageRun) => {
      renderer.setArena(r.stage.arena, r.entrance, r.core);
      renderer.setDug(runFloor(r));
      renderer.setMarkers(runMarkers(r));
      renderer.setPathPreview(null);
    };
    show(run);

    let last = performance.now();
    let accumulator = 0;
    let restAt = 0;
    let frame = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = Math.min((now - last) / 1000, 0.25);
      last = now;

      if (restAt > 0) {
        if (now < restAt) return;
        round += 1;
        run = createTitleDemo(round);
        show(run);
        restAt = 0;
        accumulator = 0;
      }

      accumulator += delta;
      let steps = 0;
      const events: RunEvent[] = [];
      while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        events.push(...run.step());
        accumulator -= SIM_DT;
        steps++;
        if (run.status !== "wave") break;
      }
      play(renderer, events);

      if (run.status !== "wave" || run.time >= DEMO_MAX_SECONDS) {
        // An empty board for a moment, then the next party at the door.
        renderer.setUnits(runUnits(run, { labels: false }).filter((u) => u.id.startsWith("m:")));
        restAt = now + DEMO_REST_MS;
        return;
      }
      renderer.setUnits(runUnits(run, { labels: false }));
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      renderer.setUnits([]);
    };
  }, [active, rendererReady, rendererRef]);
}

/** The visible half of what the App does with events: no sound, no numbers. */
function play(renderer: DungeonRenderer, events: RunEvent[]): void {
  for (const event of events) {
    if (event.kind === "damage") {
      renderer.flashUnit(`a:${event.targetId}`);
      if (event.from) {
        const span = Math.hypot(event.from.x - event.x, event.from.y - event.y);
        if (span > BOLT_MIN_SPAN) {
          renderer.spawnBolt(event.from.x, event.from.y, event.x, event.y, event.source === "trap" ? 0xffc27a : 0xc9b6ff);
        }
      }
    } else if (event.kind === "trap") {
      renderer.spawnRing(event.x, event.y);
    } else if (event.kind === "killed") {
      renderer.spawnRing(event.x, event.y, 0xd86a4c);
      renderer.knockbackUnit(`a:${event.targetId}`);
    }
  }
}
