import type { TrapType } from "../types";

export interface TrapStats {
  /** Instant damage on trigger. */
  damage: number;
  /** Seconds before the trap can fire again. */
  cooldown: number;
  /** How close an adventurer must get for a pressure trap to fire. 0 = ranged. */
  triggerRadius: number;
  /** Splash radius around the trap tile. 0 = single target. */
  aoe: number;
  /** Firing range for traps that shoot instead of being stepped on. */
  range: number;
  /** Damage over time applied on hit. */
  burn?: { dps: number; duration: number };
}

export const TRAP_STATS: Record<TrapType, TrapStats> = {
  spike: { damage: 18, cooldown: 6, triggerRadius: 0.5, aoe: 0, range: 0 },
  arrow: { damage: 14, cooldown: 4, triggerRadius: 0, aoe: 0, range: 3.5 },
  rockfall: { damage: 30, cooldown: 12, triggerRadius: 0.6, aoe: 1.2, range: 0 },
  flame: {
    damage: 6,
    cooldown: 10,
    triggerRadius: 0.6,
    aoe: 1.0,
    range: 0,
    burn: { dps: 9, duration: 4 },
  },
};
