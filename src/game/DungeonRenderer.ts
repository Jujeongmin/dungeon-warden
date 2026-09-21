import * as THREE from "three";
import { TILE, type TileId } from "./types";
import { ModelLibrary, MODEL_PATTERNS, fitToTile, type LoadedModel } from "./assets/ModelLibrary";
import { bakeModelIcons } from "./assets/modelIcons";
import { inArena, type Arena } from "./arena";
import { tileNoise } from "./noise";
import type { Point } from "./sim/pathfinding";

const TILE_SIZE = 1;
const WALL_HEIGHT = 0.9;
const FLOOR_HEIGHT = 0.12;

/*
 * Looking down the room rather than across its corner.
 *
 * The camera used to sit at 45 degrees of yaw, so a 12x20 room presented its
 * diagonal to the screen - a footprint of about 22.6 by 13.9, which is a
 * landscape shape being fitted into a portrait window. The four corners of
 * the viewport were empty and every tile was about 17px across.
 *
 * Square on, the room presents 12 across instead of 22.6, so the same screen
 * gives about 32px a tile. Nearly double, for nothing. Most of what this
 * session fought - portraits that were smudges, health that needed a bar,
 * a route that needed arrows drawn on it - was the same problem wearing
 * different clothes.
 *
 * 68 degrees rather than straight down: the models are drawn for a
 * three-quarter view and lose their silhouette entirely from directly above,
 * and a steeper angle also hides less of the corridor behind the rock.
 */
const PITCH = THREE.MathUtils.degToRad(68);

/*
 * How the view keeps up with the simulation.
 *
 * The simulation moves everything twenty times a second. Drawn exactly
 * there, a unit held still for two or three frames and then jumped, which
 * on a 60 or 120 Hz screen is a stutter. Each position is a target the
 * drawing eases toward instead: at this rate a step is mostly covered by the
 * next one, so the motion reads as continuous and trails the truth by a few
 * centimetres. Anything further off than FOLLOW_SNAP is a spawn or a shove,
 * and is jumped to rather than slid across.
 */
const FOLLOW_RATE = 18;
/** How solid a minion on its revive timer is drawn. See UnitView.resting. */
const RESTING_OPACITY = 0.35;
/** Pixel size of a head tag's canvas. */
const LABEL_W = 128;
const LABEL_H = 52;
const FOLLOW_SNAP = 1.5;

/** The standing light, restated by setShowcase. */
const AMBIENT_INTENSITY = 0.62;
const KEY_INTENSITY = 0.72;

/*
 * The title screen's view of the dungeon.
 *
 * The overview is lit and framed for building: straight down, dim, the room
 * filling the screen. Behind a menu that read as a black rectangle. The title
 * shows the dungeon off instead - brighter, lower, and slowly circling, so the
 * walls have depth and the torches have something to light.
 */
const SHOWCASE_SPIN = 0.06; // radians a second: one turn in under two minutes
const SHOWCASE_PITCH = THREE.MathUtils.degToRad(40);
/** Tiles across the room the showcase keeps in view beside the menu. */
const SHOWCASE_SPAN = 12;
const SHOWCASE_LIGHT = 1.8;
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

/** Scratch rotations for the health bars, so the frame loop allocates nothing. */
const FACING = new THREE.Quaternion();
const HOST_FACING = new THREE.Quaternion();

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
  /**
   * Still down from an earlier raid, and not fighting in this one.
   *
   * Drawn see-through: a fallen minion sits out a revive timer, and drawn
   * solid it looked ready - then was simply missing once the raid began.
   */
  resting?: boolean;
  /** A short tag over the unit's head - a resting minion's time left. */
  label?: string;
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

/** A trap on the floor. */
export interface MarkerView {
  id: string;
  x: number;
  y: number;
  kind: string;
  shape: "trap";
}

/** Placeholder colors, keyed the same way as MODEL_PATTERNS. */
const UNIT_COLORS: Record<string, number> = {
  m_warrior: 0xd8d2c4,
  m_mage: 0x9d8bd8,
  m_guard: 0xb9a98a,
  m_grunt: 0xcfc6b0,
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
};

const UNIT_HEIGHT = 0.7;
/** How wide a unit is drawn, in tiles. */
const UNIT_TILES = 0.8;
const MARKER_HEIGHT = 0.16;

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
 * Where the CC0 stone the room is made of lives.
 *
 * Two maps per material at 512px, baked down from ambientCG's 1K packs by
 * scripts/bake-textures.mjs - see the note there for why that is enough.
 * Rock051 for the rock, PavingStones128 for the floor. Both CC0.
 */
