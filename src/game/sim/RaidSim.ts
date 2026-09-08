import type {
  AdventurerClass,
  MinionType,
  PartyMember,
  PlacedMinion,
  PlacedTrap,
  RaidOutcome,
  TrapType,
  WardenSkill,
} from "../types";
import { minionStatsFor, scaledAdventurer } from "./units";
import {
  BLESSING_HEAL,
  BLESSING_SHIELD,
  SKILL_STATS,
  TRAP_STATS,
} from "./traps";
import type { Point } from "./pathfinding";

/** Simulation step. Everything advances in whole steps so runs are reproducible. */
export const SIM_DT = 1 / 20;

/** Attackers give up rather than letting a stalemate hang forever. */
const RAID_TIMEOUT_SECONDS = 180;

/** Gap between adventurers entering, so a party files in instead of stacking. */
const SPAWN_INTERVAL_SECONDS = 0.9;

/**
 * A beaten adventurer lies helpless for this long before bleeding out. Capture
 * has to happen inside the window, which is what makes taking prisoners a
 * deliberate build rather than something that just happens.
 */
export const DOWNED_SECONDS = 3;

/** How close a living minion must be to drag a downed adventurer away. */
const CAPTURE_RADIUS = 1.6;

export interface SimMinion {
  id: string;
  type: MinionType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  alive: boolean;
  /** Seconds of remaining invulnerability from 어둠의 가호. */
  shield: number;
  action: SimAction;
  /** Facing in radians, so a model can turn towards what it is hitting. */
  facing: number;
}

export interface SimTrap {
  id: string;
  type: TrapType;
  x: number;
  y: number;
  /** Seconds until it can fire again. */
  cooldown: number;
  triggers: number;
}

export interface SimBurn {
  dps: number;
  remaining: number;
}

/** What a unit is doing right now, for animation and effects. */
export type SimAction = "idle" | "walk" | "attack" | "down";

/**
 * Things that happened during a step.
 *
 * The simulation stays pure, so it reports rather than draws: the renderer
 * turns these into floating numbers and flashes, and the UI turns them into
 * sound. Drained every frame so the list never grows.
 */
export type SimEvent =
  | { kind: "damage"; targetId: string; amount: number; x: number; y: number; source: "melee" | "trap" | "burn" }
  | { kind: "trap"; trapId: string; x: number; y: number }
  | { kind: "down"; targetId: string; x: number; y: number }
  | { kind: "killed"; targetId: string; x: number; y: number }
  | { kind: "captured"; targetId: string; x: number; y: number }
  | { kind: "minionDown"; targetId: string; x: number; y: number };

export interface SimAdventurer {
  id: string;
  cls: AdventurerClass;
  name: string;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  pathIndex: number;
  spawnAt: number;
  spawned: boolean;
  alive: boolean;
  burn: SimBurn | null;
  /** Seconds left in the downed window. 0 when standing or already resolved. */
  downed: number;
  /** How this adventurer left the raid, once it is out. */
  fate: "none" | "killed" | "captured";
  action: SimAction;
  facing: number;
}

export type RaidStatus = "running" | RaidOutcome;

