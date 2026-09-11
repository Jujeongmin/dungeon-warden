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

/**
 * Eye height and body width of whatever is walking the corridor, in tiles.
 *
 * The body is wide on purpose. At a quarter tile the camera could get its
 * nose within a fifth of a tile of the rock, and a wall that close fills the
 * screen with one texel of stone - the corridor stops reading as a corridor.
 * A third of a tile keeps a shoulder's width of dark between the eye and
 * the wall, which is what makes it feel like a passage rather than a scan.
 */
const EYE_HEIGHT = 0.6;
const BODY = 0.36;

/** Radians of turn per pixel dragged. */
const LOOK_SPEED = 0.0045;
/** Tiles a second on foot. A tile is about two metres. */
const WALK_SPEED = 2.2;
/**
 * Which arms each kind of ridden body shows.
 *
 * A convert wears an adventurer's model on the board but has no arms baked of
 * its own, so it borrows the warrior's - a pair of skeletal arms on something
 * that used to be a knight is odd, but far less odd than no hands.
 */
const ARMS_FOR: Record<string, string> = {
  warrior: "m_warrior_arms",
  mage: "m_mage_arms",
  convert: "m_warrior_arms",
};

/** And which whole body those arms were cut out of, for sizing them. */
const BODY_FOR: Record<string, string> = {
  warrior: "m_warrior",
  mage: "m_mage",
  convert: "m_warrior",
};

/** How long one swing owns the arms, in milliseconds. */
const SWING_MS = 450;

/**
 * Where the arms sit and where they point.
 *
 * One object rather than a handful of constants because every one of these
 * was found by looking at the screen and moving it, and they have to be
 * movable while looking at the screen - see debugViewTuning. `back`,
 * `aside` and `drop` hang the body off the lens in tiles; `upper` and
 * `lower` are the directions the two arm bones are aimed in, in the view
 * model's own frame, where +z is out into the corridor and -y is down.
 */
const VIEW_TUNING = {
  back: -0.85,
  aside: 0,
  drop: -0.14,
  upper: new THREE.Vector3(0.62, -0.9, 0.45),
  lower: new THREE.Vector3(0.1, 0.3, 1),
};

/**
 * And where each body's arms hang, because they are different animals.
 *
 * The imp's arms are short and thick and want to be close; the skeletons'
 * are long and thin and only read as arms from further back. There is no
 * formula in this - the numbers came from putting each one on the screen and
 * moving it until it looked like a pair of arms.
 */