const STONE = {
  rock: "/assets/textures/rock051",
  floor: "/assets/textures/pavingstones128",
};

/**
 * How tall the uncut rock stands, and what colour it is.
 *
 * Lighter than it wants to be. The room is lit by torches standing in the
 * corridor, so the rock is only ever edge-lit - at the colour it reads as on
 * paper it came out as a black slab with a thread of light in it, and the
 * player could not see the shape of their own dungeon. Kept low enough that
 * it never hides the corridor from this camera angle.
 */
const ROCK_HEIGHT = 0.85;

/** How high off the floor a shot is drawn, and how thick. Chest height. */
const BOLT_HEIGHT = 0.42;
const BOLT_WIDTH = 0.13;
/** How long one lasts, in seconds. Long enough to be seen, short enough to read as a shot. */
const BOLT_SECONDS = 0.16;
/*
 * A tint over the stone, not a replacement for it.
 *
 * This used to be the rock's whole colour, on a material with no texture.
 * Multiplying a photograph of stone by the same dark brown buries it - the
 * room went black except for a pool around each torch. Cooled and barely
 * darkened instead, so the stone reads as stone and the torches are the only
 * warm thing in the room.
 */
const ROCK_TINT = 0xc3c8cd;

/**
 * And the tint on the floor, which is the other half of that sentence.
 *
 * Neither is darkened much - the room has little light to spare and a dark
 * tint over a photograph of stone buries it. They are separated by hue
 * instead: the rock is cooled towards the grey-blue of something nobody has
 * touched, the floor warmed towards the sand of something that has been cut,
 * walked on and lit. Value stays where it was, so nothing gets harder to see.
 */
