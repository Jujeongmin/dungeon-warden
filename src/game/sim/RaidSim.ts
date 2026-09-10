import type {
  AdventurerClass,
  MinionType,
  PartyMember,
  PlacedMinion,
  PlacedObstacle,
  PlacedTrap,
  RaidOutcome,
  TrapType,
  WardenSkill,
} from "../types";
import { minionStatsFor, partyMemberStats, scaledAdventurer } from "./units";
import {
  BLESSING_HEAL,
  BLESSING_SHIELD,
  SKILL_STATS,
  TRAP_STATS,
} from "./traps";
import type { Point } from "./pathfinding";
import { buildRaidPath, findPath } from "./pathfinding";
import { blockedKey, blockedSet, inArena, type Arena } from "../arena";
import { decorBlocked } from "../decor";
import { OBSTACLE_STATS, type SimObstacle } from "./obstacles";

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
  | { kind: "minionDown"; targetId: string; x: number; y: number }
  | { kind: "obstacleHit"; targetId: string; amount: number; x: number; y: number }
  | { kind: "obstacleDown"; targetId: string; x: number; y: number };

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
  /** Leads the party: tougher, worth more, drawn larger. Set once, at spawn. */
  champion: boolean;
  /** This adventurer's own route. A falling wall changes it for everyone. */
  path: Point[];
  /** True while walking a route that runs through obstacles it must break. */
  breaking: boolean;
  /**
   * Id of a minion this adventurer has turned aside to kill.
   *
   * Set when that minion lands a hit and a way to reach it exists. Cleared
   * when it dies or when the way to it turns out not to exist after all.
   */
  hunting: string | null;
}

export type RaidStatus = "running" | RaidOutcome;

export interface RaidState {
  status: RaidStatus;
  elapsed: number;
  minions: SimMinion[];
  adventurers: SimAdventurer[];
  traps: SimTrap[];
  obstacles: SimObstacle[];
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
  arena: Arena;
  entrance: Point;
  core: Point;
  /** Treasury tiles that pull the party off the direct line. */
  lures: Point[];
  obstacles: PlacedObstacle[];
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
  private arena: Arena;
  private core: Point;
  private lures: Point[];
  /**
   * Tiles the room came with rubble on.
   *
   * Terrain, not placements: nothing can be built there and nobody walks
   * through, and unlike a wall the player put up it cannot be broken. Derived
   * from the arena, so it needs no input and cannot disagree with the picture.
   */
  private terrain: Set<number>;
  /**
   * Every mutation of this array's `alive`/`hp` must be followed by a call to
   * `routeAll()` in the same operation — a route computed against a stale
   * obstacle set can strand an adventurer mid-`breaking` while a walkable
   * path already exists elsewhere. Kill an obstacle through `killObstacle()`
   * below rather than flipping `alive` inline, so there is exactly one place
   * that has to get this right.
   */
  private obstacles: SimObstacle[];
  private destroyed: string[] = [];
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

    this.arena = options.arena;
    this.core = options.core;
    this.lures = options.lures;
    this.terrain = decorBlocked(options.arena, options.entrance, options.core);
    this.obstacles = options.obstacles.map((o) => ({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      hp: OBSTACLE_STATS[o.type].hp,
      maxHp: OBSTACLE_STATS[o.type].hp,
      alive: true,
    }));

    const start = options.entrance;
    this.adventurers = options.party.map((member, index) => {
      const stats = partyMemberStats(member.cls, member.level, member.champion);
      return {
        id: member.id,
        cls: member.cls,
        name: member.name,
        level: member.level,
        champion: member.champion === true,
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
        path: [],
        breaking: false,
        hunting: null,
      };
    });

