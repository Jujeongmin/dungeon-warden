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
import { minionStatsFor, partyMemberStats, scaledAdventurer } from "./units";
import {
  BLESSING_HEAL,
  BLESSING_SHIELD,
  SKILL_STATS,
  TRAP_STATS,
} from "./traps";
import type { Point } from "./pathfinding";
import { buildRaidPath, findPath } from "./pathfinding";
import { blockedKey, inArena, type Arena } from "../arena";


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

/**
 * How fast a ridden body walks, in tiles per second.
 *
 * Above every adventurer in the roster, which top out at 2.1. A body under a
 * hand should feel like one - and the warden is spending its own attention on
 * driving it, which is the scarcest thing it has during a raid.
 */
const POSSESSED_SPEED = 2.6;

/** How long a warrior waits between shoves, and how long a shoved adventurer reels. */
export const SHOVE_COOLDOWN = 6;
export const SHOVE_STAGGER = 0.8;
/** How long a mage waits between blasts, and what one is worth against a normal blow. */
export const BLAST_COOLDOWN = 8;
export const BLAST_MULTIPLIER = 2.5;
/** How long a guard braces - the shield the warden's blessing gives - and how long before again. */
export const BRACE_SECONDS = 3;
export const BRACE_COOLDOWN = 12;
/** A grunt's lunge: how far it looks, how far it closes, what the blow is worth, and the wait. */
export const LUNGE_REACH = 4;
export const LUNGE_STEP = 2.5;
export const LUNGE_MULTIPLIER = 2;
export const LUNGE_COOLDOWN = 5;
/**
 * What the warden's own hand is worth inside a body.
 *
 * A ridden minion used to be exactly the minion - the same blows on the same
 * clock, only aimed by hand - and measured against the minion left to itself
 * it changed nothing: a road that fell without the warden fell with it. The
 * warden is the dungeon's master, and climbing in costs its attention and
 * risks the body, so the body hits harder and takes less while it is there.
 */
export const WARDEN_MIGHT = 1.25;
export const WARDEN_GUARD = 0.8;

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
  | {
      kind: "damage";
      targetId: string;
      amount: number;
      x: number;
      y: number;
      source: "melee" | "trap" | "burn";
      /**
       * Where the blow came from, when it came from somewhere.
       *
       * Everything that hurts at a distance - an arrow slit, a mage, a
       * warden riding one - landed as a number over the victim with nothing
       * to say what had shot them. Carrying the other end of the line lets
       * the renderer draw it. Absent for burn, which comes from the victim.
       */
      from?: { x: number; y: number };
    }
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
  /** Leads the party: tougher, worth more, drawn larger. Set once, at spawn. */
  champion: boolean;
  /** This adventurer's own route. A falling wall changes it for everyone. */
  path: Point[];
  /**
   * Id of a minion this adventurer has turned aside to kill.
   *
   * Set when that minion lands a hit and a way to reach it exists. Cleared
   * when it dies or when the way to it turns out not to exist after all.
   */
  hunting: string | null;
  /**
   * Put down by a blow from the body the warden was riding at the time.
   *
   * Set once, at the blow that drops them, and never cleared - so hopping
   * out of that body afterwards does not take the credit away. See
   * src/game/wardenBonus.ts for what it is worth.
   */
  downedByWarden: boolean;
}

/**
 * `intermission` is the gap between waves: the fighting has stopped, the raid
 * has not finished, and the player is building. It is deliberately not an
 * outcome - nothing is settled and nobody has won.
 */
export type RaidStatus = "running" | "intermission" | RaidOutcome;

/** True once the raid is over for good, either way. */
export function isRaidOver(status: RaidStatus): boolean {
  return status === "repelled" || status === "breached";
}