export interface RaidState {
  status: RaidStatus;
  elapsed: number;
  minions: SimMinion[];
  adventurers: SimAdventurer[];
  traps: SimTrap[];
  skillCooldowns: Record<WardenSkill, number>;
  killed: number;
  captured: number;
  killedIds: string[];
  capturedIds: string[];
  jailFree: number;
  trapDamage: number;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface RaidSimOptions {
  minions: PlacedMinion[];
  traps?: PlacedTrap[];
  party: PartyMember[];
  /** Entrance-to-core tile sequence, precomputed by A*. */
  path: Point[];
  seed: number;
  /** Workshop rooms shorten trap cooldowns. 1 = no rooms. */
  trapCooldownScale?: number;
  /** Free jail cells. Zero means every beaten adventurer dies instead. */
  jailFree?: number;
  /** Looted weapon tier per minion id, for the damage bonus. */
  weaponTiers?: Record<string, number>;
  /** Research multipliers. 1 = nothing researched. */
  minionDamageScale?: number;
  minionHpScale?: number;
  trapDamageScale?: number;
}

/**
 * Deterministic raid simulation. Pure logic — no three.js, no DOM, no clock of
 * its own. The same inputs and the same number of steps always produce the same
 * result, which is what lets the server re-run a suspicious raid later.
 */
export class RaidSim {
  readonly seed: number;
  private path: Point[];
  private minions: SimMinion[];
  private traps: SimTrap[];
  private adventurers: SimAdventurer[];
  private status: RaidStatus = "running";
  private elapsed = 0;
  private trapCooldownScale: number;
  private trapDamage = 0;
  private jailFree: number;
  private trapDamageScale = 1;
  private minionStats = new Map<string, ReturnType<typeof minionStatsFor>>();
  private skillCooldowns: Record<WardenSkill, number> = {
    blessing: 0,
    rally: 0,
    detonate: 0,
  };
  private events: SimEvent[] = [];

  constructor(options: RaidSimOptions) {
    this.seed = options.seed;
    this.path = options.path;
    this.trapCooldownScale = options.trapCooldownScale ?? 1;
    this.jailFree = options.jailFree ?? 0;

    this.trapDamageScale = options.trapDamageScale ?? 1;
    const damageScale = options.minionDamageScale ?? 1;
    const hpScale = options.minionHpScale ?? 1;

    this.minions = options.minions.map((m) => {
      const base = minionStatsFor(m, options.weaponTiers?.[m.id] ?? 0);
      // Research scales every minion, on top of any looted weapon.
      const stats = {
        ...base,
        hp: Math.round(base.hp * hpScale),
        damage: Math.round(base.damage * damageScale),
      };
      this.minionStats.set(m.id, stats);
      return {
        id: m.id,
        type: m.type,
        x: m.x,
        y: m.y,
        hp: stats.hp,
        maxHp: stats.hp,
        cooldown: 0,
        alive: true,
        shield: 0,
        action: "idle" as SimAction,
        facing: 0,
      };
    });

    this.traps = (options.traps ?? []).map((t) => ({
      id: t.id,
      type: t.type,
      x: t.x,
      y: t.y,
      cooldown: 0,
      triggers: 0,
    }));

    const start = options.path[0];
    this.adventurers = options.party.map((member, index) => {
      const stats = scaledAdventurer(member.cls, member.level);
      return {
        id: member.id,
        cls: member.cls,
        name: member.name,
        level: member.level,
        x: start.x,
        y: start.y,
        hp: stats.hp,
        maxHp: stats.hp,
        cooldown: 0,
        pathIndex: 0,
        spawnAt: index * SPAWN_INTERVAL_SECONDS,
        spawned: index === 0,
        alive: true,
        burn: null,
        downed: 0,
        fate: "none",
        action: "walk" as SimAction,
        facing: 0,
      };
    });
  }

  get state(): RaidState {
    return {
      status: this.status,
      elapsed: this.elapsed,
      minions: this.minions,
      adventurers: this.adventurers,
      traps: this.traps,
      skillCooldowns: this.skillCooldowns,
      killed: this.adventurers.filter((a) => a.fate === "killed").length,
      captured: this.adventurers.filter((a) => a.fate === "captured").length,
      killedIds: this.adventurers.filter((a) => a.fate === "killed").map((a) => a.id),
      capturedIds: this.adventurers.filter((a) => a.fate === "captured").map((a) => a.id),
      jailFree: this.jailFree,
      trapDamage: Math.round(this.trapDamage),
    };
  }

  /** Minions that have fallen and could be brought back. */
  get fallenMinionCount(): number {
    return this.minions.filter((m) => !m.alive).length;
  }

