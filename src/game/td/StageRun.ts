import { blockedKey } from "../arena";
import { findPath, type Point } from "../sim/pathfinding";
import { TRAP_STATS } from "../sim/traps";
import { TRAP_COST, type AdventurerClass, type TrapType } from "../types";
import { CHAMPION_LIVES, ENEMIES, enemyBounty, enemyHp } from "./enemies";
import type { ResearchEffects } from "./research";
import {
  SPAWN_INTERVAL,
  stageCore,
  stageEntrance,
  waveBonus,
  WAVES_PER_STAGE,
  type Stage,
  type Wave,
} from "./stages";
import {
  MAX_TOWER_LEVEL,
  SLOW_SECONDS,
  sellValue,
  towerStats,
  upgradeCost,
  TOWERS,
  type TowerType,
} from "./towers";

/**
 * One run, played.
 *
 * The room is open from the start: every tile but the stage's bedrock can be
 * walked, and the towers are the walls. Each one is placed on the floor and
 * blocks its tile, so the way from the door to the core is whatever the
 * player's towers leave - and the longer and more winding they make it, the
 * longer the party spends in front of them. The one rule is that a way must
 * always be left.
 *
 * Owns the towers and traps, the gold, the lives and the adventurers on
 * their way in, and is the only thing that changes any of it. Building goes
 * through here as well as fighting, because the two happen at once: a tower
 * dropped mid-wave has to know who is standing where, and a party already
 * inside has to find its way round it.
 *
 * Deterministic and free of the DOM, so it runs the same under a test as in
 * the browser. See useStageRun for the loop that drives it.
 */

/** Fixed simulation step, in seconds. */
export const SIM_DT = 0.05;

/** How near an adventurer has to be to a tile for it to count as standing on it. */
const OCCUPIED_RADIUS = 0.75;

/** How long a tower is drawn mid-swing after it fires. */
const ATTACK_POSE_SECONDS = 0.35;

export interface RunTower {
  id: string;
  type: TowerType;
  x: number;
  y: number;
  level: number;
  cooldown: number;
  facing: number;
  /** Run time until which it is drawn attacking. */
  attackUntil: number;
}

export interface RunTrap {
  id: string;
  type: TrapType;
  x: number;
  y: number;
  cooldown: number;
}

export interface RunEnemy {
  id: string;
  cls: AdventurerClass;
  level: number;
  champion: boolean;
  wave: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  route: Point[];
  /** Index into `route` of the tile it is walking towards. */
  next: number;
  slowUntil: number;
  slowFactor: number;
  burn: { dps: number; until: number } | null;
  facing: number;
}

export type RunStatus = "build" | "wave" | "won" | "lost";

export type RunEvent =
  | {
      kind: "damage";
      targetId: string;
      amount: number;
      x: number;
      y: number;
      source: "tower" | "trap" | "burn";
      from?: { x: number; y: number };
    }
  | { kind: "trap"; trapId: string; x: number; y: number }
  | { kind: "killed"; targetId: string; x: number; y: number; bounty: number }
  | { kind: "leaked"; targetId: string; x: number; y: number; lives: number }
  | { kind: "waveCleared"; wave: number; bonus: number }
  /** The last wave of a stage is through: `stage` is the one just finished. */
  | { kind: "stageCleared"; stage: number }
  | { kind: "won" }
  | { kind: "lost" };

/** Why a build action was refused, for the one line that says so. */
export type Refusal =
  | "gold"
  | "rock"
  | "bedrock"
  | "not_dug"
  | "taken"
  | "occupied"
  | "blocks"
  | "fixed"
  | "unreachable"
  | "locked"
  | "max_level"
  | "over";

export type BuildResult = { ok: true } | { ok: false; reason: Refusal };

interface Spawn {
  at: number;
  cls: AdventurerClass;
  level: number;
  champion: boolean;
  wave: number;
  toughness: number;
}

export class StageRun {
  readonly stage: Stage;
  readonly entrance: Point;
  readonly core: Point;
  readonly lives0: number;

  gold: number;
  lives: number;
  /** Seconds of play, counted only while a wave is out. */
  time = 0;
  /** Waves started so far. */
  wavesStarted = 0;
  status: RunStatus = "build";

  towers: RunTower[] = [];
  traps: RunTrap[] = [];
  enemies: RunEnemy[] = [];

  private readonly effects: ResearchEffects;
  private readonly bedrock: Set<number>;
  private readonly dug = new Set<number>();
  private queue: Spawn[] = [];
  /** Adventurers of each wave not yet stopped or through. */
  private remaining: number[] = [];
  private seq = 0;
  private events: RunEvent[] = [];

