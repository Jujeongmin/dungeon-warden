import * as THREE from "three";
import { TILE, type TileId, type ObstacleType } from "./types";
import { ModelLibrary, MODEL_PATTERNS, fitToTile, type LoadedModel } from "./assets/ModelLibrary";
import { inArena, type Arena } from "./arena";
import type { Point } from "./sim/pathfinding";

const TILE_SIZE = 1;
const WALL_HEIGHT = 0.9;
const FLOOR_HEIGHT = 0.12;

const PITCH = THREE.MathUtils.degToRad(52);
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 70;
const FOV = 45;

/** Camera shake: trauma decays exponentially and is never integrated, so the
 *  offset is a pure function of (trauma, time) — it always returns to exactly
 *  zero rather than drifting. */
const SHAKE_MAX_OFFSET = 0.55; // world units at trauma = 1
const SHAKE_DECAY = 3.2; // trauma lost per second

/** Per-unit hit feedback: a scale punch on every hit, a short knockback nudge
 *  on a killing blow. Both decay to zero the same way the shake does. */
const PUNCH_SCALE = 0.24; // peak scale bump, applied on top of the unit's own base scale
const PUNCH_DECAY = 9; // punch strength lost per second
const KNOCKBACK_DECAY = 6.5; // knockback strength lost per second

/**
 * A unit that dies leaves the sim's live roster the instant its event fires,
 * often the same frame the knockback is applied — with no lingering "downed"
 * state (minions have none, and a captured adventurer can resolve in the
 * same step as its "down" event). Without this, the knockback would never
 * actually be seen. So a dying unit keeps its mesh around for this long,
 * still playing out its knockback decay while shrinking away, before it is
 * actually disposed.
 */
const CORPSE_LINGER = 0.32;

// Pointer travel (px) beyond which a gesture counts as a camera drag, not a tap.
const TAP_SLOP = 6;

const COLORS: Record<TileId, number> = {
  [TILE.FLOOR]: 0x8a7f6d,
  [TILE.ENTRANCE]: 0x4c7d4a,
  [TILE.CORE]: 0xb4712c,
};

export interface RendererCallbacks {
  onTileTap: (x: number, y: number) => void;
  onHoverChange: (tile: { x: number; y: number } | null) => void;
}

/** One drawable unit. The renderer stays ignorant of raid rules. */
export interface UnitView {
  id: string;
  x: number;
  y: number;
  kind: string;
  hp: number;
  maxHp: number;
  action?: "idle" | "walk" | "attack" | "down";
  /** Radians, matching the simulation's atan2(dx, dy) convention. */
  facing?: number;
}

/**
 * Animation clips, matched by name against whatever the model ships.
 * KayKit uses names like "Idle", "Walking_A", "1H_Melee_Attack_Chop", "Death_A".
 */
const CLIP_PATTERNS: Record<string, RegExp[]> = {
  idle: [/^idle_a$/i, /^idle$/i, /idle/i],
  walk: [/^walking_a$/i, /^walk/i, /^running_a$/i, /run/i],
  // The free tier ships no attack clips; Interact is the closest arm motion.
  // Adding a paid animation pack later lets the first patterns take over.
  attack: [/melee_attack/i, /attack/i, /shoot/i, /spellcast/i, /^interact$/i, /^throw$/i],
  down: [/^death_a$/i, /death/i, /defeat/i, /^die/i],
};

/** A flat tile decoration: a trap plate or a room floor. */
export interface MarkerView {
  id: string;
  x: number;
  y: number;
  kind: string;
  shape: "trap" | "room";
}

/**
 * Walls the player put down.
 *
 * Height tracks remaining HP: a barricade being chopped through visibly
 * sinks, which is the only feedback the player gets that hitting it is
 * working. Everything else about the model stays put so it does not read as
 * a different object.
 */