/** Seconds the player gets to build between waves. */
export const INTERMISSION_SECONDS = 18;

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
  /** Killed or captured after a blow from the ridden body put them down. */
  wardenDownIds: string[];
  jailFree: number;
  trapDamage: number;
  /** Which wave is on the board, 1-based. */
  wave: number;
  /** How many waves this raid is made of. */
  waves: number;
  /** Seconds left in the build window. Zero unless the status is intermission. */
  intermissionLeft: number;
  /** Which minion the warden is riding, if any. */
  possessedId: string | null;
  /** Seconds until the ridden body's skill is ready again. Zero when riding nothing. */
  possessedSkill: number;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface RaidSimOptions {
  minions: PlacedMinion[];
  traps?: PlacedTrap[];
  /** The first wave. Kept for callers that send exactly one. */
  party: PartyMember[];
  /**
   * Every wave of the raid, in order. Defaults to `[party]`.
   *
   * The waves live in here rather than in a loop outside, because everything
   * that has to survive between them lives in here: a minion's remaining
   * health, a trap's cooldown, a wall's damage. Rebuilding the simulation
   * per wave would hand the player a fresh garrison every time.
   */
  waves?: PartyMember[][];
  arena: Arena;
  entrance: Point;
  core: Point;
  /** Treasury tiles that pull the party off the direct line. */
  lures: Point[];
  seed: number;
  /**
   * The rock: every tile nobody dug out.
   *
   * Handed in rather than derived, because the shape of the room is now the
   * player's save and not a function of its size. An empty set is a room
   * with no rock in it, which is what every test that does not care about
   * the corridor wants.
   */
  terrain?: Set<number>;
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
   * The rock the corridor was cut out of.
   *
   * Nothing can be built there and nobody walks through, and unlike a wall
   * the player put up it cannot be broken - which is why a raid is refused
   * unless a way through already exists.
   */
  private terrain: Set<number>;
  private entrance: Point;
  private minions: SimMinion[];
  private traps: SimTrap[];
  private adventurers: SimAdventurer[];
  private status: RaidStatus = "running";
  private elapsed = 0;
  private waves: PartyMember[][];
  private waveIndex = 0;
  /** When the current wave walked in, so the timeout is per wave, not per raid. */
  private waveStartedAt = 0;
  /** Seconds left in the build window. Only meaningful while intermission. */
  private intermissionLeft = 0;
  /** Kept so anything built during a build window is scaled the same way. */
  private minionDamageScale = 1;
  private minionHpScale = 1;
  private weaponTiers: Record<string, number> = {};
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
  /**
   * The body the warden is riding, and what it is being told to do.
   *
   * A warden that can only watch its own raid is a spectator with a budget.
   * Taking a minion puts it in the corridor with everything at stake: the
   * body it rides is one it paid for, it fights with that body's numbers, and
   * when the body dies it dies for real and the warden is back on the board.
   *
   * Nothing else in the simulation knows about this. A ridden minion is a
   * minion - adventurers fight it when it blocks them, traps ignore it, and
   * the raid ends the way it always did.
   */
  private possessedId: string | null = null;
  private control = { x: 0, y: 0, facing: 0, attack: false, skill: false };
  /**
   * Seconds until each body can use its skill again, by minion id.
   *
   * Kept per body and ticked for all of them, ridden or not, so hopping out
   * of a body and back in is not a way to reset it.
   */
  private bodySkillCooldowns = new Map<string, number>();
  /** Which tile the ridden body was on last step, so hunts re-route on a step. */
  private possessedTile = { x: -1, y: -1 };

  constructor(options: RaidSimOptions) {
    this.seed = options.seed;
    this.trapCooldownScale = options.trapCooldownScale ?? 1;
    this.jailFree = options.jailFree ?? 0;

    this.trapDamageScale = options.trapDamageScale ?? 1;
    this.minionDamageScale = options.minionDamageScale ?? 1;
    this.minionHpScale = options.minionHpScale ?? 1;
    this.weaponTiers = options.weaponTiers ?? {};

    this.minions = options.minions.map((m) => {
      const stats = this.statsFor(m);
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
    this.terrain = options.terrain ?? new Set<number>();
    this.entrance = options.entrance;
    this.waves = options.waves?.length ? options.waves : [options.party];
    this.adventurers = [];
    this.sendWave(0);
  }

  /** A placed minion's numbers: its own, its weapon's, and research on top. */
  private statsFor(minion: PlacedMinion) {
    const base = minionStatsFor(minion, this.weaponTiers[minion.id] ?? 0);
    const stats = {
      ...base,
      hp: Math.round(base.hp * this.minionHpScale),
      damage: Math.round(base.damage * this.minionDamageScale),
    };
    this.minionStats.set(minion.id, stats);
    return stats;
  }

  /**
   * Takes on whatever the player built during the window.
   *
   * Only between waves. Mid-fight it would let someone drop a wall in front
   * of a knight that is already swinging at one, and the whole point of the
   * window is that building has its own moment.
   *
   * What was already standing keeps the damage it has taken - that is the
   * reason the simulation survives between waves at all.
   */
  syncPlacements(
    minions: PlacedMinion[],
    traps: PlacedTrap[],
    weaponTiers: Record<string, number> = {},
  ): void {
    if (this.status !== "intermission") return;
    this.weaponTiers = weaponTiers;

    const wantedMinions = new Set(minions.map((m) => m.id));
    // Only the living are dropped: a minion that died this raid stays on the
    // board as a casualty, and it is not the player who removed it.
    this.minions = this.minions.filter((m) => !m.alive || wantedMinions.has(m.id));
    for (const placed of minions) {
      if (this.minions.some((m) => m.id === placed.id)) continue;
      const stats = this.statsFor(placed);
      this.minions.push({
        id: placed.id, type: placed.type, x: placed.x, y: placed.y,
        hp: stats.hp, maxHp: stats.hp, cooldown: 0, alive: true, shield: 0,
        action: "idle" as SimAction, facing: 0,
      });
    }

    const wantedTraps = new Set(traps.map((t) => t.id));
    this.traps = this.traps.filter((t) => wantedTraps.has(t.id));
    for (const placed of traps) {
      if (this.traps.some((t) => t.id === placed.id)) continue;
      this.traps.push({
        id: placed.id, type: placed.type, x: placed.x, y: placed.y,
        cooldown: 0, triggers: 0,
      });
    }

    this.routeAll();
  }

  /**
   * Walks one wave in through the door.
   *
   * Appended rather than replacing what is there. The previous waves are all
   * resolved by this point, and leaving them in the array is what makes the
   * kill and capture counts add up across the whole raid instead of resetting
   * with every wave - the settlement at the end is for the raid, not the last
   * group of it.
   */
  private sendWave(index: number): void {
    const start = this.entrance;
    this.waveIndex = index;
    this.waveStartedAt = this.elapsed;

    for (let i = 0; i < this.waves[index].length; i++) {
      const member = this.waves[index][i];
      const stats = partyMemberStats(member.cls, member.level, member.champion);
      this.adventurers.push({
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
        // Measured from now, not from the start of the raid: a later wave
        // walks in one after another from the moment it is sent.
        spawnAt: this.elapsed + i * SPAWN_INTERVAL_SECONDS,
        spawned: false,
        alive: true,
        burn: null,
        downed: 0,
        fate: "none",
        action: "walk" as SimAction,
        facing: 0,
        path: [],
        hunting: null,
        downedByWarden: false,
      });
    }

    this.status = "running";
    this.routeAll();
  }

  /**
   * Ends the build window early. Ignored unless one is open, so a double tap
   * on the button cannot skip a wave.
   */
  startNextWave(): void {
    if (this.status !== "intermission") return;
    this.sendWave(this.waveIndex + 1);
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
   * What a route may not pass through: the rock, and nothing else.
   *
   * Minions used to be in here and that was the wrong rule: it made a minion
   * a piece of maze, so putting one in the road bent the road around it and
   * the thing the player had just paid for was never fought at all. The route
   * ignores the garrison entirely now, and a minion standing on it is walked
   * into - see blockingTarget.
   *
   * Which leaves the rock as the only thing that shapes a route, and that is
   * the division the game is built on: what you dug decides where they walk,
   * minions decide what happens to them on the way.
   */
  private blocked(): Set<number> {
    return new Set(this.terrain);
  }

  /**
   * Gives one adventurer a route from where it stands.
   *
   * A walkable route always wins, however long it is — that is the whole rule
   * of this game, and it is what makes folding the corridor worth doing.
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
        return;
      }
      adventurer.hunting = null;
    }

    /*
     * There is always a route, or the raid should never have opened.
     *
     * The rock is the only thing that shapes a route and it cannot change
     * mid-raid, so a missing route here is not a game state - it is a raid
     * that started from a dungeon whose door does not reach its core, which
     * both the client and the server refuse. Thrown rather than patched
     * around: resolveStatus() reads "already at the end of the path" as a
     * breach, so quietly handing back a one-step path would give the
     * attacker a free and unreported win.
     *
     * There used to be a fallback here that dropped the player's walls and
     * walked the line underneath them, which is what breaking a barricade
     * meant. Nothing is breakable now - a wall is rock the player chose not
     * to dig - so that fallback computed the identical route and could only
     * ever fail the same way.
     */
    const open = buildRaidPath(this.arena, from, this.core, this.lures, this.blocked());
    if (!open) {
      throw new Error(
        `RaidSim: no route from (${from.x}, ${from.y}) to the core (${this.core.x}, ${this.core.y}) — the dungeon was not connected when the raid opened.`,
      );
    }

    adventurer.path = open;
    adventurer.pathIndex = 0;
  }

  private routeAll(): void {
    for (const adventurer of this.adventurers) {
      if (adventurer.alive) this.route(adventurer);
    }
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
   * Walls and scenery are the only things in the way - the garrison is not in
   * the blocked set - so this is exactly the question "is there a wall around
   * this archer", and it is what decides whether one is a tower or a target.
   *
   * It used to have to exclude the minion's own tile from the blocked set,
   * because a minion blocked its own square and the goal was unreachable by
   * definition. It no longer blocks anything, so there is nothing to exclude.
   */
  private pathToMinion(adventurer: SimAdventurer, minion: SimMinion): Point[] | null {
    const blocked = this.blocked();
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
  private blockingTarget(adventurer: SimAdventurer): SimMinion | null {
    const next = adventurer.path[adventurer.pathIndex + 1];
    if (!next) return null;

    /*
     * A minion on the next tile is always a fight.
     *
     * Routes are built without the garrison in them, so a minion never has a
     * way round to be compared against - if it is on the route, the route
     * goes through it, and going through it means killing it.
     *
     * Walls used to be the other half of this. They were breakable once, and
     * a wall on the route meant there had been no route at all. Nothing is
     * breakable now: what shapes a route is the rock the player did not dig,
     * and a raid cannot open unless there is a way through it.
     */
    return this.minionAt(next.x, next.y);
  }

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
    // A warden inside it goes back to the board, which is the whole risk of
    // having climbed in.
    if (minion.id === this.possessedId) this.release();
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
      wardenDownIds: this.adventurers
        .filter((a) => a.downedByWarden && (a.fate === "killed" || a.fate === "captured"))
        .map((a) => a.id),
      jailFree: this.jailFree,
      trapDamage: Math.round(this.trapDamage),
      wave: this.waveIndex + 1,
      waves: this.waves.length,
      intermissionLeft: this.intermissionLeft,
      possessedId: this.possessedId,
      possessedSkill: this.possessedId ? (this.bodySkillCooldowns.get(this.possessedId) ?? 0) : 0,
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
        (target.x === this.core.x && target.y === this.core.y);

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

  /**
   * Puts the warden inside one of its own minions.
   *
   * Refused for a body that is not there to be ridden - dead, unknown, or
   * belonging to a raid that is over. Returns whether it took.
   */
  possess(id: string): boolean {
    if (this.status !== "running") return false;
    const minion = this.minions.find((m) => m.id === id && m.alive);
    if (!minion) return false;

    this.possessedId = id;
    this.control = { x: 0, y: 0, facing: minion.facing, attack: false, skill: false };
    this.possessedTile = { x: Math.round(minion.x), y: Math.round(minion.y) };
    return true;
  }

  /** Hands the body back to its own devices. Safe to call when riding nothing. */
  release(): void {
    if (!this.possessedId) return;
    this.possessedId = null;
    this.control = { x: 0, y: 0, facing: 0, attack: false, skill: false };
  }

  /** The body being ridden, or null. */
  get possessed(): SimMinion | null {
    if (!this.possessedId) return null;
    return this.minions.find((m) => m.id === this.possessedId && m.alive) ?? null;
  }

  /**
   * What the ridden body is being asked to do.
   *
   * Movement is a direction in tile space rather than a speed, so the caller
   * does not have to know the frame rate or the step size; the attack is a
   * request that survives until the next step spends it, so a tap that lands
   * between two steps is never dropped.
   */
  setControl(input: { x: number; y: number; facing: number }): void {
    this.control.x = input.x;
    this.control.y = input.y;
    this.control.facing = input.facing;
  }

  /** Asks for one swing. Spent by the next step, whether or not it connects. */
  requestAttack(): void {
    this.control.attack = true;
  }

  /** Asks for the ridden body's own skill. Spent by the next step. */
  requestSkill(): void {
    this.control.skill = true;
  }

  /** Advances exactly one SIM_DT. Call repeatedly from a fixed-step accumulator. */
  step(): void {
    /*
     * The build window is stepped too, so the countdown on it is the same
     * fixed-step clock everything else runs on - and so a raid left alone
     * carries itself into the next wave rather than waiting forever for a
     * button that may never be pressed.
     */
    if (this.status === "intermission") {
      this.intermissionLeft = Math.max(0, this.intermissionLeft - SIM_DT);
      if (this.intermissionLeft === 0) this.sendWave(this.waveIndex + 1);
      return;
    }

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
      this.damageAdventurer(victim, stats.damage * this.trapDamageScale, "trap", undefined, {
        x: trap.x,
        y: trap.y,
      });
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
    at?: { x: number; y: number },
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
      from: from ? { x: from.x, y: from.y } : at,
    });

    if (target.hp <= 0) {
      // Beaten, not dead yet. The next few seconds decide whether this becomes
      // loot or a prisoner.
      target.hp = 0;
      target.burn = null;
      target.downed = DOWNED_SECONDS;
      target.downedByWarden = from !== undefined && this.possessedId !== null && from.id === this.possessedId;
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

  /** A blow landing on a minion, softened while the warden is inside it. */
  private blowOn(minion: SimMinion, damage: number): number {
    return minion.id === this.possessedId ? damage * WARDEN_GUARD : damage;
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
            quarry.hp -= this.blowOn(quarry, stats.damage);
            if (quarry.hp <= 0) this.killMinion(quarry);
          }
        }
        continue;
      }

      const guard = this.blockingTarget(adventurer);
      if (guard) {
        adventurer.action = "attack";
        adventurer.facing = Math.atan2(guard.x - adventurer.x, guard.y - adventurer.y);

        if (adventurer.cooldown === 0) {
          adventurer.cooldown = stats.attackInterval;
          // A blessed minion still occupies the corridor, it just takes no
          // damage — the skill buys time rather than removing the fight.
          if (guard.shield <= 0) {
            guard.hp -= this.blowOn(guard, stats.damage);
            if (guard.hp <= 0) this.killMinion(guard);
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
    for (const [id, left] of this.bodySkillCooldowns) {
      this.bodySkillCooldowns.set(id, Math.max(0, left - SIM_DT));
    }

    for (const minion of this.minions) {
      if (!minion.alive) continue;
      if (minion.id === this.possessedId) {
        this.stepPossessed(minion);
        continue;
      }

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

  /**
   * Drives the ridden body from the player's input instead of from the rules.
   *
   * It is the same minion in every other respect - the same hit points, the
   * same place in the road - with the warden's weight behind it: blows worth
   * WARDEN_MIGHT and wounds cut by WARDEN_GUARD. What it gains besides is the
   * two things a placed minion has never had: it can walk, and it swings when
   * told rather than whenever something wanders into reach.
   *
   * Walking is the real power. The garrison is not in the pathfinding blocked
   * set, so a route is never recomputed around a body - but an adventurer
   * fights whatever stands on its next tile, so stepping into the road starts
   * a fight and stepping out of it ends one. A warden who knows that can hold
   * a corridor mouth with one skeleton.
   */
  private stepPossessed(minion: SimMinion): void {
    const stats = this.minionStats.get(minion.id)!;
    minion.cooldown = Math.max(0, minion.cooldown - SIM_DT);
    minion.shield = Math.max(0, minion.shield - SIM_DT);
    minion.facing = this.control.facing;

    const push = Math.hypot(this.control.x, this.control.y);
    if (push > 0.01) {
      const step = (POSSESSED_SPEED * SIM_DT) / push;
      const nx = minion.x + this.control.x * step;
      const ny = minion.y + this.control.y * step;
      // One axis at a time, so a body pressed into a corner slides along the
      // wall instead of stopping dead against it.
      if (this.standable(nx, minion.y)) minion.x = nx;
      if (this.standable(minion.x, ny)) minion.y = ny;
      minion.action = "walk";
    } else {
      minion.action = "idle";
    }

    /*
     * Anyone hunting this body was sent to where it used to be.
     *
     * Only on a change of tile: re-routing every step would be a breadth-first
     * search twenty times a second for a body that has moved a few
     * centimetres, and a hunt is decided in whole tiles anyway.
     */
    const tx = Math.round(minion.x);
    const ty = Math.round(minion.y);
    if (tx !== this.possessedTile.x || ty !== this.possessedTile.y) {
      this.possessedTile = { x: tx, y: ty };
      this.routeAll();
    }

    if (this.control.skill) {
      this.control.skill = false;
      if ((this.bodySkillCooldowns.get(minion.id) ?? 0) <= 0) this.useBodySkill(minion, stats);
    }

    if (!this.control.attack) return;
    this.control.attack = false;
    if (minion.cooldown > 0) return;

    // A swing costs its cooldown whether or not anything was in reach: the
    // player who mistimes it has to wait for the next one.
    minion.cooldown = stats.attackInterval;
    minion.action = "attack";
    const target = this.nearestAdventurer(minion.x, minion.y, stats.range);
    if (target) this.damageAdventurer(target, stats.damage * WARDEN_MIGHT, "melee", minion);
  }

  /**
   * The one thing each body does that no other body does.
   *
   * Every ridden body swinging the same swing made the choice of which one
   * to climb into a choice of hit points and nothing else. A warrior shoves:
   * whatever it hits is put back a tile along its own road, onto ground it
   * has already walked and so can always stand on, and loses a moment
   * finding its feet - the tool for holding a corridor mouth. A mage
   * blasts: one blow worth several, on a longer wait, and through the
   * ordinary damage path so the line to the target is drawn like any other.
   *
   * Nothing in reach means nothing happens, and the wait is not spent.
   */
  private useBodySkill(minion: SimMinion, stats: ReturnType<typeof minionStatsFor>): void {
    /*
     * A guard braces: the blessing's shield on this body alone. The one skill
     * that wants nothing in reach - bracing is for the blow that is coming.
     */
    if (minion.type === "guard") {
      this.bodySkillCooldowns.set(minion.id, BRACE_COOLDOWN);
      minion.shield = Math.max(minion.shield, BRACE_SECONDS);
      return;
    }

    /*
     * A grunt lunges: closes on the nearest adventurer it can see and hits
     * it twice as hard. Walked along the line a quarter tile at a time and
     * stopped at the last standable point, so a lunge at something round a
     * corner ends at the corner rather than inside the rock.
     */
    if (minion.type === "grunt") {
      const prey = this.nearestAdventurer(minion.x, minion.y, LUNGE_REACH);
      if (!prey) return;
      this.bodySkillCooldowns.set(minion.id, LUNGE_COOLDOWN);
      const gap = distance(minion.x, minion.y, prey.x, prey.y);
      const travel = Math.min(LUNGE_STEP, Math.max(0, gap - 0.6));
      for (let moved = 0.25; moved <= travel + 1e-6; moved += 0.25) {
        const nx = minion.x + ((prey.x - minion.x) / gap) * 0.25;
        const ny = minion.y + ((prey.y - minion.y) / gap) * 0.25;
        if (!this.standable(nx, ny)) break;
        minion.x = nx;
        minion.y = ny;
      }
      minion.action = "attack";
      this.damageAdventurer(prey, stats.damage * WARDEN_MIGHT * LUNGE_MULTIPLIER, "melee", minion);
      return;
    }

    const target = this.nearestAdventurer(minion.x, minion.y, stats.range);
    if (!target) return;
    minion.action = "attack";

    if (minion.type === "mage") {
      this.bodySkillCooldowns.set(minion.id, BLAST_COOLDOWN);
      this.damageAdventurer(target, stats.damage * WARDEN_MIGHT * BLAST_MULTIPLIER, "melee", minion);
      return;
    }

    this.bodySkillCooldowns.set(minion.id, SHOVE_COOLDOWN);
    if (target.pathIndex > 0) {
      target.pathIndex -= 1;
      const back = target.path[target.pathIndex];
      target.x = back.x;
      target.y = back.y;
    }
    target.cooldown = Math.max(target.cooldown, SHOVE_STAGGER);
  }

  /** Whether a body may stand here: inside the arena, and on dug floor. */
  private standable(x: number, y: number): boolean {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (!inArena(this.arena, tx, ty)) return false;
    return !this.terrain.has(blockedKey(tx, ty, this.arena.w));
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
    // One breach ends the raid whichever wave it happens on. There is nothing
    // left to defend.
    if (reachedCore) {
      this.status = "breached";
      return;
    }

    // Per wave, not per raid: three waves with a build window between them
    // take longer than one, and a raid-long clock would call the whole thing
    // off mid-fight.
    const stalled = this.elapsed - this.waveStartedAt >= RAID_TIMEOUT_SECONDS;
    if (!this.adventurers.every((a) => !a.alive) && !stalled) return;

    if (this.waveIndex + 1 < this.waves.length) {
      this.status = "intermission";
      this.intermissionLeft = INTERMISSION_SECONDS;
      return;
    }

    this.status = "repelled";
  }
}