  constructor(stage: Stage, effects: ResearchEffects) {
    this.stage = stage;
    this.effects = effects;
    this.entrance = stageEntrance(stage);
    this.core = stageCore(stage);
    this.bedrock = new Set(stage.bedrock.map((t) => this.key(t.x, t.y)));
    for (let k = 0; k < stage.arena.w * stage.arena.h; k++) {
      if (!this.bedrock.has(k)) this.dug.add(k);
    }
    this.gold = stage.startGold + effects.startGold;
    this.lives0 = stage.lives + effects.lives;
    this.lives = this.lives0;
  }

  // ------------------------------------------------------------------ reading

  private key(x: number, y: number): number {
    return blockedKey(x, y, this.stage.arena.w);
  }

  isDug(x: number, y: number): boolean {
    return this.dug.has(this.key(x, y));
  }

  isBedrock(x: number, y: number): boolean {
    return this.bedrock.has(this.key(x, y));
  }

  /** Every open tile: all but the bedrock. */
  dugTiles(): Point[] {
    const w = this.stage.arena.w;
    return [...this.dug].map((k) => ({ x: k % w, y: Math.floor(k / w) }));
  }

  towerAt(x: number, y: number): RunTower | undefined {
    return this.towers.find((t) => t.x === x && t.y === y);
  }

  trapAt(x: number, y: number): RunTrap | undefined {
    return this.traps.find((t) => t.x === x && t.y === y);
  }