    this.routeAll();
  }

  /**
   * Coordinates an adventurer cannot walk into right now.
   *
   * Minions count. Everything the player puts on a tile occupies it, so a
   * minion standing in a corridor is a wall that shoots back, and one standing
   * beside the corridor is simply not in the way. That is the whole shape of
   * the game: the player decides which of the two they are building.
   */
  /**
   * What a route may not pass through.
   *
   * Walls and scenery, and nothing else. Minions used to be in here and that
   * was the wrong rule: it made a minion a piece of maze, so putting one in
   * the road bent the road around it and the thing the player had just paid
   * for was never fought at all. The route now ignores the garrison entirely,
   * and a minion standing on it is walked into - see blockingTarget.
   *
   * Which leaves walls as the only thing that shapes the route, and that is
   * the division the game was designed around: walls decide where they walk,
   * minions decide what happens to them on the way.
   */
  private blocked(): Set<number> {
    const set = blockedSet(this.arena, this.obstacles.filter((o) => o.alive));
    for (const key of this.terrain) set.add(key);
    return set;
  }

  /**
   * Gives one adventurer a route from where it stands.
   *
   * A walkable route always wins, however long it is — that is the whole rule
   * of this game, and it is what makes folding the corridor worth doing. Only
   * when there is no way through at all does it fall back to the route it
   * would walk if the walls were not there, and start hitting them.
   */
  private route(adventurer: SimAdventurer): void {
    const from = { x: Math.round(adventurer.x), y: Math.round(adventurer.y) };

    /*
     * A hunt outranks the core.
     *
     * Something shot at it and it can get there, so it goes there first. The
     * route is re-checked here rather than trusted from when the hunt started:
     * this runs again every time a wall or a minion falls, and a way in that
     * existed then may be the only thing that has changed since.
     */
    const hunted = this.huntedBy(adventurer);
    if (hunted) {
      const chase = this.pathToMinion(adventurer, hunted);
      if (chase) {
        adventurer.path = chase;
        adventurer.pathIndex = 0;
        adventurer.breaking = false;
        return;
      }
      adventurer.hunting = null;
    }

    const open = buildRaidPath(this.arena, from, this.core, this.lures, this.blocked());
    if (open) {
      adventurer.path = open;
      adventurer.breaking = false;
    } else {
      // No walkable route exists right now, so fall back to the route the
      // party would take if no obstacle stood in the way at all — that is
      // what breaking through means. If even THAT is unreachable, `from` or
      // `this.core` sits outside the arena, which is a bug, not a game state:
      // resolveStatus() treats "already at path end" as a breach, so silently
      // falling back to a length-1 path here would hand the attacker a free,
      // unreported win instead of surfacing the broken input.
      // The rubble the room came with is still there. Breaking through means
      // going through what the player built, not through the walls of the
      // dungeon itself — so the fallback drops the placements and keeps the
      // terrain.
      const fallback = buildRaidPath(this.arena, from, this.core, this.lures, this.terrain);
      if (!fallback) {
        throw new Error(
          `RaidSim: no route from (${from.x}, ${from.y}) to the core (${this.core.x}, ${this.core.y}) exists even with no obstacles — start or core must be outside the arena.`,
        );
      }
      adventurer.path = fallback;
      adventurer.breaking = true;
    }
    adventurer.pathIndex = 0;
  }

  private routeAll(): void {
    for (const adventurer of this.adventurers) {
      if (adventurer.alive) this.route(adventurer);
    }
  }

  private obstacleAt(x: number, y: number): SimObstacle | null {
    for (const o of this.obstacles) {
      if (o.alive && o.x === x && o.y === y) return o;
    }
    return null;
  }

  /**
   * Whether being shot at is worth turning aside for.
   *
   * An adventurer that takes a hit from a minion looks for a way to reach it.
   * If one exists it goes and kills it, however far round it has to walk, and
   * then carries on to the core. If the minion is walled off with no way in,
   * it is ignored and the party keeps walking — which is what makes putting a
   * wall in front of your archers the difference between a tower and a target.
   *
   * Only the first attacker sticks. Re-picking on every hit would leave a
   * party crossfired from two sides turning on the spot forever.
   */
  private considerHunting(adventurer: SimAdventurer, attacker: SimMinion): void {
    if (adventurer.hunting || !attacker.alive) return;
    if (!this.pathToMinion(adventurer, attacker)) return;

    adventurer.hunting = attacker.id;
    this.route(adventurer);
  }

  /**
   * A route to the tile a minion is standing on.
   *
   * The minion's own tile is excluded from what blocks the way, or the goal
   * would be unreachable by definition. Everything else still blocks: a wall
   * in the way is a wall, and this is the check that decides whether an archer
   * behind one is safe.
   */
  private pathToMinion(adventurer: SimAdventurer, minion: SimMinion): Point[] | null {
    const blocked = this.blocked();
    blocked.delete(blockedKey(Math.round(minion.x), Math.round(minion.y), this.arena.w));

    const from = { x: Math.round(adventurer.x), y: Math.round(adventurer.y) };
    const goal = { x: Math.round(minion.x), y: Math.round(minion.y) };
    return findPath(this.arena, from, goal, blocked);
  }

  /** The minion this adventurer turned aside for, if it is still standing. */
  private huntedBy(adventurer: SimAdventurer): SimMinion | null {
    if (!adventurer.hunting) return null;
    for (const m of this.minions) {
      if (m.id === adventurer.hunting) return m.alive ? m : null;
    }
    return null;
  }

  private minionAt(x: number, y: number): SimMinion | null {
    for (const m of this.minions) {
      if (m.alive && Math.round(m.x) === x && Math.round(m.y) === y) return m;
    }
    return null;
  }

  /**
   * Whatever stands on this adventurer's next step — a wall or a minion.
   *
   * This is the only thing an adventurer ever attacks. They are here for the
   * core, not for the garrison: a minion beside the route is shooting them the
   * whole way past and they do not so much as turn their head. The player who
   * wants that minion fought has to put it in the road.
   */
  private blockingTarget(
    adventurer: SimAdventurer,
  ): { obstacle: SimObstacle } | { minion: SimMinion } | null {
    const next = adventurer.path[adventurer.pathIndex + 1];
    if (!next) return null;

    /*
     * A minion on the next tile is always a fight.
     *
     * Routes are built without the garrison in them, so a minion never has a
     * way round to be compared against - if it is on the route, the route
     * goes through it, and going through it means killing it.
     */
    const minion = this.minionAt(next.x, next.y);
    if (minion) return { minion };

    /*
     * A wall is different, and the `breaking` test is why. Routes DO go round
     * walls, so a wall on the route can only mean there was no route at all
     * and this party is chewing its way through in a straight line.
     */
    if (!adventurer.breaking) return null;
    const obstacle = this.obstacleAt(next.x, next.y);
    return obstacle ? { obstacle } : null;
  }

  /**
   * Kills one obstacle: zeroes it out, reports `obstacleDown`, and re-routes
   * every adventurer.
   *
   * This is the only place allowed to set an obstacle's `alive` to false —
   * see the comment on the `obstacles` field. Routing every kill through here
   * means a second kill site added later (a warden skill that collapses a
   * wall, say) gets the mandatory re-route for free instead of relying on
   * whoever writes it to remember the rule.
   */
  /**
   * Kills one minion and re-routes.
   *
   * Not because the route changes - it does not, the garrison is not in the
   * blocked set - but because anyone who had turned aside to hunt this one
   * needs pointing back at the core. This is the only place allowed to clear
   * a minion's `alive`.
   */
  private killMinion(minion: SimMinion): void {
    minion.hp = 0;
    minion.alive = false;
    // Whoever came for it has no reason to stand there any more.
    for (const adventurer of this.adventurers) {
      if (adventurer.hunting === minion.id) adventurer.hunting = null;
    }
    this.events.push({
      kind: "minionDown",
      targetId: minion.id,
      x: minion.x,
      y: minion.y,
    });
    this.routeAll();
  }

  private killObstacle(obstacle: SimObstacle): void {
    obstacle.hp = 0;
    obstacle.alive = false;
    this.destroyed.push(obstacle.id);
    this.events.push({
      kind: "obstacleDown",
      targetId: obstacle.id,
      x: obstacle.x,
      y: obstacle.y,
    });
    // One hole changes the map for everyone, so everyone re-routes.
    this.routeAll();
  }

  /** A copy, not a live reference — callers must not be able to mutate sim state. */
  get destroyedObstacleIds(): string[] {
    return [...this.destroyed];
  }

  get state(): RaidState {
    return {
      status: this.status,
      elapsed: this.elapsed,
      minions: this.minions,
      adventurers: this.adventurers,
      traps: this.traps,
      obstacles: this.obstacles.map((o) => ({ ...o })),
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

      /*
       * The tile has to be one a minion could stand on in the first place —
       * rallying into the rubble or onto the core would put the garrison
       * somewhere the player could never have built it.
       *
       * Routes are no longer affected: the garrison is not in the blocked set,
       * so moving it does not move anybody's path. The re-route below is for
       * the hunts — an adventurer walking towards where a minion used to be
       * has to be pointed at where it is now.
       *
       * The cooldown is spent before this point, so an illegal tile refunds it
       * by returning early — a tap that does nothing must not cost the skill.
       */
      const key = blockedKey(target.x, target.y, this.arena.w);
      const illegal =
        !inArena(this.arena, target.x, target.y) ||
        this.terrain.has(key) ||
        (target.x === this.core.x && target.y === this.core.y) ||
        this.obstacles.some((o) => o.alive && o.x === target.x && o.y === target.y);

      if (illegal) {
        this.skillCooldowns[skill] = 0;
        return false;
      }

      for (const minion of this.minions) {
        if (!minion.alive) continue;
        minion.x = target.x;
        minion.y = target.y;
      }
      this.routeAll();
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
    from?: SimMinion,
  ): void {
    if (!target.alive || target.downed > 0) return;

    // Shot at by something it can get to: it turns aside and goes for it.
    if (from) this.considerHunting(target, from);

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

      const stats = partyMemberStats(adventurer.cls, adventurer.level, adventurer.champion);
      adventurer.cooldown = Math.max(0, adventurer.cooldown - SIM_DT);

      /*
       * The only thing an adventurer attacks is whatever is standing in the
       * way, and only when there is no way round it at all.
       *
       * They used to swing at any minion within reach, which made a minion
       * beside the corridor a thing to be killed rather than a thing to walk
       * past. Now the garrison is ignored: it shoots them the whole way and
       * they keep running for the core. A minion the player wants fought has
       * to be a minion the player put in the road.
       */
      /*
       * A hunt, if one is on: walk to whatever shot at it and kill that first.
       *
       * Attacked from its own reach rather than from the tile itself, so a
       * ranged class stops short and shoots — the same way it deals with a
       * minion standing in the road.
       */
      const quarry = this.huntedBy(adventurer);
      if (quarry && distance(adventurer.x, adventurer.y, quarry.x, quarry.y) <= stats.range) {
        adventurer.action = "attack";
        adventurer.facing = Math.atan2(quarry.x - adventurer.x, quarry.y - adventurer.y);

        if (adventurer.cooldown === 0) {
          adventurer.cooldown = stats.attackInterval;
          if (quarry.shield <= 0) {
            quarry.hp -= stats.damage;
            if (quarry.hp <= 0) this.killMinion(quarry);
          }
        }
        continue;
      }

      const barrier = this.blockingTarget(adventurer);
      if (barrier) {
        const spot = "obstacle" in barrier ? barrier.obstacle : barrier.minion;
        adventurer.action = "attack";
        adventurer.facing = Math.atan2(spot.x - adventurer.x, spot.y - adventurer.y);

        if (adventurer.cooldown === 0) {
          adventurer.cooldown = stats.attackInterval;

          if ("obstacle" in barrier) {
            const wall = barrier.obstacle;
            wall.hp -= stats.damage;
            this.events.push({
              kind: "obstacleHit",
              targetId: wall.id,
              amount: stats.damage,
              x: wall.x,
              y: wall.y,
            });
            if (wall.hp <= 0) this.killObstacle(wall);
          } else {
            const guard = barrier.minion;
            // A blessed minion still occupies the corridor, it just takes no
            // damage — the skill buys time rather than removing the fight.
            if (guard.shield <= 0) {
              guard.hp -= stats.damage;
              if (guard.hp <= 0) this.killMinion(guard);
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

    while (remaining > 0 && adventurer.pathIndex < adventurer.path.length - 1) {
      const next = adventurer.path[adventurer.pathIndex + 1];
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
      this.damageAdventurer(target, stats.damage, "melee", minion);
    }
  }

  /*
   * There is no minion-picking any more.
   *
   * An adventurer used to choose a minion within reach — the nearest one, or
   * for the ranged classes the furthest, so a mage behind a warrior got picked
   * off. All of it is gone with the rule it served: adventurers attack what
   * blocks them and nothing else, so the only minion that is ever a target is
   * the one on the next tile of the route, and `blockingTarget` finds it.
   */

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
      (a) => a.alive && a.spawned && a.downed <= 0 && a.pathIndex >= a.path.length - 1,
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
