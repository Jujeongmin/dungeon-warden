import * as THREE from "three";
import { TILE, type TileId, type ObstacleType } from "./types";
import { ModelLibrary, MODEL_PATTERNS, fitToTile, type LoadedModel } from "./assets/ModelLibrary";
import { bakeModelIcons } from "./assets/modelIcons";
import { inArena, type Arena } from "./arena";
import { decorFor, tileNoise } from "./decor";
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
  /**
   * A secondary click on a tile - right mouse button only, so it exists on a
   * desktop and simply never fires on a phone, where the toolbar's remove
   * tool is the way to do this.
   *
   * Carries the pointer position as well as the tile, because whatever this
   * opens has to open where the player clicked rather than somewhere the
   * board knows nothing about.
   */
  onTileAlt?: (x: number, y: number, clientX: number, clientY: number) => void;
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
  /**
   * Multiplier on the unit's resting size. Only the party champion uses it,
   * and it is how the champion is announced: no banner, no label, just a
   * figure that is visibly bigger than the four behind it.
   */
  scale?: number;
  /**
   * Carries a health bar over its head.
   *
   * Only the party. A wounded minion darkening says "this one is in trouble"
   * about something the player already owns, but an adventurer's health is
   * the question the whole raid is about - whether the garrison is getting
   * there - and a shade of brown is not a number.
   */
  showHealth?: boolean;
}

/** One tile of the map left behind by a raid. */
export interface AftermathCell {
  x: number;
  y: number;
  /** Share of the raid's worst tile, 0..1. */
  heat: number;
}

/** Somewhere a body hit the floor. */
export interface AftermathMark {
  x: number;
  y: number;
  /** `fell`: an adventurer. `lost`: one of the player's own. */
  kind: "fell" | "lost";
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

/**
 * One piece of floor clutter and everything that can happen to it.
 *
 * `present` is how much of it is there — it drops to zero when a placement
 * claims the tile and climbs back when the tile is freed. `tilt` and the slide
 * are the shove: set once when a raider walks through, and left where they
 * land, so the wreckage of the last wave is still on the floor afterwards.
 */
interface Clutter {
  object: THREE.Object3D;
  x: number;
  y: number;
  /** Where it stands when nothing has happened to it. */
  restX: number;
  restZ: number;
  restScale: number;
  present: number;
  wanted: number;
}

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
  vault: ["vault", "prop_box", "prop_barrel", "prop_box"],
  barracks: ["barracks", "prop_bed", "prop_box", "prop_banner"],
  altar: ["altar", "prop_candle", "prop_pillar", "prop_candle"],
  workshop: ["workshop", "prop_table", "prop_shelf", "prop_barrel"],
  jail: ["jail", "prop_box", "prop_barrel", "jail"],
};

/** Props scattered on empty room floor, and how often a tile gets one. */

/**
 * How the clutter behaves once the room is in use.
 *
 * Scenery that never moves is scenery the player stops seeing. Two things
 * happen to a barrel: the tile it stands on gets claimed, and it is cleared
 * away to make room; or a raider walks through it, and it goes over.
 */
const CLUTTER_CLEAR_RATE = 5.5; // presence gained or lost per second

/** Torch flame wobble, as a fraction of the light's steady intensity. */
const FLICKER_DEPTH = 0.16;

/**
 * How wide one tile is in the KayKit dungeon pack's own units.
 *
 * Measured, not assumed: every piece in the pack that is meant to fill a tile
 * runs from -2 to +2 on each axis it occupies — `wall`, `barrier`,
 * `wall_crossing` and `barrier_corner` all do, and their origins sit at the
 * tile centre rather than at a corner.
 *
 * This matters for anything that has to line up with its neighbours. Scaling
 * each piece to a target width on its own, which is what `fitToTile` does,
 * gives a corner (2.4 units across its bounding box) a different scale from
 * the straight piece beside it (4 units), and the two no longer meet. One
 * fixed divisor keeps a run of obstacles continuous.
 */
const PACK_TILE = 4;

/** Neighbour bits, in the order the piece tables below are written. */
const DIR_N = 1;
const DIR_E = 2;
const DIR_S = 4;
const DIR_W = 8;

const QUARTER = Math.PI / 2;

/**
 * The pieces each obstacle type is built from.
 *
 * The barricade set has no junction pieces — KayKit ships no barrier T or
 * crossing — so it uses the columned barrier there instead, which reads as a
 * post where two fence lines meet and happens to lie along the through axis
 * the chooser picks anyway.
 */
const OBSTACLE_PIECES: Record<
  ObstacleType,
  { straight: string; end: string; corner: string; tee: string; cross: string }
> = {
  barricade: {
    straight: "obstacle_barricade",
    end: "obstacle_barricade_end",
    corner: "obstacle_barricade_corner",
    tee: "obstacle_barricade_post",
    cross: "obstacle_barricade_post",
  },
  wall: {
    straight: "obstacle_wall",
    end: "obstacle_wall_end",
    corner: "obstacle_wall_corner",
    tee: "obstacle_wall_tee",
    cross: "obstacle_wall_cross",
  },
};

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