  /** What an adventurer cannot walk through: rock, and every tower. */
  private blocked(extra?: number): Set<number> {
    const { w, h } = this.stage.arena;
    const set = new Set<number>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!this.dug.has(k)) set.add(k);
      }
    }
    for (const t of this.towers) set.add(this.key(t.x, t.y));
    if (extra !== undefined) set.add(extra);
    return set;
  }

  /** The way in, door to core, or null while there is none. */
  route(): Point[] | null {
    return findPath(this.stage.arena, this.entrance, this.core, this.blocked());
  }

  /** How many waves the stage has: without end for the endless run. */
  get wavesTotal(): number {
    return this.stage.waveAt ? Infinity : (this.stage.waves?.length ?? 0);
  }

  /** Wave `index`, 0-based, or null past the end of a fixed list. */
  waveAt(index: number): Wave | null {
    if (this.stage.waveAt) return this.stage.waveAt(index);
    return this.stage.waves?.[index] ?? null;
  }

  /** Waves every adventurer of which has been stopped or got through. */
  get wavesCleared(): number {
    let n = 0;
    while (n < this.wavesStarted && (this.remaining[n] ?? 0) === 0) n++;
    return n;
  }

  /** Whether "next wave" may be pressed: everyone of the last one has come in. */
  canStartWave(): boolean {
    if (this.status === "won" || this.status === "lost") return false;
    if (this.wavesStarted >= this.wavesTotal) return false;
    if (this.queue.length > 0) return false;
    return this.route() !== null;
  }

  private occupied(x: number, y: number): boolean {
    return this.enemies.some((e) => Math.hypot(e.x - x, e.y - y) < OCCUPIED_RADIUS);
  }

  private isFixed(x: number, y: number): boolean {
    return (x === this.entrance.x && y === this.entrance.y) || (x === this.core.x && y === this.core.y);
  }

  /** Whether a tower on this tile still leaves a way in, and a way on for everyone inside. */
  private keepsWay(x: number, y: number): boolean {
    const blocked = this.blocked(this.key(x, y));
    const arena = this.stage.arena;
    if (!findPath(arena, this.entrance, this.core, blocked)) return false;
    for (const enemy of this.enemies) {
      const from = this.standingTile(enemy);
      if (from.x === x && from.y === y) return false;
      if (!findPath(arena, from, this.core, blocked)) return false;
    }
    return true;
  }

  private standingTile(enemy: RunEnemy): Point {
    const target = enemy.route[enemy.next];
    if (target && !this.blocked().has(this.key(target.x, target.y))) return target;
    return { x: Math.round(enemy.x), y: Math.round(enemy.y) };
  }

  // ----------------------------------------------------------------- building

  /**
   * What placing here would be refused for, or null if it would be allowed.
   *
   * The same checks placeTower and placeTrap make, without spending anything,
   * so the board can colour the ghost under the cursor before the tap.
   */
  refusalFor(kind: "tower" | "trap", type: TowerType | TrapType, x: number, y: number): Refusal | null {
    if (this.status === "won" || this.status === "lost") return "over";
    const unlocked = kind === "tower"
      ? this.effects.towers.includes(type as TowerType)
      : this.effects.traps.includes(type as TrapType);
    if (!unlocked) return "locked";
    if (!this.isDug(x, y)) return "not_dug";
    if (this.isFixed(x, y)) return "fixed";
    if (this.towerAt(x, y) || this.trapAt(x, y)) return "taken";
    const cost = kind === "tower" ? TOWERS[type as TowerType].cost[0] : TRAP_COST[type as TrapType];
    if (this.gold < cost) return "gold";
    if (kind === "tower") {
      if (this.occupied(x, y)) return "occupied";
      if (!this.keepsWay(x, y)) return "blocks";
    }
    return null;
  }

  /** The way in if a tower stood here too, for drawing the maze it would make. */
  routeWithTower(x: number, y: number): Point[] | null {
    return findPath(this.stage.arena, this.entrance, this.core, this.blocked(this.key(x, y)));
  }

  placeTower(type: TowerType, x: number, y: number): BuildResult {
    if (this.status === "won" || this.status === "lost") return { ok: false, reason: "over" };
    if (!this.effects.towers.includes(type)) return { ok: false, reason: "locked" };
    if (!this.isDug(x, y)) return { ok: false, reason: "not_dug" };
    if (this.isFixed(x, y)) return { ok: false, reason: "fixed" };
    if (this.towerAt(x, y) || this.trapAt(x, y)) return { ok: false, reason: "taken" };
    const cost = TOWERS[type].cost[0];
    if (this.gold < cost) return { ok: false, reason: "gold" };
    if (this.occupied(x, y)) return { ok: false, reason: "occupied" };
    if (!this.keepsWay(x, y)) return { ok: false, reason: "blocks" };
    this.gold -= cost;
    this.seq += 1;
    this.towers.push({
      id: `t${this.seq}`, type, x, y, level: 1, cooldown: 0, facing: 0, attackUntil: 0,
    });
    this.reroute();
    return { ok: true };
  }

  upgradeTower(id: string): BuildResult {
    const tower = this.towers.find((t) => t.id === id);
    if (!tower) return { ok: false, reason: "not_dug" };
    if (this.status === "won" || this.status === "lost") return { ok: false, reason: "over" };
    const cost = upgradeCost(tower.type, tower.level);
    if (cost === null || tower.level >= MAX_TOWER_LEVEL) return { ok: false, reason: "max_level" };
    if (this.gold < cost) return { ok: false, reason: "gold" };
    this.gold -= cost;
    tower.level += 1;
    return { ok: true };
  }

  sellTower(id: string): BuildResult {
    const index = this.towers.findIndex((t) => t.id === id);
    if (index < 0) return { ok: false, reason: "not_dug" };
    if (this.status === "won" || this.status === "lost") return { ok: false, reason: "over" };
    const tower = this.towers[index];
    this.gold += sellValue(tower.type, tower.level);
    this.towers.splice(index, 1);
    this.reroute();
    return { ok: true };
  }

  placeTrap(type: TrapType, x: number, y: number): BuildResult {
    if (this.status === "won" || this.status === "lost") return { ok: false, reason: "over" };
    if (!this.effects.traps.includes(type)) return { ok: false, reason: "locked" };
    if (!this.isDug(x, y)) return { ok: false, reason: "not_dug" };
    if (this.isFixed(x, y)) return { ok: false, reason: "fixed" };
    if (this.towerAt(x, y) || this.trapAt(x, y)) return { ok: false, reason: "taken" };
    const cost = TRAP_COST[type];
    if (this.gold < cost) return { ok: false, reason: "gold" };
    this.gold -= cost;
    this.seq += 1;
    this.traps.push({ id: `p${this.seq}`, type, x, y, cooldown: 0 });
    return { ok: true };
  }

  sellTrap(id: string): BuildResult {
    const index = this.traps.findIndex((t) => t.id === id);
    if (index < 0) return { ok: false, reason: "not_dug" };
    if (this.status === "won" || this.status === "lost") return { ok: false, reason: "over" };
    this.gold += Math.floor(TRAP_COST[this.traps[index].type] * 0.7);
    this.traps.splice(index, 1);
    return { ok: true };
  }

  /** Sends everyone inside the shortest way on from where they are now. */
  private reroute(): void {
    if (this.enemies.length === 0) return;
    const blocked = this.blocked();
    for (const enemy of this.enemies) {
      const from = this.standingTile(enemy);
      const path = findPath(this.stage.arena, from, this.core, blocked);
      if (!path) continue;
      enemy.route = path;
      enemy.next = 0;
    }
  }

  // ------------------------------------------------------------------ waves

  startWave(): boolean {
    if (!this.canStartWave()) return false;
    const index = this.wavesStarted;
    const wave = this.waveAt(index);
    if (!wave) return false;
    let at = this.time;
    let count = 0;
    for (const group of wave) {
      for (let i = 0; i < group.count; i++) {
        this.queue.push({
          at, cls: group.cls, level: group.level, champion: !!group.champion, wave: index,
          toughness: group.toughness ?? 1,
        });
        at += SPAWN_INTERVAL;
        count += 1;
      }
    }
    this.remaining[index] = count;
    this.wavesStarted += 1;
    this.status = "wave";
    return true;
  }

  // ------------------------------------------------------------------ fighting

  /** Advances one fixed step. Returns what happened in it. */
  step(dt = SIM_DT): RunEvent[] {
    if (this.status === "build" || this.status === "won" || this.status === "lost") {
      return this.drain();
    }
    this.time += dt;
    this.spawn();
    this.moveEnemies(dt);
    this.burnEnemies(dt);
    this.fireTowers(dt);
    this.fireTraps(dt);
    this.settle();
    return this.drain();
  }

  private drain(): RunEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private spawn(): void {
    const path = this.route();
    while (this.queue.length > 0 && this.queue[0].at <= this.time) {
      const s = this.queue.shift()!;
      if (!path) continue;
      this.seq += 1;
      const hp = Math.round(enemyHp(s.cls, s.level, s.champion) * s.toughness);
      this.enemies.push({
        id: `e${this.seq}`,
        cls: s.cls,
        level: s.level,
        champion: s.champion,
        wave: s.wave,
        x: this.entrance.x,
        y: this.entrance.y,
        hp,
        maxHp: hp,
        route: path,
        next: 1,
        slowUntil: 0,
        slowFactor: 1,
        burn: null,
        facing: 0,
      });
    }
  }

  private moveEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      const slow = enemy.slowUntil > this.time ? enemy.slowFactor : 1;
      let budget = ENEMIES[enemy.cls].speed * slow * dt;
      while (budget > 0 && enemy.next < enemy.route.length) {
        const target = enemy.route[enemy.next];
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-6) enemy.facing = Math.atan2(dx, dy);
        if (dist <= budget) {
          enemy.x = target.x;
          enemy.y = target.y;
          enemy.next += 1;
          budget -= dist;
        } else {
          enemy.x += (dx / dist) * budget;
          enemy.y += (dy / dist) * budget;
          budget = 0;
        }
      }
    }
    // Through to the core.
    for (const enemy of [...this.enemies]) {
      if (enemy.next < enemy.route.length) continue;
      if (enemy.x !== this.core.x || enemy.y !== this.core.y) continue;
      const cost = enemy.champion ? CHAMPION_LIVES : 1;
      this.lives = Math.max(0, this.lives - cost);
      this.events.push({ kind: "leaked", targetId: enemy.id, x: enemy.x, y: enemy.y, lives: cost });
      this.remove(enemy);
    }
  }

  private burnEnemies(dt: number): void {
    for (const enemy of [...this.enemies]) {
      if (!enemy.burn) continue;
      if (enemy.burn.until <= this.time) {
        enemy.burn = null;
        continue;
      }
      this.hurt(enemy, enemy.burn.dps * dt, "burn");
    }
  }

  /** How far an adventurer still has to walk: the tower's reason to pick it. */
  private distanceLeft(enemy: RunEnemy): number {
    const target = enemy.route[enemy.next];
    if (!target) return 0;
    return enemy.route.length - enemy.next + Math.hypot(target.x - enemy.x, target.y - enemy.y);
  }

  private fireTowers(dt: number): void {
    for (const tower of this.towers) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;
      const stats = towerStats(tower.type, tower.level);
      // The one nearest the core that is in reach: the classic "first".
      let target: RunEnemy | null = null;
      let best = Infinity;
      for (const enemy of this.enemies) {
        if (Math.hypot(enemy.x - tower.x, enemy.y - tower.y) > stats.range) continue;
        const left = this.distanceLeft(enemy);
        if (left < best) {
          best = left;
          target = enemy;
        }
      }
      if (!target) continue;
      tower.cooldown = stats.interval;
      tower.facing = Math.atan2(target.x - tower.x, target.y - tower.y);
      tower.attackUntil = this.time + ATTACK_POSE_SECONDS;
      const damage = stats.damage * this.effects.towerDamageScale;
      const from = { x: tower.x, y: tower.y };
      if (stats.splash) {
        const cx = target.x;
        const cy = target.y;
        for (const enemy of [...this.enemies]) {
          if (Math.hypot(enemy.x - cx, enemy.y - cy) > stats.splash) continue;
          this.hurt(enemy, damage, "tower", enemy === target ? from : undefined);
        }
      } else {
        if (stats.slow !== undefined) {
          const active = target.slowUntil > this.time ? target.slowFactor : 1;
          target.slowFactor = Math.min(active, stats.slow);
          target.slowUntil = this.time + SLOW_SECONDS;
        }
        this.hurt(target, damage, "tower", from);
      }
    }
  }

  private fireTraps(dt: number): void {
    for (const trap of this.traps) {
      trap.cooldown = Math.max(0, trap.cooldown - dt);
      if (trap.cooldown > 0) continue;
      const stats = TRAP_STATS[trap.type];
      const scale = this.effects.trapDamageScale;
      if (stats.range > 0) {
        // Shoots: the one nearest the core within reach.
        let target: RunEnemy | null = null;
        let best = Infinity;
        for (const enemy of this.enemies) {
          if (Math.hypot(enemy.x - trap.x, enemy.y - trap.y) > stats.range) continue;
          const left = this.distanceLeft(enemy);
          if (left < best) {
            best = left;
            target = enemy;
          }
        }
        if (!target) continue;
        trap.cooldown = stats.cooldown;
        this.events.push({ kind: "trap", trapId: trap.id, x: trap.x, y: trap.y });
        this.hurt(target, stats.damage * scale * ENEMIES[target.cls].trapResistance, "trap", { x: trap.x, y: trap.y });
        continue;
      }
      // Stepped on.
      const on = this.enemies.filter((e) => Math.hypot(e.x - trap.x, e.y - trap.y) <= stats.triggerRadius);
      if (on.length === 0) continue;
      trap.cooldown = stats.cooldown;
      this.events.push({ kind: "trap", trapId: trap.id, x: trap.x, y: trap.y });
      const hit = stats.aoe > 0
        ? this.enemies.filter((e) => Math.hypot(e.x - trap.x, e.y - trap.y) <= stats.aoe)
        : [on[0]];
      for (const enemy of hit) {
        const resist = ENEMIES[enemy.cls].trapResistance;
        if (stats.burn) enemy.burn = { dps: stats.burn.dps * scale * resist, until: this.time + stats.burn.duration };
        this.hurt(enemy, stats.damage * scale * resist, "trap");
      }
    }
  }

  private hurt(
    enemy: RunEnemy,
    amount: number,
    source: "tower" | "trap" | "burn",
    from?: { x: number; y: number },
  ): void {
    if (!this.enemies.includes(enemy) || amount <= 0) return;
    enemy.hp -= amount;
    this.events.push({ kind: "damage", targetId: enemy.id, amount, x: enemy.x, y: enemy.y, source, from });
    if (enemy.hp > 0) return;
    const bounty = enemyBounty(enemy.cls, enemy.level, enemy.champion);
    this.gold += bounty;
    this.events.push({ kind: "killed", targetId: enemy.id, x: enemy.x, y: enemy.y, bounty });
    this.remove(enemy);
  }

  private remove(enemy: RunEnemy): void {
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);
    this.remaining[enemy.wave] -= 1;
    if (this.remaining[enemy.wave] === 0) {
      const bonus = waveBonus(enemy.wave);
      this.gold += bonus;
      this.events.push({ kind: "waveCleared", wave: enemy.wave, bonus });
      if (enemy.wave % WAVES_PER_STAGE === WAVES_PER_STAGE - 1) {
        this.events.push({ kind: "stageCleared", stage: Math.floor(enemy.wave / WAVES_PER_STAGE) + 1 });
      }
    }
  }

  private settle(): void {
    if (this.lives <= 0) {
      this.status = "lost";
      this.events.push({ kind: "lost" });
      return;
    }
    if (this.queue.length > 0 || this.enemies.length > 0) return;
    if (this.wavesStarted >= this.wavesTotal) {
      this.status = "won";
      this.events.push({ kind: "won" });
      return;
    }
    this.status = "build";
  }
}