const FLOOR_TINT = 0xd9c4a0;

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
 * player digs a tile. FNV-1a over the coordinates, folded to [0, 1).
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
  private rockMesh: THREE.InstancedMesh | null = null;
  /** Loaded once and shared; disposed with the renderer. */
  private stone = new Map<string, { color: THREE.Texture; normal: THREE.Texture }>();
  private highlight: THREE.Mesh;

  private unitGroup = new THREE.Group();
  private unitMeshes = new Map<string, THREE.Object3D>();
  private unitGeometry = new THREE.CapsuleGeometry(0.22, UNIT_HEIGHT * 0.5, 4, 8);

  private markerGroup = new THREE.Group();
  private markerMeshes = new Map<string, THREE.Object3D>();
  private trapGeometry = new THREE.BoxGeometry(0.72, MARKER_HEIGHT, 0.72);
  /** The floor ring under every trap. Shared; each trap tints its own material. */
  private trapRing = new THREE.RingGeometry(0.4, 0.5, 28);


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
  /** Streaks from a shooter to what it hit, fading out over a few frames. */
  private bolts: Array<{ mesh: THREE.Mesh; life: number }> = [];
  /** A unit-length bar down +z, stretched to whatever span it has to cover. */
  private boltGeometry = new THREE.BoxGeometry(BOLT_WIDTH, BOLT_WIDTH, 1);
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
  private ambientLight!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  /** True while the title screen is up. See SHOWCASE_SPIN. */
  private showcase = false;

  /** Pixels of canvas hidden behind the HUD, so the board can frame above it. */
  private bottomInset = 0;
  private leftInset = 0;
  private rightInset = 0;
  private topInset = 0;

  /** The see-through preview of what the next tap places. */
  private ghost: THREE.Object3D | null = null;
  private ghostKey: string | null = null;
  private ghostLegal = true;
  private ghostLift = 0;
  private rangeRing: THREE.Mesh | null = null;
  private rangeRadius = 0;
  /** Flat keys of the tiles that have been dug out. Empty means solid rock. */
  private dug = new Set<number>();
  private pathMarkers: THREE.Object3D[] = [];
  private pathGeometry = new THREE.PlaneGeometry(0.86, 0.86);
  /**
   * The arrows that run along the route, each with the place in the queue it
   * holds - that index is what turns a row of arrows into something moving.
   */
  private pathArrows: Array<{ mesh: THREE.Mesh; step: number }> = [];
  private ghostPathMarkers: THREE.Object3D[] = [];
  /** Head tags, by unit id. See syncLabel. */
  private labels = new Map<string, THREE.Sprite>();
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
    const ambient = new THREE.AmbientLight(0xbcc6d8, AMBIENT_INTENSITY);
    const key = new THREE.DirectionalLight(0xdfe3ee, KEY_INTENSITY);
    key.position.set(6, 14, 4);
    const rim = new THREE.DirectionalLight(0x8fa6cc, 0.22);
    rim.position.set(-8, 6, -6);
    this.scene.add(ambient, key, rim);
    this.ambientLight = ambient;
    this.keyLight = key;

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

  /**
   * Which tiles have been dug out of the rock.
   *
   * Separate from setArena because the room's size changes about twice in a
   * dungeon's life and its shape changes on every tap.
   */
  setDug(dug: Set<number>): void {
    this.dug = dug;
    this.rebuildInstances();
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
  /**
   * How much of the canvas the HUD is sitting on.
   *
   * The canvas fills the screen and the HUD floats over its lower half, so a
   * board centred in the canvas is centred behind the panel — on a phone that
   * put the core, the thing the player is defending, out of sight. The camera
   * frames into the band that is actually visible instead.
   */
  /** How much of the canvas the HUD sheet is covering along the foot. */
  setBottomInset(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.bottomInset) return;
    this.bottomInset = next;
    this.applyViewOffset();
    this.fitToArena();
  }

  /**
   * How much of the canvas is covered down the left edge.
   *
   * The title screen is a slab of stone with the menu cut into it, and the
   * room behind it is the picture - so the room has to be in the part of the
   * canvas the slab does not cover. Without this it is framed dead centre
   * and the menu stands on top of it.
   */
  setLeftInset(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.leftInset) return;
    this.leftInset = next;
    this.applyViewOffset();
    this.fitToArena();
  }

  /** How much of the canvas the top chrome covers: the bar, and any banners under it. */
  setTopInset(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.topInset) return;
    this.topInset = next;
    this.applyViewOffset();
    this.fitToArena();
  }

  /** How much of the canvas the build panel covers down the right edge. */
  setRightInset(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.rightInset) return;
    this.rightInset = next;
    this.applyViewOffset();
    this.fitToArena();
  }

  private applyViewOffset(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    // Never hide so much that there is no room left to play in.
    const bottom = Math.min(this.bottomInset, Math.max(0, height - 80));
    const left = Math.min(this.leftInset, Math.max(0, width - 80));
    const right = Math.min(this.rightInset, Math.max(0, width - 80 - left));
    const top = Math.min(this.topInset, Math.max(0, height - 80 - bottom));

    if (bottom <= 0 && left <= 0 && right <= 0 && top <= 0) {
      this.camera.clearViewOffset();
      return;
    }

    /*
     * Frame as though the canvas were larger by each hidden strip, then show
     * the part of it the player can see. A point at the virtual centre lands
     * at `full / 2 - offset` on screen, and the board wants to sit at the
     * middle of what is left: for a strip hidden on the right that means an
     * offset of the strip itself, for one hidden on the left an offset of
     * nothing (the virtual canvas grows leftwards and the window stays put),
     * and for the foot the strip again. The left case was wrong before and
     * framed the title room behind the slab it was meant to sit beside.
     */
    this.camera.setViewOffset(width + left + right, height + top + bottom, right, bottom, width, height);
  }

  private fitToArena(): void {
    const arena = this.arena;
    if (!arena) return;

    /*
     * Square on, so the footprint is the room itself rather than its diagonal:
     * as wide as it is, and as deep as it is times the cosine of the pitch.
     * A quarter turn swaps which is which.
     */
    const turned = this.yawStep % 2 === 1;
    const across = turned ? arena.h : arena.w;
    const along = (turned ? arena.w : arena.h) * Math.cos(PITCH - Math.PI / 2);
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2;

    /*
     * Fitted to the part of the canvas the player can actually see.
     *
     * The view offset spreads the field over the canvas plus every hidden
     * strip, so a pixel per world unit is the virtual height over the world
     * height at this distance. The board has to fit its footprint into the
     * visible region on both axes, and the larger of the two distances wins.
     * Sharing out ratios used to stand in for this, and got the answer
     * wrong the moment the panel moved from the foot to the side: it took
     * the larger ratio and applied it to the wrong axis.
     */
    const height = this.canvas.clientHeight || 1;
    const width = this.canvas.clientWidth || 1;
    const fullHeight = height + this.topInset + this.bottomInset;
    const visibleHeight = Math.max(80, height - this.topInset - this.bottomInset);
    const visibleWidth = Math.max(80, width - this.leftInset - this.rightInset);
    // A little air round the room, so the door and the core are not on the edge.
    const margin = 1.12;

    const forHeight = (along * margin * fullHeight) / (2 * Math.tan(halfFov) * visibleHeight);
    const forWidth = (across * margin * fullHeight) / (2 * Math.tan(halfFov) * visibleWidth);

    this.distance = THREE.MathUtils.clamp(
      Math.max(forHeight, forWidth),
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
      let created = false;
      const usesModel = this.loaded.get(unit.kind) != null;

      if (!object) {
        const model = this.spawnModel(unit.kind, UNIT_TILES);
        object =
          model ??
          new THREE.Mesh(
            this.unitGeometry,
            new THREE.MeshLambertMaterial({ color: UNIT_COLORS[unit.kind] ?? 0xffffff }),
          );
        this.unitMeshes.set(unit.id, object);
        this.unitGroup.add(object);
        created = true;

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
      // A target the loop eases toward rather than a place to be drawn - see
      // FOLLOW_RATE. A new unit, or one that jumped, is put there outright.
      const tx = unit.x + (impact?.kx ?? 0) * knock;
      const tz = unit.y + (impact?.ky ?? 0) * knock;
      if (!usesModel) object.position.y = UNIT_HEIGHT;
      if (created || Math.hypot(object.position.x - tx, object.position.z - tz) > FOLLOW_SNAP) {
        object.position.x = tx;
        object.position.z = tz;
      }
      object.userData.target = { x: tx, z: tz };
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
      this.syncLabel(unit.id, object, unit.label);
      const resting = unit.resting === true;
      if (object.userData.resting !== resting) {
        object.userData.resting = resting;
        DungeonRenderer.fade(object, resting ? RESTING_OPACITY : 1);
      }
    }

    for (const [id, object] of this.unitMeshes) {
      if (seen.has(id)) continue;
      this.unitMeshes.delete(id);
      this.mixers.delete(id);
      this.flashes.delete(id);
      // The bar is a child of the model, so it goes with it either way - this
      // is just the bookkeeping that stops updateHealthBars walking corpses.
      this.healthBars.delete(id);
      this.syncLabel(id, object, undefined);

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

  /** Eases every unit toward where the simulation last put it. See FOLLOW_RATE. */
  private updateUnitMotion(delta: number): void {
    const k = 1 - Math.exp(-delta * FOLLOW_RATE);
    for (const object of this.unitMeshes.values()) {
      const target = object.userData.target as { x: number; z: number } | undefined;
      if (!target) continue;
      object.position.x += (target.x - object.position.x) * k;
      object.position.z += (target.z - object.position.z) * k;
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
    this.setUnits(this.lastUnits);
    this.setMarkers(this.lastMarkers);
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
  /** See-through, or solid again at 1. Readouts hanging off the model are left alone. */
  private static fade(object: THREE.Object3D, opacity: number): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.ui) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = opacity < 1;
        material.opacity = opacity;
        material.depthWrite = opacity >= 1;
        material.needsUpdate = true;
      }
    });
  }

  private static tint(object: THREE.Object3D, base: number, factor: number): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Anything hanging off the model that is a readout rather than a part
      // of it keeps its own colours.
      if (mesh.userData.ui) return;
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
      /*
       * Marked as chrome, so the wounded-and-flashing tint below leaves it
       * alone.
       *
       * tint() walks the whole model to darken it as it takes damage, and the
       * bar is a child of that model - so the bar was being repainted in the
       * unit's own colour every frame. At full health that colour is white,
       * which is why a full bar looked like a blank strip of paper.
       */
      back.userData.ui = true;
      fill.userData.ui = true;
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

  /**
   * A tag over one unit's head, or none.
   *
   * A sprite, so it faces the camera on its own, and a child of the unit so
   * it goes where the unit goes. Redrawn only when the text changes - once a
   * second for a countdown.
   */
  private syncLabel(id: string, host: THREE.Object3D, text: string | undefined): void {
    let sprite = this.labels.get(id);
    if (!text) {
      if (!sprite) return;
      sprite.removeFromParent();
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this.labels.delete(id);
      return;
    }

    if (!sprite) {
      const canvas = document.createElement("canvas");
      canvas.width = LABEL_W;
      canvas.height = LABEL_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }),
      );
      sprite.renderOrder = 12;
      sprite.userData.ui = true;
      this.labels.set(id, sprite);
    }
    if (sprite.parent !== host) host.add(sprite);

    if (sprite.userData.text !== text) {
      sprite.userData.text = text;
      const texture = sprite.material.map as THREE.CanvasTexture;
      const canvas = texture.image as HTMLCanvasElement;
      const g = canvas.getContext("2d");
      if (g) {
        g.clearRect(0, 0, LABEL_W, LABEL_H);
        g.fillStyle = "rgba(14, 10, 8, 0.82)";
        g.strokeStyle = "rgba(232, 164, 76, 0.7)";
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(2, 2, LABEL_W - 4, LABEL_H - 4, (LABEL_H - 4) / 2);
        g.fill();
        g.stroke();
        g.fillStyle = "#f0b660";
        g.font = `700 ${Math.round(LABEL_H * 0.56)}px Pretendard, system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, LABEL_W / 2, LABEL_H / 2 + 2);
      }
      texture.needsUpdate = true;
    }

    // In the host's space, which is scaled to the tile: see syncHealthBar.
    const scale = host.scale.x || 1;
    sprite.position.set(0, 1.4 / scale, 0);
    sprite.scale.set(0.84 / scale, (0.84 * LABEL_H) / LABEL_W / scale, 1);
  }

  /** Turns every bar to face the camera. Cheap: a handful of quaternion copies. */
  private updateHealthBars(): void {
    this.camera.getWorldQuaternion(FACING);
    for (const bar of this.healthBars.values()) {
      /*
       * The parent turn has to come out first, or the bar wears it.
       *
       * A bar hangs off a model that rotates to face where it is walking,
       * and `quaternion` is local - so copying the camera straight in left
       * the bar rotated by the camera AND by the unit, which is why a hero
       * walking left wore his health bar back to front.
       */
      const host = bar.parent;
      if (host) {
        host.getWorldQuaternion(HOST_FACING);
        bar.quaternion.copy(HOST_FACING.invert()).multiply(FACING);
      } else {
        bar.quaternion.copy(FACING);
      }
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
   * (~0.1), a minion going down is a thump (~0.5). Impulses accumulate up
   * to a cap rather than stacking without bound, so a burst of events reads
   * as one solid hit instead of a jitter spike.
   */
  shake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  /** Expanding ring on a tile, used when a trap fires. */
  /**
   * A streak from whatever struck to whatever it struck.
   *
   * Short-lived and thin, because it is punctuation rather than a projectile:
   * by the time it is drawn the simulation has already decided the blow
   * landed, and what the player needs is the line between the two ends, not a
   * thing in flight. Only drawn for blows that crossed real ground - see the
   * caller - so a minion hitting what is in front of it stays a swing.
   */
  spawnBolt(fromX: number, fromY: number, toX: number, toY: number, color = 0xffd39a): void {
    const from = new THREE.Vector3(fromX, FLOOR_HEIGHT + BOLT_HEIGHT, fromY);
    const to = new THREE.Vector3(toX, FLOOR_HEIGHT + BOLT_HEIGHT, toY);
    const span = from.distanceTo(to);
    if (span < 0.01) return;

    const mesh = new THREE.Mesh(
      this.boltGeometry,
      // Additive, so it reads as light crossing the room rather than as a
      // stick lying in it - and so it survives being drawn over dark rock.
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.renderOrder = 40;
    mesh.scale.set(1, 1, span);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.lookAt(to);
    this.scene.add(mesh);
    this.bolts.push({ mesh, life: 1 });
  }

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
    // A point level with the lens projects to infinity rather than off the
    // screen, and an overlay placed there is a style React refuses.
    if (vector.z > 1 || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return null;

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((vector.x + 1) / 2) * rect.width,
      y: ((1 - vector.y) / 2) * rect.height,
    };
  }

  /** The traps, synced the same way as units. */
  setMarkers(markers: MarkerView[]): void {
    this.lastMarkers = markers;
    const seen = new Set<string>();

    for (const marker of markers) {
      seen.add(marker.id);
      let object = this.markerMeshes.get(marker.id);
      const modelKey = marker.kind;
      const usesModel = this.loaded.get(modelKey) != null;

      if (!object) {
        object =
          this.spawnModel(modelKey, 0.78) ??
          new THREE.Mesh(
            this.trapGeometry,
            new THREE.MeshLambertMaterial({
              color: MARKER_COLORS[marker.kind] ?? 0xffffff,
            }),
          );
        /*
         * A ring on the floor in the trap's own colour, under the model.
         *
         * The pack's props are dungeon dressing first - a crossbow is a
         * crossbow, and on a torch-lit floor it is a small dark shape among
         * other small dark shapes. The ring is what says "this tile does
         * something" at a glance, and its
         * colour is the one the same trap flashes when it fires.
         */
        {
          const ring = new THREE.Mesh(
            this.trapRing,
            new THREE.MeshBasicMaterial({
              color: MARKER_COLORS[marker.kind] ?? 0xffffff,
              transparent: true,
              opacity: 0.55,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          // In the model's own space, which is scaled to the tile - so the
          // ring is scaled back out to keep its size on the floor.
          const scale = object.scale.x || 1;
          ring.scale.setScalar(1 / scale);
          ring.position.y = -object.position.y / scale + 0.015 / scale;
          ring.userData.ui = true;
          object.add(ring);
        }
        this.markerMeshes.set(marker.id, object);
        this.markerGroup.add(object);
      }

      /*
       * Sits just above the floor so it reads as part of the tile.
       *
       * The lift is read once, when the object is made, and kept: it used to
       * be read back off the object's own height every call, so each call
       * added the floor height again - and now that markers are handed over
       * every frame, a trap rose into the air the moment it was placed.
       */
      if (object.userData.lift === undefined) {
        object.userData.lift = usesModel ? object.position.y : MARKER_HEIGHT / 2;
      }
      object.position.set(marker.x, FLOOR_HEIGHT + (object.userData.lift as number), marker.y);
    }

    for (const [id, object] of this.markerMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.markerGroup, object);
      this.markerMeshes.delete(id);
    }

    this.syncClutter();
  }

  /**
   * Every tile in the arena rectangle is floor — there is no terrain to dig
   * through any more, so the whole room is built in one pass.
   */
  private rebuildInstances(): void {
    const arena = this.arena;
    if (!arena) return;

    this.disposeInstanced();

    /*
     * Floor only where the rock has been taken out.
     *
     * This is the whole of the carving change as far as the picture is
     * concerned: the room used to be a full rectangle of flagstones with
     * objects standing on it, and it is now the shape of what was dug. The
     * wall builder below already places a panel wherever a floor tile has a
     * neighbour that is not floor, so it needs nothing new - it simply has
     * more edges to find.
     */
    const floorPositions: Array<{ x: number; y: number; tile: TileId }> = [];
    for (const key of this.dug) {
      const x = key % arena.w;
      const y = Math.floor(key / arena.w);
      let tile: TileId = TILE.FLOOR;
      if (this.entrance && x === this.entrance.x && y === this.entrance.y) tile = TILE.ENTRANCE;
      else if (this.core && x === this.core.x && y === this.core.y) tile = TILE.CORE;
      floorPositions.push({ x, y, tile });
    }

    // A plain slab of stone per tile rather than the pack's hexagon flag:
    // from eye height the flag was a paving stone the size of a table with
    // a bevel round it, and the scan already says what the floor is made of.
    this.floorMesh = this.buildInstanced(floorPositions, FLOOR_HEIGHT, null);
    if (this.floorMesh) {
      /*
       * Paving, not rock. This is the one thing the board has to say.
       *
       * The floor wore the same scan as the walls at the same brightness, so
       * a cut corridor and the rock it was cut out of were the same surface
       * at two heights - and from this camera, in a room lit only by the
       * torches standing in that corridor, the unlit half of the board was
       * unreadable. Worked stone underfoot and raw rock either side is the
       * difference the whole game is played on, so it is drawn as one:
       * different grain, and warm against cool.
       */
      this.dress(this.floorMesh, STONE.floor, { roughness: 0.9, tint: FLOOR_TINT, repeat: 1.4 });
      this.scene.add(this.floorMesh);
    }

    /*
     * The rock, as a mass rather than as a hole.
     *
     * Without this the undug part of the room is nothing at all - the
     * corridor floats in black, and "I have not dug there" looks the same as
     * "there is no room there". A dark block on every uncut tile gives the
     * room its outline back and makes the corridor read as taken out of
     * something.
     */
    const rockPositions: Array<{ x: number; y: number; tile: TileId }> = [];
    /*
     * One tile past the edge on every side, as the same rock.
     *
     * The border used to be panels from the model pack standing on the
     * outer rim - a built wall, from a different quarry than the stone
     * everything else is cut from, so the room ended in a change of
     * material. There is nothing built here: the room is a hole, and what
     * is outside it is more of what is inside the undug part of it.
     */
    for (let y = -1; y <= arena.h; y++) {
      for (let x = -1; x <= arena.w; x++) {
        const outside = x < 0 || y < 0 || x >= arena.w || y >= arena.h;
        if (!outside && this.dug.has(x + y * arena.w)) continue;
        rockPositions.push({ x, y, tile: TILE.FLOOR });
      }
    }
    this.rockMesh = this.buildInstanced(rockPositions, ROCK_HEIGHT, null);
    if (this.rockMesh) {
      /*
       * Standard rather than Lambert, here and on the floor only.
       *
       * A normal map needs a material that knows what one is, and these two
       * surfaces are most of what the player is looking at. Everything else
       * in the room is a small lit model where the extra cost buys nothing.
       */
      this.dress(this.rockMesh, STONE.rock, { roughness: 0.92, tint: ROCK_TINT, repeat: 1 });
      this.rockMesh.position.y = 0;
      this.scene.add(this.rockMesh);
    }

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
        // A wall stands wherever the corridor stops: at the edge of the room,
        // and at the edge of the rock nobody has dug through.
        if (inArena(arena, nx, ny) && this.dug.has(nx + ny * arena.w)) continue;
        if (tileNoise(nx * 2 + dx, ny * 2 + dy, 3) > TORCH_CHANCE) continue;

        /*
         * Light, and no torch to hold it.
         *
         * The bracket model went: at eye height it was a cartoon prop bolted
         * to a photograph of stone, and the room reads as lit from somewhere
         * without it. What stays is the pool of warm light on the wall and
         * floor where a torch would have been - tight against the rock, at
         * about head height. Point lights are the expensive kind, so only
         * the first few burn; the eye reads pooled light long before it
         * counts sources.
         */
        const torch = { position: { x: floor.x + dx * 0.46, z: floor.y + dy * 0.46 } };
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

  /**
   * The colour and normal map for one of the stones, loaded on first ask.
   *
   * Colour is sRGB and the normal is not. Getting that backwards washes the
   * whole room out, and it presents as "the lighting is wrong" rather than as
   * a colour space, which is a bad afternoon.
   */
  private stoneMaps(base: string): { color: THREE.Texture; normal: THREE.Texture } {
    const had = this.stone.get(base);
    if (had) return had;

    const loader = new THREE.TextureLoader();
    const color = loader.load(`${base}_color.webp`);
    color.colorSpace = THREE.SRGBColorSpace;
    const normal = loader.load(`${base}_normal.webp`);

    for (const map of [color, normal]) {
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 4;
    }

    const maps = { color, normal };
    this.stone.set(base, maps);
    return maps;
  }

  /**
   * Puts a stone material on an instanced surface.
   *
   * The material it replaces came from cloning the pack's, so it is this
   * renderer's to dispose - dropping it on the floor instead leaks one
   * material per rebuild, and the room rebuilds on every tap.
   */
  private dress(
    mesh: THREE.InstancedMesh,
    base: string,
    options: { roughness: number; tint?: number; repeat?: number },
  ): void {
    const maps = this.stoneMaps(base);
    // One scan per tile read as a single slab from eye height; tiled twice
    // it reads as the paving it is. The box UVs run 0..1 per face.
    if (options.repeat) {
      for (const map of [maps.color, maps.normal]) {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(options.repeat, options.repeat);
        map.needsUpdate = true;
      }
    }
    const old = mesh.material as THREE.Material;
    mesh.material = new THREE.MeshStandardMaterial({
      map: maps.color,
      normalMap: maps.normal,
      color: options.tint ?? 0xffffff,
      roughness: options.roughness,
      metalness: 0,
    });
    old.dispose();
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
   * Geometry for one tile, taken from a KayKit model when available.
   *
   * The packs share a single atlas texture, so every tile can still be drawn
   * with one InstancedMesh — the whole floor stays a handful of draw calls
   * whether it is boxes or real models.
   */
  private tileProto(
    key: string,
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
  }

  private buildInstanced(
    items: Array<{ x: number; y: number; tile: TileId }>,
    height: number,
    modelKey: string | null,
  ): THREE.InstancedMesh | null {
    if (items.length === 0) return null;

    const proto = modelKey ? this.tileProto(modelKey) : null;

    const geo =
      // Full tiles, edge to edge: the gap that drew a grid from above was a
      // black slit between every two blocks from inside.
      proto?.geometry ?? new THREE.BoxGeometry(TILE_SIZE, height, TILE_SIZE);
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
    for (const mesh of [this.floorMesh, this.rockMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      // Model geometry belongs to the cached glTF and is reused by the next
      // rebuild; only geometry this renderer created is disposed.
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.floorMesh = null;
    this.rockMesh = null;
  }

  /** Counts of what is actually in the scene, for debugging from the console. */
  debugStats(): Record<string, unknown> {
    return {
      modelsAvailable: this.models.available,
      modelsLoaded: [...this.loaded.entries()].filter(([, m]) => m).map(([k]) => k),
      sharedClips: this.sharedClips.length,
      floorInstances: this.floorMesh?.count ?? 0,
      landmarks: this.landmarks.length,
      decor: this.decor.length,
      clutter: this.clutter.length,
      clutterCleared: this.clutter.filter((c) => c.wanted === 0).length,
      flames: this.flames.length,
      pathMarkers: this.pathMarkers.length,
      units: this.unitMeshes.size,
      markers: this.markerMeshes.size,
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
    // No quarter-turn offset: square on to the room, not across its corner.
    return (this.yawStep * Math.PI) / 2;
  }

  /**
   * How far back the showcase camera stands.
   *
   * Far enough that the room fits in the part of the canvas the menu and the
   * name do not cover, whichever way it has turned, and never so close that
   * the far end of the room runs up under the name.
   *
   * The projection spans the canvas plus the hidden top strip (see
   * applyViewOffset), so a unit of room is measured against that height.
   */
  private showcaseDistance(): number {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const top = Math.min(this.topInset, Math.max(0, height - 80));
    const fullHeight = height + top;
    const visibleHeight = height - top;
    const visible = Math.max(80, width - this.leftInset);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const across = (SHOWCASE_SPAN * fullHeight) / (2 * tanHalf * visible * 0.95);
    const deep =
      (SHOWCASE_SPAN * Math.sin(SHOWCASE_PITCH) * 1.2 * fullHeight) / (2 * tanHalf * 0.9 * visibleHeight);
    return Math.max(across, deep);
  }

  /** Lights the dungeon up and sets it circling behind the title, or stops. */
  setShowcase(on: boolean): void {
    if (this.showcase === on) return;
    this.showcase = on;
    const boost = on ? SHOWCASE_LIGHT : 1;
    this.ambientLight.intensity = AMBIENT_INTENSITY * boost;
    this.keyLight.intensity = KEY_INTENSITY * boost;
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
    if (this.showcase) {
      const orbit = this.elapsed * SHOWCASE_SPIN;
      const distance = this.showcaseDistance();
      const flat = Math.cos(SHOWCASE_PITCH) * distance;
      this.camera.position.set(
        this.target.x + Math.sin(orbit) * flat,
        this.target.y + Math.sin(SHOWCASE_PITCH) * distance,
        this.target.z + Math.cos(orbit) * flat,
      );
      this.camera.lookAt(this.target);
      const showFog = this.scene.fog as THREE.Fog | null;
      if (showFog) {
        showFog.near = distance * 1.1;
        showFog.far = distance * 3;
      }
      return;
    }
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
        const object = this.spawnModel(modelKey, 0.9);
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

    // A right-click is not a tap: the browser's menu is suppressed, and the
    // secondary button does nothing on the board.
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

    this.elapsed += delta;

    for (const entry of this.mixers.values()) entry.mixer.update(delta);
    this.updateEffects(delta);
    this.updateUnitMotion(delta);
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

    // Streaks go out faster than rings, and only fade: a shot that also
    // grew would read as an explosion.
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.life -= delta / BOLT_SECONDS;
      if (bolt.life <= 0) {
        this.scene.remove(bolt.mesh);
        (bolt.mesh.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      (bolt.mesh.material as THREE.MeshBasicMaterial).opacity = bolt.life * 0.85;
    }

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
    for (const [, corpse] of this.corpses) this.disposeObject(this.unitGroup, corpse.object);
    this.corpses.clear();
    this.impacts.clear();

    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
    this.ringGeometry.dispose();

    for (const bolt of this.bolts) {
      this.scene.remove(bolt.mesh);
      (bolt.mesh.material as THREE.Material).dispose();
    }
    this.bolts = [];
    this.boltGeometry.dispose();

    this.setPathPreview(null);
    for (const maps of this.stone.values()) {
      maps.color.dispose();
      maps.normal.dispose();
    }
    this.stone.clear();
    this.pathGeometry.dispose();
    this.arrowGeometry.dispose();
    this.barGeometry.dispose();
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
    this.trapRing.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
