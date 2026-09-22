import type { MarkerView, UnitView } from "../DungeonRenderer";
import { CHAMPION_MODEL_SCALE } from "../types";
import type { StageRun } from "./StageRun";

/** How much bigger each tower level is drawn: a level you can see. */
const LEVEL_SCALE_STEP = 0.15;

/** What the board draws for a run: its towers and whoever is walking in. */
export function runUnits(run: StageRun, options: { labels?: boolean } = {}): UnitView[] {
  const labels = options.labels ?? true;
  const units: UnitView[] = [];
  for (const tower of run.towers) {
    units.push({
      id: `m:${tower.id}`,
      x: tower.x,
      y: tower.y,
      kind: `m_${tower.type}`,
      hp: 1,
      maxHp: 1,
      action: tower.attackUntil > run.time ? "attack" : "idle",
      facing: tower.facing,
      scale: 1 + LEVEL_SCALE_STEP * (tower.level - 1),
      label: labels && tower.level > 1 ? `Lv${tower.level}` : undefined,
      tier: tower.level,
    });
  }
  for (const enemy of run.enemies) {
    units.push({
      id: `a:${enemy.id}`,
      x: enemy.x,
      y: enemy.y,
      kind: `a_${enemy.cls}`,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      action: "walk",
      facing: enemy.facing,
      showHealth: true,
      scale: enemy.champion ? CHAMPION_MODEL_SCALE : undefined,
    });
  }
  return units;
}

export function runMarkers(run: StageRun): MarkerView[] {
  return run.traps.map((trap) => ({ id: `t:${trap.id}`, x: trap.x, y: trap.y, kind: trap.type, shape: "trap" as const }));
}

/** The open tiles, as the renderer wants them: flat keys. */
export function runFloor(run: StageRun): Set<number> {
  const w = run.stage.arena.w;
  return new Set(run.dugTiles().map((t) => t.y * w + t.x));
}