  /**
   * Puts every fallen minion back on its feet at half health.
   *
   * This is the rewarded-ad payout. It is deliberately an effect inside the
   * simulation rather than currency: the client already drives the fight, so
   * granting it needs no server verification, and the worst a cheater gets is
   * one comeback they could have had by placing another minion.
   */
  reviveFallenMinions(): number {
    if (this.status !== "running") return 0;

    let revived = 0;
    for (const minion of this.minions) {
      if (minion.alive) continue;
      minion.alive = true;
      minion.hp = Math.max(1, Math.round(minion.maxHp * 0.5));
      minion.cooldown = 0;
      minion.action = "idle";
      revived++;
    }
    return revived;
  }

  /** Takes the events since the last call. */
  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** True when the skill is off cooldown and the raid is still live. */
  canUseSkill(skill: WardenSkill): boolean {
    return this.status === "running" && this.skillCooldowns[skill] <= 0;
  }

  /**
   * Applies a warden skill. Returns false when it was on cooldown, so the UI
   * does not have to duplicate the check.
   */
  useSkill(skill: WardenSkill, target?: Point): boolean {
    if (!this.canUseSkill(skill)) return false;
    this.skillCooldowns[skill] = SKILL_STATS[skill].cooldown;

    if (skill === "blessing") {
      for (const minion of this.minions) {
        if (!minion.alive) continue;
        minion.hp = Math.min(minion.maxHp, minion.hp + minion.maxHp * BLESSING_HEAL);
        minion.shield = BLESSING_SHIELD;
      }
      return true;
    }

    if (skill === "rally") {
      if (!target) return true;
      for (const minion of this.minions) {
        if (!minion.alive) continue;
        minion.x = target.x;
        minion.y = target.y;
      }
      return true;
    }

    // detonate: every trap fires now, ready or not.
    for (const trap of this.traps) {
      trap.cooldown = 0;
      this.fireTrap(trap, true);
    }
    return true;
  }

  /** Advances exactly one SIM_DT. Call repeatedly from a fixed-step accumulator. */
  step(): void {
    if (this.status !== "running") return;

    this.elapsed += SIM_DT;

    for (const adventurer of this.adventurers) {
      if (!adventurer.spawned && this.elapsed >= adventurer.spawnAt) {
        adventurer.spawned = true;
      }
    }

    for (const skill of Object.keys(this.skillCooldowns) as WardenSkill[]) {
      this.skillCooldowns[skill] = Math.max(0, this.skillCooldowns[skill] - SIM_DT);
    }

    this.stepBurn();
    this.stepTraps();
    this.stepAdventurers();
    this.stepMinions();
    this.stepDowned();
    this.resolveStatus();
  }

  private stepBurn(): void {
    for (const adventurer of this.adventurers) {
      if (!adventurer.alive || !adventurer.burn) continue;

      this.damageAdventurer(adventurer, adventurer.burn.dps * SIM_DT, "burn");

      // The tick above can be lethal, and death clears the burn.
      if (!adventurer.burn) continue;
      adventurer.burn.remaining -= SIM_DT;
      if (adventurer.burn.remaining <= 0) adventurer.burn = null;
    }
  }

  private stepTraps(): void {
    for (const trap of this.traps) {
      trap.cooldown = Math.max(0, trap.cooldown - SIM_DT);
      if (trap.cooldown > 0) continue;

      const stats = TRAP_STATS[trap.type];
      const reach = stats.range > 0 ? stats.range : stats.triggerRadius;
      if (!this.nearestAdventurer(trap.x, trap.y, reach)) continue;

      this.fireTrap(trap, false);
    }
  }

