import { useEffect, type RefObject } from "react";
import type { DungeonRenderer } from "./DungeonRenderer";
import { SIM_DT, isRaidOver, type SimEvent } from "./sim/RaidSim";
import { DEMO_MAX_SECONDS, DEMO_REST_MS, createTitleDemo, demoUnits, type TitleDemo } from "./titleDemo";

/** A blow from further than this draws a line; a swing from the next tile does not. */
const BOLT_MIN_SPAN = 1.2;
/** Guards against a backgrounded tab catching up in one burst. */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Plays the title screen's fight on the board while `active`.
 *
 * Drawn straight into the renderer rather than through React state: the fight
 * moves every frame, and routing that through the App would re-render the
 * whole interface sixty times a second behind a menu. The App stops handing
 * the renderer the player's dungeon while this runs, and hands it back when
 * it stops. See src/game/titleDemo.ts.
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
    let demo: TitleDemo = createTitleDemo(round);
    const show = (d: TitleDemo) => {
      renderer.setArena(d.arena, d.entrance, d.core);
      renderer.setDug(d.open);
      renderer.setMarkers(d.markers);
    };
    show(demo);

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
        demo = createTitleDemo(round);
        restAt = 0;
        accumulator = 0;
      }

      const sim = demo.sim;
      // The build window is for a player; here the next wave just comes.
      if (sim.state.status === "intermission") sim.startNextWave();

      accumulator += delta;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        sim.step();
        accumulator -= SIM_DT;
        steps++;
        if (isRaidOver(sim.state.status)) break;
      }
      play(renderer, sim.drainEvents());

      const state = sim.state;
      const over = isRaidOver(state.status) || state.elapsed >= DEMO_MAX_SECONDS;
      if (over) {
        // An empty board for a moment, then the next party at the door.
        renderer.setUnits([]);
        restAt = now + DEMO_REST_MS;
        return;
      }
      renderer.setUnits(demoUnits(state, false));
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      renderer.setUnits([]);
    };
  }, [active, rendererReady, rendererRef]);
}

/** The visible half of what App.onSimEvents does: no sound, no numbers. */
function play(renderer: DungeonRenderer, events: SimEvent[]): void {
  for (const event of events) {
    if (event.kind === "damage") {
      renderer.flashUnit(`a:${event.targetId}`);
      if (event.from) {
        const span = Math.hypot(event.from.x - event.x, event.from.y - event.y);
        if (span > BOLT_MIN_SPAN) {
          renderer.spawnBolt(
            event.from.x,
            event.from.y,
            event.x,
            event.y,
            event.source === "trap" ? 0xffc27a : 0xc9b6ff,
          );
        }
      }
    } else if (event.kind === "trap") {
      renderer.spawnRing(event.x, event.y);
    } else if (event.kind === "down") {
      renderer.knockbackUnit(`a:${event.targetId}`);
    } else if (event.kind === "minionDown") {
      renderer.spawnRing(event.x, event.y, 0x9d8bd8);
      renderer.knockbackUnit(`m:${event.targetId}`);
    } else if (event.kind === "killed" || event.kind === "captured") {
      renderer.spawnRing(event.x, event.y, 0xd86a4c);
      renderer.knockbackUnit(`a:${event.targetId}`);
    }
  }
}