export interface ObstacleView {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

/** Placeholder colors, keyed the same way as MODEL_PATTERNS. */
const UNIT_COLORS: Record<string, number> = {
  m_warrior: 0xd8d2c4,
  m_mage: 0x9d8bd8,
  a_knight: 0xd86a4c,
  a_barbarian: 0xc4553a,
  a_rogue: 0xa8564e,
  a_ranger: 0xb08a4a,
  a_mage: 0xb05ac4,
};

const MARKER_COLORS: Record<string, number> = {
  spike: 0xb8b0a2,
  arrow: 0x8fae7e,
  rockfall: 0x8a7a63,
  flame: 0xd98443,
  treasury: 0xd4a94a,
  vault: 0x7f8fa6,
  barracks: 0xa86f5c,
  altar: 0x8f6fb0,
  workshop: 0x6f9a9a,
};

const UNIT_HEIGHT = 0.7;
const MARKER_HEIGHT = 0.16;

/**
 * What each room type puts on its tiles.
 *
 * A room is 2x2, and drawing its one model on all four tiles read as a
 * warehouse of identical chests. Each tile picks from this list instead, so a
 * treasury is a chest with coin piles around it and a barracks is beds and
 * footlockers. The room's own key stays first: it is the one that has to be
 * recognisable, and it is what a one-tile fallback shows.
 */
const ROOM_PROPS: Record<string, string[]> = {
  treasury: ["treasury", "prop_coin_large", "prop_coin_small", "treasury"],
  vault: ["vault", "prop_box", "prop_barrel", "prop_bottle"],
  barracks: ["barracks", "prop_bed", "prop_box", "prop_banner"],
  altar: ["altar", "prop_candle", "prop_pillar", "prop_candle"],
  workshop: ["workshop", "prop_table", "prop_shelf", "prop_barrel"],
  jail: ["jail", "prop_rubble", "prop_box", "jail"],
};

/** Props scattered on empty room floor, and how often a tile gets one. */
const CLUTTER = ["prop_barrel", "prop_box", "prop_rubble", "prop_bottle", "prop_pillar"];
const CLUTTER_CHANCE = 0.14;

/** How many of the room's wall panels carry a torch. */
const TORCH_CHANCE = 0.22;

/**
 * How many of those torches actually burn.
 *
 * Point lights are the expensive kind and this runs on phones, so the rest
 * stay props. The eye reads pooled warm light on the floor long before it
 * counts sources.
 */
const MAX_TORCH_LIGHTS = 6;

/**
 * A stable pseudo-random number for a tile.
 *
 * Decoration is recomputed on every arena change, so it has to come out the
 * same each time — otherwise the barrels dance around the room whenever the
 * player places or removes an obstacle. FNV-1a over the coordinates, folded
 * to [0, 1).
 */
function tileNoise(x: number, y: number, salt: number): number {
  let hash = 0x811c9dc5;
  for (const value of [x + 1, y + 1, salt + 1]) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Owns the three.js scene. The room's floor is one InstancedMesh, so a wide
 * arena still costs a handful of draw calls once the KayKit models replace
 * these placeholder boxes — they share one 1024px atlas.
 */
export class DungeonRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private floorMesh: THREE.InstancedMesh | null = null;
  private wallMesh: THREE.InstancedMesh | null = null;
  private highlight: THREE.Mesh;

  private unitGroup = new THREE.Group();
  private unitMeshes = new Map<string, THREE.Object3D>();
  private unitGeometry = new THREE.CapsuleGeometry(0.22, UNIT_HEIGHT * 0.5, 4, 8);

  private markerGroup = new THREE.Group();
  private markerMeshes = new Map<string, THREE.Object3D>();
  private trapGeometry = new THREE.BoxGeometry(0.72, MARKER_HEIGHT, 0.72);
  private roomGeometry = new THREE.BoxGeometry(0.94, MARKER_HEIGHT * 0.6, 0.94);

  private obstacleGroup = new THREE.Group();
  private obstacleMeshes = new Map<string, THREE.Object3D>();
  private obstacleGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  private lastObstacles: ObstacleView[] = [];

  private arena: Arena | null = null;
  private entrance: Point | null = null;
  private core: Point | null = null;
  private callbacks: RendererCallbacks;

  private target = new THREE.Vector3(0, 0, 0);
  private distance = 20;
  private yawStep = 0; // 0..3, snapped to 90-degree turns

  /** Once the player zooms, a resize must not yank the camera back. */
  private userAdjustedZoom = false;

  /** KayKit models when the packs are present; placeholders otherwise. */
  private models = new ModelLibrary();
  private loaded = new Map<string, LoadedModel | null>();
  private lastUnits: UnitView[] = [];
  private lastMarkers: MarkerView[] = [];
  private sharedClips: THREE.AnimationClip[] = [];

  /** Per-unit animation state, only populated when a model has clips. */
  private mixers = new Map<string, { mixer: THREE.AnimationMixer; current: string | null; actions: Map<string, THREE.AnimationAction> }>();
  /** THREE.Clock is deprecated, and a timestamp is all the loop needs. */
  private lastTick = performance.now();

  /** Transient combat effects: hit flashes and trap rings. */
  private flashes = new Map<string, number>();
  private rings: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private ringGeometry = new THREE.RingGeometry(0.2, 0.34, 20);

  /** Per-unit scale punch (on every hit) and knockback nudge (on a kill). */
  private impacts = new Map<string, { punch: number; kx: number; ky: number; kLife: number }>();
  /** Units mid-death, kept around briefly to finish their knockback — see CORPSE_LINGER. */
  private corpses = new Map<string, { object: THREE.Object3D; restX: number; restZ: number; life: number }>();

  /** Camera shake: an impulse (trauma) that decays to zero, applied as a
   *  render-time offset on top of the player's own target/distance/yaw. */
  private shakeTrauma = 0;
  private shakeTime = 0;
  private shakeOffset = new THREE.Vector3();

  private landmarks: THREE.Object3D[] = [];
  private decor: THREE.Object3D[] = [];
  /** Lights belonging to the torch props; cleared with them. */
  private torchLights: THREE.PointLight[] = [];
  private pathMarkers: THREE.Object3D[] = [];
  private pathGeometry = new THREE.PlaneGeometry(0.86, 0.86);

  private hovered: { x: number; y: number } | null = null;
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private resizeFrame = 0;
  private disposed = false;

  // pointer state
  private activePointers = new Map<number, THREE.Vector2>();
  private dragStart: THREE.Vector2 | null = null;
  private dragMoved = false;
  private pinchStartDistance = 0;
  private pinchStartCameraDistance = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x14120f);
    this.scene.fog = new THREE.Fog(0x14120f, 30, 60);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    /*
     * A dungeon lit by its own torches.
     *
     * The scene used to be an even wash from a warm key with a cold blue rim,
     * and on a dark stone floor the only thing that read was the blue — the
     * room came out slate and lifeless, which is not what a room full of
     * burning torches should look like. The rim is now a dim, barely-tinted
     * bounce, the ambient carries the warmth, and the actual light comes from
     * the torch props on the walls (see buildDecor).
     */
    const ambient = new THREE.AmbientLight(0xffdcae, 0.42);
    const key = new THREE.DirectionalLight(0xfff0cc, 0.85);
    key.position.set(6, 14, 4);
    const rim = new THREE.DirectionalLight(0x9fb4d8, 0.18);
    rim.position.set(-8, 6, -6);
    this.scene.add(ambient, key, rim);