const VIEW_PLACE: Record<string, { back: number; drop: number }> = {
  warden_arms: { back: -0.85, drop: -0.14 },
  m_warrior_arms: { back: -0.95, drop: -0.05 },
  m_mage_arms: { back: -0.95, drop: -0.05 },
};
/** How far the mannequin rig's arms are swung forward, and how far apart. */
const VIEW_UPPER = -0.8;
const VIEW_ELBOW = -0.5;
const VIEW_SPREAD = 0.05;
/** Scratch for the pose, so the frame loop allocates nothing. */
const VIEW_TURN = new THREE.Quaternion();
const VIEW_EULER = new THREE.Euler();
const VIEW_ROOT = new THREE.Quaternion();
const VIEW_WORLD = new THREE.Quaternion();
const VIEW_PARENT = new THREE.Quaternion();
const VIEW_DELTA = new THREE.Quaternion();
const VIEW_WANT = new THREE.Vector3();
const VIEW_HAVE = new THREE.Vector3();
const VIEW_A = new THREE.Vector3();
const VIEW_B = new THREE.Vector3();
/** How much taller the rock stands while the camera is down among it. */
const ROCK_STRETCH = 2.1;
/** How wide across the shoulders the warden is, in tiles. */
const WARDEN_WIDTH = 0.62;
/** And how tall it stands, which is what the eye height follows from. */
const WARDEN_HEIGHT = 0.92;
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
  /** A tap that was not a drag, while walking: down there it means hit. */
  onWalkTap?: () => void;
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
  /**
   * A tile crossed while dragging with a tool held.
   *
   * Cutting the first corridor is ten tiles in a line, and ten taps for one
   * intention is the kind of thing that makes a verb feel like paperwork.
   * Only fired for tiles the drag actually enters, once each.
   */
  onTileDrag?: (x: number, y: number) => void;
  /**
   * Whether the tool in hand is one a drag should run along.
   *
   * Asked at the moment the gesture starts rather than pushed in by a setter.
   * A setter has to be called from an effect, and the effect that would do it
   * runs before the one that builds this renderer - so on the pass that
   * matters it was setting a field on nothing, and every drag panned the
   * camera instead of digging.
   */
  isPaintable?: () => boolean;
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
  private roomGeometry = new THREE.BoxGeometry(0.94, MARKER_HEIGHT * 0.6, 0.94);


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
  /** The last tile a drag painted, so crossing one tile twice does nothing. */
  private paintedTile: string | null = null;
  /** Where the last painted tile was, so a fast drag can be joined up. */
  private paintedAt: { x: number; y: number } | null = null;
  /** Whether the current drag paints tiles rather than moving the camera. */
  private painting = false;
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
    const ambient = new THREE.AmbientLight(0xbcc6d8, 0.62);
    const key = new THREE.DirectionalLight(0xdfe3ee, 0.72);
    key.position.set(6, 14, 4);
    const rim = new THREE.DirectionalLight(0x8fa6cc, 0.22);
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

    /*
     * The view model's own little world: a holder that copies the camera
     * every frame, and two lights so the arms are lit the same whether the
     * warden is standing under a torch or in the dark.
     */
    this.viewHolder.matrixAutoUpdate = false;
    this.viewScene.add(this.viewHolder);
    this.viewScene.add(new THREE.AmbientLight(0xbfae9c, 0.75));
    const viewKey = new THREE.DirectionalLight(0xffd9a8, 1.1);
    viewKey.position.set(-0.6, 1.4, 1);
    this.viewScene.add(viewKey);

    this.scene.add(this.unitGroup);
    this.scene.add(this.markerGroup);
    this.scene.add(this.aftermathGroup);

    this.attachPointerEvents();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

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
    this.setUnits(this.lastUnits);
    this.setMarkers(this.lastMarkers);
    // The body was spawned before its model existed, if it exists at all.
    if (this.walk) this.spawnWarden();

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
          this.spawnModel(modelKey, marker.shape === "trap" ? 0.78 : 0.85) ??
          new THREE.Mesh(
            marker.shape === "trap" ? this.trapGeometry : this.roomGeometry,
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
         * something", from above and from the corridor alike, and its
         * colour is the one the same trap flashes when it fires.
         */
        if (marker.shape === "trap") {
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
      this.applyRockHeight();
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
   * Shake is applied here as a pure offset on top of the player's own
   * target/distance/yaw — never by mutating them — so panning, zooming and
   * rotating during a shake behave exactly as if it were not happening, and
   * the camera lands back exactly where the player left it once trauma hits
   * zero (the offset is `f(trauma, time)`, not integrated, so it can't
   * drift).
   */
  /**
   * Standing in the corridor rather than looking down at it.
   *
   * Not a way to play - the board above is where a maze gets built, because
   * planning one is a thing you do by looking at it. This is for the other
   * half of building a dungeon, which is wanting to see what you made from
   * inside it, at the height of the things that have to walk through it.
   *
   * Held in world units rather than tiles so the walk is smooth; the rock it
   * cannot pass through is still read per tile.
   */
  private walk: { at: THREE.Vector3; yaw: number; pitch: number } | null = null;
  /**
   * The body the camera rides while walking.
   *
   * A whole skeleton standing where the player stands, turned the way they
   * look, so their own arms swing into view when they dig and their own
   * feet are under them when they look down. The camera sits at its eyes.
   */
  private warden: THREE.Object3D | null = null;
  /** The same body again, cut down to two arms and hung off the camera. */
  private viewArms: THREE.Object3D | null = null;
  /** Which kind of body is being ridden, or null for the warden's own. */
  private possessedType: string | null = null;
  /** How far the view model's own eyes sit above its feet, at its drawn size. */
  private viewEye = 0;
  /** Whether this rig wants its arms aimed rather than turned by a fixed angle. */
  private viewAimed = false;
  /** Wall-clock time the current swing ends at. */
  private swingUntil = 0;
  /** Shoulders, arms and elbows of that copy, turned into view every frame. */
  private viewBones: Array<[string, THREE.Object3D]> = [];
  private viewHolder = new THREE.Group();
  private viewScene = new THREE.Scene();
  /** Eye height of that body, measured from its own head rather than assumed. */
  private wardenEye = EYE_HEIGHT;
  /** Whether the body moved this frame, for idle against walk. */
  private wardenMoving = false;
  /** Keys held, for walking on a keyboard. */
  private keys = new Set<string>();
  /** A stick or pad, -1..1 on each axis. Overrides the keys while pushed. */
  private moveInput = { forward: 0, strafe: 0 };

  /** True while the camera is down in the corridor. */
  get walking(): boolean {
    return this.walk !== null;
  }

  /**
   * Drops into the dungeon, or climbs back out.
   *
   * Entering puts the camera on the doorway looking the way the raiders walk,
   * because that is the view the whole room is designed around and the one
   * the player has never actually had.
   */
  setWalking(on: boolean): void {
    if (!on) {
      this.walk = null;
      this.disposeWarden();
      this.keys.clear();
      this.activePointers.clear();
      this.dragStart = null;
      this.dragMoved = false;
      this.moveInput.forward = 0;
      this.moveInput.strafe = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.applyRockHeight();
      return;
    }
    if (!this.entrance || !this.core) return;

    this.walk = {
      at: new THREE.Vector3(this.entrance.x, FLOOR_HEIGHT + EYE_HEIGHT, this.entrance.y),
      // Facing the core: the room runs down a column, so that is straight
      // along +z, and atan2 of the difference keeps it honest if that changes.
      yaw: Math.atan2(this.core.x - this.entrance.x, this.core.y - this.entrance.y),
      pitch: 0,
    };
    this.spawnWarden();
    this.applyRockHeight();
  }

  /**
   * The rock stands taller from inside than from above.
   *
   * From the board a wall the height of a person hides the corridor behind
   * it; from the corridor a wall the height of a table shows the black
   * above the room over every edge. So the same blocks are stretched while
   * the camera is down among them and let back down when it climbs out.
   */
  private applyRockHeight(): void {
    const k = this.walk ? ROCK_STRETCH : 1;
    if (this.rockMesh) {
      this.rockMesh.scale.y = k;
      // Instances carry their own lift; scaling about the floor keeps their
      // feet on it.
      this.rockMesh.position.y = 0;
    }
  }

  /** Stands the body up where the walk starts. Harmless before models load. */
  private spawnWarden(): void {
    this.disposeWarden();
    const body = this.spawnModel("warden", WARDEN_WIDTH);
    if (!body) return;

    /*
     * Sized by height, not by width.
     *
     * fitToTile fits the widest horizontal dimension, which for a body is
     * the span of its shoulders - so a humanoid came out half a tile tall,
     * looking out of the corridor at the height of a dog. What matters here
     * is how tall the thing whose eyes these are stands.
     */
    body.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(body);
    const tall = raw.max.y - raw.min.y;
    if (tall > 0.01) {
      body.scale.multiplyScalar(WARDEN_HEIGHT / tall);
      body.updateMatrixWorld(true);
      const grown = new THREE.Box3().setFromObject(body);
      body.position.y -= grown.min.y;
    }

    /*
     * Its own head says how high the eye sits.
     *
     * The one number that should follow from the model rather than from a
     * guess, whatever body ends up in this slot - a taller warden looks
     * over the rock from higher up, and its copy stands proportionally
     * further down the screen.
     */
    let eye = FLOOR_HEIGHT + EYE_HEIGHT;
    body.updateMatrixWorld(true);
    body.traverse((child) => {
      if (child.name === "Head") eye = child.getWorldPosition(new THREE.Vector3()).y;
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // Skinned meshes are culled against the bind pose, so a body that
      // swings an arm past the camera pops out of view mid-swing.
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.side = THREE.FrontSide;
    });
    this.wardenEye = eye;

    /*
     * Motion comes from a second file, not from the body.
     *
     * The kit the imp is from ships no animation at all; the library that
     * animates it ships no monsters. They share the same skeleton, which is
     * why these two were chosen together - the clips name bones, and these
     * are those bones.
     */
    const own = this.loaded.get("warden")?.animations ?? [];
    const rigged = this.loaded.get("warden_clips")?.animations ?? [];
    const clips = own.length > 0 ? own : rigged.length > 0 ? rigged : this.sharedClips;
    this.setupAnimation("warden", body, clips);
    this.playClip("warden", "idle");
    /*
     * The body itself is not drawn while the camera is in its head.
     *
     * It is still there - it walks, it swings, and everything measured off
     * it stays true - but from the inside all it can offer is the back of
     * its own chest across the lens. What the player sees of themselves is
     * the copy below, held where hands belong.
     */
    body.visible = false;
    this.warden = body;
    this.scene.add(body);
    this.buildViewArms(clips);
  }

  /**
   * The warden's own arms, seen down its own nose.
   *
   * A second copy of the body, wrapped round the lens: head and legs held
   * at nothing, shoulders turned forward so the arms and the mace hang in
   * the lower frame the way they do in any game played from inside a
   * head. It runs the same clips as the body in the room, so a swing here
   * is the swing the room sees.
   *
   * A copy rather than the body itself, and drawn in a pass of its own
   * over a cleared depth buffer: an arm a hand's width from the lens is
   * inside whatever wall the warden is standing at, and the room would
   * eat it.
   */
  /**
   * How tall a creature stands and how high its eyes sit, in its own units.
   *
   * Read off the whole body even when what gets drawn is a pair of arms: the
   * arms were cut out of that body and carry no head to measure, and the two
   * numbers the view needs - how much to shrink it, and how far to drop it so
   * the eyes land on the lens - are both about the whole animal.
   */
  private measureBody(key: string): { tall: number; eye: number } | null {
    const model = this.loaded.get(key);
    if (!model) return null;

    const scene = model.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const tall = box.max.y - box.min.y;
    if (tall < 0.01) return null;

    // Top of the head as a fallback, for a rig that names its skull something
    // this does not know.
    let eye = box.max.y;
    const at = new THREE.Vector3();
    scene.traverse((child) => {
      if (/^head$/i.test(child.name)) eye = child.getWorldPosition(at).y;
    });
    return { tall, eye: eye - box.min.y };
  }

  private buildViewArms(
    clips: THREE.AnimationClip[],
    key = "warden_arms",
    sourceKey = "warden",
  ): void {
    /*
     * Arms if the bake made them, the whole body if it did not.
     *
     * scripts/bake-warden.mjs cuts the arms out of the body by bone weight,
     * because no free pack ships a monster's. Falling back to the body keeps
     * the view working on a checkout where that file was never built.
     */
    const model = this.loaded.get(key) ?? this.loaded.get("warden_arms") ?? this.loaded.get("warden");
    if (!model) return;

    const arms = this.models.instantiate(model);
    arms.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // Skinned meshes are culled against their bind pose, and this one is
      // never where the pose says it is.
      mesh.frustumCulled = false;
      mesh.renderOrder = 60;
    });

    /*
     * Sized and hung off its own eyes.
     *
     * The copy comes out of the library at whatever scale the file was
     * authored in - which for this one is a giant - so it borrows the scale
     * the room body was fitted to, and hangs by the distance from that
     * body's feet to its eyes: put the copy's head where the lens is, and
     * its shoulders land where shoulders belong.
     */
    /*
     * Sized against the body it is a copy of, and hung by the eyes.
     *
     * The library hands out the model at the scale its author used - a
     * giant, here - so the copy borrows the scale the room body was fitted
     * to. Dropping it by the height of that body's eyes puts the copy's own
     * eyes at the lens, whatever body ends up in the slot; turning it to
     * face away from the viewer is what makes this the inside of a head
     * rather than a mirror.
     */
    /*
     * Measured from the body these arms came out of, not from the warden.
     *
     * Borrowing the warden's scale worked while the only arms in the game
     * were the warden's. A ridden skeleton is a different model at a
     * different authored size, and wearing the imp's shrink factor made it
     * either a pair of girders across the screen or nothing at all.
     */
    const fit = this.measureBody(sourceKey);
    const factor = fit ? WARDEN_HEIGHT / fit.tall : 1;
    const eyeAboveFeet = fit ? fit.eye * factor : this.wardenEye - FLOOR_HEIGHT;
    arms.scale.multiplyScalar(factor);
    const place = VIEW_PLACE[key] ?? VIEW_TUNING;
    VIEW_TUNING.back = place.back;
    VIEW_TUNING.drop = place.drop;
    arms.position.set(VIEW_TUNING.aside, -eyeAboveFeet + place.drop, place.back);
    this.viewEye = eyeAboveFeet;
    arms.rotation.set(0, Math.PI, 0);

    this.viewBones = [];
    arms.traverse((child) => {
      if (/^(upperarm|lowerarm)[_.][lr]$/i.test(child.name)) {
        this.viewBones.push([child.name, child]);
      }
    });
    // KayKit joins its bone names with a dot, the Unreal mannequin with an
    // underscore. Which one this is decides how the arms are posed - see
    // poseViewArms.
    this.viewAimed = this.viewBones.some(([name]) => name.includes("."));

    this.viewArms = arms;
    this.viewHolder.add(arms);
    this.setupAnimation("view-arms", arms, clips);
    this.playClip("view-arms", "idle");
  }

  private disposeWarden(): void {
    if (this.viewArms) {
      this.mixers.delete("view-arms");
      this.disposeObject(this.viewHolder, this.viewArms);
      this.viewArms = null;
      this.viewBones = [];
    }
    this.possessedType = null;
    if (!this.warden) return;
    this.mixers.delete("warden");
    this.disposeObject(this.scene, this.warden);
    this.warden = null;
  }

  /**
   * Turns the copy's shoulders forward and folds away what is not an arm.
   *
   * Applied after the mixer and before the frame, on top of whatever the
   * clip did: the clip decides how the arm swings, this decides where it
   * swings from. Both have to be redone every frame - the clips carry
   * rotation and scale tracks, so a pose set once is gone by the next one,
   * which is how the head grew back mid-swing the first time.
   */
  private poseViewArms(): void {
    const arms = this.viewArms;
    if (!arms) return;

    /*
     * Each arm is aimed rather than rotated by a fixed angle.
     *
     * A fixed Euler only works for one skeleton. The imp is rigged to the
     * Unreal mannequin and the minions to KayKit's, and the same numbers that
     * put an imp's claws in the frame left a skeleton's arms splayed out
     * sideways, because the two rigs do not agree on which way an arm bone
     * lies in its parent. So this asks the only question that transfers:
     * where does this bone currently point, and where should it point? The
     * turn that carries one onto the other is the pose, whatever the rig.
     *
     * Re-done every frame on top of whatever the clip did - the clips carry
     * rotation tracks for these bones, so a pose set once is gone by the next
     * frame - and the clip still owns the swing. This only decides where the
     * arm swings from.
     */
    if (!this.viewAimed) {
      /*
       * The mannequin rig, turned by a fixed angle at the shoulder.
       *
       * An arm bone points down its own length, so turning it about its own
       * axes only twists the limb. Applied from the parent side instead, the
       * same angle swings the whole arm forward, which is what puts it in the
       * picture. These numbers were found on the imp and they fit it.
       */
      for (const [name, bone] of this.viewBones) {
        const side = name.endsWith("_l") ? 1 : -1;
        const pitch = name.startsWith("upperarm") ? VIEW_UPPER : VIEW_ELBOW;
        VIEW_EULER.set(pitch, VIEW_SPREAD * side, 0);
        VIEW_TURN.setFromEuler(VIEW_EULER);
        bone.quaternion.premultiply(VIEW_TURN);
      }
      return;
    }

    arms.updateMatrixWorld(true);
    arms.getWorldQuaternion(VIEW_ROOT);

    for (const [name, bone] of this.viewBones) {
      const child = bone.children.find((c) => (c as THREE.Bone).isBone) ?? bone.children[0];
      if (!child) continue;

      // The models are mirrored down the middle, so the left arm wants the
      // same aim with its sideways component flipped.
      const side = /[_.]l$/i.test(name) ? 1 : -1;
      const aim = name.toLowerCase().startsWith("upperarm") ? VIEW_TUNING.upper : VIEW_TUNING.lower;
      VIEW_WANT.set(aim.x * side, aim.y, aim.z).normalize().applyQuaternion(VIEW_ROOT);

      bone.updateMatrixWorld(true);
      child.updateMatrixWorld(true);
      VIEW_HAVE.copy(child.getWorldPosition(VIEW_A)).sub(bone.getWorldPosition(VIEW_B));
      if (VIEW_HAVE.lengthSq() < 1e-8) continue;
      VIEW_HAVE.normalize();

      // Turn in world terms, then written back into the parent's frame, which
      // is the only frame a bone's own rotation is allowed to speak in.
      VIEW_DELTA.setFromUnitVectors(VIEW_HAVE, VIEW_WANT);
      bone.getWorldQuaternion(VIEW_WORLD);
      bone.parent?.getWorldQuaternion(VIEW_PARENT);
      bone.quaternion.copy(VIEW_PARENT.invert().multiply(VIEW_DELTA).multiply(VIEW_WORLD));
      bone.updateMatrixWorld(true);
    }
  }

  /** Keeps the body under the camera and in the right clip. */
  private updateWarden(): void {
    const walk = this.walk;
    const body = this.warden;
    if (!walk || !body) return;


    body.position.x = walk.at.x;
    body.position.z = walk.at.z;
    body.rotation.y = walk.yaw;
    this.poseViewArms();

    // A swing owns the arms until it is done, or walking would cut it off
    // at the first frame the player moved.
    if (performance.now() < this.swingUntil) return;
    this.playClip("warden", this.wardenMoving ? "walk" : "idle");
    this.playClip("view-arms", this.wardenMoving ? "walk" : "idle");
  }

  /**
   * Puts the view inside one of the garrison instead of the warden's own body.
   *
   * Only the picture changes here. Where that body stands, what it hits and
   * whether it lives are the simulation's, and arrive through
   * `setPossessedAt`; this swaps the arms for the ones belonging to the type
   * of thing being ridden, so a warden in a skeleton looks down at bone.
   *
   * Passing null hands the view back to the warden's own arms.
   */
  setPossessed(type: string | null): void {
    if (this.possessedType === type) return;
    this.possessedType = type;

    const body = this.warden;
    if (!body) return;

    if (this.viewArms) {
      this.mixers.delete("view-arms");
      this.disposeObject(this.viewHolder, this.viewArms);
      this.viewArms = null;
      this.viewBones = [];
    }

    if (type) {
      // The skeletons carry no clips of their own; the pack ships one rig's
      // worth for everything built on it, which is what sharedClips holds.
      this.buildViewArms(this.sharedClips, ARMS_FOR[type] ?? "warden_arms", BODY_FOR[type] ?? "warden");
      return;
    }

    const own = this.loaded.get("warden")?.animations ?? [];
    const rigged = this.loaded.get("warden_clips")?.animations ?? [];
    this.buildViewArms(own.length > 0 ? own : rigged.length > 0 ? rigged : this.sharedClips);
  }

  /**
   * Where the ridden body ended up this step.
   *
   * The simulation owns the position while something is being ridden - it is
   * the thing that knows about rock, about reach and about the rest of the
   * raid - so the view follows rather than leads.
   */
  setPossessedAt(x: number, y: number): void {
    if (!this.walk) return;
    this.walk.at.x = x;
    this.walk.at.z = y;
  }

  /**
   * Which way the player is asking the ridden body to go, in arena tiles.
   *
   * The same two axes free walking uses, turned into the world by the heading
   * the player is looking along, so forward is wherever they are facing. Zero
   * on both when nothing is held.
   */
  moveRequest(): { x: number; y: number; facing: number } {
    const yaw = this.walk?.yaw ?? 0;
    const { forward, strafe } = this.moveAxes();
    // The same basis as step(): right is forward crossed with up.
    return {
      x: Math.sin(yaw) * forward - Math.cos(yaw) * strafe,
      y: Math.cos(yaw) * forward + Math.sin(yaw) * strafe,
      facing: yaw,
    };
  }

  /**
   * Throws the arms through one swing.
   *
   * Timed off the wall clock rather than counted down in the frame loop,
   * because the swing is a picture: it has no say in what the simulation
   * decides the blow did, and a dropped frame should not leave an arm stuck
   * out in front of the camera.
   */
  swing(): void {
    if (!this.viewArms && !this.warden) return;
    this.swingUntil = performance.now() + SWING_MS;
    this.playClip("warden", "attack");
    this.playClip("view-arms", "attack");
  }

  /**
   * The view model's placement, live.
   *
   * Every number in it was arrived at by moving it and looking, so it is
   * handed out rather than hidden: change a field and the next frame shows
   * it. Used from the console during development; nothing in the game writes
   * to it.
   */
  debugViewTuning(): typeof VIEW_TUNING & { apply: () => void } {
    return Object.assign(VIEW_TUNING, {
      apply: () => {
        if (!this.viewArms) return;
        this.viewArms.position.set(
          VIEW_TUNING.aside,
          -this.viewEye + VIEW_TUNING.drop,
          VIEW_TUNING.back,
        );
      },
    });
  }

  /** Turns the head. Radians, from a drag. */
  look(dYaw: number, dPitch: number): void {
    if (!this.walk) return;
    this.walk.yaw -= dYaw;
    // Stopped short of straight up and straight down, where the horizon rolls
    // over and the controls appear to invert.
    this.walk.pitch = THREE.MathUtils.clamp(this.walk.pitch - dPitch, -1.2, 1.2);
  }

  /**
   * Walks forward, stopped by rock.
   *
   * The two axes are tried separately so a wall taken at an angle slides
   * along it rather than stopping dead, which is the difference between a
   * corridor that feels walkable and one that feels like a bug.
   */
  step(amount: number, sideways = 0): void {
    const walk = this.walk;
    const arena = this.arena;
    if (!walk || !arena) return;

    // Right is forward crossed with up: for a heading (sin, cos) that is
    // (-cos, sin). It was written the other way round, and D walked left.
    const dx = Math.sin(walk.yaw) * amount - Math.cos(walk.yaw) * sideways;
    const dz = Math.cos(walk.yaw) * amount + Math.sin(walk.yaw) * sideways;

    if (this.standable(walk.at.x + dx, walk.at.z)) walk.at.x += dx;
    if (this.standable(walk.at.x, walk.at.z + dz)) walk.at.z += dz;
  }

  /**
   * A stick, held. -1..1 on each axis; zero on both lets the keys speak.
   *
   * Applied per frame in the loop rather than on the event, so the speed is
   * the same on every device however often the stick reports.
   */
  setMoveInput(forward: number, strafe: number): void {
    this.moveInput.forward = THREE.MathUtils.clamp(forward, -1, 1);
    this.moveInput.strafe = THREE.MathUtils.clamp(strafe, -1, 1);
  }

  /** The two movement axes, from whichever input is live. */
  private moveAxes(): { forward: number; strafe: number } {
    const forward = this.moveInput.forward;
    const strafe = this.moveInput.strafe;
    if (forward !== 0 || strafe !== 0) return { forward, strafe };

    const k = this.keys;
    return {
      forward: (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0),
      strafe: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
    };
  }

  /** One frame of walking, from whichever input is live. */
  private updateWalk(delta: number): void {
    if (!this.walk) return;
    const { forward, strafe } = this.moveAxes();
    this.wardenMoving = forward !== 0 || strafe !== 0;
    /*
     * A ridden body is walked by the simulation, not from here.
     *
     * It has rock to respect that this view does not know about - other
     * minions, the edge of the raid - and more importantly the adventurers
     * have to see it move. So the input is read for the animation and handed
     * out through moveRequest; the position arrives back via setPossessedAt.
     */
    if (this.possessedType !== null) return;
    if (!this.wardenMoving) return;
    // Diagonals are not faster: the two axes share one speed.
    const length = Math.hypot(forward, strafe);
    const scale = (WALK_SPEED * delta) / Math.max(1, length);
    this.step(forward * scale, strafe * scale);
  }

  /**
   * Whether a point is far enough from the rock to stand on.
   *
   * Kept a body-width clear of the edge, or the camera pushes its nose
   * through the wall and the corridor turns inside out.
   */
  private standable(x: number, z: number): boolean {
    const arena = this.arena;
    if (!arena) return false;

    for (const [ox, oz] of [[BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY]]) {
      const tx = Math.round(x + ox);
      const tz = Math.round(z + oz);
      if (!inArena(arena, tx, tz)) return false;
      if (!this.dug.has(tx + tz * arena.w)) return false;
    }
    return true;
  }

  private updateCamera(): void {
    /*
     * Down in the corridor: the camera is the player, so it is a position and
     * a heading rather than something orbiting a point on the floor.
     */
    if (this.walk) {
      /*
       * At the warden's own eyes.
       *
       * Standing the camera behind the shoulders was tried and cannot work
       * here: the corridor is one tile wide, so anywhere far enough back to
       * see the body is inside the rock behind it, and at the door - where
       * every game starts - that is the outside of the room. So the view is
       * the warden's, and what it sees of itself is the pair of arms held
       * in front of it by `viewArms`.
       */
      const eye = this.warden ? this.wardenEye : this.walk.at.y;
      const ex = this.walk.at.x;
      const ez = this.walk.at.z;
      this.camera.position.set(ex, eye, ez);
      const cosPitch = Math.cos(this.walk.pitch);
      this.camera.lookAt(
        ex + Math.sin(this.walk.yaw) * cosPitch,
        eye + Math.sin(this.walk.pitch),
        ez + Math.cos(this.walk.yaw) * cosPitch,
      );
      const closeFog = this.scene.fog as THREE.Fog | null;
      // Much tighter than the overview: down here the dark is the point.
      if (closeFog) {
        closeFog.near = 1.5;
        closeFog.far = 11;
      }
      return;
    }

    return this.updateOrbitCamera();
  }

  private updateOrbitCamera(): void {
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

  /**
   * Reports every tile the drag crossed, once each, in the order crossed.
   *
   * Joined up rather than sampled. A browser coalesces pointer moves, so a
   * quick swipe down the room arrives as two or three events several tiles
   * apart - and digging only where the events landed cut a corridor with
   * holes in it, which is not what the hand did. The tiles between the last
   * one and this one are walked here, so the gesture means what it looked
   * like.
   *
   * A straight walk (the long axis first, then the short one) rather than a
   * true line: what matters is that consecutive tiles touch, so whatever is
   * being painted can see its own neighbour.
   */
  private paintAt(clientX: number, clientY: number): void {
    const tile = this.pointerToTile(clientX, clientY);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;
    if (key === this.paintedTile) return;

    const from = this.paintedAt;
    this.paintedTile = key;
    this.paintedAt = { x: tile.x, y: tile.y };

    if (from) {
      const stepX = Math.sign(tile.x - from.x);
      const stepY = Math.sign(tile.y - from.y);
      let x = from.x;
      let y = from.y;
      // Bounded: a pointer that jumped clear across the room still only
      // walks the room, and a bad reading cannot spin here.
      for (let guard = 0; guard < 64 && (x !== tile.x || y !== tile.y); guard += 1) {
        if (x !== tile.x) x += stepX;
        else y += stepY;
        if (x === tile.x && y === tile.y) break;
        this.callbacks.onTileDrag?.(x, y);
      }
    }

    this.callbacks.onTileDrag?.(tile.x, tile.y);
  }

  private onPointerDown = (e: PointerEvent): void => {
    /*
     * Down in the corridor the pointer only turns the head. Construction is
     * deliberately confined to the overview, where the player can read the
     * whole route before changing it.
     */
    if (this.walk) {
      if (e.pointerType === "mouse") {
        /*
         * With the pointer locked the mouse is a proper first-person mouse:
         * the view follows it with nothing held. The lock is asked for on the
         * first primary click but never waited on; inside an iframe without
         * that permission the drag fallback below still turns the head.
         */
        if (document.pointerLockElement === this.canvas) return;
        if (e.button !== 0) return;
        try {
          const request = this.canvas.requestPointerLock?.() as unknown;
          if (request instanceof Promise) request.catch(() => undefined);
        } catch {
          /* not available here; the drag turns the head instead */
        }
      }

      // Capture is refused while a lock request is in flight; it only keeps
      // a drag that leaves the canvas, so doing without is fine.
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* see above */
      }
      this.activePointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
      this.dragStart = new THREE.Vector2(e.clientX, e.clientY);
      this.dragMoved = false;
      return;
    }

    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (this.activePointers.size === 1) {
      this.dragStart = new THREE.Vector2(e.clientX, e.clientY);
      this.dragMoved = false;
      /*
       * A drag with a tool in hand paints tiles instead of moving the camera.
       *
       * Decided once, here, rather than per move: a gesture that started as
       * a dig and turned into a pan halfway through is a dungeon with a hole
       * in a place nobody chose.
       */
      this.painting = this.callbacks.isPaintable?.() === true;
      this.paintedTile = null;
      this.paintedAt = null;
      if (this.painting) this.paintAt(e.clientX, e.clientY);
    } else if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      this.pinchStartDistance = a.distanceTo(b);
      this.pinchStartCameraDistance = this.distance;
      this.dragMoved = true; // a pinch is never a tap
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const previous = this.activePointers.get(e.pointerId);

    // Down in the corridor a drag is the head turning, and there is no tile
    // under the cursor to hover - the cursor is the player's eyes.
    if (this.walk) {
      if (document.pointerLockElement === this.canvas) {
        this.look(e.movementX * LOOK_SPEED, e.movementY * LOOK_SPEED);
        return;
      }
      if (!previous) return;
      const current = new THREE.Vector2(e.clientX, e.clientY);
      if (!this.dragMoved && this.dragStart && current.distanceTo(this.dragStart) > TAP_SLOP) {
        this.dragMoved = true;
      }
      this.look(
        (current.x - previous.x) * LOOK_SPEED,
        (current.y - previous.y) * LOOK_SPEED,
      );
      this.activePointers.set(e.pointerId, current);
      return;
    }

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

    // Painting a run of tiles, not moving the camera.
    if (this.painting) {
      this.paintAt(e.clientX, e.clientY);
      return;
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
    if (this.walk) {
      if (e.pointerType === "mouse" && document.pointerLockElement === this.canvas) {
        if (!this.dragMoved) this.callbacks.onWalkTap?.();
        this.activePointers.clear();
        this.dragStart = null;
        this.dragMoved = false;
        return;
      }
      const single = this.activePointers.size === 1;
      this.activePointers.delete(e.pointerId);
      if (single && !this.dragMoved) this.callbacks.onWalkTap?.();
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      if (this.activePointers.size === 0) {
        this.dragStart = null;
        this.dragMoved = false;
      }
      return;
    }

    const wasSingle = this.activePointers.size === 1;
    this.activePointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    // A tap in the overview edits the tile; the walking branch returned above.
    if (wasSingle && !this.dragMoved && !this.painting) {
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
      this.painting = false;
      this.paintedTile = null;
      this.paintedAt = null;
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
    if (this.walk) {
      this.keys.add(e.key.toLowerCase());
      return;
    }
    if (e.key === "q" || e.key === "Q") this.rotate(-1);
    if (e.key === "e" || e.key === "E") this.rotate(1);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
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
    this.updateWalk(delta);
    this.updateWarden();

    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    if (this.viewArms) {
      /*
       * The arms go where the head goes, pitch and all: they are part of
       * the view, not part of the room.
       *
       * The flag has to be raised by hand because this holder keeps a
       * matrix rather than a position and a rotation; without it three
       * leaves the matrix where it was built and the arms hang at the
       * origin, in the corner of the room, which looks like no arms at all.
       */
      this.viewHolder.matrix.copy(this.camera.matrixWorld);
      this.viewHolder.matrixWorldNeedsUpdate = true;
      // Over the room, never instead of it: this pass clears depth only.
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.camera);
      this.renderer.autoClear = true;
    }
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
    window.removeEventListener("keyup", this.onKeyUp);

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

    this.setPathPreview(null);
    for (const maps of this.stone.values()) {
      maps.color.dispose();
      maps.normal.dispose();
    }
    this.stone.clear();
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
    this.trapRing.dispose();
    this.roomGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