  /**
   * Discharges a trap. `forced` comes from 강제 발동, which fires traps that
   * have nothing in range — wasting them if the player mistimes it.
   */
  private fireTrap(trap: SimTrap, forced: boolean): void {
    const stats = TRAP_STATS[trap.type];
    const reach = stats.range > 0 ? stats.range : stats.triggerRadius;

    const primary = this.nearestAdventurer(trap.x, trap.y, reach);
    if (!primary && !forced) return;

    trap.cooldown = stats.cooldown * this.trapCooldownScale;
    trap.triggers++;
    this.events.push({ kind: "trap", trapId: trap.id, x: trap.x, y: trap.y });
    if (!primary) return;

    const victims: SimAdventurer[] =
      stats.aoe > 0
        ? this.adventurers.filter(
            (a) => a.alive && a.spawned && distance(a.x, a.y, trap.x, trap.y) <= stats.aoe,
          )
        : [primary];

    for (const victim of victims) {
      this.damageAdventurer(victim, stats.damage * this.trapDamageScale, "trap");
      if (stats.burn && victim.alive) {
        victim.burn = {
          dps: stats.burn.dps * this.trapDamageScale,
          remaining: stats.burn.duration,
        };
      }
    }
  }

  private damageAdventurer(
    target: SimAdventurer,
    amount: number,
    source: "melee" | "trap" | "burn",
  ): void {
    if (!target.alive || target.downed > 0) return;

    // Rogues take much less from traps, mages and barbarians a little more.
    if (source !== "melee") {
      amount *= scaledAdventurer(target.cls, target.level).trapResistance;
      this.trapDamage += amount;
    }
    target.hp -= amount;

    this.events.push({
      kind: "damage",
      targetId: target.id,
      amount,
      x: target.x,
      y: target.y,
      source,
    });

    if (target.hp <= 0) {
      // Beaten, not dead yet. The next few seconds decide whether this becomes
      // loot or a prisoner.
      target.hp = 0;
      target.burn = null;
      target.downed = DOWNED_SECONDS;
      target.action = "down";
      this.events.push({ kind: "down", targetId: target.id, x: target.x, y: target.y });
    }
  }

  /**
   * Resolves helpless adventurers.
   *
   * Capture needs a free cell and a minion standing over the body, so a jail
   * only pays off if the fighting happens near one. Otherwise the window runs
   * out and the body is looted instead — the two outcomes are exclusive.
   */
  private stepDowned(): void {
    for (const adventurer of this.adventurers) {
      if (!adventurer.alive || adventurer.downed <= 0) continue;

      adventurer.action = "down";

      if (this.jailFree > 0 && this.minionNear(adventurer.x, adventurer.y, CAPTURE_RADIUS)) {
        this.jailFree--;
        adventurer.downed = 0;
        adventurer.alive = false;
        adventurer.fate = "captured";
        this.events.push({
          kind: "captured",
          targetId: adventurer.id,
          x: adventurer.x,
          y: adventurer.y,
        });
        continue;
      }

      adventurer.downed -= SIM_DT;
      if (adventurer.downed <= 0) {
        adventurer.downed = 0;
        adventurer.alive = false;
        adventurer.fate = "killed";
        this.events.push({
          kind: "killed",
          targetId: adventurer.id,
          x: adventurer.x,
          y: adventurer.y,
        });
      }
    }
  }

  private minionNear(x: number, y: number, radius: number): boolean {
    return this.minions.some(
      (m) => m.alive && distance(x, y, m.x, m.y) <= radius,
    );
  }

  private stepAdventurers(): void {
    for (const adventurer of this.adventurers) {
      if (!adventurer.alive || !adventurer.spawned || adventurer.downed > 0) continue;

      const stats = scaledAdventurer(adventurer.cls, adventurer.level);
      adventurer.cooldown = Math.max(0, adventurer.cooldown - SIM_DT);

      // Anything in reach is dealt with before advancing. A blocking minion
      // standing on the corridor is reached naturally by walking into range.
      const target = this.pickMinion(adventurer.x, adventurer.y, stats.range, stats.targetsBackline);
      if (target) {
        adventurer.action = "attack";
        adventurer.facing = Math.atan2(target.x - adventurer.x, target.y - adventurer.y);

        if (adventurer.cooldown === 0) {
          adventurer.cooldown = stats.attackInterval;
          // A blessed minion still occupies the corridor, it just takes no
          // damage — the skill buys time rather than removing the fight.
          if (target.shield <= 0) {
            target.hp -= stats.damage;
            if (target.hp <= 0) {
              target.hp = 0;
              target.alive = false;
              this.events.push({
                kind: "minionDown",
                targetId: target.id,
                x: target.x,
                y: target.y,
              });
            }
          }
        }
        continue;
      }

      adventurer.action = "walk";
      const beforeX = adventurer.x;
      const beforeY = adventurer.y;
      this.advanceAlongPath(adventurer, stats.speed);
      if (adventurer.x !== beforeX || adventurer.y !== beforeY) {
        adventurer.facing = Math.atan2(adventurer.x - beforeX, adventurer.y - beforeY);
      }
    }
  }