/** Stains on the two tiles that define the run: in, and what they came for. */
const ENTRANCE_TINT = 0xff8a6a;
/** The moving marker over the entrance, brighter than the floor stain. */
const ENTRANCE_MARK = 0xff6a4a;
const CORE_TINT = 0xffc766;

/** The placement preview: legal here, and not. */
/** The reach circle under a minion being placed. */
const RANGE_RING = 0x9fd8ff;

const GHOST_OK = 0x8fe6a0;
const GHOST_NO = 0xff7a6a;

/**
 * A stable pseudo-random number for a tile.
 *
 * Decoration is recomputed on every arena change, so it has to come out the
 * same each time — otherwise the barrels dance around the room whenever the
 * player places or removes an obstacle. FNV-1a over the coordinates, folded
 * to [0, 1).
 */
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
  /** The floor clutter, with the state that lets it get out of the way. */
  private clutter: Clutter[] = [];
  /** Lights belonging to the torch props; cleared with them. */
  private torchLights: THREE.PointLight[] = [];
  /** The arrow and ring that mark where the party walks in. */
  private entranceMark: { arrow: THREE.Mesh; ring: THREE.Mesh } | null = null;
  /** The subset of those that are flames, and so flicker. */
  private flames: Array<{ light: THREE.PointLight; base: number; phase: number }> = [];
  /** Seconds since the renderer started, for anything that wobbles. */
  private elapsed = 0;

  /** Pixels of canvas hidden behind the HUD, so the board can frame above it. */
  private bottomInset = 0;

  /** The see-through preview of what the next tap places. */
  private ghost: THREE.Object3D | null = null;
  private ghostKey: string | null = null;
  private ghostLegal = true;
  private ghostLift = 0;
  private rangeRing: THREE.Mesh | null = null;
  private rangeRadius = 0;
  private pathMarkers: THREE.Object3D[] = [];
  private aftermathGroup = new THREE.Group();
  private aftermathRing = new THREE.RingGeometry(0.22, 0.4, 20);
  private pathGeometry = new THREE.PlaneGeometry(0.86, 0.86);
  /**
   * The arrows that run along the route, each with the place in the queue it
   * holds - that index is what turns a row of arrows into something moving.
   */
  private pathArrows: Array<{ mesh: THREE.Mesh; step: number }> = [];
  private ghostPathMarkers: THREE.Object3D[] = [];
  /** Health bars, by unit id, so they can be turned to the camera each frame. */
  private healthBars = new Map<string, THREE.Object3D>();
  private barGeometry = new THREE.PlaneGeometry(1, 1);
  private pathLength = 0;
  private arrowGeometry = DungeonRenderer.makeArrowGeometry();

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
    this.scene.add(this.aftermathGroup);

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

  /**
   * Photographs the models behind a set of keys, for use as toolbar icons.
   *
   * Lives here because this owns the loaded model library; the baking itself
   * is in assets/modelIcons.ts. Safe to call before the models have arrived —
   * it waits, and returns whatever it could load.
   */
  async bakeToolIcons(keys: string[]): Promise<Record<string, string>> {
    await this.models.init();
    if (this.disposed) return {};
    return bakeModelIcons(this.models, keys);
  }

  setArena(arena: Arena, entrance: Point, core: Point): void {
    // A reset hands back a different floor, and last raid's map means
    // nothing on it.
    this.clearAftermath();
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
  /**
   * How much of the canvas the HUD is sitting on.
   *
   * The canvas fills the screen and the HUD floats over its lower half, so a
   * board centred in the canvas is centred behind the panel — on a phone that
   * put the core, the thing the player is defending, out of sight. The camera
   * frames into the band that is actually visible instead.
   */
  /**
   * How much of the canvas the HUD is covering.
   *
   * Always the bottom: the game is one 9:16 screen, so the panel is always a
   * sheet across the foot of it. This briefly also handled a column down the
   * left, for windows too short for a sheet — a shape that cannot happen any
   * more, so the second edge went with it.
   */
  setBottomInset(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.bottomInset) return;
    this.bottomInset = next;
    this.applyViewOffset();
    this.fitToArena();
  }

  private applyViewOffset(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    // Never hide so much that there is no room left to play in.
    const bottom = Math.min(this.bottomInset, Math.max(0, height - 80));

    if (bottom <= 0) {
      this.camera.clearViewOffset();
      return;
    }

    /*
     * Frame as though the canvas were taller by the hidden strip, then show
     * the part of it the player can see. A point at the virtual centre lands
     * at `full / 2 - offset`, and the board wants to sit at
     * (height - bottom) / 2 — so the offset is the strip itself.
     */
    this.camera.setViewOffset(width, height + bottom, 0, bottom, width, height);
  }

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

    // The view offset spreads the vertical field over the canvas *plus* the
    // strip hidden by the HUD, so only part of it is on screen. Back off by
    // that ratio or the board is framed to a height the player cannot see.
    const height = this.canvas.clientHeight || 1;
    const visibleShare = (height + this.bottomInset) / height;

    this.distance = THREE.MathUtils.clamp(
      Math.max(forHeight, forWidth) * 0.66 * visibleShare,
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

    /*
     * A wave arriving stands the room back up.
     *
     * Adventurers are the only units that appear and disappear as a group, so
     * their arrival is the raid starting without the renderer needing to be
     * told. The clutter is left where the last wave knocked it until then: the
     * player should be able to look at the floor after a fight and see that
     * one happened.
     */
    this.syncClutter();

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
      const baseScale = ((object.userData.baseScale as number | undefined) ?? 1) * (unit.scale ?? 1);
      object.scale.setScalar(baseScale * (1 + punch * PUNCH_SCALE));
      if (unit.facing !== undefined) object.rotation.y = unit.facing;
      if (unit.action) this.playClip(unit.id, unit.action);

      // Wounded units darken as well as carrying a bar: the darkening reads
      // across the whole room at a glance, the bar answers "how much left".
      const health = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
      if (unit.showHealth) this.syncHealthBar(unit.id, object, health);
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
      // The bar is a child of the model, so it goes with it either way - this
      // is just the bookkeeping that stops updateHealthBars walking corpses.
      this.healthBars.delete(id);

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

  /**
   * A two-plane bar over one unit's head.
   *
   * A child of the model rather than a screen-space element, so it inherits
   * the knockback, the hit punch and the death shrink for free and can never
   * be left floating where a unit used to be. It is turned to face the camera
   * in the frame loop, because the camera rotates.
   */
  private syncHealthBar(id: string, host: THREE.Object3D, health: number): void {
    let bar = this.healthBars.get(id);

    if (!bar) {
      bar = new THREE.Group();
      const back = new THREE.Mesh(
        this.barGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x140f0b, transparent: true, opacity: 0.75,
          depthWrite: false, depthTest: false,
        }),
      );
      back.scale.set(0.68, 0.12, 1);
      const fill = new THREE.Mesh(
        this.barGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xd86a4c, transparent: true,
          depthWrite: false, depthTest: false,
        }),
      );
      fill.name = "fill";
      // Drawn over the room rather than into it: a bar hidden behind the wall
      // its owner is standing next to is a bar that is not there.
      back.renderOrder = 10;
      fill.renderOrder = 11;
      bar.add(back, fill);
      host.add(bar);
      this.healthBars.set(id, bar);
    }

    /*
     * Placed in the host's own space, which is scaled to the tile - so the
     * offset has to be divided back out, or a champion's bar floats higher
     * than everyone else's by exactly its own extra size.
     */
    const scale = host.scale.x || 1;
    bar.position.set(0, 1.45 / scale, 0);
    bar.scale.setScalar(1 / scale);

    const fill = bar.getObjectByName("fill") as THREE.Mesh | undefined;
    if (!fill) return;
    const width = 0.64 * Math.max(0, Math.min(1, health));
    fill.scale.set(Math.max(width, 0.0001), 0.08, 1);
    // Anchored at the left edge, so it empties from the right the way every
    // health bar has since the first one.
    fill.position.set(-(0.64 - width) / 2, 0, 0.001);
  }

  /** Turns every bar to face the camera. Cheap: a handful of quaternion copies. */
  private updateHealthBars(): void {
    for (const bar of this.healthBars.values()) {
      bar.quaternion.copy(this.camera.quaternion);
    }
  }

  private clearUnits(): void {
    for (const [, object] of this.unitMeshes) this.disposeObject(this.unitGroup, object);
    this.unitMeshes.clear();
    this.healthBars.clear();
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

    this.syncClutter();
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

    // Which tiles are built on at all — a barricade and a stone wall are one
    // barrier as far as the player is concerned, so they join up.
    const built = new Set<number>();
    for (const obstacle of obstacles) {
      built.add(Math.round(obstacle.y) * 1000 + Math.round(obstacle.x));
    }
    const has = (x: number, y: number) => built.has(Math.round(y) * 1000 + Math.round(x));

    for (const obstacle of obstacles) {
      seen.add(obstacle.id);

      const mask =
        (has(obstacle.x, obstacle.y - 1) ? DIR_N : 0) |
        (has(obstacle.x + 1, obstacle.y) ? DIR_E : 0) |
        (has(obstacle.x, obstacle.y + 1) ? DIR_S : 0) |
        (has(obstacle.x - 1, obstacle.y) ? DIR_W : 0);
      const piece = this.obstaclePiece(obstacle.type, mask);

      let object = this.obstacleMeshes.get(obstacle.id);
      // Building next door changes what this one is, so the mesh is replaced
      // when the chosen piece changes rather than only when the id is new.
      if (object && object.userData.piece !== piece.key) {
        this.disposeObject(this.obstacleGroup, object);
        this.obstacleMeshes.delete(obstacle.id);
        object = undefined;
      }

      if (!object) {
        object =
          this.spawnPiece(piece.key) ??
          new THREE.Mesh(
            this.obstacleGeometry,
            new THREE.MeshLambertMaterial({ color: 0x6b5f4e }),
          );
        object.userData.piece = piece.key;
        // The placeholder box is a unit cube; a pack piece carries the tile
        // scale from spawnPiece. Either way the squash below multiplies the
        // resting scale rather than replacing it, so it has to be remembered.
        object.userData.baseScaleY = object.scale.y;
        this.obstacleMeshes.set(obstacle.id, object);
        this.obstacleGroup.add(object);
      }

      const health = obstacle.maxHp > 0 ? obstacle.hp / obstacle.maxHp : 1;
      const baseY = (object.userData.baseScaleY as number | undefined) ?? 1;
      object.scale.y = baseY * (0.25 + 0.75 * health);
      object.rotation.y = piece.spin;
      object.position.set(obstacle.x, FLOOR_HEIGHT, obstacle.y);
    }

    for (const [id, object] of this.obstacleMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.obstacleGroup, object);
      this.obstacleMeshes.delete(id);
    }

    this.syncClutter();
  }

  /**
   * Which piece an obstacle is, and which way it faces.
   *
   * Every obstacle used to be the same model at the same angle, so a line of
   * six barricades was six separate fences standing parallel instead of one
   * fence. The piece is chosen from which of the four neighbouring tiles are
   * also built on — an obstacle with one neighbour is an end, with two facing
   * neighbours a straight, with two adjacent ones a corner, and so on.
   *
   * Type is deliberately not part of the neighbour test: a barricade running
   * into a stone wall should turn to meet it, because to the player that is
   * one barrier.
   *
   * The angles come from how the pack draws its pieces. A straight runs along
   * X; an end's stub points +X; a corner's arms are -X and +Z; a T's arms are
   * -X, +X and +Z. Rotating by y maps +X toward -Z, so a quarter turn moves
   * the +X arm from east to north.
   */
  private obstaclePiece(type: ObstacleType, mask: number): { key: string; spin: number } {
    const pieces = OBSTACLE_PIECES[type];
    const n = (mask & DIR_N) !== 0;
    const e = (mask & DIR_E) !== 0;
    const s = (mask & DIR_S) !== 0;
    const w = (mask & DIR_W) !== 0;
    const count = Number(n) + Number(e) + Number(s) + Number(w);

    // Alone: nothing to line up with, so it keeps the pack's own orientation.
    if (count === 0) return { key: pieces.straight, spin: 0 };

    if (count === 1) {
      const spin = n ? QUARTER : e ? 0 : s ? -QUARTER : Math.PI;
      return { key: pieces.end, spin };
    }

    if (count === 2) {
      if (e && w) return { key: pieces.straight, spin: 0 };
      if (n && s) return { key: pieces.straight, spin: QUARTER };
      const spin = w && s ? 0 : s && e ? QUARTER : e && n ? Math.PI : -QUARTER;
      return { key: pieces.corner, spin };
    }

    if (count === 3) {
      // Named by the arm it is missing, which is the one the T has no leg for.
      const spin = !n ? 0 : !w ? QUARTER : !s ? Math.PI : -QUARTER;
      return { key: pieces.tee, spin };
    }

    return { key: pieces.cross, spin: 0 };
  }

  /**
   * A piece scaled to the tile grid rather than to itself.
   *
   * See PACK_TILE: pieces that have to meet each other cannot each be fitted
   * to their own bounding box, or a corner ends up a different size from the
   * straight next to it.
   */
  /**
   * One piece of a built obstacle, sized to fill its tile.
   *
   * The pack's own wall sections are cut to the pack tile, so dividing by
   * PACK_TILE lands them exactly edge to edge and a run of them reads as one
   * wall. A crate is not one of those - it is a prop, and at the same scale
   * it sits as a small box in the middle of a big empty tile with a visible
   * gap to its neighbour, which is the one thing an obstacle must never look
   * like. So anything that does not already fill its tile is grown until it
   * does.
   *
   * Measured rather than listed: a second prop pressed into service as an
   * obstacle later gets the same treatment without anyone remembering to add
   * it to a table.
   */
  private spawnPiece(key: string): THREE.Object3D | null {
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

    object.scale.setScalar(TILE_SIZE / PACK_TILE);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const widest = Math.max(size.x, size.z);

    // A hair over the tile, so two neighbours overlap rather than meet on a
    // seam that the camera can find a line of floor through.
    const want = TILE_SIZE * 1.02;
    if (widest > 0.01 && widest < want) {
      object.scale.multiplyScalar(want / widest);
      object.updateMatrixWorld(true);
      // Grown about its own origin, which for a prop is its foot - so it can
      // come out sunk into the floor or hovering over it. Put it back down.
      const grown = new THREE.Box3().setFromObject(object);
      object.position.y -= grown.min.y;
    }

    return object;
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
   * rebuild unchanged.
   *
   * A prop is made for every tile the noise picks, including tiles that are
   * currently occupied — `syncClutter` clears those away and brings them back
   * as the board changes. Skipping them here instead, which is what this used
   * to do, deleted the prop permanently: the tile only had to be busy at the
   * one moment a rebuild happened for its barrel never to return.
   */
  private buildDecor(floors: Array<{ x: number; y: number }>): void {
    // Counted here rather than off torchLights.length: that array also holds
    // the entrance and core glows, which must not use up the torch budget.
    let litTorches = 0;
    const arena = this.arena;
    if (!arena) return;

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
        if (litTorches < MAX_TORCH_LIGHTS) {
          litTorches += 1;
          const flame = new THREE.PointLight(0xffa542, 4.2, 9, 1.5);
          flame.position.set(torch.position.x, FLOOR_HEIGHT + 1.1, torch.position.z);
          this.scene.add(flame);
          this.torchLights.push(flame);
          // Only the flames wobble. The entrance and core glows share the
          // torchLights array for cleanup but are markers, and a landmark that
          // breathes reads as broken rather than lit.
          this.flames.push({
            light: flame,
            base: flame.intensity,
            phase: tileNoise(floor.x, floor.y, 29) * Math.PI * 2,
          });
        }
        break;
      }

    }

    /*
     * The floor props come from src/game/decor.ts, not from here.
     *
     * They are terrain: they block placement and they block the walk, so where
     * they stand is a rule of the game and the simulation has to agree with
     * the picture exactly. One function decides, everything reads it.
     */
    if (!this.entrance || !this.core) return;
    for (const spec of decorFor(arena, this.entrance, this.core)) {
      const prop = this.spawnModel(spec.key, 0.55);
      if (!prop) continue;
      // Off-centre and turned, so a room of barrels does not look stamped.
      prop.position.set(
        spec.x + spec.offsetX,
        FLOOR_HEIGHT + prop.position.y,
        spec.y + spec.offsetZ,
      );
      prop.rotation.y = spec.spin;
      this.scene.add(prop);
      this.decor.push(prop);
      this.clutter.push({
        object: prop,
        x: spec.x,
        y: spec.y,
        restX: prop.position.x,
        restZ: prop.position.z,
        restScale: prop.scale.x || 1,
        present: 1,
        wanted: 1,
      });
    }
  }

  /**
   * Decides which props are in the way.
   *
   * A barrel standing inside the stone wall the player just dropped on it is
   * the single clearest sign that the scenery is not part of the game, and it
   * was happening on every placement: the clutter was chosen once at startup
   * from whatever was on the board then, and never looked again. So the tiles
   * that hold something are recomputed whenever the board changes, and the
   * props on them are cleared away — and put back when the tile is freed,
   * because a player who removes a wall should get their dungeon back.
   *
   * Minions count as occupants; adventurers do not. A minion is placed and
   * stands there, so it owns its tile the way a trap does, while a raider is
   * passing through — and what happens when a raider passes through is the
   * shove below, not a disappearing barrel.
   */
  private syncClutter(): void {
    if (this.clutter.length === 0) return;

    const taken = new Set<number>();
    const key = (x: number, y: number) => Math.round(y) * 1000 + Math.round(x);
    for (const marker of this.lastMarkers) taken.add(key(marker.x, marker.y));
    for (const obstacle of this.lastObstacles) taken.add(key(obstacle.x, obstacle.y));
    for (const unit of this.lastUnits) {
      if (unit.kind.startsWith("m_")) taken.add(key(unit.x, unit.y));
    }

    for (const item of this.clutter) item.wanted = taken.has(key(item.x, item.y)) ? 0 : 1;
  }

  /** Advances a prop clearing away or coming back. */
  private updateClutter(delta: number): void {
    for (const item of this.clutter) {
      const rate = CLUTTER_CLEAR_RATE * delta;
      if (item.present < item.wanted) item.present = Math.min(item.wanted, item.present + rate);
      else if (item.present > item.wanted) item.present = Math.max(item.wanted, item.present - rate);

      const object = item.object;
      object.visible = item.present > 0.01;
      if (!object.visible) continue;
      object.scale.setScalar(item.restScale * item.present);
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

    this.disposeEntranceMark();
    for (const object of this.landmarks) this.disposeObject(this.scene, object);
    this.landmarks = [];
    for (const object of this.decor) this.disposeObject(this.scene, object);
    this.decor = [];
    this.clutter = [];
    for (const light of this.torchLights) this.scene.remove(light);
    this.torchLights = [];
    this.flames = [];

    const spots: Array<{ key: string; x: number; y: number }> = [];
    if (this.entrance) spots.push({ key: "entrance", x: this.entrance.x, y: this.entrance.y });
    if (this.core) spots.push({ key: "core", x: this.core.x, y: this.core.y });

    for (const spot of spots) {
      const object = this.spawnModel(spot.key, 0.9);
      if (!object) continue;
      object.position.set(spot.x, FLOOR_HEIGHT + object.position.y, spot.y);
      this.scene.add(object);
      this.landmarks.push(object);

      /*
       * Give each end its own colour of light.
       *
       * A player needs to know which end the raiders walk in from before they
       * decide where to put a wall, and a stain on the floor was not enough:
       * the sandstone is bright and washed it out. Two lights say it at a
       * glance in the language the rest of the room already uses — the
       * entrance burns red, the core burns gold.
       */
      const glow = new THREE.PointLight(
        spot.key === "entrance" ? 0xff5a3c : 0xffc23c,
        3.4,
        6.5,
        1.7,
      );
      glow.position.set(spot.x, FLOOR_HEIGHT + 0.9, spot.y);
      this.scene.add(glow);
      this.torchLights.push(glow);
    }

    if (this.entrance) this.buildEntranceMark(this.entrance);
  }

  /**
   * Says where the raiders come in, in the only language that cannot be
   * mistaken for decoration: movement.
   *
   * The entrance already had stairs, a stained floor and a red light, and all
   * three say "this tile is special" rather than "things arrive here". Every
   * game that has ever had a spawn point marks it the same way — something
   * pointing down at it that will not hold still — so this is an arrow that
   * bobs over a ring that keeps opening out of the tile and fading.
   */
  private buildEntranceMark(entrance: Point): void {
    const colour = ENTRANCE_MARK;

    // Four sides, point down: a chevron rather than a cone, so it reads as a
    // marker instead of a piece of the dungeon.
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.44, 4),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9 }),
    );
    arrow.rotation.x = Math.PI;
    arrow.position.set(entrance.x, FLOOR_HEIGHT + 1.25, entrance.y);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 24),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.75,
        // Flat on the floor and never fighting the tile underneath it.
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(entrance.x, FLOOR_HEIGHT + 0.03, entrance.y);

    this.scene.add(arrow, ring);
    this.entranceMark = { arrow, ring };
  }

  /** Bobs the arrow and opens the ring, on a loop. */
  private updateEntranceMark(): void {
    const mark = this.entranceMark;
    if (!mark) return;

    const t = this.elapsed;
    mark.arrow.position.y = FLOOR_HEIGHT + 1.25 + Math.sin(t * 2.4) * 0.14;
    mark.arrow.rotation.y = t * 0.9;

    // One ring every 1.6s, growing and fading as it goes.
    const phase = (t % 1.6) / 1.6;
    mark.ring.scale.setScalar(1 + phase * 1.9);
    (mark.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - phase);
  }

  private disposeEntranceMark(): void {
    const mark = this.entranceMark;
    if (!mark) return;
    for (const piece of [mark.arrow, mark.ring]) {
      this.scene.remove(piece);
      piece.geometry.dispose();
      (piece.material as THREE.Material).dispose();
    }
    this.entranceMark = null;
  }

  /**
   * A flat chevron lying in the XY plane, pointing at +Y.
   *
   * Drawn rather than taken from the model pack: this is read from a long way
   * up at about twenty pixels across, and every arrow the pack has is a prop
   * with a shaft and fletching that turns to mush at that size.
   */
  private static makeArrowGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.26);
    shape.lineTo(-0.2, -0.1);
    shape.lineTo(-0.07, -0.04);
    shape.lineTo(0, -0.16);
    shape.lineTo(0.07, -0.04);
    shape.lineTo(0.2, -0.1);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  private clearAftermath(): void {
    for (const child of this.aftermathGroup.children.slice()) {
      this.disposeObject(this.aftermathGroup, child);
    }
  }

  /**
   * What the last raid did, painted on the floor it happened on.
   *
   * The settlement screen reports a raid as four numbers. Numbers cannot tell
   * a player that their whole corridor is decorative and every kill happened
   * in the two tiles nearest the core - which is the single thing that would
   * teach them to build a better maze. The board can, and it needs no words
   * to do it, which is why this is a map and not a tooltip.
   *
   * Three readings, in one look:
   *  - heat: where damage actually landed on the party. A dark route is a
   *    route nothing covers.
   *  - `fell`: where an adventurer went down. Clusters mark the killing
   *    ground; a lone mark near the core marks a near miss.
   *  - `lost`: where the player's own died. These are the placements that
   *    ended up in the road.
   *
   * Colours are the ones the same events already flashed during the raid, so
   * the map reads as a record of what was just watched rather than as a new
   * legend to learn.
   */
  setAftermath(cells: AftermathCell[] | null, marks: AftermathMark[] = []): void {
    this.clearAftermath();
    if (!cells || cells.length === 0) return;

    // Cold ember to lit torch. Even the coldest tile stays visible: a tile
    // that took one arrow is information too.
    const cold = new THREE.Color(0x6b3a1c);
    const hot = new THREE.Color(0xe8a44c);

    for (const cell of cells) {
      const heat = Math.max(0, Math.min(1, cell.heat));
      const mesh = new THREE.Mesh(
        this.pathGeometry,
        new THREE.MeshBasicMaterial({
          color: cold.clone().lerp(hot, heat),
          transparent: true,
          opacity: 0.16 + 0.42 * heat,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cell.x, FLOOR_HEIGHT + 0.025, cell.y);
      this.aftermathGroup.add(mesh);
    }

    for (const mark of marks) {
      const mesh = new THREE.Mesh(
        this.aftermathRing,
        new THREE.MeshBasicMaterial({
          // Lighter than the flash the same event made during the raid: a
          // ring is drawn on top of the hottest tiles of the heat map, and
          // the raid colours sit too close to that orange to survive there.
          color: mark.kind === "fell" ? 0xffb4a0 : 0xc9baff,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      // Above the heat, so a ring on a bright tile still reads as a ring.
      mesh.position.set(mark.x, FLOOR_HEIGHT + 0.045, mark.y);
      this.aftermathGroup.add(mesh);
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
    this.pathArrows = [];
    this.pathLength = path?.length ?? 0;

    if (!path || path.length === 0) return;

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const mesh = new THREE.Mesh(
        this.pathGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xe8a44c,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(step.x, FLOOR_HEIGHT + 0.03, step.y);
      this.scene.add(mesh);
      this.pathMarkers.push(mesh);

      /*
       * An arrow on every step but the last, pointing at the one after it.
       *
       * The route used to say where they walk by fading along its length, and
       * a gradient is not a direction - it reads as "this end matters more",
       * which is not the question being asked. An arrow says which way, and a
       * row of them lighting up in sequence says which way they are going
       * without anyone having to work out which end is darker.
       */
      const next = path[i + 1];
      if (!next) continue;

      const dx = next.x - step.x;
      const dz = next.y - step.y;
      const arrow = new THREE.Mesh(
        this.arrowGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffd9a0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      /*
       * Laid flat, then spun to face the next tile.
       *
       * With rotation.x at -90 degrees the shape's own +Y points at world -Z,
       * so the spin that aims it down (dx, dz) is atan2(-dx, -dz). Worked out
       * rather than guessed: an arrow pointing the wrong way is worse than no
       * arrow, because it is confidently wrong.
       */
      arrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-dx, -dz));
      arrow.position.set(
        step.x + dx * 0.5,
        FLOOR_HEIGHT + 0.05,
        step.y + dz * 0.5,
      );
      this.scene.add(arrow);
      this.pathMarkers.push(arrow);
      this.pathArrows.push({ mesh: arrow, step: i });
    }
  }

  /**
   * The route the party would take if the wall under the cursor went up.
   *
   * Drawn beside the real one rather than replacing it, and in a colour that
   * is not the route's: the player is comparing two things, and swapping one
   * for the other would only show them the answer without the question.
   *
   * A cursor is a mouse idea, so this is desktop-only in practice. On a phone
   * the answer arrives the moment the wall goes down, and taking it back
   * costs nothing.
   */
  setPathGhost(path: Array<{ x: number; y: number }> | null): void {
    for (const marker of this.ghostPathMarkers) this.disposeObject(this.scene, marker);
    this.ghostPathMarkers = [];
    if (!path || path.length === 0) return;

    for (const step of path) {
      const mesh = new THREE.Mesh(
        this.pathGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x86c5e0,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      // Just under the live route, so where the two agree the live one wins.
      mesh.position.set(step.x, FLOOR_HEIGHT + 0.02, step.y);
      this.scene.add(mesh);
      this.ghostPathMarkers.push(mesh);
    }
  }

  /**
   * Runs the light down the route, entrance to core.
   *
   * One travelling band rather than every arrow blinking together: a band has
   * a direction and a blink does not. The band is a fixed number of tiles
   * wide however long the route is, so a short corridor and a folded one read
   * at the same speed.
   */
  private updatePathFlow(): void {
    if (this.pathArrows.length === 0) return;

    const BAND = 3.2;
    const SPEED = 4.5; // tiles a second
    const head = (this.elapsed * SPEED) % (this.pathLength + BAND * 2);

    for (const { mesh, step } of this.pathArrows) {
      const behind = head - step;
      // Outside the band entirely: a dim arrow that still says which way.
      const lit = behind >= 0 && behind <= BAND ? 1 - behind / BAND : 0;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.62 * lit;
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
      /*
       * The two tiles the whole game is measured between have to be findable.
       *
       * With the KayKit floor in place every tile was tinted plain white, so
       * the entrance and the core looked exactly like the other 142 — the
       * player had no way to see which end the raiders walk in from. The floor
       * itself is stained instead of relying on the small stairs and chest
       * models: red where they come from, gold at what they are coming for.
       */
      const tint =
        item.tile === TILE.ENTRANCE
          ? ENTRANCE_TINT
          : item.tile === TILE.CORE
            ? CORE_TINT
            : proto
              ? 0xffffff
              : COLORS[item.tile];
      color.setHex(tint);
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
      clutter: this.clutter.length,
      clutterCleared: this.clutter.filter((c) => c.wanted === 0).length,
      flames: this.flames.length,
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

    /*
     * Fog follows the camera rather than sitting at fixed depths.
     *
     * It was pinned at 30-60 world units, which suited the original small
     * landscape board. Framing a taller room — or backing off to clear the
     * HUD — pushed the whole dungeon past the far plane and it faded into the
     * background colour entirely. Tying it to the viewing distance keeps the
     * same amount of haze whatever the camera is doing.
     */
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = this.distance * 0.95;
      fog.far = this.distance * 2.4;
    }
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
    // The offset is expressed in pixels, so it has to be restated whenever the
    // canvas changes size.
    this.applyViewOffset();
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
    this.positionGhost();
    this.callbacks.onHoverChange(tile);
  }

  /**
   * What the next tap will put down, shown where it will land.
   *
   * The hovered tile used to be a plain amber box: it said "here" but never
   * what, and never whether the game would accept it. The player found out by
   * tapping and hearing the refusal sound. Now the thing itself stands on the
   * tile, see-through and washed green or red, so the answer arrives before
   * the tap rather than after it.
   */
  setGhost(modelKey: string | null, legal: boolean): void {
    if (modelKey !== this.ghostKey) {
      this.ghostKey = modelKey;
      if (this.ghost) {
        this.disposeObject(this.scene, this.ghost);
        this.ghost = null;
      }
      if (modelKey) {
        // Obstacles are scaled to the tile grid so they join up, so the
        // preview has to be too or the piece grows the moment it is placed.
        const object = modelKey.startsWith("obstacle_")
          ? this.spawnPiece(modelKey)
          : this.spawnModel(modelKey, 0.9);
        if (object) {
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) {
              material.transparent = true;
              material.opacity = 0.55;
              material.depthWrite = false;
            }
          });
          this.ghostLift = object.position.y;
          this.ghost = object;
          this.scene.add(object);
        }
      }
    }

    this.ghostLegal = legal;
    this.tintGhost();
    this.positionGhost();
  }

  private tintGhost(): void {
    if (!this.ghost) return;
    const hex = this.ghostLegal ? GHOST_OK : GHOST_NO;
    this.ghost.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const lit = material as THREE.MeshLambertMaterial;
        if (lit.color) lit.color.setHex(hex);
        if ("emissive" in lit && lit.emissive) lit.emissive.setHex(hex).multiplyScalar(0.25);
      }
    });
  }

  private positionGhost(): void {
    if (!this.ghost) return;
    const tile = this.hovered;
    this.ghost.visible = tile !== null;
    if (tile) this.ghost.position.set(tile.x, FLOOR_HEIGHT + this.ghostLift, tile.y);
    this.positionRangeRing();
  }

  /**
   * How far the thing being placed can shoot, drawn on the floor.
   *
   * Reach is the whole decision when placing a minion — an archer behind a
   * wall is a tower and one in the open is a target, and the difference is
   * whether the route passes through this circle. Without seeing it the player
   * is guessing at a number they were never told.
   *
   * Null clears it, which is what every tool that does not shoot passes.
   */
  setRangeRing(radius: number | null): void {
    if (radius === null || radius <= 0) {
      if (this.rangeRing) {
        this.scene.remove(this.rangeRing);
        this.rangeRing.geometry.dispose();
        (this.rangeRing.material as THREE.Material).dispose();
        this.rangeRing = null;
      }
      this.rangeRadius = 0;
      return;
    }

    if (this.rangeRadius !== radius) {
      if (this.rangeRing) {
        this.scene.remove(this.rangeRing);
        this.rangeRing.geometry.dispose();
        (this.rangeRing.material as THREE.Material).dispose();
      }
      // A band rather than a disc: a filled circle hides the floor the player
      // is trying to read the route off.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.06, radius, 48),
        new THREE.MeshBasicMaterial({
          color: RANGE_RING,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.rangeRing = ring;
      this.rangeRadius = radius;
    }

    this.positionRangeRing();
  }

  private positionRangeRing(): void {
    const ring = this.rangeRing;
    if (!ring) return;
    const tile = this.hovered;
    ring.visible = tile !== null;
    if (tile) ring.position.set(tile.x, FLOOR_HEIGHT + 0.02, tile.y);
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

    if (wasSingle && !this.dragMoved) {
      const tile = this.pointerToTile(e.clientX, e.clientY);
      if (tile && e.button === 2) {
        this.callbacks.onTileAlt?.(tile.x, tile.y, e.clientX, e.clientY);
      } else if (tile) {
        this.callbacks.onTileTap(tile.x, tile.y);
      }
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

    this.elapsed += delta;

    for (const entry of this.mixers.values()) entry.mixer.update(delta);
    this.updateEffects(delta);
    this.updateClutter(delta);
    this.updateFlames();
    this.updateEntranceMark();
    this.updatePathFlow();
    this.updateHealthBars();
    this.updateShake(delta);

    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Makes the torches burn rather than shine.
   *
   * A point light held at a constant value is a lamp. Two sine waves at
   * unrelated speeds, offset per torch so they never pulse in unison, is close
   * enough to a flame at this distance — and it costs nothing, which matters
   * because there are six of them on a phone.
   */
  private updateFlames(): void {
    const t = this.elapsed;
    for (const flame of this.flames) {
      const wobble =
        Math.sin(t * 7.3 + flame.phase) * 0.7 + Math.sin(t * 17.1 + flame.phase * 2.3) * 0.3;
      flame.light.intensity = flame.base * (1 + FLICKER_DEPTH * wobble);
    }
  }

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
    this.arrowGeometry.dispose();
    this.barGeometry.dispose();
    this.aftermathRing.dispose();
    this.clearAftermath();
    this.disposeEntranceMark();
    this.setRangeRing(null);
    for (const object of this.landmarks) this.disposeObject(this.scene, object);
    this.landmarks = [];
    for (const object of this.decor) this.disposeObject(this.scene, object);
    this.decor = [];
    this.clutter = [];
    for (const light of this.torchLights) this.scene.remove(light);
    this.torchLights = [];
    this.flames = [];

    this.unitGeometry.dispose();
    this.trapGeometry.dispose();
    this.roomGeometry.dispose();
    this.obstacleGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
