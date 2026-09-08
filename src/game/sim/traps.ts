import type { TrapType, WardenSkill } from "../types";

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

/** Mirrored in server.js for cost and validation. */
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

export interface SkillStats {
  cooldown: number;
  /** Only rally needs a target tile. */
  targeted: boolean;
}

export const SKILL_STATS: Record<WardenSkill, SkillStats> = {
  blessing: { cooldown: 25, targeted: false },
  rally: { cooldown: 30, targeted: true },
  detonate: { cooldown: 20, targeted: false },
};

/** Fraction of max hp restored by 어둠의 가호. */
export const BLESSING_HEAL = 0.4;
/** Seconds of invulnerability granted by 어둠의 가호. */
export const BLESSING_SHIELD = 3;