  private advanceAlongPath(adventurer: SimAdventurer, speed: number): void {
    let remaining = speed * SIM_DT;

    while (remaining > 0 && adventurer.pathIndex < this.path.length - 1) {
      const next = this.path[adventurer.pathIndex + 1];
      const gap = distance(adventurer.x, adventurer.y, next.x, next.y);

      if (gap <= remaining) {
        adventurer.x = next.x;
        adventurer.y = next.y;
        adventurer.pathIndex++;
        remaining -= gap;
      } else {
        adventurer.x += ((next.x - adventurer.x) / gap) * remaining;
        adventurer.y += ((next.y - adventurer.y) / gap) * remaining;
        remaining = 0;
      }
    }
  }

  private stepMinions(): void {
    for (const minion of this.minions) {
      if (!minion.alive) continue;

      // Converts and equipped minions have per-unit stats, so they come from
      // the map built in the constructor rather than a static table.
      const stats = this.minionStats.get(minion.id)!;
      minion.cooldown = Math.max(0, minion.cooldown - SIM_DT);
      minion.shield = Math.max(0, minion.shield - SIM_DT);

      const target = this.nearestAdventurer(minion.x, minion.y, stats.range);
      minion.action = target ? "attack" : "idle";
      if (target) minion.facing = Math.atan2(target.x - minion.x, target.y - minion.y);

      if (minion.cooldown > 0 || !target) continue;

      minion.cooldown = stats.attackInterval;
      this.damageAdventurer(target, stats.damage, "melee");
    }
  }

  /**
   * Which minion an adventurer swings at.
   *
   * Melee classes take whatever is in the way. Ranged classes reach past it
   * for the furthest thing they can hit, which is how a mage tucked behind a
   * warrior gets punished for standing too close to the corridor.
   */
  private pickMinion(
    x: number,
    y: number,
    range: number,
    backline: boolean,
  ): SimMinion | null {
    let best: SimMinion | null = null;
    let bestDistance = backline ? -Infinity : Infinity;

    for (const minion of this.minions) {
      if (!minion.alive) continue;
      const d = distance(x, y, minion.x, minion.y);
      if (d > range) continue;
      if (backline ? d > bestDistance : d < bestDistance) {
        best = minion;
        bestDistance = d;
      }
    }
    return best;
  }

  private nearestAdventurer(x: number, y: number, range: number): SimAdventurer | null {
    let best: SimAdventurer | null = null;
    let bestDistance = Infinity;
    for (const adventurer of this.adventurers) {
      // A downed adventurer is out of the fight; minions and traps ignore them.
      if (!adventurer.alive || !adventurer.spawned || adventurer.downed > 0) continue;
      const d = distance(x, y, adventurer.x, adventurer.y);
      if (d <= range && d < bestDistance) {
        best = adventurer;
        bestDistance = d;
      }
    }
    return best;
  }

  private resolveStatus(): void {
    const reachedCore = this.adventurers.some(
      (a) => a.alive && a.spawned && a.downed <= 0 && a.pathIndex >= this.path.length - 1,
    );
    if (reachedCore) {
      this.status = "breached";
      return;
    }

    if (this.adventurers.every((a) => !a.alive)) {
      this.status = "repelled";
      return;
    }

    if (this.elapsed >= RAID_TIMEOUT_SECONDS) {
      this.status = "repelled";
    }
  }
}