    const highlightGeo = new THREE.BoxGeometry(
      TILE_SIZE * 0.98,
      WALL_HEIGHT * 1.04,
      TILE_SIZE * 0.98,
    );
    this.highlight = new THREE.Mesh(
      highlightGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.scene.add(this.unitGroup);
    this.scene.add(this.markerGroup);
    this.scene.add(this.obstacleGroup);

    this.attachPointerEvents();
    window.addEventListener("keydown", this.onKeyDown);

    // Models arrive asynchronously; anything already on screen is swapped in
    // place once they land, so the game is playable while they load.
    void this.preloadModels();

    // Resizing touches layout and the GL drawing buffer. Doing that inside the
    // observer callback is what makes Chrome report "ResizeObserver loop
    // completed with undelivered notifications", so the work is coalesced into
    // the next frame instead — several observations collapse into one resize.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrame !== 0) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        if (!this.disposed) this.resize();
      });
    });
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();

    this.loop();
  }

  setArena(arena: Arena, entrance: Point, core: Point): void {
    this.arena = arena;
    this.entrance = entrance;
    this.core = core;
    this.target.set((arena.w - 1) / 2, 0, (arena.h - 1) / 2);
    this.userAdjustedZoom = false;
    this.fitToArena();
    this.rebuildInstances();
  }

  /**
   * Pulls the camera back until the whole room fits. Needed because a phone
   * in portrait is far narrower than the desktop pane, and a fixed distance
   * leaves the arena running off both edges there.
   */
  private fitToArena(): void {
    const arena = this.arena;
    if (!arena) return;

    const aspect = this.camera.aspect || 1;
    // The room is viewed at 45 degrees of yaw, so its screen footprint is the
    // diagonal rather than the side length.
    const span = Math.max(arena.w, arena.h) * Math.SQRT2 * 0.62;
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2;

    const forHeight = span / Math.tan(halfFov);
    const forWidth = span / (Math.tan(halfFov) * aspect);

    this.distance = THREE.MathUtils.clamp(
      Math.max(forHeight, forWidth) * 0.72,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
  }

  /**
   * Syncs the unit meshes with the given roster. Meshes are reused by id and
   * only created or disposed when the roster actually changes, so a 20 Hz
   * simulation does not churn geometry every frame.
   */
  setUnits(units: UnitView[]): void {
    this.lastUnits = units;
    const seen = new Set<string>();

    for (const unit of units) {
      seen.add(unit.id);
      let object = this.unitMeshes.get(unit.id);
      const usesModel = this.loaded.get(unit.kind) != null;

      if (!object) {
        const model = this.spawnModel(unit.kind, 0.8);
        object =
          model ??
          new THREE.Mesh(
            this.unitGeometry,
            new THREE.MeshLambertMaterial({ color: UNIT_COLORS[unit.kind] ?? 0xffffff }),
          );
        this.unitMeshes.set(unit.id, object);
        this.unitGroup.add(object);

        if (model) {
          // Characters ship without clips in KayKit 2.0, so they borrow the
          // shared rig animations.
          const own = this.loaded.get(unit.kind)?.animations ?? [];
          this.setupAnimation(unit.id, object, own.length > 0 ? own : this.sharedClips);
        }

        // fitToTile (or the placeholder capsule) already set the resting
        // scale; the punch below multiplies on top of it rather than
        // overwriting it, so it has to be remembered up front.
        object.userData.baseScale = object.scale.x || 1;
      }

      const impact = this.impacts.get(unit.id);
      const knock = impact?.kLife ?? 0;
      const punch = impact?.punch ?? 0;

      // A model already sits on the floor thanks to fitToTile; the capsule is
      // centred on its own middle and needs lifting. The knockback nudge is a
      // horizontal-only render offset — the sim's x/y stay authoritative.
      object.position.set(
        unit.x + (impact?.kx ?? 0) * knock,
        usesModel ? object.position.y : UNIT_HEIGHT,
        unit.y + (impact?.ky ?? 0) * knock,
      );
      const baseScale = (object.userData.baseScale as number | undefined) ?? 1;
      object.scale.setScalar(baseScale * (1 + punch * PUNCH_SCALE));
      if (unit.facing !== undefined) object.rotation.y = unit.facing;
      if (unit.action) this.playClip(unit.id, unit.action);

      // Wounded units darken rather than carrying a health bar, which would
      // need screen-space UI for something the player only glances at.
      const health = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
      const flash = this.flashes.get(unit.id) ?? 0;
      DungeonRenderer.tint(
        object,
        // A hit whites the unit out for a moment, which is the only way to
        // read damage at a glance once several units are fighting.
        flash > 0 ? 0xffd9b0 : usesModel ? 0xffffff : (UNIT_COLORS[unit.kind] ?? 0xffffff),
        flash > 0 ? 1 + flash : 0.35 + 0.65 * health,
      );
    }

    for (const [id, object] of this.unitMeshes) {
      if (seen.has(id)) continue;
      this.unitMeshes.delete(id);
      this.mixers.delete(id);
      this.flashes.delete(id);

      const impact = this.impacts.get(id);
      if (impact && (impact.kLife > 0 || impact.punch > 0)) {
        // Mid-impact — hand it to the corpse list instead of disposing it
        // outright, so the knockback/punch already in flight gets to finish.
        const knock = impact.kLife;
        this.corpses.set(id, {
          object,
          restX: object.position.x - impact.kx * knock,
          restZ: object.position.z - impact.ky * knock,
          life: CORPSE_LINGER,
        });
        continue;
      }

      this.disposeObject(this.unitGroup, object);
      this.impacts.delete(id);
    }
  }

  /** Advances lingering corpses: continues their knockback decay while
   *  shrinking them away, then disposes them once CORPSE_LINGER elapses. */
  private updateCorpses(delta: number): void {
    for (const [id, corpse] of this.corpses) {
      corpse.life -= delta;

      const impact = this.impacts.get(id);
      const knock = impact?.kLife ?? 0;
      corpse.object.position.set(
        corpse.restX + (impact?.kx ?? 0) * knock,
        corpse.object.position.y,
        corpse.restZ + (impact?.ky ?? 0) * knock,
      );

      const fade = Math.max(0, corpse.life / CORPSE_LINGER);
      const baseScale = (corpse.object.userData.baseScale as number | undefined) ?? 1;
      corpse.object.scale.setScalar(baseScale * fade);

      if (corpse.life <= 0) {
        this.disposeObject(this.unitGroup, corpse.object);
        this.corpses.delete(id);
        this.impacts.delete(id);
      }
    }
  }

  /**
   * Loads every model the renderer knows how to use, then redraws what is
   * already on screen so placeholders are replaced in place.
   */
  private async preloadModels(): Promise<void> {
    await this.models.init();
    if (this.disposed || !this.models.available) return;

    await Promise.all([
      ...Object.keys(MODEL_PATTERNS).map(async (key) => {
        this.loaded.set(key, await this.models.load(key));
      }),
      this.models.loadSharedClips().then((clips) => {
        this.sharedClips = clips;
      }),
    ]);
    if (this.disposed) return;

    // Force a rebuild: the maps are keyed by id, so clearing them makes the
    // next sync recreate every object with its model.
    this.clearUnits();
    this.clearMarkers();
    this.clearObstacles();
    this.setUnits(this.lastUnits);
    this.setMarkers(this.lastMarkers);
    this.setObstacles(this.lastObstacles);

    // The floor/walls/landmarks/decor were built at mount, before models
    // existed, so every tileProto/spawnModel lookup came back null and they
    // never rebuild on their own. Rebuild them now that models are loaded.
    this.rebuildInstances();
  }

  /**
   * A fresh instance of a model, scaled to the tile size.
   *
   * Materials are cloned so one wounded minion does not darken every other
   * unit sharing the same source material.
   */
  private spawnModel(key: string, targetTiles: number): THREE.Object3D | null {
    const model = this.loaded.get(key);
    if (!model) return null;

    const object = this.models.instantiate(model);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
    });

    fitToTile(object, targetTiles);
    return object;
  }

  /** Multiplies every material on an object, used for the wounded look. */
  private static tint(object: THREE.Object3D, base: number, factor: number): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const colored = material as THREE.MeshStandardMaterial;
        if (!colored.color) continue;
        colored.color.setHex(base);
        colored.color.multiplyScalar(factor);
      }
    });
  }

  private clearUnits(): void {
    for (const [, object] of this.unitMeshes) this.disposeObject(this.unitGroup, object);
    this.unitMeshes.clear();
  }

  private clearMarkers(): void {
    for (const [, object] of this.markerMeshes) this.disposeObject(this.markerGroup, object);
    this.markerMeshes.clear();
  }

  private disposeObject(parent: THREE.Object3D, object: THREE.Object3D): void {
    parent.remove(object);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Geometry is shared with the source model, so only per-instance
      // materials are released here.
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    });
  }

  /**
   * Crossfades a unit into an animation state.
   * Does nothing when the model has no clips, which is the case for the
   * primitive placeholders.
   */
  private playClip(unitId: string, state: string): void {
    const entry = this.mixers.get(unitId);
    if (!entry || entry.current === state) return;

    const next = entry.actions.get(state);
    if (!next) return;

    const previous = entry.current ? entry.actions.get(entry.current) : null;
    next.reset().fadeIn(0.15).play();
    if (previous && previous !== next) previous.fadeOut(0.15);
    entry.current = state;
  }

  /** Builds the clip map for a freshly spawned model. */
  private setupAnimation(unitId: string, object: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    if (clips.length === 0) return;

    const mixer = new THREE.AnimationMixer(object);
    const actions = new Map<string, THREE.AnimationAction>();

    for (const [state, patterns] of Object.entries(CLIP_PATTERNS)) {
      const clip = patterns.map((p) => clips.find((c) => p.test(c.name))).find(Boolean);
      if (!clip) continue;

      const action = mixer.clipAction(clip);
      // Death should hold on its last frame rather than looping.
      if (state === "down") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      actions.set(state, action);
    }

    if (actions.size === 0) return;
    this.mixers.set(unitId, { mixer, current: null, actions });
  }

  /** Flags a unit to flash and scale-punch on its next frames. */
  flashUnit(unitId: string): void {
    this.flashes.set(unitId, 1);
    const impact = this.impacts.get(unitId);
    if (impact) impact.punch = 1;
    else this.impacts.set(unitId, { punch: 1, kx: 0, ky: 0, kLife: 0 });
  }

  /**
   * Shoves a unit back a step on a killing blow.
   *
   * Events carry no attacker id, so this reads the unit's own current facing
   * instead — the sim always turns a unit to face whatever it is fighting
   * (see RaidSim's `adventurer.facing`/`minion.facing` assignments), so
   * "away from facing" reads as "away from the thing that just finished it".
   * The nudge is a pure render-time offset that decays to zero; it never
   * touches the simulation's authoritative position.
   */
  knockbackUnit(unitId: string, strength = 0.18): void {
    const object = this.unitMeshes.get(unitId);
    const facing = object?.rotation.y ?? 0;
    const impact = this.impacts.get(unitId) ?? { punch: 0, kx: 0, ky: 0, kLife: 0 };
    impact.kx = -Math.sin(facing) * strength;
    impact.ky = -Math.cos(facing) * strength;
    impact.kLife = 1;
    impact.punch = 1; // a kill lands harder than a graze
    this.impacts.set(unitId, impact);
  }

  /**
   * Adds a camera-shake impulse. Scale to the event: a spike trap is a tap
   * (~0.1), an obstacle collapsing is a thump (~0.5). Impulses accumulate up
   * to a cap rather than stacking without bound, so a burst of events reads
   * as one solid hit instead of a jitter spike.
   */
  shake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  /** Expanding ring on a tile, used when a trap fires. */
  spawnRing(x: number, y: number, color = 0xe8a44c): void {
    const mesh = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, FLOOR_HEIGHT + 0.05, y);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 1 });
  }

  /** Screen position of a world tile, for HTML overlays like damage numbers. */
  project(x: number, y: number, height = UNIT_HEIGHT): { x: number; y: number } | null {
    const vector = new THREE.Vector3(x, height, y).project(this.camera);
    if (vector.z > 1) return null;

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((vector.x + 1) / 2) * rect.width,
      y: ((1 - vector.y) / 2) * rect.height,
    };
  }

  /** Flat decorations for traps and room floors, synced the same way as units. */
  setMarkers(markers: MarkerView[]): void {
    this.lastMarkers = markers;
    const seen = new Set<string>();

    for (const marker of markers) {
      seen.add(marker.id);
      let object = this.markerMeshes.get(marker.id);
      // A room tile may show one of its type's props rather than the room
      // model itself; a trap is always its own model.
      const modelKey =
        marker.shape === "room" ? this.roomPropFor(marker) : marker.kind;
      const usesModel = this.loaded.get(modelKey) != null;

      if (!object) {
        object =
          this.spawnModel(modelKey, marker.shape === "trap" ? 0.7 : 0.85) ??
          new THREE.Mesh(
            marker.shape === "trap" ? this.trapGeometry : this.roomGeometry,
            new THREE.MeshLambertMaterial({
              color: MARKER_COLORS[marker.kind] ?? 0xffffff,
            }),
          );
        this.markerMeshes.set(marker.id, object);
        this.markerGroup.add(object);
      }

      // Sits just above the room floor so it reads as part of the tile.
      const lift = usesModel ? object.position.y : MARKER_HEIGHT / 2;
      object.position.set(marker.x, FLOOR_HEIGHT + lift, marker.y);
    }

    for (const [id, object] of this.markerMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.markerGroup, object);
      this.markerMeshes.delete(id);
    }
  }

  /**
   * Walls the player put down.
   *
   * Height tracks remaining HP: a barricade being chopped through visibly
   * sinks, which is the only feedback the player gets that hitting it is
   * working. Everything else about the model stays put so it does not read as
   * a different object.
   */
  setObstacles(obstacles: ObstacleView[]): void {
    this.lastObstacles = obstacles;
    const seen = new Set<string>();

    for (const obstacle of obstacles) {
      seen.add(obstacle.id);
      let object = this.obstacleMeshes.get(obstacle.id);

      if (!object) {
        object =
          this.spawnModel(`obstacle_${obstacle.type}`, 0.9) ??
          new THREE.Mesh(
            this.obstacleGeometry,
            new THREE.MeshLambertMaterial({ color: 0x6b5f4e }),
          );
        this.obstacleMeshes.set(obstacle.id, object);
        this.obstacleGroup.add(object);
      }

      const health = obstacle.maxHp > 0 ? obstacle.hp / obstacle.maxHp : 1;
      object.scale.y = 0.25 + 0.75 * health;
      object.position.set(obstacle.x, FLOOR_HEIGHT, obstacle.y);
    }

    for (const [id, object] of this.obstacleMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.obstacleGroup, object);
      this.obstacleMeshes.delete(id);
    }
  }

  private clearObstacles(): void {
    for (const [, object] of this.obstacleMeshes) this.disposeObject(this.obstacleGroup, object);
    this.obstacleMeshes.clear();
  }

  /**
   * Which prop this tile of a room shows.
   *
   * Falls back to the room's own model when the prop did not load, so a
   * missing file costs one prop rather than an invisible room.
   */
  private roomPropFor(marker: MarkerView): string {
    const props = ROOM_PROPS[marker.kind];
    if (!props) return marker.kind;
    const pick = props[Math.floor(tileNoise(marker.x, marker.y, 7) * props.length)];
    return this.loaded.get(pick) ? pick : marker.kind;
  }

  /**
   * Every tile in the arena rectangle is floor — there is no terrain to dig
   * through any more, so the whole room is built in one pass.
   */
  private rebuildInstances(): void {
    const arena = this.arena;
    if (!arena) return;

    this.disposeInstanced();

    const floorPositions: Array<{ x: number; y: number; tile: TileId }> = [];
    for (let y = 0; y < arena.h; y++) {
      for (let x = 0; x < arena.w; x++) {
        let tile: TileId = TILE.FLOOR;
        if (this.entrance && x === this.entrance.x && y === this.entrance.y) tile = TILE.ENTRANCE;
        else if (this.core && x === this.core.x && y === this.core.y) tile = TILE.CORE;
        floorPositions.push({ x, y, tile });
      }
    }

    this.floorMesh = this.buildInstanced(floorPositions, FLOOR_HEIGHT, "floor");
    if (this.floorMesh) this.scene.add(this.floorMesh);

    this.buildWalls(floorPositions);
    this.buildLandmarks();
    this.buildDecor(floorPositions);
  }

  /**
   * Torches on the walls, clutter on the floor.
   *
   * Without this an open room is bare flagstones: correct, readable, and
   * completely lifeless. Placement is driven by tileNoise so it survives a
   * rebuild unchanged, and it deliberately skips the tiles that mean something
   * — the entrance, the core, and anywhere an obstacle, trap, room or minion
   * can stand — because a barrel that hides a spike plate, or sits inside a
   * wall, is a bug, not decoration.
   */
  private buildDecor(floors: Array<{ x: number; y: number }>): void {
    const arena = this.arena;
    if (!arena) return;

    const occupied = new Set<string>();
    for (const marker of this.lastMarkers) occupied.add(`${marker.x},${marker.y}`);
    for (const unit of this.lastUnits) {
      occupied.add(`${Math.round(unit.x)},${Math.round(unit.y)}`);
    }
    for (const obstacle of this.lastObstacles) {
      occupied.add(`${Math.round(obstacle.x)},${Math.round(obstacle.y)}`);
    }

    const steps: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const floor of floors) {
      // Torches ride the wall panels, so they only exist where one does.
      for (const [dx, dy] of steps) {
        const nx = floor.x + dx;
        const ny = floor.y + dy;
        if (inArena(arena, nx, ny)) continue;
        if (tileNoise(nx * 2 + dx, ny * 2 + dy, 3) > TORCH_CHANCE) continue;

        const torch = this.spawnModel("prop_torch", 0.5);
        if (!torch) break;
        // Just inside the panel, or it floats outside the room.
        torch.position.set(
          floor.x + dx * 0.38,
          FLOOR_HEIGHT + torch.position.y,
          floor.y + dy * 0.38,
        );
        torch.rotation.y = Math.atan2(-dx, -dy);
        this.scene.add(torch);
        this.decor.push(torch);

        /*
         * Light the torch.
         *
         * A wall of torch models that emit nothing is the difference between a
         * dungeon and a diorama of one. Point lights are the expensive kind,
         * so only the first few get a flame and the rest stay props — the eye
         * reads pooled warm light on the floor long before it counts sources.
         */
        if (this.torchLights.length < MAX_TORCH_LIGHTS) {
          const flame = new THREE.PointLight(0xffa542, 4.2, 9, 1.5);
          flame.position.set(torch.position.x, FLOOR_HEIGHT + 1.1, torch.position.z);
          this.scene.add(flame);
          this.torchLights.push(flame);
        }
        break;
      }

      if (occupied.has(`${floor.x},${floor.y}`)) continue;
      const roll = tileNoise(floor.x, floor.y, 11);
      if (roll > CLUTTER_CHANCE) continue;

      const key = CLUTTER[Math.floor(tileNoise(floor.x, floor.y, 13) * CLUTTER.length)];
      const prop = this.spawnModel(key, 0.55);
      if (!prop) continue;
      // Off-centre and turned, so a room of barrels does not look stamped.
      prop.position.set(
        floor.x + (tileNoise(floor.x, floor.y, 17) - 0.5) * 0.4,
        FLOOR_HEIGHT + prop.position.y,
        floor.y + (tileNoise(floor.x, floor.y, 19) - 0.5) * 0.4,
      );
      prop.rotation.y = tileNoise(floor.x, floor.y, 23) * Math.PI * 2;
      this.scene.add(prop);
      this.decor.push(prop);
    }
  }

  /**
   * Puts a model on the entrance and the core.
   *
   * These two tiles decide every route in the game, and until now they were
   * only a slightly different shade of floor. Stairs and a gold chest say what
   * they are without a legend.
   */
  private buildLandmarks(): void {
    if (!this.arena) return;

    for (const object of this.landmarks) this.disposeObject(this.scene, object);
    this.landmarks = [];
    for (const object of this.decor) this.disposeObject(this.scene, object);
    this.decor = [];
    for (const light of this.torchLights) this.scene.remove(light);
    this.torchLights = [];

    const spots: Array<{ key: string; x: number; y: number }> = [];
    if (this.entrance) spots.push({ key: "entrance", x: this.entrance.x, y: this.entrance.y });
    if (this.core) spots.push({ key: "core", x: this.core.x, y: this.core.y });

    for (const spot of spots) {
      const object = this.spawnModel(spot.key, 0.9);
      if (!object) continue;
      object.position.set(spot.x, FLOOR_HEIGHT + object.position.y, spot.y);
      this.scene.add(object);
      this.landmarks.push(object);
    }
  }

  /**
   * Draws the route a raiding party will walk.
   *
   * The entire game is shaping that route, and without seeing it the player is
   * guessing where their minions and traps will actually matter.
   */
  setPathPreview(path: Array<{ x: number; y: number }> | null): void {
    for (const marker of this.pathMarkers) this.disposeObject(this.scene, marker);
    this.pathMarkers = [];

    if (!path || path.length === 0) return;

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const mesh = new THREE.Mesh(
        this.pathGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xe8a44c,
          transparent: true,
          // Fades along the route so the direction of travel is readable.
          opacity: 0.1 + 0.22 * (1 - i / path.length),
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(step.x, FLOOR_HEIGHT + 0.03, step.y);
      this.scene.add(mesh);
      this.pathMarkers.push(mesh);
    }
  }

  /**
   * Stands a wall panel on every edge of the room where the floor meets
   * open air.
   *
   * There is no rock any more, so "solid" now means "outside the arena" —
   * panels land only on the room's outer border, which is exactly the wall
   * of a room. This is how the kit is meant to be used, and it is what makes
   * the room read as built from stone rather than as a stripe painted on a
   * field of cubes.
   */
  private buildWalls(floors: Array<{ x: number; y: number }>): void {
    const arena = this.arena;
    const proto = this.tileProto("wall", WALL_HEIGHT);
    if (!arena || !proto) return;

    const steps: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const transforms: Array<{ x: number; z: number; rot: number }> = [];

    for (const floor of floors) {
      for (const [dx, dy] of steps) {
        const nx = floor.x + dx;
        const ny = floor.y + dy;
        if (inArena(arena, nx, ny)) continue;

        transforms.push({
          x: floor.x + dx * 0.5,
          z: floor.y + dy * 0.5,
          // The panel is widest on X, so turning it by the edge direction makes
          // that width run along the edge.
          rot: Math.atan2(dx, dy),
        });
      }
    }

    if (transforms.length === 0) return;

    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material.clone(), transforms.length);
    mesh.userData.sharedGeometry = true;

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(proto.scale, proto.scale, proto.scale);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();

    transforms.forEach((t, i) => {
      position.set(t.x, proto.lift, t.z);
      quaternion.setFromEuler(euler.set(0, t.rot, 0));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    this.wallMesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * Geometry for one tile, taken from a KayKit model when available.
   *
   * The packs share a single atlas texture, so every tile can still be drawn
   * with one InstancedMesh — the whole floor stays a handful of draw calls
   * whether it is boxes or real models.
   */
  private tileProto(
    key: string,
    fallbackHeight: number,
  ): { geometry: THREE.BufferGeometry; material: THREE.Material; scale: number; lift: number } | null {
    const model = this.loaded.get(key);
    if (!model) return null;

    let found: THREE.Mesh | null = null;
    model.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!found && mesh.isMesh) found = mesh;
    });
    if (!found) return null;

    const mesh = found as THREE.Mesh;
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;

    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const scale = width > 0 ? TILE_SIZE / width : 1;

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return { geometry, material, scale, lift: -box.min.y * scale };
    void fallbackHeight;
  }

  private buildInstanced(
    items: Array<{ x: number; y: number; tile: TileId }>,
    height: number,
    modelKey: string | null,
  ): THREE.InstancedMesh | null {
    if (items.length === 0) return null;

    const proto = modelKey ? this.tileProto(modelKey, height) : null;

    const geo =
      proto?.geometry ?? new THREE.BoxGeometry(TILE_SIZE * 0.96, height, TILE_SIZE * 0.96);
    // No vertexColors on the fallback: the per-instance colors below drive the
    // shader through instanceColor, and enabling vertexColors without a
    // geometry color attribute renders everything black.
    const mat = proto ? proto.material.clone() : new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.userData.sharedGeometry = Boolean(proto);

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(
      proto?.scale ?? 1,
      proto?.scale ?? 1,
      proto?.scale ?? 1,
    );
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    items.forEach((item, i) => {
      position.set(item.x, proto ? proto.lift : height / 2, item.y);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      // Models carry their own texture, so tinting is only for placeholders.
      color.setHex(proto ? 0xffffff : COLORS[item.tile]);
      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private disposeInstanced(): void {
    for (const mesh of [this.floorMesh, this.wallMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      // Model geometry belongs to the cached glTF and is reused by the next
      // rebuild; only geometry this renderer created is disposed.
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.floorMesh = null;
    this.wallMesh = null;
  }

  /** Counts of what is actually in the scene, for debugging from the console. */
  debugStats(): Record<string, unknown> {
    return {
      modelsAvailable: this.models.available,
      modelsLoaded: [...this.loaded.entries()].filter(([, m]) => m).map(([k]) => k),
      sharedClips: this.sharedClips.length,
      floorInstances: this.floorMesh?.count ?? 0,
      wallInstances: this.wallMesh?.count ?? 0,
      landmarks: this.landmarks.length,
      decor: this.decor.length,
      pathMarkers: this.pathMarkers.length,
      units: this.unitMeshes.size,
      markers: this.markerMeshes.size,
      obstacles: this.obstacleMeshes.size,
      mixers: this.mixers.size,
      corpses: this.corpses.size,
      impacts: this.impacts.size,
    };
  }

  /**
   * Camera-shake state, exposed so a headless/dev-tools caller can drive
   * `shake()` and confirm the offset decays to exactly zero and that the
   * unshaken camera position (target/distance/yaw only) is unaffected.
   */
  debugShakeState(): {
    trauma: number;
    offset: { x: number; y: number; z: number };
    cameraPosition: { x: number; y: number; z: number };
    unshakenPosition: { x: number; y: number; z: number };
  } {
    const y = this.yaw;
    const horizontal = Math.cos(PITCH) * this.distance;
    return {
      trauma: this.shakeTrauma,
      offset: { x: this.shakeOffset.x, y: this.shakeOffset.y, z: this.shakeOffset.z },
      cameraPosition: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      unshakenPosition: {
        x: this.target.x + Math.sin(y) * horizontal,
        y: this.target.y + Math.sin(PITCH) * this.distance,
        z: this.target.z + Math.cos(y) * horizontal,
      },
    };
  }

  /** Render resolution, dropped on low-end devices from the settings panel. */
  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }

  rotate(direction: 1 | -1): void {
    this.yawStep = (this.yawStep + direction + 4) % 4;
  }

  zoom(delta: number): void {
    this.userAdjustedZoom = true;
    this.distance = THREE.MathUtils.clamp(this.distance + delta, MIN_DISTANCE, MAX_DISTANCE);
  }

  private get yaw(): number {
    return (this.yawStep * Math.PI) / 2 + Math.PI / 4;
  }

  /**
   * Shake is applied here as a pure offset on top of the player's own
   * target/distance/yaw — never by mutating them — so panning, zooming and
   * rotating during a shake behave exactly as if it were not happening, and
   * the camera lands back exactly where the player left it once trauma hits
   * zero (the offset is `f(trauma, time)`, not integrated, so it can't
   * drift).
   */
  private updateCamera(): void {
    const y = this.yaw;
    const horizontal = Math.cos(PITCH) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(y) * horizontal + this.shakeOffset.x,
      this.target.y + Math.sin(PITCH) * this.distance + this.shakeOffset.y,
      this.target.z + Math.cos(y) * horizontal + this.shakeOffset.z,
    );
    this.camera.lookAt(this.target);
  }

  /** Advances the shake impulse and recomputes this frame's offset. */
  private updateShake(delta: number): void {
    if (this.shakeTrauma <= 0) {
      if (this.shakeOffset.lengthSq() > 0) this.shakeOffset.set(0, 0, 0);
      return;
    }

    this.shakeTime += delta;
    // Squaring the falloff gives a sharp initial jolt that tails off fast,
    // rather than a linear wobble that reads as sluggish.
    const amount = this.shakeTrauma * this.shakeTrauma * SHAKE_MAX_OFFSET;
    this.shakeOffset.set(
      Math.sin(this.shakeTime * 53.7) * amount,
      Math.sin(this.shakeTime * 71.3 + 1.7) * amount * 0.5,
      Math.sin(this.shakeTime * 61.1 + 3.1) * amount,
    );

    this.shakeTrauma = Math.max(0, this.shakeTrauma - SHAKE_DECAY * delta);
    if (this.shakeTrauma === 0) this.shakeOffset.set(0, 0, 0);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.userAdjustedZoom) this.fitToArena();
  }

  private pointerToTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;

    const x = Math.round(hit.x);
    const y = Math.round(hit.z);
    if (!this.arena || !inArena(this.arena, x, y)) return null;
    return { x, y };
  }

  private setHovered(tile: { x: number; y: number } | null): void {
    const same =
      (tile === null && this.hovered === null) ||
      (tile !== null && this.hovered !== null && tile.x === this.hovered.x && tile.y === this.hovered.y);
    if (same) return;

    this.hovered = tile;
    if (tile) {
      this.highlight.position.set(tile.x, WALL_HEIGHT / 2, tile.y);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
    this.callbacks.onHoverChange(tile);
  }

  private attachPointerEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (this.activePointers.size === 1) {
      this.dragStart = new THREE.Vector2(e.clientX, e.clientY);
      this.dragMoved = false;
    } else if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      this.pinchStartDistance = a.distanceTo(b);
      this.pinchStartCameraDistance = this.distance;
      this.dragMoved = true; // a pinch is never a tap
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const previous = this.activePointers.get(e.pointerId);

    if (!previous) {
      // Mouse hover with no button held.
      this.setHovered(this.pointerToTile(e.clientX, e.clientY));
      return;
    }

    const current = new THREE.Vector2(e.clientX, e.clientY);

    if (this.activePointers.size >= 2) {
      this.activePointers.set(e.pointerId, current);
      const [a, b] = [...this.activePointers.values()];
      const spread = a.distanceTo(b);
      if (this.pinchStartDistance > 0) {
        this.userAdjustedZoom = true;
        const ratio = this.pinchStartDistance / Math.max(spread, 1);
        this.distance = THREE.MathUtils.clamp(
          this.pinchStartCameraDistance * ratio,
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      }
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    this.activePointers.set(e.pointerId, current);

    if (this.dragStart && current.distanceTo(this.dragStart) > TAP_SLOP) {
      this.dragMoved = true;
    }
    if (!this.dragMoved) return;

    // Pan along the camera's own axes so dragging feels the same at every yaw.
    const speed = this.distance * 0.0016;
    const y = this.yaw;
    const right = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
    const forward = new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
    this.target.addScaledVector(right, -dx * speed);
    this.target.addScaledVector(forward, -dy * speed);
    this.setHovered(null);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.activePointers.size === 1;
    this.activePointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    if (wasSingle && !this.dragMoved && e.button !== 2) {
      const tile = this.pointerToTile(e.clientX, e.clientY);
      if (tile) this.callbacks.onTileTap(tile.x, tile.y);
    }

    if (this.activePointers.size === 0) {
      this.dragStart = null;
      this.dragMoved = false;
      this.pinchStartDistance = 0;
    }
  };

  private onPointerLeave = (): void => {
    this.setHovered(null);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom(e.deltaY * 0.012);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "q" || e.key === "Q") this.rotate(-1);
    if (e.key === "e" || e.key === "E") this.rotate(1);
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.loop);

    const now = performance.now();
    // Clamped so a backgrounded tab does not resume with a huge jump.
    const delta = Math.min((now - this.lastTick) / 1000, 0.25);
    this.lastTick = now;

    for (const entry of this.mixers.values()) entry.mixer.update(delta);
    this.updateEffects(delta);
    this.updateShake(delta);

    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };

  /** Advances hit flashes, punches, knockbacks, corpses and trap rings. */
  private updateEffects(delta: number): void {
    for (const [id, value] of this.flashes) {
      const next = value - delta * 4;
      if (next <= 0) this.flashes.delete(id);
      else this.flashes.set(id, next);
    }

    for (const [id, impact] of this.impacts) {
      impact.punch = Math.max(0, impact.punch - delta * PUNCH_DECAY);
      impact.kLife = Math.max(0, impact.kLife - delta * KNOCKBACK_DECAY);
      // Only drop entries for units that are still live-tracked; a corpse's
      // impact is cleaned up by updateCorpses once it finishes lingering.
      if (impact.punch === 0 && impact.kLife === 0 && !this.corpses.has(id)) {
        this.impacts.delete(id);
      }
    }
    this.updateCorpses(delta);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= delta * 1.6;

      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }

      const grown = 1 + (1 - ring.life) * 2.2;
      ring.mesh.scale.setScalar(grown);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = ring.life * 0.9;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    cancelAnimationFrame(this.resizeFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);

    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);

    this.disposeInstanced();
    this.clearUnits();
    this.clearMarkers();
    this.clearObstacles();
    for (const [, corpse] of this.corpses) this.disposeObject(this.unitGroup, corpse.object);
    this.corpses.clear();
    this.impacts.clear();

    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
    this.ringGeometry.dispose();

    this.setPathPreview(null);
    this.pathGeometry.dispose();
    for (const object of this.landmarks) this.disposeObject(this.scene, object);
    this.landmarks = [];
    for (const object of this.decor) this.disposeObject(this.scene, object);
    this.decor = [];
    for (const light of this.torchLights) this.scene.remove(light);
    this.torchLights = [];

    this.unitGeometry.dispose();
    this.trapGeometry.dispose();
    this.roomGeometry.dispose();
    this.obstacleGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
